import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Sql } from '@lango/db';
import { hashPassword } from './auth.js';
import { accountEmail, sendEmail } from './email.js';
import { msisdn, platformSms, type SourceCodeSms } from './sms.js';

/**
 * Section 1 · Sign-in and accounts. Server-side sessions, invitations, password resets, sign-in codes and
 * remembered devices. Tokens are random, single use and stored only as SHA-256 hashes.
 */

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  tenant_id: string | null;
  partner_id: string | null;
  active: boolean;
  accepted_at: Date | null;
}

export const staffById = async (sql: Sql, id: string) =>
  (await sql<StaffRow[]>`select * from app_staff_get(${id})`)[0] ?? null;
export const staffByEmail = async (sql: Sql, email: string) =>
  (await sql<StaffRow[]>`select * from app_staff_by_email(${email})`)[0] ?? null;

const isPlatformOrPartner = (s: Pick<StaffRow, 'role'>) => s.role === 'partner_admin';

// ---------- passwords ----------

/** A short list of passwords people choose most often; the full check is against Have I Been Pwned. */
const COMMON = new Set(
  [
    'password',
    'password1',
    'password123',
    'passw0rd',
    'p@ssw0rd',
    '1234567890',
    '0123456789',
    'qwertyuiop',
    'qwerty12345',
    'iloveyou123',
    'welcome123',
    'admin12345',
    'letmein123',
    'abcdefghij',
    '1q2w3e4r5t',
    'kenya12345',
    'nairobi123',
    'lango12345',
    'changeme123',
    'football123',
  ].map((p) => p.toLowerCase()),
);

/**
 * How many times a password appears in known breaches (Have I Been Pwned range API: only the first 5 characters
 * of its SHA-1 leave the server). Returns 0 when the service cannot be reached, so sign-up never stalls.
 */
export async function pwnedCount(pw: string, f: typeof fetch = fetch): Promise<number> {
  const h = createHash('sha1').update(pw).digest('hex').toUpperCase();
  try {
    const r = await f(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return 0;
    const line = (await r.text()).split('\n').find((l) => l.startsWith(h.slice(5)));
    return line ? Number(line.split(':')[1]) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Plain-words reason a password is refused, or null. NIST 800-63B: length and blocklist, no symbol rules. */
export async function passwordProblem(pw: string, email?: string, f?: typeof fetch): Promise<string | null> {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 128) return 'Use at most 128 characters.';
  const low = pw.toLowerCase();
  const local = email?.split('@')[0]?.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw) || (local && local.length >= 4 && low.includes(local)))
    return 'That password is too easy to guess. Try a short phrase only you would use.';
  if ((await pwnedCount(pw, f)) > 0)
    return 'That password has appeared in a data breach elsewhere, so it is not safe. Choose another.';
  return null;
}

// ---------- sessions ----------

export interface LiveSession {
  sid: string;
  uid: string;
  tid: string;
  role: string;
  name: string;
  email: string;
  partner?: boolean;
}

/** NAVAC and partners: 30 min idle, 8 h at most. Club staff: 2 h idle, 12 h at most (a full shift). */
export const sessionLimits = (role: string) =>
  role === 'partner_admin' ? { idleMinutes: 30, maxHours: 8 } : { idleMinutes: 120, maxHours: 12 };

export async function createSession(
  sql: Sql,
  s: { staff: StaffRow; ip?: string; userAgent?: string },
): Promise<{ token: string; maxHours: number }> {
  const token = newToken();
  const lim = sessionLimits(s.staff.role);
  await sql`insert into auth_sessions (token_hash, staff_id, tenant_id, idle_minutes, expires_at, ip, user_agent)
            values (${sha(token)}, ${s.staff.id}, ${isPlatformOrPartner(s.staff) ? null : s.staff.tenant_id},
                    ${lim.idleMinutes}, now() + make_interval(hours => ${lim.maxHours}),
                    ${s.ip ?? null}, ${(s.userAgent ?? '').slice(0, 300) || null})`;
  return { token, maxHours: lim.maxHours };
}

