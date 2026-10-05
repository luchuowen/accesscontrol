import type { Sql } from '@lango/db';
import { withTenant } from '@lango/db';
import { DateTime } from 'luxon';
import { emailClubReceipt } from './receipts.js';
import { msisdn } from './sms.js';
import { platformTaifa } from './sms-topup.js';
import { initiatedTransactionId, normalStatus, pick, transactionRecord } from './taifapay.js';

/**
 * Lango subscription (3 Oct 2026): NAVAC sets each club's plan; the owner pays NAVAC by M-Pesa prompt to NAVAC's own
 * Payment Gateway account. A confirmed payment moves paid-until on by the cycles paid for. Never charged
 * automatically.
 */
export type Cycle = 'monthly' | 'quarterly' | 'yearly';
export const CYCLE_MONTHS: Record<Cycle, number> = { monthly: 1, quarterly: 3, yearly: 12 };
export const CYCLE_LABEL: Record<Cycle, string> = { monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly' };

export interface ClubPlan {
  plan_name: string;
  fee_kes: number | null;
  cycle: Cycle;
  paid_until: string | null;
  billing_phone: string | null;
  billing_email: string | null;
  /** one-time setup fee NAVAC agreed with the club (null: none) */
  setup_fee_kes: number | null;
  /** the setup fee has been paid */
  setup_paid: boolean;
}

export type BillingState = 'active' | 'due' | 'overdue' | 'unpriced' | 'none';

/** Where the club stands: active, due within 7 days, overdue, or no price agreed yet. */
export function billingState(
  p: ClubPlan | null,
  today = DateTime.now().setZone('Africa/Nairobi').toISODate() ?? '',
): BillingState {
  if (!p) return 'none';
  if (p.fee_kes == null) return 'unpriced';
  if (!p.paid_until || p.paid_until < today) return 'overdue';
  const days = DateTime.fromISO(p.paid_until).diff(DateTime.fromISO(today), 'days').days;
  return days <= 7 ? 'due' : 'active';
}

export async function clubPlan(sql: Sql, tenantId: string): Promise<ClubPlan | null> {
  const [p] = await withTenant(
    sql,
    tenantId,
    (tx) => tx<ClubPlan[]>`
      select plan_name, fee_kes, cycle, to_char(paid_until, 'YYYY-MM-DD') as paid_until, billing_phone, billing_email,
             setup_fee_kes,
             exists (select 1 from subscription_invoices i where i.kind = 'setup' and i.status = 'paid') as setup_paid
      from club_plans`,
  );
  return p ?? null;
}

export type SubResult =
  | { ok: true; invoiceId: string; invoiceNo: string }
  | {
      ok: false;
      reason: 'no-plan' | 'unpriced' | 'phone' | 'cycles' | 'no-platform-taifapay' | 'pending' | 'failed' | 'paid';
    };

/** Send an M-Pesa prompt for N cycles of the club's plan; the period starts where the last one ends. */
export async function startSubscriptionPayment(
  sql: Sql,
  tenantId: string,
  a: { cycles: number; phone: string; actor: string; kind?: 'subscription' | 'setup' },
): Promise<SubResult> {
  const kind = a.kind ?? 'subscription';
  const phone = msisdn(a.phone);
  if (!phone) return { ok: false, reason: 'phone' };
  if (!Number.isInteger(a.cycles) || a.cycles < 1 || a.cycles > 12) return { ok: false, reason: 'cycles' };
  const plan = await clubPlan(sql, tenantId);
  if (!plan) return { ok: false, reason: 'no-plan' };
  if (kind === 'setup' && plan.setup_paid) return { ok: false, reason: 'paid' };
  const price = kind === 'setup' ? plan.setup_fee_kes : plan.fee_kes;
  if (price == null) return { ok: false, reason: 'unpriced' };
  const client = await platformTaifa(sql);
  if (!client) return { ok: false, reason: 'no-platform-taifapay' };
  const today = DateTime.now().setZone('Africa/Nairobi').startOf('day');
  const start =
    plan.paid_until && plan.paid_until >= (today.toISODate() ?? '')
      ? DateTime.fromISO(plan.paid_until).plus({ days: 1 })
      : today;
  const end = start.plus({ months: CYCLE_MONTHS[plan.cycle] * a.cycles }).minus({ days: 1 });
  const cycles = kind === 'setup' ? 1 : a.cycles;
  const amount = price * cycles;
  const created = await withTenant(sql, tenantId, async (tx) => {
    // One prompt at a time per club (double clicks, two people paying at once).
    await tx`select pg_advisory_xact_lock(hashtext(${`sub:${tenantId}`}))`;
    const [open] =
      await tx`select 1 from subscription_invoices where status = 'pending' and created_at > now() - interval '3 minutes'`;
    if (open) return null;
    const [t] = await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`;
    const [row] = await tx<{ id: string; invoice_no: string }[]>`
      insert into subscription_invoices (tenant_id, kind, plan_name, cycles, period_from, period_to, amount_kes, phone, created_by)
      values (${tenantId}, ${kind}, ${kind === 'setup' ? 'Lango setup' : plan.plan_name}, ${cycles},
              ${kind === 'setup' ? null : start.toISODate()}, ${kind === 'setup' ? null : end.toISODate()}, ${amount},
              ${phone}, ${a.actor})
      returning id, invoice_no`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${a.actor}, 'billing.payment_requested', ${row?.id ?? null},
                     ${tx.json({ amount, cycles, kind } as never)})`;
    return { id: row?.id as string, no: row?.invoice_no as string, desc: `Lango ${t?.name ?? ''}`.slice(0, 20).trim() };
  });
  if (!created) return { ok: false, reason: 'pending' };
  let res: unknown;
  try {
    res = await client.stkPush({
      phone,
      amount,
      accountReference: created.no,
      description: created.desc,
      externalId: created.id,
    });
  } catch {
    // The prompt never left: safe to close the invoice.
    await withTenant(
      sql,
      tenantId,
      (tx) => tx`update subscription_invoices set status = 'failed' where id = ${created.id}`,
    );
    return { ok: false, reason: 'failed' };
  }
  // The prompt went out: never mark it failed from here; the poller settles it (or it expires after a day).
  const ref = initiatedTransactionId(res as never);
  try {
    await withTenant(
      sql,
      tenantId,
      (tx) => tx`update subscription_invoices set provider_ref = ${ref} where id = ${created.id}`,
    );
  } catch (e) {
    console.error(`subscription ${created.id}: could not store the gateway reference: ${(e as Error).message}`);
  }
  if (!ref) console.error(`subscription ${created.id}: the gateway returned no transaction reference`);
  return { ok: true, invoiceId: created.id, invoiceNo: created.no };
}

/** Settle pending subscription payments by asking the gateway (webhook nudge and the 60 s poller). Once each. */
export async function reconcileSubscriptions(
  sql: Sql,
  log: (m: string) => void = console.log,
  client?: Awaited<ReturnType<typeof platformTaifa>>,
) {
  const taifa = client ?? (await platformTaifa(sql));
  if (!taifa) return 0;
  await sql`select app_expire_sub_payments()`;
  const pending = await sql<{ id: string; tenant_id: string; provider_ref: string; amount_kes: number }[]>`
    select * from app_pending_sub_payments()`;
  let paid = 0;
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
          (tx) => tx`update subscription_invoices set status = 'failed' where id = ${p.id} and status = 'pending'`,
        );
        continue;
      }
      if (state !== 'completed' || Number(rec.amount) !== p.amount_kes) continue;
      paid += await withTenant(sql, p.tenant_id, async (tx) => {
        const code = pick(raw, 'mpesaReceiptNumber', 'MpesaReceiptNumber', 'receiptNumber', 'mpesaReceipt', 'mpesaRef');
        const receipt = typeof code === 'string' && /^[A-Z0-9]{8,12}$/.test(code) ? code : null;
        const [inv] = await tx<{ phone: string; amount_kes: number; invoice_no: string; kind: string }[]>`
          update subscription_invoices set status = 'paid', paid_at = now(), receipt_ref = ${receipt}
          where id = ${p.id} and status = 'pending' returning phone, amount_kes, invoice_no, kind`;
        if (!inv) return 0;
        const [{ to } = { to: null }] = await tx<{ to: Date | null }[]>`select app_plan_paid(${p.id}) as to`;
        // The partner's share is worked out by the database at the partner's rate today (nothing if none).
        await tx`select app_record_earning(${p.id})`;
        const [club] = await tx<{ name: string }[]>`select name from tenants where id = ${p.tenant_id}`;
        const kes = inv.amount_kes.toLocaleString('en-KE');
        const until = to ? DateTime.fromJSDate(to).toFormat('d LLL yyyy') : null;
        const body =
          inv.kind === 'setup'
            ? `Lango: KES ${kes} received for ${club?.name} setup (${inv.invoice_no}). Thank you.`
            : `Lango: KES ${kes} received for ${club?.name} (${inv.invoice_no}). Subscription paid until ${until}. Thank you.`;
        await tx`insert into sms_messages (tenant_id, phone, body, kind) values (${p.tenant_id}, ${inv.phone}, ${body}, 'system')`;
        await tx`insert into audit_log (tenant_id, actor, action, entity, data)
                 values (${p.tenant_id}, 'taifapay', ${inv.kind === 'setup' ? 'billing.setup_paid' : 'billing.paid'}, ${p.id},
                         ${tx.json({ amount: inv.amount_kes, until } as never)})`;
        mails.push({
          tenantId: p.tenant_id,
          docPath: `/settings/billing/${p.id}`,
          invoiceNo: inv.invoice_no,
          amountKes: inv.amount_kes,
          what: inv.kind === 'setup' ? 'the Lango setup fee' : 'your Lango subscription',
          detail:
            inv.kind === 'setup' ? undefined : until ? `Your subscription is now paid until **${until}**.` : undefined,
          mpesa: receipt,
        });
        return 1;
      });
    } catch (e) {
      log(`subscription ${p.id}: ${(e as Error).message}`);
    }
  }
  // Email receipts go out after the payment is committed, so a mail problem never undoes a payment.
  for (const m of mails) await emailClubReceipt(sql, m);
  return paid;
}
