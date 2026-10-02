import 'server-only';
import { withTenant } from '@lango/db';
import { db } from '@/server/db';

const T = <R>(tenantId: string, fn: Parameters<typeof withTenant<R>>[2]) => withTenant<R>(db(), tenantId, fn);

export interface Dashboard {
  tenantName: string;
  revenue: { today: number; week: number; month: number; prevMonth: number };
  daily: { day: string; amount: number }[];
  activeMembers: number;
  newThisMonth: number;
  renewalsThisMonth: number;
  expiringSoon: { id: string; memberNo: number; name: string; phone: string | null; endsAt: Date }[];
  visitsToday: number;
  hourly: number[]; // 24 buckets, last 30 days
  zoneVisits: { zone: string; n: number }[];
  unmatched: number;
  bridge: { lastSeen: Date | null; pending: number; failed: number };
  recent: { at: Date; memberNo: number | null; name: string | null; zone: string | null; granted: boolean }[];
}

export async function dashboard(tenantId: string): Promise<Dashboard> {
  return T(tenantId, async (tx) => {
    const [t] = await tx<
      { name: string; timezone: string }[]
    >`select name, timezone from tenants where id = ${tenantId}`;
    const tz = t?.timezone ?? 'Africa/Nairobi';
    const [rev] = await tx<{ today: number; week: number; month: number; prev: number }[]>`
      select coalesce(sum(amount_kes) filter (where paid_at >= date_trunc('day', now() at time zone ${tz}) at time zone ${tz}), 0)::int as today,
             coalesce(sum(amount_kes) filter (where paid_at >= now() - interval '7 days'), 0)::int as week,
             coalesce(sum(amount_kes) filter (where paid_at >= now() - interval '30 days'), 0)::int as month,
             coalesce(sum(amount_kes) filter (where paid_at >= now() - interval '60 days' and paid_at < now() - interval '30 days'), 0)::int as prev
      from payments where status = 'applied'`;
    const daily = await tx<{ day: string; amount: number }[]>`
      select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(p.amount_kes), 0)::int as amount
      from generate_series((now() at time zone ${tz})::date - 29, (now() at time zone ${tz})::date, '1 day') d
      left join payments p on p.status = 'applied' and (p.paid_at at time zone ${tz})::date = d
      group by d order by d`;
    const [act] = await tx<
      { n: number }[]
    >`select count(distinct member_id)::int as n from entitlements where now() between starts_at and ends_at`;
    const [mix] = await tx<{ fresh: number; renew: number }[]>`
      with firsts as (select member_id, min(paid_at) as first from payments where status = 'applied' group by member_id)
      select count(*) filter (where p.paid_at = f.first)::int as fresh, count(*) filter (where p.paid_at > f.first)::int as renew
      from payments p join firsts f using (member_id) where p.status = 'applied' and p.paid_at >= now() - interval '30 days'`;
    const expiring = await tx<
      { id: string; member_no: number; first_name: string; last_name: string; phone: string | null; ends: Date }[]
    >`
      select m.id, m.member_no, m.first_name, m.last_name, m.phone, max(e.ends_at) as ends
      from members m join entitlements e on e.member_id = m.id
      where m.first_name <> 'Wristband' group by m.id having max(e.ends_at) between now() and now() + interval '7 days'
      order by ends limit 8`;
    const [vt] = await tx<{ n: number }[]>`
      select count(*)::int as n from access_events where granted and at >= date_trunc('day', now() at time zone ${tz}) at time zone ${tz}`;
    const hours = await tx<{ h: number; n: number }[]>`
      select extract(hour from at at time zone ${tz})::int as h, count(*)::int as n from access_events
      where granted and at >= now() - interval '30 days' group by 1`;
    const zv = await tx<{ zone: string; n: number }[]>`
      select coalesce(z.name, 'Door ' || e.reader_id) as zone, count(*)::int as n from access_events e
      left join zones z on e.reader_id = any(z.reader_ids) and z.site_id = e.site_id
      where e.granted and e.at >= now() - interval '30 days' group by 1 order by 2 desc`;
    const [um] = await tx<{ n: number }[]>`select count(*)::int as n from payments where status = 'unmatched'`;
    const [st] = await tx<{ pending: number; failed: number }[]>`
      select count(*) filter (where applied_version is distinct from version and error is null)::int as pending,
             count(*) filter (where error is not null)::int as failed from access_states`;
    const [br] = await tx<{ last: Date | null }[]>`select max(last_seen_at) as last from app_tenant_bridges()`;
    const recent = await tx<
      {
        at: Date;
        member_no: number | null;
        first_name: string | null;
        last_name: string | null;
        zone: string | null;
        granted: boolean;
      }[]
    >`
      select e.at, e.member_no, m.first_name, m.last_name, z.name as zone, e.granted from access_events e
      left join members m on m.member_no = e.member_no
      left join zones z on e.reader_id = any(z.reader_ids) and z.site_id = e.site_id
      order by e.at desc limit 8`;
    const hourly = Array.from({ length: 24 }, (_, h) => hours.find((x) => x.h === h)?.n ?? 0);
    return {
      tenantName: t?.name ?? '',
      revenue: { today: rev?.today ?? 0, week: rev?.week ?? 0, month: rev?.month ?? 0, prevMonth: rev?.prev ?? 0 },
      daily,
      activeMembers: act?.n ?? 0,
      newThisMonth: mix?.fresh ?? 0,
      renewalsThisMonth: mix?.renew ?? 0,
      expiringSoon: expiring.map((x) => ({
        id: x.id,
        memberNo: x.member_no,
        name: `${x.first_name} ${x.last_name}`,
        phone: x.phone,
        endsAt: x.ends,
      })),
      visitsToday: vt?.n ?? 0,
      hourly,
      zoneVisits: zv,
      unmatched: um?.n ?? 0,
      bridge: { lastSeen: br?.last ?? null, pending: st?.pending ?? 0, failed: st?.failed ?? 0 },
      recent: recent.map((r) => ({
        at: r.at,
        memberNo: r.member_no,
        name: r.first_name ? `${r.first_name} ${r.last_name}` : null,
        zone: r.zone,
        granted: r.granted,
      })),
    };
  });
}

