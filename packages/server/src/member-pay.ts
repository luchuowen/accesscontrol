import { type Sql, type Tx, withTenant } from '@lango/db';
import { rateLimit } from './bridge-api.js';
import { initiatedTransactionId, type TaifaPay, tenantTaifa } from './taifapay.js';

export type PromptResult = 'sent' | 'failed' | 'wait' | 'unavailable' | 'invalid';

/**
 * Member self-service payment (portal bill and SMS renew link): one M-Pesa prompt to the member's own phone for up
 * to five of the club's products, one per service. Prices come from the club's products at this moment, never from
 * the caller. Settlement is the normal TaifaPay path (webhook or reconcile), which reads the intent's lines.
 */
export type PromptItem = { productId: string; memberId?: string };

export async function startMemberPrompt(
  sql: Sql,
  tenantId: string,
  memberId: string,
  items: (string | PromptItem)[],
  createdBy: 'member' | 'renew-link',
  client?: TaifaPay,
): Promise<PromptResult> {
  // Each item: a product for the payer, or for a family member who shares the payer's phone at this club.
  const want = items
    .map((x) =>
      typeof x === 'string' ? { productId: x, memberId } : { productId: x.productId, memberId: x.memberId ?? memberId },
    )
    .filter((x) => /^[0-9a-f-]{36}$/.test(x.productId) && /^[0-9a-f-]{36}$/.test(x.memberId));
  const keys = new Set(want.map((x) => `${x.memberId}:${x.productId}`));
  if (!want.length || want.length > 8 || keys.size !== want.length) return 'invalid';
  const taifa = client ?? (await tenantTaifa(sql, tenantId));
  if (!taifa) return 'unavailable';
  const intent = await withTenant(sql, tenantId, async (tx) => {
    const [m] = await tx<
      { member_no: number; phone: string }[]
    >`select member_no, phone from members where id = ${memberId} and status = 'active' and phone is not null`;
    if (!m) return null;
    const people = [...new Set(want.map((x) => x.memberId))];
    const family = await tx<{ id: string }[]>`
      select id from members where id = any(${people}) and status = 'active'
        and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(regexp_replace(${m.phone}, '\D', '', 'g'), 9)`;
    if (family.length !== people.length) return null;
    const ids = [...new Set(want.map((x) => x.productId))];
    const ps = await tx<{ id: string; price_kes: number; name: string; service_id: string | null }[]>`
      select id, price_kes, name, service_id from products where id = any(${ids}) and active
        and (products.service_id is null or exists (select 1 from services sv where sv.id = products.service_id
             and sv.active and sv.deleted_at is null and sv.sold_to <> 'walkins'))`;
    if (ps.length !== ids.length) return null;
    const rows = want.map((x) => ({ ...x, p: ps.find((p) => p.id === x.productId) as (typeof ps)[number] }));
    // One price per service per person.
    const per = rows.map((r) => `${r.memberId}:${r.p.service_id ?? r.p.id}`);
    if (new Set(per).size !== per.length) return null;
    // Only a valid bill counts towards the limit of 3 prompts in 5 minutes.
    if (!rateLimit(`member-pay:${memberId}`, 3, 5 * 60_000)) return 'wait' as const;
    const amount = rows.reduce((a, r) => a + r.p.price_kes, 0);
    const forOthers = rows.some((r) => r.memberId !== memberId);
    const lines = rows.map((r) => ({
      productId: r.p.id,
      priceKes: r.p.price_kes,
      ...(forOthers ? { memberId: r.memberId } : {}),
    }));
    const first = rows[0]?.p as (typeof ps)[number];
    const [i] = await tx<
      { id: string }[]
    >`insert into payment_intents (tenant_id, member_id, product_id, amount_kes, phone, provider, created_by, lines)
      values (${tenantId}, ${memberId}, ${first.id}, ${amount}, ${m.phone}, 'taifapay', ${createdBy},
              ${rows.length > 1 || forOthers ? tx.json(lines as never) : null}) returning id`;
    const name = rows.length > 1 ? `${rows.length} services` : first.name;
    return { id: i?.id as string, amount, ref: String(m.member_no), phone: m.phone, name };
  });
  if (!intent) return 'invalid';
  if (intent === 'wait') return 'wait';
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
