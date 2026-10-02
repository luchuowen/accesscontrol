import { connect } from '@lango/db';
import { tenantTaifa } from './taifapay.js';

/** Ops tool: check a club's stored TaifaPay keys. Prints only the outcome, never the keys. Usage: taifa-check <slug> */
const slug = process.argv[2] ?? '';
const sql = connect(process.env.DATABASE_URL as string, 1);
const [t] = await sql<{ id: string }[]>`select id from tenants where slug = ${slug}`;
if (!t) throw new Error('unknown tenant');
const client = await tenantTaifa(sql, t.id);
if (!client) console.log('TAIFA: not configured');
else {
  const t0 = Date.now();
  try {
    await client.verify();
    console.log(`TAIFA: keys accepted (${Date.now() - t0} ms)`);
  } catch (e) {
    console.log(`TAIFA: ${(e as Error).message} (${Date.now() - t0} ms)`);
  }
}
await sql.end();
