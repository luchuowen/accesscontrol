import { DateTime } from 'luxon';
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
      where m.member_no not between 11001 and 11999
        and (${q} = '' or lower(m.first_name || ' ' || m.last_name) like ${like} or m.member_no::text like ${like} or coalesce(m.phone, '') like ${like})
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
      select p.id, p.amount_kes, p.paid_at, p.status, p.channel, coalesce((select string_agg(l.label, ' + ' order by l.created_at) from payment_lines l where l.payment_id = p.id), pr.name) as product, p.provider_txn_id
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
        /** On sale: the price and its service are both on sale and the service isn't deleted. */
        on_sale: boolean;
        /** Members can buy it (not a walk-in-only service). */
        for_members: boolean;
      }[]
    >`
    select p.*, (select count(*)::int from payments x where x.product_id = p.id and x.status = 'applied') as sold,
      p.active and coalesce(s.active and s.deleted_at is null, true) as on_sale,
      coalesce(s.sold_to, 'both') <> 'walkins' as for_members
    from products p left join services s on s.id = p.service_id
    order by p.active desc, p.price_kes`,
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
           m.first_name || ' ' || m.last_name as member, coalesce((select string_agg(l.label, ' + ' order by l.created_at) from payment_lines l where l.payment_id = p.id), pr.name) as product, st.name as recorded_by
    from payments p left join members m on m.id = p.member_id left join products pr on pr.id = p.product_id
    left join app_staff_names() st on st.id::text = p.recorded_by
    order by p.paid_at desc limit 200`,
  );
}

export interface PaymentRow {
  id: string;
  paid_at: Date;
  amount_kes: number;
  status: string;
  channel: string;
  provider: string;
  provider_txn_id: string;
  account_ref: string | null;
  phone: string | null;
  member_id: string | null;
  member_no: number | null;
  member: string | null;
  product: string | null;
  recorded_by: string | null;
}

/**
 * Payments (design A "Ledger", approved 2 Oct 2026): totals for the period with the change against the period
 * before, money that needs the owner (unmatched), and the filtered list. `days` 0 = today only (front desk).
 */
export async function paymentsBoard(
  tenantId: string,
  o: { days: number; q?: string; method?: string; status?: string; limit?: number; offset?: number },
) {
  return T(tenantId, async (tx) => {
    const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${tenantId}`;
    const tz = t?.timezone ?? 'Africa/Nairobi';
    const now = DateTime.now().setZone(tz);
    const from = (o.days === 0 ? now.startOf('day') : now.startOf('day').minus({ days: o.days - 1 })).toJSDate();
    const prevFrom = (
      o.days === 0 ? now.startOf('day').minus({ days: 1 }) : now.startOf('day').minus({ days: o.days * 2 - 1 })
    ).toJSDate();
    const q = (o.q ?? '').trim().toLowerCase();
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, '');
    const method = o.method === 'mpesa' || o.method === 'cash' ? o.method : '';
    const status = o.status === 'applied' || o.status === 'unmatched' ? o.status : '';
    const [rows, [cur], [prev], [held]] = await Promise.all([
      tx<(PaymentRow & { full_count: number })[]>`
        select count(*) over ()::int as full_count, p.id, p.paid_at, p.amount_kes, p.status, p.channel, p.provider, p.provider_txn_id, p.account_ref, p.phone,
               p.member_id, m.member_no, m.first_name || ' ' || m.last_name as member,
               coalesce((select string_agg(l.label, ' + ' order by l.created_at) from payment_lines l where l.payment_id = p.id), pr.name) as product,
               st.name as recorded_by
        from payments p left join members m on m.id = p.member_id left join products pr on pr.id = p.product_id
        left join app_staff_names() st on st.id::text = p.recorded_by
        where p.paid_at >= ${from}
          and (${method} = '' or (${method} = 'cash' and p.channel = 'cash') or (${method} = 'mpesa' and p.channel <> 'cash'))
          and (${status} = '' or p.status = ${status})
          and (${q} = '' or lower(coalesce(m.first_name || ' ' || m.last_name, '')) like ${like}
               or m.member_no::text like ${like} or lower(p.provider_txn_id) like ${like} or coalesce(p.account_ref, '') like ${like}
               or (${digits} <> '' and regexp_replace(coalesce(p.phone, ''), '\\D', '', 'g') like ${`%${digits}%`}))
        order by p.paid_at desc limit ${o.limit ?? 20} offset ${o.offset ?? 0}`,
      tx<{ total: number; mpesa: number; cash: number; n: number }[]>`
        select coalesce(sum(amount_kes), 0)::int as total, coalesce(sum(amount_kes) filter (where channel <> 'cash'), 0)::int as mpesa,
               coalesce(sum(amount_kes) filter (where channel = 'cash'), 0)::int as cash, count(*)::int as n
        from payments where status = 'applied' and paid_at >= ${from}`,
      tx<{ total: number }[]>`
        select coalesce(sum(amount_kes), 0)::int as total from payments
        where status = 'applied' and paid_at >= ${prevFrom} and paid_at < ${from}`,
      tx<{ n: number; kes: number }[]>`
        select count(*)::int as n, coalesce(sum(amount_kes), 0)::int as kes from payments where status = 'unmatched'`,
    ]);
    return {
      rows,
      count: rows[0]?.full_count ?? 0,
      totals: cur ?? { total: 0, mpesa: 0, cash: 0, n: 0 },
      previous: prev?.total ?? 0,
      held: held ?? { n: 0, kes: 0 },
      from,
    };
  });
}

