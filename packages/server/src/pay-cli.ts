import { connect } from '@lango/db';
import { recordPayment } from './payments.js';

/** Lab tool: record a test payment exactly as a confirmed M-Pesa payment would be. Usage: pay <slug> <memberNo> <amount> */
const [slug, memberNo, amount] = process.argv.slice(2);
const sql = connect(process.env.DATABASE_URL as string, 2);
const [t] = await sql<{ id: string }[]>`select id from tenants where slug = ${slug ?? ''}`;
if (!t) throw new Error('unknown tenant');
const r = await recordPayment(sql, t.id, {
  provider: 'lab-test',
  providerTxnId: `LAB-${Date.now()}`,
  amountKes: Number(amount),
  accountRef: String(memberNo),
  paidAt: new Date(),
});
console.log(JSON.stringify({ ...r, at: new Date().toISOString() }));
await sql.end();
