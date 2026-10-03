import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
export { postgres };

export const connect = (url: string, max = 10) =>
  postgres(url, { max, onnotice: () => {}, types: { bigint: postgres.BigInt } });

/** Run `fn` in a transaction scoped to one tenant (RLS reads app.tenant_id). */
export async function withTenant<T>(sql: Sql, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Apply pending migrations in filename order as the owner role, then grant the app role. */
export async function migrate(ownerUrl: string, appRole = 'lango_app') {
  const sql = connect(ownerUrl, 1);
  try {
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
    for (const f of readdirSync(migrationsDir)
      .filter((x) => x.endsWith('.sql'))
      .sort()) {
      if (done.has(f)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(migrationsDir, f), 'utf8'));
        await tx`insert into schema_migrations (name) values (${f})`;
      });
    }
    await sql.unsafe(`grant usage on schema public to ${appRole};
      grant select, insert, update, delete on all tables in schema public to ${appRole};
      grant usage, select on all sequences in schema public to ${appRole};
      revoke all on staff_users, club_memberships, partner_assignments, bridges, schema_migrations, platform_settings from ${appRole};
      revoke insert, update, delete on tenants, partners, tenant_sms, comm_channels, club_plans from ${appRole};
      grant execute on all functions in schema public to ${appRole}`);
  } finally {
    await sql.end();
  }
}