export interface MemberRow {
  id: string;
  memberNo: number;
  name: string;
  phone: string | null;
  status: string;
  activeUntil: Date | null;
  zones: string[];
  synced: boolean;
}

export async function members(tenantId: string, q = ''): Promise<MemberRow[]> {
  return T(tenantId, async (tx) => {
    const like = `%${q.trim().toLowerCase()}%`;
    const rows = await tx<
      {
        id: string;
        member_no: number;
        first_name: string;
        last_name: string;
        phone: string | null;
        status: string;
        until: Date | null;
        zones: string[] | null;
        synced: boolean;
      }[]
    >`
      select m.id, m.member_no, m.first_name, m.last_name, m.phone, m.status,
             (select max(ends_at) from entitlements e where e.member_id = m.id) as until,
             (select array_agg(distinct zone_key) from entitlements e where e.member_id = m.id and now() between starts_at and ends_at) as zones,
             coalesce((select bool_and(applied_version is not distinct from version) from access_states s where s.member_id = m.id), true) as synced
      from members m
      where ${q} = '' or lower(m.first_name || ' ' || m.last_name) like ${like} or m.member_no::text like ${like} or coalesce(m.phone, '') like ${like}
      order by m.member_no limit 300`;
    return rows.map((r) => ({
      id: r.id,
      memberNo: r.member_no,
      name: `${r.first_name} ${r.last_name}`,
      phone: r.phone,
      status: r.status,
      activeUntil: r.until,
      zones: r.zones ?? [],
      synced: r.synced,
    }));
  });
}

