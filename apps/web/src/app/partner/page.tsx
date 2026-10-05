import {
  Building2,
  CircleAlert,
  Handshake,
  Lock,
  type LucideIcon,
  Monitor,
  ReceiptText,
  UserRoundX,
  Wallet,
} from 'lucide-react';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { ago, kes } from '@/lib/format';
import { type HomeClub, partnerHome } from '@/lib/partner-home';
import { requirePartner } from '@/lib/session';
import { AddClubButton } from './add-club';
import { addClubProps } from './add-club-data';

/**
 * Partner Home, design A "Dashboard" (approved 3 Oct 2026): the club owner's dashboard rebuilt for partners. A
 * greeting band, four tiles, earnings with the payout beside it, then renewals, setups and what needs attention.
 * Money only for NAVAC admins and partner admins; NAVAC's own income only for NAVAC.
 */
const PERIODS = [7, 30, 90] as const;
const HUES = ['#4F46E5', '#0284C7', '#9333EA', '#D97706'] as const;

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[#E7EBF3] bg-white p-[18px] ${className}`}>{children}</section>;
}
const Label = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
    {children}
    {right != null && <span className="ml-auto normal-case tracking-normal">{right}</span>}
  </div>
);
const Count = ({ n, tone = 'gray' }: { n: number; tone?: 'gray' | 'red' }) => (
  <span
    className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${tone === 'red' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-ink-900'}`}
  >
    {n}
  </span>
);
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="mt-3 flex h-8 items-end gap-[3px]" aria-hidden="true">
      {values.map((v, i) => (
        <i
          key={`s${i}`}
          className={`flex-1 rounded-t-[2px] ${i === values.length - 1 ? 'bg-brand-500' : 'bg-slate-300'}`}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}
const initials = (n: string) =>
  n
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

export default async function PartnerHome({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const s = await requirePartner();
  const { p } = await searchParams;
  const days = PERIODS.find((x) => String(x) === p) ?? 30;
  const d = await partnerHome(s.uid, days);
  const now = DateTime.now().setZone('Africa/Nairobi');
  const greeting = now.hour < 12 ? 'Good morning' : now.hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = s.name.split(/\s+/)[0] || s.name;
  const live = d.clubs.filter((c) => c.stage === 'live');
  const setting = d.clubs.filter((c) => c.stage === 'setup');
  const priced = d.clubs.filter((c) => c.feeKes != null && c.billing);
  const paying = priced.filter((c) => c.billing === 'active' || c.billing === 'due');
  // A club that has never paid its subscription is waiting for its first payment, not overdue.
  const overdue = priced.filter((c) => c.billing === 'overdue' && c.paidUntil);
  const firstDue = priced.filter((c) => !c.paidUntil);
  const recurring = paying.reduce((a, c) => a + c.monthlyShare, 0);
  const atRisk = overdue.reduce((a, c) => a + c.monthlyShare, 0);
  const change = d.earned.prev ? Math.round(((d.earned.now - d.earned.prev) / d.earned.prev) * 100) : null;
  const doorsTotal = d.clubs.filter((c) => c.bridgeSeen).length;
  const doorsOff = d.clubs.filter((c) => c.doorOffline);
  const admin = s.kind === 'partner_admin';

  // Needs attention: doors, money and setup, most urgent first.
  type Issue = {
    tone: 'red' | 'amber' | 'violet';
    icon: LucideIcon;
    text: string;
    sub: string;
    cta: string;
    href: string;
  };
  const issues: Issue[] = [
    ...doorsOff.map((c) => ({
      tone: 'red' as const,
      icon: Monitor,
      text: 'Door PC offline',
      sub: `${c.name} · last seen ${ago(c.bridgeSeen as Date)}`,
      cta: 'Open',
      href: `/partner/clubs/${c.id}?tab=doors`,
    })),
    ...(d.money
      ? overdue.map((c) => ({
          tone: 'amber' as const,
          icon: ReceiptText,
          text: 'Subscription overdue',
          sub: `${c.name} · ended ${DateTime.fromISO(c.paidUntil ?? '').toFormat('d LLL')}`,
          cta: 'View',
          href: `/partner/clubs/${c.id}?tab=billing`,
        }))
      : []),
    ...(d.money
      ? firstDue.map((c) => ({
          tone: 'amber' as const,
          icon: ReceiptText,
          text: 'First subscription not paid',
          sub: `${c.name} · ${kes(c.feeKes ?? 0)}`,
          cta: 'View',
          href: `/partner/clubs/${c.id}?tab=billing`,
        }))
      : []),
    ...(d.money
      ? d.clubs
          .filter((c) => c.setupFeeKes != null && !c.setupPaid)
          .map((c) => ({
            tone: 'amber' as const,
            icon: Wallet,
            text: 'Setup fee not paid',
            sub: `${c.name} · ${kes(c.setupFeeKes ?? 0)}`,
            cta: 'View',
            href: `/partner/clubs/${c.id}?tab=billing`,
          }))
      : []),
    ...d.clubs
      .filter((c) => c.ownerEmail && !c.ownerAccepted)
      .map((c) => ({
        tone: 'amber' as const,
        icon: UserRoundX,
        text: 'Owner hasn’t signed in yet',
        sub: `${c.name} · ${c.ownerEmail}`,
        cta: 'Resend',
        href: `/partner/clubs/${c.id}`,
      })),
    ...d.termsMissing.map((name) => ({
      tone: 'violet' as const,
      icon: Handshake,
      text: 'Partner shares not set',
      sub: `${name} earns nothing until you set them`,
      cta: 'Set',
      href: '/partner/terms',
    })),
  ];
  const TONE = {
    red: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-700',
    violet: 'bg-violet-50 text-violet-700',
  };

  const renewals = d.money
    ? priced
        .filter((c) => c.paidUntil)
        .map((c) => ({
          c,
          left: Math.round(DateTime.fromISO(c.paidUntil as string).diff(now.startOf('day'), 'days').days),
        }))
        .filter((r) => r.left <= 30)
        .sort((a, b) => a.left - b.left)
    : [];
  const maxMonth = Math.max(1, ...d.months.map((m) => m.setup + m.subs));
  const best = [...d.months].sort((a, b) => b.setup + b.subs - (a.setup + a.subs))[0];
  const top = [...paying, ...overdue].sort((a, b) => b.monthlyShare - a.monthlyShare).slice(0, 4);
  const topMax = Math.max(1, ...top.map((c) => c.monthlyShare));
  const share = d.platform ? 'subscriptions' : 'your share';

  const tile = (label: string, value: string, hint: React.ReactNode, extra?: React.ReactNode) => (
    <Card>
      <Label>{label}</Label>
      <div className="mt-2 text-[28px] font-semibold leading-none tabular-nums tracking-tight">{value}</div>
      <div className="mt-2 text-[12.5px] text-ink-500">{hint}</div>
      {extra}
    </Card>
  );

  return (
    <>
      <section className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[linear-gradient(120deg,#0B1629_0%,#11284A_62%,#0E3A33_100%)] px-6 py-5 text-white">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">
            {greeting}, {first}
          </h1>
          <p className="mt-1 text-[13px] text-[#A3B3C9]">{now.toFormat('cccc, d LLLL yyyy')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {admin && <AddClubButton variant="light" {...(await addClubProps(s.uid))} />}
          {d.money && (
            <nav
              className="flex gap-0.5 rounded-[10px] border border-white/20 bg-white/[0.08] p-[3px] text-xs"
              aria-label="Period"
            >
              {PERIODS.map((x) => (
                <Link
                  key={x}
                  href={`/partner?p=${x}`}
                  aria-current={x === days ? 'page' : undefined}
                  className={`rounded-[7px] px-2.5 py-1.5 ${x === days ? 'bg-white font-semibold text-ink-950' : 'text-[#C7D2E1] hover:text-white'}`}
                >
                  {x} days
                </Link>
              ))}
            </nav>
          )}
        </div>
      </section>

      {d.navac && (
        <section className="mb-4 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-dashed border-violet-300 bg-violet-50/60 px-5 py-3.5">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-violet-700">
            <Lock size={12} /> Only NAVAC sees this · {days} days
          </span>
          {[
            ['Member payments via gateway', kes(d.navac.gateway)],
            ['Cash at club desks', kes(d.navac.cash)],
            ['Clubs paid NAVAC', kes(d.navac.collected)],
            ['Partner shares', kes(d.navac.shares)],
            [d.navac.smsMargin == null ? 'SMS sold' : 'SMS margin', kes(d.navac.smsMargin ?? d.navac.sms)],
          ].map(([k, v]) => (
            <div key={k} className="text-[12px] text-violet-700">
              {k}
              <b className="block text-[16px] tabular-nums text-ink-900">{v}</b>
            </div>
          ))}
        </section>
      )}

      {d.money ? (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {tile(
            d.platform ? `Partner shares · ${days} days` : `You earned · ${days} days`,
            kes(d.earned.now),
            change == null ? (
              'Nothing to compare with yet'
            ) : (
              <>
                <span className={change >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change)}%
                </span>{' '}
                vs prior {days} days
              </>
            ),
            <Spark values={d.earned.spark} />,
          )}
          {tile(
            d.platform ? 'Due to partners' : 'Next payout',
            kes(d.payout.netKes),
            `${DateTime.fromJSDate(d.payout.payDay).toFormat('d LLL')}${d.payout.whtKes ? ` · after ${kes(d.payout.whtKes)} tax` : ''}`,
            <>
              <div className="mt-3 flex h-[7px] overflow-hidden rounded-full bg-[#EEF1F6]">
                <i
                  className="block h-full bg-brand-500"
                  style={{
                    width: `${d.payout.readyKes + d.payout.holdKes ? (d.payout.readyKes / (d.payout.readyKes + d.payout.holdKes)) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="mt-1.5 text-[11.5px] text-ink-500">{kes(d.payout.holdKes)} on hold</div>
            </>,
          )}
          {tile(
            'Live clubs',
            String(live.length),
            `${setting.length} setting up · ${d.clubs.length} in all`,
            <Spark
              values={Array.from({ length: 6 }, (_, k) => {
                const end = now
                  .startOf('month')
                  .minus({ months: 4 - k })
                  .toJSDate();
                return d.clubs.filter((c) => c.createdAt < end).length;
              })}
            />,
          )}
          {tile(
            'Monthly recurring',
            kes(recurring),
            d.platform ? 'club subscriptions to NAVAC' : 'your share of subscriptions',
            <>
              <div className="mt-3 flex h-[7px] gap-0.5 overflow-hidden rounded-full bg-[#EEF1F6]">
                <i
                  className="block h-full bg-brand-500"
                  style={{ width: `${recurring + atRisk ? (recurring / (recurring + atRisk)) * 100 : 0}%` }}
                />
                <i
                  className="block h-full bg-amber-500"
                  style={{ width: `${recurring + atRisk ? (atRisk / (recurring + atRisk)) * 100 : 0}%` }}
                />
              </div>
              <div className="mt-1.5 text-[11.5px] text-ink-500">
                {atRisk ? `${kes(atRisk)} at risk · ${overdue.length} overdue` : 'Nothing overdue'}
              </div>
            </>,
          )}
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {tile('Your clubs', String(d.clubs.length), `${live.length} live · ${setting.length} setting up`)}
          {tile(
            'Door PCs online',
            `${doorsTotal - doorsOff.length} of ${doorsTotal}`,
            !doorsTotal ? 'None installed yet' : doorsOff.length ? `${doorsOff[0]?.name} offline` : 'All connected',
          )}
          {tile('Setting up', String(setting.length), setting[0] ? `Next: ${setting[0].name}` : 'Nothing waiting')}
          {tile('Needs attention', String(issues.length), issues[0]?.text ?? 'All clear')}
        </div>
      )}

      {d.money && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Card>
            <Label
              right={
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] font-semibold text-ink-900">
                  Last 6 months
                </span>
              }
            >
              {d.platform ? 'Partner shares' : 'Your earnings'}
            </Label>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-[28px] font-semibold tabular-nums tracking-tight">{kes(d.lifetime)}</span>
              <span className="text-[13px] text-ink-500">
                {d.monthsSince ? `over ${d.monthsSince} month${d.monthsSince > 1 ? 's' : ''}` : 'nothing earned yet'}
              </span>
            </div>
            <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full bg-[#EEF1F6]">
              <i
                className="block h-full bg-brand-500"
                style={{ width: `${d.lifetime ? ((d.lifetime - d.lifetimeSetup) / d.lifetime) * 100 : 0}%` }}
              />
              <i
                className="block h-full bg-ink-900"
                style={{ width: `${d.lifetime ? (d.lifetimeSetup / d.lifetime) * 100 : 0}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-ink-500">
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-[3px] bg-brand-500" />
                SUBSCRIPTIONS <b className="text-ink-900 tabular-nums">{kes(d.lifetime - d.lifetimeSetup)}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-[3px] bg-ink-900" />
                SETUP FEES <b className="text-ink-900 tabular-nums">{kes(d.lifetimeSetup)}</b>
              </span>
            </div>
            <div className="mt-4 flex h-[180px] items-end justify-around gap-3 border-b border-[#EEF1F6]">
              {d.months.map((m) => (
                <div
                  key={m.label}
                  className="flex h-full max-w-[72px] flex-1 flex-col justify-end"
                  title={`${m.label}: setup ${kes(m.setup)}, subscriptions ${kes(m.subs)}`}
                >
                  {m.setup > 0 && (
                    <i
                      className="block rounded-t-[5px] bg-ink-900"
                      style={{ height: `${(m.setup / maxMonth) * 100}%` }}
                    />
                  )}
                  <i
                    className={`block bg-[linear-gradient(#34D399,#059669)] ${m.setup > 0 ? 'mt-0.5' : 'rounded-t-[5px]'}`}
                    style={{ height: `${Math.max(m.subs ? 2 : 0.5, (m.subs / maxMonth) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-around gap-3 text-[11px] text-slate-400">
              {d.months.map((m) => (
                <span key={m.label} className="max-w-[72px] flex-1 text-center">
                  {m.label}
                </span>
              ))}
            </div>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
              {[
                ['Best month', best && best.setup + best.subs ? `${best.label} · ${kes(best.setup + best.subs)}` : '—'],
                ['Monthly average', d.monthsSince ? kes(Math.round(d.lifetime / d.monthsSince)) : '—'],
                ['Clubs paying', `${paying.length} of ${d.clubs.length}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-[#EEF1F6] px-3 py-2.5">
                  <div className="text-[11.5px] text-ink-500">{k}</div>
                  <div className="text-[14.5px] font-semibold tabular-nums">{v}</div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid content-start gap-4">
            <Card>
              <Label
                right={<span className="text-ink-500">{DateTime.fromJSDate(d.payout.payDay).toFormat('d LLL')}</span>}
              >
                Payouts
              </Label>
              <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-xl border border-[#EEF1F6]">
                {[
                  ['Ready', d.payout.readyKes, 'text-ink-900'],
                  ['On hold', d.payout.holdKes, 'text-amber-700'],
                  ['Paid so far', d.payout.paidKes, 'text-emerald-700'],
                ].map(([k, v, c], i) => (
                  <div key={k as string} className={`px-3 py-2.5 ${i < 2 ? 'border-r border-[#EEF1F6]' : ''}`}>
                    <div className={`text-[16px] font-semibold tabular-nums ${c}`}>
                      <span className="mr-0.5 text-[10.5px] font-semibold text-ink-500">KES</span>
                      {(v as number).toLocaleString('en-KE')}
                    </div>
                    <div className="text-[11.5px] text-ink-500">{k}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-[#EEF1F6] px-3 py-2.5">
                  <div className="text-[11.5px] text-ink-500">Withholding tax</div>
                  <div className="text-[15px] font-semibold tabular-nums">{kes(d.payout.whtKes)}</div>
                </div>
                <div className="rounded-xl border border-[#EEF1F6] px-3 py-2.5">
                  <div className="text-[11.5px] text-ink-500">{d.platform ? 'Partners due' : 'Paid to'}</div>
                  <div className="truncate text-[15px] font-semibold">
                    {d.platform
                      ? d.payout.partners
                      : d.payout.method
                        ? `${{ mpesa: 'M-Pesa', paybill: 'Paybill', till: 'Till', bank: 'Bank' }[d.payout.method] ?? ''} ${d.payout.to ? `···${d.payout.to.replace(/\s/g, '').slice(-3)}` : ''}`
                        : 'Not set'}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-[12px] text-ink-500">
                {d.platform ? (
                  <Link href="/partner/terms" className="font-semibold text-emerald-700 hover:underline">
                    Partner terms →
                  </Link>
                ) : d.terms ? (
                  `Your shares: ${Number(d.terms.setup ?? 0)}% of setup fees · ${Number(d.terms.sub ?? 0)}% of subscriptions.`
                ) : (
                  'NAVAC hasn’t set your shares yet.'
                )}
                {d.payout.holdUntil &&
                  ` Next release ${DateTime.fromJSDate(d.payout.holdUntil).setZone('Africa/Nairobi').toFormat('d LLL')}.`}
              </p>
            </Card>
            <Card>
              <Label right={<span className="text-ink-500">by {share} / month</span>}>Top clubs</Label>
              {top.length === 0 && (
                <p className="mt-3 text-[13px] text-ink-500">No club is paying a subscription yet.</p>
              )}
              <div className="mt-3 grid gap-3">
                {top.map((c, i) => (
                  <div key={c.id}>
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: HUES[i] }} />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="font-normal text-ink-500 tabular-nums">{kes(c.monthlyShare)}</span>
                    </div>
                    <div className="mt-1.5 h-[7px] overflow-hidden rounded-full bg-[#EEF1F6]">
                      <i
                        className="block h-full rounded-full"
                        style={{ width: `${(c.monthlyShare / topMax) * 100}%`, background: HUES[i] }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {d.money ? (
          <Card>
            <Label right={<Count n={renewals.length} />}>Club renewals</Label>
            {renewals.length === 0 && <p className="mt-3 text-[13px] text-ink-500">No renewals in the next 30 days.</p>}
            <ul className="mt-1">
              {renewals.slice(0, 4).map(({ c, left }) => (
                <ClubLine
                  key={c.id}
                  club={c}
                  sub={`${left < 0 ? 'Overdue' : c.cycle === 'yearly' ? 'Yearly' : c.cycle === 'quarterly' ? 'Every 3 months' : 'Monthly'} · ${kes(c.feeKes ?? 0)}`}
                  value={String(Math.abs(left))}
                  unit={left < 0 ? 'LATE' : 'DAYS'}
                  tone={left < 0 ? '#E11D48' : left <= 7 ? '#D97706' : '#10B981'}
                />
              ))}
            </ul>
          </Card>
        ) : (
          <Card>
            <Label right={<Count n={doorsTotal} />}>Door PCs</Label>
            {doorsTotal === 0 && <p className="mt-3 text-[13px] text-ink-500">No door PC installed yet.</p>}
            <ul className="mt-1">
              {d.clubs
                .filter((c) => c.bridgeSeen)
                .slice(0, 4)
                .map((c) => (
                  <ClubLine
                    key={c.id}
                    club={c}
                    sub={c.doorOffline ? `Last seen ${ago(c.bridgeSeen as Date)}` : 'Online'}
                    value={c.doorOffline ? 'OFF' : 'ON'}
                    unit=""
                    tone={c.doorOffline ? '#E11D48' : '#10B981'}
                  />
                ))}
            </ul>
          </Card>
        )}
        <Card>
          <Label right={<Count n={setting.length} />}>Setting up</Label>
          {setting.length === 0 && <p className="mt-3 text-[13px] text-ink-500">Every club is live.</p>}
          <ul className="mt-1">
            {setting.slice(0, 4).map((c) => {
              const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
              return (
                <li key={c.id} className="flex items-center gap-3 border-b border-[#F0F2F6] py-2.5 last:border-0">
                  <span
                    className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full"
                    style={{ background: `conic-gradient(#0EA5E9 ${pct * 3.6}deg,#E7EBF3 0)` }}
                    aria-hidden="true"
                  >
                    <span className="absolute inset-1 grid place-items-center rounded-full bg-white text-[11px] font-bold">
                      {initials(c.name)}
                    </span>
                  </span>
                  <Link href={`/partner/clubs/${c.id}`} className="min-w-0 flex-1 hover:underline">
                    <b className="block truncate text-[13.5px]">{c.name}</b>
                    <span className="block truncate text-[12px] text-ink-500">
                      Next: {c.nextStep ?? 'almost there'}
                    </span>
                  </Link>
                  <span className="text-right text-[17px] font-bold leading-none text-sky-700 tabular-nums">
                    {pct}
                    <small className="block text-[9.5px] font-semibold tracking-[0.08em] text-ink-500">%</small>
                  </span>
                </li>
              );
            })}
          </ul>
          {setting.length > 4 && (
            <Link
              href="/partner/clubs"
              className="mt-2 block text-[12.5px] font-semibold text-emerald-700 hover:underline"
            >
              +{setting.length - 4} more →
            </Link>
          )}
        </Card>
        <Card>
          <Label right={<Count n={issues.length} tone={issues.length ? 'red' : 'gray'} />}>Needs attention</Label>
          {issues.length === 0 && (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-emerald-700">
              <CircleAlert size={15} /> Nothing needs you right now.
            </p>
          )}
          {issues.slice(0, 4).map((i) => (
            <Link
              key={`${i.text}${i.sub}`}
              href={i.href}
              className="mt-2.5 flex items-center gap-3 rounded-[14px] border border-[#EEF1F6] p-3 transition hover:border-[#DDE2EA]"
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[11px] ${TONE[i.tone]}`}>
                <i.icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[13.5px]">{i.text}</b>
                <span className="line-clamp-2 block text-[12px] leading-snug text-ink-500">{i.sub}</span>
              </span>
              <span className="rounded-[10px] border border-[#E1E5EC] px-2.5 py-1.5 text-[12.5px] font-semibold">
                {i.cta}
              </span>
            </Link>
          ))}
          {issues.length > 4 && <p className="mt-2 text-[12px] text-ink-500">+{issues.length - 4} more</p>}
        </Card>
      </div>
      {d.clubs.length === 0 && (
        <Card className="mt-4 text-center">
          <Building2 className="mx-auto text-ink-300" size={26} />
          <p className="mt-2 text-[13.5px] text-ink-500">No clubs yet.</p>
        </Card>
      )}
    </>
  );
}

function ClubLine({
  club,
  sub,
  value,
  unit,
  tone,
}: {
  club: HomeClub;
  sub: string;
  value: string;
  unit: string;
  tone: string;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-[#F0F2F6] py-2.5 last:border-0">
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-[3px] text-[11px] font-bold"
        style={{ borderColor: tone, color: tone }}
      >
        {initials(club.name)}
      </span>
      <Link href={`/partner/clubs/${club.id}`} className="min-w-0 flex-1 hover:underline">
        <b className="block truncate text-[13.5px]">{club.name}</b>
        <span className="block truncate text-[12px] text-ink-500">{sub}</span>
      </Link>
      <span className="text-right text-[17px] font-bold leading-none tabular-nums" style={{ color: tone }}>
        {value}
        {unit && <small className="block text-[9.5px] font-semibold tracking-[0.08em] text-ink-500">{unit}</small>}
      </span>
    </li>
  );
}
