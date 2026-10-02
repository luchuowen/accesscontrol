import { withTenant } from '@lango/db';
import { CheckCircle2, CreditCard, MessageSquare } from 'lucide-react';
import { headers } from 'next/headers';
import { CopyField } from '@/components/copy-field';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader } from '@/components/ui';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';
import { saveTaifaPay } from './actions';

export default async function Settings({ searchParams }: { searchParams: Promise<{ taifa?: string }> }) {
  const s = await requireSession();
  const { taifa } = await searchParams;
  const [row] = await withTenant(
    db(),
    s.tid,
    (tx) =>
      tx<
        { data: { taifapay?: { env: string; clientId: string } } }[]
      >`select data from tenant_settings where tenant_id = ${s.tid}`,
  );
  const [t] = await db()<{ slug: string }[]>`select slug from tenants where id = ${s.tid}`;
  const host = (await headers()).get('host');
  // Same for every club: the public address of this Lango server + the club's own code.
  const base = (process.env.PUBLIC_URL ?? `https://${host}`).replace(/\/$/, '');
  const webhook = `${base}/api/webhooks/taifapay/${t?.slug}`;
  const tp = row?.data.taifapay;
  const msg: Record<string, [string, string]> = {
    ok: ['green', 'TaifaPay connected — the keys were verified and stored encrypted.'],
    rejected: ['red', 'TaifaPay rejected those keys. Check the environment (sandbox / live) and try again.'],
    missing: ['amber', 'Enter both the client ID and the client secret.'],
    unreachable: ['amber', 'TaifaPay did not answer in time, so nothing was saved. Try again in a minute.'],
  };
  const m = taifa ? msg[taifa] : undefined;
  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Connect the club's own payment and SMS accounts. Money settles directly to the club."
      />
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
          {s.role === 'owner' ? (
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
      </div>
    </>
  );
}