export async function member(tenantId: string, id: string) {
  return T(tenantId, async (tx) => {
    const [m] = await tx<
      {
        id: string;
        member_no: number;
        first_name: string;
        last_name: string;
        phone: string | null;
        email: string | null;
        status: string;
        created_at: Date;
      }[]
    >`
      select id, member_no, first_name, last_name, phone, email, status, created_at from members where id = ${id}`;
    if (!m) return null;
    const creds = await tx<
      { id: string; kind: string; site_code: number; card_code: bigint }[]
    >`select id, kind, site_code, card_code from credentials where member_id = ${id}`;
    const ents = await tx<{ zone_key: string; starts_at: Date; ends_at: Date; source: string }[]>`
      select zone_key, starts_at, ends_at, source from entitlements where member_id = ${id} order by ends_at desc limit 30`;
    const pays = await tx<
      {
        id: string;
        amount_kes: number;
        paid_at: Date;
        status: string;
        channel: string;
        product: string | null;
        provider_txn_id: string;
      }[]
    >`
      select p.id, p.amount_kes, p.paid_at, p.status, p.channel, pr.name as product, p.provider_txn_id
      from payments p left join products pr on pr.id = p.product_id where p.member_id = ${id} or p.account_ref = ${String(m.member_no)}
      order by p.paid_at desc limit 30`;
    const visits = await tx<{ at: Date; zone: string | null; granted: boolean }[]>`
      select e.at, z.name as zone, e.granted from access_events e
      left join zones z on e.reader_id = any(z.reader_ids) and z.site_id = e.site_id
      where e.member_no = ${m.member_no} order by e.at desc limit 20`;
    const sync = await tx<
      { version: number; applied_version: number | null; applied_at: Date | null; error: string | null }[]
    >`
      select version, applied_version, applied_at, error from access_states where member_id = ${id}`;
    return { m, creds, ents, pays, visits, sync };
  });
}

export async function products(tenantId: string) {
  return T(
    tenantId,
    (tx) => tx<
      {
        id: string;
        kind: string;
        name: string;
        price_kes: number;
        duration_unit: string;
        duration_count: number;
        zone_keys: string[];
        active: boolean;
        sold: number;
      }[]
    >`
    select p.*, (select count(*)::int from payments x where x.product_id = p.id and x.status = 'applied') as sold
    from products p order by p.active desc, p.price_kes`,
  );
}

export async function payments(tenantId: string) {
  return T(
    tenantId,
    (tx) => tx<
      {
        id: string;
        paid_at: Date;
        amount_kes: number;
        status: string;
        channel: string;
        provider: string;
        provider_txn_id: string;
        account_ref: string | null;
        member_id: string | null;
        member: string | null;
        product: string | null;
        recorded_by: string | null;
      }[]
    >`
    select p.id, p.paid_at, p.amount_kes, p.status, p.channel, p.provider, p.provider_txn_id, p.account_ref, p.member_id,
           m.first_name || ' ' || m.last_name as member, pr.name as product, st.name as recorded_by
    from payments p left join members m on m.id = p.member_id left join products pr on pr.id = p.product_id
    left join app_staff_names() st on st.id::text = p.recorded_by
    order by p.paid_at desc limit 200`,
  );
}

export async function accessOverview(tenantId: string) {
  return T(tenantId, async (tx) => {
    const sites = await tx<{ id: string; name: string }[]>`select id, name from sites order by name`;
    const zones = await tx<
      { id: string; site_id: string; key: string; name: string; reader_ids: number[] }[]
    >`select * from zones order by name`;
    const bridges = await tx<
      { id: string; site_id: string; pair_code: string | null; last_seen_at: Date | null; adapter: string }[]
    >`select * from app_tenant_bridges()`;
    const [st] = await tx<{ total: number; synced: number; failed: number }[]>`
      select count(*)::int as total, count(*) filter (where applied_version = version)::int as synced, count(*) filter (where error is not null)::int as failed from access_states`;
    const events = await tx<
      {
        at: Date;
        member_no: number | null;
        name: string | null;
        zone: string | null;
        reader_id: number;
        granted: boolean;
      }[]
    >`
      select e.at, e.member_no, m.first_name || ' ' || m.last_name as name, z.name as zone, e.reader_id, e.granted from access_events e
      left join members m on m.member_no = e.member_no
      left join zones z on e.reader_id = any(z.reader_ids) and z.site_id = e.site_id
      order by e.at desc limit 40`;
    // Changes someone made directly in AxTraxNG that the Site Bridge undid (Tamper Guard), last 30 days.
    const tamper = await tx<{ at: Date; member_no: string; name: string | null; changes: string[] }[]>`
      select a.at, a.entity as member_no, m.first_name || ' ' || m.last_name as name,
             coalesce(array(select jsonb_array_elements_text(a.data->'changes')), '{}') as changes
      from audit_log a left join members m on m.member_no::text = a.entity
      where a.action = 'access.tamper_reverted' and a.at > now() - interval '30 days'
      order by a.at desc limit 20`;
    return { sites, zones, bridges, stats: st, events, tamper };
  });
}

