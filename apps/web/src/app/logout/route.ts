import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/session';

export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  // Relative: behind the proxy req.url is http://localhost:3000, which is not the public address.
  return new Response(null, { status: 303, headers: { Location: '/login' } });
}

/** Used when a session is no longer valid (e.g. staff account deactivated). */
export const GET = POST;
