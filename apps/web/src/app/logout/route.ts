import { revokeSession } from '@lango/server';
import { cookies } from 'next/headers';
import { type Area, clearSessionCookie, PARTNER_COOKIE, SESSION_COOKIE } from '@/lib/session';
import { db } from '@/server/db';

/** Ends the session on the server too, so the cookie is useless even if it was copied. */
export async function POST(req: Request) {
  const jar = await cookies();
  // Each console signs out on its own: the partner console sends area=partner.
  const area: Area = (await req.formData().catch(() => null))?.get('area') === 'partner' ? 'partner' : 'club';
  const token = jar.get(area === 'partner' ? PARTNER_COOKIE : SESSION_COOKIE)?.value;
  if (token) await revokeSession(db(), token);
  await clearSessionCookie(area);
  // Relative: behind the proxy req.url is http://localhost:3000, which is not the public address.
  return new Response(null, {
    status: 303,
    headers: { Location: area === 'partner' ? '/login?m=signed-out-ok&for=partner' : '/login?m=signed-out-ok' },
  });
}

/** Used when a session is no longer valid (e.g. staff account deactivated). */
export async function GET() {
  await clearSessionCookie('any');
  return new Response(null, { status: 303, headers: { Location: '/login?m=signed-out' } });
}
