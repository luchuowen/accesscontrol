import { withTenant } from '@lango/db';
import { can, clubSms, type NotifySettings, platformSmsConfig, quietHours } from '@lango/server';
import { BellRing, MessageSquare, Moon } from 'lucide-react';
import Link from 'next/link';
import { MoneyInput } from '@/components/money-input';
import { SubmitButton } from '@/components/submit-button';
import { Badge } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { buySms, saveNotifications, sendTestSms } from './actions';
import { Banner, type Note, TabHead } from './bits';

const NOTES: Record<string, Note> = {
  'm:saved': ['green', 'Message settings saved.'],
  'm:forbidden': ['red', 'Only the club owner or a manager can change this.'],
  'm:alert-phone': ['red', 'Add the alert phone: the daily summary and automatic top-up are sent to it.'],
  'sms:forbidden': ['red', 'You don’t have permission to change this.'],
  'sms:number': ['red', 'Enter a Kenyan mobile number, e.g. 0712 345 678.'],
  'sms:wait': ['amber', 'A few test messages were just sent. Wait a few minutes.'],
  'sms:platform': ['amber', 'SMS is not connected on the platform yet. Ask NAVAC to connect it.'],
  'sms:test-sent': ['green', 'Test SMS sent. It should arrive within a minute.'],
  'sms:test-failed': ['red', 'The test SMS was not accepted. See Communications › Sent automatically for the reason.'],
  'sms:topup-sent': ['green', 'M-Pesa prompt sent. The SMS credit is added as soon as the payment is confirmed.'],
  'sms:topup-phone': ['red', 'Enter a Kenyan mobile number for the M-Pesa prompt.'],
  'sms:topup-amount': ['red', 'Enter an amount of at least KES 10 that buys at least one SMS.'],
  'sms:topup-no-platform-taifapay': ['amber', 'SMS credit sales are not switched on yet. Ask NAVAC.'],
  'sms:topup-failed': ['red', 'M-Pesa could not be reached just now. Try again in a minute.'],
};

const hours = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

function Toggle({ name, on, children }: { name: string; on: boolean; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2.5">
      <input type="checkbox" name={name} defaultChecked={on} className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900" />
      <span>{children}</span>
    </label>
  );
}

