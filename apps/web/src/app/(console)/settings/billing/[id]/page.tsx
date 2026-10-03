import { withTenant } from '@lango/db';
import { can, platformBilling } from '@lango/server';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { dateTime, kes } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';
import { PrintButton } from '../../sms/print-button';

/** Invoice for a Lango subscription payment; a receipt once the M-Pesa payment is confirmed. Printable. */
export default async function SubscriptionDocument({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (!can(s, 'billing.manage')) redirect('/?denied=1');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [t] = await withTenant(
    db(),
    s.tid,
    (tx) =>
      tx<
        {
          invoice_no: string;
          plan_name: string;
          cycles: number;
          period_from: Date | null;
          period_to: Date | null;
          kind: string;
          created_at: Date;
          paid_at: Date | null;
          amount_kes: number;
          phone: string;
          status: string;
          receipt_ref: string | null;
          provider_ref: string | null;
          club: string;
        }[]
      >`select i.*, t.name as club from subscription_invoices i join tenants t on t.id = i.tenant_id where i.id = ${id}`,
  );
  if (!t) notFound();
  const seller = await platformBilling(db());
  const paid = t.status === 'paid';
  const d = (x: Date) => DateTime.fromJSDate(x).toFormat('d LLL yyyy');
  const phone = t.phone.replace(/^254/, '0').replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
  return (
    <>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/settings?tab=billing" className="text-sm text-ink-500 underline">
          ← Billing
        </Link>
        <PrintButton />
      </div>
      <article className="card mx-auto max-w-3xl p-8 print:max-w-none print:shadow-none print:ring-0 sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-ink-100 pb-6">
          <div>
            <div className="text-lg font-semibold">{seller.name}</div>
            <div className="mt-1 space-y-0.5 text-sm text-ink-500">
              {seller.address && <div>{seller.address}</div>}
              {seller.pin && <div>KRA PIN {seller.pin}</div>}
              {(seller.email || seller.phone) && <div>{[seller.email, seller.phone].filter(Boolean).join(' · ')}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tracking-tight">{paid ? 'Receipt' : 'Invoice'}</div>
            <div className="mt-1 font-mono text-sm">{t.invoice_no}</div>
            <div
              className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${paid ? 'bg-emerald-50 text-emerald-800' : t.status === 'pending' ? 'bg-amber-50 text-amber-900' : 'bg-ink-50 text-ink-700'}`}
            >
              {paid ? 'Paid' : t.status === 'pending' ? 'Awaiting payment' : 'Not paid'}
            </div>
          </div>
        </header>
        <section className="grid gap-6 py-6 text-sm sm:grid-cols-2">
          <div>
            <div className="label">Billed to</div>
            <div className="mt-1 font-medium">{t.club}</div>
          </div>
          <div className="sm:text-right">
            <div className="label">Date</div>
            <div className="mt-1">{dateTime(t.created_at)}</div>
            {paid && t.paid_at && (
              <>
                <div className="label mt-3">Paid</div>
                <div className="mt-1">{dateTime(t.paid_at)}</div>
              </>
            )}
          </div>
        </section>
        <table className="w-full text-sm">
          <thead className="border-y border-ink-100 text-left text-xs text-ink-500">
            <tr>
              <th className="py-2.5 font-medium">Description</th>
              <th className="py-2.5 text-right font-medium">Period</th>
              <th className="py-2.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-ink-100">
              <td className="py-3">
                {t.kind === 'setup' ? 'Lango setup fee (one time)' : `${t.plan_name} subscription`}
                {t.kind !== 'setup' && t.cycles > 1 ? ` × ${t.cycles}` : ''}
              </td>
              <td className="py-3 text-right">
                {t.period_from && t.period_to ? `${d(t.period_from)} – ${d(t.period_to)}` : '—'}
              </td>
              <td className="py-3 text-right tabular-nums">{kes(t.amount_kes)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="pt-4 text-right font-medium">
                {paid ? 'Total paid' : 'Total due'}
              </td>
              <td className="pt-4 text-right text-lg font-semibold tabular-nums">{kes(t.amount_kes)}</td>
            </tr>
          </tfoot>
        </table>
        <footer className="mt-8 space-y-1 border-t border-ink-100 pt-6 text-sm text-ink-500">
          {paid ? (
            <div>
              Paid by M-Pesa from {phone}
              {t.receipt_ref ? (
                <>
                  , M-Pesa receipt <span className="font-mono text-ink-900">{t.receipt_ref}</span>
                </>
              ) : null}
              .
            </div>
          ) : t.status === 'pending' ? (
            <div>An M-Pesa prompt was sent to {phone}. This becomes a receipt once the payment is confirmed.</div>
          ) : (
            <div>This payment was not completed and nothing was charged.</div>
          )}
          <div>
            Account reference <span className="font-mono">{t.invoice_no}</span>
          </div>
        </footer>
      </article>
    </>
  );
}
