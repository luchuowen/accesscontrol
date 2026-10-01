'use server';
import { hashPassword, rateLimit, signSession, verifyPassword } from '@lango/server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, sessionSecret } from '@/lib/session';
import { db } from '@/server/db';

let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashPassword('lango-timing-equaliser'));

export async function login(form: FormData) {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(form.get('password') ?? '');
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`login:${ip}`, 10, 5 * 60_000) || !rateLimit(`login:${email}`, 10, 5 * 60_000)) redirect('/login?e=2');
  const [u] = await db()<
    { id: string; tenant_id: string | null; name: string; role: string; password_hash: string; active: boolean }[]
  >`select * from app_staff_login(${email})`;
  // Unknown email still pays the scrypt cost, so response time does not reveal which emails exist.
  const ok = await verifyPassword(password, u?.password_hash ?? (await dummyHash()));
  if (!ok || !u?.active || !u.tenant_id) redirect('/login?e=1');
  if (!ok || !u?.tenant_id) redirect('/login?e=1');
  (await cookies()).set(
    SESSION_COOKIE,
    signSession({ uid: u.id, tid: u.tenant_id, role: u.role, name: u.name }, sessionSecret()),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 3600,
    },
  );
  redirect('/');
}
