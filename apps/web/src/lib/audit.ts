import 'server-only';
import { withTenant } from '@lango/db';
import { db } from '@/server/db';

/**
 * System audit (3 Oct 2026): one timeline of sign-ins and team changes (auth_events) and everything done in the
 * club (audit_log), filterable by date, area and person.
 */
export const AUDIT_CATS = {
  team: {
    label: 'Sign-ins & team',
    match: [
      'signin.%',
      'club.opened',
      'invite.%',
      'role.%',
      'perms.%',
      'member.removed',
      'ownership.%',
      'signout.%',
      'password.%',
      'device.%',
      'code.%',
      'reset.%',
      'phone.%',
      'tech.%',
    ],
  },
  payments: { label: 'Payments', match: ['payment.%'] },
  members: {
    label: 'Members',
    match: ['member.created', 'member.sms_news', 'members.%', 'access.comp', 'access.override', 'reminders.%'],
  },
  services: { label: 'Services & prices', match: ['service.%', 'price.%'] },
  doors: { label: 'Doors', match: ['zone.%', 'bridge.%', 'access.tamper_reverted'] },
  messages: { label: 'Messages & SMS', match: ['sms.%', 'channel.%', 'settings.notifications'] },
  settings: { label: 'Settings', match: ['settings.taifapay', 'settings.channels', 'settings.payments'] },
} as const;
export type AuditCat = keyof typeof AUDIT_CATS;

export interface AuditRow {
  at: Date;
  kind: string;
  who: string | null;
  partner: boolean | null;
  target: string | null;
  member: string | null;
  member_no: number | null;
  ip: string | null;
  data: Record<string, unknown> | null;
}

export async function clubAudit(
  tenantId: string,
  o: { from: Date | null; to: Date | null; cat: string; who: string; limit: number; offset: number },
) {
  const pats = o.cat in AUDIT_CATS ? [...AUDIT_CATS[o.cat as AuditCat].match] : ['%'];
  const who = /^[0-9a-f-]{36}$/.test(o.who) ? o.who : '';
  return withTenant(db(), tenantId, async (tx) => {
    const names = await tx<
      { id: string; name: string; partner: boolean }[]
    >`select * from app_audit_names(${tenantId})`;
    const rows = await tx<(AuditRow & { full: number })[]>`
      with n as (select * from app_audit_names(${tenantId})),
      ev as (
        select e.at, e.kind, coalesce(e.actor, e.staff_id) as by_id, null::text as by_text,
               t.name as target, null::uuid as member_id, e.ip, e.data
        from auth_events e left join n t on t.id = e.staff_id and e.actor is not null and e.actor <> e.staff_id
        where e.tenant_id = ${tenantId}
        union all
        select a.at, a.action, case when a.actor ~ '^[0-9a-f-]{36}$' then a.actor::uuid end,
               case when a.actor !~ '^[0-9a-f-]{36}$' then a.actor end,
               null, coalesce(p.member_id, case when a.action like 'member%' and a.entity ~ '^[0-9a-f-]{36}$' then a.entity::uuid end),
               null, a.data
        from audit_log a left join payments p on a.action like 'payment.%' and p.id::text = a.entity
      )
      select count(*) over ()::int as full, ev.at, ev.kind, coalesce(n.name, ev.by_text) as who, n.partner,
             ev.target, m.first_name || ' ' || m.last_name as member, m.member_no, ev.ip, ev.data
      from ev left join n on n.id = ev.by_id left join members m on m.id = ev.member_id
      where (${o.from}::timestamptz is null or ev.at >= ${o.from})
        and (${o.to}::timestamptz is null or ev.at < ${o.to})
        and ev.kind like any(${pats})
        and (${who} = '' or ev.by_id::text = ${who})
      order by ev.at desc limit ${o.limit} offset ${o.offset}`;
    return { rows, count: rows[0]?.full ?? 0, people: names };
  });
}

const n = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-KE') : String(v ?? ''));

