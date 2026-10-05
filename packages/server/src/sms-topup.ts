import type { Sql } from '@lango/db';
import { withTenant } from '@lango/db';
import { decrypt } from './crypto.js';
import { emailClubReceipt } from './receipts.js';
import { clubSms, msisdn, platformSmsConfig } from './sms.js';
import { initiatedTransactionId, normalStatus, pick, TaifaPay, transactionRecord } from './taifapay.js';

/** NAVAC's own TaifaPay account (Platform settings): SMS credit is bought from NAVAC, not from the club. */
export async function platformTaifa(sql: Sql): Promise<TaifaPay | null> {
  const [row] = await sql<{ data: { env: 'live' | 'sandbox'; clientId: string; clientSecret: string } | null }[]>`
    select app_platform_get('taifapay') as data`;
  const t = row?.data;
  if (!t?.clientId || !t.clientSecret) return null;
  return new TaifaPay({ env: t.env, clientId: t.clientId, clientSecret: decrypt(t.clientSecret) });
}

/** "Lango SMS Demo Club" (TaifaPay/M-Pesa show about 20 characters of the description). */
export const smsDescription = (club: string) => `Lango SMS ${club}`.slice(0, 20).trim();

/** NAVAC's billing details printed on SMS invoices and receipts (SaaS console). */
export interface Billing {
  name: string;
  address?: string;
  pin?: string;
  email?: string;
  phone?: string;
}
export async function platformBilling(sql: Sql): Promise<Billing> {
  const [row] = await sql<{ data: Partial<Billing> | null }[]>`select app_platform_get('billing') as data`;
  return { ...row?.data, name: row?.data?.name || 'NAVAC Global' };
}

export type TopupResult =
  | { ok: true; topupId: string; units: number }
  | { ok: false; reason: 'no-platform-taifapay' | 'phone' | 'amount' | 'pending' | 'failed' };

/**
 * Buy SMS credit: an M-Pesa prompt on the payer's phone, paid to NAVAC's TaifaPay account. Credit (amount ÷ the
 * club's price per SMS) is added only when TaifaPay confirms the payment.
 */
