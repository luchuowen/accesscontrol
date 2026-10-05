import { createHash, randomInt, randomUUID } from 'node:crypto';
import { type Sql, type Tx, withTenant } from '@lango/db';
import { DateTime } from 'luxon';
import { rebuildAccessState } from './access.js';
import { msisdn, type SourceCodeSms, sendNow } from './sms.js';

/**
 * Member self-service, phase 2 (decided 5 Oct 2026): block a lost card, pause a membership, change phone, emergency
 * contact. Every change is recorded in the audit log and confirmed to the member by SMS.
 */

/** What the club allows members to do on their own (Settings › Club › Member self-service). */
export interface MemberRules {
  pause: { enabled: boolean; minDays: number; maxDays: number; perYear: number };
  card: { replaceFeeKes: number };
  guest: { enabled: boolean; perMonth: number };
  /** Shown on the member page under "Club". */
  info: { hours: string; address: string; phone: string };
}
export const DEFAULT_RULES: MemberRules = {
  pause: { enabled: true, minDays: 3, maxDays: 30, perYear: 60 },
  card: { replaceFeeKes: 0 },
  guest: { enabled: true, perMonth: 4 },
  info: { hours: '', address: '', phone: '' },
};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const clamp = (n: unknown, lo: number, hi: number, d: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};
export function normaliseRules(raw: unknown): MemberRules {
  const r = (raw ?? {}) as {
    pause?: Partial<MemberRules['pause']>;
    card?: Partial<MemberRules['card']>;
    guest?: Partial<MemberRules['guest']>;
    info?: Partial<MemberRules['info']>;
  };
  const d = DEFAULT_RULES;
  const minDays = clamp(r.pause?.minDays, 1, 90, d.pause.minDays);
  const maxDays = Math.max(minDays, clamp(r.pause?.maxDays, 1, 180, d.pause.maxDays));
  return {
    pause: {
      enabled: r.pause?.enabled ?? d.pause.enabled,
      minDays,
      maxDays,
      perYear: Math.max(maxDays, clamp(r.pause?.perYear, 1, 365, d.pause.perYear)),
    },
    card: { replaceFeeKes: clamp(r.card?.replaceFeeKes, 0, 100_000, d.card.replaceFeeKes) },
    guest: {
      enabled: r.guest?.enabled ?? d.guest.enabled,
      perMonth: clamp(r.guest?.perMonth, 1, 31, d.guest.perMonth),
    },
    info: { hours: text(r.info?.hours, 400), address: text(r.info?.address, 160), phone: text(r.info?.phone, 20) },
  };
}
export async function memberRules(tx: Tx, tenantId: string): Promise<MemberRules> {
  const [r] = await tx<{ rules: unknown }[]>`
    select data->'memberRules' as rules from tenant_settings where tenant_id = ${tenantId}`;
  return normaliseRules(r?.rules);
}

async function tell(tx: Tx, tenantId: string, memberId: string, body: string, key: string) {
  const [m] = await tx<{ phone: string | null }[]>`select phone from members where id = ${memberId}`;
  if (!m?.phone) return;
  await tx`insert into sms_messages (tenant_id, member_id, phone, body, kind, dedupe_key)
           values (${tenantId}, ${memberId}, ${m.phone}, ${body}, 'system', ${key})
           on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing`;
}
const club = async (tx: Tx, tenantId: string) =>
  (await tx<{ name: string; timezone: string }[]>`select name, timezone from tenants where id = ${tenantId}`)[0] ?? {
    name: 'Your club',
    timezone: 'Africa/Nairobi',
  };

// ── Lost card ────────────────────────────────────────────────────────────────────────────────────────────────

/** Block every card of the member at once (door access held until a new card is linked or the card is found). */
export async function blockCards(sql: Sql, tenantId: string, memberId: string, actor: string): Promise<number> {
  return withTenant(sql, tenantId, async (tx) => {
    const cards = await tx<{ card_code: bigint }[]>`
      update credentials set revoked_at = now(), revoked_reason = 'lost'
      where member_id = ${memberId} and revoked_at is null returning card_code`;
    await tx`update members set cards_blocked_at = coalesce(cards_blocked_at, now()) where id = ${memberId}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${actor}, 'card.blocked', ${memberId}, ${tx.json({ cards: cards.map((c) => Number(c.card_code)) } as never)})`;
    await rebuildAccessState(tx, tenantId, memberId);
    const t = await club(tx, tenantId);
    await tell(
      tx,
      tenantId,
      memberId,
      `${t.name}: your card is blocked and no longer opens the doors. Your days are kept. Collect a new card at reception.`,
      `card-blocked:${memberId}:${Date.now()}`,
    );
    return cards.length;
  });
}

