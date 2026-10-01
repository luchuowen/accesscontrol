import { connect, type Sql } from '@lango/db';

let sql: Sql | null = null;
/** Process-wide pool for the app role (RLS-enforced). */
export function db(): Sql {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    sql = connect(url);
  }
  return sql;
}
