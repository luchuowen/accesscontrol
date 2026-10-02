import { withTenant } from '@lango/db';
import { can, clubSms, type NotifySettings, platformSmsConfig, quietHours } from '@lango/server';
import { BellRing, Megaphone, MessageSquare, Moon } from 'lucide-react';
import Link from 'next/link';
import { MoneyInput } from '@/components/money-input';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { requirePerm } from '@/lib/session';
import { db } from '@/server/db';
import { saveNotifications } from './actions';
import { AnnounceForm } from './announce-form';

const KIND: Record<string, string> = {
  receipt: 'Receipt',
  unmatched: 'Payment noted',
  reminder: 'Reminder',
  welcome: 'Welcome',
  winback: 'We miss you',
  announcement: 'News',
  otp: 'Sign-in code',
  system: 'Staff alert',
  topup: 'Credit receipt',
  test: 'Test',
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

export default async function Messages({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requirePerm('messages.manage');
  const { m } = await searchParams;
  const [row] = await withTenant(
    db(),
    s.tid,
    (tx) => tx<{ n: NotifySettings | null; name: string }[]>`
      select ts.data->'notifications' as n, t.name from tenants t
      left join tenant_settings ts on ts.tenant_id = t.id where t.id = ${s.tid}`,
  );
  const n = row?.n ?? {};
  const quiet = quietHours(n);
  const platform = await platformSmsConfig(db());
  const wallet = await withTenant(db(), s.tid, (tx) => clubSms(tx, s.tid, platform));
  const recent = await withTenant(
    db(),
    s.tid,
    (tx) =>
      tx<
        {
          id: string;
          created_at: Date;
          kind: string;
          phone: string;
          body: string;
          status: string;
          error: string | null;
        }[]
      >`select id, created_at, kind, phone, body, status, error from sms_messages order by created_at desc limit 30`,
  );
  const [month] = await withTenant(
    db(),
    s.tid,
    (tx) => tx<{ sent: number; members: number }[]>`
      select count(*)::int as sent, count(distinct member_id)::int as members from sms_messages
      where status = 'sent' and sent_at > now() - interval '30 days' and member_id is not null`,
  );
  const notices: Record<string, [string, string]> = {
    saved: ['green', 'Message settings saved.'],
    forbidden: ['red', 'Only the club owner can change this.'],
    'alert-phone': ['red', 'Add the alert phone: the daily summary and automatic top-up are sent to it.'],
  };
  const note = m ? notices[m] : undefined;
  const owner = can(s, 'messages.manage');
  const perMember = month?.members ? (month.sent / month.members).toFixed(1) : null;
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="What members and staff receive by SMS. Members get at most one non-urgent message a day, and nothing but receipts and sign-in codes during quiet hours."
      />
      {note && (
        <div
          className={`mb-6 rounded-xl p-3 text-sm ring-1 ${note[0] === 'green' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-800 ring-rose-200'}`}
        >
          {note[1]}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <Megaphone size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">Send news to members</div>
              <div className="text-xs text-ink-500">
                Closures, events, new classes. You see the cost before anything is sent.
              </div>
            </div>
            <Badge tone={wallet.balance > 0 ? 'green' : 'amber'}>{wallet.balance.toLocaleString('en-KE')} SMS</Badge>
          </div>
          {!n.enabled ? (
            <p className="mt-6 text-sm text-ink-500">Switch SMS on below to send news.</p>
          ) : owner ? (
            <AnnounceForm club={row?.name ?? ''} />
          ) : (
            <p className="mt-6 text-sm text-ink-500">The owner or a manager can send news.</p>
          )}
          <p className="mt-4 text-xs text-ink-500">
            Members who turned off club news in their portal are left out. Receipts and reminders still reach them.
          </p>
        </section>

        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <MessageSquare size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">Last 30 days</div>
              <div className="text-xs text-ink-500">
                {month?.sent
                  ? `${month.sent.toLocaleString('en-KE')} SMS to ${month.members.toLocaleString('en-KE')} members · about ${perMember} each`
                  : 'No member messages yet'}
              </div>
            </div>
            <Link href="/settings" className="text-xs font-medium text-ink-700 underline">
              Buy SMS
            </Link>
          </div>
          {recent.length > 0 ? (
            <ul className="mt-4 divide-y divide-ink-100 text-xs">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <span className="w-24 shrink-0 text-ink-500">{dateTime(r.created_at)}</span>
                  <span className="w-24 shrink-0 text-ink-500">{KIND[r.kind] ?? r.kind}</span>
                  <span className="min-w-0 flex-1 truncate" title={r.body}>
                    {r.body}
                    {r.error && r.status !== 'sent' && <span className="block truncate text-ink-500">{r.error}</span>}
                  </span>
                  <Badge
                    tone={
                      r.status === 'sent'
                        ? 'green'
                        : r.status === 'failed'
                          ? 'red'
                          : r.status === 'queued'
                            ? 'blue'
                            : 'gray'
                    }
                  >
                    {r.status === 'queued' ? 'waiting' : r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 text-sm text-ink-500">Messages appear here as they are sent.</p>
          )}
        </section>

        <section className="card p-6 lg:col-span-2">
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
              <div className="grid gap-4 lg:grid-cols-3">
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
                <fieldset className="space-y-2.5 rounded-xl bg-ink-50/60 p-4">
                  <legend className="label mb-2 flex items-center gap-1.5">
                    <Moon size={12} /> Quiet hours
                  </legend>
                  <div className="flex items-center gap-2">
                    <select name="quietFrom" defaultValue={quiet.from} className="input py-1">
                      {hours.map((h) => (
                        <option key={h} value={h}>
                          {hh(h)}
                        </option>
                      ))}
                    </select>
                    to
                    <select name="quietTo" defaultValue={quiet.to} className="input py-1">
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
