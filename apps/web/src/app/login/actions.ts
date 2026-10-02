'use server';
import {
  acceptInvite,
  checkLink,
  clientIp,
  createSession,
  hashPassword,
  isLimited,
  isTrustedDevice,
  rateLimit,
  recordFailure,
  rememberDevice,
  requestPasswordReset,
  resendInvite,
  resetPassword,
  revokeAllSessions,
  revokeSession,
  type StaffRow,
  staffById,
  startSignInCode,
  verifyPassword,
  verifySignInCode,
} from '@lango/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  clearPending,
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

const home = (s: Pick<StaffRow, 'role'>) => (s.role === 'partner_admin' ? '/partner' : '/');

async function startSession(staff: StaffRow) {
  const h = await headers();
  const { token, maxHours } = await createSession(db(), {
    staff,
    ip: clientIp(h),
    userAgent: h.get('user-agent') ?? undefined,
  });
  await setSessionCookie(token, maxHours);
  await clearPending();
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
  if (!staff || (!staff.tenant_id && staff.role !== 'partner_admin')) {
    recordFailure(account, 15 * 60_000);
    redirect('/login?e=1');
  }
  if (await isTrustedDevice(db(), await deviceToken(), staff.id)) {
    await startSession(staff);
    redirect(home(staff));
  }
  const ch = await startSignInCode(db(), staff, 'sms');
  if (ch === null) {
    // No phone and no email channel yet: sign in on the password alone (the account page asks for a phone).
    await startSession(staff);
    redirect(home(staff));
  }
  if (ch === 'wait') {
    await setPending({ staffId: staff.id, challengeId: null });
    redirect('/login/code?w=1');
  }
  await setPending({ staffId: staff.id, challengeId: ch.id, channel: ch.channel, masked: ch.masked });
  redirect('/login/code');
}

/** Step 2: the 6-digit code. Optionally remember this device. */
export async function verifyCode(form: FormData) {
  const p = await getPending();
  if (!p) redirect('/login?m=expired');
  const code = String(form.get('code') ?? '').replace(/\D/g, '');
  const ip = clientIp(await headers());
  if (!rateLimit(`code-ip:${ip}`, 30, 10 * 60_000)) redirect('/login/code?e=2');
  if (!p.challengeId || !(await verifySignInCode(db(), p.challengeId, p.staffId, code))) redirect('/login/code?e=1');
  const staff = await staffById(db(), p.staffId);
  if (!staff?.active) redirect('/login?e=1');
  if (form.get('remember') === 'on') {
    const h = await headers();
    const d = await rememberDevice(db(), staff, h.get('user-agent') ?? undefined);
    await setDeviceCookie(d.token, d.days);
  }
  await startSession(staff);
  redirect(home(staff));
}

/** Send the code again, by SMS or by email. */
export async function resendCode(form: FormData) {
  const p = await getPending();
  if (!p) redirect('/login?m=expired');
  const staff = await staffById(db(), p.staffId);
  if (!staff?.active) redirect('/login?e=1');
  const via = form.get('via') === 'email' ? 'email' : 'sms';
  const ch = await startSignInCode(db(), staff, via);
  if (ch === 'wait') redirect('/login/code?w=1');
  if (ch === null) redirect('/login/code?e=3');
  await setPending({ staffId: staff.id, challengeId: ch.id, channel: ch.channel, masked: ch.masked });
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
  redirect(`/forgot/sent?to=${encodeURIComponent(email.slice(0, 120))}`);
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
  await startSession(r.staff);
  redirect(home(r.staff));
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
      const { readSession } = await import('@lango/server');
      const s = await readSession(db(), token);
      if (s) await revokeAllSessions(db(), s.uid, 'signed-out-everywhere');
    }
    await revokeSession(db(), token);
  }
  redirect('/login?m=signed-out-ok');
}
