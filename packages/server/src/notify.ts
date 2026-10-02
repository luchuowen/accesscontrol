import { randomUUID } from 'node:crypto';
import type { Sql, Tx } from '@lango/db';
import { withTenant } from '@lango/db';
import { DateTime } from 'luxon';
import { clubNotify, clubSms, msisdn, platformSms, platformSmsConfig, type SourceCodeSms, smsUnits } from './sms.js';

/**
 * Notifications beyond receipts and reminders. Everything here is queued and goes through dispatchSms, which
 * applies quiet hours, the one-message-a-day limit per member, the club's credit and dedupe keys.
 */

const queue = (
  tx: Tx,
  tenantId: string,
  m: { phone: string; body: string; kind: string; key: string; memberId?: string; before?: Date },
) =>
  tx`insert into sms_messages (tenant_id, member_id, phone, body, kind, dedupe_key, send_before)
     values (${tenantId}, ${m.memberId ?? null}, ${m.phone}, ${m.body}, ${m.kind}, ${m.key}, ${m.before ?? null})
     on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing returning id`;

const when = (at: Date, tz: string) => {
  const d = DateTime.fromJSDate(at, { zone: tz });
  return d.hasSame(DateTime.now().setZone(tz), 'day') ? d.toFormat('HH:mm') : d.toFormat("d LLL 'at' HH:mm");
};

async function payInfo(tx: Tx, tenantId: string) {
  const [c] = await tx<{ name: string; slug: string; paybill: string | null }[]>`
    select t.name, t.slug, ts.data->'channels'->>'paybill' as paybill
    from tenants t left join tenant_settings ts on ts.tenant_id = t.id where t.id = ${tenantId}`;
  return c ?? { name: 'Your club', slug: '', paybill: null };
}

/**
 * "We miss you": once, a week after a member's plan ended without renewal; never more than once in 90 days, and
 * never to members who turned club news off.
 */
export async function queueWinbacks(sql: Sql): Promise<number> {
  let queued = 0;
  for (const t of await sql<{ id: string; timezone: string }[]>`select id, timezone from tenants`) {
    queued += await withTenant(sql, t.id, async (tx) => {
      const n = await clubNotify(tx, t.id);
      if (!n.enabled || n.winback === false) return 0;
      const club = await payInfo(tx, t.id);
      const lapsed = await tx<{ id: string; member_no: number; first_name: string; phone: string; ends: Date }[]>`
        select m.id, m.member_no, m.first_name, m.phone, x.ends from members m
        join (select member_id, max(ends_at) as ends from entitlements group by member_id) x on x.member_id = m.id
        where m.status = 'active' and m.phone is not null and m.sms_news
          and x.ends < now() - interval '7 days' and x.ends > now() - interval '9 days'
          and not exists (select 1 from sms_messages s where s.member_id = m.id and s.kind = 'winback'
                          and s.created_at > now() - interval '90 days')`;
      const today = DateTime.now().setZone(t.timezone).startOf('day');
      let q = 0;
      for (const m of lapsed) {
        const end = DateTime.fromJSDate(m.ends, { zone: t.timezone });
        const days = Math.floor(today.diff(end.startOf('day'), 'days').days);
        if (days < 7 || days > 8) continue;
        const pay = club.paybill ? ` Paybill ${club.paybill}, account ${m.member_no}.` : '';
        const body = `We miss you at ${club.name}, ${m.first_name}. Your spot is here whenever you're ready to come back.${pay}`;
        const r = await queue(tx, t.id, {
          phone: m.phone,
          body,
          kind: 'winback',
          key: `winback:${m.id}:${end.toISODate()}`,
          memberId: m.id,
          before: DateTime.now().plus({ days: 3 }).toJSDate(),
        });
        q += r.length;
      }
      return q;
    });
  }
  return queued;
}

/**
 * Site Bridge (door PC) watch: one alert when it has been silent for 15 minutes, one "back online" when it returns.
 * If it returns before the alert went out (e.g. overnight), neither is sent.
 */
