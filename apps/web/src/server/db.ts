import { connect, type Sql } from '@lango/db';

/**
 * Process-wide pool for the app role (RLS-enforced). Kept on globalThis because Next.js can load this module more
 * than once (server components, route handlers, jobs, dev reloads); each copy must share one pool, not open its own.
 */
const g = globalThis as unknown as { __langoSql?: Sql };
export function db(): Sql {
  if (!g.__langoSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    g.__langoSql = connect(url);
  }
  return g.__langoSql;
}