/** Settings › Messages & SMS: what the club sends automatically, quiet hours, staff alerts and SMS credit. */
export async function MessagesTab({ s, m, sms }: { s: Session; m?: string; sms?: string }) {
  const [row] = await withTenant(
    db(),
    s.tid,
    (tx) => tx<{ n: NotifySettings | null }[]>`
      select data->'notifications' as n from tenant_settings where tenant_id = ${s.tid}`,
  );
  const n = row?.n ?? {};
  const notify = n;
  const quiet = quietHours(n);
  const platformCfg = await platformSmsConfig(db());
  const wallet = await withTenant(db(), s.tid, (tx) => clubSms(tx, s.tid, platformCfg));
  const smsSender = platformCfg?.apiKey ? wallet.sender : null;
  const topups = await withTenant(
    db(),
    s.tid,
    (tx) => tx<
      {
        id: string;
        created_at: Date;
        amount_kes: number;
        units: number;
        status: string;
        trigger: string;
        invoice_no: string;
      }[]
    >`
      select id, created_at, amount_kes, units, status, trigger, invoice_no from sms_topups order by created_at desc limit 5`,
  );
  const owner = can(s, 'messages.manage');
  const note = m ? NOTES[`m:${m}`] : sms ? NOTES[`sms:${sms}`] : undefined;
  return (
    <>
      <TabHead
        title="Messages & SMS"
        sub="What members and staff receive automatically. Members get at most one non-urgent message a day, and nothing but receipts and sign-in codes during quiet hours."
      />
      <Banner note={note} />
      <div className="grid gap-4">
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <MessageSquare size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">SMS credit</div>
              <div className="text-xs text-ink-500">
                Sent as {smsSender ?? 'NAVAC'} through Source Code · prepaid credit
              </div>
            </div>
            {!smsSender ? (
              <Badge tone="amber">platform not connected</Badge>
            ) : notify.enabled ? (
              <Badge tone="green">on</Badge>
            ) : (
              <Badge>off</Badge>
            )}
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-ink-50/60 p-3">
              <div className="label">Balance</div>
              <div
                className={`mt-1 text-xl font-semibold tabular-nums ${wallet.balance < (notify.lowBalance ?? 100) ? 'text-amber-700' : ''}`}
              >
                {wallet.balance.toLocaleString('en-KE')}
              </div>
              <div className="text-xs text-ink-500">SMS</div>
            </div>
            <div className="rounded-xl bg-ink-50/60 p-3">
              <div className="label">Price</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{kes(wallet.priceKes)}</div>
              <div className="text-xs text-ink-500">per SMS</div>
            </div>
            <div className="rounded-xl bg-ink-50/60 p-3">
              <div className="label">Sender</div>
              <div className="mt-1 truncate font-mono text-xl font-semibold">{wallet.sender}</div>
              <div className="text-xs text-ink-500">shown on phones</div>
            </div>
          </div>
          {can(s, 'sms.buy') && (
            <form action={buySms} className="mt-3 flex flex-wrap gap-2">
              <MoneyInput name="amountKes" required defaultValue={1000} className="h-10 w-36" />
              <input
                name="phone"
                inputMode="tel"
                required
                defaultValue={notify.alertPhone ?? ''}
                placeholder="M-Pesa phone 07…"
                className="input flex-1 py-2"
              />
              <SubmitButton pendingText="Sending prompt…" className="btn-primary py-2">
                Buy SMS
              </SubmitButton>
            </form>
          )}
          {topups.length > 0 && (
            <ul className="mt-2 text-xs text-ink-500">
              {topups.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-1">
                  <span className="w-24 shrink-0">{dateTime(t.created_at)}</span>
                  <span className="flex-1">
                    {kes(t.amount_kes)} → {t.units.toLocaleString('en-KE')} SMS
                    {t.trigger === 'auto' ? ' · automatic' : ''}
                  </span>
                  <Badge tone={t.status === 'completed' ? 'green' : t.status === 'pending' ? 'blue' : 'gray'}>
                    {t.status === 'completed' ? 'paid' : t.status}
                  </Badge>
                  <Link href={`/settings/sms/${t.id}`} className="w-14 text-right font-medium text-ink-700 underline">
                    {t.status === 'completed' ? 'Receipt' : 'Invoice'}
                  </Link>
                </li>
              ))}
              <li className="pt-1">
                <Link href="/settings/sms" className="underline">
                  All SMS purchases
                </Link>
              </li>
            </ul>
          )}
          {smsSender && can(s, 'messages.manage') && (
            <form action={sendTestSms} className="mt-4 flex gap-2 border-t border-ink-100 pt-4">
              <input
                name="phone"
                inputMode="tel"
                required
                placeholder="Send a test SMS to 07…"
                className="input py-2"
              />
              <SubmitButton pendingText="Sending…" className="btn-ghost py-2">
                Send test
              </SubmitButton>
            </form>
          )}
        </section>
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <BellRing size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">What gets sent</div>
              <div className="text-xs text-ink-500">
                Sent as {wallet.sender} · KES {wallet.priceKes.toLocaleString('en-KE')} per SMS from the club’s credit.
                Staff alerts are free.
              </div>
            </div>
            {n.enabled ? <Badge tone="green">on</Badge> : <Badge>off</Badge>}
          </div>
          {owner ? (
            <form action={saveNotifications} className="mt-6 space-y-4 text-sm">
              <label className="flex items-center gap-2.5 font-medium">
                <input type="checkbox" name="enabled" defaultChecked={!!n.enabled} className="h-4 w-4 accent-ink-900" />
                Send SMS from this club
              </label>
              <div className="grid gap-4 xl:grid-cols-2">
                <fieldset className="space-y-2.5 rounded-xl bg-ink-50/60 p-4">
                  <legend className="label mb-2">To members</legend>
                  <Toggle name="receipts" on={n.receipts !== false}>
                    Payment receipt with the new end date
                  </Toggle>
                  <Toggle name="unmatched" on={n.unmatched !== false}>
                    “Payment received, no need to pay again” when an M-Pesa payment needs matching
                  </Toggle>
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      name="reminders"
                      defaultChecked={n.reminders !== false}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
                    />
                    <span>
                      Renewal reminder{' '}
                      <input
                        name="reminderDays"
                        type="number"
                        min={1}
                        max={14}
                        defaultValue={n.reminderDays ?? 3}
                        className="input inline-block w-14 px-2 py-0.5"
                      />{' '}
                      days before, and on the last day
                    </span>
                  </label>
                  <Toggle name="welcome" on={n.welcome !== false}>
                    Welcome with the member number (members added by staff, never imports)
                  </Toggle>
                  <Toggle name="winback" on={n.winback !== false}>
                    “We miss you”, once, a week after a plan ends without renewal
                  </Toggle>
                </fieldset>
                <fieldset className="space-y-2.5 rounded-xl bg-ink-50/60 p-4">
                  <legend className="label mb-2">To staff</legend>
                  <label className="flex items-center gap-2.5">
                    Alert phone
                    <input
                      name="alertPhone"
                      inputMode="tel"
                      defaultValue={n.alertPhone ?? ''}
                      placeholder="07…"
                      className="input w-40 py-1"
                    />
                  </label>
                  <Toggle name="bridgeAlerts" on={n.bridgeAlerts !== false}>
                    Door PC offline for 15 minutes, and back online
                  </Toggle>
                  <Toggle name="tamperAlerts" on={n.tamperAlerts !== false}>
                    Someone changed a member directly in AxTraxNG (Lango puts it back)
                  </Toggle>
                  <Toggle name="dailySummary" on={!!n.dailySummary}>
                    Daily summary at 19:00: payments, new members, entries
                  </Toggle>
                  <label className="block">
                    Low credit alert below{' '}
                    <input
                      name="lowBalance"
                      type="number"
                      min={0}
                      defaultValue={n.lowBalance ?? 100}
                      className="input inline-block w-20 px-2 py-0.5"
                    />{' '}
                    SMS
                  </label>
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      name="autoTopup"
                      defaultChecked={!!n.autoTopup}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
                    />
                    <span>
                      Then top up automatically: M-Pesa prompt to the alert phone for KES{' '}
                      <MoneyInput
                        name="autoTopupKes"
                        prefix={false}
                        defaultValue={n.autoTopupKes ?? 1000}
                        className="inline-flex h-8 w-24 align-middle"
                      />
                    </span>
                  </label>
                </fieldset>
                <fieldset className="space-y-2.5 rounded-xl bg-ink-50/60 p-4 xl:col-span-2">
                  <legend className="label mb-2 flex items-center gap-1.5">
                    <Moon size={12} /> Quiet hours
                  </legend>
                  <div className="flex items-center gap-2">
                    <select name="quietFrom" defaultValue={quiet.from} className="input w-28 py-1">
                      {hours.map((h) => (
                        <option key={h} value={h}>
                          {hh(h)}
                        </option>
                      ))}
                    </select>
                    to
                    <select name="quietTo" defaultValue={quiet.to} className="input w-28 py-1">
                      {hours.map((h) => (
                        <option key={h} value={h}>
                          {hh(h)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-ink-500">
                    Only receipts, “payment received” notes and portal sign-in codes go out in these hours. Everything
                    else waits until morning, including low-credit alerts and automatic top-up prompts.
                  </p>
                </fieldset>
              </div>
              <SubmitButton pendingText="Saving…" className="btn-primary w-full lg:w-auto">
                Save message settings
              </SubmitButton>
            </form>
          ) : (
            <p className="mt-6 text-sm text-ink-500">SMS is {n.enabled ? 'on' : 'off'} for this club.</p>
          )}
        </section>
      </div>
    </>
  );
}
