import { type DurationUnit, nextPeriod } from '@lango/core';
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
  expectedKes?: number | null; // the price on the intent when it was sent (a later price change never strands it)
  lines?: { productId: string; priceKes: number }[] | null; // several services in one payment (prices at sale time)
  intentId?: string | null; // marked completed in the same transaction when applied
  dayPassId?: string | null; // walk-in visit to mark active once paid
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
 * Matching order: explicit lines or price (prompt, desk, walk-in) → member_no + the member's usual price at this
 * amount → the club's only price at this amount. Anything ambiguous is held for staff. Never guesses.
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
    // The payer gets one reassurance so they do not pay twice; staff assign it from Payments (a receipt follows).
    const n = await clubNotify(tx, tenantId);
    if (p.phone && p.provider === 'taifapay' && n.enabled && n.unmatched !== false) {
      const [club] = await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`;
      const body = `${club?.name}: we've received your KES ${p.amountKes.toLocaleString('en-KE')} payment and are matching it to your membership. No need to pay again; we'll confirm by SMS.`;
      await tx`insert into sms_messages (tenant_id, phone, body, kind, dedupe_key)
               values (${tenantId}, ${p.phone}, ${body}, 'unmatched', ${`unmatched:${paymentId}`})
               on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing`;
    }
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
  // What was bought: explicit lines (prompt / desk / walk-in) → one known price → the member's usual price at this
  // amount → the only price at this amount in the club. Anything else is held for staff, never guessed.
  let sold: { product: Product; price: number }[] = [];
  if (p.lines?.length) {
    const ids = p.lines.map((l) => l.productId);
    const rows = await tx<Product[]>`select * from products where id = any(${ids})`;
    sold = p.lines.map((l) => ({ product: rows.find((r) => r.id === l.productId) as Product, price: l.priceKes }));
    if (sold.some((x) => !x.product)) return unmatched('a sold price no longer exists');
    const total = sold.reduce((a, x) => a + x.price, 0);
    if (total !== p.amountKes) return unmatched(`paid ${p.amountKes}, the items total ${total}`);
  } else if (p.productId) {
    const [product] = await tx<Product[]>`select * from products where id = ${p.productId}`;
    if (!product) return unmatched('that price no longer exists');
    const price = p.expectedKes ?? product.price_kes;
    if (p.amountKes !== price) return unmatched(`paid ${p.amountKes}, ${product.name} costs ${price}`);
    sold = [{ product, price }];
  } else {
    const [usual] = await tx<Product[]>`
      select pr.* from payment_lines l join payments pm on pm.id = l.payment_id join products pr on pr.id = l.product_id
      where pm.member_id = ${member.id} and pm.status = 'applied' and pr.active and pr.price_kes = ${p.amountKes}
      order by pm.paid_at desc limit 1`;
    let pick = usual;
    if (!pick) {
      const same = await tx<
        Product[]
      >`select * from products where active and price_kes = ${p.amountKes} order by created_at`;
      if (same.length === 1) pick = same[0];
      else if (same.length > 1) {
        const had = await tx<{ service_id: string }[]>`
          select distinct service_id from entitlements where member_id = ${member.id} and service_id is not null`;
        const mine = same.filter((x) => had.some((h) => h.service_id === x.service_id));
        if (mine.length === 1) pick = mine[0];
        else
          return unmatched(`KES ${p.amountKes.toLocaleString('en-KE')} matches ${same.length} prices; staff to choose`);
      }
    }
    if (!pick) return unmatched(`no price of KES ${p.amountKes.toLocaleString('en-KE')}`);
    sold = [{ product: pick, price: p.amountKes }];
  }

  const [t] = await tx<{ timezone: string; name: string }[]>`select timezone, name from tenants where id = ${tenantId}`;
  const tz = t?.timezone ?? 'Africa/Nairobi';
  const paidAt = DateTime.fromJSDate(p.paidAt, { zone: tz });
  // Walk-in wristbands (11001–11999) belong to a new visitor each time: never extend the last visitor's pass.
  const band = memberNo >= 11001 && memberNo <= 11999;
  let until: DateTime | null = null;
  const periods: Record<string, { from: string | null; until: string | null }> = {};
  for (const { product, price } of sold) {
    // Paying early extends the same service from its end; other services run side by side on their own clocks.
    const [cur] = band
      ? [{ ends: null }]
      : await tx<{ ends: Date | null }[]>`
          select max(ends_at) as ends from entitlements where member_id = ${member.id}
            and (service_id = ${product.service_id} or (service_id is null and zone_key = any(${product.zone_keys})))`;
    const period = nextPeriod(paidAt, cur?.ends ? DateTime.fromJSDate(cur.ends, { zone: tz }) : null, {
      unit: product.duration_unit,
      count: product.duration_count,
    });
    for (const zone of product.zone_keys)
      await tx`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source, source_id, service_id, product_id)
               values (${tenantId}, ${member.id}, ${zone}, ${period.start.toJSDate()}, ${period.end.toJSDate()}, 'payment', ${paymentId},
                       ${product.service_id}, ${product.id})`;
    await tx`insert into payment_lines (tenant_id, payment_id, product_id, service_id, label, zone_keys, price_kes, duration_unit, duration_count, starts_at, ends_at)
             values (${tenantId}, ${paymentId}, ${product.id}, ${product.service_id}, ${product.name}, ${product.zone_keys}, ${price},
                     ${product.duration_unit}, ${product.duration_count}, ${period.start.toJSDate()}, ${period.end.toJSDate()})`;
    periods[product.name] = { from: period.start.toISO(), until: period.end.toISO() };
    if (!until || period.end > until) until = period.end;
  }
  const label = sold.map((x) => x.product.name).join(' + ');
  const first = sold[0]?.product as Product;
  await tx`update payments set status = 'applied', member_id = ${member.id}, product_id = ${first.id}, applied_at = now() where id = ${paymentId}`;
  if (p.intentId)
    await tx`update payment_intents set status = 'completed', provider_ref = ${p.providerTxnId} where id = ${p.intentId}`;
  const end = until as DateTime;
  // A walk-in's band opens only now that the money is in (cash: the desk sale; M-Pesa: the visit's prompt).
  if (p.dayPassId || p.intentId)
    await tx`update day_passes set status = 'active', payment_id = ${paymentId}, ends_at = ${end.toJSDate()}
             where status = 'awaiting_payment' and (id = ${p.dayPassId ?? null} or intent_id = ${p.intentId ?? null})`;
  await tx`insert into audit_log (tenant_id, actor, action, entity, data)
           values (${tenantId}, ${actor}, 'payment.applied', ${paymentId},
                   ${tx.json({ memberNo, product: label, amount: p.amountKes, channel: p.channel ?? 'mpesa', periods } as never)})`;
  await rebuildAccessState(tx, tenantId, member.id);
  const [who] = await tx<
    { phone: string | null; first_name: string }[]
  >`select phone, first_name from members where id = ${member.id}`;
  const notify = await clubNotify(tx, tenantId);
  if (who?.phone && !band && p.provider !== 'seed' && notify.enabled && notify.receipts !== false) {
    const body = `${t?.name}: KES ${p.amountKes.toLocaleString('en-KE')} received for ${label}, ${who.first_name}. Access active until ${end.toFormat('d LLL yyyy, HH:mm')}. Member no. ${memberNo}.`;
    await tx`insert into sms_messages (tenant_id, member_id, phone, body, kind, dedupe_key)
             values (${tenantId}, ${member.id}, ${who.phone}, ${body}, 'receipt', ${`receipt:${paymentId}`})
             on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing`;
  }
  return { status: 'applied', paymentId, memberNo, product: label, until: end.toFormat('yyyy-MM-dd HH:mm') };
}

interface Product {
  id: string;
  name: string;
  price_kes: number;
  duration_unit: DurationUnit;
  duration_count: number;
  zone_keys: string[];
  service_id: string | null;
}

/**
 * Missed-payment queue: staff point an unmatched payment (wrong account number, unknown amount) at the right
 * member and price. The amount must equal the price, so nobody can turn KES 10 into a month. Audited.
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
