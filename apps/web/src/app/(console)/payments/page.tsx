import { can } from '@lango/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Notice } from '@/components/notice';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader, Stat } from '@/components/ui';
import { payments, products, unmatchedPayments } from '@/lib/data';
import { dateTime, kes } from '@/lib/format';
import { canAny, requireSession } from '@/lib/session';
import { assignUnmatched } from '../actions';

export default async function Payments({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const s = await requireSession();
  if (!canAny(s, 'payments.record', 'payments.assign', 'reports.all')) redirect('/?denied=1');
  const { n } = await searchParams;
  const [all, queue, plans] = await Promise.all([payments(s.tid), unmatchedPayments(s.tid), products(s.tid)]);
  // Front desk sees today only (Nairobi day).
  const full = can(s, 'reports.all');
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const rows = full
    ? all
    : all.filter((r) => new Date(r.paid_at.getTime() + 3 * 3600_000).toISOString().slice(0, 10) === today);
  const onSale = plans.filter((p) => p.active);
  const canAssign = can(s, 'payments.assign');
  const applied = rows.filter((r) => r.status === 'applied');
  const unmatched = rows.filter((r) => r.status === 'unmatched');
  const sum = (xs: readonly { amount_kes: number }[]) => xs.reduce((a, b) => a + b.amount_kes, 0);
  // Everything except cash goes through TaifaPay (M-Pesa prompt, paybill/till, card, bank) and carries the convenience fee.
  const viaTaifa = applied.filter((r) => r.channel !== 'cash');
  const cash = applied.filter((r) => r.channel === 'cash');
  return (
    <>
      <Notice code={n} />
      <PageHeader
        title="Payments"
        subtitle={
          full
            ? 'Every shilling, where it came from, and what it unlocked. Compare these totals with your M-Pesa and bank statements.'
            : 'Today’s payments at this club.'
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={full ? 'Applied (last 200)' : 'Applied today'} value={kes(sum(applied))} />
        <Stat label="Through TaifaPay" value={kes(sum(viaTaifa))} hint="M-Pesa, paybill, card, bank" />
        <Stat label="Cash at the desk" value={kes(sum(cash))} hint="recorded by staff, audited" />
        <Stat
          label="Unmatched"
          value={unmatched.length}
          hint="held — no access granted"
          tone={unmatched.length ? 'warn' : 'default'}
        />
      </div>
      {queue.length > 0 && (
        <section className="card mt-6 p-6 ring-1 ring-amber-200">
          <div className="font-medium">Payments to assign</div>
          <p className="mt-1 text-sm text-ink-500">
            Money that arrived but could not be matched, usually a mistyped account number. Nothing is lost: point each
            one at the right member and plan, and their access updates straight away.
          </p>
          <ul className="mt-4 divide-y divide-ink-100">
            {queue.map((q) => {
              const fits = onSale.filter((p) => p.price_kes === q.amount_kes);
              return (
                <li key={q.id} className="grid gap-3 py-3 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="text-sm">
                    <span className="font-medium tabular-nums">{kes(q.amount_kes)}</span>
                    <span className="text-ink-500">
                      {' '}
                      · {dateTime(q.paid_at)} · account typed “{q.account_ref ?? ''}”{q.phone ? ` · ${q.phone}` : ''}
                    </span>
                    {q.reason && <div className="text-xs text-amber-700">{q.reason}</div>}
                  </div>
                  {canAssign &&
                    (fits.length ? (
                      <form action={assignUnmatched} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="paymentId" value={q.id} />
                        <input
                          name="memberNo"
                          inputMode="numeric"
                          required
                          placeholder="Member no."
                          className="input w-32 py-2"
                        />
                        <select name="productId" className="input w-56 py-2" defaultValue={fits[0]?.id}>
                          {fits.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <SubmitButton pendingText="Assigning…" className="btn-primary py-2">
                          Assign
                        </SubmitButton>
                      </form>
                    ) : (
                      <span className="text-xs text-ink-500">
                        No plan costs {kes(q.amount_kes)}: refund it or add a matching plan.
                      </span>
                    ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-50/60 text-left">
            <tr>
              {['When', 'Member', 'Account', 'Plan', 'Amount', 'Source', 'Reference', 'Status'].map((h) => (
                <th key={h} className="label px-5 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-ink-50/50">
                <td className="whitespace-nowrap px-5 py-2.5 text-ink-500">{dateTime(p.paid_at)}</td>
                <td className="px-5 py-2.5">
                  {p.member_id ? (
                    <Link href={`/members/${p.member_id}`} className="hover:underline">
                      {p.member}
                    </Link>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </td>
                <td className="px-5 py-2.5 font-mono text-xs">{p.account_ref ?? '—'}</td>
                <td className="px-5 py-2.5">{p.product ?? '—'}</td>
                <td className="px-5 py-2.5 tabular-nums">{kes(p.amount_kes)}</td>
                <td className="px-5 py-2.5 text-ink-500">
                  {p.channel === 'cash'
                    ? `Cash · ${p.recorded_by ?? 'staff'}`
                    : p.provider === 'taifapay' || p.provider === 'seed'
                      ? `TaifaPay · ${p.channel === 'mpesa' ? 'M-Pesa' : p.channel}`
                      : p.provider.replace('desk-', 'desk · ')}
                </td>
                <td className="max-w-[140px] truncate px-5 py-2.5 font-mono text-[11px] text-ink-500">
                  {p.provider_txn_id}
                </td>
                <td className="px-5 py-2.5">
                  {p.status === 'applied' ? (
                    <Badge tone="green">applied</Badge>
                  ) : (
                    <Badge tone="amber">{p.status}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