/** One plain sentence (after the person's name) and an optional detail for an event. */
export function describe(r: AuditRow): { text: string; detail?: string; cat: AuditCat } {
  const d = (r.data ?? {}) as Record<string, unknown>;
  const m = r.member ? `${r.member}${r.member_no ? ` (#${r.member_no})` : ''}` : 'a member';
  const t = r.target ?? 'someone';
  const map: Record<string, [string, AuditCat, string?]> = {
    'signin.ok': ['signed in', 'team', r.ip ?? undefined],
    'signin.fail': ['failed to sign in', 'team', r.ip ?? undefined],
    'code.fail': ['entered a wrong sign-in code', 'team', r.ip ?? undefined],
    'club.opened': ['opened the club', 'team', r.ip ?? undefined],
    'device.trusted': ['chose to remember this device', 'team'],
    'invite.sent': [r.target ? `invited ${t}` : 'was invited', 'team'],
    'invite.accepted': ['accepted the invitation', 'team'],
    'role.changed': [`changed ${t}’s role`, 'team', d.role ? `now ${n(d.role)}` : undefined],
    'perms.changed': [`changed ${t}’s permissions`, 'team'],
    'member.removed': [`removed ${t} from the team`, 'team'],
    'member.suspended': [`paused ${t}’s login`, 'team'],
    'member.restored': [`restored ${t}’s login`, 'team'],
    'ownership.offered': [`offered ownership to ${t}`, 'team'],
    'ownership.transferred': ['became the owner', 'team'],
    'signout.everywhere': ['signed out on every device', 'team'],
    'password.changed': ['changed their password', 'team'],
    'reset.done': ['reset their password', 'team'],
    'phone.changed': ['changed their phone number', 'team'],
    'payment.applied': [
      d.channel === 'cash' ? `recorded cash from ${m}` : `· M-Pesa payment from ${m}`,
      'payments',
      d.amount ? `KES ${n(d.amount)}` : undefined,
    ],
    'payment.assigned': [`matched a payment to ${m}`, 'payments', d.amount ? `KES ${n(d.amount)}` : undefined],
    'payment.unmatched': [
      'received a payment that matched no member',
      'payments',
      d.amount ? `KES ${n(d.amount)}` : undefined,
    ],
    'payment.unreadable': ['received a payment the gateway could not confirm', 'payments'],
    'member.created': [`added ${m}`, 'members'],
    'member.sms_news': [`changed club news for ${m}`, 'members'],
    'members.imported': [
      `imported ${n(d.created)} members`,
      'members',
      d.file ? `from ${n(d.file)}` : 'from the door system',
    ],
    'access.comp': [`gave ${m} complimentary access`, 'members', d.reason ? n(d.reason) : undefined],
    'access.override': [`changed ${m}’s access by hand`, 'members', d.reason ? n(d.reason) : undefined],
    'reminders.sent': [`sent renewal reminders to ${n(d.count)} members`, 'members'],
    'service.created': [`added the service ${n(d.name)}`, 'services'],
    'service.updated': [`edited the service ${n(d.name)}`, 'services'],
    'service.deleted': [d.kept ? 'stopped selling a service' : 'deleted a service', 'services'],
    'price.created': [
      `added a price of KES ${n(d.price)}`,
      'services',
      d.count ? `${n(d.count)} ${n(d.unit)}` : undefined,
    ],
    'price.updated': ['changed a price', 'services', d.price ? `KES ${n(d.price)}` : undefined],
    'zone.saved': [`saved the area ${n(d.name)}`, 'doors'],
    'zone.readers': ['linked door readers to an area', 'doors'],
    'bridge.offline': ['· the door PC went offline', 'doors'],
    'bridge.online': ['· the door PC came back online', 'doors'],
    'bridge.pair_code_reissued': ['issued a new door PC pairing code', 'doors'],
    'access.tamper_reverted': ['· a change made at the door PC was put back', 'doors'],
    'sms.announcement': ['sent club news', 'messages', d.recipients ? `${n(d.recipients)} members` : undefined],
    'sms.buy': ['bought SMS credit', 'messages'],
    'sms.topup_requested': ['asked for SMS credit by M-Pesa', 'messages', d.amount ? `KES ${n(d.amount)}` : undefined],
    'sms.topup_completed': ['· SMS credit was added', 'messages', d.units ? `${n(d.units)} SMS` : undefined],
    'sms.low_balance': [
      '· SMS credit ran low',
      'messages',
      d.balance !== undefined ? `${n(d.balance)} left` : undefined,
    ],
    'channel.saved': [
      `${d.enabled ? 'connected' : 'switched off'} ${n(d.channel) === 'whatsapp' ? 'WhatsApp' : n(d.channel)}`,
      'messages',
    ],
    'settings.notifications': ['changed what the club sends by SMS', 'messages'],
    'settings.taifapay': ['connected the Payment Gateway', 'settings', d.env ? n(d.env) : undefined],
    'settings.channels': ['set where members pay', 'settings', d.paybill ? `Paybill ${n(d.paybill)}` : undefined],
  };
  const hit = map[r.kind];
  if (hit) return { text: hit[0], cat: hit[1], detail: hit[2] };
  return { text: r.kind.replace(/[._]/g, ' '), cat: 'settings' };
}
