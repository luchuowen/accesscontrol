import { can } from '@lango/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { C } from '@/components/chart-colors';
import { Bars, HBars, Heat, Legend, LineDays, StackedDays } from '@/components/charts';
import { PageHeader } from '@/components/ui';
import { kes } from '@/lib/format';
import { PERIODS } from '@/lib/periods';
import { HEAT_FROM, reports } from '@/lib/reports';
import { requireSession } from '@/lib/session';
import { ExportMenu, PeriodSelect } from './controls';

/**
 * Reports, design B "One-page overview" (approved 2 Oct 2026): the whole business on one scroll. Key numbers on top,
 * then Money, Members & visits, and Walk-ins, each with its own Export; "Export all" gives one workbook or one PDF to
 * share with a partner or an accountant.
 */
export default async function Reports({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const s = await requireSession();
  if (!can(s, 'reports.all')) redirect('/?denied=1');
  const sp = await searchParams;
  const days = PERIODS.some(([d]) => d === Number(sp.p)) ? Number(sp.p) : 30;
  const r = await reports(s.tid, days);
  const label = PERIODS.find(([d]) => d === days)?.[1] ?? '';
  const nice = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const delta = (now: number, prev: number, unit = '%') => {
    if (!prev) return null;
    const c = Math.round(((now - prev) / prev) * 100);
    return (
      <span className={`font-semibold ${c >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
        {c >= 0 ? '▲' : '▼'} {Math.abs(c)}
        {unit}
      </span>
    );
  };
  const m = r.members;
  const rate = m.ended ? Math.round((m.renewed / m.ended) * 100) : null;
  const growth = m.active - m.activeAtStart;
  const busiest = (() => {
    let best = { d: -1, h: -1, n: 0 };
    r.heat.forEach((row, d) => {
      row.forEach((n, h) => {
        if (n > best.n) best = { d, h, n };
      });
    });
    return best.n ? `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][best.d]} ${HEAT_FROM + best.h}:00` : null;
  })();
  const services = r.services.slice(0, 4);
  const other = r.services.slice(4).reduce((a, x) => a + x.total, 0);
  const tile = (k: string, v: ReactNode, sub: ReactNode) => (
    <div className="rounded-2xl border border-[#E7EBF3] bg-white px-4 py-3.5 print:break-inside-avoid">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{k}</div>
      <div className="mt-1 truncate text-[22px] font-semibold tabular-nums tracking-tight">{v}</div>
      <div className="mt-0.5 text-[12px] text-ink-500">{sub}</div>
    </div>
  );
  const section = (id: 'money' | 'members' | 'walkins', title: string, sub: string, body: ReactNode) => (
    <section data-section={id} className="mb-5 overflow-hidden rounded-2xl border border-[#E7EBF3] bg-white">
      <header className="flex items-center gap-3 border-b border-[#EEF1F6] px-5 py-3.5">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="text-[12px] text-ink-500">{sub}</p>
        </div>
        <div className="ml-auto">
          <ExportMenu section={id} />
        </div>
      </header>
      {body}
    </section>
  );
  const th = 'px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500';
  const td = 'px-5 py-2.5 tabular-nums';
  return (
    <>
      <div className="mb-5 hidden print:block">
        <div className="text-[20px] font-semibold">{r.club} · Report</div>
        <div className="text-[12px] text-ink-500">
          {nice(r.from)} – {nice(r.to)} · printed {nice(new Date().toISOString().slice(0, 10))}
        </div>
      </div>
      <PageHeader
        title="Reports"
        subtitle={`How the club is doing: money, members, visits. ${nice(r.from)} – ${nice(r.to)}.`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <PeriodSelect days={days} />
            <ExportMenu section="all" primary />
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tile(
          `Money in · ${label.toLowerCase()}`,
          kes(r.money.total),
          r.money.prev ? <>{delta(r.money.total, r.money.prev)} on the period before</> : `${r.money.n} payments`,
        )}
        {tile(
          'Active members',
          m.active.toLocaleString('en-KE'),
          growth ? (
            <>
              <span className={`font-semibold ${growth > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {growth > 0 ? '▲' : '▼'} {Math.abs(growth)}
              </span>{' '}
              since {nice(r.from)}
            </>
          ) : (
            `${m.joined} new in the period`
          ),
        )}
        {tile(
          'Renewal rate',
          rate === null ? '—' : `${rate}%`,
          m.ended ? `${m.renewed} of ${m.ended} whose plan ended renewed` : 'No plans ended in the period',
        )}
        {tile(
          'Visits',
          r.visits.total.toLocaleString('en-KE'),
          busiest ? `${r.visits.people.toLocaleString('en-KE')} people · busiest ${busiest}` : 'No entries yet',
        )}
      </div>

      {section(
        'money',
        'Money',
        `${kes(r.money.total)} from ${r.money.n.toLocaleString('en-KE')} payments`,
        <>
          <div className="grid gap-0 lg:grid-cols-[1.5fr_1fr] lg:divide-x lg:divide-[#EEF1F6]">
            <div className="p-5">
              <div className="mb-2 flex items-center">
                <b className="text-[13px]">Money in per day</b>
                <div className="ml-auto">
                  <Legend
                    items={[
                      [`M-Pesa · ${kes(r.money.mpesa)}`, C.mpesa],
                      [`Cash · ${kes(r.money.cash)}`, C.cash],
                    ]}
                  />
                </div>
              </div>
              <StackedDays rows={r.daily} />
            </div>
            <div className="p-5">
              <b className="text-[13px]">By service</b>
              <div className="mt-4">
                {services.length ? (
                  <HBars
                    items={[
                      ...services.map((x) => ({ name: x.name, v: x.total })),
                      ...(other ? [{ name: 'Other', v: other }] : []),
                    ]}
                  />
                ) : (
                  <p className="text-[13px] text-ink-500">No sales in this period.</p>
                )}
              </div>
            </div>
          </div>
          {r.services.length > 0 && (
            <div className="overflow-x-auto border-t border-[#EEF1F6]">
              <table className="w-full text-[13px]">
                <thead className="bg-[#FAFBFC] text-left">
                  <tr>
                    <th className={th}>Service</th>
                    <th className={`${th} text-right`}>Sold</th>
                    <th className={`${th} text-right`}>M-Pesa</th>
                    <th className={`${th} text-right`}>Cash</th>
                    <th className={`${th} text-right`}>Total</th>
                    <th className={`${th} text-right`}>Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F2F6]">
                  {r.services.map((x) => (
                    <tr key={x.name}>
                      <td className="px-5 py-2.5 font-medium">{x.name}</td>
                      <td className={`${td} text-right`}>{x.sold.toLocaleString('en-KE')}</td>
                      <td className={`${td} text-right`}>{kes(x.mpesa)}</td>
                      <td className={`${td} text-right`}>{kes(x.cash)}</td>
                      <td className={`${td} text-right font-semibold`}>{kes(x.total)}</td>
                      <td className={`${td} text-right text-ink-500`}>
                        {r.money.total
                          ? x.total / r.money.total < 0.01
                            ? '<1'
                            : Math.round((x.total / r.money.total) * 100)
                          : 0}
                        %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>,
      )}

      {section(
        'members',
        'Members & visits',
        `${m.joined} joined · ${m.ended - m.renewed} lapsed · ${r.visits.denied.toLocaleString('en-KE')} turned away at the door`,
        <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-[#EEF1F6]">
          <div className="p-5">
            <div className="mb-2 flex items-baseline gap-2">
              <b className="text-[13px]">Active members</b>
              <span className="text-[12px] text-ink-500">paid up, per day</span>
            </div>
            <LineDays rows={r.activeDaily} />
            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-[#F0F2F6] pt-4 text-[12px] text-ink-500">
              <div>
                <dt>Joined</dt>
                <dd className="text-[18px] font-semibold text-ink-900 tabular-nums">{m.joined}</dd>
              </div>
              <div>
                <dt>Renewed</dt>
                <dd className="text-[18px] font-semibold text-ink-900 tabular-nums">{m.renewed}</dd>
              </div>
              <div>
                <dt>Lapsed</dt>
                <dd className="text-[18px] font-semibold text-ink-900 tabular-nums">{m.ended - m.renewed}</dd>
              </div>
            </dl>
          </div>
          <div className="p-5">
            <div className="mb-3 flex items-baseline gap-2">
              <b className="text-[13px]">Busiest times</b>
              <span className="text-[12px] text-ink-500">entries per hour</span>
            </div>
            <Heat grid={r.heat} from={HEAT_FROM} />
            <p className="mt-4 border-t border-[#F0F2F6] pt-4 text-[12px] text-ink-500">
              {r.visits.total.toLocaleString('en-KE')} entries{' '}
              {r.visits.prev ? <>({delta(r.visits.total, r.visits.prev)} on the period before)</> : null}
              {busiest ? <>; the busiest hour is {busiest}.</> : '.'}
            </p>
          </div>
        </div>,
      )}

      {section(
        'walkins',
        'Walk-ins',
        'Day passes on wristbands',
        <div className="grid lg:grid-cols-[1fr_2fr] lg:divide-x lg:divide-[#EEF1F6]">
          <dl className="grid grid-cols-3 gap-3 p-5 text-[12px] text-ink-500 lg:grid-cols-1">
            <div>
              <dt>Passes sold</dt>
              <dd className="text-[20px] font-semibold text-ink-900 tabular-nums">
                {r.walkins.passes.toLocaleString('en-KE')}
              </dd>
            </div>
            <div>
              <dt>Money in</dt>
              <dd className="text-[20px] font-semibold text-ink-900 tabular-nums">{kes(r.walkins.kes)}</dd>
            </div>
            <div>
              <dt>Average pass</dt>
              <dd className="text-[20px] font-semibold text-ink-900 tabular-nums">{kes(r.walkins.avg)}</dd>
            </div>
          </dl>
          <div className="p-5">
            <div className="mb-2 flex items-baseline gap-2">
              <b className="text-[13px]">Passes per day</b>
            </div>
            <Bars
              rows={r.walkins.byDay.map((d) => ({ day: d.day, v: d.passes, note: `passes · ${kes(d.kes)}` }))}
              color={C.series[2] ?? '#eda100'}
              unit=""
            />
          </div>
        </div>,
      )}
    </>
  );
}
