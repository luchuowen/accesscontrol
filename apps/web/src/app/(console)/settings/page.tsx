import { withTenant } from '@lango/db';
import { clubSms, onboardingChecklist, platformSmsConfig } from '@lango/server';
import { CheckCircle2, CreditCard, KeyRound, MessageSquare, Smartphone, UsersRound } from 'lucide-react';
import { headers } from 'next/headers';
import { Checklist } from '@/components/checklist';
import { CopyField } from '@/components/copy-field';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';
import {
  buySms,
  changePassword,
  saveChannels,
  saveNotifications,
  saveTaifaPay,
  sendTestSms,
  setStaffActive,
} from './actions';
import { AddStaffForm } from './team-form';

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ taifa?: string; ch?: string; team?: string; pw?: string; sms?: string }>;
}) {
  const s = await requireSession();
  const { taifa, ch, team, pw, sms } = await searchParams;
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
    (tx) => tx<{ id: string; created_at: Date; amount_kes: number; units: number; status: string; trigger: string }[]>`
      select id, created_at, amount_kes, units, status, trigger from sms_topups order by created_at desc limit 5`,
  );
  const recentSms = await withTenant(
    db(),
    s.tid,
    (tx) => tx<{ id: string; created_at: Date; kind: string; body: string; status: string; error: string | null }[]>`
      select id, created_at, kind, body, status, error from sms_messages order by created_at desc limit 8`,
  );
  const checklist = await onboardingChecklist(db(), s.tid);
  const staff = await withTenant(
    db(),
    s.tid,
    (tx) => tx<{ id: string; name: string; email: string; role: string; active: boolean }[]>`
      select id, name, email, role, active from app_tenant_staff()`,
  );
  const msg: Record<string, [string, string]> = {
    ok: ['green', 'TaifaPay connected — the keys were verified and stored encrypted.'],
    rejected: ['red', 'TaifaPay rejected those keys. Check the environment (sandbox / live) and try again.'],
    missing: ['amber', 'Enter both the client ID and the client secret.'],
    unreachable: ['amber', 'TaifaPay did not answer in time, so nothing was saved. Try again in a minute.'],
    forbidden: ['red', 'Only the club owner can change this.'],
  };
  const other: Record<string, [string, string]> = {
    'ch:ok': ['green', 'Payment channels saved. Members now see these details on the portal and receipts.'],
    'ch:number': ['red', 'Paybill and till numbers are 5 to 7 digits.'],
    'ch:forbidden': ['red', 'Only the club owner can change this.'],
    'team:ok': ['green', 'Team updated.'],
    'team:self': ['amber', 'You can’t deactivate your own account.'],
    'team:forbidden': ['red', 'Only the club owner can change the team.'],
    'pw:ok': ['green', 'Password changed.'],
    'pw:short': ['red', 'Use at least 10 characters.'],
    'pw:wrong': ['red', 'Your current password is not right.'],
    'sms:saved': ['green', 'SMS settings saved.'],
    'sms:forbidden': ['red', 'Only the club owner can change this.'],
    'sms:number': ['red', 'Enter a Kenyan mobile number, e.g. 0712 345 678.'],
    'sms:wait': ['amber', 'A few test messages were just sent. Wait a few minutes.'],
    'sms:platform': ['amber', 'SMS is not connected on the platform yet. Ask NAVAC to connect it.'],
    'sms:test-sent': ['green', 'Test SMS sent. It should arrive within a minute.'],
    'sms:test-failed': ['red', 'The test SMS was not accepted. See the list below for the reason.'],
    'sms:alert-phone': ['red', 'Automatic top-up needs an alert phone for the M-Pesa prompt.'],
    'sms:topup-sent': ['green', 'M-Pesa prompt sent. The SMS credit is added as soon as the payment is confirmed.'],
    'sms:topup-phone': ['red', 'Enter a Kenyan mobile number for the M-Pesa prompt.'],
    'sms:topup-amount': ['red', 'Enter an amount of at least KES 10 that buys at least one SMS.'],
    'sms:topup-no-platform-taifapay': ['amber', 'SMS credit sales are not switched on yet. Ask NAVAC.'],
    'sms:topup-failed': ['red', 'M-Pesa could not be reached just now. Try again in a minute.'],
  };
  const m = taifa
    ? msg[taifa]
    : ch
      ? other[`ch:${ch}`]
      : team
        ? other[`team:${team}`]
        : pw
          ? other[`pw:${pw}`]
          : sms
            ? other[`sms:${sms}`]
            : undefined;
  const owner = s.role === 'owner';
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Payments, how members pay, and the club's team. Every payment runs through TaifaPay and settles to the club's bank."
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
              <div className="font-medium">TaifaPay · M-Pesa &amp; cards</div>
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
                    tp ? `••••${tp.clientId.slice(-4)} · stored, enter to replace` : 'From TaifaPay › API Integration'
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
              <SubmitButton pendingText="Checking the keys with TaifaPay…" className="btn-primary w-full">
                Verify &amp; save
              </SubmitButton>
            </form>
          ) : (
            <p className="mt-6 text-sm text-ink-500">Only the club owner can change payment settings.</p>
          )}
        </section>
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <Smartphone size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">How members pay</div>
              <div className="text-xs text-ink-500">The club’s own paybill or till, linked on TaifaPay</div>
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
                  TaifaPay confirmed settlement to this account
                </label>
              </div>
              <p className="text-xs text-ink-500">
                Members pay to this number with their <b>member number</b> as the account. TaifaPay records the payment,
                and the doors update within a minute.
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
              <UsersRound size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">Team</div>
              <div className="text-xs text-ink-500">Who can sign in to this console</div>
            </div>
          </div>
          <ul className="mt-4 divide-y divide-ink-100 text-sm">
            {staff.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1">
                  <div className={p.active ? '' : 'text-ink-300 line-through'}>{p.name}</div>
                  <div className="text-xs text-ink-500">{p.email}</div>
                </div>
                <Badge>{p.role}</Badge>
                {owner && p.id !== s.uid && (
                  <form action={setStaffActive}>
                    <input type="hidden" name="staffId" value={p.id} />
                    <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
                    <button type="submit" className="text-xs text-ink-500 hover:text-ink-900">
                      {p.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {owner && <AddStaffForm />}
        </section>
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <MessageSquare size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">SMS notifications</div>
              <div className="text-xs text-ink-500">
                Sent as {smsSender ?? 'NAVAC'} through Source Code · receipts, expiry reminders, welcome
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
          {['owner', 'manager', 'accountant'].includes(s.role) && (
            <form action={buySms} className="mt-3 flex flex-wrap gap-2">
              <input
                name="amountKes"
                inputMode="numeric"
                required
                defaultValue={1000}
                className="input w-28 py-2"
                aria-label="Amount (KES)"
              />
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
                <li key={t.id} className="flex gap-3 py-1">
                  <span className="w-24 shrink-0">{dateTime(t.created_at)}</span>
                  <span className="flex-1">
                    {kes(t.amount_kes)} → {t.units.toLocaleString('en-KE')} SMS
                    {t.trigger === 'auto' ? ' · automatic' : ''}
                  </span>
                  <Badge tone={t.status === 'completed' ? 'green' : t.status === 'pending' ? 'blue' : 'gray'}>
                    {t.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {owner ? (
            <form action={saveNotifications} className="mt-6 space-y-3 text-sm">
              <label className="flex items-center gap-2.5 font-medium">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={!!notify.enabled}
                  className="h-4 w-4 accent-ink-900"
                />
                Send SMS to members
              </label>
              <div className="space-y-2.5 rounded-xl bg-ink-50/60 p-3">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    name="receipts"
                    defaultChecked={notify.receipts !== false}
                    className="h-4 w-4 accent-ink-900"
                  />
                  Payment receipt with the new end date
                </label>
                <label className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="checkbox"
                    name="reminders"
                    defaultChecked={notify.reminders !== false}
                    className="h-4 w-4 accent-ink-900"
                  />
                  Renewal reminder
                  <input
                    name="reminderDays"
                    type="number"
                    min={1}
                    max={14}
                    defaultValue={notify.reminderDays ?? 3}
                    className="input w-16 py-1"
                  />
                  days before, and on the last day
                </label>
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    name="welcome"
                    defaultChecked={!!notify.welcome}
                    className="h-4 w-4 accent-ink-900"
                  />
                  Welcome message with the member number (new members only)
                </label>
              </div>
              <div className="space-y-2.5 rounded-xl bg-ink-50/60 p-3">
                <label className="flex flex-wrap items-center gap-2.5">
                  Alert me when the balance falls below
                  <input
                    name="lowBalance"
                    type="number"
                    min={0}
                    defaultValue={notify.lowBalance ?? 100}
                    className="input w-24 py-1"
                  />
                  SMS
                </label>
                <label className="flex flex-wrap items-center gap-2.5">
                  Alert phone
                  <input
                    name="alertPhone"
                    inputMode="tel"
                    defaultValue={notify.alertPhone ?? ''}
                    placeholder="07…"
                    className="input w-40 py-1"
                  />
                </label>
                <label className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="checkbox"
                    name="autoTopup"
                    defaultChecked={!!notify.autoTopup}
                    className="h-4 w-4 accent-ink-900"
                  />
                  Top up automatically: M-Pesa prompt for KES
                  <input
                    name="autoTopupKes"
                    type="number"
                    min={100}
                    step={100}
                    defaultValue={notify.autoTopupKes ?? 1000}
                    className="input w-24 py-1"
                  />
                  to the alert phone
                </label>
              </div>
              <SubmitButton pendingText="Saving…" className="btn-ghost w-full">
                Save SMS settings
              </SubmitButton>
            </form>
          ) : (
            <p className="mt-6 text-sm text-ink-500">SMS is {notify.enabled ? 'on' : 'off'} for this club.</p>
          )}
          {smsSender && ['owner', 'manager'].includes(s.role) && (
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
          {recentSms.length > 0 && (
            <ul className="mt-4 divide-y divide-ink-100 border-t border-ink-100 text-xs">
              {recentSms.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2">
                  <span className="w-24 shrink-0 text-ink-500">{dateTime(m.created_at)}</span>
                  <span className="w-16 shrink-0 capitalize text-ink-500">{m.kind}</span>
                  <span className="flex-1 truncate" title={m.error ?? m.body}>
                    {m.body}
                  </span>
                  <Badge
                    tone={
                      m.status === 'sent'
                        ? 'green'
                        : m.status === 'failed'
                          ? 'red'
                          : m.status === 'queued'
                            ? 'blue'
                            : 'gray'
                    }
                  >
                    {m.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <KeyRound size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">Your password</div>
              <div className="text-xs text-ink-500">Change the one-time password you were given</div>
            </div>
          </div>
          <form action={changePassword} className="mt-6 space-y-3">
            <input
              name="current"
              type="password"
              required
              placeholder="Current password"
              autoComplete="current-password"
              className="input"
            />
            <input
              name="next"
              type="password"
              required
              minLength={10}
              placeholder="New password (10+ characters)"
              autoComplete="new-password"
              className="input"
            />
            <SubmitButton pendingText="Saving…" className="btn-ghost w-full">
              Change password
            </SubmitButton>
          </form>
        </section>
      </div>
    </>
  );
}
