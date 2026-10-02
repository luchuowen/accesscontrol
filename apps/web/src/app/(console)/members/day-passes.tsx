import { Plus } from 'lucide-react';
import { SubmitButton } from '@/components/submit-button';
import { dayPassBoard } from '@/lib/data';
import { kes } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { addBands } from '../walkin/actions';

/** Day passes: every wristband with who has it and until when, today's takings, and recent walk-in visits. */
const time = (d: Date | null) =>
  d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' }) : '';

export async function DayPasses({ canAdd }: { canAdd: boolean }) {
  const s = await requireSession();
  const { bands, today, visits } = await dayPassBoard(s.tid);
  const out = bands.filter((b) => b.status !== 'free').length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Sold today', String(today.sold)],
          ['Day pass money today', kes(today.kes)],
          ['Bands out', `${out} of ${bands.length}`],
        ].map(([l, v]) => (
          <div key={l} className="rounded-2xl border border-[#E7EBF3] bg-white px-4 py-3">
            <div className="text-[11.5px] text-ink-500">{l}</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-[#E7EBF3] bg-white p-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Wristbands</div>
          {canAdd && (
            <form action={addBands} className="flex items-center gap-2">
              <input
                name="count"
                type="number"
                min={1}
                max={100}
                defaultValue={10}
                aria-label="How many bands"
                className="h-9 w-20 rounded-[9px] border border-[#E5E8EE] px-2.5 text-sm"
              />
              <SubmitButton
                pendingText="Adding…"
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-ink-900 px-3 text-xs font-semibold text-white"
              >
                <Plus size={14} /> Add bands
              </SubmitButton>
            </form>
          )}
        </div>
        {bands.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">
            No wristbands yet. Add the number of day-pass bands your club has; each gets a number from 11001.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {bands.map((b) => (
              <div
                key={b.id}
                className={`min-h-[68px] rounded-xl border px-3 py-2 text-[12px] ${b.status === 'in_use' ? 'border-[#BDE8D6] bg-emerald-50' : b.status === 'awaiting' ? 'border-amber-200 bg-amber-50' : 'border-[#E5E8EE]'}`}
              >
                <b className="block font-mono text-[13px]">{b.no}</b>
                {b.status === 'free' ? (
                  <span className="text-slate-400">Free</span>
                ) : (
                  <>
                    <span
                      className={`block truncate font-semibold ${b.status === 'awaiting' ? 'text-amber-700' : 'text-[#047857]'}`}
                    >
                      {b.visitor ?? 'In use'}
                    </span>
                    <span className="block truncate text-ink-500">
                      {b.status === 'awaiting' ? 'Waiting for M-Pesa' : `Until ${time(b.until)}`}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-x-auto rounded-2xl border border-[#E7EBF3] bg-white">
        <table className="w-full text-sm">
          <thead className="bg-ink-50/60 text-left">
            <tr>
              {['When', 'Visitor', 'Mobile', 'Passes', 'Band', 'Paid', 'Status'].map((h) => (
                <th key={h} className="label px-5 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {visits.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-6 text-center text-ink-500">
                  No walk-ins yet. Sell one with “Walk-in”.
                </td>
              </tr>
            )}
            {visits.map((v) => (
              <tr key={v.id}>
                <td className="whitespace-nowrap px-5 py-3 text-ink-500">
                  {v.created_at.toLocaleString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Africa/Nairobi',
                  })}
                </td>
                <td className="px-5 py-3 font-medium">{v.visitor_name}</td>
                <td className="px-5 py-3 text-ink-500">{v.visitor_phone ?? '—'}</td>
                <td className="px-5 py-3">{v.passes}</td>
                <td className="px-5 py-3 font-mono text-xs">#{v.band}</td>
                <td className="whitespace-nowrap px-5 py-3 tabular-nums">
                  {kes(v.total_kes)}{' '}
                  <span className="text-xs text-ink-500">{v.channel === 'cash' ? 'cash' : 'M-Pesa'}</span>
                </td>
                <td className="px-5 py-3 text-xs">
                  {v.status === 'active'
                    ? v.ends_at && v.ends_at.getTime() > Date.now()
                      ? `In until ${time(v.ends_at)}`
                      : 'Done'
                    : v.status === 'awaiting_payment'
                      ? 'Waiting for M-Pesa'
                      : v.status === 'cancelled'
                        ? 'Cancelled'
                        : 'Not paid'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