export async function watchBridges(sql: Sql, offlineAfterMin = 15): Promise<number> {
  let queued = 0;
  const bridges = await sql<
    { bridge_id: string; tenant_id: string; club: string; timezone: string; site: string; last_seen_at: Date }[]
  >`select * from app_bridge_health()`;
  const cutoff = Date.now() - offlineAfterMin * 60_000;
  for (const b of bridges) {
    queued += await withTenant(sql, b.tenant_id, async (tx) => {
      const [last] = await tx<{ action: string; data: { lastSeen?: string } | null }[]>`
        select action, data from audit_log where entity = ${b.bridge_id} and action in ('bridge.offline', 'bridge.online')
        order by at desc limit 1`;
      const offline = b.last_seen_at.getTime() < cutoff;
      const wasOffline = last?.action === 'bridge.offline';
      if (offline === wasOffline) return 0;
      const n = await clubNotify(tx, b.tenant_id);
      const phone = n.enabled && n.bridgeAlerts !== false ? msisdn(n.alertPhone) : null;
      if (offline) {
        await tx`insert into audit_log (tenant_id, actor, action, entity, data)
                 values (${b.tenant_id}, 'system', 'bridge.offline', ${b.bridge_id}, ${tx.json({ lastSeen: b.last_seen_at.toISOString(), site: b.site } as never)})`;
        if (!phone) return 0;
        const body = `${b.club}: Lango lost contact with the ${b.site} door PC at ${when(b.last_seen_at, b.timezone)}. Doors keep working; new payments apply when it reconnects. Check its power and internet.`;
        return (
          await queue(tx, b.tenant_id, {
            phone,
            body,
            kind: 'system',
            key: `bridge-off:${b.bridge_id}:${b.last_seen_at.toISOString()}`,
          })
        ).length;
      }
      await tx`insert into audit_log (tenant_id, actor, action, entity, data)
               values (${b.tenant_id}, 'system', 'bridge.online', ${b.bridge_id}, ${tx.json({ site: b.site } as never)})`;
      const held = await tx`update sms_messages set status = 'skipped', error = 'door PC came back before this was sent'
        where status = 'queued' and dedupe_key like ${`bridge-off:${b.bridge_id}:%`} returning id`;
      if (!phone || held.length) return 0;
      const since = last?.data?.lastSeen ? ` (offline since ${when(new Date(last.data.lastSeen), b.timezone)})` : '';
      const body = `${b.club}: the ${b.site} door PC is back online${since}. Payments made meanwhile are being applied now.`;
      return (
        await queue(tx, b.tenant_id, { phone, body, kind: 'system', key: `bridge-on:${b.bridge_id}:${Date.now()}` })
      ).length;
    });
  }
  return queued;
}

/** Tamper Guard reverted a hand edit in AxTraxNG: tell the alert phone (once per member per day). */
export async function queueTamperAlert(tx: Tx, tenantId: string, memberNo: number): Promise<void> {
  const n = await clubNotify(tx, tenantId);
  const phone = n.enabled && n.tamperAlerts !== false ? msisdn(n.alertPhone) : null;
  if (!phone) return;
  const [c] = await tx<{ name: string; timezone: string }[]>`select name, timezone from tenants where id = ${tenantId}`;
  const [m] = await tx<{ first_name: string; last_name: string }[]>`
    select first_name, last_name from members where member_no = ${memberNo}`;
  const who = m ? `${m.first_name} ${m.last_name} (${memberNo})` : `member ${memberNo}`;
  const body = `${c?.name}: someone changed ${who} directly in AxTraxNG. Lango has put their access back. Make changes in Lango so they stick.`;
  const day = DateTime.now()
    .setZone(c?.timezone ?? 'Africa/Nairobi')
    .toISODate();
  await queue(tx, tenantId, { phone, body, kind: 'system', key: `tamper:${memberNo}:${day}` });
}

