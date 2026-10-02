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
