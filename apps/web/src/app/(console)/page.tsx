import { can } from '@lango/server';
import Link from 'next/link';
import { AddMember } from '@/components/add-member';
import { nextMemberNo, ownerDashboard } from '@/lib/data';
import { ago, kes, kesShort } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { LiveRefresh, RefreshButton } from './_dash/live-refresh';
import { MoneyIn } from './_dash/money-in';

/**
 * Dashboard, design B "Business health" (approved 2 Oct 2026): live "in the club now", revenue, active members and
 * renewal rate with trends; money in by channel; the renewals picture; and three short lists to act on.
 */
const PERIODS = [7, 30, 90] as const;
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

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

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; v?: string; denied?: string }>;
}) {
  const s = await requireSession();
  const { p, v, denied } = await searchParams;
  const days = PERIODS.find((x) => String(x) === p) ?? 30;
  const [d, nextNo] = await Promise.all([ownerDashboard(s.tid, days), nextMemberNo(s.tid)]);
  const weekly = days > 7 && v === 'w';
  const full = can(s, 'reports.all');
  const change = pct(d.revenue.now, d.revenue.prev);
  const rate = d.renewals.ended ? Math.round((d.renewals.renewed / d.renewals.ended) * 100) : null;
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
      text: d.attention.bridgeLastSeen ? `Door PC offline ${ago(d.attention.bridgeLastSeen)}` : 'Door PC not connected',
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
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: d.timezone }).format(now),
  );
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: d.timezone,
  }).format(now);
  const first = s.name.split(/\s+/)[0] || s.name;

  return (
    <>
      <LiveRefresh />
      <section className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[linear-gradient(120deg,#0B1629_0%,#11284A_62%,#0E3A33_100%)] px-6 py-5 text-white">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">
            {greeting}, {first} 👋
          </h1>
          <p className="mt-1 text-[13px] text-[#A3B3C9]">{today}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(s, 'members.edit') && <AddMember club={d.tenantName} nextNo={nextNo} />}
          {full && (
            <nav
              className="flex gap-0.5 rounded-[10px] border border-white/20 bg-white/[0.08] p-[3px] text-xs"
              aria-label="Period"
            >
              {PERIODS.map((x) => (
                <Link
                  key={x}
                  href={`/?p=${x}${v === 'w' ? '&v=w' : ''}`}
                  aria-current={x === days ? 'page' : undefined}
                  className={`rounded-[7px] px-2.5 py-1.5 ${x === days ? 'bg-white font-semibold text-ink-950' : 'text-[#C7D2E1] hover:text-white'}`}
                >
                  {x} days
                </Link>
              ))}
            </nav>
          )}
          <RefreshButton />
        </div>
      </section>
      {denied && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          You don’t have access to that page.
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
            {d.live.busiestHour !== null ? `Peak ${hourLabel(d.live.busiestHour)}` : 'Last 90 min'}
          </div>
          <Spark values={d.live.todayByHour.slice(5, 23)} dark />
        </section>
        {full && (
          <Card>
            <Label>Revenue</Label>
            <div className="mt-1.5 text-[28px] font-semibold tabular-nums tracking-tight">{kes(d.revenue.now)}</div>
            <div className="mt-1 text-xs text-ink-500">
              {change === null ? (
                `${days} days`
              ) : (
                <>
                  <span className={change >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                    {change >= 0 ? '▲' : '▼'} {Math.abs(change)}%
                  </span>{' '}
                  vs prior {days} days
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
            {d.members.joined} joined · {d.members.lapsed} lapsed
          </div>
          <Spark values={d.members.spark} />
        </Card>
        {full && (
          <Card>
            <Label>Renewal rate</Label>
            <div className="mt-1.5 text-[28px] font-semibold tabular-nums tracking-tight">
              {rate === null ? '—' : `${rate}%`}
            </div>
            <div className="mt-1 text-xs text-ink-500">Plans renewed</div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <i className="block h-full rounded-full bg-brand-500" style={{ width: `${rate ?? 0}%` }} />
            </div>
          </Card>
        )}
      </div>

      {full && (
        <div className="mt-3.5 grid gap-3.5 xl:grid-cols-[2fr_1fr]">
          <Card className="min-w-0">
            <MoneyIn daily={d.daily} days={days} weekly={weekly} />
          </Card>
          <div className="flex min-w-0 flex-col gap-3.5">
            <Card className="flex-1">
              <div className="flex items-baseline justify-between">
                <Label>Renewals</Label>
                <span className="text-xs text-ink-500">{days} days</span>
              </div>
              <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-100">
                {[
                  ['Ended', d.renewals.ended, 'text-ink-900'],
                  ['Renewed', d.renewals.renewed, 'text-emerald-700'],
                  ['Lapsed', d.renewals.lapsed, 'text-rose-700'],
                ].map(([l, n, c]) => (
                  <div key={l as string} className="border-l border-slate-100 px-3 py-2.5 first:border-l-0">
                    <b className={`block text-[20px] font-semibold tabular-nums ${c}`}>{n}</b>
                    <span className="text-xs text-ink-500">{l}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-slate-100 px-3 py-2.5">
                  <span className="text-xs text-ink-500">Ending in 7 days</span>
                  <b className="block text-[20px] font-semibold tabular-nums">{d.ending7.count}</b>
                </div>
                <div className="rounded-xl border border-slate-100 px-3 py-2.5">
                  <span className="text-xs text-ink-500">Expected if renewed</span>
                  <b className="block text-[20px] font-semibold tabular-nums">KES {kesShort(d.ending7.expectedKes)}</b>
                </div>
              </div>
              {can(s, 'messages.manage') && d.renewals.lapsed > 0 && (
                <Link
                  href="/messages"
                  className="mt-3 inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-slate-50"
                >
                  Message lapsed
                </Link>
              )}
            </Card>
            <Card className="flex-1">
              <div className="flex items-baseline justify-between">
                <Label>Top plans</Label>
                <span className="text-xs text-ink-500">by money in</span>
              </div>
              <div className="mt-3.5 flex flex-col gap-3">
                {d.plans.length === 0 && <p className="text-sm text-ink-500">No payments yet.</p>}
                {d.plans.map((pl) => {
                  const share = d.revenue.now ? Math.round((pl.kes / d.revenue.now) * 100) : 0;
                  return (
                    <div key={pl.name}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                        <b className="min-w-0 truncate font-semibold">{pl.name}</b>
                        <span className="shrink-0 text-xs tabular-nums text-ink-500">
                          {kes(pl.kes)} · {share}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <i
                          className="block h-full rounded-full bg-[linear-gradient(90deg,#3B5A85,#0B1629)]"
                          style={{ width: `${Math.max(share, 2)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      )}

      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-3">
        <Card>
          <Label>Ending in 7 days</Label>
          <ul className="mt-2">
            {d.endingSoon.length === 0 && <li className="py-2 text-sm text-ink-500">None</li>}
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
            <Label>Not seen 14+ days</Label>
            {d.atRiskTotal > 5 && <span className="text-xs text-ink-500">{d.atRiskTotal} total</span>}
          </div>
          <ul className="mt-2">
            {d.atRisk.length === 0 && <li className="py-2 text-sm text-ink-500">None</li>}
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
            {attention.length === 0 && <li className="py-2 text-sm text-ink-500">All clear</li>}
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