/** End-of-day summary to the alert phone at 19:00 club time (only for clubs that switched it on). */
export async function queueDailySummaries(sql: Sql, at = DateTime.now()): Promise<number> {
  let queued = 0;
  for (const t of await sql<{ id: string; name: string; timezone: string }[]>`select id, name, timezone from tenants`) {
    const local = at.setZone(t.timezone);
    if (local.hour !== 19) continue;
    queued += await withTenant(sql, t.id, async (tx) => {
      const n = await clubNotify(tx, t.id);
      const phone = n.enabled && n.dailySummary ? msisdn(n.alertPhone) : null;
      if (!phone) return 0;
      const from = local.startOf('day').toJSDate();
      const [p] = await tx<{ n: number; kes: number; cash: number }[]>`
        select count(*)::int as n, coalesce(sum(amount_kes), 0)::int as kes, (count(*) filter (where channel = 'cash'))::int as cash
        from payments where paid_at >= ${from} and provider <> 'seed'`;
      const [m] = await tx<{ n: number }[]>`select count(*)::int as n from members where created_at >= ${from}`;
      const [e] = await tx<
        { n: number }[]
      >`select count(*)::int as n from access_events where at >= ${from} and granted`;
      const [u] = await tx<{ n: number }[]>`select count(*)::int as n from payments where status = 'unmatched'`;
      const club = await clubSms(tx, t.id, await platformSmsConfig(sql));
      const k = (x: number) => x.toLocaleString('en-KE');
      const pays = p?.n
        ? `KES ${k(p.kes)} from ${p.n} payment${p.n === 1 ? '' : 's'}${p.cash ? ` (${p.cash} cash)` : ''}`
        : 'no payments';
      const assign = u?.n ? ` ${u.n} payment${u.n === 1 ? '' : 's'} to assign.` : '';
      const body = `${t.name} today: ${pays}, ${m?.n ?? 0} new member${m?.n === 1 ? '' : 's'}, ${k(e?.n ?? 0)} entries.${assign} SMS credit: ${k(club.balance)}.`;
      return (await queue(tx, t.id, { phone, body, kind: 'system', key: `summary:${local.toISODate()}` })).length;
    });
  }
  return queued;
}

export type Audience = 'current' | 'all' | 'lapsed';
export const AUDIENCES: Record<Audience, string> = {
  current: 'Members with access now',
  lapsed: 'Members whose plan ended in the last 90 days',
  all: 'All members',
};

const audienceMembers = (tx: Tx, audience: Audience) =>
  tx<{ id: string; phone: string }[]>`
    select m.id, m.phone from members m
    left join (select member_id, max(ends_at) as ends from entitlements group by member_id) x on x.member_id = m.id
    where m.status = 'active' and m.phone is not null and m.sms_news
      and (${audience} = 'all'
           or (${audience} = 'current' and x.ends > now())
           or (${audience} = 'lapsed' and x.ends <= now() and x.ends > now() - interval '90 days'))`;

/** The text members receive: always opens with the club's name so they know who is writing. */
export const announcementBody = (club: string, text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.toLowerCase().startsWith(club.toLowerCase()) ? t : `${club}: ${t}`;
};

export interface AnnouncementPreview {
  recipients: number;
  unitsEach: number;
  units: number;
  costKes: number;
  balance: number;
  body: string;
}

