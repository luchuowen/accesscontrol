import { withTenant } from '@lango/db';
import { CheckCircle2, Loader2, Megaphone, MessageCircle } from 'lucide-react';
import { date, daysLeft, kes } from '@/lib/format';
import { settlePending } from '@/lib/settle';
import { db } from '@/server/db';
import { LiveRefresh } from '../(console)/_dash/live-refresh';
import { memberLogout, readMember, setNews } from './actions';
import { type PickPlan, PlanPicker } from './plan-picker';
import { MemberSignIn } from './signin';

export const dynamic = 'force-dynamic';

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
  }>;
}) {
  const sp = await searchParams;
  const who = await readMember();
  if (!who) return <MemberSignIn sp={sp} />;
  await settlePending(who.tenantId, who.memberId);
  const d = await withTenant(db(), who.tenantId, async (tx) => {
    const [m] = await tx<
      { first_name: string; last_name: string | null; member_no: number; sms_news: boolean }[]
    >`select first_name, last_name, member_no, sms_news from members where id = ${who.memberId}`;
    // Access per service: the latest end date, and whether it is on now.
    const access = await tx<{ name: string; ends: Date; live: boolean }[]>`
      select coalesce(sv.name, initcap(e.zone_key)) as name, max(e.ends_at) as ends,
             bool_or(e.starts_at <= now() and e.ends_at > now()) as live
      from entitlements e left join services sv on sv.id = e.service_id
      where e.member_id = ${who.memberId}
      group by 1 order by bool_or(e.starts_at <= now() and e.ends_at > now()) desc, max(e.ends_at) desc`;
    const plans = await tx<
      { id: string; name: string; price_kes: number; service: string; unit: string; count: number }[]
    >`select p.id, p.name, p.price_kes, coalesce(s.name, split_part(p.name, ' · ', 1)) as service,
             p.duration_unit as unit, p.duration_count as count
      from products p left join services s on s.id = p.service_id
       where p.active and coalesce(s.sold_to, 'both') <> 'walkins'
         and coalesce(s.active and s.deleted_at is null, true)
       order by 4, p.price_kes`;
    const recent = await tx<
      { id: string; paid_at: Date; amount_kes: number; what: string | null; channel: string; ref: string | null }[]
    >`select p.id, p.paid_at, p.amount_kes, p.channel, p.provider_txn_id as ref,
             coalesce((select string_agg(l.label, ' + ') from payment_lines l where l.payment_id = p.id), pr.name) as what
      from payments p left join products pr on pr.id = p.product_id
      where p.member_id = ${who.memberId} and p.status = 'applied' order by p.paid_at desc limit 4`;
    const [last] = await tx<{ product_id: string }[]>`
      select coalesce(l.product_id, p.product_id) as product_id from payments p
      left join payment_lines l on l.payment_id = p.id
      where p.member_id = ${who.memberId} and p.status = 'applied' and coalesce(l.product_id, p.product_id) is not null
      order by p.paid_at desc limit 1`;
    const [visits] = await tx<{ n: number }[]>`
      select count(*)::int as n from access_events
      where member_no = ${m?.member_no ?? -1} and granted and at >= date_trunc('month', now())`;
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
      recent,
      last: last?.product_id ?? null,
      visits: visits?.n ?? 0,
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
  const liveEnds = new Map(live.map((a) => [a.name, a.ends]));
  const short = (p: { name: string; service: string }) => {
    const t = p.name.startsWith(`${p.service} · `) ? p.name.slice(p.service.length + 3) : p.name;
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const picks: PickPlan[] = d.plans.map((p) => {
    const dayPass = p.unit === 'day' && p.count === 1;
    const ends = liveEnds.get(p.service);
    return {
      id: p.id,
      title: `${p.service} · ${short(p)}`,
      note: dayPass ? 'Today until 23:59' : ends ? `Starts ${date(new Date(ends.getTime() + 1000))}` : 'Starts today',
      price: p.price_kes,
      mark: p.service.charAt(0).toUpperCase(),
    };
  });
  const waLink = d.wa ? `https://wa.me/${d.wa.replace(/\D/g, '')}` : null;
  const fullName = [d.m?.first_name, d.m?.last_name].filter(Boolean).join(' ');
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
  const label = 'text-[10.5px] font-semibold uppercase tracking-[0.12em]';
  return (
    <div className="min-h-screen bg-[#F4F6FA] px-[18px] pb-10 pt-6 text-ink-900">
      {d.waiting !== null && <LiveRefresh seconds={2} />}
      <div className="mx-auto max-w-md">
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
              <div className={`${label} opacity-75`}>Membership</div>
              <div className="mt-1 truncate text-[17px] font-semibold">
                {on ? live.map((a) => a.name).join(' + ') : (d.access[0]?.name ?? 'No plan yet')}
              </div>
            </div>
            <div className="text-right">
              <div className={`${label} opacity-75`}>Member</div>
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
                      : 'Choose a plan below and pay with M-Pesa to get in.'}
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
              <div className={`${label} opacity-70`}>Name</div>
              <div className="truncate text-[14px] font-semibold">{fullName}</div>
            </div>
            <div className="min-w-0">
              <div className={`${label} opacity-70`}>Areas</div>
              <div className="truncate text-[14px] font-semibold">
                {on ? live.map((a) => a.name).join(', ') : 'None'}
              </div>
            </div>
            <div>
              <div className={`${label} opacity-70`}>Status</div>
              <div className="text-[14px] font-semibold">{on ? 'Active' : d.access.length ? 'Ended' : 'New'}</div>
            </div>
          </div>
        </section>

        <div className="mt-[18px] grid grid-cols-3 gap-2">
          {[
            [String(d.visits), d.visits === 1 ? 'visit this month' : 'visits this month'],
            [String(live.length), live.length === 1 ? 'area open' : 'areas open'],
            [
              on && until
                ? until.toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short' })
                : '—',
              'next renewal',
            ],
          ].map(([v, k]) => (
            <div
              key={k}
              className="rounded-[14px] border border-[#E4E8EF] bg-white px-2.5 py-3 text-center text-[12px] text-ink-500"
            >
              <b className="block text-[15px] text-ink-900 tabular-nums">{v}</b>
              {k}
            </div>
          ))}
        </div>

        {sp.pay === 'unavailable' && (
          <div className="mt-4 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-800 ring-1 ring-amber-200">
            Online payment isn&apos;t switched on for this club yet. Pay at reception.
          </div>
        )}
        {(sp.pay === 'failed' || sp.pay === 'wait') && (
          <div className="mt-4 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-800 ring-1 ring-amber-200">
            {sp.pay === 'wait'
              ? 'A payment request was just sent. Give it a few minutes before trying again.'
              : 'We couldn\u2019t reach M-Pesa just now. Try again in a minute or pay at reception.'}
          </div>
        )}
        {sp.pay === 'sent' && d.waiting === null && on && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-[13px] text-emerald-800 ring-1 ring-emerald-200">
            <CheckCircle2 size={16} /> Payment received. Your pass is updated and a receipt is on its way by SMS.
          </div>
        )}

        {d.waiting === null && picks.length > 0 && (
          <>
            <h2 className={`${label} mb-2.5 mt-6 text-ink-500`}>{on ? 'Add time' : 'Renew'}</h2>
            <PlanPicker plans={picks} initial={d.last && picks.some((p) => p.id === d.last) ? d.last : null} />
          </>
        )}

        {(d.ch?.paybill || d.ch?.till) && (
          <div className="mt-4 rounded-2xl border border-[#E4E8EF] bg-white p-4">
            <div className={`${label} text-ink-500`}>Or pay from the M-Pesa menu</div>
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

        {d.recent.length > 0 && (
          <>
            <h2 className={`${label} mb-1 mt-7 text-ink-500`}>Receipts</h2>
            <ul>
              {d.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 border-b border-[#E8ECF2] px-0.5 py-3 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{r.what ?? 'Payment'}</div>
                    <div className="text-[11.5px] text-ink-500">
                      {date(r.paid_at)} · {r.channel === 'cash' ? 'Cash at the desk' : 'M-Pesa'}
                    </div>
                  </div>
                  <b className="tabular-nums">{kes(r.amount_kes)}</b>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-7 divide-y divide-[#EEF1F6] overflow-hidden rounded-2xl border border-[#E4E8EF] bg-white">
          {waLink && (
            <a
              href={waLink}
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
      </div>
    </div>
  );
}
