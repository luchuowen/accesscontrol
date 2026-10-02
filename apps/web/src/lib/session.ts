import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { type LiveSession, type Perm, readSession, sessionEndReason } from '@lango/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/server/db';

/**
 * Sessions live on the server (auth_sessions). The cookie holds only a random token, so sign-out, removal and
 * password changes take effect at once. In production the cookie uses the __Host- prefix (HTTPS only, this host
 * only, whole site).
 */
const prod = process.env.NODE_ENV === 'production';
export const SESSION_COOKIE = prod ? '__Host-lango' : 'lango_session';
export const DEVICE_COOKIE = prod ? '__Host-lango-device' : 'lango_device';
export const PENDING_COOKIE = prod ? '__Host-lango-pending' : 'lango_pending';

export type Session = LiveSession;

export const sessionSecret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ chars)');
  return s;
};

/** The public address used in every emailed link (never the request's Host header). */
export const publicUrl = () => {
  const u = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  if (!u) throw new Error('PUBLIC_URL must be set');
  return u;
};

const cookieBase = { httpOnly: true, secure: prod, sameSite: 'lax' as const, path: '/' };

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function getSession(): Promise<Session | null> {
  return readSession(db(), await sessionToken());
}

export async function setSessionCookie(token: string, maxHours: number) {
  (await cookies()).set(SESSION_COOKIE, token, { ...cookieBase, maxAge: maxHours * 3600 });
}

export async function setDeviceCookie(token: string, days: number) {
  (await cookies()).set(DEVICE_COOKIE, token, { ...cookieBase, maxAge: days * 86400 });
}

export async function deviceToken() {
  return (await cookies()).get(DEVICE_COOKIE)?.value;
}

/** Between password and sign-in code: who is signing in and which code was sent (signed, 10 minutes). */
const sign = (v: string) => createHmac('sha256', sessionSecret()).update(`pending:${v}`).digest('base64url');
export async function setPending(p: {
  staffId: string;
  challengeId: string | null;
  channel?: string;
  masked?: string;
}) {
  const body = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  (await cookies()).set(PENDING_COOKIE, `${body}.${sign(body)}`, { ...cookieBase, maxAge: 600 });
}
export async function getPending(): Promise<{
  staffId: string;
  challengeId: string | null;
  channel?: string;
  masked?: string;
} | null> {
  const raw = (await cookies()).get(PENDING_COOKIE)?.value ?? '';
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
}
export async function clearPending() {
  (await cookies()).delete({ name: PENDING_COOKIE, path: '/' });
}

/** Where to send someone whose session is gone, saying why (signed out elsewhere, idle, removed, expired). */
async function signedOut(): Promise<never> {
  const reason = await sessionEndReason(db(), await sessionToken());
  const m =
    reason === 'idle'
      ? 'idle'
      : reason === 'removed'
        ? 'removed'
        : reason === 'password-changed' || reason === 'password-reset'
          ? 'password'
          : reason === 'signed-out-everywhere'
            ? 'everywhere'
            : 'signed-out';
  redirect(`/login?m=${m}`);
}

/** A signed-in person working in a club. Partner logins without an open club go to their clubs list. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) return signedOut();
  if (!s.tid) redirect(s.partner ? '/partner' : '/choose');
  return s;
}

/** The page or action needs this permission; without it the person is sent to the overview with a note. */
export async function requirePerm(perm: Perm): Promise<Session> {
  const s = await requireSession();
  if (!s.perms.includes(perm)) redirect('/?denied=1');
  return s;
}

/** True when the session holds any of these permissions. */
export const canAny = (s: Session, ...perms: Perm[]) => perms.some((p) => s.perms.includes(p));

/** Partner-level logins only (NAVAC admin and support, partner admins, technicians). */
export async function requirePartner(): Promise<Session> {
  const s = await getSession();
  if (!s) return signedOut();
  if (!s.partner) redirect('/');
  return s;
}

/** Anyone signed in, with or without a club open (their own account pages). */
export async function requireSignedIn(): Promise<Session> {
  const s = await getSession();
  if (!s) return signedOut();
  return s;
}
