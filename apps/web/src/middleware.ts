import { type NextRequest, NextResponse } from 'next/server';

/**
 * Tells the server which console a request belongs to, so the partner console and a club console keep separate
 * sign-ins in the same browser (one tab as a partner, another as a club owner).
 */
export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  const area =
    p === '/partner' || p.startsWith('/partner/')
      ? 'partner'
      : p.startsWith('/login/trust') || p.startsWith('/transfer')
        ? 'any'
        : 'club';
  const h = new Headers(req.headers);
  h.set('x-lango-area', area);
  return NextResponse.next({ request: { headers: h } });
}

export const config = { matcher: ['/((?!_next/|api/|bridge/|favicon|icon|.*\\.(?:png|svg|jpg|ico|css|js)$).*)'] };