export async function previewAnnouncement(
  sql: Sql,
  tenantId: string,
  a: { audience: Audience; text: string },
): Promise<AnnouncementPreview> {
  const platform = await platformSmsConfig(sql);
  return withTenant(sql, tenantId, async (tx) => {
    const [c] = await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`;
    const body = announcementBody(c?.name ?? '', a.text);
    const members = await audienceMembers(tx, a.audience);
    const club = await clubSms(tx, tenantId, platform);
    const recipients = members.filter((m) => msisdn(m.phone)).length;
    const unitsEach = smsUnits(body);
    return {
      recipients,
      unitsEach,
      units: recipients * unitsEach,
      costKes: Math.round(recipients * unitsEach * club.priceKes * 100) / 100,
      balance: club.balance,
      body,
    };
  });
}

/**
 * Queue an announcement the owner confirmed. Refused when credit does not cover it all (no half-sent news).
 * Members still get at most one non-urgent message a day and nothing during quiet hours; it lapses after 48 h.
 */
export async function queueAnnouncement(
  sql: Sql,
  tenantId: string,
  a: { audience: Audience; text: string; actor: string },
): Promise<{ ok: true; queued: number } | { ok: false; reason: 'empty' | 'credit' | 'off'; need?: number }> {
  const preview = await previewAnnouncement(sql, tenantId, a);
  if (a.text.trim().length < 5 || preview.recipients === 0) return { ok: false, reason: 'empty' };
  if (preview.units > preview.balance) return { ok: false, reason: 'credit', need: preview.units };
  return withTenant(sql, tenantId, async (tx) => {
    const n = await clubNotify(tx, tenantId);
    if (!n.enabled) return { ok: false as const, reason: 'off' as const };
    const id = randomUUID();
    const before = DateTime.now().plus({ hours: 48 }).toJSDate();
    let queued = 0;
    for (const m of await audienceMembers(tx, a.audience)) {
      if (!msisdn(m.phone)) continue;
      queued += (
        await queue(tx, tenantId, {
          phone: m.phone,
          body: preview.body,
          kind: 'announcement',
          key: `announce:${id}:${m.id}`,
          memberId: m.id,
          before,
        })
      ).length;
    }
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${a.actor}, 'sms.announcement', ${id}, ${tx.json({ audience: a.audience, recipients: queued, units: preview.units, body: preview.body } as never)})`;
    return { ok: true as const, queued };
  });
}

/**
 * NAVAC's own alerts (platform phone, platform sender, Nairobi daytime only):
 * - Source Code credit below the set level, at most once a day;
 * - a morning digest of club door PCs offline for over an hour, once a day.
 */
export async function platformAlerts(sql: Sql, client?: SourceCodeSms | null, at = DateTime.now()): Promise<number> {
  const cfg = await platformSmsConfig(sql);
  const phone = msisdn(cfg?.alertPhone);
  const sms = client ?? (await platformSms(sql));
  if (!phone || !sms) return 0;
  const local = at.setZone('Africa/Nairobi');
  if (local.hour < 8 || local.hour >= 20) return 0;
  const [row] = await sql<
    { s: { balance?: number } | null; o: { lowCreditAt?: string; bridgeDigest?: string } | null }[]
  >`
    select app_platform_get('sms_status') as s, app_platform_get('ops_alerts') as o`;
  const status = row?.s ?? {};
  const ops = row?.o ?? {};
  let sent = 0;
  const note = (d: Record<string, string>) => sql`select app_platform_note('ops_alerts', ${sql.json(d as never)})`;
  if (
    cfg?.lowCredit &&
    status.balance != null &&
    status.balance < cfg.lowCredit &&
    (!ops.lowCreditAt || Date.parse(ops.lowCreditAt) < at.toMillis() - 24 * 3600_000)
  ) {
    const r = await sms.send(
      phone,
      `Lango: Source Code SMS credit is ${status.balance.toLocaleString('en-KE')}, below your alert level of ${cfg.lowCredit.toLocaleString('en-KE')}. Top up at portal.sourcecode.co.ke so club messages keep flowing.`,
    );
    if (r.ok) sent++;
    await note({ lowCreditAt: at.toISO() as string });
  }
  const today = local.toISODate() as string;
  if (ops.bridgeDigest !== today) {
    const down = (
      await sql<{ club: string; site: string; last_seen_at: Date }[]>`select * from app_bridge_health()`
    ).filter((b) => b.last_seen_at.getTime() < Date.now() - 3600_000);
    if (down.length) {
      const list = down
        .slice(0, 6)
        .map(
          (b) =>
            `${b.club} ${b.site} (since ${DateTime.fromJSDate(b.last_seen_at, { zone: 'Africa/Nairobi' }).toFormat('d LLL HH:mm')})`,
        )
        .join('; ');
      const more = down.length > 6 ? ` and ${down.length - 6} more` : '';
      const r = await sms.send(
        phone,
        `Lango: ${down.length} club door PC${down.length === 1 ? '' : 's'} offline over 1 h: ${list}${more}.`,
      );
      if (r.ok) sent++;
    }
    await note({ bridgeDigest: today });
  }
  return sent;
}
