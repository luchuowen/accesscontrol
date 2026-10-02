import 'server-only';
import { withTenant } from '@lango/db';
import { db } from '@/server/db';

/**
 * Reports, design B "One-page overview" (approved 2 Oct 2026): every figure the owner shares with a partner or an
 * accountant, for one period. Walk-in wristbands (member numbers 11001–11999) are day passes: they count as money and
 * visits, and in the Walk-ins section, never as members.
 */
export interface Reports {
  club: string;
  days: number;
  from: string;
  to: string;
  tz: string;
  money: { total: number; prev: number; mpesa: number; cash: number; n: number };
  daily: { day: string; mpesa: number; cash: number }[];
  services: { name: string; sold: number; mpesa: number; cash: number; total: number }[];
  members: { active: number; activeAtStart: number; joined: number; ended: number; renewed: number };
  activeDaily: { day: string; n: number }[];
  visits: { total: number; prev: number; denied: number; people: number };
  /** Entries by weekday (Mon=0) and hour 05:00–22:00 (18 columns). */
  heat: number[][];
  walkins: { passes: number; kes: number; avg: number; byDay: { day: string; passes: number; kes: number }[] };
}

const WB = 'member_no between 11001 and 11999';
export const HEAT_FROM = 5;
export const HEAT_HOURS = 18;