/** The live session for a cookie token, or null (expired, idle too long, revoked, or account switched off). */
export async function readSession(sql: Sql, token: string | undefined): Promise<LiveSession | null> {
  if (!token || token.length < 20) return null;
  const [s] = await sql<
    {
      id: string;
      staff_id: string;
      tenant_id: string | null;
      acting_role: string | null;
      idle_minutes: number;
      last_seen_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
    }[]
  >`select id, staff_id, tenant_id, acting_role, idle_minutes, last_seen_at, expires_at, revoked_at
    from auth_sessions where token_hash = ${sha(token)}`;
  if (!s || s.revoked_at || s.expires_at.getTime() <= Date.now()) return null;
  if (Date.now() - s.last_seen_at.getTime() > s.idle_minutes * 60_000) {
    await sql`update auth_sessions set revoked_at = now(), revoked_reason = 'idle' where id = ${s.id} and revoked_at is null`;
    return null;
  }
  const staff = await staffById(sql, s.staff_id);
  if (!staff?.active) return null;
  if (Date.now() - s.last_seen_at.getTime() > 60_000)
    await sql`update auth_sessions set last_seen_at = now() where id = ${s.id}`;
  const partner = staff.role === 'partner_admin';
  return {
    sid: s.id,
    uid: staff.id,
    tid: s.tenant_id ?? (partner ? '' : (staff.tenant_id ?? '')),
    role: s.acting_role ?? staff.role,
    name: staff.name,
    email: staff.email,
    ...(partner ? { partner: true } : {}),
  };
}

/** Why a session ended (for the Signed out screen). */
export async function sessionEndReason(sql: Sql, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const [s] = await sql<{ revoked_reason: string | null; expires_at: Date }[]>`
    select revoked_reason, expires_at from auth_sessions where token_hash = ${sha(token)}`;
  if (!s) return null;
  return s.revoked_reason ?? (s.expires_at.getTime() <= Date.now() ? 'expired' : null);
}

export async function revokeSession(sql: Sql, token: string, reason = 'signed-out') {
  await sql`update auth_sessions set revoked_at = now(), revoked_reason = ${reason}
            where token_hash = ${sha(token)} and revoked_at is null`;
}

export async function revokeAllSessions(sql: Sql, staffId: string, reason: string, exceptToken?: string) {
  const keep = exceptToken ? sha(exceptToken) : '';
  const r = await sql`update auth_sessions set revoked_at = now(), revoked_reason = ${reason}
            where staff_id = ${staffId} and revoked_at is null and token_hash <> ${keep} returning id`;
  return r.length;
}

/** A partner opening one of their clubs works in it as its owner, inside the same session. */
export async function setSessionClub(sql: Sql, token: string, tenantId: string | null, actingRole: string | null) {
  await sql`update auth_sessions set tenant_id = ${tenantId}, acting_role = ${actingRole}
            where token_hash = ${sha(token)} and revoked_at is null`;
}

// ---------- remembered devices ----------

export const deviceDays = (role: string) => (role === 'partner_admin' ? 7 : 30);

export async function rememberDevice(sql: Sql, staff: StaffRow, userAgent?: string) {
  const token = newToken();
  const days = deviceDays(staff.role);
  await sql`insert into trusted_devices (token_hash, staff_id, expires_at, user_agent)
            values (${sha(token)}, ${staff.id}, now() + make_interval(days => ${days}), ${(userAgent ?? '').slice(0, 300) || null})`;
  return { token, days };
}

export async function isTrustedDevice(sql: Sql, token: string | undefined, staffId: string) {
  if (!token) return false;
  const [d] = await sql`select 1 from trusted_devices
                        where token_hash = ${sha(token)} and staff_id = ${staffId} and expires_at > now()`;
  return !!d;
}

// ---------- single-use links ----------

