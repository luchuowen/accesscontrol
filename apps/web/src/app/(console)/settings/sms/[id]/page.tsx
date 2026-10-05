import { withTenant } from '@lango/db';
import { platformBilling } from '@lango/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LetterheadDoc } from '@/components/letterhead-doc';
import { dateTime, kes } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';
import { PrintButton } from '../print-button';

/** Invoice for an SMS credit purchase; it becomes a receipt once Payment Gateway confirms the M-Pesa payment. */
export default async function SmsDocument({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [t] = await withTenant(
    db(),
    s.tid,
    (tx) => tx<
      {
        invoice_no: string;
        created_at: Date;
        completed_at: Date | null;
        amount_kes: number;
        price_kes: string;
        units: number;
        phone: string;
        status: string;
        receipt_ref: string | null;
        provider_ref: string | null;
        club: string;
      }[]
    >`select st.invoice_no, st.created_at, st.completed_at, st.amount_kes, st.price_kes, st.units, st.phone, st.status,
             st.receipt_ref, st.provider_ref, t.name as club
      from sms_topups st join tenants t on t.id = st.tenant_id where st.id = ${id}`,
  );
  if (!t) notFound();
  const seller = await platformBilling(db());
  const paid = t.status === 'completed';
  const title = paid ? 'Receipt' : 'Invoice';
  const price = Number(t.price_kes);
  const phone = t.phone.replace(/^254/, '0').replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
  return (
    <>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/settings/sms" className="text-sm text-ink-500 underline">
          ← All SMS purchases
        </Link>
        <PrintButton />
      </div>
      <LetterheadDoc
        seller={seller}
        title={title}
        number={t.invoice_no}
        state={paid ? 'paid' : t.status === 'pending' ? 'pending' : 'failed'}
        facts={[
          { k: paid ? 'Receipt no.' : 'Invoice no.', v: t.invoice_no, mono: true },
          { k: paid ? 'Date paid' : 'Date', v: dateTime(paid && t.completed_at ? t.completed_at : t.created_at) },
          { k: 'Paid by', v: `M-Pesa · ${phone}` },
          { k: 'M-Pesa code', v: t.receipt_ref ?? '—', mono: true },
        ]}
        billedTo={t.club}
        billedNote="Lango club account"
        issued={dateTime(t.created_at)}
        columns={['Description', 'Quantity', 'Price', 'Amount']}
        lines={[
          {
            title: 'Lango SMS credit',
            note: 'Prepaid, added to the club’s balance',
            cells: [`${t.units.toLocaleString('en-KE')} SMS`, kes(price), kes(t.amount_kes)],
          },
        ]}
        totalLabel={paid ? 'Total paid' : 'Total due'}
        total={kes(t.amount_kes)}
        notes={
          <>
            {paid ? (
              <>
                <div>
                  Paid by M-Pesa from {phone}
                  {t.receipt_ref ? (
                    <>
                      , M-Pesa receipt <span className="font-mono text-ink-900">{t.receipt_ref}</span>
                    </>
                  ) : null}
                  .
                </div>
                {t.provider_ref && (
                  <div>
                    Payment Gateway reference <span className="font-mono">{t.provider_ref}</span>
                  </div>
                )}
                <div>
                  {t.units.toLocaleString('en-KE')} SMS were added to {t.club}&apos;s balance when the payment was
                  confirmed.
                </div>
              </>
            ) : t.status === 'pending' ? (
              <div>
                An M-Pesa prompt was sent to {phone}. The SMS credit is added as soon as the payment is confirmed.
              </div>
            ) : (
              <div>This purchase was not completed and nothing was charged. Buy SMS again from Settings.</div>
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
