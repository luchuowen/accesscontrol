import { withTenant } from '@lango/db';
import { onboardingChecklist } from '@lango/server';
import { CheckCircle2, CreditCard, KeyRound, MessageSquare, Smartphone, UsersRound } from 'lucide-react';
import { headers } from 'next/headers';
import { Checklist } from '@/components/checklist';
import { CopyField } from '@/components/copy-field';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader } from '@/components/ui';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';
import { changePassword, saveChannels, saveTaifaPay, setStaffActive } from './actions';
import { AddStaffForm } from './team-form';

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ taifa?: string; ch?: string; team?: string; pw?: string }>;
}) {
  const s = await requireSession();
  const { taifa, ch, team, pw } = await searchParams;
  const [row] = await withTenant(
    db(),
    s.tid,
    (tx) =>
      tx<
        {
          data: {
            taifapay?: { env: string; clientId: string };
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
  };
  const m = taifa
    ? msg[taifa]
    : ch
      ? other[`ch:${ch}`]
      : team
        ? other[`team:${team}`]
        : pw
          ? other[`pw:${pw}`]
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
              <div className="font-medium">SMS · Source Code</div>
              <div className="text-xs text-ink-500">Receipts, expiry reminders, announcements</div>
            </div>
            <Badge>coming next</Badge>
          </div>
          <p className="mt-6 text-sm text-ink-500">
            Payment receipts and expiry reminders are queued and will be delivered through the NAVAC Source Code account
            as soon as it is connected.
          </p>
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