export async function reports(tenantId: string, days: number): Promise<Reports> {
  return withTenant(db(), tenantId, async (tx) => {
    const [t] = await tx<{ club: string; tz: string; start: Date; prev: Date; from: string; to: string }[]>`
      with z as (select name, coalesce(timezone, 'Africa/Nairobi') as tz from tenants where id = ${tenantId})
      select name as club, tz,
             (((now() at time zone tz)::date - ${days - 1}::int)::timestamp at time zone tz) as start,
             (((now() at time zone tz)::date - ${2 * days - 1}::int)::timestamp at time zone tz) as prev,
             to_char((now() at time zone tz)::date - ${days - 1}::int, 'YYYY-MM-DD') as from,
             to_char((now() at time zone tz)::date, 'YYYY-MM-DD') as to
      from z`;
    const tz = t?.tz ?? 'Africa/Nairobi';
    const start = t?.start ?? new Date(Date.now() - days * 86400_000);
    const prev = t?.prev ?? new Date(start.getTime() - days * 86400_000);
    const series = () =>
      tx`generate_series((now() at time zone ${tz})::date - ${days - 1}::int, (now() at time zone ${tz})::date, '1 day')`;
    const [[money], daily, services, [mem], activeDaily, [vis], heat, walk] = await Promise.all([
      tx<Reports['money'][]>`
        select coalesce(sum(amount_kes) filter (where paid_at >= ${start}), 0)::int as total,
               coalesce(sum(amount_kes) filter (where paid_at < ${start}), 0)::int as prev,
               coalesce(sum(amount_kes) filter (where paid_at >= ${start} and channel <> 'cash'), 0)::int as mpesa,
               coalesce(sum(amount_kes) filter (where paid_at >= ${start} and channel = 'cash'), 0)::int as cash,
               (count(*) filter (where paid_at >= ${start}))::int as n
        from payments where status = 'applied' and paid_at >= ${prev}`,
      tx<Reports['daily']>`
        select to_char(d, 'YYYY-MM-DD') as day,
               coalesce(sum(p.amount_kes) filter (where p.channel <> 'cash'), 0)::int as mpesa,
               coalesce(sum(p.amount_kes) filter (where p.channel = 'cash'), 0)::int as cash
        from ${series()} d
        left join payments p on p.status = 'applied' and p.paid_at >= ${start}
                            and (p.paid_at at time zone ${tz})::date = d::date
        group by d order by d`,
      // By service: payment lines carry the split of a multi-service payment; older payments without lines fall
      // back to their product's name.
      tx<Reports['services']>`
        with l as (
          select coalesce(sv.name, split_part(l.label, ' · ', 1)) as name, l.price_kes as kes, p.channel
          from payment_lines l join payments p on p.id = l.payment_id left join services sv on sv.id = l.service_id
          where p.status = 'applied' and p.paid_at >= ${start}
          union all
          select coalesce(split_part(pr.name, ' · ', 1), 'Other'), p.amount_kes, p.channel
          from payments p left join products pr on pr.id = p.product_id
          where p.status = 'applied' and p.paid_at >= ${start}
            and not exists (select 1 from payment_lines x where x.payment_id = p.id))
        select name, count(*)::int as sold,
               coalesce(sum(kes) filter (where channel <> 'cash'), 0)::int as mpesa,
               coalesce(sum(kes) filter (where channel = 'cash'), 0)::int as cash,
               sum(kes)::int as total
        from l group by name order by total desc`,
      tx<Reports['members'][]>`
        with mm as (select id from members where not (${tx.unsafe(WB)})),
        ended as (
          select distinct e.member_id from entitlements e join mm on mm.id = e.member_id
          where e.ends_at >= ${start} and e.ends_at <= now())
        select
          (select count(distinct e.member_id) from entitlements e join mm on mm.id = e.member_id
            where e.starts_at <= now() and e.ends_at > now())::int as active,
          (select count(distinct e.member_id) from entitlements e join mm on mm.id = e.member_id
            where e.starts_at <= ${start} and e.ends_at > ${start})::int as "activeAtStart",
          (select count(distinct p.member_id) from payments p join mm on mm.id = p.member_id
            where p.status = 'applied' and p.paid_at >= ${start}
              and not exists (select 1 from payments q where q.member_id = p.member_id and q.status = 'applied'
                              and q.paid_at < ${start}))::int as joined,
          (select count(*) from ended)::int as ended,
          (select count(*) from ended where exists (select 1 from entitlements e where e.member_id = ended.member_id
                                                    and e.starts_at <= now() and e.ends_at > now()))::int as renewed`,
      tx<Reports['activeDaily']>`
        select to_char(d, 'YYYY-MM-DD') as day,
               (select count(distinct e.member_id) from entitlements e join members m on m.id = e.member_id
                 where not (m.${tx.unsafe(WB)})
                   and e.starts_at <= least(now(), (d + interval '1 day')::timestamp at time zone ${tz})
                   and e.ends_at > least(now(), (d + interval '1 day')::timestamp at time zone ${tz}))::int as n
        from ${series()} d order by d`,
      tx<Reports['visits'][]>`
        select (count(*) filter (where granted and at >= ${start}))::int as total,
               (count(*) filter (where granted and at < ${start}))::int as prev,
               (count(*) filter (where not granted and at >= ${start}))::int as denied,
               (count(distinct coalesce(member_no::bigint, card_code)) filter (where granted and at >= ${start}))::int as people
        from access_events where at >= ${prev}`,
      tx<{ dow: number; h: number; n: number }[]>`
        select (extract(isodow from at at time zone ${tz})::int - 1) as dow,
               extract(hour from at at time zone ${tz})::int as h, count(*)::int as n
        from access_events where granted and at >= ${start} group by 1, 2`,
      tx<{ day: string; passes: number; kes: number }[]>`
        select to_char(d, 'YYYY-MM-DD') as day, count(p.id)::int as passes, coalesce(sum(p.amount_kes), 0)::int as kes
        from ${series()} d
        left join (select p.* from payments p join members m on m.id = p.member_id
                   where p.status = 'applied' and p.paid_at >= ${start} and m.${tx.unsafe(WB)}) p
          on (p.paid_at at time zone ${tz})::date = d::date
        group by d order by d`,
    ]);
    const grid = Array.from({ length: 7 }, () => Array<number>(HEAT_HOURS).fill(0));
    for (const c of heat) {
      const col = c.h - HEAT_FROM;
      const row = grid[c.dow];
      if (row && col >= 0 && col < HEAT_HOURS) row[col] = c.n;
    }
    const passes = walk.reduce((a, d) => a + d.passes, 0);
    const kes = walk.reduce((a, d) => a + d.kes, 0);
    return {
      club: t?.club ?? '',
      days,
      from: t?.from ?? '',
      to: t?.to ?? '',
      tz,
      money: money ?? { total: 0, prev: 0, mpesa: 0, cash: 0, n: 0 },
      daily,
      services,
      members: mem ?? { active: 0, activeAtStart: 0, joined: 0, ended: 0, renewed: 0 },
      activeDaily,
      visits: vis ?? { total: 0, prev: 0, denied: 0, people: 0 },
      heat: grid,
      walkins: { passes, kes, avg: passes ? Math.round(kes / passes) : 0, byDay: walk },
    };
  });
}