/** Payments waiting for a person: wrong account number, unknown amount, inactive member. */
export async function unmatchedPayments(tenantId: string) {
  return T(
    tenantId,
    (tx) => tx<
      {
        id: string;
        paid_at: Date;
        amount_kes: number;
        account_ref: string | null;
        phone: string | null;
        provider_txn_id: string;
        reason: string | null;
      }[]
    >`
    select p.id, p.paid_at, p.amount_kes, p.account_ref, p.phone, p.provider_txn_id,
           (select a.data->>'reason' from audit_log a where a.action = 'payment.unmatched' and a.entity = p.id::text
             order by a.at desc limit 1) as reason
    from payments p where p.status = 'unmatched' order by p.paid_at desc limit 100`,
  );
}

/** The owner dashboard (design B, "Business health", approved 2 Oct 2026). One period: 7, 30 or 90 days. */
export interface OwnerDashboard {
  tenantName: string;
  timezone: string;
  days: number;
  live: { inside: number; busiestHour: number | null; todayByHour: number[] };
  revenue: { now: number; prev: number; mpesa: number; cash: number; spark: number[] };
  daily: { day: string; mpesa: number; cash: number }[];
  members: { active: number; joined: number; lapsed: number; spark: number[] };
  renewals: { ended: number; renewed: number; lapsed: number };
  endingSoon: { id: string; memberNo: number; name: string; endsAt: Date }[];
  /** Members whose plan ends in the next 7 days, and what they would pay at their last plan's current price. */
  ending7: { count: number; expectedKes: number };
  /** Money in by plan for the period, biggest first (top 4). */
  plans: { name: string; kes: number }[];
  atRisk: { id: string; memberNo: number; name: string; daysAway: number }[];
  atRiskTotal: number;
  attention: {
    unmatched: number;
    unmatchedKes: number;
    bridgeLastSeen: Date | null;
    syncFailed: number;
    smsUnits: number;
  };
}

