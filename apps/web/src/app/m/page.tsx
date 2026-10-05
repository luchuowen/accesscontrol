import { withTenant } from '@lango/db';
import { CalendarCheck, CheckCircle2, Loader2, Megaphone, MessageCircle, Plus, Receipt, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { date, daysLeft, kes } from '@/lib/format';
import { settlePending } from '@/lib/settle';
import { db } from '@/server/db';
import { LiveRefresh } from '../(console)/_dash/live-refresh';
import { memberLogout, readMember, setNews } from './actions';
import { AddWizard, type WizService } from './add-wizard';
import { MemberReceipt, ReceiptList, VisitList } from './records';
import { MemberSignIn } from './signin';

export const dynamic = 'force-dynamic';

const UNIT: Record<string, [string, string]> = {
  hour: ['hour', 'hours'],
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  year: ['year', 'years'],
};
const span = (unit: string, n: number) => `${n} ${(UNIT[unit] ?? [unit, `${unit}s`])[n === 1 ? 0 : 1]}`;

/**
 * Member portal, design A "One question at a time" (picked 5 Oct 2026): the pass, then big buttons for what members
 * used to queue at reception for. Each button opens its own simple screen (?v=add | receipts | receipt | visits).
 */
export default async function MemberPortal({
  searchParams,
}: {
  searchParams: Promise<{
    e?: string;
    pay?: string;
    step?: string;
    w?: string;
    news?: string;
    from?: string;
    v?: string;
    id?: string;
    renew?: string;
  }>;
}) {
  const sp = await searchParams;
  const who = await readMember();
  if (!who) return <MemberSignIn sp={sp} />;
  await settlePending(who.tenantId, who.memberId);

  const shell = (children: React.ReactNode, extra?: React.ReactNode) => (
    <div className="min-h-screen bg-[#F4F6FA] px-[18px] pb-10 pt-6 text-ink-900 print:bg-white print:p-0">
      {extra}
      <div className="mx-auto max-w-md print:max-w-none">{children}</div>
    </div>
  );
  if (sp.v === 'receipts') return shell(<ReceiptList who={who} />);
  if (sp.v === 'receipt' && sp.id) return shell(<MemberReceipt who={who} id={sp.id} />);
  if (sp.v === 'visits') return shell(<VisitList who={who} />);

  const d = await withTenant(db(), who.tenantId, async (tx) => {
    const [m] = await tx<
      { first_name: string; last_name: string | null; member_no: number; sms_news: boolean; phone: string | null }[]
    >`select first_name, last_name, member_no, sms_news, phone from members where id = ${who.memberId}`;
    // Access per service: the latest end date, and whether it is on now.
    const access = await tx<{ service_id: string | null; name: string; ends: Date; live: boolean }[]>`
      select e.service_id, coalesce(sv.name, initcap(e.zone_key)) as name, max(e.ends_at) as ends,
             bool_or(e.starts_at <= now() and e.ends_at > now()) as live
      from entitlements e left join services sv on sv.id = e.service_id
      where e.member_id = ${who.memberId}
      group by 1, 2 order by bool_or(e.starts_at <= now() and e.ends_at > now()) desc, max(e.ends_at) desc`;
    const plans = await tx<
      {
        id: string;
        name: string;
        price_kes: number;
        service_id: string | null;
        service: string;
        unit: string;
        count: number;
      }[]
    >`select p.id, p.name, p.price_kes, p.service_id, coalesce(s.name, split_part(p.name, ' · ', 1)) as service,
             p.duration_unit as unit, p.duration_count as count
      from products p left join services s on s.id = p.service_id
       where p.active and coalesce(s.sold_to, 'both') <> 'walkins'
         and coalesce(s.active and s.deleted_at is null, true)
       order by 5, p.price_kes`;
    const [last] = await tx<{ product_id: string }[]>`
      select coalesce(l.product_id, p.product_id) as product_id from payments p
      left join payment_lines l on l.payment_id = p.id
      where p.member_id = ${who.memberId} and p.status = 'applied' and coalesce(l.product_id, p.product_id) is not null
      order by p.paid_at desc limit 1`;
    const [counts] = await tx<{ visits: number; receipts: number }[]>`
      select (select count(*)::int from access_events where member_no = ${m?.member_no ?? -1} and granted
                and at >= date_trunc('month', now())) as visits,
             (select count(*)::int from payments where member_id = ${who.memberId} and status = 'applied') as receipts`;
    const [waiting] = await tx<{ amount_kes: number }[]>`
      select amount_kes from payment_intents where member_id = ${who.memberId} and status = 'pending'
        and created_at > now() - interval '5 minutes' order by created_at desc limit 1`;
    const [t] = await tx<{ name: string }[]>`select name from tenants where id = ${who.tenantId}`;
    const [ch] = await tx<{ paybill: string | null; till: string | null }[]>`
      select data->'channels'->>'paybill' as paybill, data->'channels'->>'till' as till from tenant_settings`;
    const [wa] = await tx<{ phone: string | null }[]>`
      select config->>'displayPhone' as phone from comm_channels where channel = 'whatsapp' and enabled`;
    return {
      m,
      access,
      plans,
      last: last?.product_id ?? null,
      visits: counts?.visits ?? 0,
      receipts: counts?.receipts ?? 0,
      waiting: waiting?.amount_kes ?? null,
      club: t?.name,
      ch,
      wa: wa?.phone ?? null,
    };
  });

  const live = d.access.filter((a) => a.live);
  const on = live.length > 0;
  const until = on ? new Date(Math.max(...live.map((a) => a.ends.getTime()))) : (d.access[0]?.ends ?? null);
  const left = on ? Math.max(0, daysLeft(until) ?? 0) : 0;
  const longDate = (x: Date | null) =>
    x
      ? x.toLocaleDateString('en-KE', {
          timeZone: 'Africa/Nairobi',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '';
  const phone = (d.m?.phone ?? '')
    .replace(/\D/g, '')
    .replace(/^254/, '0')
    .replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');

  // Services, each with the durations the club sells, and when each would start for this member.
  const liveEnds = new Map(live.filter((a) => a.service_id).map((a) => [a.service_id as string, a.ends]));
  const label = (p: { name: string; service: string; unit: string; count: number }) => {
    const rest = p.name.startsWith(`${p.service} · `) ? p.name.slice(p.service.length + 3) : '';
    if (p.unit === 'day' && p.count === 1) return 'Day pass';
    return rest && !/\d/.test(rest) ? rest.charAt(0).toUpperCase() + rest.slice(1) : span(p.unit, p.count);
  };
  const services: WizService[] = [];
  for (const p of d.plans) {
    const key = p.service_id ?? p.service;
    let s = services.find((x) => x.id === key);
    if (!s) {
      const ends = p.service_id ? liveEnds.get(p.service_id) : undefined;
      s = {
        id: key,
        name: p.service,
        note: ends ? `You have it until ${date(ends)}` : `From ${kes(p.price_kes)}`,
        options: [],
      };
      services.push(s);
    }
    const ends = p.service_id ? liveEnds.get(p.service_id) : undefined;
    s.options.push({
      productId: p.id,
      label: label(p),
      price: p.price_kes,
      starts: ends
        ? `Starts ${date(new Date(ends.getTime() + 1000))}, after your current ${p.service}`
        : p.unit === 'hour'
          ? 'Starts when you pay'
          : p.unit === 'day' && p.count === 1
            ? 'Today until 23:59'
            : 'Starts today',
    });
  }

  if (sp.v === 'add') {
    if (d.waiting !== null) redirect('/m');
    const start = sp.renew && d.plans.some((p) => p.id === sp.renew) ? { productId: sp.renew } : null;
    return shell(<AddWizard services={services} phone={phone} start={start} />);
  }

  const lastPlan = d.plans.find((p) => p.id === d.last);
  const fullName = [d.m?.first_name, d.m?.last_name].filter(Boolean).join(' ');
  const cap = 'text-[10.5px] font-semibold uppercase tracking-[0.12em]';
  const tile =
    'flex min-h-[96px] flex-col gap-1.5 rounded-2xl border border-[#E4E8EF] bg-white p-3.5 text-left transition hover:bg-[#F7F9FC]';
  const tileIcon = 'grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600';

  return shell(
    <>
      <header className="mb-4 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Hi {d.m?.first_name}</div>
          <div className="truncate text-[12px] text-ink-500">{d.club}</div>
        </div>
        <form action={memberLogout}>
          <button type="submit" className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink-500 hover:text-ink-900">
            Sign out
          </button>
        </form>
      </header>

      {/* The pass: emerald while access is on, slate once it has ended. */}
      <section
        className={`overflow-hidden rounded-[22px] text-white ${on ? 'bg-[linear-gradient(150deg,#10B981_0%,#047857_50%,#064E3B_100%)] shadow-[0_26px_50px_-20px_rgba(16,185,129,0.55)]' : 'bg-[linear-gradient(150deg,#475569_0%,#334155_55%,#1F2937_100%)] shadow-[0_26px_50px_-20px_rgba(15,23,42,0.45)]'}`}
      >
        <div className="flex items-start justify-between px-5 pt-[18px]">
          <div className="min-w-0">
            <div className={`${cap} opacity-75`}>Membership</div>
            <div className="mt-1 truncate text-[17px] font-semibold">
              {on ? live.map((a) => a.name).join(' + ') : (d.access[0]?.name ?? 'No plan yet')}
            </div>
          </div>
          <div className="text-right">
            <div className={`${cap} opacity-75`}>Member</div>
            <div className="mt-1 font-mono text-[17px] font-semibold">{d.m?.member_no}</div>
          </div>
        </div>
        <div className="px-5 pb-[18px] pt-1">
          {d.waiting !== null ? (
            <div className="py-3" role="status" aria-live="polite">
              <div className="flex items-center gap-2 text-[20px] font-bold">
                <Loader2 size={20} className="animate-spin" /> Processing payment…
              </div>
              <div className="mt-1 text-[13px] opacity-85">
                Enter your M-Pesa PIN to pay {kes(d.waiting)}. Your pass updates by itself; no need to pay again.
              </div>
            </div>
          ) : (
            <>
              <div className="text-[52px] font-bold leading-none tracking-[-0.03em] tabular-nums">
                {left}
                <span className="ml-1.5 text-[16px] font-medium tracking-normal opacity-80">
                  {left === 1 ? 'day left' : 'days left'}
                </span>
              </div>
              <div className="mt-1.5 text-[13px] opacity-85">
                {on
                  ? `Valid until ${longDate(until)}, 23:59`
                  : until
                    ? `Ended ${longDate(until)}. Renew below to walk straight in.`
                    : 'Tap “Add a service” below and pay with M-Pesa to get in.'}
              </div>
            </>
          )}
        </div>
        <div className="relative h-[18px] bg-white/[0.08]">
          <span className="absolute -left-[9px] top-0 h-[18px] w-[18px] rounded-full bg-[#F4F6FA]" />
          <span className="absolute -right-[9px] top-0 h-[18px] w-[18px] rounded-full bg-[#F4F6FA]" />
        </div>
        <div className="grid grid-cols-3 gap-2.5 bg-white/[0.08] px-5 pb-[18px] pt-3.5">
          <div className="min-w-0">
            <div className={`${cap} opacity-70`}>Name</div>
            <div className="truncate text-[14px] font-semibold">{fullName}</div>
          </div>
          <div className="min-w-0">
            <div className={`${cap} opacity-70`}>Areas</div>
            <div className="truncate text-[14px] font-semibold">{on ? live.map((a) => a.name).join(', ') : 'None'}</div>
          </div>
          <div>
            <div className={`${cap} opacity-70`}>Status</div>
            <div className="text-[14px] font-semibold">{on ? 'Active' : d.access.length ? 'Ended' : 'New'}</div>
          </div>
        </div>
      </section>

      {sp.pay === 'unavailable' && (
        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-800 ring-1 ring-amber-200">
          Online payment isn&apos;t switched on for this club yet. Pay at reception.
        </div>
      )}
      {(sp.pay === 'failed' || sp.pay === 'wait') && (
        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-800 ring-1 ring-amber-200">
          {sp.pay === 'wait'
            ? 'A payment request was just sent. Give it a few minutes before trying again.'
            : 'We couldn’t reach M-Pesa just now. Try again in a minute or pay at reception.'}
        </div>
      )}
      {sp.pay === 'sent' && d.waiting === null && on && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-[13px] text-emerald-800 ring-1 ring-emerald-200">
          <CheckCircle2 size={16} className="shrink-0" /> Payment received. Your pass is updated and a receipt is on its
          way by SMS.
        </div>
      )}

      {d.waiting === null && (
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          {services.length > 0 && (
            <Link
              href="/m?v=add"
              className="col-span-2 flex items-center gap-3 rounded-2xl bg-emerald-600 p-4 text-white shadow-[0_12px_24px_-14px_rgba(5,150,105,0.8)] transition hover:bg-emerald-700"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/20">
                <Plus size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[16px] font-bold">Add a service</b>
                <span className="block truncate text-[12.5px] text-emerald-50">
                  {services.map((s) => s.name).join(', ')}
                </span>
              </span>
            </Link>
          )}
          {lastPlan && (
            <Link href={`/m?v=add&renew=${lastPlan.id}`} className={tile}>
              <span className={tileIcon}>
                <RefreshCw size={17} />
              </span>
              <b className="text-[14px] font-semibold">Renew</b>
              <span className="text-[12px] leading-snug text-ink-500">
                {lastPlan.service} · {label(lastPlan)} · {kes(lastPlan.price_kes)}
              </span>
            </Link>
          )}
          <Link href="/m?v=receipts" className={tile}>
            <span className={tileIcon}>
              <Receipt size={17} />
            </span>
            <b className="text-[14px] font-semibold">Receipts</b>
            <span className="text-[12px] leading-snug text-ink-500">
              {d.receipts ? `${d.receipts} ${d.receipts === 1 ? 'payment' : 'payments'} · open or share` : 'None yet'}
            </span>
          </Link>
          <Link
            href="/m?v=visits"
            className={
              lastPlan
                ? 'col-span-2 flex items-center gap-3 rounded-2xl border border-[#E4E8EF] bg-white p-3.5 transition hover:bg-[#F7F9FC]'
                : tile
            }
          >
            <span className={tileIcon}>
              <CalendarCheck size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[14px] font-semibold">My visits</b>
              <span className="block text-[12px] leading-snug text-ink-500">
                {d.visits} {d.visits === 1 ? 'visit' : 'visits'} this month
              </span>
            </span>
          </Link>
        </div>
      )}

      {(d.ch?.paybill || d.ch?.till) && (
        <div className="mt-4 rounded-2xl border border-[#E4E8EF] bg-white p-4">
          <div className={`${cap} text-ink-500`}>Or pay from the M-Pesa menu</div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[12px] text-ink-500">{d.ch?.paybill ? 'Paybill' : 'Till'}</div>
              <div className="font-mono text-[18px] font-semibold">{d.ch?.paybill ?? d.ch?.till}</div>
            </div>
            {d.ch?.paybill && (
              <div>
                <div className="text-[12px] text-ink-500">Account</div>
                <div className="font-mono text-[18px] font-semibold">{d.m?.member_no}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 divide-y divide-[#EEF1F6] overflow-hidden rounded-2xl border border-[#E4E8EF] bg-white">
        {d.wa && (
          <a
            href={`https://wa.me/${d.wa.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-3 px-4 py-3.5 text-[13.5px]"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
              <MessageCircle size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block font-semibold">Message the club</b>
              <span className="text-[12px] text-ink-500">WhatsApp · {d.wa}</span>
            </span>
          </a>
        )}
        <form action={setNews} className="flex items-center gap-3 px-4 py-3.5">
          <input type="hidden" name="news" value={d.m?.sms_news ? 'off' : 'on'} />
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#F1F4F8] text-ink-700">
            <Megaphone size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">Club news by SMS</div>
            <div className="text-[12px] text-ink-500">
              {sp.news === 'off'
                ? 'Off. Receipts and renewal reminders still come.'
                : sp.news === 'on'
                  ? 'On.'
                  : 'Closures, events and offers. Receipts and reminders always come.'}
            </div>
          </div>
          <button
            type="submit"
            className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-[#D5DBE5] hover:bg-[#F5F7FB]"
          >
            {d.m?.sms_news ? 'Turn off' : 'Turn on'}
          </button>
        </form>
      </div>
      <p className="mt-8 text-center text-[11px] tracking-[0.12em] text-[#9AA6B8]">© NAVAC GLOBAL</p>
    </>,
    d.waiting !== null ? <LiveRefresh seconds={2} /> : undefined,
  );
}
