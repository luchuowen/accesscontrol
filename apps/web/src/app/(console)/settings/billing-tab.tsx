import { withTenant } from '@lango/db';
import { billingState, CYCLE_LABEL, CYCLE_MONTHS, can, clubPlan, clubSeats } from '@lango/server';
import { CalendarClock, CalendarRange, ReceiptText, RefreshCw, Users, Wallet } from 'lucide-react';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { SubmitButton } from '@/components/submit-button';
import { kes } from '@/lib/format';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { LiveRefresh } from '../_dash/live-refresh';
import { payPlan } from './actions';
import { Banner, Group, type Note, Pill, Row, SectionHead } from './bits';

const NOTES: Record<string, Note> = {
  received: ['green', 'Payment received. Thank you; your receipt is listed below.'],
  sent: ['green', 'M-Pesa prompt sent. Enter your PIN; your plan updates as soon as the payment is confirmed.'],
  phone: ['red', 'Enter a Kenyan mobile number for the M-Pesa prompt.'],
  pending: ['amber', 'A payment prompt was just sent. Give it two minutes before trying again.'],
  failed: ['red', 'M-Pesa could not be reached just now. Try again in a minute.'],
  wait: ['amber', 'Several prompts were just sent. Wait a few minutes.'],
  'no-platform-taifapay': ['amber', 'Online payment to NAVAC is not switched on yet. Contact support@navac.co.ke.'],
  unpriced: ['amber', 'Your price is still being agreed with NAVAC, so there is nothing to pay yet.'],
  'no-plan': ['amber', 'NAVAC has not set up your plan yet.'],
  cycles: ['red', 'Choose how long to pay for.'],
  forbidden: ['red', 'You don’t have permission to pay for the club.'],
  paid: ['green', 'Your setup fee is already paid.'],
};
const fmt = (d: string | Date | null) =>
  d ? (typeof d === 'string' ? DateTime.fromISO(d) : DateTime.fromJSDate(d)).toFormat('d LLL yyyy') : '—';

