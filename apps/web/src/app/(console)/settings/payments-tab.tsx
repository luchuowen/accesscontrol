import { withTenant } from '@lango/db';
import { can } from '@lango/server';
import { CheckCircle2, CreditCard, Smartphone } from 'lucide-react';
import { headers } from 'next/headers';
import { CopyField } from '@/components/copy-field';
import { SubmitButton } from '@/components/submit-button';
import { Badge } from '@/components/ui';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { saveChannels, saveTaifaPay } from './actions';
import { Banner, type Note, TabHead } from './bits';

const NOTES: Record<string, Note> = {
  'taifa:ok': ['green', 'Payment Gateway connected — the keys were verified and stored encrypted.'],
  'taifa:rejected': [
    'red',
    'The Payment Gateway rejected those keys. Check the environment (sandbox / live) and try again.',
  ],
  'taifa:missing': ['amber', 'Enter both the client ID and the client secret.'],
  'taifa:unreachable': [
    'amber',
    'The Payment Gateway did not answer in time, so nothing was saved. Try again in a minute.',
  ],
  'taifa:forbidden': ['red', 'You don’t have permission to change this.'],
  'ch:ok': ['green', 'Payment channels saved. Members now see these details on the portal and receipts.'],
  'ch:number': ['red', 'Paybill and till numbers are 5 to 7 digits.'],
  'ch:forbidden': ['red', 'You don’t have permission to change this.'],
};

/** Settings › Payments: the club's Payment Gateway keys and the paybill or till members pay to. */
export async function PaymentsTab({ s, taifa, ch }: { s: Session; taifa?: string; ch?: string }) {
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
  const owner = can(s, 'settings.payments');
  const note = taifa ? NOTES[`taifa:${taifa}`] : ch ? NOTES[`ch:${ch}`] : undefined;
  return (
    <>
      <TabHead
        title="Payments"
        sub="Every payment runs through the Payment Gateway and settles to the club’s bank. Members pay with their member number as the account."
      />
      <Banner note={note} />
      <div className="grid gap-4 xl:grid-cols-2">
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
      </div>
    </>
  );
}
