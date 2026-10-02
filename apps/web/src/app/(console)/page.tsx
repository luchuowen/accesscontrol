import { can } from '@lango/server';
import { Check, CreditCard, DoorOpen, type LucideIcon, MessageSquare, Monitor } from 'lucide-react';
import Link from 'next/link';
import { AddMember } from '@/components/add-member';
import { nextMemberNo, ownerDashboard } from '@/lib/data';
import { ago, kes, kesShort } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { LiveRefresh, RefreshButton } from './_dash/live-refresh';
import { MoneyIn } from './_dash/money-in';
import { RemindAll } from './_dash/remind-all';

/**
 * Dashboard, design B "Business health" (approved 2 Oct 2026): live "in the club now", revenue, active members and
 * renewal rate with trends; money in by channel; the renewals picture; and three short lists to act on.
 */
const PERIODS = [7, 30, 90] as const;
/** Top plans, design A "one colour per plan": indigo, sky, violet, amber (no green, so it stays apart from Money in). */
const PLAN_HUES = [
  { dot: '#4F46E5', bar: 'linear-gradient(90deg,#818CF8,#4F46E5)' },
  { dot: '#0284C7', bar: 'linear-gradient(90deg,#38BDF8,#0284C7)' },
  { dot: '#9333EA', bar: 'linear-gradient(90deg,#C084FC,#9333EA)' },
  { dot: '#D97706', bar: 'linear-gradient(90deg,#FBBF24,#D97706)' },
] as const;
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
  type Issue = { tone: 'red' | 'amber'; icon: LucideIcon; text: string; sub: string; cta: string; href?: string };
  const units = d.attention.smsUnits;
  const attention = [
    d.attention.unmatched > 0 &&
      can(s, 'payments.assign') && {
        tone: 'red',
        icon: CreditCard,
        text: `${d.attention.unmatched} payment${d.attention.unmatched > 1 ? 's' : ''} not matched`,
        sub: `${kes(d.attention.unmatchedKes)} held · no access given`,
        cta: 'Review',
        href: '/payments',
      },
    bridgeOff && {
      tone: 'amber',
      icon: Monitor,
      text: d.attention.bridgeLastSeen ? `Door PC offline ${ago(d.attention.bridgeLastSeen)}` : 'Door PC not connected',
      sub: 'Doors keep working offline',
      cta: d.attention.bridgeLastSeen ? 'Check' : 'Set up',
      href: can(s, 'doors.manage') ? '/access' : undefined,
    },
    d.attention.syncFailed > 0 && {
      tone: 'red',
      icon: DoorOpen,
      text: `${d.attention.syncFailed} door update${d.attention.syncFailed > 1 ? 's' : ''} failed`,
      sub: 'Some members may not open the doors',
      cta: 'Fix',
      href: can(s, 'doors.manage') ? '/access' : undefined,
    },
    units < 100 && {
      tone: units <= 0 ? 'red' : 'amber',
      icon: MessageSquare,
      text: units <= 0 ? 'SMS credit is out' : 'SMS credit low',
      sub: units <= 0 ? '0 left · reminders paused' : `${units} left`,
      cta: 'Top up',
      href: can(s, 'sms.buy') ? '/settings' : undefined,
    },
  ].filter(Boolean) as Issue[];
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
                {d.plans.map((pl, i) => {
                  const hue = PLAN_HUES[i % PLAN_HUES.length] as (typeof PLAN_HUES)[number];
                  const share = d.revenue.now ? Math.round((pl.kes / d.revenue.now) * 100) : 0;
                  return (
                    <div key={pl.name}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                        <b className="flex min-w-0 items-center gap-2 font-semibold">
                          <i className="h-[9px] w-[9px] shrink-0 rounded-[3px]" style={{ background: hue.dot }} />
                          <span className="truncate">{pl.name}</span>
                        </b>
                        <span className="shrink-0 text-xs tabular-nums text-ink-500">
                          {kes(pl.kes)} · {share}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <i
                          className="block h-full rounded-full"
                          style={{ width: `${Math.max(share, 2)}%`, background: hue.bar }}
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
        <Card className="flex flex-col">
          <div className="flex items-center justify-between">
            <Label>Ending in 7 days</Label>
            {d.ending7.count > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-ink-900">
                {d.ending7.count}
              </span>
            )}
          </div>
          <ul className="mt-2">
            {d.endingSoon.length === 0 && <li className="py-2 text-sm text-ink-500">Nobody this week</li>}
            {d.endingSoon.map((m) => {
              const left = Math.max(0, Math.ceil((m.endsAt.getTime() - Date.now()) / 86400_000));
              const tone =
                left <= 2
                  ? { ring: '#E11D48', track: '#FEE2E2', text: 'text-rose-700' }
                  : left <= 4
                    ? { ring: '#F59E0B', track: '#FEF3C7', text: 'text-amber-700' }
                    : { ring: '#10B981', track: '#D1FAE5', text: 'text-emerald-700' };
              const initials = m.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase())
                .join('');
              const arc = (Math.max(left, 0.3) / 7) * 113.1;
              return (
                <li key={m.id} className="flex items-center gap-3 border-t border-slate-100 py-2.5 first:border-t-0">
                  <span className="relative h-10 w-10 shrink-0" aria-hidden="true">
                    <svg viewBox="0 0 40 40" className="absolute inset-0 h-10 w-10 -rotate-90">
                      <circle cx="20" cy="20" r="18" fill="none" stroke={tone.track} strokeWidth="3" />
                      <circle
                        cx="20"
                        cy="20"
                        r="18"
                        fill="none"
                        stroke={tone.ring}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={`${arc} 113.1`}
                      />
                    </svg>
                    <span
                      className={`absolute inset-[5px] grid place-items-center rounded-full bg-slate-50 text-[11px] font-bold ${tone.text}`}
                    >
                      {initials}
                    </span>
                  </span>
                  <Link href={`/members/${m.id}`} className="group min-w-0 flex-1">
                    <b className="block truncate text-[13.5px] font-semibold group-hover:underline">{m.name}</b>
                    <small className="block truncate text-[11.5px] text-slate-400">
                      {m.plan ? `${m.plan}${m.priceKes ? ` · ${kes(m.priceKes)}` : ''}` : `#${m.memberNo}`}
                    </small>
                  </Link>
                  <span className="text-right leading-none">
                    <b className={`block text-[17px] font-bold tabular-nums ${tone.text}`}>{left}</b>
                    <small className="text-[10px] uppercase tracking-[0.06em] text-slate-400">
                      {left === 0 ? 'today' : left === 1 ? 'day' : 'days'}
                    </small>
                  </span>
                </li>
              );
            })}
          </ul>
          {d.ending7.count > 0 && (
            <div className="mt-auto flex items-center justify-between gap-3 border-t border-dashed border-[#E7EBF3] pt-3">
              <span className="text-xs text-ink-500">
                <b className="font-semibold tabular-nums text-ink-900">{kes(d.ending7.expectedKes)}</b> due this week
              </span>
              {can(s, 'messages.manage') && <RemindAll />}
            </div>
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <Label>Not seen 14+ days</Label>
            <span className="text-xs text-ink-500">by days away</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ['30+ days', d.riskTiers.high, 'bg-rose-50', 'text-rose-700'],
              ['21–29', d.riskTiers.mid, 'bg-amber-50', 'text-amber-700'],
              ['14–20', d.riskTiers.watch, 'bg-slate-50', 'text-ink-900'],
            ].map(([l, n, bg, fg]) => (
              <div key={l as string} className={`rounded-xl px-2.5 py-2 ${n ? bg : 'bg-slate-50'}`}>
                <b className={`block text-xl font-bold tabular-nums ${n ? fg : 'text-slate-300'}`}>{n}</b>
                <span className="text-[11px] text-ink-500">{l}</span>
              </div>
            ))}
          </div>
          {d.atRisk.length === 0 ? (
            <p className="mt-3.5 flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <Check size={15} /> No one at risk right now
            </p>
          ) : (
            <ul className="mt-1.5">
              {d.atRisk.map((m) => {
                const level = m.daysAway >= 30 ? 3 : m.daysAway >= 21 ? 2 : 1;
                const color = level === 3 ? 'bg-rose-600' : level === 2 ? 'bg-amber-500' : 'bg-slate-400';
                return (
                  <li key={m.id} className="flex items-center gap-3 border-t border-slate-100 py-2.5 first:border-t-0">
                    <Link href={`/members/${m.id}`} className="group min-w-0 flex-1">
                      <b className="block truncate text-[13.5px] font-semibold group-hover:underline">{m.name}</b>
                      <small className="block text-[11.5px] text-slate-400">{m.daysAway} days away</small>
                    </Link>
                    <span className="flex w-14 gap-[3px]" aria-label={`${m.daysAway} days away`}>
                      {[1, 2, 3].map((i) => (
                        <i key={i} className={`h-1.5 flex-1 rounded-full ${i <= level ? color : 'bg-slate-200'}`} />
                      ))}
                    </span>
                  </li>
                );
              })}
              {d.atRiskTotal > d.atRisk.length && (
                <li className="pt-2 text-xs text-ink-500">+{d.atRiskTotal - d.atRisk.length} more</li>
              )}
            </ul>
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <Label>Needs attention</Label>
            {attention.length > 0 && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-rose-700">
                {attention.length}
              </span>
            )}
          </div>
          {attention.length === 0 ? (
            <p className="mt-3.5 flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <Check size={15} /> All clear
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2.5">
              {attention.map((a) => {
                const Icon = a.icon;
                return (
                  <li
                    key={a.text}
                    className="flex items-center gap-3 rounded-[14px] border border-[#E7EBF3] bg-[linear-gradient(180deg,#fff,#FBFCFE)] p-2.5"
                  >
                    <span
                      className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] ${a.tone === 'red' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}
                    >
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[13.5px] font-semibold">{a.text}</b>
                      <small className="block truncate text-[11.5px] text-slate-400">{a.sub}</small>
                    </span>
                    {a.href && (
                      <Link
                        href={a.href}
                        className={`inline-flex h-[30px] shrink-0 items-center rounded-[9px] px-2.5 text-xs font-semibold ${a.cta === 'Top up' ? 'bg-[#047857] text-white hover:bg-[#065F46]' : 'border border-[#E7EBF3] bg-white text-ink-900 hover:bg-slate-50'}`}
                      >
                        {a.cta}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