/** Settings › Billing: the club's Lango plan, when it renews, paying NAVAC by M-Pesa, and past payments. */
export async function BillingTab({ s, b }: { s: Session; b?: string }) {
  const [plan, seats, invoices, [me]] = await Promise.all([
    clubPlan(db(), s.tid),
    clubSeats(db(), s.tid),
    withTenant(
      db(),
      s.tid,
      (tx) => tx<
        {
          id: string;
          invoice_no: string;
          created_at: Date;
          period_from: Date | null;
          period_to: Date | null;
          amount_kes: number;
          status: string;
          kind: string;
        }[]
      >`select id, invoice_no, created_at, period_from, period_to, amount_kes, status, kind from subscription_invoices
        order by created_at desc limit 12`,
    ),
    db()<{ phone: string | null }[]>`select phone from app_staff_get(${s.uid})`,
  ]);
  const state = billingState(plan);
  // While an M-Pesa prompt is out, re-read every few seconds so the paid state shows the moment it lands.
  const waiting = invoices.some((i) => i.status === 'pending' && Date.now() - i.created_at.getTime() < 5 * 60_000);
  const today = DateTime.now().setZone('Africa/Nairobi').startOf('day');
  const left = plan?.paid_until ? Math.round(DateTime.fromISO(plan.paid_until).diff(today, 'days').days) : null;
  const months = plan ? CYCLE_MONTHS[plan.cycle] : 1;
  const options = plan?.cycle === 'yearly' ? [1, 2] : plan?.cycle === 'quarterly' ? [1, 2, 4] : [1, 3, 6, 12];
  const unit = (n: number) => {
    const m = n * months;
    return m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} month${m === 1 ? '' : 's'}`;
  };
  const nextFrom =
    plan?.paid_until && left !== null && left >= 0 ? DateTime.fromISO(plan.paid_until).plus({ days: 1 }) : today;
  const pill =
    state === 'active' ? (
      <Pill ok>Active</Pill>
    ) : state === 'due' ? (
      <Pill ok={false}>
        Renews in {left} day{left === 1 ? '' : 's'}
      </Pill>
    ) : state === 'overdue' ? (
      <Pill ok={false}>Payment due</Pill>
    ) : (
      <Pill ok={null}>{state === 'unpriced' ? 'Pricing being agreed' : 'Not set up'}</Pill>
    );
  const payer = can(s, 'billing.manage');
  return (
    <>
      <SectionHead icon={ReceiptText} title="Billing" sub="Your Lango plan and payments to NAVAC." action={pill} />
      {waiting && <LiveRefresh seconds={4} />}
      <Banner
        note={b === 'sent' && !waiting && invoices[0]?.status === 'paid' ? NOTES.received : b ? NOTES[b] : undefined}
      />

      <div className="relative overflow-hidden rounded-3xl bg-[#0B1629] text-white">
        <ReceiptText
          size={160}
          strokeWidth={1}
          className="pointer-events-none absolute -bottom-10 -right-8 text-white/[0.05]"
        />
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="text-[12.5px] text-white/60">Plan</div>
            <div className="mt-1 text-[26px] font-semibold tracking-tight">{plan?.plan_name ?? 'Lango'}</div>
            <div className="mt-1 text-[14px] text-white/80">
              {plan?.fee_kes != null ? (
                <>
                  <b className="text-white">{kes(plan.fee_kes)}</b>{' '}
                  {plan.cycle === 'monthly' ? 'a month' : plan.cycle === 'quarterly' ? 'every 3 months' : 'a year'}
                </>
              ) : (
                'Price being agreed with NAVAC'
              )}
            </div>
            <div
              className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${state === 'overdue' ? 'bg-rose-500/20 text-rose-200' : state === 'due' ? 'bg-amber-400/20 text-amber-200' : 'bg-white/10 text-white/80'}`}
            >
              <CalendarClock size={14} />
              {plan?.paid_until
                ? left !== null && left < 0
                  ? `Ended ${fmt(plan.paid_until)} · ${-left} day${left === -1 ? '' : 's'} ago`
                  : `Paid until ${fmt(plan.paid_until)} · ${left} day${left === 1 ? '' : 's'} left`
                : plan?.setup_paid
                  ? 'Setup fee paid · first month not paid yet'
                  : 'No payment yet'}
            </div>
          </div>
          {payer && plan?.fee_kes != null && (
            <form
              action={payPlan}
              className="relative grid w-full gap-2.5 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10 lg:w-[390px]"
            >
              <div className="text-[12px] font-semibold text-white/70">Pay for</div>
              <div className="grid grid-cols-4 gap-1.5">
                {options.map((n, i) => (
                  <label key={n} className="cursor-pointer">
                    <input type="radio" name="cycles" value={n} defaultChecked={i === 0} className="peer sr-only" />
                    <span className="block rounded-xl px-2 py-2 text-center ring-1 ring-white/15 transition peer-checked:bg-white peer-checked:text-ink-900 peer-checked:ring-white">
                      <b className="block text-[12.5px]">{unit(n)}</b>
                      <span className="block text-[11px] opacity-70 tabular-nums">{kes((plan.fee_kes ?? 0) * n)}</span>
                    </span>
                  </label>
                ))}
              </div>
              <input
                name="phone"
                inputMode="tel"
                required
                defaultValue={plan.billing_phone ?? me?.phone ?? ''}
                placeholder="M-Pesa phone"
                aria-label="M-Pesa phone"
                className="h-11 rounded-xl bg-white/10 px-3.5 text-[14px] text-white outline-none ring-1 ring-white/15 placeholder:text-white/40 focus:ring-white/40"
              />
              <SubmitButton pendingText="Sending prompt…" className="btn h-11 bg-white text-ink-900 hover:bg-slate-100">
                <Wallet size={16} /> Pay with M-Pesa
              </SubmitButton>
              <p className="text-[11.5px] text-white/50">Starts {fmt(nextFrom.toISODate())}. Paid to NAVAC Global.</p>
            </form>
          )}
        </div>
      </div>

      {payer && plan?.setup_fee_kes != null && !plan.setup_paid && (
        <form
          action={payPlan}
          className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4"
        >
          <input type="hidden" name="kind" value="setup" />
          <input type="hidden" name="cycles" value="1" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-ink-900">Setup fee · {kes(plan.setup_fee_kes)}</div>
            <div className="text-[12.5px] text-ink-500">Paid once, to NAVAC Global, for setting up your club.</div>
          </div>
          <input
            name="phone"
            inputMode="tel"
            required
            defaultValue={plan.billing_phone ?? me?.phone ?? ''}
            placeholder="M-Pesa phone"
            aria-label="M-Pesa phone for the setup fee"
            className="input w-44 py-2"
          />
          <SubmitButton pendingText="Sending prompt…" className="btn-primary py-2">
            <Wallet size={15} /> Pay setup fee
          </SubmitButton>
        </form>
      )}

      <Group title="Plan">
        <Row icon={RefreshCw} label="Billing cycle">
          {plan ? CYCLE_LABEL[plan.cycle] : '—'}
        </Row>
        <Row icon={CalendarRange} label="Next renewal">
          {plan?.paid_until ? fmt(DateTime.fromISO(plan.paid_until).plus({ days: 1 }).toISODate()) : '—'}
        </Row>
        <Row icon={Wallet} label="Renewal amount">
          {plan?.fee_kes != null ? kes(plan.fee_kes) : '—'}
        </Row>
        <Row icon={Users} label="Team seats" hint="Need more? Email support@navac.co.ke">
          {seats.used} of {seats.cap}
        </Row>
      </Group>

      <Group title="Payments">
        {invoices.length === 0 && <p className="px-4 py-4 text-[13px] text-ink-500">No payments yet.</p>}
        {invoices.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
            <span className="w-24 shrink-0 font-mono text-[12px] text-ink-500">{i.invoice_no}</span>
            <span className="min-w-0 flex-1">
              {i.kind === 'setup'
                ? 'Setup fee'
                : i.period_from && i.period_to
                  ? `${fmt(i.period_from)} – ${fmt(i.period_to)}`
                  : 'Subscription'}
              <span className="block text-[12px] text-ink-500">{fmt(i.created_at)}</span>
            </span>
            <b className="tabular-nums">{kes(i.amount_kes)}</b>
            <Pill ok={i.status === 'paid' ? true : i.status === 'pending' ? null : false}>
              {i.status === 'paid' ? 'Paid' : i.status === 'pending' ? 'Waiting' : 'Not paid'}
            </Pill>
            <Link
              href={`/settings/billing/${i.id}`}
              className="w-16 text-right font-semibold text-emerald-700 hover:underline"
            >
              {i.status === 'paid' ? 'Receipt' : 'Invoice'}
            </Link>
          </div>
        ))}
      </Group>
      <p className="mt-4 text-[12px] text-ink-500">
        Lango never charges you automatically. You’ll see a reminder here and on the bell a week before renewal.
      </p>
    </>
  );
}
