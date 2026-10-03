import { can } from '@lango/server';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Notice } from '@/components/notice';
import { Pager } from '@/components/pager';
import { SubmitButton } from '@/components/submit-button';
import { PageHeader } from '@/components/ui';
import { paymentsBoard, products, unmatchedPayments } from '@/lib/data';
import { dateTime, kes } from '@/lib/format';
import { canAny, requireSession } from '@/lib/session';
import { assignUnmatched } from '../actions';
import { ExportMenu, LedgerFilters, LedgerTable, PayFor } from './ledger';

/**
 * Payments, design A "Ledger" (approved 2 Oct 2026): money in for the period and how it came (M-Pesa through the
 * Payment Gateway, or cash at the desk) against the period before; an amber bar when money needs sorting (paid but
 * not matched to a member, so nobody got access yet); one searchable, filterable list with a details panel; Record
 * cash / Send M-Pesa prompt; export to Excel, CSV or PDF. Front desk sees today only.
 */
type Params = { n?: string; p?: string; q?: string; m?: string; s?: string; pg?: string };
const PER = 20;

export default async function Payments({ searchParams }: { searchParams: Promise<Params> }) {
  const s = await requireSession();
  if (!canAny(s, 'payments.record', 'payments.assign', 'reports.all')) redirect('/?denied=1');
  const sp = await searchParams;
  const full = can(s, 'reports.all');
  const page = Math.max(1, Math.floor(Number(sp.pg)) || 1);
  const pageHref = (n: number) => {
    const u = new URLSearchParams();
    for (const k of ['p', 'q', 'm', 's'] as const) if (sp[k]) u.set(k, sp[k] as string);
    if (n > 1) u.set('pg', String(n));
    return `/payments${u.size ? `?${u}` : ''}`;
  };
  const days = full ? Math.min(366, Math.max(1, Number(sp.p) || 30)) : 0;
  const [b, queue, plans] = await Promise.all([
    paymentsBoard(s.tid, { days, q: sp.q, method: sp.m, status: sp.s, limit: PER, offset: (page - 1) * PER }),
    unmatchedPayments(s.tid),
    products(s.tid),
  ]);
  const onSale = plans.filter((p) => p.on_sale);
  const canAssign = can(s, 'payments.assign');
  const pay = can(s, 'payments.record');
  const t = b.totals;
  const change = b.previous ? Math.round(((t.total - b.previous) / b.previous) * 100) : null;
  const period = days === 0 ? 'today' : days === 1 ? 'today' : `${days} days`;
  const pct = (n: number) => (t.total ? Math.round((n / t.total) * 100) : 0);
  const tile = (label: string, value: string, sub: React.ReactNode, tone = '') => (
    <div className="rounded-2xl border border-[#E7EBF3] bg-white px-4 py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</div>
      <div className={`mt-1 truncate text-[22px] font-semibold tabular-nums tracking-tight ${tone}`}>{value}</div>
      <div className="mt-0.5 text-[12px] text-ink-500">{sub}</div>
    </div>
  );
  return (
    <>
      <PageHeader
        title="Payments"
        subtitle={full ? 'Money in, how it came, and anything that needs you.' : 'Today’s payments at the club.'}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            {pay && <PayFor kind="cash" />}
            {pay && <PayFor kind="pay" />}
            <ExportMenu />
          </div>
        }
      />
      <Notice code={sp.n} />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tile(
          `Money in · ${period}`,
          kes(t.total),
          change === null ? (
            `${t.n} payments`
          ) : (
            <>
              <span className={`font-semibold ${change >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {change >= 0 ? '▲' : '▼'} {Math.abs(change)}%
              </span>{' '}
              on the {days <= 1 ? 'day' : `${days} days`} before
            </>
          ),
        )}
        {tile('M-Pesa', kes(t.mpesa), `${pct(t.mpesa)}% · through the Payment Gateway`)}
        {tile('Cash at the desk', kes(t.cash), `${pct(t.cash)}% · recorded by staff`)}
        {tile(
          'Needs sorting',
          b.held.n ? `${b.held.n} · ${kes(b.held.kes)}` : 'Nothing',
          b.held.n ? 'Paid, but not matched to a member' : 'Every payment is matched',
          b.held.n ? 'text-amber-700' : '',
        )}
      </div>

      {queue.length > 0 && (
        <a
          href="#sort"
          className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 print:hidden"
        >
          <AlertCircle size={18} className="shrink-0" />
          <span>
            <b>
              {queue.length} payment{queue.length === 1 ? '' : 's'} need{queue.length === 1 ? 's' : ''} you (
              {kes(queue.reduce((a, q) => a + q.amount_kes, 0))}).
            </b>{' '}
            Lango couldn’t tell who or what {queue.length === 1 ? 'it was' : 'they were'} for, so no access was given
            yet.
          </span>
          <span className="ml-auto shrink-0 rounded-[9px] bg-white px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-amber-200">
            Sort them
          </span>
        </a>
      )}

      <section className="overflow-hidden rounded-2xl border border-[#E7EBF3] bg-white">
        <div className="print:hidden">
          <LedgerFilters full={full} />
        </div>
        {b.rows.length ? (
          <LedgerTable
            canSort={canAssign}
            rows={b.rows.map((r) => ({
              id: r.id,
              at: r.paid_at.toISOString(),
              amount: r.amount_kes,
              status: r.status,
              cash: r.channel === 'cash',
              provider: r.provider,
              ref: r.provider_txn_id,
              account: r.account_ref,
              phone: r.phone,
              memberId: r.member_id,
              memberNo: r.member_no,
              member: r.member,
              product: r.product,
              recordedBy: r.recorded_by,
            }))}
          />
        ) : (
          <p className="px-5 py-12 text-center text-sm text-ink-500">
            {page > 1 && b.count === 0 ? (
              <Link href={pageHref(1)} className="font-semibold text-ink-900 underline">
                Back to the first page
              </Link>
            ) : (
              'No payments match.'
            )}
          </p>
        )}
        <Pager page={page} per={PER} total={b.count} noun="payments" href={pageHref} />
      </section>

      {queue.length > 0 && (
        <section id="sort" className="mt-6 scroll-mt-20 rounded-2xl border border-amber-200 bg-white print:hidden">
          <header className="flex items-center gap-2.5 border-b border-[#EEF1F6] px-4 py-3">
            <AlertCircle size={16} className="text-amber-600" />
            <h2 className="text-[14px] font-semibold">Payments to sort</h2>
            <span className="text-[12px] text-ink-500">
              Point each one at the right member and service; their access updates straight away.
            </span>
          </header>
          <ul className="divide-y divide-[#F0F2F6]">
            {queue.map((q) => {
              const fits = onSale.filter((p) => p.price_kes === q.amount_kes);
              return (
                <li key={q.id} className="grid gap-3 px-4 py-3.5 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="text-[13px]">
                    <b className="tabular-nums">{kes(q.amount_kes)}</b>
                    {q.member && (
                      <b>
                        {' '}
                        · {q.member} (#{q.member_no})
                      </b>
                    )}
                    <span className="text-ink-500">
                      {' '}
                      · {dateTime(q.paid_at)} · typed “{q.account_ref ?? ''}”{q.phone ? ` · ${q.phone}` : ''}
                    </span>
                    {q.reason && <div className="text-[12px] text-amber-700">{q.reason}</div>}
                  </div>
                  {canAssign &&
                    (fits.length ? (
                      <form action={assignUnmatched} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="paymentId" value={q.id} />
                        <input
                          name="memberNo"
                          inputMode="numeric"
                          required
                          defaultValue={q.member_no ?? ''}
                          placeholder="Member no."
                          aria-label="Member number"
                          className="input w-32 py-2"
                        />
                        <select
                          name="productId"
                          aria-label="Service"
                          className="input w-60 py-2"
                          defaultValue={fits[0]?.id}
                        >
                          {fits.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <SubmitButton pendingText="Applying…" className="btn-primary py-2">
                          Apply
                        </SubmitButton>
                      </form>
                    ) : (
                      <span className="text-[12px] text-ink-500">
                        No price is {kes(q.amount_kes)}: ask NAVAC to refund it, or add that price under Services.
                      </span>
                    ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