type Kind = 'invite' | 'reset';
const TTL: Record<Kind, number> = { invite: 7 * 24 * 3600_000, reset: 30 * 60_000 };

async function issueLink(sql: Sql, kind: Kind, staffId: string, createdBy: string | null, data?: unknown) {
  const token = newToken();
  // Only the newest link of a kind works: earlier ones stop working when a new one is sent.
  await sql`update auth_tokens set used_at = now() where staff_id = ${staffId} and kind = ${kind} and used_at is null`;
  await sql`insert into auth_tokens (kind, token_hash, staff_id, created_by, expires_at, data)
            values (${kind}, ${sha(token)}, ${staffId}, ${createdBy}, ${new Date(Date.now() + TTL[kind])},
                    ${data ? sql.json(data as never) : null})`;
  return token;
}

export type LinkState =
  | { ok: true; staff: StaffRow; tokenId: string; data: Record<string, unknown> | null; expiresAt: Date }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'expired' | 'used'; staff: StaffRow };

/** Look a link up without using it (to show the right screen). */
export async function checkLink(sql: Sql, kind: Kind, token: string): Promise<LinkState> {
  if (!token || token.length < 20) return { ok: false, reason: 'invalid' };
  const [t] = await sql<
    { id: string; staff_id: string; expires_at: Date; used_at: Date | null; data: Record<string, unknown> | null }[]
  >`select id, staff_id, expires_at, used_at, data from auth_tokens where token_hash = ${sha(token)} and kind = ${kind}`;
  if (!t) return { ok: false, reason: 'invalid' };
  const staff = await staffById(sql, t.staff_id);
  if (!staff) return { ok: false, reason: 'invalid' };
  if (t.used_at) return { ok: false, reason: 'used', staff };
  if (t.expires_at.getTime() <= Date.now()) return { ok: false, reason: 'expired', staff };
  return { ok: true, staff, tokenId: t.id, data: t.data, expiresAt: t.expires_at };
}

/** Mark a link used; true only for the one request that wins (a double click cannot use it twice). */
async function useLink(sql: Sql, tokenId: string) {
  const r = await sql`update auth_tokens set used_at = now() where id = ${tokenId} and used_at is null
                      and expires_at > now() returning id`;
  return r.length === 1;
}

// ---------- invitations ----------

export interface InviteContext {
  inviterName: string;
  /** "Muthaiga Golf Club" or "Trisol" */
  to: string;
  roleLabel: string;
  /** shown under the button, e.g. "Next you'll review your quote and pay the setup fee." */
  next?: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  reception: 'Front desk',
  accountant: 'Accountant',
  partner_admin: 'Partner admin',
};
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;

async function sendInvite(
  sql: Sql,
  staff: StaffRow,
  token: string,
  baseUrl: string,
  ctx: InviteContext,
  sms?: SourceCodeSms | null,
) {
  const url = `${baseUrl}/invite/${token}`;
  const first = staff.name.split(' ')[0] || staff.name;
  const mail = accountEmail({
    heading: `You're invited to ${ctx.to} on Lango`,
    paragraphs: [
      `Hi ${first},`,
      `${ctx.inviterName} has invited you to join ${ctx.to} on Lango as ${ctx.roleLabel}. Lango runs memberships, payments and door access in one place.`,
    ],
    button: { label: 'Accept invitation', url },
    after: [
      `The link works once and expires in 7 days.${ctx.next ? ` ${ctx.next}` : ''}`,
      'Not expecting this? You can ignore this email; nothing happens unless you accept.',
    ],
  });
  const emailed = await sendEmail(sql, {
    to: staff.email,
    subject: `Your invitation to ${ctx.to} on Lango`,
    ...mail,
    kind: 'invite',
    key: `invite:${sha(token).slice(0, 32)}`,
    tenantId: staff.tenant_id ?? undefined,
  });
  // An SMS nudge so an email in spam does not stall a club. Sent from NAVAC's sender, free to the club.
  let texted = false;
  const to = msisdn(staff.phone);
  const client = sms === undefined ? await platformSms(sql) : sms;
  if (to && client) {
    try {
      texted = (
        await client.send(
          to,
          `${ctx.inviterName} invited you to ${ctx.to} on Lango. Check ${staff.email} for the link (from Lango). It expires in 7 days.`.slice(
            0,
            160,
          ),
        )
      ).ok;
    } catch {
      texted = false;
    }
  }
  return { emailed, texted };
}

