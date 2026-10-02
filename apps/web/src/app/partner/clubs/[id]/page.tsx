import { withTenant } from '@lango/db';
import { onboardingChecklist, platformEmailConfig, platformSmsConfig } from '@lango/server';
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  DoorOpen,
  Download,
  LayoutGrid,
  Mail,
  MessageCircle,
  MessageSquare,
  MonitorSmartphone,
  RefreshCw,
} from 'lucide-react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Checklist } from '@/components/checklist';
import { CopyField } from '@/components/copy-field';
import { SubmitButton } from '@/components/submit-button';
import { doorsBoard } from '@/lib/data';
import { ago, dateTime, kes } from '@/lib/format';
import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';
import {
  inviteOwner,
  navacSaveChannels,
  navacSaveGateway,
  partnerInventory,
  partnerPairCode,
  partnerSaveEmail,
  partnerSaveReaders,
  partnerSaveWhatsApp,
  resendOwnerInvite,
} from '../../actions';

/**
 * One club in the partner console (2 Oct 2026): its setup, the door PC and readers (the installer's job, done here
 * because partner logins never open a club's console), and the channels its Communications inbox uses.
 */
const NOTE: Record<string, [ok: boolean, text: string]> = {
  'readers-saved': [true, 'Readers saved. The doors follow within a minute.'],
  inventory: [true, 'Asked the door PC to read AxTraxNG again. Readers update on its next sync (about a minute).'],
  'pair-new': [true, 'New pairing code issued. Reinstall the Site Bridge on the new PC with it.'],
  'zone-invalid': [false, 'That area is no longer there.'],
  'wa-ok': [true, 'WhatsApp saved. Messages to the club’s number now land in its inbox.'],
  'wa-id': [false, 'Enter the Phone number ID from Meta › WhatsApp › API setup (digits only).'],
  'wa-both': [false, 'Enter both the access token and the app secret.'],
  'wa-rejected': [false, 'Meta did not accept that token for this phone number ID. Check both and try again.'],
  'email-ok': [true, 'Email saved.'],
  'gw-ok': [true, 'Payment Gateway connected. The keys were checked and stored encrypted.'],
  'gw-missing': [false, 'Enter both the client ID and the client secret.'],
  'gw-rejected': [false, 'The Payment Gateway rejected those keys. Check the environment and try again.'],
  'gw-unreachable': [false, 'The Payment Gateway did not answer, so nothing was saved. Try again in a minute.'],
  'ch-ok': [true, 'Payment details saved. The club sees them straight away.'],
  'ch-number': [false, 'Paybill and till numbers are 5 to 7 digits.'],
};

type Tab = 'overview' | 'pay' | 'doors' | 'comms';

