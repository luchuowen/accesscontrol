import 'server-only';
import type { Tx } from '@lango/db';

/** The plan a member last paid for, if the club still sells it to members (what a renew link renews). */
export async function lastPlan(tx: Tx, memberId: string) {
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
