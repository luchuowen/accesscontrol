import { decrypt, platformSmsConfig, SourceCodeSms } from '@lango/server';
import { ArrowLeft, CreditCard, MessageSquare, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CopyField } from '@/components/copy-field';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader, Stat } from '@/components/ui';
import { kes } from '@/lib/format';
import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';
import { grantSms, saveClubSms, savePlatformSms, savePlatformTaifa, setPartnerActive } from '../actions';
import { AddPartnerForm } from './partner-form';

const MSG: Record<string, [string, string]> = {
  'sms-ok': ['green', 'SMS account saved.'],
  'sms-rejected': ['red', 'Source Code rejected that API key.'],
  'sms-unreachable': ['amber', 'Source Code did not answer in time; nothing was saved.'],
  'sms-missing': ['amber', 'Paste the API key from Source Code › Developers/API › Show API Key.'],
  'sms-price': ['red', 'Cost and price must be positive amounts.'],
  'taifa-ok': ['green', 'NAVAC TaifaPay account connected. Clubs can now buy SMS credit by M-Pesa.'],
  'taifa-rejected': ['red', 'TaifaPay rejected those keys.'],
  'taifa-unreachable': ['amber', 'TaifaPay did not answer in time; nothing was saved.'],
  'taifa-missing': ['amber', 'Enter both the client ID and the client secret.'],
  'club-ok': ['green', 'Club SMS settings saved. New messages use them straight away.'],
  'club-price': ['red', 'Price per SMS must be a positive amount, or blank for the default.'],
  'grant-ok': ['green', 'SMS units added to the club’s balance.'],
  'grant-invalid': ['red', 'Enter a whole number of units and a note.'],
  'partner-on': ['green', 'Login switched on.'],
  'partner-off': ['green', 'Login switched off.'],
  self: ['amber', 'You can’t switch off your own login.'],
};

