import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { type LiveSession, type Perm, readSession, sessionEndReason } from '@lango/server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/server/db';

/**
 * Sessions live on the server (auth_sessions). The cookie holds only a random token, so sign-out, removal and
 * password changes take effect at once. In production the cookie uses the __Host- prefix (HTTPS only, this host
 * only, whole site).
 */
const prod = process.env.NODE_ENV === 'production';
export const SESSION_COOKIE = prod ? '__Host-lango' : 'lango_session';
/** The partner console keeps its own sign-in, so a partner tab and a club tab work side by side in one browser. */
export const PARTNER_COOKIE = prod ? '__Host-lango-partner' : 'lango_partner_session';
export type Area = 'club' | 'partner';
const cookieFor = (a: Area) => (a === 'partner' ? PARTNER_COOKIE : SESSION_COOKIE);
/** Which console this request is in (set by middleware): partner, club, or any (sign-in steps shared by both). */
async function requestArea(): Promise<Area | 'any'> {
  const a = (await headers()).get('x-lango-area');
  return a === 'partner' || a === 'any' ? a : 'club';
}
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

export async function sessionToken(area?: Area): Promise<string | undefined> {
  const jar = await cookies();
  const a = area ?? (await requestArea());
  if (a !== 'any') return jar.get(cookieFor(a))?.value;
  return jar.get(SESSION_COOKIE)?.value ?? jar.get(PARTNER_COOKIE)?.value;
}

/** The session of this console. A partner sign-in is never used as a club sign-in, nor the other way round. */
export async function getSession(area?: Area): Promise<Session | null> {
  const a = area ?? (await requestArea());
  if (a === 'any') {
    for (const x of ['club', 'partner'] as const) {
      const s = await readSession(db(), await sessionToken(x));
      if (s && !!s.partner === (x === 'partner')) return s;
    }
    return null;
  }
  const s = await readSession(db(), await sessionToken(a));
  return s && !!s.partner === (a === 'partner') ? s : null;
}

export async function setSessionCookie(token: string, maxHours: number, area: Area = 'club') {
  (await cookies()).set(cookieFor(area), token, { ...cookieBase, maxAge: maxHours * 3600 });
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
  expiresAt?: number;
}) {
  const body = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  (await cookies()).set(PENDING_COOKIE, `${body}.${sign(body)}`, { ...cookieBase, maxAge: 600 });
}
export async function getPending(): Promise<{
  staffId: string;
  challengeId: string | null;
  channel?: string;
  masked?: string;
  expiresAt?: number;
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
  // __Host- cookies are only removed when the removal carries the same Secure/path attributes.
  (await cookies()).set(PENDING_COOKIE, '', { ...cookieBase, maxAge: 0 });
}

/** Where to send someone whose session is gone, saying why (signed out elsewhere, idle, removed, expired). */
async function signedOut(): Promise<never> {
  const reason = await sessionEndReason(db(), await sessionToken());
  const m =
    reason === 'idle'
      ? 'idle'
      : reason === 'removed'
        ? 'removed'
        : reason === 'suspended'
          ? 'suspended'
          : reason === 'password-changed' || reason === 'password-reset'
            ? 'password'
            : reason === 'signed-out-everywhere'
              ? 'everywhere'
              : 'signed-out';
  redirect(`/login?m=${m}${(await requestArea()) === 'partner' ? '&for=partner' : ''}`);
}

/** A signed-in person working in a club. Partner logins without an open club go to their clubs list. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) return signedOut();
  // NAVAC and partner logins never work inside a club's console: a club's data is the club's own.
  if (s.partner) redirect('/partner');
  if (!s.tid) redirect('/choose');
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

/** Remove the session cookie (with the same attributes it was set with, as __Host- cookies require). */
export async function clearSessionCookie(area?: Area | 'any') {
  const a = area ?? (await requestArea());
  const jar = await cookies();
  for (const x of a === 'any' ? (['club', 'partner'] as const) : [a])
    jar.set(cookieFor(x), '', { ...cookieBase, maxAge: 0 });
}
