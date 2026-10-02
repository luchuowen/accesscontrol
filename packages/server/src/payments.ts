import { nextPeriod } from '@lango/core';
import type { Sql, Tx } from '@lango/db';
import { withTenant } from '@lango/db';
import { DateTime } from 'luxon';
import { rebuildAccessState } from './access.js';
import { clubNotify } from './sms.js';

export const CHANNELS = ['mpesa', 'card', 'cash', 'bank', 'test'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface IncomingPayment {
  provider: string; // 'taifapay' | 'desk-cash' | 'lab-test' …
  providerTxnId: string;
  amountKes: number;
  accountRef: string | null; // member number as typed by the payer
  phone?: string | null;
  externalRef?: string | null; // our intent id, when the payment came from an STK push we started
  productId?: string | null; // known when the intent carried it
  intentId?: string | null; // marked completed in the same transaction when applied
  channel?: Channel;
  recordedBy?: string | null; // staff user id for desk payments (audited as the actor)
  paidAt: Date;
  raw?: unknown;
}

export type ApplyOutcome =
  | { status: 'applied'; paymentId: string; memberNo: number; product: string; until: string }
  | { status: 'unmatched'; paymentId: string; reason: string }
  | { status: 'duplicate'; paymentId: string };

/**
 * Record a confirmed payment exactly once and, if it matches a member + product, extend entitlements.
 * Matching order (BLUEPRINT §6): explicit product → member_no + exact active product price. Never guesses.
 */
export async function recordPayment(sql: Sql, tenantId: string, p: IncomingPayment): Promise<ApplyOutcome> {
  if (!Number.isSafeInteger(p.amountKes) || p.amountKes <= 0) throw new Error('amount must be a positive integer KES');
  const channel: Channel = p.channel && CHANNELS.includes(p.channel) ? p.channel : 'mpesa';
  return withTenant(sql, tenantId, async (tx) => {
    const ins = await tx<{ id: string }[]>`
      insert into payments (tenant_id, provider, provider_txn_id, amount_kes, account_ref, phone, external_ref, status, raw, paid_at, channel, recorded_by)
      values (${tenantId}, ${p.provider}, ${p.providerTxnId}, ${p.amountKes}, ${p.accountRef}, ${p.phone ?? null},
              ${p.externalRef ?? null}, 'completed', ${tx.json((p.raw ?? null) as never)}, ${p.paidAt}, ${channel}, ${p.recordedBy ?? null})
      on conflict (provider, provider_txn_id) do nothing returning id`;
    const row = ins[0];
    if (!row) {
      const [dup] = await tx<
        { id: string }[]
      >`select id from payments where provider = ${p.provider} and provider_txn_id = ${p.providerTxnId}`;
      return { status: 'duplicate', paymentId: dup?.id ?? '' };
    }
    return applyPayment(tx, tenantId, row.id, p);
  });
}

async function applyPayment(tx: Tx, tenantId: string, paymentId: string, p: IncomingPayment): Promise<ApplyOutcome> {
  const actor = p.recordedBy ?? 'system';
  const unmatched = async (reason: string): Promise<ApplyOutcome> => {
    await tx`update payments set status = 'unmatched' where id = ${paymentId}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${actor}, 'payment.unmatched', ${paymentId}, ${tx.json({ reason, amount: p.amountKes, accountRef: p.accountRef } as never)})`;
    return { status: 'unmatched', paymentId, reason };
  };
  const memberNo = Number.parseInt((p.accountRef ?? '').trim(), 10);
  if (!Number.isSafeInteger(memberNo)) return unmatched(`account reference "${p.accountRef}" is not a member number`);
  // Lock the member: concurrent payments for one member are applied one after the other (each extends the last).
  const [member] = await tx<
    { id: string; status: string }[]
  >`select id, status from members where member_no = ${memberNo} for update`;
  if (!member) return unmatched(`no member ${memberNo}`);
  if (member.status !== 'active') return unmatched(`member ${memberNo} is ${member.status}`);
  const products = p.productId
    ? await tx<Product[]>`select * from products where id = ${p.productId}`
    : await tx<Product[]>`select * from products where active and price_kes = ${p.amountKes} order by created_at`;
  if (products.length !== 1)
    return unmatched(
      products.length
        ? `amount ${p.amountKes} matches ${products.length} products`
        : `no product priced ${p.amountKes}`,
    );
  const product = products[0] as Product;
  if (product.price_kes !== p.amountKes)
    return unmatched(`paid ${p.amountKes}, ${product.name} costs ${product.price_kes}`);

  const [t] = await tx<{ timezone: string; name: string }[]>`select timezone, name from tenants where id = ${tenantId}`;
  const tz = t?.timezone ?? 'Africa/Nairobi';
  const paidAt = DateTime.fromJSDate(p.paidAt, { zone: tz });
  // Each zone renews from its own end date, so a bundle never leaves one service with a gap.
  let until: DateTime | null = null;
  const periods: Record<string, { from: string | null; until: string | null }> = {};
  for (const zone of product.zone_keys) {
    const [cur] = await tx<{ ends: Date | null }[]>`
      select max(ends_at) as ends from entitlements where member_id = ${member.id} and zone_key = ${zone}`;
    const period = nextPeriod(paidAt, cur?.ends ? DateTime.fromJSDate(cur.ends, { zone: tz }) : null, {
      unit: product.duration_unit,
      count: product.duration_count,
    });
    await tx`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source, source_id)
             values (${tenantId}, ${member.id}, ${zone}, ${period.start.toJSDate()}, ${period.end.toJSDate()}, 'payment', ${paymentId})`;
    periods[zone] = { from: period.start.toISO(), until: period.end.toISO() };
    if (!until || period.end > until) until = period.end;
  }
  await tx`update payments set status = 'applied', member_id = ${member.id}, product_id = ${product.id}, applied_at = now() where id = ${paymentId}`;
  if (p.intentId)
    await tx`update payment_intents set status = 'completed', provider_ref = ${p.providerTxnId} where id = ${p.intentId}`;
  await tx`insert into audit_log (tenant_id, actor, action, entity, data)
           values (${tenantId}, ${actor}, 'payment.applied', ${paymentId},
                   ${tx.json({ memberNo, product: product.name, amount: p.amountKes, channel: p.channel ?? 'mpesa', periods } as never)})`;
  await rebuildAccessState(tx, tenantId, member.id);
  const end = until as DateTime;
  const [who] = await tx<
    { phone: string | null; first_name: string }[]
  >`select phone, first_name from members where id = ${member.id}`;
  const notify = await clubNotify(tx, tenantId);
  if (who?.phone && p.provider !== 'seed' && notify.enabled && notify.receipts !== false) {
    const body = `${t?.name}: KES ${p.amountKes.toLocaleString('en-KE')} received for ${product.name}, ${who.first_name}. Access active until ${end.toFormat('d LLL yyyy, HH:mm')}. Member no. ${memberNo}.`;
    await tx`insert into sms_messages (tenant_id, member_id, phone, body, kind, dedupe_key)
             values (${tenantId}, ${member.id}, ${who.phone}, ${body}, 'receipt', ${`receipt:${paymentId}`})
             on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing`;
  }
  return { status: 'applied', paymentId, memberNo, product: product.name, until: end.toFormat('yyyy-MM-dd HH:mm') };
}

interface Product {
  id: string;
  name: string;
  price_kes: number;
  duration_unit: 'day' | 'month';
  duration_count: number;
  zone_keys: string[];
}

/**
 * Missed-payment queue: staff point an unmatched payment (wrong account number, unknown amount) at the right
 * member and plan. The amount must equal the plan's price, so nobody can turn KES 10 into a month. Audited.
 */
export async function assignPayment(
  sql: Sql,
  tenantId: string,
  a: { paymentId: string; memberNo: number; productId: string; actor: string },
): Promise<ApplyOutcome | { status: 'not_found' }> {
  return withTenant(sql, tenantId, async (tx) => {
    const [p] = await tx<
      {
        id: string;
        provider: string;
        provider_txn_id: string;
        amount_kes: number;
        phone: string | null;
        paid_at: Date;
        channel: Channel;
        account_ref: string | null;
      }[]
    >`select id, provider, provider_txn_id, amount_kes, phone, paid_at, channel, account_ref
      from payments where id = ${a.paymentId} and status = 'unmatched' for update`;
    if (!p) return { status: 'not_found' as const };
    await tx`update payments set account_ref = ${String(a.memberNo)} where id = ${p.id}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${a.actor}, 'payment.assigned', ${p.id},
                     ${tx.json({ from: p.account_ref, memberNo: a.memberNo, productId: a.productId } as never)})`;
    return applyPayment(tx, tenantId, p.id, {
      provider: p.provider,
      providerTxnId: p.provider_txn_id,
      amountKes: p.amount_kes,
      accountRef: String(a.memberNo),
      phone: p.phone,
      productId: a.productId,
      channel: p.channel,
      recordedBy: a.actor,
      paidAt: p.paid_at,
    });
  });
}
