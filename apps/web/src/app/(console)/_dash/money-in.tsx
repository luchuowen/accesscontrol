import Link from 'next/link';
import { kes } from '@/lib/format';

/**
 * "Money in" card, design C "Weekly summary" (approved 2 Oct 2026): total, MPESA/CASH share bar, weekly (or daily)
 * bars on a labelled scale with a hover card, and three quick facts. Plain HTML/CSS, rendered on the server.
 */
type Day = { day: string; mpesa: number; cash: number };
type Bar = { key: string; label: string; tip: string; mpesa: number; cash: number };

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d(iso));
const range = (a: string, b: string) => {
  if (a === b) return fmt(a);
  const [da, ma] = fmt(a).split(' ');
  const [db, mb] = fmt(b).split(' ');
  return ma === mb ? `${da}–${db} ${mb}` : `${da} ${ma} – ${db} ${mb}`;
};
const short = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n);

/** A round top for the scale, and its step, so gridlines land on readable amounts. */
function scale(top: number) {
  if (top <= 0) return { max: 4000, step: 1000 };
  const raw = top / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  return { max: Math.ceil(top / step) * step, step };
}

export function MoneyIn({ daily, days, weekly }: { daily: Day[]; days: number; weekly: boolean }) {
  const mpesa = daily.reduce((a, x) => a + x.mpesa, 0);
  const cash = daily.reduce((a, x) => a + x.cash, 0);
  const total = mpesa + cash;
  const share = total ? Math.round((mpesa / total) * 100) : 0;
  const best = daily.reduce<Day | null>((b, x) => (!b || x.mpesa + x.cash > b.mpesa + b.cash ? x : b), null);
  const empty = daily.filter((x) => x.mpesa + x.cash === 0).length;

  const bars: Bar[] = [];
  if (weekly) {
    for (let i = 0; i < daily.length; i += 7) {
      const w = daily.slice(i, i + 7);
      const a = w[0]?.day ?? '';
      const b = w[w.length - 1]?.day ?? a;
      bars.push({
        key: a,
        label: range(a, b),
        tip: range(a, b),
        mpesa: w.reduce((s, x) => s + x.mpesa, 0),
        cash: w.reduce((s, x) => s + x.cash, 0),
      });
    }
  } else {
    for (const x of daily) bars.push({ key: x.day, label: fmt(x.day), tip: fmt(x.day), ...x });
  }
  const { max, step } = scale(Math.max(0, ...bars.map((b) => b.mpesa + b.cash)));
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step).reverse();
  const every = weekly ? (bars.length > 7 ? 2 : 1) : Math.ceil(bars.length / 6);
  const view = (w: boolean) => `/?p=${days}&v=${w ? 'w' : 'd'}`;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Money in</div>
          <div className="mt-1 text-[26px] font-semibold tabular-nums tracking-tight">{kes(total)}</div>
        </div>
        {days > 7 && (
          <nav className="flex gap-0.5 rounded-[9px] bg-slate-100 p-[3px] text-xs" aria-label="Chart view">
            {[false, true].map((w) => (
              <Link
                key={String(w)}
                href={view(w)}
                scroll={false}
                aria-current={w === weekly ? 'page' : undefined}
                className={`rounded-[7px] px-2.5 py-1 ${w === weekly ? 'bg-white font-semibold text-ink-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)]' : 'text-ink-500 hover:text-ink-900'}`}
              >
                {w ? 'Weekly' : 'Daily'}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <i className="block h-full bg-[linear-gradient(90deg,#34D399,#047857)]" style={{ width: `${share}%` }} />
        <i className="block h-full bg-ink-950" style={{ width: `${total ? 100 - share : 0}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-[3px] bg-brand-500" /> MPESA
          <b className="font-semibold tabular-nums text-ink-900">{mpesa.toLocaleString('en-KE')}</b> · {share}%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-[3px] bg-ink-950" /> CASH
          <b className="font-semibold tabular-nums text-ink-900">{cash.toLocaleString('en-KE')}</b> ·{' '}
          {total ? 100 - share : 0}%
        </span>
      </div>

      <div
        className="mt-5 grid grid-cols-[40px_minmax(0,1fr)]"
        role="img"
        aria-label={`${weekly ? 'Weekly' : 'Daily'} money in, last ${days} days, ${kes(total)} in total`}
      >
        <div className="relative h-44">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-2.5 -translate-y-1/2 text-[11px] tabular-nums text-slate-400"
              style={{ top: `${(1 - t / max) * 100}%` }}
            >
              {short(t)}
            </span>
          ))}
        </div>
        <div className="relative h-44">
          {ticks.map((t) => (
            <i
              key={t}
              className={`absolute inset-x-0 block border-t ${t ? 'border-dashed border-slate-100' : 'border-slate-200'}`}
              style={{ top: `${(1 - t / max) * 100}%` }}
            />
          ))}
          <div className={`absolute inset-0 flex items-end ${weekly ? 'gap-[2%] px-[2%]' : 'gap-[3px]'}`}>
            {bars.map((b) => {
              const sum = b.mpesa + b.cash;
              const h = (sum / max) * 100;
              return (
                <div key={b.key} className="group relative flex h-full flex-1 flex-col justify-end">
                  {weekly && (
                    <span className="absolute inset-0 rounded-[10px] bg-slate-50 transition group-hover:bg-slate-100" />
                  )}
                  {weekly && sum > 0 && (
                    <span
                      className="relative mb-1 text-center text-[11.5px] font-semibold tabular-nums text-ink-900"
                      aria-hidden="true"
                    >
                      {short(sum)}
                    </span>
                  )}
                  <div
                    className={`relative flex flex-col-reverse overflow-hidden ${weekly ? 'rounded-[10px]' : 'rounded-t-[3px]'}`}
                    style={{ height: `${sum ? Math.max(h, weekly ? 2.5 : 1.5) : 0}%` }}
                  >
                    <i
                      className="block bg-[linear-gradient(180deg,#34D399,#047857)] transition group-hover:brightness-90"
                      style={{ height: `${sum ? (b.mpesa / sum) * 100 : 0}%` }}
                    />
                    <i className="block bg-ink-950" style={{ height: `${sum ? (b.cash / sum) * 100 : 0}%` }} />
                  </div>
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-[9px] bg-ink-950 px-2.5 py-1.5 text-xs leading-[1.45] text-white shadow-lg group-hover:block">
                    <span className="block text-[#A3B3C9]">{b.tip}</span>
                    MPESA {kes(b.mpesa)}
                    <br />
                    CASH {kes(b.cash)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <span />
        <div className={`mt-2 flex h-4 text-[11px] text-slate-400 ${weekly ? 'gap-[2%] px-[2%]' : 'gap-[3px]'}`}>
          {bars.map((b, i) => {
            const last = !weekly && i === bars.length - 1;
            const show = last || (i % every === 0 && (weekly || i < bars.length - Math.ceil(every / 2)));
            return (
              <span key={b.key} className="relative min-w-0 flex-1">
                {show && (
                  <span
                    className={`absolute top-0 whitespace-nowrap ${last ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
                  >
                    {last ? 'Today' : weekly && bars.length > 7 ? fmt(b.key) : b.label}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        {[
          ['Best day', best && best.mpesa + best.cash > 0 ? `${fmt(best.day)} · ${kes(best.mpesa + best.cash)}` : '—'],
          ['Daily average', kes(Math.round(total / Math.max(1, days)))],
          ['Days with no payments', String(empty)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-[#E7EBF3] px-3 py-2.5">
            <div className="text-[11px] text-ink-500">{l}</div>
            <div className="mt-0.5 text-[15px] font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
    </>
  );
}
