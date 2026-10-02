import { can } from '@lango/server';
import Link from 'next/link';
import { ownerDashboard } from '@/lib/data';
import { ago, kes } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { LiveRefresh } from './_dash/live-refresh';

/**
 * Dashboard, design B "Business health" (approved 2 Oct 2026): live "in the club now", revenue, active members and
 * renewal rate with trends; money in by channel; the renewals picture; and three short lists to act on.
 */
const PERIODS = [7, 30, 90] as const;
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
const DOW = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

function Spark({ values, dark }: { values: number[]; dark?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <div className="mt-3 flex h-8 items-end gap-[3px]" aria-hidden="true">
      {values.map((v, i) => (
        <i
          key={`s${i}`}
          className={`flex-1 rounded-t-[2px] ${i === values.length - 1 ? (dark ? 'bg-[#34D399]' : 'bg-brand-500') : dark ? 'bg-white/20' : 'bg-slate-300'}`}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[#E7EBF3] bg-white p-[18px] ${className}`}>{children}</section>;
}
const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{children}</div>
);

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ p?: string; denied?: string }> }) {
  const s = await requireSession();
  const { p, denied } = await searchParams;
  const days = PERIODS.find((x) => String(x) === p) ?? 30;
  const d = await ownerDashboard(s.tid, days);
  const full = can(s, 'reports.all');
  const change = pct(d.revenue.now, d.revenue.prev);
  const rate = d.renewals.ended ? Math.round((d.renewals.renewed / d.renewals.ended) * 100) : null;
  const net = d.members.joined - d.members.lapsed;
  const max = Math.max(1, ...d.daily.map((x) => x.mpesa + x.cash));
  const bridgeOff = !d.attention.bridgeLastSeen || Date.now() - d.attention.bridgeLastSeen.getTime() > 10 * 60_000;
  const attention = [
    d.attention.unmatched > 0 &&
      can(s, 'payments.assign') && {
        tone: 'bg-rose-600',
        text: `${d.attention.unmatched} payment${d.attention.unmatched > 1 ? 's' : ''} not matched`,
        meta: kes(d.attention.unmatchedKes),
        href: '/payments',
      },
    bridgeOff && {
      tone: 'bg-amber-500',
      text: d.attention.bridgeLastSeen
        ? `Door PC offline ${ago(d.attention.bridgeLastSeen)}`
        : 'Door PC not connected yet',
      meta: '',
      href: can(s, 'doors.manage') ? '/access' : undefined,
    },
    d.attention.syncFailed > 0 && {
      tone: 'bg-rose-600',
      text: `${d.attention.syncFailed} door update${d.attention.syncFailed > 1 ? 's' : ''} failed`,
      meta: '',
      href: can(s, 'doors.manage') ? '/access' : undefined,
    },
    d.attention.smsUnits < 100 && {
      tone: 'bg-amber-500',
      text: 'SMS credit low',
      meta: `${d.attention.smsUnits} left`,
      href: can(s, 'sms.buy') ? '/settings' : undefined,
    },
  ].filter(Boolean) as { tone: string; text: string; meta: string; href?: string }[];
  const dow = DOW[new Date().getDay()];

  return (
    <>
      <LiveRefresh />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink-900">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-500">{d.tenantName} · how the business is doing</p>
        </div>
        {full && (
          <nav
            className="flex gap-0.5 rounded-[10px] border border-[#E5E8EE] bg-white p-[3px] text-xs"
            aria-label="Period"
          >
            {PERIODS.map((x) => (
              <Link
                key={x}
                href={`/?p=${x}`}
                aria-current={x === days ? 'page' : undefined}
                className={`rounded-[7px] px-2.5 py-1.5 ${x === days ? 'bg-ink-950 text-white' : 'text-ink-500 hover:text-ink-900'}`}
              >
                {x} days
              </Link>
            ))}
          </nav>
        )}
      </div>
      {denied && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Your role doesn’t include that page. Ask the club’s owner or an admin if you need it.
        </div>
      )}

      <div className={`grid gap-3.5 sm:grid-cols-2 ${full ? 'xl:grid-cols-4' : 'xl:grid-cols-2'}`}>
        <section className="rounded-2xl bg-[linear-gradient(135deg,#0B1629_0%,#11284A_60%,#0E3A33_100%)] p-[18px] text-white">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">In the club now</div>
          <div className="mt-1.5 flex items-baseline gap-2.5">
            <span className="text-[34px] font-semibold tabular-nums tracking-tight">{d.live.inside}</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-[#34D399]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34D399] opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34D399]" />
              </span>
              LIVE
            </span>
          </div>
          <div className="mt-1 text-xs text-[#A3B3C9]">
            {d.live.busiestHour !== null
              ? `Busiest at ${hourLabel(d.live.busiestHour)} on ${dow}`
              : 'Entered in the last 90 minutes'}
          </div>
          <Spark values={d.live.todayByHour.slice(5, 23)} dark />
        </section>
        {full && (
          <Card>
            <Label>Revenue</Label>
            <div className="mt-1.5 text-[28px] font-semibold tabular-nums tracking-tight">{kes(d.revenue.now)}</div>
            <div className="mt-1 text-xs text-ink-500">
              {change === null ? (
                `last ${days} days`
              ) : (
                <>
                  <span className={change >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                    {change >= 0 ? '▲' : '▼'} {Math.abs(change)}%
                  </span>{' '}
                  vs previous {days} days
                </>
              )}
            </div>
            <Spark values={d.revenue.spark} />
          </Card>
        )}
        <Card>
          <Label>Active members</Label>
          <div className="mt-1.5 text-[28px] font-semibold tabular-nums tracking-tight">{d.members.active}</div>
          <div className="mt-1 text-xs text-ink-500">
            <span className={net >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
              {net >= 0 ? '+' : '−'}
              {Math.abs(net)}
            </span>{' '}
            net · {d.members.joined} joined, {d.members.lapsed} lapsed
          </div>
          <Spark values={d.members.spark} />
        </Card>
        {full && (
          <Card>
            <Label>Renewal rate</Label>
            <div className="mt-1.5 text-[28px] font-semibold tabular-nums tracking-tight">
              {rate === null ? '—' : `${rate}%`}
            </div>
            <div className="mt-1 text-xs text-ink-500">of memberships that ended in the last {days} days</div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <i className="block h-full rounded-full bg-brand-500" style={{ width: `${rate ?? 0}%` }} />
            </div>
          </Card>
        )}
      </div>

      {full && (
        <div className="mt-3.5 grid gap-3.5 xl:grid-cols-[2fr_1fr]">
          <Card className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Label>Money in · last {days} days</Label>
              <span className="font-mono text-[11.5px] text-slate-500">
                MPESA {d.revenue.mpesa.toLocaleString('en-KE')} · CASH {d.revenue.cash.toLocaleString('en-KE')}
              </span>
            </div>
            <div
              className="mt-4 flex h-40 items-end gap-[3px] border-b border-slate-100"
              role="img"
              aria-label={`Daily money in for the last ${days} days`}
            >
              {d.daily.map((x) => (
                <div key={x.day} className="flex flex-1 flex-col-reverse" title={`${x.day}: ${kes(x.mpesa + x.cash)}`}>
                  <i className="block bg-brand-500" style={{ height: `${(x.mpesa / max) * 160}px` }} />
                  <i className="block bg-ink-950" style={{ height: `${(x.cash / max) * 160}px` }} />
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex gap-4 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-sm bg-brand-500" /> MPESA
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-sm bg-ink-950" /> CASH
              </span>
            </div>
          </Card>
          <Card>
            <Label>Renewals · last {days} days</Label>
            <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-100">
              {[
                ['ended', d.renewals.ended, 'text-ink-900'],
                ['renewed', d.renewals.renewed, 'text-emerald-700'],
                ['lapsed', d.renewals.lapsed, 'text-rose-700'],
              ].map(([l, n, c]) => (
                <div key={l as string} className="border-l border-slate-100 px-3.5 py-3 first:border-l-0">
                  <b className={`block text-[22px] font-semibold tabular-nums ${c}`}>{n}</b>
                  <span className="text-xs text-ink-500">{l === 'ended' ? 'plans ended' : l}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-500">
              Members who lapsed often come back with a friendly reminder and an M-Pesa prompt.
            </p>
            {can(s, 'messages.manage') && d.renewals.lapsed > 0 && (
              <Link
                href="/messages"
                className="mt-3 inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-slate-50"
              >
                Message lapsed members
              </Link>
            )}
          </Card>
        </div>
      )}

      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-3">
        <Card>
          <Label>Ending in 7 days</Label>
          <ul className="mt-2">
            {d.endingSoon.length === 0 && <li className="py-2 text-sm text-ink-500">Nobody this week.</li>}
            {d.endingSoon.map((m) => {
              const left = Math.max(0, Math.ceil((m.endsAt.getTime() - Date.now()) / 86400_000));
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-2.5 border-t border-slate-100 py-2.5 text-[13px] first:border-t-0"
                >
                  <Link href={`/members/${m.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {m.name} <span className="font-mono text-[11px] text-slate-400">#{m.memberNo}</span>
                  </Link>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${left <= 1 ? 'bg-rose-50 text-rose-700' : left <= 3 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {left <= 0 ? 'today' : `${left} d`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <div className="flex items-baseline justify-between">
            <Label>At risk · 14+ days away</Label>
            {d.atRiskTotal > 5 && <span className="text-xs text-ink-500">{d.atRiskTotal} in all</span>}
          </div>
          <ul className="mt-2">
            {d.atRisk.length === 0 && (
              <li className="py-2 text-sm text-ink-500">Everyone paid up has been in lately.</li>
            )}
            {d.atRisk.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2.5 border-t border-slate-100 py-2.5 text-[13px] first:border-t-0"
              >
                <Link href={`/members/${m.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {m.name}
                </Link>
                <span className="font-mono text-[11.5px] text-slate-500">{m.daysAway} d</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <Label>Needs attention</Label>
          <ul className="mt-2">
            {attention.length === 0 && <li className="py-2 text-sm text-ink-500">All clear.</li>}
            {attention.map((a) => (
              <li
                key={a.text}
                className="flex items-center gap-2.5 border-t border-slate-100 py-2.5 text-[13px] first:border-t-0"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${a.tone}`} />
                {a.href ? (
                  <Link href={a.href} className="min-w-0 flex-1 truncate hover:underline">
                    {a.text}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{a.text}</span>
                )}
                {a.meta && <span className="font-mono text-[11.5px] text-slate-500">{a.meta}</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
