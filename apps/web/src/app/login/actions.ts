'use server';
import {
  clientIp,
  hashPassword,
  isLimited,
  rateLimit,
  recordFailure,
  signSession,
  verifyPassword,
} from '@lango/server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionCookie, sessionSecret } from '@/lib/session';
import { db } from '@/server/db';

let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashPassword('lango-timing-equaliser'));

export async function login(form: FormData) {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(form.get('password') ?? '');
  const ip = clientIp(await headers());
  const account = `login:${email}`;
  // Per IP: all attempts. Per account: failures only, so a stranger cannot lock out a member of staff by succeeding.
  if (!rateLimit(`login-ip:${ip}`, 30, 5 * 60_000) || isLimited(account, 10, 15 * 60_000)) redirect('/login?e=2');
  const [u] = await db()<
    { id: string; tenant_id: string | null; name: string; role: string; password_hash: string; active: boolean }[]
  >`select * from app_staff_login(${email})`;
  // Unknown email still pays the scrypt cost, so response time does not reveal which emails exist.
  const ok = await verifyPassword(password, u?.password_hash ?? (await dummyHash()));
  const partner = u?.role === 'partner_admin';
  if (!ok || !u?.active || (!u.tenant_id && !partner)) {
    recordFailure(account, 15 * 60_000);
    redirect('/login?e=1');
  }
  const token = signSession(
    {
      uid: u.id,
      tid: partner ? '' : (u.tenant_id as string),
      role: u.role,
      name: u.name,
      ...(partner ? { partner: true } : {}),
    },
    sessionSecret(),
  );
  (await cookies()).set(...sessionCookie(token));
  redirect(partner ? '/partner' : '/');
}
