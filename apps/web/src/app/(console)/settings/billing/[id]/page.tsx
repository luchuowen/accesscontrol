import { withTenant } from '@lango/db';
import { can, platformBilling } from '@lango/server';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LetterheadDoc } from '@/components/letterhead-doc';
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
      <LetterheadDoc
        seller={seller}
        title={paid ? 'Receipt' : 'Invoice'}
        number={t.invoice_no}
        state={paid ? 'paid' : t.status === 'pending' ? 'pending' : 'failed'}
        facts={[
          { k: paid ? 'Receipt no.' : 'Invoice no.', v: t.invoice_no, mono: true },
          { k: paid ? 'Date paid' : 'Date', v: dateTime(paid && t.paid_at ? t.paid_at : t.created_at) },
          { k: 'Paid by', v: `M-Pesa · ${phone}` },
          { k: 'M-Pesa code', v: t.receipt_ref ?? '—', mono: true },
        ]}
        billedTo={t.club}
        billedNote="Lango club account"
        issued={dateTime(t.created_at)}
        columns={['Description', 'Period', 'Amount']}
        lines={[
          {
            title:
              t.kind === 'setup'
                ? 'Lango setup fee'
                : `${t.plan_name} subscription${t.cycles > 1 ? ` × ${t.cycles}` : ''}`,
            note: t.kind === 'setup' ? 'Setting up the club on Lango' : undefined,
            cells: [
              t.period_from && t.period_to ? `${d(t.period_from)} – ${d(t.period_to)}` : 'One time',
              kes(t.amount_kes),
            ],
          },
        ]}
        totalLabel={paid ? 'Total paid' : 'Total due'}
        total={kes(t.amount_kes)}
        notes={
          <>
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
          </>
        }
      />
    </>
  );
}