export default async function PartnerClub({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; n?: string }>;
}) {
  const s = await requirePartner();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [club] = await db()<
    {
      id: string;
      slug: string;
      name: string;
      partner: string | null;
      members: number;
      active_members: number;
      via_taifapay: string;
      cash: string;
      unmatched: number;
      bridge_seen: Date | null;
      taifapay_env: string | null;
      paybill: string | null;
      till: string | null;
    }[]
  >`select c.id, c.slug, c.name, c.partner, st.members, st.active_members, st.via_taifapay, st.cash, st.unmatched,
           st.bridge_seen, st.taifapay_env, st.paybill, st.till
    from app_partner_clubs(${s.uid}) c join app_partner_stats(${s.uid}) st on st.tenant_id = c.id
    where c.id = ${id}`;
  if (!club) notFound();
  const tab: Tab = sp.tab === 'doors' || sp.tab === 'comms' || sp.tab === 'pay' ? sp.tab : 'overview';
  const installer = s.kind === 'partner_admin' || s.kind === 'partner_tech';
  const admin = s.kind === 'partner_admin';
  const note = sp.n ? NOTE[sp.n] : undefined;
  const [checklist, [owner]] = await Promise.all([
    onboardingChecklist(db(), id),
    db()<{ owner_name: string | null; owner_email: string | null; accepted: boolean }[]>`
      select owner_name, owner_email, accepted from app_partner_club_owners(${s.uid}) where tenant_id = ${id}`,
  ]);
  const done = checklist.filter((i) => i.done).length;
  const online = club.bridge_seen && Date.now() - club.bridge_seen.getTime() < 10 * 60_000;
  const tabLink = (k: Tab, label: string, I: typeof DoorOpen) => (
    <Link
      href={`/partner/clubs/${id}${k === 'overview' ? '' : `?tab=${k}`}`}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold ${tab === k ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}
    >
      <I size={15} /> {label}
    </Link>
  );
  const pill = (ok: boolean | null, text: string) => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${ok ? 'bg-emerald-50 text-emerald-700' : ok === null ? 'bg-slate-100 text-ink-500' : 'bg-amber-50 text-amber-800'}`}
    >
      <i
        className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : ok === null ? 'bg-ink-300' : 'bg-amber-500'}`}
      />
      {text}
    </span>
  );
  const card = 'rounded-2xl border border-[#E4E8EF] bg-white';
  return (
    <>
      <Link href="/partner" className="inline-flex items-center gap-1.5 text-[13px] text-ink-500 hover:text-ink-900">
        <ArrowLeft size={15} /> Clubs
      </Link>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-semibold tracking-tight">{club.name}</h1>
          <p className="mt-0.5 text-[13px] text-ink-500">
            <span className="font-mono">{club.slug}</span>
            {club.partner ? ` · ${club.partner}` : ''}
            {owner?.owner_name ? ` · owner ${owner.owner_name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pill(done === checklist.length, `Setup ${done}/${checklist.length}`)}
          {pill(!!club.taifapay_env, club.taifapay_env ? `Payments ${club.taifapay_env}` : 'Payments not connected')}
          {pill(
            online ? true : club.bridge_seen ? false : null,
            online
              ? 'Door PC online'
              : club.bridge_seen
                ? `Door PC seen ${ago(club.bridge_seen)}`
                : 'Door PC not installed',
          )}
        </div>
      </div>
      <div className="mt-5 inline-flex rounded-xl bg-[#EEF1F6] p-1">
        {tabLink('overview', 'Overview', LayoutGrid)}
        {tabLink('pay', 'Payments', CreditCard)}
        {installer && tabLink('doors', 'Doors', DoorOpen)}
        {tabLink('comms', 'Communications', MessageSquare)}
      </div>
      {note && (
        <div
          className={`mt-4 rounded-xl p-3 text-[13px] ring-1 ${note[0] ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {note[1]}
        </div>
      )}
      <div className="mt-5">
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                ['Active members', `${club.active_members}`, `of ${club.members} on record`],
                ['Payment Gateway · 30 d', kes(Number(club.via_taifapay)), 'fee-earning volume'],
                ['Cash · 30 d', kes(Number(club.cash)), 'recorded at the desk'],
                [
                  'To sort',
                  `${club.unmatched}`,
                  club.unmatched ? 'payments not matched to a member' : 'every payment matched',
                ],
              ].map(([k, v, h]) => (
                <div key={k} className="rounded-2xl border border-[#E4E8EF] bg-white px-4 py-3.5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{k}</div>
                  <div className="mt-1 truncate text-[22px] font-semibold tabular-nums">{v}</div>
                  <div className="mt-0.5 text-[12px] text-ink-500">{h}</div>
                </div>
              ))}
            </div>
            <Checklist items={checklist} audience="partner" />
            <section className={`${card} p-5`}>
              <h2 className="text-[14px] font-semibold">Club owner</h2>
              {owner?.owner_email ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-50 font-semibold">
                    {(owner.owner_name ?? '?').slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block">{owner.owner_name}</b>
                    <span className="text-ink-500">{owner.owner_email}</span>
                  </span>
                  {owner.accepted ? (
                    pill(true, 'Signed up')
                  ) : (
                    <>
                      {pill(false, 'Invited')}
                      {admin && (
                        <form action={resendOwnerInvite}>
                          <input type="hidden" name="tenantId" value={id} />
                          <SubmitButton pendingText="Sending…" className="btn-ghost px-3 py-1.5 text-[12.5px]">
                            Resend invitation
                          </SubmitButton>
                        </form>
                      )}
                    </>
                  )}
                </div>
              ) : admin ? (
                <form action={inviteOwner} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <input type="hidden" name="tenantId" value={id} />
                  <input name="name" required placeholder="Full name" className="input py-2" />
                  <input name="email" type="email" required placeholder="Email" className="input py-2" />
                  <input name="phone" type="tel" placeholder="Mobile (optional)" className="input py-2" />
                  <SubmitButton pendingText="Sending…" className="btn-primary py-2">
                    Send invitation
                  </SubmitButton>
                </form>
              ) : (
                <p className="mt-2 text-[13px] text-ink-500">No owner yet.</p>
              )}
            </section>
          </div>
        )}
        {tab === 'doors' && installer && <Doors tenantId={id} />}
        {tab === 'pay' && <Payments tenantId={id} uid={s.uid} />}
        {tab === 'comms' && <Comms tenantId={id} uid={s.uid} admin={admin} slug={club.slug} />}
      </div>
    </>
  );
}