export default async function SaasConsole({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requirePartner();
  const [plat] = await db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`;
  if (!plat?.ok) redirect('/partner');
  const { m } = await searchParams;
  const cfg = await platformSmsConfig(db());
  const [taifaRow] = await db()<
    { data: { env?: string; clientId?: string } | null }[]
  >`select app_platform_get('taifapay') as data`;
  const taifa = taifaRow?.data;
  let account: { ok: boolean; balance: string | null } | null = null;
  if (cfg?.apiKey) {
    try {
      account = await new SourceCodeSms(decrypt(cfg.apiKey), cfg.sender).profile();
    } catch {
      account = { ok: false, balance: null };
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
  const partners = await db()<{ id: string; name: string; email: string; partner: string; active: boolean }[]>`
    select * from app_platform_partners(${s.uid})`;
  const cost = cfg?.costKes ?? 0.5;
  const price = cfg?.priceKes ?? 1;
  const sold = clubs.reduce((a, c) => a + Number(c.sold_kes_30d), 0);
  const sent = clubs.reduce((a, c) => a + Number(c.sent_30d), 0);
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const msg = m ? MSG[m] : undefined;
  return (
    <>
      <Link href="/partner" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900">
        <ArrowLeft size={15} /> Clubs
      </Link>
      <PageHeader
        title="SaaS console"
        subtitle="NAVAC platform settings: SMS resale, NAVAC’s TaifaPay account and partner logins."
      />
      {msg && (
        <div
          className={`mb-6 rounded-xl p-3 text-sm ring-1 ${msg[0] === 'green' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : msg[0] === 'red' ? 'bg-rose-50 text-rose-800 ring-rose-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {msg[1]}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Source Code balance"
          value={account?.ok ? Number(account.balance ?? 0).toLocaleString('en-KE') : '—'}
          hint="SMS units NAVAC holds"
        />
        <Stat label="SMS sent · 30 days" value={sent.toLocaleString('en-KE')} hint="all clubs" />
        <Stat label="SMS sold · 30 days" value={kes(sold)} hint="top-ups paid to NAVAC" />
        <Stat
          label="Gross margin · 30 days"
          value={kes(Math.round(sold - sent * cost))}
          hint={`at ${kes(cost)} cost per SMS`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <MessageSquare size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">SMS · Source Code</div>
              <div className="text-xs text-ink-500">NAVAC’s reseller account; default sender and price</div>
            </div>
            {account?.ok ? (
              <Badge tone="green">connected</Badge>
            ) : cfg?.apiKey ? (
              <Badge tone="red">key not accepted</Badge>
            ) : (
              <Badge>not connected</Badge>
            )}
          </div>
          <form action={savePlatformSms} className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="label">Default sender</span>
                <input name="sender" defaultValue={cfg?.sender ?? 'NAVAC'} maxLength={11} className="input mt-1.5" />
              </label>
              <label className="block">
                <span className="label">Our cost / SMS</span>
                <input name="costKes" defaultValue={cost} inputMode="decimal" className="input mt-1.5" />
              </label>
              <label className="block">
                <span className="label">Default price / SMS</span>
                <input name="priceKes" defaultValue={price} inputMode="decimal" className="input mt-1.5" />
              </label>
            </div>
            <label className="block">
              <span className="label">API key</span>
              <input
                name="apiKey"
                type="password"
                autoComplete="off"
                placeholder={
                  cfg?.apiKey ? '•••••••• · stored, enter to replace' : 'Source Code › Developers/API › Show API Key'
                }
                className="input mt-1.5"
              />
            </label>
            <SubmitButton pendingText="Checking with Source Code…" className="btn-primary w-full">
              Verify &amp; save
            </SubmitButton>
          </form>
        </section>

        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <CreditCard size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">NAVAC TaifaPay account</div>
              <div className="text-xs text-ink-500">Clubs pay for SMS credit here by M-Pesa</div>
            </div>
            {taifa?.clientId ? <Badge tone="green">{taifa.env}</Badge> : <Badge>not connected</Badge>}
          </div>
          <form action={savePlatformTaifa} className="mt-6 space-y-4">
            <label className="block">
              <span className="label">Environment</span>
              <select name="env" defaultValue={taifa?.env ?? 'live'} className="input mt-1.5">
                <option value="live">Live</option>
                <option value="sandbox">Sandbox (testing)</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Client ID</span>
              <input
                name="clientId"
                type="password"
                autoComplete="off"
                placeholder={
                  taifa?.clientId
                    ? `••••${taifa.clientId.slice(-4)} · stored, enter to replace`
                    : 'TaifaPay › API Integration'
                }
                className="input mt-1.5"
              />
            </label>
            <label className="block">
              <span className="label">Client secret</span>
              <input name="clientSecret" type="password" autoComplete="new-password" className="input mt-1.5" />
            </label>
            <div>
              <span className="label">Deposit webhook URL</span>
              <div className="mt-1.5">
                <CopyField value={`${base}/api/webhooks/taifapay-platform`} label="Deposit webhook URL" />
              </div>
            </div>
            <SubmitButton pendingText="Checking the keys with TaifaPay…" className="btn-primary w-full">
              Verify &amp; save
            </SubmitButton>
          </form>
        </section>
      </div>

      <section className="card mt-6 overflow-hidden">
        <div className="p-6 pb-2">
          <div className="font-medium">Clubs · SMS</div>
          <div className="text-xs text-ink-500">
            Sender ID and price per club (blank = {cfg?.sender ?? 'NAVAC'} at {kes(price)}). The sender must already be
            registered under NAVAC on Source Code.
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-ink-50/60 text-left">
            <tr>
              {['Club', 'Sender & price', 'Balance', 'Sent · 30 d', 'Sold · 30 d', 'Add units'].map((h) => (
                <th key={h} className="label px-5 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {clubs.map((c) => (
              <tr key={c.tenant_id}>
                <td className="px-5 py-3">
                  <div className="font-medium">{c.name}</div>
                  <div className="font-mono text-[11px] text-ink-500">{c.slug}</div>
                </td>
                <td className="px-5 py-3">
                  <form action={saveClubSms} className="flex items-center gap-2">
                    <input type="hidden" name="tenantId" value={c.tenant_id} />
                    <input
                      name="sender"
                      defaultValue={c.sender ?? ''}
                      placeholder={cfg?.sender ?? 'NAVAC'}
                      maxLength={11}
                      className="input w-28 py-1.5 font-mono text-xs"
                    />
                    <input
                      name="priceKes"
                      defaultValue={c.price_kes ?? ''}
                      placeholder={String(price)}
                      inputMode="decimal"
                      className="input w-20 py-1.5 text-xs"
                    />
                    <SubmitButton pendingText="…" className="btn-ghost px-3 py-1.5 text-xs">
                      Save
                    </SubmitButton>
                  </form>
                </td>
                <td className="px-5 py-3 tabular-nums">{Number(c.balance).toLocaleString('en-KE')}</td>
                <td className="px-5 py-3 tabular-nums text-ink-500">{Number(c.sent_30d).toLocaleString('en-KE')}</td>
                <td className="px-5 py-3 tabular-nums">{kes(Number(c.sold_kes_30d))}</td>
                <td className="px-5 py-3">
                  <form action={grantSms} className="flex items-center gap-2">
                    <input type="hidden" name="tenantId" value={c.tenant_id} />
                    <input
                      name="units"
                      type="number"
                      required
                      placeholder="units"
                      className="input w-20 py-1.5 text-xs"
                    />
                    <input
                      name="note"
                      required
                      placeholder="note, e.g. starter credit"
                      className="input w-40 py-1.5 text-xs"
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
      </section>

      <section className="card mt-6 p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
            <UsersRound size={18} />
          </div>
          <div className="flex-1">
            <div className="font-medium">Partner logins</div>
            <div className="text-xs text-ink-500">
              NAVAC admins see every club; installer partners see only their own clubs
            </div>
          </div>
        </div>
        <ul className="mt-4 divide-y divide-ink-100 text-sm">
          {partners.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1">
                <div className={p.active ? '' : 'text-ink-300'}>{p.name}</div>
                <div className="text-xs text-ink-500">
                  {p.email} · {p.partner}
                </div>
              </div>
              <Badge tone={p.active ? 'green' : 'gray'}>{p.active ? 'active' : 'off'}</Badge>
              {p.id !== s.uid && (
                <form action={setPartnerActive}>
                  <input type="hidden" name="staffId" value={p.id} />
                  <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
                  <button type="submit" className="text-xs text-ink-500 hover:text-ink-900">
                    {p.active ? 'Switch off' : 'Switch on'}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <AddPartnerForm />
      </section>
    </>
  );
}