/** Invite a colleague, a partner login, or (inviter = partner) a club owner. Creates the account switched off. */
export async function inviteStaff(
  sql: Sql,
  a: {
    inviterId: string;
    email: string;
    name: string;
    phone?: string;
    role: string;
    tenantId: string | null;
    partnerId?: string | null;
    baseUrl: string;
    ctx: InviteContext;
  },
  sms?: SourceCodeSms | null,
) {
  const [r] = await sql<{ id: string }[]>`
    select app_invite_staff(${a.inviterId}, ${a.email}, ${a.name}, ${msisdn(a.phone) ?? ''}, ${a.role},
                            ${a.tenantId}, ${a.partnerId ?? null}) as id`;
  const staff = await staffById(sql, r?.id as string);
  if (!staff) throw new Error('invite failed');
  const token = await issueLink(sql, 'invite', staff.id, a.inviterId, { ctx: a.ctx });
  return { staffId: staff.id, ...(await sendInvite(sql, staff, token, a.baseUrl, a.ctx, sms)) };
}

/** The owner account of a club a partner has just created waits for its emailed invitation. */
export async function inviteClubOwner(
  sql: Sql,
  a: { partnerStaffId: string; tenantId: string; baseUrl: string; ctx: InviteContext; phone?: string },
  sms?: SourceCodeSms | null,
) {
  const [r] = await sql<
    { id: string | null }[]
  >`select app_club_owner_pending(${a.partnerStaffId}, ${a.tenantId}) as id`;
  if (!r?.id) throw new Error('owner already active');
  if (a.phone) await sql`select app_staff_set_phone(${r.id}, ${msisdn(a.phone) ?? ''})`;
  const staff = await staffById(sql, r.id);
  if (!staff) throw new Error('owner missing');
  const token = await issueLink(sql, 'invite', staff.id, a.partnerStaffId, { ctx: a.ctx });
  return { staffId: staff.id, ...(await sendInvite(sql, staff, token, a.baseUrl, a.ctx, sms)) };
}

/** A fresh link for a pending invitation (the old one stops working). */
export async function resendInvite(
  sql: Sql,
  staffId: string,
  actorId: string | null,
  baseUrl: string,
  sms?: SourceCodeSms | null,
) {
  const staff = await staffById(sql, staffId);
  if (!staff || staff.accepted_at) return { ok: false as const };
  const [last] = await sql<{ data: { ctx?: InviteContext } | null }[]>`
    select data from auth_tokens where staff_id = ${staffId} and kind = 'invite' order by created_at desc limit 1`;
  const ctx = last?.data?.ctx ?? { inviterName: 'Your administrator', to: 'Lango', roleLabel: roleLabel(staff.role) };
  const token = await issueLink(sql, 'invite', staffId, actorId, { ctx });
  return { ok: true as const, ...(await sendInvite(sql, staff, token, baseUrl, ctx, sms)) };
}

export type AcceptResult =
  | { ok: true; staff: StaffRow }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'password'; message?: string };

