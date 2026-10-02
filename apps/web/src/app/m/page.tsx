import { withTenant } from '@lango/db';
import { memberOtpStatus } from '@lango/server';
import { CheckCircle2, Smartphone } from 'lucide-react';
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
  searchParams: Promise<{ e?: string; pay?: string; step?: string; c?: string; n?: string; w?: string; news?: string }>;
}) {
  const sp = await searchParams;
  const who = await readMember();
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-ink-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-md">
        <div className="mb-8 flex items-center gap-2">
          <LangoMark size={32} />
          <span className="font-semibold">Lango</span>
        </div>
        {children}
      </div>
    </div>
  );
  if (!who) {
    const step = sp.step === 'code' || sp.step === 'phone' ? sp.step : 'start';
    const club = (sp.c ?? '').slice(0, 40);
    const no = (sp.n ?? '').replace(/\D/g, '').slice(0, 10);
    const Hidden = () => (
      <>
        <input type="hidden" name="club" value={club} />
        <input type="hidden" name="memberNo" value={no} />
      </>
    );
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
        <AuthShell>
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
            <a href="/m" className="text-slate-500 hover:text-ink-900">
              Change details
            </a>
          </p>
        </AuthShell>
      );
    }
    return (
      <AuthShell>
        <AuthHeading
          title={step === 'phone' ? 'Confirm your phone' : 'Your membership'}
          sub={
            step === 'phone'
              ? 'Enter the phone number your club has for you.'
              : 'Check your access and renew with M-Pesa before you arrive.'
          }
        />
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        {step === 'start' ? (
          <form action={memberStart} className="mt-8 grid gap-[18px]">
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
            <p className="text-center text-[12.5px] text-slate-500">
              Your club code and member number are on your membership card or receipt.
            </p>
          </form>
        ) : (
          <form action={memberLogin} className="mt-8 grid gap-[18px]">
            <Hidden />
            <div>
              <label htmlFor="phone" className="auth-label">
                Phone number
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
              <a href="/m" className="text-slate-500 hover:text-ink-900">
                Change details
              </a>
            </p>
          </form>
        )}
      </AuthShell>
    );
  }
  const d = await withTenant(db(), who.tenantId, async (tx) => {
    const [m] = await tx<
      { first_name: string; member_no: number; sms_news: boolean }[]
    >`select first_name, member_no, sms_news from members where id = ${who.memberId}`;
    const ents = await tx<
      { zone_key: string; ends_at: Date; starts_at: Date }[]
    >`select zone_key, starts_at, ends_at from entitlements where member_id = ${who.memberId}`;
    const plans = await tx<
      { id: string; name: string; price_kes: number }[]
    >`select id, name, price_kes from products where active and price_kes >= 100 order by price_kes`;
    const [t] = await tx<{ name: string }[]>`select name from tenants where id = ${who.tenantId}`;
    const [ch] = await tx<{ paybill: string | null; till: string | null }[]>`
      select data->'channels'->>'paybill' as paybill, data->'channels'->>'till' as till from tenant_settings`;
    return { m, ents, plans, club: t?.name, ch };
  });
  const now = Date.now();
  const live = d.ents.filter((e) => e.starts_at.getTime() <= now && e.ends_at.getTime() >= now);
  const until = d.ents.length ? new Date(Math.max(...d.ents.map((e) => e.ends_at.getTime()))) : null;
  return (
    <Shell>
      <div className="text-sm text-ink-300">{d.club}</div>
      <h1 className="text-2xl font-semibold tracking-tight">Hi {d.m?.first_name}</h1>
      <div
        className={`mt-6 rounded-3xl p-6 ${live.length ? 'bg-gradient-to-br from-brand-500 to-emerald-700 text-ink-950' : 'bg-white/5 ring-1 ring-white/10'}`}
      >
        <div className="text-xs font-medium uppercase tracking-widest opacity-70">Member #{d.m?.member_no}</div>
        <div className="mt-3 flex items-center gap-2 text-xl font-semibold">
          {live.length ? (
            <>
              <CheckCircle2 size={20} /> You&apos;re in
            </>
          ) : (
            'No active plan'
          )}
        </div>
        {until && (
          <div className="mt-1 text-sm opacity-80">
            Access until {date(until)}
            {live.length ? ` · ${daysLeft(until)} days left` : ''}
          </div>
        )}
        {live.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {[...new Set(live.map((e) => e.zone_key))].map((z) => (
              <span key={z} className="rounded-full bg-ink-950/15 px-2.5 py-0.5 text-xs font-medium capitalize">
                {z}
              </span>
            ))}
          </div>
        )}
      </div>
      {(d.ch?.paybill || d.ch?.till) && (
        <div className="mt-4 rounded-2xl bg-white/5 p-4 text-sm ring-1 ring-white/10">
          <div className="text-xs font-medium uppercase tracking-widest text-ink-300">Pay from the M-Pesa menu</div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-ink-300">{d.ch?.paybill ? 'Paybill' : 'Till'}</div>
              <div className="font-mono text-lg">{d.ch?.paybill ?? d.ch?.till}</div>
            </div>
            {d.ch?.paybill && (
              <div>
                <div className="text-xs text-ink-300">Account</div>
                <div className="font-mono text-lg">{d.m?.member_no}</div>
              </div>
            )}
          </div>
          <div className="mt-2 text-xs text-ink-300">Pay the exact plan price; the doors update within a minute.</div>
        </div>
      )}
      {sp.pay === 'sent' && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/5 p-3 text-sm">
          <Smartphone size={16} /> Check your phone and enter your M-Pesa PIN. The doors update automatically.
        </div>
      )}
      {sp.pay === 'unavailable' && (
        <div className="mt-4 rounded-xl bg-amber-500/15 p-3 text-sm text-amber-100">
          Online payment isn&apos;t switched on for this club yet. Pay at reception.
        </div>
      )}
      {(sp.pay === 'failed' || sp.pay === 'wait') && (
        <div className="mt-4 rounded-xl bg-amber-500/15 p-3 text-sm text-amber-100">
          {sp.pay === 'wait'
            ? 'A payment request was just sent. Give it a few minutes before trying again.'
            : 'We couldn\u2019t reach M-Pesa just now. Try again in a minute or pay at reception.'}
        </div>
      )}
      <h2 className="mt-8 text-xs font-medium uppercase tracking-widest text-ink-300">Renew or add</h2>
      <div className="mt-3 space-y-2">
        {d.plans.map((p) => (
          <form
            key={p.id}
            action={memberPay}
            className="flex items-center justify-between rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
          >
            <input type="hidden" name="productId" value={p.id} />
            <div>
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-xs text-ink-300">{kes(p.price_kes)}</div>
            </div>
            <SubmitButton
              pendingText="Sending…"
              className="btn bg-white px-3 py-2 text-xs text-ink-950 hover:bg-ink-100"
            >
              Pay with M-Pesa
            </SubmitButton>
          </form>
        ))}
      </div>
      <form action={setNews} className="mt-8 rounded-2xl bg-white/5 p-4 text-sm ring-1 ring-white/10">
        <input type="hidden" name="news" value={d.m?.sms_news ? 'off' : 'on'} />
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Club news by SMS</div>
            <div className="text-xs text-ink-300">
              {sp.news === 'off'
                ? 'Turned off. Receipts and renewal reminders still come.'
                : sp.news === 'on'
                  ? 'Turned on.'
                  : 'Closures, events and offers. Receipts and reminders always come.'}
            </div>
          </div>
          <button type="submit" className="btn bg-white/10 px-3 py-2 text-xs hover:bg-white/15">
            {d.m?.sms_news ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </form>
      <form action={memberLogout} className="mt-6 text-center">
        <button type="submit" className="text-sm text-ink-300 underline">
          Sign out
        </button>
      </form>
    </Shell>
  );
}
