import { decrypt, platformBilling, platformEmailConfig, platformSmsConfig, SourceCodeSms } from '@lango/server';
import { redirect } from 'next/navigation';
import { MoneyInput } from '@/components/money-input';
import { SubmitButton } from '@/components/submit-button';
import { Badge } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';
import {
  grantSms,
  saveClubSms,
  savePlatformAlerts,
  savePlatformBilling,
  savePlatformEmail,
  savePlatformSms,
  savePlatformTaifa,
  sendPlatformTestEmail,
} from '../actions';
import { type Section, SectionNav } from './section-nav';

const MSG: Record<string, [string, string]> = {
  'email-ok': ['green', 'Email account saved. Send a test to check delivery.'],
  'email-key': ['red', 'A Resend API key starts with re_. Copy it again from Resend › API keys.'],
  'email-rejected': ['red', 'Resend did not accept that key.'],
  'email-unreachable': ['amber', 'Resend did not answer in time; nothing was saved. Try again.'],
  'email-domain': ['red', 'That sending address is not on a domain in this Resend account.'],
  'email-from': ['red', 'Enter a full sending address, e.g. lango@navac.co.ke.'],
  'email-reply': ['red', 'Enter a full reply-to address, or leave it blank.'],
  'email-secret': ['red', 'A Resend webhook signing secret starts with whsec_.'],
  'email-inbound': ['red', 'Enter a domain like reply.lango.co.ke, and a key that starts with re_.'],
  'email-missing': ['amber', 'Paste the API key from Resend › API keys.'],
  'email-test-sent': ['green', 'Test email sent to your address. It should arrive within a minute.'],
  'email-test-failed': ['red', 'The test email was not sent. The reason is in the list below.'],
  'sms-ok': ['green', 'SMS account saved.'],
  'sms-rejected': ['red', 'Source Code rejected that API key.'],
  'sms-unreachable': ['amber', 'Source Code did not answer in time; nothing was saved.'],
  'sms-missing': ['amber', 'Paste the API key from Source Code › Developers/API › Show API Key.'],
  'sms-price': ['red', 'Cost and price must be positive amounts.'],
  'taifa-ok': ['green', 'NAVAC Payment Gateway connected. Clubs can now buy SMS credit by M-Pesa.'],
  'taifa-rejected': ['red', 'The Payment Gateway rejected those keys.'],
  'taifa-unreachable': ['amber', 'The Payment Gateway did not answer in time; nothing was saved.'],
  'taifa-missing': ['amber', 'Enter both the client ID and the client secret.'],
  'billing-ok': ['green', 'Billing details saved. Every SMS invoice and receipt shows them.'],
  'billing-name': ['red', 'Enter the business name.'],
  'alerts-ok': ['green', 'Alerts saved.'],
  'alerts-phone': ['red', 'Enter a Kenyan mobile number, e.g. 0712 345 678.'],
  'alerts-sms': ['amber', 'Connect the SMS account first.'],
  'club-ok': ['green', 'Club SMS settings saved. New messages use them straight away.'],
  'club-price': ['red', 'Price per SMS must be a positive amount, or blank for the default.'],
  'grant-ok': ['green', 'SMS units added to the club’s balance.'],
  'grant-invalid': ['red', 'Enter a whole number of units and a note.'],
};
const SECTION_OF: Record<string, string> = {
  email: 'email',
  sms: 'sms',
  taifa: 'payments',
  billing: 'billing',
  alerts: 'alerts',
  club: 'pricing',
  grant: 'pricing',
};

const label = 'mb-1.5 block text-[11px] font-medium text-ink-500';
const input = 'input py-2';

function Head({ title, desc, badge }: { title: string; desc: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[13px] text-ink-500">{desc}</p>
      </div>
      {badge}
    </div>
  );
}

