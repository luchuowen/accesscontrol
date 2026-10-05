import { randomUUID } from 'node:crypto';
import { withTenant } from '@lango/db';
import { can } from '@lango/server';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Gift,
  MessageSquare,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LiveRefresh } from '@/app/(console)/_dash/live-refresh';
import { Notice } from '@/components/notice';
import { SubmitButton } from '@/components/submit-button';
import { member, products } from '@/lib/data';
import { date, dateTime, daysLeft, kes } from '@/lib/format';
import { requirePerm } from '@/lib/session';
import { settlePending } from '@/lib/settle';
import { db } from '@/server/db';
import { grantOverride, linkCard, recordDeskPayment, requestMpesa } from '../../actions';

const nbDay = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi' });

/** Pager for a card's list: Previous / Next links that keep the other lists where they are. */
function Pager({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  const btn =
    'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold ring-1 ring-[#E4E8EF]';
  return (
    <div className="mt-auto flex items-center justify-between border-t border-[#EEF1F6] px-4 py-3 text-[12.5px] text-ink-500">
      <span className="tabular-nums">
        Page {page} of {pages}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} scroll={false} className={`${btn} text-ink-700 hover:bg-ink-50`}>
            <ChevronLeft size={14} /> Previous
          </Link>
        ) : (
          <span className={`${btn} text-ink-300`}>
            <ChevronLeft size={14} /> Previous
          </span>
        )}
        {page < pages ? (
          <Link href={href(page + 1)} scroll={false} className={`${btn} text-ink-700 hover:bg-ink-50`}>
            Next <ChevronRight size={14} />
          </Link>
        ) : (
          <span className={`${btn} text-ink-300`}>
            Next <ChevronRight size={14} />
          </span>
        )}
      </span>
    </div>
  );
}

const PAY_PAGE = 5;
const VISIT_PAGE = 10;

/**
 * Member profile, design A "Profile header" (5 Oct 2026): a header with the member and five numbers, tabs, and on
 * Overview two aligned rows (payments beside taking a payment, visits beside the other actions). Long lists page.
 */
