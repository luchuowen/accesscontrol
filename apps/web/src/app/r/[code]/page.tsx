import { withTenant } from '@lango/db';
import { readRenewLink } from '@lango/server';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { LiveRefresh } from '@/app/(console)/_dash/live-refresh';
import { SubmitButton } from '@/components/submit-button';
import { date, kes } from '@/lib/format';
import { settlePending } from '@/lib/settle';
import { db } from '@/server/db';
import { renewPay } from './actions';
import { lastPlan } from './plan';

export const dynamic = 'force-dynamic';

/**
 * Renew link from a reminder SMS (approved 5 Oct 2026): opens without the sign-in code, so it shows only the first
 * name, member number and the plan to renew, and its one button sends an M-Pesa prompt to the member's own phone.
 */
export default async function Renew({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ pay?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const link = await readRenewLink(db(), code);
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-[#F4F6FA] px-[18px] pb-10 pt-8 text-ink-900">
      <div className="mx-auto max-w-md">{children}</div>
    </div>
  );
  if (!link)
    return shell(
      <div className="rounded-2xl border border-[#E4E8EF] bg-white p-5">
        <h1 className="text-[19px] font-bold">This renew link has expired</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500">
          Renew links work for 48 hours. Sign in with your phone number to renew instead.
        </p>
        <Link
          href="/m"
          className="mt-4 grid h-12 place-items-center rounded-2xl bg-emerald-600 text-[15px] font-bold text-white"
        >
          Open my membership
        </Link>
      </div>,
    );
  const waitingNow = await settlePending(link.tenantId, link.memberId);
  const d = await withTenant(db(), link.tenantId, async (tx) => {
    const [m] = await tx<{ first_name: string; member_no: number; phone: string | null; club: string }[]>`
      select m.first_name, m.member_no, m.phone, t.name as club from members m join tenants t on t.id = m.tenant_id
      where m.id = ${link.memberId}`;
    const plan = await lastPlan(tx, link.memberId);
    const [paid] = await tx<{ ends: Date }[]>`
      select max(e.ends_at) as ends from payments p join entitlements e on e.source_id = p.id
      where p.member_id = ${link.memberId} and p.status = 'applied' and p.applied_at > now() - interval '15 minutes'
      having max(e.ends_at) is not null`;
    return { m, plan, paid };
  });
  const digits = (d.m?.phone ?? '').replace(/\D/g, '').replace(/^254/, '0');
  const masked = digits.length === 10 ? `${digits.slice(0, 2)}•• ••• ${digits.slice(7)}` : 'your phone';
  const done = sp.pay === 'sent' && !waitingNow && d.paid;
  return shell(
    <>
      {waitingNow && <LiveRefresh seconds={2} />}
      <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500">{d.m?.club}</div>
      <h1 className="mt-1 text-[22px] font-bold leading-tight">
        Renew, {d.m?.first_name}
        <span className="ml-2 font-mono text-[14px] font-semibold text-ink-500">#{d.m?.member_no}</span>
      </h1>

      {done ? (
        <div className="mt-5 rounded-2xl bg-emerald-600 p-5 text-white" role="status">
          <CheckCircle2 size={28} />
          <div className="mt-2 text-[19px] font-bold">Payment received</div>
          <div className="mt-1 text-[13.5px] text-emerald-50">
            You&apos;re in until {date(d.paid?.ends ?? null)}, 23:59. Your receipt is on its way by SMS.
          </div>
        </div>
      ) : waitingNow ? (
        <div className="mt-5 rounded-2xl bg-emerald-600 p-5 text-white" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-[19px] font-bold">
            <Loader2 size={20} className="animate-spin" /> Processing payment…
          </div>
          <div className="mt-1 text-[13.5px] text-emerald-50">
            Enter your M-Pesa PIN on {masked}. This page updates by itself.
          </div>
        </div>
      ) : d.plan ? (
        <form action={renewPay} className="mt-5">
          <input type="hidden" name="code" value={code} />
          <div className="rounded-2xl border border-[#E4E8EF] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <b className="text-[15px] font-semibold">{d.plan.name}</b>
              <b className="shrink-0 text-[15px] tabular-nums">{kes(d.plan.price_kes)}</b>
            </div>
            <div className="mt-1 text-[12.5px] text-ink-500">
              {d.plan.ends
                ? `Starts ${date(new Date(d.plan.ends.getTime() + 1000))}, when your current plan ends`
                : 'Starts as soon as you pay'}
            </div>
          </div>
          {sp.pay === 'failed' && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-800 ring-1 ring-amber-200">
              We couldn&apos;t reach M-Pesa just now. Try again in a minute.
            </p>
          )}
          {sp.pay === 'wait' && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-800 ring-1 ring-amber-200">
              A payment request was just sent. Give it a few minutes before trying again.
            </p>
          )}
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
            The M-Pesa prompt goes to {masked}, the phone on your membership.
          </p>
          <SubmitButton
            pendingText="Sending to your phone…"
            className="mt-4 h-[52px] w-full rounded-2xl bg-emerald-600 text-[15px] font-bold text-white transition hover:bg-emerald-700"
          >
            Pay {kes(d.plan.price_kes)} with M-Pesa
          </SubmitButton>
        </form>
      ) : (
        <p className="mt-4 text-[13.5px] text-ink-500">
          Your last plan is no longer sold. Sign in to choose a new one.
        </p>
      )}
      <Link href="/m" className="mt-5 block text-center text-[13px] font-semibold text-emerald-700">
        Choose something else
      </Link>
    </>,
  );
}