/** The member found the card: lift the block and switch back on the cards they blocked themselves. */
export async function unblockCards(sql: Sql, tenantId: string, memberId: string, actor: string): Promise<void> {
  await withTenant(sql, tenantId, async (tx) => {
    const cards = await tx<{ card_code: bigint }[]>`
      update credentials set revoked_at = null, revoked_reason = null
      where member_id = ${memberId} and revoked_reason = 'lost' returning card_code`;
    await tx`update members set cards_blocked_at = null where id = ${memberId}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${actor}, 'card.unblocked', ${memberId}, ${tx.json({ cards: cards.map((c) => Number(c.card_code)) } as never)})`;
    await rebuildAccessState(tx, tenantId, memberId);
  });
}

// ── Pause ────────────────────────────────────────────────────────────────────────────────────────────────────

export type PauseQuote =
  | { ok: true; from: Date; until: Date; days: number; newEnd: Date; oldEnd: Date }
  | { ok: false; why: string };

/** Check a pause against the club's rules and work out its effect, without changing anything. */
export async function quotePause(
  tx: Tx,
  tenantId: string,
  memberId: string,
  a: { start: string; days: number },
): Promise<PauseQuote> {
  const rules = (await memberRules(tx, tenantId)).pause;
  if (!rules.enabled) return { ok: false, why: 'This club does not take pauses online. Ask at reception.' };
  const t = await club(tx, tenantId);
  const today = DateTime.now().setZone(t.timezone).startOf('day');
  const from = DateTime.fromISO(a.start, { zone: t.timezone }).startOf('day');
  if (!from.isValid || from < today.plus({ days: 1 }) || from > today.plus({ days: 30 }))
    return { ok: false, why: 'Pick a start date from tomorrow up to 30 days ahead.' };
  if (!Number.isInteger(a.days) || a.days < rules.minDays || a.days > rules.maxDays)
    return { ok: false, why: `A pause is ${rules.minDays} to ${rules.maxDays} days.` };
  const until = from.plus({ days: a.days });
  const [open] =
    await tx`select 1 from member_pauses where member_id = ${memberId} and status = 'on' and ends_at > now()`;
  if (open) return { ok: false, why: 'You already have a pause. End it before starting another.' };
  const [used] = await tx<{ days: number }[]>`
    select coalesce(sum(extract(epoch from (ends_at - starts_at)) / 86400), 0)::int as days from member_pauses
    where member_id = ${memberId} and status = 'on' and starts_at > now() - interval '365 days'`;
  if ((used?.days ?? 0) + a.days > rules.perYear)
    return {
      ok: false,
      why: `You can pause up to ${rules.perYear} days a year; ${Math.max(0, rules.perYear - (used?.days ?? 0))} are left.`,
    };
  const ext = await extensionFor(tx, memberId, from.toJSDate(), until.toJSDate());
  if (!ext.length) return { ok: false, why: 'Your plan ends before that date, so there is nothing to pause.' };
  const oldEnd = new Date(Math.max(...ext.map((e) => e.end.getTime())));
  const newEnd = new Date(Math.max(...ext.map((e) => e.end.getTime() + e.ms)));
  return { ok: true, from: from.toJSDate(), until: until.toJSDate(), days: a.days, newEnd, oldEnd };
}