export async function startTopup(
  sql: Sql,
  tenantId: string,
  a: { amountKes: number; phone: string; trigger: 'manual' | 'auto'; actor: string },
): Promise<TopupResult> {
  const phone = msisdn(a.phone);
  if (!phone) return { ok: false, reason: 'phone' };
  if (!Number.isInteger(a.amountKes) || a.amountKes < 10 || a.amountKes > 150_000)
    return { ok: false, reason: 'amount' };
  const client = await platformTaifa(sql);
  if (!client) return { ok: false, reason: 'no-platform-taifapay' };
  const platform = await platformSmsConfig(sql);
  const created = await withTenant(sql, tenantId, async (tx) => {
    // One automatic prompt at a time: never spam the club's phone while a prompt is unanswered.
    if (a.trigger === 'auto') {
      const [open] =
        await tx`select 1 from sms_topups where trigger = 'auto' and status = 'pending' and created_at > now() - interval '60 minutes'`;
      if (open) return null;
    }
    const club = await clubSms(tx, tenantId, platform);
    const units = Math.floor(a.amountKes / club.priceKes);
    if (units < 1) return null;
    const [t] = await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`;
    const [row] = await tx<{ id: string; invoice_no: string }[]>`
      insert into sms_topups (tenant_id, amount_kes, price_kes, units, phone, trigger, created_by)
      values (${tenantId}, ${a.amountKes}, ${club.priceKes}, ${units}, ${phone}, ${a.trigger}, ${a.actor})
      returning id, invoice_no`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${a.actor}, 'sms.topup_requested', ${row?.id ?? null}, ${tx.json({ amountKes: a.amountKes, units, trigger: a.trigger } as never)})`;
    // NAVAC's one TaifaPay account takes payments for many services: the invoice number is the account reference
    // and the description names the service and the club, so each line on the statement explains itself.
    return { id: row?.id as string, units, ref: row?.invoice_no as string, desc: smsDescription(t?.name ?? '') };
  });
  if (!created) return { ok: false, reason: a.trigger === 'auto' ? 'pending' : 'amount' };
  try {
    const res = await client.stkPush({
      phone,
      amount: a.amountKes,
      accountReference: created.ref,
      description: created.desc,
      externalId: created.id,
    });
    const ref = initiatedTransactionId(res);
    await withTenant(sql, tenantId, (tx) => tx`update sms_topups set provider_ref = ${ref} where id = ${created.id}`);
    return { ok: true, topupId: created.id, units: created.units };
  } catch {
    await withTenant(sql, tenantId, (tx) => tx`update sms_topups set status = 'failed' where id = ${created.id}`);
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Settle pending top-ups by asking TaifaPay (used by the webhook and the 60 s poller). The credit is added once:
 * the ledger has a unique (tenant, kind, ref) entry per top-up.
 */
export async function reconcileTopups(
  sql: Sql,
  log: (m: string) => void = console.log,
  client?: TaifaPay | null,
): Promise<number> {
  const taifa = client ?? (await platformTaifa(sql));
  if (!taifa) return 0;
  const pending = await sql<{ id: string; tenant_id: string; provider_ref: string; amount_kes: number }[]>`
    select * from app_pending_topups()`;
  let credited = 0;
  const mails: Parameters<typeof emailClubReceipt>[1][] = [];
  for (const p of pending) {
    try {
      const raw = await taifa.transaction(p.provider_ref);
      const rec = transactionRecord(raw);
      if (!rec) continue;
      const state = normalStatus(rec.status);
      if (state === 'failed') {
        await withTenant(
          sql,
          p.tenant_id,
          (tx) => tx`update sms_topups set status = 'failed' where id = ${p.id} and status = 'pending'`,
        );
        continue;
      }
      if (state !== 'completed' || Number(rec.amount) !== p.amount_kes) continue;
      credited += await withTenant(sql, p.tenant_id, async (tx) => {
        const code = pick(raw, 'mpesaReceiptNumber', 'MpesaReceiptNumber', 'receiptNumber', 'mpesaReceipt', 'mpesaRef');
        const receipt = typeof code === 'string' && /^[A-Z0-9]{8,12}$/.test(code) ? code : null;
        const [t] = await tx<{ units: number; phone: string; amount_kes: number; invoice_no: string }[]>`
          update sms_topups set status = 'completed', completed_at = now(), receipt_ref = ${receipt}
          where id = ${p.id} and status = 'pending' returning units, phone, amount_kes, invoice_no`;
        if (!t) return 0;
        await tx`insert into sms_ledger (tenant_id, units, kind, ref, amount_kes, note)
                 values (${p.tenant_id}, ${t.units}, 'topup', ${p.id}, ${t.amount_kes}, ${`M-Pesa ${p.provider_ref}`})
                 on conflict do nothing`;
        const [club] = await tx<{ name: string }[]>`select name from tenants where id = ${p.tenant_id}`;
        const [bal] = await tx<{ units: string }[]>`select sum(units) as units from sms_ledger`;
        await tx`insert into sms_messages (tenant_id, phone, body, kind)
                 values (${p.tenant_id}, ${t.phone}, ${`${club?.name}: KES ${t.amount_kes.toLocaleString('en-KE')} received (${t.invoice_no}). ${t.units.toLocaleString('en-KE')} SMS added; balance ${Number(bal?.units ?? 0).toLocaleString('en-KE')} SMS.`}, 'topup')`;
        await tx`insert into audit_log (tenant_id, actor, action, entity, data)
                 values (${p.tenant_id}, 'taifapay', 'sms.topup_completed', ${p.id}, ${tx.json({ units: t.units, amountKes: t.amount_kes } as never)})`;
        mails.push({
          tenantId: p.tenant_id,
          docPath: `/settings/sms/${p.id}`,
          invoiceNo: t.invoice_no,
          amountKes: t.amount_kes,
          what: 'SMS credit',
          detail: `**${t.units.toLocaleString('en-KE')} SMS** were added; your balance is now ${Number(bal?.units ?? 0).toLocaleString('en-KE')} SMS.`,
          mpesa: receipt,
        });
        return 1;
      });
    } catch (e) {
      log(`topup ${p.id}: ${(e as Error).message}`);
    }
  }
  for (const m of mails) await emailClubReceipt(sql, m);
  // Prompts nobody paid within a day are closed.
  for (const t of await sql<{ id: string }[]>`select id from tenants`)
    await withTenant(
      sql,
      t.id,
      (tx) =>
        tx`update sms_topups set status = 'expired' where status = 'pending' and created_at < now() - interval '24 hours'`,
    );
  return credited;
}
