import { withTenant } from '@lango/db';
import { can, clubSms, type NotifySettings, platformSmsConfig } from '@lango/server';
import { BadgeCheck, Hash, History, MessageSquare, Send, Wallet } from 'lucide-react';
import Link from 'next/link';
import { MoneyInput } from '@/components/money-input';
import { SubmitButton } from '@/components/submit-button';
import { dateTime, kes } from '@/lib/format';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { buySms, sendTestSms } from './actions';
import { Banner, Group, type Note, Pill, Row, SectionHead } from './bits';

const NOTES: Record<string, Note> = {
  forbidden: ['red', 'You don’t have permission to do this.'],
  number: ['red', 'Enter a Kenyan mobile number, e.g. 0712 345 678.'],
  wait: ['amber', 'A few test messages were just sent. Wait a few minutes.'],
  platform: ['amber', 'SMS is not connected on the platform yet. Ask NAVAC.'],
  'test-sent': ['green', 'Test SMS sent. It should arrive within a minute.'],
  'test-failed': ['red', 'The test SMS was not accepted. See Communications › Sent automatically.'],
  'topup-sent': ['green', 'M-Pesa prompt sent. Credit is added as soon as the payment is confirmed.'],
  'topup-phone': ['red', 'Enter a Kenyan mobile number for the M-Pesa prompt.'],
  'topup-amount': ['red', 'Enter at least KES 10.'],
  'topup-no-platform-taifapay': ['amber', 'SMS credit sales are not switched on yet. Ask NAVAC.'],
  'topup-failed': ['red', 'M-Pesa could not be reached. Try again in a minute.'],
};

