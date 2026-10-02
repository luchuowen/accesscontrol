import { connect, withTenant } from '@lango/db';
import { tenantTaifa } from './taifapay.js';

/**
 * Ops/lab tool: send a real M-Pesa prompt exactly as the console's "Send prompt to phone" does.
 * Usage: stk <slug> <memberNo> <phone> <amountKes>   (amount must match exactly one active plan)
 */
const [slug, memberNo, phone, amount] = process.argv.slice(2);
const sql = connect(process.env.DATABASE_URL as string, 1);
const [t] = await sql<{ id: string }[]>`select id from tenants where slug = ${slug ?? ''}`;
if (!t) throw new Error('unknown tenant');
const client = await tenantTaifa(sql, t.id);
if (!client) throw new Error('TaifaPay not configured');
const intent = await withTenant(sql, t.id, async (tx) => {
  const [m] = await tx<{ id: string }[]>`select id from members where member_no = ${Number(memberNo)}`;
  const ps = await tx<{ id: string; name: string; price_kes: number }[]>`
    select id, name, price_kes from products where active and price_kes = ${Number(amount)}`;
  if (!m || ps.length !== 1) throw new Error('member not found or amount does not match exactly one plan');
  const p = ps[0] as { id: string; name: string; price_kes: number };
  const [i] = await tx<{ id: string }[]>`
    insert into payment_intents (tenant_id, member_id, product_id, amount_kes, phone, provider, created_by)
    values (${t.id}, ${m.id}, ${p.id}, ${p.price_kes}, ${phone ?? ''}, 'taifapay', 'ops-cli') returning id`;
  return { id: i?.id as string, amount: p.price_kes, name: p.name };
});
const t0 = Date.now();
const res = await client.stkPush({
  phone: phone ?? '',
  amount: intent.amount,
  accountReference: String(memberNo),
  description: intent.name.slice(0, 20),
  externalId: intent.id,
});
const r = res as Record<string, unknown>;
const tx = (r.transaction ?? r.data ?? r) as Record<string, unknown>;
console.log(
  `STK: sent in ${Date.now() - t0} ms; intent ${intent.id}; transaction ${String(tx.id ?? tx.transactionId ?? '?')}; status ${String(tx.status ?? r.status ?? '?')}; keys ${Object.keys(r).join(',')}`,
);
await withTenant(
  sql,
  t.id,
  (q) =>
    q`update payment_intents set provider_ref = ${String(tx.id ?? tx.transactionId ?? '') || null} where id = ${intent.id}`,
);
await sql.end();