export async function ownerDashboard(tenantId: string, days: number): Promise<OwnerDashboard> {
  return T(tenantId, async (tx) => {
    const [t] = await tx<
      { name: string; timezone: string }[]
    >`select name, timezone from tenants where id = ${tenantId}`;
    const tz = t?.timezone ?? 'Africa/Nairobi';
    const span = `${days} days`;
    const span2 = `${days * 2} days`;
    // In the club now: doors record entries only, so "inside" = distinct members who entered in the last 90 minutes.
    const [inside] = await tx<{ n: number }[]>`
      select count(distinct member_no)::int as n from access_events where granted and at >= now() - interval '90 minutes'`;
    const [busy] = await tx<{ h: number | null }[]>`
      select extract(hour from at at time zone ${tz})::int as h from access_events
      where granted and at >= now() - interval '56 days'
        and extract(isodow from at at time zone ${tz}) = extract(isodow from now() at time zone ${tz})
      group by 1 order by count(*) desc limit 1`;
    const today = await tx<{ h: number; n: number }[]>`
      select extract(hour from at at time zone ${tz})::int as h, count(*)::int as n from access_events
      where granted and at >= date_trunc('day', now() at time zone ${tz}) at time zone ${tz} group by 1`;
    const [rev] = await tx<{ now: number; prev: number; mpesa: number; cash: number }[]>`
      select coalesce(sum(amount_kes) filter (where paid_at >= now() - ${span}::interval), 0)::int as now,
             coalesce(sum(amount_kes) filter (where paid_at >= now() - ${span2}::interval and paid_at < now() - ${span}::interval), 0)::int as prev,
             coalesce(sum(amount_kes) filter (where paid_at >= now() - ${span}::interval and channel <> 'cash'), 0)::int as mpesa,
             coalesce(sum(amount_kes) filter (where paid_at >= now() - ${span}::interval and channel = 'cash'), 0)::int as cash
      from payments where status = 'applied'`;
    const daily = await tx<{ day: string; mpesa: number; cash: number }[]>`
      select to_char(d, 'YYYY-MM-DD') as day,
             coalesce(sum(p.amount_kes) filter (where p.channel <> 'cash'), 0)::int as mpesa,
             coalesce(sum(p.amount_kes) filter (where p.channel = 'cash'), 0)::int as cash
      from generate_series((now() at time zone ${tz})::date - ${days - 1}::int, (now() at time zone ${tz})::date, '1 day') d
      left join payments p on p.status = 'applied' and (p.paid_at at time zone ${tz})::date = d
      group by d order by d`;
    // Seven points across the period, for the small trend bars.
    const points = await tx<{ i: number; rev: number; active: number }[]>`
      select g.i,
        (select coalesce(sum(amount_kes), 0)::int from payments where status = 'applied'
           and paid_at > now() - ${span}::interval + (g.i - 1) * (${span}::interval / 7)
           and paid_at <= now() - ${span}::interval + g.i * (${span}::interval / 7)) as rev,
        (select count(distinct member_id)::int from entitlements
           where now() - ${span}::interval + g.i * (${span}::interval / 7) between starts_at and ends_at) as active
      from generate_series(1, 7) g(i) order by g.i`;
    const [act] = await tx<{ n: number }[]>`
      select count(distinct member_id)::int as n from entitlements where now() between starts_at and ends_at`;
    const [joined] = await tx<{ n: number }[]>`
      select count(*)::int as n from (select member_id, min(paid_at) as first from payments
        where status = 'applied' and member_id is not null group by member_id) f where f.first >= now() - ${span}::interval`;
    // Renewals: members whose membership ended in the period, and how many of them are active again now.
    const [ren] = await tx<{ ended: number; renewed: number }[]>`
      with ended as (
        select member_id from entitlements group by member_id
        having bool_or(ends_at between now() - ${span}::interval and now()))
      select count(*)::int as ended,
             count(*) filter (where exists (select 1 from entitlements e where e.member_id = ended.member_id
                                             and now() between e.starts_at and e.ends_at))::int as renewed
      from ended`;
    const ending = await tx<{ id: string; member_no: number; first_name: string; last_name: string; ends: Date }[]>`
      select m.id, m.member_no, m.first_name, m.last_name, max(e.ends_at) as ends
      from members m join entitlements e on e.member_id = m.id
      where m.first_name <> 'Wristband'
      group by m.id having max(e.ends_at) between now() and now() + interval '7 days'
      order by ends limit 6`;
    const [e7] = await tx<{ n: number; kes: number }[]>`
      select count(*)::int as n, coalesce(sum(lp.price_kes), 0)::int as kes
      from (select m.id from members m join entitlements e on e.member_id = m.id
            where m.first_name <> 'Wristband'
            group by m.id having max(e.ends_at) between now() and now() + interval '7 days') x
      left join lateral (select pr.price_kes from payments p join products pr on pr.id = p.product_id
                         where p.member_id = x.id and p.status = 'applied' order by p.paid_at desc limit 1) lp on true`;
    const plans = await tx<{ name: string; kes: number }[]>`
      select coalesce(pr.name, 'Other') as name, sum(p.amount_kes)::int as kes
      from payments p left join products pr on pr.id = p.product_id
      where p.status = 'applied' and p.paid_at >= now() - ${span}::interval
      group by 1 order by 2 desc limit 4`;
    // At risk: paid up, but no entry for 14+ days (the clearest early sign that someone is about to leave).
    const risk = await tx<{ id: string; member_no: number; first_name: string; last_name: string; away: number }[]>`
      select m.id, m.member_no, m.first_name, m.last_name,
             extract(day from now() - coalesce(max(a.at), min(e.starts_at)))::int as away
      from members m
      join entitlements e on e.member_id = m.id and now() between e.starts_at and e.ends_at
      left join access_events a on a.member_no = m.member_no and a.granted
      group by m.id
      having coalesce(max(a.at), min(e.starts_at)) < now() - interval '14 days'
      order by away desc`;
    const [um] = await tx<{ n: number; kes: number }[]>`
      select count(*)::int as n, coalesce(sum(amount_kes), 0)::int as kes from payments where status = 'unmatched'`;
    const [st] = await tx<
      { failed: number }[]
    >`select count(*) filter (where error is not null)::int as failed from access_states`;
    const [br] = await tx<{ last: Date | null }[]>`select max(last_seen_at) as last from app_tenant_bridges()`;
    const [sms] = await tx<{ units: string | null }[]>`select sum(units) as units from sms_ledger`;
    const ended = ren?.ended ?? 0;
    const renewed = ren?.renewed ?? 0;
    return {
      tenantName: t?.name ?? '',
      timezone: tz,
      days,
      live: {
        inside: inside?.n ?? 0,
        busiestHour: busy?.h ?? null,
        todayByHour: Array.from({ length: 24 }, (_, h) => today.find((x) => x.h === h)?.n ?? 0),
      },
      revenue: {
        now: rev?.now ?? 0,
        prev: rev?.prev ?? 0,
        mpesa: rev?.mpesa ?? 0,
        cash: rev?.cash ?? 0,
        spark: points.map((p) => p.rev),
      },
      daily,
      members: {
        active: act?.n ?? 0,
        joined: joined?.n ?? 0,
        lapsed: ended - renewed,
        spark: points.map((p) => p.active),
      },
      renewals: { ended, renewed, lapsed: ended - renewed },
      endingSoon: ending.map((x) => ({
        id: x.id,
        memberNo: x.member_no,
        name: `${x.first_name} ${x.last_name}`,
        endsAt: x.ends,
      })),
      ending7: { count: e7?.n ?? 0, expectedKes: e7?.kes ?? 0 },
      plans,
      atRisk: risk.slice(0, 5).map((x) => ({
        id: x.id,
        memberNo: x.member_no,
        name: `${x.first_name} ${x.last_name}`,
        daysAway: x.away,
      })),
      atRiskTotal: risk.length,
      attention: {
        unmatched: um?.n ?? 0,
        unmatchedKes: um?.kes ?? 0,
        bridgeLastSeen: br?.last ?? null,
        syncFailed: st?.failed ?? 0,
        smsUnits: Number(sms?.units ?? 0),
      },
    };
  });
}

