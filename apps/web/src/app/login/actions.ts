'use server';
import { signSession, verifyPassword } from '@lango/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, sessionSecret } from '@/lib/session';
import { db } from '@/server/db';

export async function login(form: FormData) {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(form.get('password') ?? '');
  const [u] = await db()<
    { id: string; tenant_id: string | null; name: string; role: string; password_hash: string; active: boolean }[]
  >`
    select id, tenant_id, name, role, password_hash, active from staff_users where email = ${email}`;
  const ok = u?.active && u.tenant_id && (await verifyPassword(password, u.password_hash));
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
