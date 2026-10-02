'use server';
import { withTenant } from '@lango/db';
import { requirePerm } from '@/lib/session';
import { db } from '@/server/db';

export interface MemberPreview {
  id: string;
  no: number;
  name: string;
  phone: string | null;
  services: { name: string; starts: string; ends: string }[];
  card: boolean;
  sync: 'synced' | 'pending' | 'failed';
  lastVisit: string | null;
  payments: { label: string; at: string; channel: string; kes: number }[];
}

/** What the side drawer shows when a member row is clicked (one round trip, tenant-scoped). */
export async function memberPreview(id: string): Promise<MemberPreview | null> {
  const s = await requirePerm('members.view');
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return withTenant(db(), s.tid, async (tx) => {
    const [m] = await tx<
      { id: string; member_no: number; first_name: string; last_name: string; phone: string | null }[]
    >`
      select id, member_no, first_name, last_name, phone from members where id = ${id}`;
    if (!m) return null;
    const [services, [facts], payments] = await Promise.all([
      tx<{ name: string; starts: Date; ends: Date }[]>`
        select coalesce(sv.name, z.name, e.zone_key) as name, min(e.starts_at) as starts, max(e.ends_at) as ends
        from entitlements e left join services sv on sv.id = e.service_id
        left join (select distinct on (key) key, name from zones order by key) z on z.key = e.zone_key and e.service_id is null
        where e.member_id = ${id} and e.ends_at > now() - interval '60 days'
        group by 1 order by max(e.ends_at) desc`,
      tx<{ card: boolean; sync: string | null; last: Date | null }[]>`
        select exists (select 1 from credentials c where c.member_id = ${id}) as card,
          (select case when bool_or(s.error is not null) then 'failed'
                       when bool_and(s.applied_version is not distinct from s.version) then 'synced' else 'pending' end
             from access_states s where s.member_id = ${id}) as sync,
          (select max(at) from access_events a where a.member_no = ${m.member_no} and a.granted) as last`,
      tx<{ label: string; at: Date; channel: string; kes: number }[]>`
        select coalesce((select string_agg(l.label, ' + ') from payment_lines l where l.payment_id = p.id), 'Payment') as label,
               p.paid_at as at, p.channel, p.amount_kes as kes
        from payments p where p.member_id = ${id} and p.status = 'applied' order by p.paid_at desc limit 3`,
    ]);
    return {
      id: m.id,
      no: m.member_no,
      name: `${m.first_name} ${m.last_name}`.trim(),
      phone: m.phone,
      services: services.map((x) => ({ name: x.name, starts: x.starts.toISOString(), ends: x.ends.toISOString() })),
      card: !!facts?.card,
      sync: (facts?.sync ?? 'synced') as MemberPreview['sync'],
      lastVisit: facts?.last ? facts.last.toISOString() : null,
      payments: payments.map((p) => ({ label: p.label, at: p.at.toISOString(), channel: p.channel, kes: p.kes })),
    };
  });
}