/** The few things that need someone's attention, for the bell in the top bar (same rules as the Dashboard list). */
export async function consoleAlerts(tenantId: string) {
  return T(tenantId, async (tx) => {
    const [um] = await tx<{ n: number; kes: number }[]>`
      select count(*)::int as n, coalesce(sum(amount_kes), 0)::int as kes from payments where status = 'unmatched'`;
    const [st] = await tx<
      { failed: number }[]
    >`select count(*) filter (where error is not null)::int as failed from access_states`;
    const [br] = await tx<{ last: Date | null }[]>`select max(last_seen_at) as last from app_tenant_bridges()`;
    const [sms] = await tx<{ units: string | null }[]>`select sum(units) as units from sms_ledger`;
    return {
      unmatched: um?.n ?? 0,
      unmatchedKes: um?.kes ?? 0,
      bridgeLastSeen: br?.last ?? null,
      syncFailed: st?.failed ?? 0,
      smsUnits: Number(sms?.units ?? 0),
    };
  });
}

/** The member number the next new member gets when none is typed (same rule as createMember). */
export async function nextMemberNo(tenantId: string) {
  return T(tenantId, async (tx) => {
    const [n] = await tx<{ next: number }[]>`
      select coalesce(max(member_no), 21000) + 1 as next from members where member_no between 21001 and 65535`;
    return n?.next ?? 21001;
  });
}
