'use server';
import {
  acceptInvite,
  checkLink,
  clientIp,
  codeResendAt,
  createSession,
  hashPassword,
  isLimited,
  isPartnerLevel,
  isTrustedDevice,
  logAuth,
  myClubs,
  noteFailedSignIn,
  rateLimit,
  readSession,
  recordFailure,
  rememberDevice,
  requestPasswordReset,
  resendInvite,
  resetPassword,
  revokeAllSessions,
  revokeSession,
  type StaffRow,
  setSessionClub,
  staffById,
  startSignInCode,
  verifyPassword,
  verifySignInCode,
} from '@lango/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  clearPending,
  clearSessionCookie,
  deviceToken,
  getPending,
  publicUrl,
  sessionToken,
  setDeviceCookie,
  setPending,
  setSessionCookie,
} from '@/lib/session';
import { db } from '@/server/db';

let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashPassword('lango-timing-equaliser'));

/**
 * Start the session and say where to go: partner logins to the partner console; club logins straight into their
 * club, or to "choose club" when they belong to several. A new session ID every time (OWASP).
 */
async function startSession(staff: StaffRow): Promise<string> {
  const h = await headers();
  const ip = clientIp(h);
  const userAgent = h.get('user-agent') ?? undefined;
  let tenantId: string | null = null;
  let next = '/partner';
  if (!isPartnerLevel(staff)) {
    const clubs = await myClubs(db(), staff.id);
    tenantId = clubs.length === 1 ? (clubs[0]?.tenant_id ?? null) : null;
    next = tenantId ? '/' : '/choose';
  }
  const { token, maxHours } = await createSession(db(), { staff, tenantId, ip, userAgent });
  await setSessionCookie(token, maxHours);
  await clearPending();
  await logAuth(db(), { kind: 'signin.ok', staffId: staff.id, tenantId, email: staff.email, ip, userAgent });
  return next;
}

/** A login that can work somewhere: a partner-level login, or a club login still in at least one club. */
async function canWork(staff: StaffRow) {
  return isPartnerLevel(staff) || (await myClubs(db(), staff.id)).length > 0;
}

/**
 * Step 1: email and password. The same message for every failure, and an unknown email still pays the password
 * hashing cost, so nobody can tell which emails have accounts. A remembered device skips the code.
 */
export async function login(form: FormData) {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(form.get('password') ?? '');
  const ip = clientIp(await headers());
  const account = `login:${email}`;
  if (!rateLimit(`login-ip:${ip}`, 20, 10 * 60_000) || isLimited(account, 5, 15 * 60_000)) redirect('/login?e=2');
  const [u] = await db()<{ id: string; password_hash: string; active: boolean }[]>`
    select id, password_hash, active from app_staff_login(${email})`;
  const ok = await verifyPassword(password, u?.password_hash ?? (await dummyHash()));
  const staff = ok && u?.active ? await staffById(db(), u.id) : null;
  if (!staff || !(await canWork(staff))) {
    recordFailure(account, 15 * 60_000);
    await noteFailedSignIn(db(), email, ip, (await headers()).get('user-agent') ?? undefined);
    redirect('/login?e=1');
  }
  if (await isTrustedDevice(db(), await deviceToken(), staff.id)) redirect(await startSession(staff));
  const ch = await startSignInCode(db(), staff, 'sms');
  // No phone and no email channel yet: sign in on the password alone (the account page asks for a phone).
  if (ch === null) redirect(await startSession(staff));
  if (ch === 'wait') {
    await setPending({ staffId: staff.id, challengeId: null });
    redirect('/login/code?w=1');
  }
  await setPending({
    staffId: staff.id,
    challengeId: ch.id,
    channel: ch.channel,
    masked: ch.masked,
    expiresAt: ch.expiresAt,
  });
  redirect('/login/code');
}

/** Step 2: the 6-digit code. Optionally remember this device. */
export async function verifyCode(form: FormData) {
  const p = await getPending();
  if (!p) redirect('/login?m=expired');
  const code = String(form.get('code') ?? '').replace(/\D/g, '');
  const ip = clientIp(await headers());
  if (!rateLimit(`code-ip:${ip}`, 30, 10 * 60_000)) redirect('/login/code?e=2');
  if (!p.challengeId || !(await verifySignInCode(db(), p.challengeId, p.staffId, code))) {
    await logAuth(db(), { kind: 'code.fail', staffId: p.staffId, ip });
    redirect('/login/code?e=1');
  }
  const staff = await staffById(db(), p.staffId);
  if (!staff?.active) redirect('/login?e=1');
  const next = await startSession(staff);
  // As Apple does: after the code, ask once whether to trust this browser (skip the code here next time).
  redirect(`/login/trust?next=${encodeURIComponent(next)}`);
}

const NEXT = new Set(['/', '/choose', '/partner']);

/** "Trust this browser?" answered. Trusting skips the code on this browser for 30 days (7 for NAVAC/partners). */
export async function trustBrowser(form: FormData) {
  const token = await sessionToken();
  const s = token ? await readSession(db(), token) : null;
  if (!s) redirect('/login?m=signed-out');
  const next = String(form.get('next') ?? '/');
  if (form.get('trust') === 'yes') {
    const staff = await staffById(db(), s.uid);
    if (staff) {
      const h = await headers();
      const d = await rememberDevice(db(), staff, h.get('user-agent') ?? undefined);
      await setDeviceCookie(d.token, d.days);
      await logAuth(db(), { kind: 'device.trusted', staffId: s.uid, ip: clientIp(h) });
    }
  }
  redirect(NEXT.has(next) ? next : '/');
}