async function Doors({ tenantId }: { tenantId: string }) {
  const d = await doorsBoard(tenantId);
  const host = (await headers()).get('host');
  const base = (process.env.PUBLIC_URL ?? `https://${host}`).replace(/\/$/, '');
  return (
    <div className="space-y-4">
      {d.sites.map((st) => {
        const b = d.bridges.find((x) => x.site_id === st.id);
        const known = d.readers[st.id] ?? [];
        // Readers read from AxTraxNG, plus any already linked that the last read did not list.
        const linked = d.zones.filter((z) => z.site_id === st.id).flatMap((z) => z.reader_ids);
        const readers = [
          ...known,
          ...[...new Set(linked)]
            .filter((id) => !known.some((r) => r.id === id))
            .map((id) => ({ id, name: `Reader ${id}` })),
        ];
        const zones = d.zones.filter((z) => z.site_id === st.id);
        const online = b?.last_seen_at && Date.now() - b.last_seen_at.getTime() < 10 * 60_000;
        return (
          <section key={st.id} className="rounded-2xl border border-[#E4E8EF] bg-white">
            <header className="flex flex-wrap items-center gap-3 border-b border-[#EEF1F6] px-5 py-3.5">
              <MonitorSmartphone size={17} className="text-ink-500" />
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-semibold">{st.name} · door PC</h2>
                <p className="text-[12px] text-ink-500">
                  {b?.last_seen_at
                    ? `${online ? 'Online' : 'Offline'} · last seen ${ago(b.last_seen_at)} · ${known.length} reader${known.length === 1 ? '' : 's'} read from AxTraxNG`
                    : 'Not installed yet'}
                </p>
              </div>
              {b?.last_seen_at && (
                <>
                  <form action={partnerInventory}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="siteId" value={st.id} />
                    <SubmitButton pendingText="Asking…" className="btn-ghost px-3 py-1.5 text-[12.5px]">
                      <RefreshCw size={13} /> Read AxTraxNG again
                    </SubmitButton>
                  </form>
                  <form action={partnerPairCode}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <SubmitButton pendingText="Issuing…" className="btn-ghost px-3 py-1.5 text-[12.5px]">
                      <Download size={13} /> New PC? New pairing code
                    </SubmitButton>
                  </form>
                </>
              )}
            </header>
            {b?.pair_code && (
              <div className="grid gap-3 border-b border-[#EEF1F6] bg-[#FAFBFC] px-5 py-4 md:grid-cols-2">
                <CopyField value={b.pair_code} label="Pairing code" />
                <CopyField value={`irm ${base}/bridge/install.ps1 | iex`} label="Install command" />
                <p className="text-[12px] text-ink-500 md:col-span-2">
                  On the AxTraxNG PC: open PowerShell as Administrator, paste the install command, then give the pairing
                  code and the AxTraxNG operator login (the login stays on that PC).
                </p>
              </div>
            )}
            <div className="divide-y divide-[#F0F2F6]">
              {zones.map((z) => (
                <form
                  key={z.id}
                  action={partnerSaveReaders}
                  className="grid gap-3 px-5 py-3.5 md:grid-cols-[180px_1fr_auto] md:items-center"
                >
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="zoneId" value={z.id} />
                  <div>
                    <b className="block text-[13.5px]">{z.name}</b>
                    <span className="text-[12px] text-ink-500">
                      {z.reader_ids.length
                        ? `${z.reader_ids.length} reader${z.reader_ids.length === 1 ? '' : 's'}`
                        : 'No reader yet'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {readers.length ? (
                      readers.map((r) => (
                        <label
                          key={r.id}
                          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#E5E8EE] px-2.5 py-1.5 text-[12.5px] has-[:checked]:border-emerald-300 has-[:checked]:bg-emerald-50"
                        >
                          <input
                            type="checkbox"
                            name="readers"
                            value={r.id}
                            defaultChecked={z.reader_ids.includes(r.id)}
                            className="h-3.5 w-3.5 accent-emerald-600"
                          />
                          {r.name} <span className="text-ink-300">#{r.id}</span>
                        </label>
                      ))
                    ) : (
                      <span className="text-[12.5px] text-ink-500">
                        Readers appear once the door PC is installed and has read AxTraxNG.
                      </span>
                    )}
                  </div>
                  {readers.length > 0 && (
                    <SubmitButton pendingText="Saving…" className="btn-ghost px-3 py-1.5 text-[12.5px]">
                      Save
                    </SubmitButton>
                  )}
                </form>
              ))}
              {zones.length === 0 && (
                <p className="px-5 py-6 text-[13px] text-ink-500">
                  No areas yet. The club adds areas (Gym, Pool…) when it adds services; link their readers here.
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

async function Payments({ tenantId, uid }: { tenantId: string; uid: string }) {
  const [[plat], [row]] = await Promise.all([
    db()<{ ok: boolean }[]>`select app_is_platform(${uid}) as ok`,
    withTenant(
      db(),
      tenantId,
      (tx) =>
        tx<
          {
            tp: { env: string; clientId: string } | null;
            ch: {
              paybill?: string | null;
              till?: string | null;
              linksOnly?: boolean;
              settlementBank?: string;
              settlementConfirmed?: boolean;
            } | null;
          }[]
        >`select data->'taifapay' as tp, data->'channels' as ch from tenant_settings where tenant_id = ${tenantId}`,
    ),
  ]);
  const navac = !!plat?.ok;
  const tp = row?.tp ?? null;
  const ch = row?.ch ?? {};
  const [t] = await db()<{ slug: string }[]>`select slug from tenants where id = ${tenantId}`;
  const host = (await headers()).get('host');
  const base = (process.env.PUBLIC_URL ?? `https://${host}`).replace(/\/$/, '');
  const card = 'rounded-2xl border border-[#E4E8EF] bg-white p-5';
  const lbl = 'mb-1.5 block text-[11.5px] font-semibold text-ink-500';
  const pill = (ok: boolean, text: string) => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
    >
      <i className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {text}
    </span>
  );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className={card}>
        <header className="flex items-center gap-3">
          <h2 className="text-[14.5px] font-semibold">Payment Gateway</h2>
          <span className="ml-auto">{pill(!!tp, tp ? `Connected · ${tp.env}` : 'Not connected')}</span>
        </header>
        {navac ? (
          <form action={navacSaveGateway} className="mt-4 grid gap-3.5">
            <input type="hidden" name="tenantId" value={tenantId} />
            <label>
              <span className={lbl}>Environment</span>
              <select name="env" defaultValue={tp?.env ?? 'live'} className="input py-2">
                <option value="live">Live</option>
                <option value="sandbox">Sandbox</option>
              </select>
            </label>
            <label>
              <span className={lbl}>Client ID</span>
              <input
                name="clientId"
                type="password"
                autoComplete="off"
                placeholder={tp ? `••••${tp.clientId.slice(-4)} (stored)` : 'Client ID'}
                className="input py-2"
              />
            </label>
            <label>
              <span className={lbl}>Client secret</span>
              <input
                name="clientSecret"
                type="password"
                autoComplete="new-password"
                placeholder={tp ? '•••••••• (stored)' : 'Client secret'}
                className="input py-2"
              />
            </label>
            <div>
              <span className={lbl}>Deposit webhook URL</span>
              <CopyField value={`${base}/api/webhooks/taifapay/${t?.slug}`} label="Deposit webhook URL" />
            </div>
            <SubmitButton pendingText="Checking the keys…" className="btn-primary py-2.5">
              Verify &amp; save
            </SubmitButton>
          </form>
        ) : (
          <p className="mt-3 text-[13px] text-ink-500">NAVAC sets up the Payment Gateway for each club.</p>
        )}
      </section>

      <section className={card}>
        <header className="flex items-center gap-3">
          <h2 className="text-[14.5px] font-semibold">Where members pay</h2>
          <span className="ml-auto">
            {pill(
              !!(ch.paybill || ch.till || ch.linksOnly),
              ch.paybill
                ? `Paybill ${ch.paybill}`
                : ch.till
                  ? `Till ${ch.till}`
                  : ch.linksOnly
                    ? 'Prompts & links'
                    : 'Not set',
            )}
          </span>
        </header>
        {navac ? (
          <form action={navacSaveChannels} className="mt-4 grid gap-3.5">
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="grid gap-3.5 sm:grid-cols-2">
              <label>
                <span className={lbl}>Paybill</span>
                <input
                  name="paybill"
                  inputMode="numeric"
                  defaultValue={ch.paybill ?? ''}
                  placeholder="400200"
                  className="input py-2"
                />
              </label>
              <label>
                <span className={lbl}>Till</span>
                <input
                  name="till"
                  inputMode="numeric"
                  defaultValue={ch.till ?? ''}
                  placeholder="Optional"
                  className="input py-2"
                />
              </label>
            </div>
            <label className="flex items-center gap-2.5 text-[13px]">
              <input
                type="checkbox"
                name="linksOnly"
                defaultChecked={!!ch.linksOnly}
                className="h-4 w-4 accent-ink-900"
              />
              No paybill or till: prompts and links only
            </label>
            <label>
              <span className={lbl}>Settlement bank</span>
              <input
                name="settlementBank"
                defaultValue={ch.settlementBank ?? ''}
                placeholder="KCB · ending 4821"
                className="input py-2"
              />
            </label>
            <label className="flex items-center gap-2.5 text-[13px]">
              <input
                type="checkbox"
                name="settlementConfirmed"
                defaultChecked={!!ch.settlementConfirmed}
                className="h-4 w-4 accent-ink-900"
              />
              Settlement confirmed by the Payment Gateway
            </label>
            <SubmitButton pendingText="Saving…" className="btn-ghost py-2.5">
              Save
            </SubmitButton>
          </form>
        ) : (
          <dl className="mt-3 grid gap-2 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-ink-500">Settlement bank</dt>
              <dd>{ch.settlementBank || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Settlement confirmed</dt>
              <dd>{ch.settlementConfirmed ? 'Yes' : 'Not yet'}</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}

async function Comms({ tenantId, uid, admin, slug }: { tenantId: string; uid: string; admin: boolean; slug: string }) {
  const [channels, smsCfg, emailCfg, [wallet]] = await Promise.all([
    db()<
      {
        channel: string;
        enabled: boolean;
        config: { phoneNumberId?: string; displayPhone?: string };
        has_secret: boolean;
        routing_token: string | null;
        verify_token: string | null;
        updated_by: string | null;
        updated_at: Date;
      }[]
    >`select * from app_partner_channels(${uid}, ${tenantId})`,
    platformSmsConfig(db()),
    platformEmailConfig(db()),
    db()<{ sender: string | null; balance: string; sent_30d: string }[]>`
      select sender, balance, sent_30d from app_platform_sms_clubs(${uid}) where tenant_id = ${tenantId}`,
  ]);
  const wa = channels.find((c) => c.channel === 'whatsapp');
  const em = channels.find((c) => c.channel === 'email');
  const host = (await headers()).get('host');
  const base = (process.env.PUBLIC_URL ?? `https://${host}`).replace(/\/$/, '');
  const head = (I: typeof Mail, title: string, desc: string, on: boolean) => (
    <header className="flex items-start gap-3">
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-50 text-ink-500'}`}
      >
        <I size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <p className="text-[12.5px] text-ink-500">{desc}</p>
      </div>
      <span
        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-ink-500'}`}
      >
        {on ? 'On' : 'Off'}
      </span>
    </header>
  );
  const card = 'rounded-2xl border border-[#E4E8EF] bg-white p-5';
  const lbl = 'mb-1.5 block text-[11px] font-medium text-ink-500';
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-500">
        What the club can use in its Communications inbox. The club reads and replies; only partners and NAVAC connect
        channels.
      </p>
      <section className={card}>
        {head(
          MessageSquare,
          'SMS',
          `Through NAVAC’s Source Code account, paid from the club’s SMS credit${wallet ? ` · sender ${wallet.sender ?? smsCfg?.sender ?? 'default'} · balance ${Number(wallet.balance).toLocaleString('en-KE')} · ${Number(wallet.sent_30d).toLocaleString('en-KE')} sent in 30 days` : ''}. Send-only: SMS replies don’t come back.`,
          !!smsCfg?.apiKey,
        )}
        <p className="mt-3 text-[12px] text-ink-500">
          The club switches SMS on in Settings › Notifications. NAVAC sets sender IDs and prices under Platform settings
          › Club pricing.
        </p>
      </section>

      <section className={card}>
        {head(
          MessageCircle,
          'WhatsApp',
          wa?.config.displayPhone
            ? `${wa.config.displayPhone} · the club’s own WhatsApp Business number`
            : 'The club’s own WhatsApp Business number, through Meta’s Cloud API',
          !!wa?.enabled,
        )}
        {wa?.routing_token && (
          <div className="mt-4 grid gap-3 rounded-xl bg-[#FAFBFC] p-4 md:grid-cols-2">
            <CopyField value={`${base}/api/webhooks/whatsapp/${wa.routing_token}`} label="Callback URL" />
            <CopyField value={wa.verify_token ?? ''} label="Verify token" />
            <p className="text-[12px] text-ink-500 md:col-span-2">
              In Meta › WhatsApp › Configuration, paste both, then subscribe the webhook to <b>messages</b>.
            </p>
          </div>
        )}
        {admin ? (
          <form action={partnerSaveWhatsApp} className="mt-4 space-y-4">
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="grid gap-4 md:grid-cols-3">
              <label>
                <span className={lbl}>Phone number ID</span>
                <input
                  name="phoneNumberId"
                  inputMode="numeric"
                  defaultValue={wa?.config.phoneNumberId ?? ''}
                  placeholder="Meta › WhatsApp › API setup"
                  className="input py-2"
                />
              </label>
              <label>
                <span className={lbl}>Access token (permanent, system user)</span>
                <input
                  name="accessToken"
                  type="password"
                  autoComplete="off"
                  placeholder={wa?.has_secret ? '•••••••• stored' : 'EAAG…'}
                  className="input py-2"
                />
              </label>
              <label>
                <span className={lbl}>App secret</span>
                <input
                  name="appSecret"
                  type="password"
                  autoComplete="off"
                  placeholder={wa?.has_secret ? '•••••••• stored' : 'Meta app › Settings › Basic'}
                  className="input py-2"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={wa ? wa.enabled : true}
                  className="h-4 w-4 accent-emerald-600"
                />
                Use WhatsApp for this club
              </label>
              <span className="ml-auto text-[11.5px] text-ink-500">
                {wa ? `Saved by ${wa.updated_by} · ${dateTime(wa.updated_at)}` : ''}
              </span>
              <SubmitButton pendingText="Checking with Meta…" className="btn-primary py-2">
                {wa ? 'Save' : 'Connect WhatsApp'}
              </SubmitButton>
            </div>
          </form>
        ) : (
          <p className="mt-3 text-[12.5px] text-ink-500">A partner admin connects WhatsApp.</p>
        )}
      </section>

      <section className={card}>
        {head(
          Mail,
          'Email',
          emailCfg
            ? `Sent as “club name <${/<([^>]+)>/.exec(emailCfg.from)?.[1] ?? emailCfg.from}>”. ${emailCfg.inboundDomain ? `Replies arrive at ${slug}@${emailCfg.inboundDomain}.` : 'Replies need receiving set up under Platform settings › Email.'}`
            : 'Email is not set up on the platform yet.',
          !!em?.enabled && !!emailCfg,
        )}
        {admin && emailCfg && (
          <form action={partnerSaveEmail} className="mt-4 flex flex-wrap items-center gap-3">
            <input type="hidden" name="tenantId" value={tenantId} />
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={!!em?.enabled}
                className="h-4 w-4 accent-emerald-600"
              />
              Let the club email members from its inbox
            </label>
            <SubmitButton pendingText="Saving…" className="btn-ghost ml-auto py-2">
              <CheckCircle2 size={14} /> Save
            </SubmitButton>
          </form>
        )}
      </section>
    </div>
  );
}
