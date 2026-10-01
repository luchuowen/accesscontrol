import { nextPeriod } from '@lango/core';
import type { Sql, Tx } from '@lango/db';
import { withTenant } from '@lango/db';
import { DateTime } from 'luxon';
import { rebuildAccessState } from './access.js';

export interface IncomingPayment {
  provider: string; // 'taifapay' | 'manual-test' | …
  providerTxnId: string;
  amountKes: number;
  accountRef: string | null; // member number as typed by the payer
  phone?: string | null;
  externalRef?: string | null; // our intent id, when the payment came from an STK push we started
  productId?: string | null; // known when the intent carried it
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
  return withTenant(sql, tenantId, async (tx) => {
    const ins = await tx<{ id: string }[]>`
      insert into payments (tenant_id, provider, provider_txn_id, amount_kes, account_ref, phone, external_ref, status, raw, paid_at)
      values (${tenantId}, ${p.provider}, ${p.providerTxnId}, ${p.amountKes}, ${p.accountRef}, ${p.phone ?? null},
              ${p.externalRef ?? null}, 'completed', ${tx.json((p.raw ?? null) as never)}, ${p.paidAt})
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
  const unmatched = async (reason: string): Promise<ApplyOutcome> => {
    await tx`update payments set status = 'unmatched' where id = ${paymentId}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, 'system', 'payment.unmatched', ${paymentId}, ${tx.json({ reason, amount: p.amountKes, accountRef: p.accountRef } as never)})`;
    return { status: 'unmatched', paymentId, reason };
  };
  const memberNo = Number.parseInt((p.accountRef ?? '').trim(), 10);
  if (!Number.isSafeInteger(memberNo)) return unmatched(`account reference "${p.accountRef}" is not a member number`);
  const [member] = await tx<
    { id: string; status: string }[]
  >`select id, status from members where member_no = ${memberNo}`;
  if (!member) return unmatched(`no member ${memberNo}`);
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

  const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${tenantId}`;
  const tz = t?.timezone ?? 'Africa/Nairobi';
  const paidAt = DateTime.fromJSDate(p.paidAt, { zone: tz });
  const [cur] = await tx<{ ends: Date | null }[]>`
    select max(ends_at) as ends from entitlements where member_id = ${member.id} and zone_key = any(${product.zone_keys})`;
  const period = nextPeriod(paidAt, cur?.ends ? DateTime.fromJSDate(cur.ends, { zone: tz }) : null, {
    unit: product.duration_unit,
    count: product.duration_count,
  });
  for (const zone of product.zone_keys) {
    await tx`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source, source_id)
             values (${tenantId}, ${member.id}, ${zone}, ${period.start.toJSDate()}, ${period.end.toJSDate()}, 'payment', ${paymentId})`;
  }
  await tx`update payments set status = 'applied', member_id = ${member.id}, product_id = ${product.id}, applied_at = now() where id = ${paymentId}`;
  await tx`insert into audit_log (tenant_id, actor, action, entity, data)
           values (${tenantId}, 'system', 'payment.applied', ${paymentId},
                   ${tx.json({ memberNo, product: product.name, from: period.start.toISO(), until: period.end.toISO() } as never)})`;
  await rebuildAccessState(tx, tenantId, member.id);
  return {
    status: 'applied',
    paymentId,
    memberNo,
    product: product.name,
    until: period.end.toFormat('yyyy-MM-dd HH:mm'),
  };
}

interface Product {
  id: string;
  name: string;
  price_kes: number;
  duration_unit: 'day' | 'month';
  duration_count: number;
  zone_keys: string[];
}