/** Accept an invitation: set the password (checked), switch the account on, tell the inviter. */
export async function acceptInvite(
  sql: Sql,
  token: string,
  a: { password: string; name?: string; phone?: string },
  f?: typeof fetch,
): Promise<AcceptResult> {
  const link = await checkLink(sql, 'invite', token);
  if (!link.ok) return { ok: false, reason: link.reason };
  const problem = await passwordProblem(a.password, link.staff.email, f);
  if (problem) return { ok: false, reason: 'password', message: problem };
  if (!(await useLink(sql, link.tokenId))) return { ok: false, reason: 'used' };
  const [r] = await sql<{ ok: boolean }[]>`
    select app_staff_accept(${link.staff.id}, ${await hashPassword(a.password)}, ${a.name ?? ''}, ${msisdn(a.phone) ?? ''}) as ok`;
  if (!r?.ok) return { ok: false, reason: 'used' };
  const staff = (await staffById(sql, link.staff.id)) as StaffRow;
  const [inviter] = await sql<{ name: string; email: string }[]>`select * from app_staff_inviter(${staff.id})`;
  const ctx = (link.data?.ctx ?? null) as InviteContext | null;
  if (inviter) {
    const mail = accountEmail({
      heading: `${staff.name} accepted your invitation`,
      paragraphs: [`${staff.name} (${staff.email}) has joined ${ctx?.to ?? 'Lango'} as ${roleLabel(staff.role)}.`],
    });
    await sendEmail(sql, {
      to: inviter.email,
      subject: `${staff.name} joined ${ctx?.to ?? 'Lango'}`,
      ...mail,
      kind: 'invite_accepted',
      key: `invite-accepted:${staff.id}`,
    });
  }
  return { ok: true, staff };
}

// ---------- password reset ----------

/**
 * "Forgot password": always the same outcome for the caller. A link goes out only to an active account that has
 * accepted its invitation; at most 3 links an hour per account.
 */
export async function requestPasswordReset(sql: Sql, email: string, baseUrl: string): Promise<void> {
  const staff = await staffByEmail(sql, email);
  if (!staff?.active || !staff.accepted_at) return;
  const [n] = await sql<{ n: number }[]>`select count(*)::int as n from auth_tokens
    where staff_id = ${staff.id} and kind = 'reset' and created_at > now() - interval '1 hour'`;
  if ((n?.n ?? 0) >= 3) return;
  const token = await issueLink(sql, 'reset', staff.id, null);
  const mail = accountEmail({
    heading: 'Reset your Lango password',
    paragraphs: [`Hi ${staff.name.split(' ')[0]},`, 'Someone asked to reset the password for this Lango account.'],
    button: { label: 'Set a new password', url: `${baseUrl}/reset/${token}` },
    after: [
      "The link works once and expires in 30 minutes. If you didn't ask, ignore this email; your password stays the same.",
    ],
  });
  await sendEmail(sql, {
    to: staff.email,
    subject: 'Reset your Lango password',
    ...mail,
    kind: 'password_reset',
    key: `reset:${sha(token).slice(0, 32)}`,
  });
}

export async function resetPassword(
  sql: Sql,
  token: string,
  password: string,
  f?: typeof fetch,
): Promise<
  { ok: true; staff: StaffRow } | { ok: false; reason: 'invalid' | 'expired' | 'used' | 'password'; message?: string }
> {
  const link = await checkLink(sql, 'reset', token);
  if (!link.ok) return { ok: false, reason: link.reason };
  const problem = await passwordProblem(password, link.staff.email, f);
  if (problem) return { ok: false, reason: 'password', message: problem };
  if (!(await useLink(sql, link.tokenId))) return { ok: false, reason: 'used' };
  await sql`select app_set_password(${link.staff.id}, ${await hashPassword(password)})`;
  await changedPasswordAftermath(sql, link.staff, 'password-reset');
  return { ok: true, staff: link.staff };
}

/** After any password change: every session and remembered device ends, and the owner of the account is told. */
export async function changedPasswordAftermath(sql: Sql, staff: StaffRow, reason: string, keepToken?: string) {
  await revokeAllSessions(sql, staff.id, reason, keepToken);
  await sql`delete from trusted_devices where staff_id = ${staff.id}`;
  const when = new Date().toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const mail = accountEmail({
    heading: 'Your Lango password was changed',
    paragraphs: [
      `The password for ${staff.email} was changed on ${when} (Nairobi time). Other devices have been signed out.`,
      "If this wasn't you, reply to this email straight away and a real person at NAVAC will lock the account and help you.",
    ],
  });
  await sendEmail(sql, {
    to: staff.email,
    subject: 'Your Lango password was changed',
    ...mail,
    kind: 'password_changed',
    key: `pw-changed:${staff.id}:${Date.now()}`,
  });
}