export interface DoorEvent {
  at: Date;
  memberId: string | null;
  memberNo: number | null;
  name: string | null;
  zone: string | null;
  readerId: number;
  granted: boolean;
  /** Why the door said no, in plain words (only when turned away). */
  reason: string | null;
  /** What they last paid, to suggest when asking them to pay. */
  lastPriceKes: number | null;
}

/**
 * Doors & access (design A "Control room", approved 2 Oct 2026): is the door PC online, have all payments reached the
 * doors, who went in today and who was turned away (with why), what each area opens, and changes someone made
 * directly in the door software that Lango put back. Today = since local midnight.
 */
export async function doorsBoard(tenantId: string) {
  return T(tenantId, async (tx) => {
    const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${tenantId}`;
    const tz = t?.timezone ?? 'Africa/Nairobi';
    const midnight = DateTime.now().setZone(tz).startOf('day').toJSDate();
    const [sites, zones, bridges, [st], events, [today], perZone, tamper] = await Promise.all([
      tx<{ id: string; name: string }[]>`select id, name from sites order by name`,
      tx<{ id: string; site_id: string; key: string; name: string; reader_ids: number[] }[]>`
        select id, site_id, key, name, reader_ids from zones order by name`,
      tx<{ id: string; site_id: string; pair_code: string | null; last_seen_at: Date | null; adapter: string }[]>`
        select * from app_tenant_bridges()`,
      tx<{ total: number; synced: number; failed: number }[]>`
        select count(*)::int as total, count(*) filter (where applied_version = version)::int as synced,
               count(*) filter (where error is not null)::int as failed from access_states`,
      tx<
        {
          at: Date;
          member_id: string | null;
          member_no: number | null;
          name: string | null;
          zone: string | null;
          reader_id: number;
          granted: boolean;
          last_end: Date | null;
          now_services: string | null;
          status: string | null;
          last_price: number | null;
        }[]
      >`
        select e.at, m.id as member_id, e.member_no, m.first_name || ' ' || m.last_name as name, z.name as zone,
               e.reader_id, e.granted, m.status, x.last_end, x.now_services,
               (select l.price_kes from payment_lines l join payments p on p.id = l.payment_id
                 where p.member_id = m.id and p.status = 'applied' order by p.paid_at desc limit 1) as last_price
        from access_events e
        left join members m on m.member_no = e.member_no
        left join zones z on e.reader_id = any(z.reader_ids) and z.site_id = e.site_id
        left join lateral (
          select max(en.ends_at) as last_end,
                 string_agg(distinct coalesce(sv.name, en.zone_key), ', ')
                   filter (where en.starts_at <= e.at and en.ends_at > e.at) as now_services
          from entitlements en left join services sv on sv.id = en.service_id where en.member_id = m.id) x on true
        where e.at >= ${midnight}
        order by e.at desc limit 200`,
      tx<{ entries: number; people: number; denied: number }[]>`
        select count(*) filter (where granted)::int as entries,
               count(distinct member_no) filter (where granted)::int as people,
               count(*) filter (where not granted)::int as denied
        from access_events where at >= ${midnight}`,
      tx<{ zone_id: string; n: number }[]>`
        select z.id as zone_id, count(*)::int as n from access_events e
        join zones z on e.reader_id = any(z.reader_ids) and z.site_id = e.site_id
        where e.at >= ${midnight} and e.granted group by z.id`,
      tx<{ at: Date; member_no: string; name: string | null; changes: string[] }[]>`
        select a.at, a.entity as member_no, m.first_name || ' ' || m.last_name as name,
               coalesce(array(select jsonb_array_elements_text(a.data->'changes')), '{}') as changes
        from audit_log a left join members m on m.member_no::text = a.entity
        where a.action = 'access.tamper_reverted' and a.at > now() - interval '30 days'
        order by a.at desc limit 50`,
    ]);
    const readers = new Map<string, Map<number, string>>();
    for (const site of sites) {
      const [inv] = await tx<{ data: { readers: { id: number; name: string; door?: string | null }[] } }[]>`
        select data from site_inventory where site_id = ${site.id}`;
      readers.set(site.id, new Map((inv?.data.readers ?? []).map((r) => [r.id, r.door || r.name])));
    }
    const ago = (d: Date) => {
      const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
      return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    };
    const reason = (e: (typeof events)[number]): string => {
      if (!e.member_id) return 'Card not recognised';
      if (e.member_no !== null && e.member_no >= 11001 && e.member_no <= 11999) return 'Wristband not paid for';
      if (e.status && e.status !== 'active') return 'Membership paused';
      if (!e.last_end) return 'Never paid';
      if (e.now_services) return `Paid for ${e.now_services} only`;
      return `Membership ended ${ago(e.last_end)}`;
    };
    return {
      sites,
      bridges,
      stats: st ?? { total: 0, synced: 0, failed: 0 },
      today: today ?? { entries: 0, people: 0, denied: 0 },
      zones: zones.map((z) => ({
        ...z,
        doors: z.reader_ids.map((r) => readers.get(z.site_id)?.get(r) ?? `Reader ${r}`),
        today: perZone.find((p) => p.zone_id === z.id)?.n ?? 0,
      })),
      readers: Object.fromEntries([...readers].map(([k, v]) => [k, [...v].map(([id, name]) => ({ id, name }))])),
      events: events.map(
        (e): DoorEvent => ({
          at: e.at,
          memberId: e.member_id,
          memberNo: e.member_no,
          name: e.name,
          zone: e.zone,
          readerId: e.reader_id,
          granted: e.granted,
          reason: e.granted ? null : reason(e),
          lastPriceKes: e.last_price,
        }),
      ),
      tamper,
    };
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
  endingSoon: {
    id: string;
    memberNo: number;
    name: string;
    endsAt: Date;
    plan: string | null;
    priceKes: number | null;
  }[];
  /** Members whose plan ends in the next 7 days, and what they would pay at their last plan's current price. */
  ending7: { count: number; expectedKes: number };
  /** Money in by plan for the period, biggest first (top 4). */
  plans: { name: string; kes: number }[];
  atRisk: { id: string; memberNo: number; name: string; daysAway: number }[];
  atRiskTotal: number;
  /** Paid-up members not seen, by days away: 30+, 21–29, 14–20. */
  riskTiers: { high: number; mid: number; watch: number };
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
    // One window for every "period" figure: from midnight (club time) days-1 ago until now, the same days the
    // Money in chart shows, so Revenue, Money in and Top plans always agree. The previous period is the same length
    // just before it.
    const [t] = await tx<{ name: string; timezone: string; start: Date; prev: Date }[]>`
      with z as (select name, coalesce(timezone, 'Africa/Nairobi') as tz from tenants where id = ${tenantId})
      select name, tz as timezone,
             (((now() at time zone tz)::date - ${days - 1}::int)::timestamp at time zone tz) as start,
             (((now() at time zone tz)::date - ${2 * days - 1}::int)::timestamp at time zone tz) as prev
      from z`;
    const tz = t?.timezone ?? 'Africa/Nairobi';
    const start = t?.start ?? new Date(Date.now() - days * 86400_000);
    const prev = t?.prev ?? new Date(start.getTime() - days * 86400_000);
    // Walk-in wristbands (member numbers 11001–11999, John's convention) are reusable day passes, not members:
    // they count as money and as people inside, never as members, renewals or lapses.
    // All queries below are independent, so they are sent together (pipelined on the one connection).
    const [
      [inside],
      [busy],
      today,
      [rev],
      daily,
      points,
      [act],
      [joined],
      [ren],
      ending,
      plans,
      risk,
      [um],
      [st],
      [br],
      [sms],
    ] = await Promise.all([
      // In the club now: doors record entries only, so "inside" = distinct people (member or card) who entered in the last 90 minutes.
      tx<{ n: number }[]>`
        select count(distinct coalesce(member_no::bigint, card_code))::int as n from access_events where granted and at >= now() - interval '90 minutes'`,
      tx<{ h: number | null }[]>`
        select extract(hour from at at time zone ${tz})::int as h from access_events
        where granted and at >= now() - interval '56 days'
          and extract(isodow from at at time zone ${tz}) = extract(isodow from now() at time zone ${tz})
        group by 1 order by count(*) desc limit 1`,
      tx<{ h: number; n: number }[]>`
        select extract(hour from at at time zone ${tz})::int as h, count(*)::int as n from access_events
        where granted and at >= date_trunc('day', now() at time zone ${tz}) at time zone ${tz} group by 1`,
      tx<{ now: number; prev: number; mpesa: number; cash: number }[]>`
        select coalesce(sum(amount_kes) filter (where paid_at >= ${start}), 0)::int as now,
               coalesce(sum(amount_kes) filter (where paid_at < ${start}), 0)::int as prev,
               coalesce(sum(amount_kes) filter (where paid_at >= ${start} and channel <> 'cash'), 0)::int as mpesa,
               coalesce(sum(amount_kes) filter (where paid_at >= ${start} and channel = 'cash'), 0)::int as cash
        from payments where status = 'applied' and paid_at >= ${prev}`,
      tx<{ day: string; mpesa: number; cash: number }[]>`
        select to_char(d, 'YYYY-MM-DD') as day,
               coalesce(sum(p.amount_kes) filter (where p.channel <> 'cash'), 0)::int as mpesa,
               coalesce(sum(p.amount_kes) filter (where p.channel = 'cash'), 0)::int as cash
        from generate_series((now() at time zone ${tz})::date - ${days - 1}::int, (now() at time zone ${tz})::date, '1 day') d
        left join payments p on p.status = 'applied' and p.paid_at >= ${start}
                            and (p.paid_at at time zone ${tz})::date = d::date
        group by d order by d`,
      // Seven points across the period, for the small trend bars.
      tx<{ i: number; rev: number; active: number }[]>`
        with g as (select i, ${start}::timestamptz + (now() - ${start}::timestamptz) * (i - 1) / 7 as a,
                             ${start}::timestamptz + (now() - ${start}::timestamptz) * i / 7 as b
                   from generate_series(1, 7) i)
        select g.i,
          (select coalesce(sum(amount_kes), 0)::int from payments
             where status = 'applied' and paid_at > g.a and paid_at <= g.b) as rev,
          (select count(distinct e.member_id)::int from entitlements e join members m on m.id = e.member_id
             where m.member_no not between 11001 and 11999 and e.ends_at >= g.b and e.starts_at <= g.b) as active
        from g order by g.i`,
      tx<{ n: number }[]>`
        select count(distinct e.member_id)::int as n from entitlements e join members m on m.id = e.member_id
        where m.member_no not between 11001 and 11999 and e.ends_at > now() and e.starts_at <= now()`,
      // Joined: members whose first ever payment falls in the period.
      tx<{ n: number }[]>`
        select count(distinct p.member_id)::int as n from payments p join members m on m.id = p.member_id
        where p.status = 'applied' and p.paid_at >= ${start} and m.member_no not between 11001 and 11999
          and not exists (select 1 from payments q where q.member_id = p.member_id and q.status = 'applied'
                          and q.paid_at < ${start})`,
      // Renewals: members whose plan ended in the period, and how many of them are paid up again now.
      tx<{ ended: number; renewed: number }[]>`
        with ended as (
          select distinct e.member_id from entitlements e join members m on m.id = e.member_id
          where e.ends_at >= ${start} and e.ends_at <= now() and m.member_no not between 11001 and 11999)
        select count(*)::int as ended,
               count(*) filter (where exists (select 1 from entitlements e where e.member_id = ended.member_id
                                               and e.ends_at > now() and e.starts_at <= now()))::int as renewed
        from ended`,
      // Ending in 7 days: paid up now, last day within a week, with the plan they last paid for.
      tx<
        {
          id: string;
          member_no: number;
          first_name: string;
          last_name: string;
          ends: Date;
          plan: string | null;
          price: number | null;
        }[]
      >`
        select x.*, lp.name as plan, lp.price_kes as price from (
          select m.id, m.member_no, m.first_name, m.last_name, max(e.ends_at) as ends
          from members m join entitlements e on e.member_id = m.id
          where e.ends_at > now() and m.member_no not between 11001 and 11999
          group by m.id having max(e.ends_at) <= now() + interval '7 days') x
        left join lateral (select coalesce(pr.name, l.label) as name, coalesce(pr.price_kes, l.price_kes) as price_kes
                           from payment_lines l join payments p on p.id = l.payment_id left join products pr on pr.id = l.product_id and pr.active
                           where p.member_id = x.id and p.status = 'applied' order by p.paid_at desc limit 1) lp on true
        order by x.ends`,
      tx<{ name: string; kes: number }[]>`
        select coalesce(sv.name, l.label) as name, sum(l.price_kes)::int as kes
        from payment_lines l join payments p on p.id = l.payment_id left join services sv on sv.id = l.service_id
        where p.status = 'applied' and p.paid_at >= ${start}
        group by 1 order by 2 desc limit 4`,
      // Not seen 14+ days: paid up, but no entry for 14+ days (counted from the start of their current plan if they
      // have never come in) — the clearest early sign someone is about to leave.
      tx<{ id: string; member_no: number; first_name: string; last_name: string; away: number }[]>`
        select m.id, m.member_no, m.first_name, m.last_name,
               extract(day from now() - coalesce(la.last, cur.since))::int as away
        from members m
        join lateral (select min(e.starts_at) as since from entitlements e
                      where e.member_id = m.id and e.ends_at > now() and e.starts_at <= now()) cur on cur.since is not null
        left join lateral (select max(a.at) as last from access_events a
                           where a.member_no = m.member_no and a.granted) la on true
        where m.member_no not between 11001 and 11999
          and coalesce(la.last, cur.since) < now() - interval '14 days'
        order by away desc`,
      tx<{ n: number; kes: number }[]>`
        select count(*)::int as n, coalesce(sum(amount_kes), 0)::int as kes from payments where status = 'unmatched'`,
      tx<{ failed: number }[]>`select count(*) filter (where error is not null)::int as failed from access_states`,
      tx<{ last: Date | null }[]>`select max(last_seen_at) as last from app_tenant_bridges()`,
      tx<{ units: string | null }[]>`select sum(units) as units from sms_ledger`,
    ]);
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
      endingSoon: ending.slice(0, 5).map((x) => ({
        id: x.id,
        memberNo: x.member_no,
        name: `${x.first_name} ${x.last_name}`,
        endsAt: x.ends,
        plan: x.plan,
        priceKes: x.price,
      })),
      ending7: { count: ending.length, expectedKes: ending.reduce((a, x) => a + (x.price ?? 0), 0) },
      plans,
      atRisk: risk.slice(0, 5).map((x) => ({
        id: x.id,
        memberNo: x.member_no,
        name: `${x.first_name} ${x.last_name}`,
        daysAway: x.away,
      })),
      atRiskTotal: risk.length,
      riskTiers: {
        high: risk.filter((x) => x.away >= 30).length,
        mid: risk.filter((x) => x.away >= 21 && x.away < 30).length,
        watch: risk.filter((x) => x.away < 21).length,
      },
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

/**
 * Everything the Club health drawer can show, in one round trip. Each figure is a live condition (it disappears
 * once fixed), so nothing needs marking as read.
 */
export async function consoleAlerts(tenantId: string) {
  return T(tenantId, async (tx) => {
    const [[um], [st], [br], [sms], [cfg], [chat], [end], [away], [tamper]] = await Promise.all([
      tx<{ n: number; kes: number }[]>`
        select count(*)::int as n, coalesce(sum(amount_kes), 0)::int as kes from payments where status = 'unmatched'`,
      tx<{ failed: number; who: string | null; member_id: string | null }[]>`
        select count(*)::int as failed, min(m.first_name || ' ' || m.last_name) as who,
               (array_agg(m.id))[1] as member_id
        from access_states a join members m on m.id = a.member_id where a.error is not null`,
      tx<
        { last: Date | null; n: number }[]
      >`select max(last_seen_at) as last, count(*)::int as n from app_tenant_bridges()`,
      tx<{ units: string | null }[]>`select sum(units) as units from sms_ledger`,
      tx<{ low: number | null; on: boolean | null; gateway: boolean }[]>`
        select (data->'notifications'->>'lowBalance')::int as low, (data->'notifications'->>'enabled')::boolean as on,
               (data ? 'taifapay') as gateway
        from tenant_settings`,
      tx<{ n: number; who: string | null; body: string | null; channel: string | null; id: string | null }[]>`
        select count(*)::int as n, (array_agg(coalesce(m.first_name || ' ' || m.last_name, c.name, c.address) order by c.last_at desc))[1] as who,
               (array_agg(x.body order by c.last_at desc))[1] as body,
               (array_agg(c.channel order by c.last_at desc))[1] as channel,
               (array_agg(c.id::text order by c.last_at desc))[1] as id
        from conversations c left join members m on m.id = c.member_id
        join lateral (select body, direction from comm_messages where conversation_id = c.id
                      order by created_at desc limit 1) x on x.direction = 'in'
        where c.status = 'open'`,
      tx<{ n: number; kes: number; who: string | null; days: number | null }[]>`
        with e as (
          select m.id, m.first_name || ' ' || m.last_name as who, max(en.ends_at) as ends
          from members m join entitlements en on en.member_id = m.id
          where m.member_no not between 11001 and 11999 group by m.id
          having max(en.ends_at) > now() and max(en.ends_at) <= now() + interval '7 days')
        select count(*)::int as n,
               coalesce(sum((select l.price_kes from payment_lines l join payments p on p.id = l.payment_id
                             where p.member_id = e.id and p.status = 'applied' order by p.paid_at desc limit 1)), 0)::int as kes,
               (array_agg(who order by ends))[1] as who,
               min(ceil(extract(epoch from ends - now()) / 86400))::int as days
        from e`,
      tx<{ n: number }[]>`
        select count(*)::int as n from members m
        join lateral (select min(e.starts_at) as since from entitlements e
                      where e.member_id = m.id and e.ends_at > now() and e.starts_at <= now()) cur on cur.since is not null
        left join lateral (select max(a.at) as last from access_events a where a.member_no = m.member_no and a.granted) la on true
        where m.member_no not between 11001 and 11999 and coalesce(la.last, cur.since) < now() - interval '21 days'`,
      tx<{ n: number; who: string | null }[]>`
        select count(*)::int as n, (array_agg(coalesce(m.first_name || ' ' || m.last_name, '#' || a.entity) order by a.at desc))[1] as who
        from audit_log a left join members m on m.member_no::text = a.entity
        where a.action = 'access.tamper_reverted' and a.at > now() - interval '7 days'`,
    ]);
    return {
      unmatched: um?.n ?? 0,
      unmatchedKes: um?.kes ?? 0,
      bridges: br?.n ?? 0,
      bridgeLastSeen: br?.last ?? null,
      syncFailed: st?.failed ?? 0,
      syncWho: st?.who ?? null,
      syncMemberId: st?.member_id ?? null,
      smsUnits: Number(sms?.units ?? 0),
      smsLow: cfg?.low ?? 100,
      smsOn: !!cfg?.on,
      gateway: !!cfg?.gateway,
      waiting: chat?.n ?? 0,
      waitingWho: chat?.who ?? null,
      waitingBody: chat?.body ?? null,
      waitingChannel: chat?.channel ?? null,
      waitingId: chat?.id ?? null,
      ending: end?.n ?? 0,
      endingKes: end?.kes ?? 0,
      endingWho: end?.who ?? null,
      endingDays: end?.days ?? null,
      away: away?.n ?? 0,
      tamper: tamper?.n ?? 0,
      tamperWho: tamper?.who ?? null,
    };
  });
}

export async function nextMemberNo(tenantId: string) {
  return T(tenantId, async (tx) => {
    const [n] = await tx<{ next: number }[]>`
      select coalesce(max(member_no), 21000) + 1 as next from members where member_no between 21001 and 65535`;
    return n?.next ?? 21001;
  });
}

export interface ServicePrice {
  id: string;
  name: string;
  price_kes: number;
  duration_unit: 'hour' | 'day' | 'week' | 'month' | 'year';
  duration_count: number;
  active: boolean;
  sold: number;
}
export interface ServiceRow {
  id: string;
  name: string;
  zone_keys: string[];
  active: boolean;
  category: string | null;
  icon: string | null;
  sold_to: 'members' | 'walkins' | 'both';
  /** People whose access to this service is running now. */
  using: number;
  /** Sales in the last 30 days. */
  sold30: number;
  prices: ServicePrice[];
}

/** Services with their prices (cheapest first) and how often each price was sold. */
export async function servicesOverview(tenantId: string) {
  return T(tenantId, async (tx) => {
    const [services, areas] = await Promise.all([
      tx<ServiceRow[]>`
        select s.id, s.name, s.zone_keys, s.active, s.category, s.icon, s.sold_to,
          (select count(distinct e.member_id)::int from entitlements e
             where e.service_id = s.id and e.starts_at <= now() and e.ends_at > now()) as using,
          (select count(*)::int from payment_lines l join payments p on p.id = l.payment_id
             where l.service_id = s.id and p.status = 'applied' and p.paid_at > now() - interval '30 days') as sold30,
          coalesce((select json_agg(x order by x.price_kes) from (
            select p.id, p.name, p.price_kes, p.duration_unit, p.duration_count, p.active,
                   (select count(*)::int from payment_lines l where l.product_id = p.id) as sold
            from products p where p.service_id = s.id) x), '[]') as prices
        from services s where s.deleted_at is null order by s.active desc, s.created_at`,
      tx<{ key: string; name: string; readers: number }[]>`
        select key, min(name) as name, sum(cardinality(reader_ids))::int as readers from zones group by key order by min(name)`,
    ]);
    return { services, areas };
  });
}

/** Prices on sale, grouped by service, for selling at the desk. */
export async function sellablePrices(tenantId: string) {
  return T(
    tenantId,
    (tx) => tx<
      {
        id: string;
        service: string;
        service_id: string;
        name: string;
        price_kes: number;
        duration_unit: string;
        duration_count: number;
        zone_keys: string[];
        sold_to: 'members' | 'walkins' | 'both';
      }[]
    >`
    select p.id, s.name as service, s.id as service_id, p.name, p.price_kes, p.duration_unit, p.duration_count, p.zone_keys,
      s.sold_to
    from products p join services s on s.id = p.service_id
    where p.active and s.active order by s.created_at, p.price_kes`,
  );
}

/** Prices a walk-in can buy: services sold to walk-ins, anything up to one day (hours, or a 1-day pass). */
export async function walkinPrices(tenantId: string) {
  return (await sellablePrices(tenantId)).filter(
    (p) =>
      p.sold_to !== 'members' && (p.duration_unit === 'hour' || (p.duration_unit === 'day' && p.duration_count === 1)),
  );
}

export interface BandRow {
  id: string;
  no: number;
  visitor: string | null;
  phone: string | null;
  until: Date | null;
  status: 'free' | 'in_use' | 'awaiting';
  passes: string | null;
}

/** Every wristband with who has it now (if anyone), plus today's day-pass figures. */
export async function dayPassBoard(tenantId: string) {
  return T(tenantId, async (tx) => {
    const [bands, [today], visits] = await Promise.all([
      tx<BandRow[]>`
        select m.id, m.member_no as no,
          case when act.ends is not null then 'in_use' when wait.id is not null then 'awaiting' else 'free' end as status,
          coalesce(dp.visitor_name, wait.visitor_name) as visitor, coalesce(dp.visitor_phone, wait.visitor_phone) as phone,
          act.ends as until,
          (select string_agg(x->>'label', ' + ') from jsonb_array_elements(coalesce(dp.lines, wait.lines)) x) as passes
        from members m
        left join lateral (select max(ends_at) as ends from entitlements e
                           where e.member_id = m.id and e.ends_at > now() and e.starts_at <= now()) act on true
        left join lateral (select * from day_passes d where d.band_id = m.id and d.status = 'active' and d.ends_at > now()
                           order by d.created_at desc limit 1) dp on true
        left join lateral (select * from day_passes d where d.band_id = m.id and d.status = 'awaiting_payment'
                           and d.created_at > now() - interval '15 minutes' order by d.created_at desc limit 1) wait on true
        where m.member_no between 11001 and 11999 order by m.member_no`,
      tx<{ sold: number; kes: number }[]>`
        select count(*)::int as sold, coalesce(sum(total_kes), 0)::int as kes from day_passes
        where status = 'active' and created_at >= date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi'`,
      tx<
        {
          id: string;
          visitor_name: string;
          visitor_phone: string | null;
          total_kes: number;
          channel: string;
          status: string;
          band: number;
          created_at: Date;
          ends_at: Date | null;
          passes: string | null;
        }[]
      >`
        select d.id, d.visitor_name, d.visitor_phone, d.total_kes, d.channel, d.status, m.member_no as band, d.created_at, d.ends_at,
               (select string_agg(x->>'label', ' + ') from jsonb_array_elements(d.lines) x) as passes
        from day_passes d join members m on m.id = d.band_id
        order by d.created_at desc limit 50`,
    ]);
    return { bands, today: today ?? { sold: 0, kes: 0 }, visits };
  });
}