function Status({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return ok ? (
    <Badge tone="green">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {on}
    </Badge>
  ) : (
    <Badge tone="amber">{off}</Badge>
  );
}

export default async function PlatformSettings({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requirePartner();
  const [plat] = await db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`;
  if (!plat?.ok) redirect('/partner');
  const { m } = await searchParams;
  const cfg = await platformSmsConfig(db());
  const [taifaRow] = await db()<
    { data: { env?: string; clientId?: string } | null }[]
  >`select app_platform_get('taifapay') as data`;
  const taifa = taifaRow?.data;
  const billing = await platformBilling(db());
  const emailCfg = await platformEmailConfig(db());
  const emailFrom = emailCfg?.from.match(/^(.*?)\s*<([^>]+)>$/);
  const recentEmail = await db()<
    { id: string; created_at: Date; to_email: string; subject: string; status: string; error: string | null }[]
  >`select id, created_at, to_email, subject, status, error from email_messages order by created_at desc limit 8`;
  const [billingRow] = await db()<{ data: unknown }[]>`select app_platform_get('billing') as data`;
  const [statusRow] = await db()<{ data: { balance?: number; at?: string } | null }[]>`
    select app_platform_get('sms_status') as data`;
  const lastCredit = statusRow?.data;
  let keyOk = false;
  if (cfg?.apiKey) {
    try {
      keyOk = (await new SourceCodeSms(decrypt(cfg.apiKey), cfg.sender).profile()).ok;
    } catch {
      keyOk = false;
    }
  }
  const clubs = await db()<
    {
      tenant_id: string;
      name: string;
      slug: string;
      sender: string | null;
      price_kes: string | null;
      balance: string;
      sent_30d: string;
      sold_kes_30d: string;
    }[]
  >`select * from app_platform_sms_clubs(${s.uid})`;
  const cost = cfg?.costKes ?? 0.5;
  const price = cfg?.priceKes ?? 1;
  const sold = clubs.reduce((a, c) => a + Number(c.sold_kes_30d), 0);
  const sent = clubs.reduce((a, c) => a + Number(c.sent_30d), 0);
  const msg = m ? MSG[m] : undefined;
  const msgAt = m ? SECTION_OF[m.split('-')[0] ?? ''] : undefined;
  const Notice = ({ id }: { id: string }) =>
    msg && msgAt === id ? (
      <div
        className={`mt-4 rounded-lg p-3 text-[13px] ring-1 ${msg[0] === 'green' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : msg[0] === 'red' ? 'bg-rose-50 text-rose-800 ring-rose-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
      >
        {msg[1]}
      </div>
    ) : null;
  const sections: Section[] = [
    { id: 'email', label: 'Email', state: emailCfg ? 'done' : 'todo' },
    { id: 'sms', label: 'SMS account', state: keyOk ? 'done' : 'todo' },
    { id: 'payments', label: 'SMS payments', state: taifa?.clientId ? 'done' : 'todo' },
    { id: 'billing', label: 'Billing details', state: billingRow?.data ? 'done' : 'todo' },
    { id: 'alerts', label: 'Alerts', state: cfg?.alertPhone ? 'done' : 'todo' },
    { id: 'pricing', label: 'Club pricing', state: 'none' },
  ];
  const sec = 'scroll-mt-8 border-t border-[#EEF1F5] p-6 first:border-t-0';
  return (
    <>
      <h1 className="text-[22px] font-semibold tracking-tight lg:sr-only">Platform settings</h1>
      <p className="mt-1 text-[13px] text-ink-500 lg:mt-0">
        How Lango sends SMS, takes payment for SMS credit, and bills clubs. Last 30 days: {sent.toLocaleString('en-KE')}{' '}
        SMS sent · {kes(sold)} sold · {kes(Math.round(sold - sent * cost))} margin.
      </p>
      <div className="mt-6 grid gap-7 lg:grid-cols-[200px_1fr]">
        <div className="hidden lg:block">
          <SectionNav sections={sections} focus={msgAt} />
        </div>
        <div className="min-w-0 rounded-[10px] border border-[#E4E8EF] bg-white">
          <section id="email" className={sec}>
            <Head
              title="Email"
              desc="NAVAC's Resend account sends every Lango email: invitations, password resets, receipts, invoices and alerts."
              badge={<Status ok={!!emailCfg} on="Connected" off="Not connected" />}
            />
            <Notice id="email" />
            {emailCfg && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-[#F8FAFC] px-4 py-3 text-[13px]">
                <span className="min-w-0 flex-1">
                  Sending as <b>{emailCfg.from}</b>
                  {emailCfg.replyTo ? <> · replies to {emailCfg.replyTo}</> : null}
                  {emailCfg.inboundDomain ? <> · club replies arrive at *@{emailCfg.inboundDomain}</> : null}
                </span>
                <form action={sendPlatformTestEmail}>
                  <SubmitButton pendingText="Sending…" className="btn-primary py-2">
                    Send test email to me
                  </SubmitButton>
                </form>
              </div>
            )}
            <details
              className="group mt-3"
              open={!emailCfg || (!!m && m.startsWith('email-') && !['email-ok', 'email-test-sent'].includes(m))}
            >
              <summary className="cursor-pointer text-[13px] font-medium text-ink-700 hover:text-ink-900">
                {emailCfg ? 'Change key or sending address' : 'Connect Resend'}
              </summary>
              <form action={savePlatformEmail} className="mt-4 space-y-4">
                <label className="block">
                  <span className={label}>Resend API key</span>
                  <input
                    name="apiKey"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      emailCfg
                        ? '•••••••• stored · paste a new key to replace'
                        : 'Resend › API keys › Create API key (sending access)'
                    }
                    className={input}
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label>
                    <span className={label}>Sender name</span>
                    <input name="fromName" defaultValue={emailFrom?.[1] || 'Lango'} className={input} />
                  </label>
                  <label>
                    <span className={label}>Sending address</span>
                    <input
                      name="fromAddress"
                      type="email"
                      required
                      defaultValue={emailFrom?.[2] || 'lango@navac.co.ke'}
                      className={input}
                    />
                  </label>
                  <label>
                    <span className={label}>Replies go to</span>
                    <input
                      name="replyTo"
                      type="email"
                      defaultValue={emailCfg?.replyTo ?? 'support@navac.co.ke'}
                      className={input}
                    />
                  </label>
                </div>
                <label className="block">
                  <span className={label}>Webhook signing secret (optional, for delivery tracking)</span>
                  <input
                    name="webhookSecret"
                    type="password"
                    autoComplete="off"
                    placeholder={emailCfg?.webhookSecret ? '•••••••• stored' : 'whsec_… from Resend › Webhooks'}
                    className={input}
                  />
                </label>
                <fieldset className="rounded-lg border border-[#E4E8EF] p-4">
                  <legend className="px-1 text-[12px] font-semibold text-ink-700">Receiving replies (optional)</legend>
                  <p className="mb-3 text-[12px] text-ink-500">
                    Members’ replies to club emails go to <b>&lt;club code&gt;@this domain</b> and appear in the club’s
                    Communications inbox. In Resend › Domains, add the domain with receiving on (MX records), and
                    subscribe the webhook above to <b>email.received</b>. Reading a received email needs a{' '}
                    <b>full-access</b> key; it is kept apart from the sending key and used for nothing else.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label>
                      <span className={label}>Receiving domain</span>
                      <input
                        name="inboundDomain"
                        defaultValue={emailCfg?.inboundDomain ?? ''}
                        placeholder="e.g. reply.lango.co.ke"
                        className={input}
                      />
                    </label>
                    <label>
                      <span className={label}>Full-access key for reading replies</span>
                      <input
                        name="inboundKey"
                        type="password"
                        autoComplete="off"
                        placeholder={emailCfg?.inboundKey ? '•••••••• stored' : 're_… (full access)'}
                        className={input}
                      />
                    </label>
                  </div>
                </fieldset>
                <div className="flex justify-end">
                  <SubmitButton pendingText="Checking with Resend…" className="btn-primary">
                    Verify &amp; save
                  </SubmitButton>
                </div>
              </form>
            </details>
            {recentEmail.length > 0 && (
              <ul className="mt-4 divide-y divide-[#F0F2F6] rounded-lg border border-[#E4E8EF] text-xs">
                {recentEmail.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-24 shrink-0 text-ink-500">{dateTime(e.created_at)}</span>
                    <span className="min-w-0 flex-1 truncate" title={e.error ?? e.subject}>
                      {e.subject} · {e.to_email}
                      {e.error && <span className="block truncate text-rose-700">{e.error}</span>}
                    </span>
                    <Badge
                      tone={
                        ['sent', 'delivered'].includes(e.status)
                          ? 'green'
                          : ['failed', 'bounced', 'complained'].includes(e.status)
                            ? 'red'
                            : 'gray'
                      }
                    >
                      {e.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section id="sms" className={sec}>
            <Head
              title="SMS account"
              desc="NAVAC’s Source Code reseller account. Clubs send under their own sender ID, registered under NAVAC."
              badge={<Status ok={keyOk} on="Connected" off={cfg?.apiKey ? 'Key not accepted' : 'Not connected'} />}
            />
            <Notice id="sms" />
            <form action={savePlatformSms} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <label>
                  <span className={label}>Default sender</span>
                  <input name="sender" defaultValue={cfg?.sender ?? 'NAVAC'} maxLength={11} className={input} />
                </label>
                <label>
                  <span className={label}>Our cost per SMS (KES)</span>
                  <input name="costKes" defaultValue={cost} inputMode="decimal" className={input} />
                </label>
                <label>
                  <span className={label}>Default price per SMS (KES)</span>
                  <input name="priceKes" defaultValue={price} inputMode="decimal" className={input} />
                </label>
              </div>
              <label className="block">
                <span className={label}>API key</span>
                <input
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    cfg?.apiKey
                      ? '•••••••• stored · paste a new key to replace'
                      : 'Source Code › Developers/API › Show API Key'
                  }
                  className={input}
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] text-ink-500">
                  {lastCredit?.balance != null
                    ? `Source Code credit after the last send: ${lastCredit.balance.toLocaleString('en-KE')}${lastCredit.at ? ` · ${dateTime(new Date(lastCredit.at))}` : ''}`
                    : 'Source Code credit shows here after the first message is sent.'}
                </span>
                <SubmitButton pendingText="Checking with Source Code…" className="btn-primary ml-auto">
                  Verify &amp; save
                </SubmitButton>
              </div>
            </form>
          </section>

          <section id="payments" className={sec}>
            <Head
              title="SMS payments"
              desc={
                <>
                  Clubs pay for SMS credit into NAVAC’s Payment Gateway merchant. Each payment shows as “Lango SMS
                  ‹club›” with the invoice number (LSMS-…) as the account reference.
                </>
              }
              badge={
                <Status ok={!!taifa?.clientId} on={taifa?.env === 'sandbox' ? 'Sandbox' : 'Live'} off="Not connected" />
              }
            />
            <Notice id="payments" />
            <form action={savePlatformTaifa} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-[140px_1fr_1fr]">
                <label>
                  <span className={label}>Environment</span>
                  <select name="env" defaultValue={taifa?.env ?? 'live'} className={input}>
                    <option value="live">Live</option>
                    <option value="sandbox">Sandbox</option>
                  </select>
                </label>
                <label>
                  <span className={label}>Client ID</span>
                  <input
                    name="clientId"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      taifa?.clientId
                        ? `••••${taifa.clientId.slice(-4)} stored`
                        : 'Payment Gateway › Merchant › Integrations'
                    }
                    className={input}
                  />
                </label>
                <label>
                  <span className={label}>Client secret</span>
                  <input
                    name="clientSecret"
                    type="password"
                    autoComplete="new-password"
                    placeholder={taifa?.clientId ? 'stored' : ''}
                    className={input}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] text-ink-500">
                  Use a credential made for Lango. Leave the merchant’s webhook as it is: Lango checks its payments
                  every minute.
                </span>
                <SubmitButton pendingText="Checking the keys with the Payment Gateway…" className="btn-primary ml-auto">
                  Verify &amp; save
                </SubmitButton>
              </div>
            </form>
          </section>

          <section id="billing" className={sec}>
            <Head
              title="Billing details"
              desc="Printed on every SMS invoice and receipt clubs see in their console."
              badge={<Status ok={!!billingRow?.data} on="Set" off="Not set" />}
            />
            <Notice id="billing" />
            <form action={savePlatformBilling} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className={label}>Business name</span>
                  <input name="name" required defaultValue={billing.name} className={input} />
                </label>
                <label>
                  <span className={label}>KRA PIN</span>
                  <input name="pin" defaultValue={billing.pin ?? ''} className={input} />
                </label>
                <label className="sm:col-span-2">
                  <span className={label}>Address</span>
                  <input name="address" defaultValue={billing.address ?? ''} className={input} />
                </label>
                <label>
                  <span className={label}>Email</span>
                  <input name="email" type="email" defaultValue={billing.email ?? ''} className={input} />
                </label>
                <label>
                  <span className={label}>Phone</span>
                  <input name="phone" inputMode="tel" defaultValue={billing.phone ?? ''} className={input} />
                </label>
              </div>
              <div className="flex justify-end">
                <SubmitButton pendingText="Saving…" className="btn-primary">
                  Save billing details
                </SubmitButton>
              </div>
            </form>
          </section>

          <section id="alerts" className={sec}>
            <Head
              title="Alerts"
              desc="NAVAC is told when Source Code credit runs low, and each morning which club door PCs have been offline for over an hour. Nothing is sent between 20:00 and 08:00."
              badge={<Status ok={!!cfg?.alertPhone} on="On" off="No phone" />}
            />
            <Notice id="alerts" />
            <form action={savePlatformAlerts} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className={label}>NAVAC alert phone</span>
                  <input
                    name="alertPhone"
                    inputMode="tel"
                    defaultValue={cfg?.alertPhone ? cfg.alertPhone.replace(/^254/, '0') : ''}
                    placeholder="07…"
                    className={input}
                  />
                </label>
                <label>
                  <span className={label}>Warn when Source Code credit is below</span>
                  <MoneyInput
                    name="lowCredit"
                    defaultValue={cfg?.lowCredit}
                    placeholder="e.g. 2,000"
                    className="h-11"
                  />
                </label>
              </div>
              <div className="flex justify-end">
                <SubmitButton pendingText="Saving…" className="btn-primary">
                  Save alerts
                </SubmitButton>
              </div>
            </form>
          </section>

          <section id="pricing" className={`${sec} px-0 pb-0`}>
            <div className="px-6">
              <Head
                title="Club pricing"
                desc={
                  <>
                    Sender ID and price per club. Blank uses {cfg?.sender ?? 'NAVAC'} at {kes(price)} per SMS. A sender
                    must already be registered under NAVAC on Source Code.
                  </>
                }
              />
              <Notice id="pricing" />
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-y border-[#E4E8EF] bg-[#FBFCFD] text-left text-[11px] text-ink-500">
                  <tr>
                    <th className="px-6 py-2.5 font-medium">Club</th>
                    <th className="px-3 py-2.5 font-medium">Sender &amp; price</th>
                    <th className="px-3 py-2.5 text-right font-medium">Balance</th>
                    <th className="px-3 py-2.5 text-right font-medium">Sent · 30 d</th>
                    <th className="px-3 py-2.5 text-right font-medium">Sold · 30 d</th>
                    <th className="px-6 py-2.5 font-medium">Add free SMS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F2F6]">
                  {clubs.map((c) => (
                    <tr key={c.tenant_id}>
                      <td className="px-6 py-3">
                        <div className="font-medium">{c.name}</div>
                        <div className="font-mono text-[11px] text-ink-500">{c.slug}</div>
                      </td>
                      <td className="px-3 py-3">
                        <form action={saveClubSms} className="flex items-center gap-2">
                          <input type="hidden" name="tenantId" value={c.tenant_id} />
                          <input
                            name="sender"
                            defaultValue={c.sender ?? ''}
                            placeholder={cfg?.sender ?? 'NAVAC'}
                            maxLength={11}
                            aria-label="Sender ID"
                            className="input w-28 py-1.5 font-mono text-xs"
                          />
                          <input
                            name="priceKes"
                            defaultValue={c.price_kes ?? ''}
                            placeholder={String(price)}
                            inputMode="decimal"
                            aria-label="Price per SMS"
                            className="input w-16 py-1.5 text-xs"
                          />
                          <SubmitButton pendingText="…" className="btn-ghost px-3 py-1.5 text-xs">
                            Save
                          </SubmitButton>
                        </form>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{Number(c.balance).toLocaleString('en-KE')}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-500">
                        {Number(c.sent_30d).toLocaleString('en-KE')}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{kes(Number(c.sold_kes_30d))}</td>
                      <td className="px-6 py-3">
                        <form action={grantSms} className="flex items-center gap-2">
                          <input type="hidden" name="tenantId" value={c.tenant_id} />
                          <input
                            name="units"
                            type="number"
                            required
                            placeholder="SMS"
                            aria-label="SMS units"
                            className="input w-20 py-1.5 text-xs"
                          />
                          <input
                            name="note"
                            required
                            placeholder="Reason, e.g. starter credit"
                            aria-label="Reason"
                            className="input w-44 py-1.5 text-xs"
                          />
                          <SubmitButton pendingText="…" className="btn-ghost px-3 py-1.5 text-xs">
                            Add
                          </SubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {clubs.length === 0 && <div className="p-8 text-center text-[13px] text-ink-500">No clubs yet.</div>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
