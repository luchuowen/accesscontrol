import { withTenant } from '@lango/db';
import Link from 'next/link';
import { Badge, Empty, PageHeader } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

/** Every SMS credit purchase, with its invoice (unpaid) or receipt (paid). */
export default async function SmsPurchases() {
  const s = await requireSession();
  const rows = await withTenant(
    db(),
    s.tid,
    (tx) =>
      tx<
        {
          id: string;
          invoice_no: string;
          created_at: Date;
          amount_kes: number;
          units: number;
          status: string;
          trigger: string;
        }[]
      >`select id, invoice_no, created_at, amount_kes, units, status, trigger from sms_topups order by created_at desc limit 200`,
  );
  return (
    <>
      <PageHeader title="SMS purchases" subtitle="Invoices and receipts for SMS credit bought from NAVAC Global." />
      <section className="card overflow-hidden">
        {rows.length === 0 ? (
          <Empty>No SMS credit bought yet. Buy SMS from Settings.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-xs text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Number</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">SMS</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-mono">{r.invoice_no}</td>
                  <td className="px-4 py-2.5 text-ink-500">{dateTime(r.created_at)}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {r.units.toLocaleString('en-KE')}
                    {r.trigger === 'auto' ? <span className="text-ink-500"> · automatic</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{kes(r.amount_kes)}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={r.status === 'completed' ? 'green' : r.status === 'pending' ? 'blue' : 'gray'}>
                      {r.status === 'completed' ? 'paid' : r.status === 'pending' ? 'awaiting payment' : r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/settings/sms/${r.id}`} className="font-medium underline">
                      {r.status === 'completed' ? 'Receipt' : 'Invoice'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