export type MemberStatus = 'active' | 'ending' | 'lapsed' | 'never' | 'inactive';
export interface MemberListRow {
  id: string;
  no: number;
  name: string;
  phone: string | null;
  services: { name: string; ends: string }[];
  status: MemberStatus;
  lastVisit: Date | null;
  card: boolean;
  sync: 'synced' | 'pending' | 'failed';
  /** Soonest running end (active/ending) or the last end (lapsed/inactive). */
  endsAt: Date | null;
  /** What renewing costs at their last prices: services ending in 7 days or ended in the last 30. */
  renewKes: number;
}
export interface MembersBoard {
  rows: MemberListRow[];
  total: number;
  counts: {
    all: number;
    joined: number;
    active: number;
    ending: number;
    dueKes: number;
    lapsed: number;
    never: number;
  };
  services: string[];
}

/**
 * Members page (design C "Money first", approved 2 Oct 2026): summary counts for the whole club, then the filtered
 * list ordered by who needs action: ending soonest, recently lapsed, active, never paid, past members.
 * Status: active (any service running), ending (a running service ends within 7 days), lapsed (nothing running,
 * last end within 30 days), never (no access ever), inactive (lapsed longer ago). Wristbands are not members.
 */
export async function membersBoard(
  tenantId: string,
  o: { q?: string; f?: string; service?: string; card?: string; page?: number },
): Promise<MembersBoard> {
  const per = 50;
  const page = Math.max(1, o.page ?? 1);
  const q = (o.q ?? '').trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, '');
  const like = `%${q}%`;
  const f = ['active', 'ending', 'lapsed', 'never'].includes(o.f ?? '') ? (o.f as string) : '';
  const svc = (o.service ?? '').trim();
  const card = o.card === 'yes' || o.card === 'no' ? o.card : '';
  return T(tenantId, async (tx) => {
    const status = tx`
      with base as (
        select m.id, m.member_no, m.first_name, m.last_name, m.phone, m.created_at,
          (select coalesce(json_agg(json_build_object('name', x.name, 'ends', x.ends) order by x.ends desc), '[]') from (
             select coalesce(sv.name, z.name, e.zone_key) as name, max(e.ends_at) as ends
             from entitlements e left join services sv on sv.id = e.service_id
             left join (select distinct on (key) key, name from zones order by key) z on z.key = e.zone_key and e.service_id is null
             where e.member_id = m.id group by 1) x) as services,
          (select max(ends_at) from entitlements e where e.member_id = m.id) as last_end,
          (select min(ends_at) from entitlements e where e.member_id = m.id and e.ends_at > now() and e.starts_at <= now()) as next_end,
          (select max(at) from access_events a where a.member_no = m.member_no and a.granted) as last_visit,
          exists (select 1 from credentials c where c.member_id = m.id) as card,
          (select json_build_object(
             'soon', coalesce(sum(y.price_kes) filter (where y.ends_at between now() and now() + interval '7 days'), 0),
             'gone', coalesce(sum(y.price_kes) filter (where y.ends_at between now() - interval '30 days' and now()), 0))
           from (
             select distinct on (coalesce(l.service_id::text, l.label)) l.price_kes, l.ends_at
             from payment_lines l join payments p on p.id = l.payment_id
             where p.member_id = m.id and p.status = 'applied'
             order by coalesce(l.service_id::text, l.label), l.ends_at desc) y) as renew,
          (select case when bool_or(s.error is not null) then 'failed'
                       when bool_and(s.applied_version is not distinct from s.version) then 'synced' else 'pending' end
             from access_states s where s.member_id = m.id) as sync
        from members m where m.member_no not between 11001 and 11999),
      st as (
        select *, case when next_end is not null and next_end <= now() + interval '7 days' then 'ending'
                       when next_end is not null then 'active'
                       when last_end is null then 'never'
                       when last_end >= now() - interval '30 days' then 'lapsed' else 'inactive' end as status
        from base),
      st2 as (
        select *, case status when 'ending' then (renew->>'soon')::int when 'lapsed' then (renew->>'gone')::int else 0 end
          as renew_kes from st)`;
    const where = tx`
      where (${q} = '' or lower(first_name || ' ' || last_name) like ${like} or member_no::text like ${like}
             or (${qDigits} <> '' and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like ${`%${qDigits}%`}))
        and (${f} = '' or status = ${f} or (${f} = 'active' and status = 'ending'))
        and (${svc} = '' or exists (select 1 from json_array_elements(services) j where j->>'name' = ${svc}))
        and (${card} = '' or card = (${card} = 'yes'))`;
    const [rows, [tot], [counts], [due], names] = await Promise.all([
      tx<
        {
          id: string;
          member_no: number;
          first_name: string;
          last_name: string;
          phone: string | null;
          services: { name: string; ends: string }[];
          status: MemberStatus;
          last_visit: Date | null;
          card: boolean;
          sync: string | null;
          next_end: Date | null;
          last_end: Date | null;
          renew_kes: number;
        }[]
      >`${status} select * from st2 ${where}
        order by case status when 'ending' then 0 when 'lapsed' then 1 when 'active' then 2 when 'never' then 3 else 4 end,
          case when status = 'ending' then next_end end, case when status = 'lapsed' then last_end end desc, member_no
        limit ${per} offset ${(page - 1) * per}`,
      tx<{ n: number }[]>`${status} select count(*)::int as n from st ${where}`,
      tx<{ all: number; joined: number; active: number; ending: number; lapsed: number; never: number }[]>`
        ${status} select count(*)::int as all,
          count(*) filter (where created_at >= date_trunc('month', now()))::int as joined,
          count(*) filter (where status in ('active', 'ending'))::int as active,
          count(*) filter (where status = 'ending')::int as ending,
          count(*) filter (where status = 'lapsed')::int as lapsed,
          count(*) filter (where status = 'never')::int as never
        from st`,
      tx<{ kes: number }[]>`
        select coalesce(sum(price_kes), 0)::int as kes from (
          select distinct on (p.member_id, coalesce(l.service_id::text, l.label)) l.price_kes, l.ends_at
          from payment_lines l join payments p on p.id = l.payment_id join members m on m.id = p.member_id
          where p.status = 'applied' and m.member_no not between 11001 and 11999
          order by p.member_id, coalesce(l.service_id::text, l.label), l.ends_at desc) x
        where ends_at between now() and now() + interval '7 days'`,
      tx<{ name: string }[]>`select name from services where active order by created_at`,
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        no: r.member_no,
        name: `${r.first_name} ${r.last_name}`.trim(),
        phone: r.phone,
        services: r.services,
        status: r.status,
        lastVisit: r.last_visit,
        card: r.card,
        sync: (r.sync ?? 'synced') as MemberListRow['sync'],
        endsAt: r.next_end ?? r.last_end,
        renewKes: r.renew_kes,
      })),
      total: tot?.n ?? 0,
      counts: {
        ...(counts ?? { all: 0, joined: 0, active: 0, ending: 0, lapsed: 0, never: 0 }),
        dueKes: due?.kes ?? 0,
      },
      services: names.map((n) => n.name),
    };
  });
}
