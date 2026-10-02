import { revokeSession } from '@lango/server';
import { cookies } from 'next/headers';
import { clearSessionCookie, SESSION_COOKIE } from '@/lib/session';
import { db } from '@/server/db';

/** Ends the session on the server too, so the cookie is useless even if it was copied. */
export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(db(), token);
  await clearSessionCookie();
  // Relative: behind the proxy req.url is http://localhost:3000, which is not the public address.
  return new Response(null, { status: 303, headers: { Location: '/login?m=signed-out-ok' } });
}

/** Used when a session is no longer valid (e.g. staff account deactivated). */
export async function GET() {
  await clearSessionCookie();
  return new Response(null, { status: 303, headers: { Location: '/login?m=signed-out' } });
}