/** Per zone: how much access the window takes away, and where that zone's access currently ends. */
async function extensionFor(tx: Tx, memberId: string, from: Date, until: Date) {
  const ents = await tx<
    { zone_key: string; service_id: string | null; product_id: string | null; starts_at: Date; ends_at: Date }[]
  >`select zone_key, service_id, product_id, starts_at, ends_at from entitlements
    where member_id = ${memberId} and ends_at > ${from} order by zone_key, starts_at`;
  type Ent = (typeof ents)[number];
  const zones = new Map<string, Ent[]>();
  for (const e of ents) zones.set(e.zone_key, [...(zones.get(e.zone_key) ?? []), e]);
  const out: { zone: string; service_id: string | null; product_id: string | null; end: Date; ms: number }[] = [];
  for (const [zone, list] of zones) {
    // Union of the zone's intervals, then the part of it inside the window.
    let ms = 0;
    let curS = 0;
    let curE = 0;
    const flush = () => {
      ms += Math.max(0, Math.min(curE, until.getTime()) - Math.max(curS, from.getTime()));
    };
    for (const e of list) {
      const s = e.starts_at.getTime();
      const en = e.ends_at.getTime();
      if (s > curE) {
        flush();
        curS = s;
        curE = en;
      } else curE = Math.max(curE, en);
    }
    flush();
    if (ms <= 0) continue;
    const last = list.reduce((a, b) => (b.ends_at > a.ends_at ? b : a));
    out.push({ zone, service_id: last.service_id, product_id: last.product_id, end: last.ends_at, ms });
  }
  return out;
}

export async function startPause(
  sql: Sql,
  tenantId: string,
  memberId: string,
  a: { start: string; days: number; reason: string },
  actor: string,
): Promise<PauseQuote> {
  return withTenant(sql, tenantId, async (tx) => {
    await tx`select 1 from members where id = ${memberId} for update`;
    const q = await quotePause(tx, tenantId, memberId, a);
    if (!q.ok) return q;
    const reason = a.reason.trim().slice(0, 120) || 'Pause';
    const [p] = await tx<{ id: string }[]>`
      insert into member_pauses (tenant_id, member_id, starts_at, ends_at, reason, created_by)
      values (${tenantId}, ${memberId}, ${q.from}, ${q.until}, ${reason.length < 2 ? 'Pause' : reason}, ${actor}) returning id`;
    for (const e of await extensionFor(tx, memberId, q.from, q.until))
      await tx`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source, source_id, service_id, product_id)
               values (${tenantId}, ${memberId}, ${e.zone}, ${e.end}, ${new Date(e.end.getTime() + e.ms)}, 'pause', ${p?.id ?? null},
                       ${e.service_id}, ${e.product_id})`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${actor}, 'pause.started', ${memberId}, ${tx.json({ from: q.from, until: q.until, days: q.days, reason } as never)})`;
    await rebuildAccessState(tx, tenantId, memberId);
    const t = await club(tx, tenantId);
    const d = (x: Date) => DateTime.fromJSDate(x, { zone: t.timezone }).toFormat('d LLL');
    await tell(
      tx,
      tenantId,
      memberId,
      `${t.name}: your membership is paused ${d(q.from)} to ${d(new Date(q.until.getTime() - 1))}. It now ends ${d(q.newEnd)}.`,
      `pause:${p?.id}`,
    );
    return q;
  });
}

/** End the member's pause: a pause not started yet is cancelled; a running one ends now and the unused days go back. */
export async function endPause(sql: Sql, tenantId: string, memberId: string, actor: string): Promise<boolean> {
  return withTenant(sql, tenantId, async (tx) => {
    const [p] = await tx<{ id: string; starts_at: Date; ends_at: Date }[]>`
      select id, starts_at, ends_at from member_pauses where member_id = ${memberId} and status = 'on' and ends_at > now()
      order by starts_at limit 1 for update`;
    if (!p) return false;
    const now = new Date();
    if (p.starts_at > now) {
      await tx`update member_pauses set status = 'cancelled', ended_by = ${actor} where id = ${p.id}`;
      await tx`delete from entitlements where source = 'pause' and source_id = ${p.id}`;
    } else {
      const unused = p.ends_at.getTime() - now.getTime();
      await tx`update member_pauses set ends_at = ${now}, ended_by = ${actor} where id = ${p.id}`;
      await tx`update entitlements set ends_at = ends_at - make_interval(secs => ${unused / 1000})
               where source = 'pause' and source_id = ${p.id}`;
      await tx`delete from entitlements where source = 'pause' and source_id = ${p.id} and ends_at <= starts_at`;
    }
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${actor}, 'pause.ended', ${memberId}, ${tx.json({ pause: p.id, early: p.starts_at <= now } as never)})`;
    await rebuildAccessState(tx, tenantId, memberId);
    return true;
  });
}

// ── My details ───────────────────────────────────────────────────────────────────────────────────────────────

