import 'server-only';
import { type Session, verifySession } from '@lango/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/server/db';

export const SESSION_COOKIE = 'lango_session';
export const sessionSecret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ chars)');
  return s;
};

export async function getSession(): Promise<Session | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, sessionSecret());
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  // A deactivated staff account loses access immediately, not when its 12 h cookie expires.
  const [row] = await db()<{ active: boolean }[]>`select app_staff_active(${s.uid}) as active`;
  if (!row?.active) redirect('/logout');
  if (!s.tid) redirect('/partner'); // a partner admin who has not opened a club yet
  return s;
}

/** Partner/platform admins only (the NAVAC / installer view across clubs). */
export async function requirePartner(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  const [row] = await db()<{ active: boolean }[]>`select app_staff_active(${s.uid}) as active`;
  if (!row?.active) redirect('/logout');
  if (!s.partner) redirect('/');
  return s;
}

export const sessionCookie = (token: string) =>
  [
    SESSION_COOKIE,
    token,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 12 * 3600,
    },
  ] as const;