// ---------- sign-in codes ----------

export interface CodeChallenge {
  id: string;
  channel: 'sms' | 'email';
  masked: string;
}

const maskPhone = (p: string) => `0${p.slice(3, 4)}•• ••• ${p.slice(-3)}`;
const maskEmail = (e: string) =>
  e.replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => `${a}${'•'.repeat(Math.min(6, b.length))}${c}`);

/**
 * Send a 6-digit sign-in code by SMS (NAVAC's sender) or, failing that, email. Valid 10 minutes, 5 tries,
 * at most one a minute and 5 an hour. Returns null when no channel can reach this person (the caller then
 * signs them in on the password alone and asks them to add a phone).
 */
export async function startSignInCode(
  sql: Sql,
  staff: StaffRow,
  prefer: 'sms' | 'email' = 'sms',
  sms?: SourceCodeSms | null,
): Promise<CodeChallenge | 'wait' | null> {
  const [r] = await sql<{ hour: number; minute: number }[]>`
    select count(*)::int as hour, (count(*) filter (where created_at > now() - interval '60 seconds'))::int as minute
    from auth_tokens where staff_id = ${staff.id} and kind = 'signin_code' and created_at > now() - interval '1 hour'`;
  if ((r?.hour ?? 0) >= 5 || (r?.minute ?? 0) > 0) return 'wait';
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const id = (
    await sql<{ id: string }[]>`
    insert into auth_tokens (kind, token_hash, staff_id, expires_at)
    values ('signin_code', ${sha(`pending:${newToken()}`)}, ${staff.id}, now() + interval '10 minutes') returning id`
  )[0]?.id as string;
  await sql`update auth_tokens set token_hash = ${sha(`${id}:${code}`)} where id = ${id}`;
  const phone = msisdn(staff.phone);
  if (prefer === 'sms' && phone) {
    const client = sms === undefined ? await platformSms(sql) : sms;
    if (client) {
      try {
        const res = await client.send(
          phone,
          `Your Lango sign-in code is ${code}. It expires in 10 minutes. Never share it.`,
        );
        if (res.ok) return { id, channel: 'sms', masked: maskPhone(phone) };
      } catch {
        /* fall through to email */
      }
    }
  }
  const mail = accountEmail({
    heading: `Your sign-in code is ${code}`,
    paragraphs: [
      'Enter this code on the Lango sign-in page. It expires in 10 minutes.',
      'Never share it. NAVAC will never ask you for it.',
    ],
  });
  const sent = await sendEmail(sql, {
    to: staff.email,
    subject: `Lango sign-in code: ${code}`,
    ...mail,
    kind: 'signin_code',
    key: `code:${id}`,
  });
  if (sent) return { id, channel: 'email', masked: maskEmail(staff.email) };
  await sql`update auth_tokens set used_at = now() where id = ${id}`;
  return null;
}

/** Check a sign-in code. Wrong codes count; the 5th wrong try ends the challenge. */
export async function verifySignInCode(sql: Sql, challengeId: string, staffId: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false;
  const [t] = await sql<{ id: string; token_hash: string }[]>`
    update auth_tokens set attempts = attempts + 1
    where id = ${challengeId} and staff_id = ${staffId} and kind = 'signin_code' and used_at is null
      and expires_at > now() and attempts < 5
    returning id, token_hash`;
  if (!t) return false;
  const a = Buffer.from(sha(`${t.id}:${code}`));
  const b = Buffer.from(t.token_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const used = await sql`update auth_tokens set used_at = now() where id = ${t.id} and used_at is null returning id`;
  return used.length === 1;
}