const hash = (id: string, code: string) => createHash('sha256').update(`phone:${id}:${code}`).digest('hex');

/** Send a code to the NEW phone; the change happens only when that code comes back. */
export async function requestPhoneChange(
  sql: Sql,
  tenantId: string,
  memberId: string,
  phone: string,
  client?: SourceCodeSms | null,
): Promise<'sent' | 'invalid' | 'same' | 'wait' | 'failed'> {
  const n = msisdn(phone);
  if (!n) return 'invalid';
  const ok = await withTenant(sql, tenantId, async (tx) => {
    const [m] = await tx<{ phone: string | null }[]>`select phone from members where id = ${memberId}`;
    if (m?.phone && msisdn(m.phone) === n) return 'same' as const;
    const [recent] = await tx<{ n: number }[]>`
      select count(*)::int as n from member_otps where purpose = 'phone' and member_id = ${memberId} and created_at > now() - interval '15 minutes'`;
    if ((recent?.n ?? 0) >= 3) return 'wait' as const;
    return 'ok' as const;
  });
  if (ok !== 'ok') return ok;
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await withTenant(
    sql,
    tenantId,
    (tx) => tx`insert into member_otps (id, tenant_id, member_id, code_hash, expires_at, purpose)
      values (${id}, ${tenantId}, ${memberId}, ${hash(id, `${n}:${code}`)}, now() + interval '10 minutes', 'phone')`,
  );
  const t = await withTenant(sql, tenantId, (tx) => club(tx, tenantId));
  const sent = await sendNow(
    sql,
    tenantId,
    {
      phone: n,
      body: `${t.name}: your code to confirm this phone number is ${code}. Never share it.`,
      kind: 'otp',
      memberId,
    },
    client,
  );
  if (!sent) {
    await withTenant(sql, tenantId, (tx) => tx`delete from member_otps where id = ${id}`);
    return 'failed';
  }
  return 'sent';
}

export async function confirmPhoneChange(
  sql: Sql,
  tenantId: string,
  memberId: string,
  phone: string,
  code: string,
): Promise<boolean> {
  const n = msisdn(phone);
  if (!n || !/^\d{6}$/.test(code)) return false;
  return withTenant(sql, tenantId, async (tx) => {
    const [o] = await tx<{ id: string; code_hash: string }[]>`
      update member_otps set attempts = attempts + 1
      where id = (select id from member_otps where purpose = 'phone' and member_id = ${memberId} and used_at is null and expires_at > now()
                  and attempts < 5 order by created_at desc limit 1)
      returning id, code_hash`;
    if (!o || hash(o.id, `${n}:${code}`) !== o.code_hash) return false;
    await tx`update member_otps set used_at = now() where id = ${o.id}`;
    const [old] = await tx<{ phone: string | null }[]>`select phone from members where id = ${memberId}`;
    const local = n.replace(/^254/, '0');
    await tx`update members set phone = ${local} where id = ${memberId}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, 'member', 'member.phone_changed', ${memberId}, ${tx.json({ from: old?.phone ?? null, to: local } as never)})`;
    await rebuildAccessState(tx, tenantId, memberId);
    // Tell the old number too, so a change the member did not make is noticed.
    if (old?.phone && msisdn(old.phone) !== n) {
      const t = await club(tx, tenantId);
      await tx`insert into sms_messages (tenant_id, member_id, phone, body, kind, dedupe_key)
               values (${tenantId}, ${memberId}, ${old.phone}, ${`${t.name}: the phone number on your membership was changed to ${local.slice(0, 4)}•••${local.slice(-3)}. If this was not you, call the club.`}, 'system', ${`phone-changed:${o.id}`})
               on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing`;
    }
    return true;
  });
}

export async function setEmergencyContact(
  sql: Sql,
  tenantId: string,
  memberId: string,
  a: { name: string; phone: string },
): Promise<boolean> {
  const name = a.name.trim().slice(0, 80);
  const phone = a.phone.replace(/[^\d+]/g, '').slice(0, 20);
  if ((name && !phone) || (phone && !msisdn(phone))) return false;
  await withTenant(
    sql,
    tenantId,
    (tx) =>
      tx`update members set emergency_name = ${name || null}, emergency_phone = ${phone || null} where id = ${memberId}`,
  );
  return true;
}
