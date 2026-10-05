import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Sql, Tx } from '@lango/db';
import { withTenant } from '@lango/db';
import { nextCodeAt } from './accounts.js';
import { msisdn, platformSmsConfig, type SourceCodeSms, sendNow } from './sms.js';

/**
 * Member portal sign-in: phone number → 6-digit SMS code → in. Nothing to remember.
 * A phone can belong to active members at several clubs: one code is sent, it is valid for each of them, and the
 * portal asks which club once the code is right (never before, so a phone number alone reveals nothing).
 * Codes last 10 minutes and allow 5 tries; resends follow the same policy as staff codes (60 s, then 2, 5 and
 * 10 minutes; at most 5 an hour and 10 a day), and only ever go to that phone. When no club of the member can
 * send SMS, the portal falls back to asking for the member number.
 */
const TTL_MIN = 10;
const hash = (id: string, code: string) => createHash('sha256').update(`${id}:${code}`).digest('hex');

export interface MemberMatch {
  tenantId: string;
  club: string;
  memberId: string;
  memberNo: number;
}

/** Active memberships for a phone number, across clubs (at most 10). */
export async function membersByPhone(sql: Sql, phone: string): Promise<(MemberMatch & { phone: string })[]> {
  const n = msisdn(phone);
  if (!n) return [];
  const rows = await sql<{ tenant_id: string; club: string; member_id: string; member_no: number; phone: string }[]>`
    select * from app_members_by_phone(${n})`;
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    club: r.club,
    memberId: r.member_id,
    memberNo: r.member_no,
    phone: r.phone,
  }));
}

export type OtpRequest = 'sent' | 'unknown' | 'wait' | 'fallback';

const sentTimes = async (tx: Tx, memberId: string) =>
  (
    await tx<{ t: Date }[]>`select created_at as t from member_otps where member_id = ${memberId}
      and created_at > now() - interval '24 hours' order by created_at desc`
  ).map((r) => r.t.getTime());

/**
 * For the code screen: when the live code expires and when another may be sent. Unknown phones get the same
 * answer as a member who was just sent a code, so the screen never reveals who is a member.
 */
export async function memberOtpStatus(
  sql: Sql,
  phone: string,
): Promise<{ expiresAt: number; resendAt: number; capped: boolean }> {
  const [m] = await membersByPhone(sql, phone);
  if (!m) return { expiresAt: Date.now() + TTL_MIN * 60_000, resendAt: Date.now() + 60_000, capped: false };
  return withTenant(sql, m.tenantId, async (tx) => {
    const [live] = await tx<{ expires_at: Date }[]>`select expires_at from member_otps where member_id = ${m.memberId}
      and used_at is null and expires_at > now() order by created_at desc limit 1`;
    const next = nextCodeAt(await sentTimes(tx, m.memberId));
    return { expiresAt: live?.expires_at.getTime() ?? Date.now(), resendAt: next.at, capped: next.capped };
  });
}

export async function requestOtp(sql: Sql, phone: string, client?: SourceCodeSms | null): Promise<OtpRequest> {
  const ms = await membersByPhone(sql, phone);
  const first = ms[0];
  if (!first) return 'unknown';
  // The resend allowance follows the phone: the first membership carries it (the others get the same code).
  const wait = await withTenant(
    sql,
    first.tenantId,
    async (tx) => nextCodeAt(await sentTimes(tx, first.memberId)).at > Date.now(),
  );
  if (wait) return 'wait';
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const ids = new Map<string, string>();
  for (const m of ms) {
    const id = randomUUID();
    ids.set(m.memberId, id);
    await withTenant(
      sql,
      m.tenantId,
      (tx) => tx`insert into member_otps (id, tenant_id, member_id, code_hash, expires_at)
        values (${id}, ${m.tenantId}, ${m.memberId}, ${hash(id, code)}, now() + make_interval(mins => ${TTL_MIN}))`,
    );
  }
  const who = ms.length === 1 ? `${first.club}: your` : 'Your club';
  const body = `${who} sign-in code is ${code}. It expires in ${TTL_MIN} minutes. Never share it.`;
  // Sent on the first club that can send SMS (its credit pays for it).
  for (const m of ms) {
    const sent = await sendNow(sql, m.tenantId, { phone: m.phone, body, kind: 'otp', memberId: m.memberId }, client);
    if (sent) return 'sent';
  }
  // Not delivered: forget it, so it does not count against the member's resend allowance.
  for (const m of ms)
    await withTenant(sql, m.tenantId, (tx) => tx`delete from member_otps where id = ${ids.get(m.memberId) ?? ''}`);
  return 'fallback';
}

/** The memberships the code is right for (one, or several when the phone is a member at several clubs). */
export async function verifyOtp(sql: Sql, phone: string, code: string): Promise<MemberMatch[]> {
  if (!/^\d{6}$/.test(code)) return [];
  const ok: MemberMatch[] = [];
  for (const m of await membersByPhone(sql, phone)) {
    const right = await withTenant(sql, m.tenantId, async (tx) => {
      const [o] = await tx<{ id: string; code_hash: string }[]>`
        update member_otps set attempts = attempts + 1
        where id = (select id from member_otps where member_id = ${m.memberId} and used_at is null
                    and expires_at > now() and attempts < 5 order by created_at desc limit 1)
        returning id, code_hash`;
      if (!o) return false;
      const a = Buffer.from(hash(o.id, code));
      const b = Buffer.from(o.code_hash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
      await tx`update member_otps set used_at = now() where id = ${o.id}`;
      return true;
    });
    if (right) ok.push({ tenantId: m.tenantId, club: m.club, memberId: m.memberId, memberNo: m.memberNo });
  }
  return ok;
}

/** Whether a club of this phone can send SMS codes right now (else the portal asks for the member number). */
export async function otpAvailable(sql: Sql, phone: string): Promise<boolean> {
  const ms = await membersByPhone(sql, phone);
  if (!ms.length) return true; // unknown phones get the same screen as everyone else
  if (!(await platformSmsConfig(sql))?.apiKey) return false;
  for (const t of new Set(ms.map((m) => m.tenantId))) {
    const can = await withTenant(sql, t, async (tx) => {
      const [s] = await tx<{ on: boolean | null }[]>`
        select (data->'notifications'->>'enabled')::boolean as on from tenant_settings where tenant_id = ${t}`;
      const [b] = await tx<{ units: string | null }[]>`select sum(units) as units from sms_ledger`;
      return !!s?.on && Number(b?.units ?? 0) > 0;
    });
    if (can) return true;
  }
  return false;
}
