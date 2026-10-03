import { clientIp, rateLimit, reconcileSubscriptions, reconcileTopups } from '@lango/server';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

/**
 * TaifaPay webhook for NAVAC's own merchant account (SMS credit and Lango subscription payments). The body is only a nudge: every
 * pending top-up is re-checked with TaifaPay before any credit is added.
 */
export async function POST(req: Request) {
  if (!rateLimit(`platform-hook:${clientIp(req.headers)}`, 30, 60_000))
    return new Response('slow down', { status: 429 });
  await req.text();
  const n = await reconcileTopups(db(), (m) => console.warn(m));
  const paid = await reconcileSubscriptions(db(), (m) => console.warn(m));
  return Response.json({ ok: true, credited: n, paid });
}
