import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/session';

export async function POST(req: Request) {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.redirect(new URL('/login', req.url), 303);
}

/** Used when a session is no longer valid (e.g. staff account deactivated). */
export const GET = POST;
