import { withTenant } from '@lango/db';
import { memberOtpStatus } from '@lango/server';
import { CheckCircle2, Megaphone, MessageCircle, Smartphone } from 'lucide-react';
import { AuthHeading, AuthNotice, AuthShell } from '@/components/auth-shell';
import { LangoMark } from '@/components/logo';
import { SubmitButton } from '@/components/submit-button';
import { date, daysLeft, kes } from '@/lib/format';
import { db } from '@/server/db';
import { Checking, CodeTimer, OtpInput, ResendButton } from '../login/code/otp';
import { memberLogin, memberLogout, memberPay, memberStart, memberVerify, readMember, setNews } from './actions';

export const dynamic = 'force-dynamic';

export default async function MemberPortal({
  searchParams,
}: {
  searchParams: Promise<{
    e?: string;
    pay?: string;
    step?: string;
    c?: string;
    n?: string;
    w?: string;
    news?: string;
    from?: string;
  }>;
}) {
  const sp = await searchParams;
  const who = await readMember();
  if (!who) {
    const step = sp.step === 'code' || sp.step === 'phone' ? sp.step : 'start';
    const club = (sp.c ?? '').slice(0, 40);
    const no = (sp.n ?? '').replace(/\D/g, '').slice(0, 10);
    // Someone who came from the staff sign-in keeps a way back on every step; links sent to members never show it.
    const staff = sp.from === 'staff';
    const FromStaff = () => (staff ? <input type="hidden" name="from" value="staff" /> : null);
    const Hidden = () => (
      <>
        <input type="hidden" name="club" value={club} />
        <input type="hidden" name="memberNo" value={no} />
        <FromStaff />
      </>
    );
    const restart = staff ? '/m?from=staff' : '/m';
    const BackToStaff = () =>
      staff ? (
        <p className="mt-3 text-center text-[13px] text-slate-500">
          Staff?{' '}
          <a href="/login" className="auth-link font-semibold">
            Sign in with email
          </a>
        </p>
      ) : null;
    const error =
      sp.e === '2'
        ? 'Too many attempts. Wait a few minutes and try again.'
        : sp.e === '1'
          ? step === 'code'
            ? 'That code isn’t right or has expired. Check the latest SMS and try again.'
            : 'We couldn’t find an active membership with those details. Check your club code and member number.'
          : null;
    if (step === 'code') {
      const st = await memberOtpStatus(db(), club.toLowerCase(), Number.parseInt(no, 10));
      const minutes = Math.max(1, Math.ceil((st.resendAt - Date.now()) / 60_000));
      return (
        <AuthShell audience="members">
          <div className="text-center">
            <CodeTimer expiresAt={st.expiresAt} />
            <h1 className="text-[26px] font-semibold tracking-tight text-ink-900">Enter your code</h1>
            <p className="mt-1.5 text-sm text-ink-500">Sent by SMS to the phone number your club has for you.</p>
          </div>
          {error && <AuthNotice tone="error">{error}</AuthNotice>}
          {!error && sp.w && !st.capped && (
            <AuthNotice tone="info">A code was sent a moment ago. Use that one, or wait to ask for another.</AuthNotice>
          )}
          <form action={memberVerify}>
            <Hidden />
            <OtpInput />
            <Checking />
          </form>
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-[13px] text-slate-600">
            {st.capped ? (
              <>
                You’ve asked for several codes. For your security, try again in about {minutes} minute
                {minutes === 1 ? '' : 's'}.
              </>
            ) : (
              <span className="inline-flex flex-wrap items-center justify-center gap-x-1.5">
                Didn’t get it?
                <form action={memberStart} className="inline">
                  <Hidden />
                  <ResendButton resendAt={st.resendAt} label="Resend SMS" />
                </form>
              </span>
            )}
          </div>
          <p className="mt-3 text-center text-[13px]">
            <a href={restart} className="text-slate-500 hover:text-ink-900">
              Change details
            </a>
          </p>
          <BackToStaff />
        </AuthShell>
      );
    }
    return (
      <AuthShell audience="members">
        <AuthHeading
          title={step === 'phone' ? 'Confirm your phone' : 'Your membership'}
          sub={
            step === 'phone'
              ? 'Enter the phone number your club has for you.'
              : 'Sign in with your club code and member number.'
          }
        />
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        {step === 'start' ? (
          <form action={memberStart} className="mt-8 grid gap-[18px]">
            <FromStaff />
            <div>
              <label htmlFor="club" className="auth-label">
                Club code
              </label>
              <input
                id="club"
                name="club"
                defaultValue={club}
                required
                autoCapitalize="none"
                placeholder="Enter club code, e.g. demo-club"
                className="auth-input"
              />
            </div>
            <div>
              <label htmlFor="memberNo" className="auth-label">
                Member number
              </label>
              <input
                id="memberNo"
                name="memberNo"
                defaultValue={no}
                inputMode="numeric"
                required
                placeholder="Enter member number"
                className="auth-input"
              />
            </div>
            <SubmitButton pendingText="Checking…" className="auth-btn mt-1">
              Continue
            </SubmitButton>
            <p className="text-center text-[12.5px] text-slate-500">Both are on your membership card or receipt.</p>
            <BackToStaff />
          </form>
        ) : (
          <form action={memberLogin} className="mt-8 grid gap-[18px]">
            <Hidden />
            <div>
              <label htmlFor="phone" className="auth-label">
                Phone Number
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                autoFocus
                placeholder="Enter phone number"
                className="auth-input"
              />
            </div>
            <SubmitButton pendingText="Checking…" className="auth-btn mt-1">
              Continue
            </SubmitButton>
            <p className="text-center text-[13px]">
              <a href={restart} className="text-slate-500 hover:text-ink-900">
                Change details
              </a>
            </p>
            <BackToStaff />
          </form>
        )}
      </AuthShell>
    );
  }
  const d = await withTenant(db(), who.tenantId, async (tx) => {
    const [m] = await tx<
      { first_name: string; member_no: number; sms_news: boolean }[]
    >`select first_name, member_no, sms_news from members where id = ${who.memberId}`;
    // Access per service: the latest end date, and whether it is on now.
    const access = await tx<{ name: string; ends: Date; live: boolean }[]>`
      select coalesce(sv.name, initcap(e.zone_key)) as name, max(e.ends_at) as ends,
             bool_or(e.starts_at <= now() and e.ends_at > now()) as live
      from entitlements e left join services sv on sv.id = e.service_id
      where e.member_id = ${who.memberId}
      group by 1 order by bool_or(e.starts_at <= now() and e.ends_at > now()) desc, max(e.ends_at) desc`;
    const plans = await tx<{ id: string; name: string; price_kes: number; service: string }[]>`
      select p.id, p.name, p.price_kes, coalesce(s.name, split_part(p.name, ' · ', 1)) as service
      from products p left join services s on s.id = p.service_id
       where p.active and p.price_kes >= 100 and coalesce(s.sold_to, 'both') <> 'walkins'
         and coalesce(s.active and s.deleted_at is null, true)
       order by 4, p.price_kes`;
    const recent = await tx<{ id: string; paid_at: Date; amount_kes: number; what: string | null; channel: string }[]>`
      select p.id, p.paid_at, p.amount_kes, p.channel,
             coalesce((select string_agg(l.label, ' + ') from payment_lines l where l.payment_id = p.id), pr.name) as what
      from payments p left join products pr on pr.id = p.product_id
      where p.member_id = ${who.memberId} and p.status = 'applied' order by p.paid_at desc limit 4`;
    const [last] = await tx<{ product_id: string }[]>`
      select coalesce(l.product_id, p.product_id) as product_id from payments p
      left join payment_lines l on l.payment_id = p.id
      where p.member_id = ${who.memberId} and p.status = 'applied' and coalesce(l.product_id, p.product_id) is not null
      order by p.paid_at desc limit 1`;
    const [t] = await tx<{ name: string }[]>`select name from tenants where id = ${who.tenantId}`;
    const [ch] = await tx<{ paybill: string | null; till: string | null }[]>`
      select data->'channels'->>'paybill' as paybill, data->'channels'->>'till' as till from tenant_settings`;
    const [wa] = await tx<{ phone: string | null }[]>`
      select config->>'displayPhone' as phone from comm_channels where channel = 'whatsapp' and enabled`;
    return { m, access, plans, recent, last: last?.product_id ?? null, club: t?.name, ch, wa: wa?.phone ?? null };
  });
  const live = d.access.filter((a) => a.live);
  const again = d.plans.find((p) => p.id === d.last) ?? null;
  const groups = [...new Set(d.plans.map((p) => p.service))].map((g) => ({
    name: g,
    plans: d.plans.filter((p) => p.service === g),
  }));
  const short = (p: { name: string; service: string }) => {
    const t = p.name.startsWith(`${p.service} · `) ? p.name.slice(p.service.length + 3) : p.name;
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const waLink = d.wa ? `https://wa.me/${d.wa.replace(/\D/g, '')}` : null;
  const card = 'rounded-2xl bg-white ring-1 ring-[#E7EBF3] shadow-[0_1px_2px_rgba(12,18,32,0.04)]';
  return (
    <div className="min-h-screen bg-[#F4F6F9] px-4 py-6 text-ink-900">
      <div className="mx-auto max-w-md">
        <header className="mb-6 flex items-center gap-2.5">
          <LangoMark size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{d.club}</div>
            <div className="text-[11.5px] text-ink-500">Member #{d.m?.member_no}</div>
          </div>
          <form action={memberLogout}>
            <button
              type="submit"
              className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-ink-500 hover:bg-rose-50 hover:text-rose-700"
            >
              Sign out
            </button>
          </form>
        </header>

        <h1 className="text-[24px] font-semibold tracking-tight">Hi {d.m?.first_name}</h1>
        <div
          className={`mt-4 rounded-3xl p-5 ${live.length ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white' : 'bg-white text-ink-900 ring-1 ring-[#E7EBF3]'}`}
        >
          <div className="flex items-center gap-2 text-[19px] font-semibold">
            {live.length ? (
              <>
                <CheckCircle2 size={20} /> You&apos;re in
              </>
            ) : d.access.length ? (
              'Your access has ended'
            ) : (
              'No plan yet'
            )}
          </div>
          {d.access.length > 0 ? (
            <ul className={`mt-3 space-y-1.5 text-[13.5px] ${live.length ? 'text-white/90' : 'text-ink-500'}`}>
              {d.access.slice(0, 5).map((a) => (
                <li key={a.name} className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${a.live ? 'bg-white' : 'bg-current opacity-40'}`} />
                  <b className="font-semibold">{a.name}</b>
                  <span className="ml-auto tabular-nums">
                    {a.live ? `until ${date(a.ends)} · ${daysLeft(a.ends)} days` : `ended ${date(a.ends)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13.5px] text-ink-500">Pick a plan below and pay with M-Pesa to get in.</p>
          )}
        </div>

        {sp.pay === 'sent' && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-[13px] text-emerald-900 ring-1 ring-emerald-200">
            <Smartphone size={16} /> Check your phone and enter your M-Pesa PIN. The doors update automatically.
          </div>
        )}
        {sp.pay === 'unavailable' && (
          <div className="mt-4 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900 ring-1 ring-amber-200">
            Online payment isn&apos;t switched on for this club yet. Pay at reception.
          </div>
        )}
        {(sp.pay === 'failed' || sp.pay === 'wait') && (
          <div className="mt-4 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900 ring-1 ring-amber-200">
            {sp.pay === 'wait'
              ? 'A payment request was just sent. Give it a few minutes before trying again.'
              : 'We couldn\u2019t reach M-Pesa just now. Try again in a minute or pay at reception.'}
          </div>
        )}

        {again && (
          <form action={memberPay} className={`${card} mt-4 flex items-center gap-3 p-4`}>
            <input type="hidden" name="productId" value={again.id} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Renew</div>
              <div className="truncate text-[14.5px] font-semibold">{again.name}</div>
              <div className="text-[12.5px] text-ink-500 tabular-nums">{kes(again.price_kes)}</div>
            </div>
            <SubmitButton pendingText="Sending…" className="btn-primary px-4 py-2.5 text-[13px]">
              Pay with M-Pesa
            </SubmitButton>
          </form>
        )}

        <h2 className="mt-7 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          {again ? 'Or choose another plan' : 'Plans'}
        </h2>
        <div className="space-y-3">
          {groups.map((g) => (
            <section key={g.name} className={`${card} overflow-hidden`}>
              <div className="border-b border-[#EEF1F6] px-4 py-2.5 text-[13.5px] font-semibold">{g.name}</div>
              <div className="divide-y divide-[#F0F2F6]">
                {g.plans.map((p) => (
                  <form key={p.id} action={memberPay} className="flex items-center gap-3 px-4 py-3">
                    <input type="hidden" name="productId" value={p.id} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px]">{short(p)}</div>
                      <div className="text-[12.5px] font-semibold tabular-nums">{kes(p.price_kes)}</div>
                    </div>
                    <SubmitButton
                      pendingText="Sending…"
                      className="btn rounded-lg px-3 py-1.5 text-[12.5px] ring-1 ring-[#E1E5EC] hover:bg-ink-50"
                    >
                      Pay
                    </SubmitButton>
                  </form>
                ))}
              </div>
            </section>
          ))}
        </div>

        {(d.ch?.paybill || d.ch?.till) && (
          <div className={`${card} mt-4 p-4`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Or pay from the M-Pesa menu
            </div>
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
            <div className="mt-2 text-[12px] text-ink-500">
              Pay the exact plan price; the doors update within a minute.
            </div>
          </div>
        )}

        {d.recent.length > 0 && (
          <>
            <h2 className="mt-7 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Recent payments
            </h2>
            <ul className={`${card} divide-y divide-[#F0F2F6]`}>
              {d.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{r.what ?? 'Payment'}</div>
                    <div className="text-[12px] text-ink-500">
                      {date(r.paid_at)} · {r.channel === 'cash' ? 'Cash' : 'M-Pesa'}
                    </div>
                  </div>
                  <b className="tabular-nums">{kes(r.amount_kes)}</b>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className={`${card} mt-7 divide-y divide-[#F0F2F6]`}>
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-3 px-4 py-3.5 text-[13.5px]"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                <MessageCircle size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block font-semibold">Message the club on WhatsApp</b>
                <span className="text-[12px] text-ink-500">{d.wa}</span>
              </span>
            </a>
          )}
          <form action={setNews} className="flex items-center gap-3 px-4 py-3.5">
            <input type="hidden" name="news" value={d.m?.sms_news ? 'off' : 'on'} />
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-50 text-ink-500">
              <Megaphone size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">Club news by SMS</div>
              <div className="text-[12px] text-ink-500">
                {sp.news === 'off'
                  ? 'Turned off. Receipts and renewal reminders still come.'
                  : sp.news === 'on'
                    ? 'Turned on.'
                    : 'Closures, events and offers. Receipts and reminders always come.'}
              </div>
            </div>
            <button
              type="submit"
              className="btn rounded-lg px-3 py-1.5 text-[12.5px] ring-1 ring-[#E1E5EC] hover:bg-ink-50"
            >
              {d.m?.sms_news ? 'Turn off' : 'Turn on'}
            </button>
          </form>
        </div>
        <p className="mt-8 text-center text-[11px] tracking-[0.12em] text-ink-300">© NAVAC GLOBAL</p>
      </div>
    </div>
  );
}
