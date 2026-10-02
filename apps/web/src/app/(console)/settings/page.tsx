import { withTenant } from '@lango/db';
import { can, clubSms, onboardingChecklist, platformSmsConfig } from '@lango/server';
import { CheckCircle2, CreditCard, MessageSquare, Smartphone } from 'lucide-react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Checklist } from '@/components/checklist';
import { CopyField } from '@/components/copy-field';
import { MoneyInput } from '@/components/money-input';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';
import { buySms, saveChannels, saveTaifaPay, sendTestSms } from './actions';

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ taifa?: string; ch?: string; sms?: string }>;
}) {
  const s = await requireSession();
  if (!can(s, 'settings.payments') && !can(s, 'sms.buy') && !can(s, 'messages.manage')) redirect('/?denied=1');
  const { taifa, ch, sms } = await searchParams;
  const [row] = await withTenant(
    db(),
    s.tid,
    (tx) =>
      tx<
        {
          data: {
            taifapay?: { env: string; clientId: string };
            notifications?: {
              enabled?: boolean;
              receipts?: boolean;
              reminders?: boolean;
              reminderDays?: number;
              welcome?: boolean;
              lowBalance?: number;
              alertPhone?: string;
              autoTopup?: boolean;
              autoTopupKes?: number;
            };
            channels?: {
              paybill?: string | null;
              till?: string | null;
              linksOnly?: boolean;
              settlementConfirmed?: boolean;
              settlementBank?: string;
            };
          };
        }[]
      >`select data from tenant_settings where tenant_id = ${s.tid}`,
  );
  const [t] = await db()<{ slug: string }[]>`select slug from tenants where id = ${s.tid}`;
  const host = (await headers()).get('host');
  // Same for every club: the public address of this Lango server + the club's own code.
  const base = (process.env.PUBLIC_URL ?? `https://${host}`).replace(/\/$/, '');
  const webhook = `${base}/api/webhooks/taifapay/${t?.slug}`;
  const tp = row?.data.taifapay;
  const channels = row?.data.channels ?? {};
  const notify = row?.data.notifications ?? {};
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
  const checklist = await onboardingChecklist(db(), s.tid);
  const msg: Record<string, [string, string]> = {
    ok: ['green', 'Payment Gateway connected — the keys were verified and stored encrypted.'],
    rejected: ['red', 'The Payment Gateway rejected those keys. Check the environment (sandbox / live) and try again.'],
    missing: ['amber', 'Enter both the client ID and the client secret.'],
    unreachable: ['amber', 'The Payment Gateway did not answer in time, so nothing was saved. Try again in a minute.'],
    forbidden: ['red', 'You don’t have permission to change this.'],
  };
  const other: Record<string, [string, string]> = {
    'ch:ok': ['green', 'Payment channels saved. Members now see these details on the portal and receipts.'],
    'ch:number': ['red', 'Paybill and till numbers are 5 to 7 digits.'],
    'ch:forbidden': ['red', 'You don’t have permission to change this.'],
    'sms:forbidden': ['red', 'You don’t have permission to change this.'],
    'sms:number': ['red', 'Enter a Kenyan mobile number, e.g. 0712 345 678.'],
    'sms:wait': ['amber', 'A few test messages were just sent. Wait a few minutes.'],
    'sms:platform': ['amber', 'SMS is not connected on the platform yet. Ask NAVAC to connect it.'],
    'sms:test-sent': ['green', 'Test SMS sent. It should arrive within a minute.'],
    'sms:test-failed': ['red', 'The test SMS was not accepted. See Messages for the reason.'],
    'sms:topup-sent': ['green', 'M-Pesa prompt sent. The SMS credit is added as soon as the payment is confirmed.'],
    'sms:topup-phone': ['red', 'Enter a Kenyan mobile number for the M-Pesa prompt.'],
    'sms:topup-amount': ['red', 'Enter an amount of at least KES 10 that buys at least one SMS.'],
    'sms:topup-no-platform-taifapay': ['amber', 'SMS credit sales are not switched on yet. Ask NAVAC.'],
    'sms:topup-failed': ['red', 'M-Pesa could not be reached just now. Try again in a minute.'],
  };
  const m = taifa ? msg[taifa] : ch ? other[`ch:${ch}`] : sms ? other[`sms:${sms}`] : undefined;
  const owner = can(s, 'settings.payments');
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Payment keys, how members pay, and SMS credit. Every payment runs through the Payment Gateway and settles to the club's bank."
      />
      <div className="mb-6">
        <Checklist items={checklist} />
      </div>
      {m && (
        <div
          className={`mb-6 rounded-xl p-3 text-sm ring-1 ${m[0] === 'green' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : m[0] === 'red' ? 'bg-rose-50 text-rose-800 ring-rose-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {m[1]}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <CreditCard size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">Payment Gateway · M-Pesa &amp; cards</div>
              <div className="text-xs text-ink-500">STK prompts, payment links, automatic confirmation</div>
            </div>
            {tp ? (
              <Badge tone="green">
                <CheckCircle2 size={12} /> {tp.env}
              </Badge>
            ) : (
              <Badge>not connected</Badge>
            )}
          </div>
          {owner ? (
            <form action={saveTaifaPay} className="mt-6 space-y-4">
              <label className="block">
                <span className="label">Environment</span>
                <select name="env" defaultValue={tp?.env ?? 'live'} className="input mt-1.5">
                  <option value="live">Live</option>
                  <option value="sandbox">Sandbox (testing)</option>
                </select>
              </label>
              <label className="block">
                <span className="label">Client ID</span>
                <input
                  name="clientId"
                  type="password"
                  placeholder={
                    tp
                      ? `••••${tp.clientId.slice(-4)} · stored, enter to replace`
                      : 'From Payment Gateway › API Integration'
                  }
                  className="input mt-1.5"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="label">Client secret</span>
                <input
                  name="clientSecret"
                  type="password"
                  placeholder={
                    tp ? '•••••••• · stored, enter to replace' : 'Shown once when the credential is generated'
                  }
                  className="input mt-1.5"
                  autoComplete="new-password"
                />
              </label>
              <div>
                <span className="label">Deposit webhook URL</span>
                <div className="mt-1.5">
                  <CopyField value={webhook} label="Deposit webhook URL" />
                </div>
              </div>
              <SubmitButton pendingText="Checking the keys with the Payment Gateway…" className="btn-primary w-full">
                Verify &amp; save
              </SubmitButton>
            </form>
          ) : (
            <p className="mt-6 text-sm text-ink-500">Only the owner or an admin can change payment settings.</p>
          )}
        </section>
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <Smartphone size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">How members pay</div>
              <div className="text-xs text-ink-500">The club’s own paybill or till, linked on the Payment Gateway</div>
            </div>
            {channels.paybill || channels.till || channels.linksOnly ? (
              <Badge tone="green">set</Badge>
            ) : (
              <Badge>not set</Badge>
            )}
          </div>
          {owner ? (
            <form action={saveChannels} className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Paybill number</span>
                  <input
                    name="paybill"
                    inputMode="numeric"
                    defaultValue={channels.paybill ?? ''}
                    placeholder="e.g. 400200"
                    className="input mt-1.5"
                  />
                </label>
                <label className="block">
                  <span className="label">Till number</span>
                  <input
                    name="till"
                    inputMode="numeric"
                    defaultValue={channels.till ?? ''}
                    placeholder="optional"
                    className="input mt-1.5"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="linksOnly"
                  defaultChecked={!!channels.linksOnly}
                  className="h-4 w-4 accent-ink-900"
                />
                No paybill or till yet: members pay by M-Pesa prompt and payment links only
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Settlement bank account</span>
                  <input
                    name="settlementBank"
                    defaultValue={channels.settlementBank ?? ''}
                    placeholder="e.g. KCB · account ending 4821"
                    className="input mt-1.5"
                  />
                </label>
                <label className="mt-6 flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    name="settlementConfirmed"
                    defaultChecked={!!channels.settlementConfirmed}
                    className="h-4 w-4 accent-ink-900"
                  />
                  Payment Gateway confirmed settlement to this account
                </label>
              </div>
              <p className="text-xs text-ink-500">
                Members pay to this number with their <b>member number</b> as the account. The Payment Gateway records
                the payment, and the doors update within a minute.
              </p>
              <SubmitButton pendingText="Saving…" className="btn-ghost w-full">
                Save payment channels
              </SubmitButton>
            </form>
          ) : (
            <p className="mt-6 text-sm text-ink-500">
              {channels.paybill
                ? `Paybill ${channels.paybill}`
                : channels.till
                  ? `Till ${channels.till}`
                  : 'Not set yet.'}
            </p>
          )}
        </section>
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <MessageSquare size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">SMS notifications</div>
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
          <Link
            href="/messages"
            className="mt-6 flex items-center justify-between rounded-xl bg-ink-50/60 p-3 text-sm hover:bg-ink-50"
          >
            <span>
              {notify.enabled ? 'SMS is on.' : 'SMS is off.'} Choose what members and staff receive, quiet hours, and
              send news
            </span>
            <span className="font-medium">Messages →</span>
          </Link>
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
      </div>
    </>
  );
}
