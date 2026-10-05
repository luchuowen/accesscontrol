import { type Sql, type Tx, withTenant } from '@lango/db';
import { rateLimit } from './bridge-api.js';
import { initiatedTransactionId, type TaifaPay, tenantTaifa } from './taifapay.js';

export type PromptResult = 'sent' | 'failed' | 'wait' | 'unavailable' | 'invalid';

/**
 * Member self-service payment (portal bill and SMS renew link): one M-Pesa prompt to the member's own phone for up
 * to five of the club's products, one per service. Prices come from the club's products at this moment, never from
 * the caller. Settlement is the normal TaifaPay path (webhook or reconcile), which reads the intent's lines.
 */
export async function startMemberPrompt(
  sql: Sql,
  tenantId: string,
  memberId: string,
  productIds: string[],
  createdBy: 'member' | 'renew-link',
  client?: TaifaPay,
): Promise<PromptResult> {
  const ids = [...new Set(productIds)].filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!ids.length || ids.length > 5) return 'invalid';
  if (!rateLimit(`member-pay:${memberId}`, 3, 5 * 60_000)) return 'wait';
  const taifa = client ?? (await tenantTaifa(sql, tenantId));
  if (!taifa) return 'unavailable';
  const intent = await withTenant(sql, tenantId, async (tx) => {
    const [m] = await tx<
      { member_no: number; phone: string }[]
    >`select member_no, phone from members where id = ${memberId} and status = 'active' and phone is not null`;
    const ps = await tx<{ id: string; price_kes: number; name: string; service_id: string | null }[]>`
      select id, price_kes, name, service_id from products where id = any(${ids}) and active
        and (products.service_id is null or exists (select 1 from services sv where sv.id = products.service_id
             and sv.active and sv.deleted_at is null and sv.sold_to <> 'walkins'))`;
    if (!m || ps.length !== ids.length) return null;
    const services = ps.map((p) => p.service_id ?? p.id);
    if (new Set(services).size !== services.length) return null;
    const ordered = ids.map((id) => ps.find((p) => p.id === id) as (typeof ps)[number]);
    const amount = ordered.reduce((a, p) => a + p.price_kes, 0);
    const lines = ordered.map((p) => ({ productId: p.id, priceKes: p.price_kes }));
    const first = ordered[0] as (typeof ps)[number];
    const [i] = await tx<
      { id: string }[]
    >`insert into payment_intents (tenant_id, member_id, product_id, amount_kes, phone, provider, created_by, lines)
      values (${tenantId}, ${memberId}, ${first.id}, ${amount}, ${m.phone}, 'taifapay', ${createdBy},
              ${ordered.length > 1 ? tx.json(lines as never) : null}) returning id`;
    const name = ordered.length > 1 ? `${ordered.length} services` : first.name;
    return { id: i?.id as string, amount, ref: String(m.member_no), phone: m.phone, name };
  });
  if (!intent) return 'invalid';
  try {
    const res = await taifa.stkPush({
      phone: intent.phone,
      amount: intent.amount,
      accountReference: intent.ref,
      description: intent.name.slice(0, 20),
      externalId: intent.id,
    });
    const ref = initiatedTransactionId(res);
    if (ref)
      await withTenant(
        sql,
        tenantId,
        (tx) => tx`update payment_intents set provider_ref = ${ref} where id = ${intent.id}`,
      );
    return 'sent';
  } catch (err) {
    console.error('stk push failed', err instanceof Error ? err.message : err);
    await withTenant(sql, tenantId, (tx) => tx`update payment_intents set status = 'failed' where id = ${intent.id}`);
    return 'failed';
  }
}

/** The plan a member last paid for, if the club still sells it to members (what a renew link renews). */
export async function memberLastPlan(tx: Tx, memberId: string) {
  const [p] = await tx<{ id: string; name: string; price_kes: number; ends: Date | null }[]>`
    select pr.id, pr.name, pr.price_kes,
      (select max(e.ends_at) from entitlements e where e.member_id = p.member_id and e.service_id = pr.service_id
         and e.ends_at > now()) as ends
    from payments p
    left join payment_lines l on l.payment_id = p.id
    join products pr on pr.id = coalesce(l.product_id, p.product_id)
    left join services s on s.id = pr.service_id
    where p.member_id = ${memberId} and p.status = 'applied' and pr.active
      and coalesce(s.sold_to, 'both') <> 'walkins' and coalesce(s.active and s.deleted_at is null, true)
    order by p.paid_at desc, pr.price_kes desc limit 1`;
  return p ?? null;
}