/** Settings › SMS credit: balance, buying credit by M-Pesa, price, sender name, purchases. */
export async function SmsTab({ s, sms }: { s: Session; sms?: string }) {
  const [platformCfg, [row]] = await Promise.all([
    platformSmsConfig(db()),
    withTenant(
      db(),
      s.tid,
      (tx) =>
        tx<
          { n: NotifySettings | null }[]
        >`select data->'notifications' as n from tenant_settings where tenant_id = ${s.tid}`,
    ),
  ]);
  const n = row?.n ?? {};
  const [wallet, topups, [month]] = await withTenant(db(), s.tid, (tx) =>
    Promise.all([
      clubSms(tx, s.tid, platformCfg),
      tx<{ id: string; created_at: Date; amount_kes: number; units: number; status: string; trigger: string }[]>`
        select id, created_at, amount_kes, units, status, trigger from sms_topups order by created_at desc limit 5`,
      tx<{ used: number }[]>`
        select coalesce(-sum(units), 0)::int as used from sms_ledger where kind = 'send' and created_at > now() - interval '30 days'`,
    ]),
  );
  const connected = !!platformCfg?.apiKey;
  const low = n.lowBalance ?? 100;
  return (
    <>
      <SectionHead
        icon={Wallet}
        title="SMS credit"
        sub="Prepaid credit for receipts, reminders, replies and club news."
      />
      <Banner note={sms ? NOTES[sms] : undefined} />
      <div className="relative overflow-hidden rounded-3xl bg-[#0B1629] p-6 text-white">
        <Wallet
          size={150}
          strokeWidth={1}
          className="pointer-events-none absolute -bottom-8 -right-6 text-white/[0.06]"
        />
        <div className="flex flex-wrap items-start gap-6">
          <div>
            <div className="text-[12.5px] text-white/60">Balance</div>
            <div
              className={`mt-1 text-[34px] font-semibold tracking-tight tabular-nums ${wallet.balance < low ? 'text-amber-300' : ''}`}
            >
              {wallet.balance.toLocaleString('en-KE')}{' '}
              <span className="text-[18px] font-medium text-white/60">SMS</span>
            </div>
            <div className="text-[12.5px] text-white/60">
              About {kes(Math.round(wallet.balance * wallet.priceKes))} · {(month?.used ?? 0).toLocaleString('en-KE')}{' '}
              used in 30 days
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[12.5px] text-white/60">Alert below</div>
            <div className="mt-1 text-[20px] font-semibold tabular-nums">{low.toLocaleString('en-KE')} SMS</div>
          </div>
        </div>
        {can(s, 'sms.buy') && (
          <form action={buySms} className="relative mt-5 flex flex-wrap gap-2">
            <MoneyInput name="amountKes" required defaultValue={1000} className="h-11 w-36 bg-white text-ink-900" />
            <input
              name="phone"
              inputMode="tel"
              required
              defaultValue={n.alertPhone ?? ''}
              placeholder="M-Pesa phone"
              aria-label="M-Pesa phone"
              className="h-11 min-w-[160px] flex-1 rounded-xl bg-white/10 px-3.5 text-[14px] text-white outline-none ring-1 ring-white/15 placeholder:text-white/40 focus:ring-white/40"
            />
            <SubmitButton
              pendingText="Sending prompt…"
              className="btn h-11 bg-white px-5 text-ink-900 hover:bg-slate-100"
            >
              Buy SMS credit
            </SubmitButton>
          </form>
        )}
      </div>

      <Group title="Price">
        <Row icon={MessageSquare} label="SMS (160 characters)">
          {kes(wallet.priceKes)}
        </Row>
      </Group>

      <Group title="Sender name">
        <Row
          icon={Hash}
          label={<span className="font-mono font-semibold">{wallet.sender}</span>}
          hint="Shown on members’ phones"
        >
          {connected ? (
            <Pill ok>
              <BadgeCheck size={13} /> Approved
            </Pill>
          ) : (
            <Pill ok={false}>Not connected</Pill>
          )}
        </Row>
        {connected && can(s, 'messages.manage') && (
          <form action={sendTestSms} className="flex items-center gap-2 px-4 py-2.5">
            <Send size={17} className="shrink-0 text-ink-300" />
            <input
              name="phone"
              inputMode="tel"
              required
              placeholder="Send a test SMS to 07…"
              aria-label="Test phone"
              className="input py-2"
            />
            <SubmitButton pendingText="Sending…" className="btn-ghost shrink-0 px-3.5 py-2 text-[13px]">
              Send test
            </SubmitButton>
          </form>
        )}
      </Group>

      <details className="group mt-6">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          <History size={15} /> Purchases
          <span className="ml-auto text-[12.5px] normal-case tracking-normal text-emerald-700 group-open:hidden">
            Show
          </span>
          <span className="ml-auto hidden text-[12.5px] normal-case tracking-normal text-emerald-700 group-open:inline">
            Hide
          </span>
        </summary>
        <div className="mt-2 divide-y divide-[#F0F2F6] overflow-hidden rounded-2xl border border-[#E7EBF3]">
          {topups.length === 0 && <p className="px-4 py-4 text-[13px] text-ink-500">No purchases yet.</p>}
          {topups.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="w-28 shrink-0 text-ink-500">{dateTime(t.created_at)}</span>
              <span className="flex-1">
                {kes(t.amount_kes)} → {t.units.toLocaleString('en-KE')} SMS{t.trigger === 'auto' ? ' · automatic' : ''}
              </span>
              <Pill ok={t.status === 'completed' ? true : t.status === 'pending' ? null : false}>
                {t.status === 'completed' ? 'Paid' : t.status === 'pending' ? 'Waiting' : t.status}
              </Pill>
              <Link
                href={`/settings/sms/${t.id}`}
                className="w-16 text-right font-semibold text-emerald-700 hover:underline"
              >
                {t.status === 'completed' ? 'Receipt' : 'Invoice'}
              </Link>
            </div>
          ))}
          {topups.length > 0 && (
            <Link
              href="/settings/sms"
              className="block px-4 py-2.5 text-[12.5px] font-semibold text-ink-500 hover:text-ink-900"
            >
              All purchases →
            </Link>
          )}
        </div>
      </details>
    </>
  );
}