export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ n?: string; tab?: string; pay?: string; open?: string; pp?: string; vp?: string }>;
}) {
  const s = await requirePerm('members.view');
  const { id } = await params;
  const sp = await searchParams;
  const n = sp.n;
  const waiting = await settlePending(s.tid, id);
  const d = await member(s.tid, id);
  if (!d) notFound();
  const plans = (await products(s.tid)).filter((p) => p.on_sale && p.for_members);
  const now = Date.now();
  const current = d.ents.filter((e) => e.starts_at.getTime() <= now && e.ends_at.getTime() >= now);
  const until = d.ents.length ? new Date(Math.max(...d.ents.map((e) => e.ends_at.getTime()))) : null;
  const left = daysLeft(until);
  const synced = d.sync.every((x) => x.applied_version === x.version);
  const failed = d.sync.find((x) => x.error);
  const zones = [...new Set(plans.flatMap((p) => p.zone_keys))];
  const zoneNames = new Map(
    (await withTenant(db(), s.tid, (tx) => tx<{ key: string; name: string }[]>`select key, name from zones`)).map(
      (z) => [z.key, z.name],
    ),
  );
  const [ch] = await withTenant(
    db(),
    s.tid,
    (tx) =>
      tx<{ paybill: string | null; till: string | null }[]>`
      select data->'channels'->>'paybill' as paybill, data->'channels'->>'till' as till from tenant_settings`,
  );
  const payTo = ch?.paybill ? `Paybill ${ch.paybill}` : ch?.till ? `Till ${ch.till}` : null;

  const tab = ['payments', 'visits', 'access'].includes(sp.tab ?? '') ? (sp.tab as string) : 'overview';
  const cash = sp.pay === 'cash';
  const month = d.visits.filter((v) => now - v.at.getTime() < 30 * 86400_000);
  const lastIn = d.visits.find((v) => v.granted);
  const applied = d.pays.filter((p) => p.status === 'applied');
  const paid = applied.reduce((a, p) => a + p.amount_kes, 0);
  const card = d.creds[0];
  const name = `${d.m.first_name} ${d.m.last_name ?? ''}`.trim();
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const endsTonight = left !== null && left <= 1 && until && nbDay(until) === nbDay(new Date());

  const per = tab === 'overview' ? 1 : 2; // full-width tabs show twice as many rows
  const payPages = Math.max(1, Math.ceil(d.pays.length / (PAY_PAGE * per)));
  const visitPages = Math.max(1, Math.ceil(d.visits.length / (VISIT_PAGE * per)));
  const pp = Math.min(payPages, Math.max(1, Number.parseInt(sp.pp ?? '1', 10) || 1));
  const vp = Math.min(visitPages, Math.max(1, Number.parseInt(sp.vp ?? '1', 10) || 1));
  const pays = d.pays.slice((pp - 1) * PAY_PAGE * per, pp * PAY_PAGE * per);
  const visits = d.visits.slice((vp - 1) * VISIT_PAGE * per, vp * VISIT_PAGE * per);
  const qs = (o: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const all = { tab: tab === 'overview' ? undefined : tab, pay: cash ? 'cash' : undefined, pp, vp, ...o };
    for (const [k, v] of Object.entries(all))
      if (v !== undefined && v !== '' && !(k === 'pp' || k === 'vp') ? true : v !== undefined && v !== 1)
        q.set(k, String(v));
    const t = q.toString();
    return `/members/${d.m.id}${t ? `?${t}` : ''}`;
  };
  const tabs = [
    ['overview', 'Overview', null],
    ['payments', 'Payments', d.pays.length],
    ['visits', 'Visits', d.visits.length],
    ['access', 'Access', null],
  ] as const;
  const label = 'text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500';
  const boxCard = 'flex flex-col overflow-hidden rounded-2xl border border-[#E4E8EF] bg-white';

  const payTable = (
    <section className={boxCard}>
      <div className="flex items-center justify-between px-4 pb-1 pt-4">
        <span className={label}>Payments</span>
        <span className="text-[12px] text-ink-500">
          {kes(paid)} from {applied.length} payment{applied.length === 1 ? '' : 's'}
        </span>
      </div>
      {d.pays.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-ink-500">No payments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="border-b border-[#E4E8EF] text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">For</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">Method</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="hidden px-4 py-2.5 sm:table-cell" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1F6]">
              {pays.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-500">{dateTime(p.paid_at)}</td>
                  <td className="px-4 py-3">{p.product ?? '—'}</td>
                  <td className="hidden px-4 py-3 text-ink-500 sm:table-cell">
                    {p.channel === 'cash' ? 'Cash' : 'M-Pesa'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                    {kes(p.amount_kes)}
                  </td>
                  <td className="hidden px-4 py-3 text-right sm:table-cell">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${p.status === 'applied' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
                    >
                      {p.status === 'applied' ? 'Applied' : p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={pp} pages={payPages} href={(x) => qs({ pp: x })} />
    </section>
  );

  const visitList = (
    <section className={boxCard}>
      <div className="flex items-center justify-between px-4 pb-1 pt-4">
        <span className={label}>Recent visits</span>
        <span className="text-[12px] text-ink-500">
          {month.filter((v) => v.granted).length} in 30 days
          {month.some((v) => !v.granted) ? ` · ${month.filter((v) => !v.granted).length} turned away` : ''}
        </span>
      </div>
      {d.visits.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-ink-500">No door activity yet.</p>
      ) : (
        <ul className="grid gap-x-6 px-4 pb-2 sm:grid-cols-2">
          {visits.map((v, i) => (
            <li
              key={`${v.at.getTime()}-${i}`}
              className="flex items-center gap-2.5 border-b border-[#EEF1F6] py-2.5 text-[13px]"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${v.granted ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <span className="w-[112px] shrink-0 tabular-nums text-ink-500">{dateTime(v.at)}</span>
              <span className="truncate">{v.zone ?? '—'}</span>
              {!v.granted && (
                <span className="ml-auto shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11.5px] font-semibold text-rose-700">
                  Turned away
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager page={vp} pages={visitPages} href={(x) => qs({ vp: x })} />
    </section>
  );

  const plansOptions = plans.map((p) => (
    <option key={p.id} value={p.id}>
      {p.name} — {kes(p.price_kes)}
    </option>
  ));
  const takePayment = can(s, 'payments.record') ? (
    <section id="pay" className={`${boxCard} scroll-mt-24 p-5`}>
      <span className={label}>Take payment</span>
      <div className="my-3 grid grid-cols-2 rounded-[10px] bg-[#F1F4F9] p-[3px] text-[13px]">
        <Link
          href={qs({ pay: undefined })}
          scroll={false}
          className={`rounded-lg py-2 text-center ${!cash ? 'bg-white font-semibold text-ink-900 shadow-sm' : 'text-ink-500'}`}
        >
          M-Pesa prompt
        </Link>
        <Link
          href={qs({ pay: 'cash' })}
          scroll={false}
          className={`rounded-lg py-2 text-center ${cash ? 'bg-white font-semibold text-ink-900 shadow-sm' : 'text-ink-500'}`}
        >
          Cash at the desk
        </Link>
      </div>
      {!cash ? (
        <form action={requestMpesa} className="grid gap-2">
          <input type="hidden" name="memberId" value={d.m.id} />
          <select name="productId" className="input" required>
            {plansOptions}
          </select>
          <input
            name="phone"
            defaultValue={d.m.phone ?? ''}
            placeholder="Enter mobile number"
            className="input"
            required
          />
          <SubmitButton pendingText="Sending to phone…" className="btn-primary mt-1 w-full">
            <Smartphone size={16} /> Send prompt to phone
          </SubmitButton>
          <p className="mt-1 text-[12px] text-ink-500">Doors open as soon as M-Pesa confirms.</p>
        </form>
      ) : (
        <form action={recordDeskPayment} className="grid gap-2">
          <input type="hidden" name="memberId" value={d.m.id} />
          <input type="hidden" name="nonce" value={randomUUID()} />
          <input type="hidden" name="channel" value="cash" />
          <select name="productId" className="input" required>
            {plansOptions}
          </select>
          <SubmitButton pendingText="Recording…" className="btn-primary mt-1 w-full">
            <CreditCard size={16} /> Record cash &amp; open doors
          </SubmitButton>
          <p className="mt-1 text-[12px] text-ink-500">
            Recorded under your name.{payTo ? ` Or M-Pesa ${payTo}, account ${d.m.member_no}.` : ''}
          </p>
        </form>
      )}
    </section>
  ) : (
    <section className={`${boxCard} p-5 text-[13px] text-ink-500`}>Your role can’t take payments.</section>
  );

  const row = 'flex items-start gap-3 border-t border-[#EEF1F6] px-5 py-4 first:border-t-0';
  const iconBox = 'grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#F1F4F9] text-ink-700';
  const summary =
    'cursor-pointer list-none rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-[#E4E8EF] hover:bg-ink-50 [&::-webkit-details-marker]:hidden';
  const moreActions = (
    <section className={boxCard}>
      {can(s, 'members.edit') && (
        <details id="card" open={sp.open === 'card'} className={`${row} scroll-mt-24 flex-col`}>
          <summary className="flex w-full items-center gap-3 list-none [&::-webkit-details-marker]:hidden">
            <span className={iconBox}>
              <CreditCard size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[13.5px] font-semibold">{card ? `Card ${card.card_code}` : 'No card yet'}</b>
              <span className="block text-[12px] text-ink-500">
                {card ? 'Linked to the doors' : 'Link a card or wristband'}
              </span>
            </span>
            <span className={summary}>{card ? 'Replace' : 'Link'}</span>
          </summary>
          <form action={linkCard} className="mt-3 flex w-full gap-2">
            <input type="hidden" name="memberId" value={d.m.id} />
            <input
              name="cardCode"
              type="number"
              min={1}
              max={65535}
              required
              placeholder="Card number"
              className="input min-w-0 flex-1"
            />
            <SubmitButton pendingText="Linking…" className="btn-primary">
              Save
            </SubmitButton>
          </form>
        </details>
      )}
      {can(s, 'access.comp') && (
        <details open={sp.open === 'comp'} className={`${row} flex-col`}>
          <summary className="flex w-full items-center gap-3 list-none [&::-webkit-details-marker]:hidden">
            <span className={iconBox}>
              <Gift size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[13.5px] font-semibold">Complimentary access</b>
              <span className="block text-[12px] text-ink-500">Free days, with a reason</span>
            </span>
            <span className={summary}>Give</span>
          </summary>
          <form action={grantOverride} className="mt-3 grid w-full gap-2">
            <input type="hidden" name="memberId" value={d.m.id} />
            <div className="grid grid-cols-2 gap-2">
              <select name="zone" className="input">
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {zoneNames.get(z) ?? z}
                  </option>
                ))}
              </select>
              <input name="days" type="number" min={1} max={31} defaultValue={1} aria-label="Days" className="input" />
            </div>
            <input
              name="reason"
              required
              minLength={5}
              placeholder="Reason, e.g. gym closed for repairs"
              className="input"
            />
            <SubmitButton pendingText="Granting…" className="btn-primary">
              Grant free days
            </SubmitButton>
          </form>
        </details>
      )}
      <div className={row}>
        <span className={iconBox}>
          <MessageSquare size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[13.5px] font-semibold">Message</b>
          <span className="block text-[12px] text-ink-500">SMS or WhatsApp</span>
        </span>
        <Link href={`/communications/start?member=${d.m.id}`} className={summary}>
          Write
        </Link>
      </div>
    </section>
  );

  return (
    <>
      {(waiting || n === 'prompt-sent' || !synced) && <LiveRefresh seconds={waiting ? 2 : 5} />}
      <Link href="/members" className="mb-5 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900">
        <ArrowLeft size={15} /> Members
      </Link>
      <Notice code={n} />

      <section className="overflow-hidden rounded-2xl border border-[#E4E8EF] bg-white">
        <div className="flex flex-wrap items-center gap-5 border-b border-[#E4E8EF] px-6 py-5">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,#10B981,#047857)] text-[19px] font-bold text-white">
            {initials}
          </span>
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-tight">{name}</h1>
            <div className="mt-0.5 text-[13px] text-ink-500">
              <span className="font-mono">#{d.m.member_no}</span> · {d.m.phone ?? 'No phone'} · joined{' '}
              {date(d.m.created_at)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {current.length ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700">
                  ● {[...new Set(current.map((e) => zoneNames.get(e.zone_key) ?? e.zone_key))].join(' + ')}
                  {endsTonight ? ' · ends tonight' : ''}
                </span>
              ) : (
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[12px] font-semibold text-rose-700">
                  ● No access{until ? ` · ended ${date(until)}` : ' · never paid'}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1.5 text-[12.5px] ${failed ? 'text-rose-700' : synced ? 'text-emerald-700' : 'text-amber-700'}`}
              >
                {failed ? (
                  <ShieldAlert size={14} />
                ) : synced ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-500 ring-[3px] ring-emerald-100" />
                ) : (
                  <Clock size={14} />
                )}
                {failed
                  ? `Doors could not be updated: ${failed.error}`
                  : synced
                    ? `Doors in sync${d.sync[0]?.applied_at ? ` · ${dateTime(d.sync[0].applied_at)}` : ''}`
                    : 'Updating the doors…'}
              </span>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Link href={`/communications/start?member=${d.m.id}`} className="btn-ghost">
              <MessageSquare size={16} /> Message
            </Link>
            {can(s, 'payments.record') && (
              <Link href={`${qs({ tab: undefined, pay: undefined })}#pay`} className="btn-primary">
                <Smartphone size={16} /> Send M-Pesa prompt
              </Link>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5">
          {[
            [
              'Days left',
              left !== null && left > 0 ? String(left) : '0',
              until ? (current.length ? `until ${date(until)}` : `ended ${date(until)}`) : 'never paid',
            ],
            [
              'Last visit',
              lastIn ? date(lastIn.at) : '—',
              lastIn
                ? `${lastIn.zone ?? ''} · ${lastIn.at.toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false })}`
                : 'no visits yet',
            ],
            [
              'Visits · 30 days',
              String(month.filter((v) => v.granted).length),
              `${month.filter((v) => !v.granted).length} turned away`,
            ],
            ['Total paid', kes(paid), `${applied.length} payment${applied.length === 1 ? '' : 's'}`],
            ['Card', card ? String(card.card_code) : '—', `M-Pesa account ${d.m.member_no}`],
          ].map(([k, v, sub], i) => (
            <div key={k} className={`px-6 py-4 ${i < 4 ? 'sm:border-r' : ''} border-[#EEF1F6]`}>
              <div className={label}>{k}</div>
              <div className="mt-1 text-[20px] font-semibold tabular-nums">{v}</div>
              <div className="truncate text-[12px] text-ink-500">{sub}</div>
            </div>
          ))}
        </div>
        <nav className="flex gap-1 border-t border-[#E4E8EF] px-3.5 py-2.5">
          {tabs.map(([k, l, c]) => (
            <Link
              key={k}
              href={qs({ tab: k === 'overview' ? undefined : k, pp: 1, vp: 1 })}
              scroll={false}
              className={`rounded-lg px-3 py-1.5 text-[13px] ${tab === k ? 'bg-[#F1F4F9] font-semibold text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}
            >
              {l}
              {c ? <span className="ml-1.5 tabular-nums text-ink-500">{c}</span> : null}
            </Link>
          ))}
        </nav>
      </section>

      {tab === 'overview' && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          {payTable}
          {takePayment}
          {visitList}
          {moreActions}
        </div>
      )}
      {tab === 'payments' && <div className="mt-4">{payTable}</div>}
      {tab === 'visits' && <div className="mt-4">{visitList}</div>}
      {tab === 'access' && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className={boxCard}>
            <div className="px-4 pb-1 pt-4">
              <span className={label}>Access</span>
            </div>
            {d.ents.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-ink-500">No access yet. Take a payment to open the doors.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#E4E8EF] text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                    <th className="px-4 py-2.5">Area</th>
                    <th className="px-4 py-2.5">From</th>
                    <th className="px-4 py-2.5">Until</th>
                    <th className="px-4 py-2.5">Because of</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF1F6]">
                  {d.ents.slice(0, 12).map((e, i) => (
                    <tr key={`${e.zone_key}-${i}`}>
                      <td className="px-4 py-3 font-semibold">{zoneNames.get(e.zone_key) ?? e.zone_key}</td>
                      <td className="px-4 py-3 tabular-nums text-ink-500">{dateTime(e.starts_at)}</td>
                      <td className="px-4 py-3 tabular-nums">{dateTime(e.ends_at)}</td>
                      <td className="px-4 py-3 text-ink-500">
                        {e.source === 'payment'
                          ? 'Payment'
                          : e.source === 'override'
                            ? 'Free days'
                            : e.source === 'import'
                              ? 'Imported'
                              : e.source}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          {moreActions}
        </div>
      )}
    </>
  );
}