/** Send the code again, by SMS or by email. */
export async function resendCode(form: FormData) {
  const p = await getPending();
  if (!p) redirect('/login?m=expired');
  const staff = await staffById(db(), p.staffId);
  if (!staff?.active) redirect('/login?e=1');
  const via = form.get('via') === 'email' ? 'email' : 'sms';
  // Never more often than the resend policy allows, and at most 10 resend requests an hour from one network.
  if (!rateLimit(`code-resend-ip:${clientIp(await headers())}`, 10, 60 * 60_000)) redirect('/login/code?w=1');
  if ((await codeResendAt(db(), staff.id)).at > Date.now()) redirect('/login/code?w=1');
  const ch = await startSignInCode(db(), staff, via);
  if (ch === 'wait') redirect('/login/code?w=1');
  if (ch === null) redirect('/login/code?e=3');
  await setPending({
    staffId: staff.id,
    challengeId: ch.id,
    channel: ch.channel,
    masked: ch.masked,
    expiresAt: ch.expiresAt,
  });
  redirect('/login/code?r=1');
}

/** Forgot password: the same answer whether or not the email has an account. */
export async function forgot(form: FormData) {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const ip = clientIp(await headers());
  if (rateLimit(`forgot-ip:${ip}`, 10, 60 * 60_000) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    await requestPasswordReset(db(), email, publicUrl());
  redirect('/forgot/sent');
}

export interface PasswordState {
  error?: string;
}

/** Set a new password from a reset link; no automatic sign-in (OWASP). */
export async function reset(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const token = String(form.get('token') ?? '');
  const a = String(form.get('password') ?? '');
  if (a !== String(form.get('confirm') ?? '')) return { error: 'The two passwords are not the same.' };
  const r = await resetPassword(db(), token, a);
  if (!r.ok) {
    if (r.reason === 'password') return { error: r.message };
    redirect(`/reset/${encodeURIComponent(token)}`);
  }
  await logAuth(db(), { kind: 'reset.done', staffId: r.staff.id, ip: clientIp(await headers()) });
  redirect('/login?m=reset');
}

/** Accept an invitation: password set, account switched on, signed in, sent to their console. */
export async function accept(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const token = String(form.get('token') ?? '');
  const a = String(form.get('password') ?? '');
  if (a !== String(form.get('confirm') ?? '')) return { error: 'The two passwords are not the same.' };
  if (form.get('terms') !== 'on') return { error: 'Please accept the Lango terms to continue.' };
  const r = await acceptInvite(db(), token, {
    password: a,
    name: String(form.get('name') ?? '').slice(0, 80),
    phone: String(form.get('phone') ?? ''),
  });
  if (!r.ok) {
    if (r.reason === 'password') return { error: r.message };
    redirect(`/invite/${encodeURIComponent(token)}`);
  }
  await logAuth(db(), { kind: 'invite.accepted', staffId: r.staff.id, tenantId: r.staff.tenant_id });
  redirect(await startSession(r.staff));
}

/** "Send me a new link" from an expired invitation page. Keyed by the expired link itself, so nobody can reset
 * someone else's pending invitation by guessing an id. */
export async function newInviteLink(form: FormData) {
  const token = String(form.get('token') ?? '');
  const ip = clientIp(await headers());
  if (!rateLimit(`invite-again:${ip}`, 5, 60 * 60_000)) redirect('/login');
  const link = await checkLink(db(), 'invite', token);
  if (!link.ok && link.reason === 'expired' && !link.staff.accepted_at)
    await resendInvite(db(), link.staff.id, null, publicUrl());
  redirect('/forgot/sent?invite=1');
}

/** Sign out here, or everywhere. */
export async function signOut(form: FormData) {
  const token = await sessionToken();
  if (token) {
    if (form.get('everywhere') === 'on') {
      const s = await readSession(db(), token);
      if (s) {
        await revokeAllSessions(db(), s.uid, 'signed-out-everywhere');
        await logAuth(db(), { kind: 'signout.everywhere', staffId: s.uid, tenantId: s.tid });
      }
    }
    await revokeSession(db(), token);
  }
  await clearSessionCookie();
  redirect('/login?m=signed-out-ok');
}

/** Pick the club to work in (people in several clubs). Only clubs this login belongs to. */
export async function chooseClub(form: FormData) {
  const token = await sessionToken();
  const s = token ? await readSession(db(), token) : null;
  if (!s || !token) redirect('/login?m=signed-out');
  if (s.partner) redirect('/partner');
  const tid = String(form.get('tenantId') ?? '');
  const club = (await myClubs(db(), s.uid)).find((c) => c.tenant_id === tid);
  if (!club) redirect('/choose');
  await setSessionClub(db(), token, club.tenant_id, null);
  await db()`select app_staff_last_club(${s.uid}, ${club.tenant_id})`;
  await logAuth(db(), { kind: 'club.opened', staffId: s.uid, tenantId: club.tenant_id });
  redirect('/');
}
