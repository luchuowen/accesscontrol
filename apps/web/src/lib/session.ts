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
  return s;
}
