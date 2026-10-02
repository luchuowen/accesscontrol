import { withTenant } from '@lango/db';
import { CheckCircle2, CreditCard, MessageSquare } from 'lucide-react';
import { headers } from 'next/headers';
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
  const webhook = `https://${host}/api/webhooks/taifapay/${t?.slug}`;
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
            <form action={saveTaifaPay} className="mt-6 space-y-3">
              <select name="env" defaultValue={tp?.env ?? 'sandbox'} className="input">
                <option value="sandbox">Sandbox (testing)</option>
                <option value="live">Live</option>
              </select>
              <input
                name="clientId"
                type="password"
                placeholder={tp ? `Client ID ••••${tp.clientId.slice(-4)} (stored — enter to replace)` : 'Client ID'}
                className="input"
                autoComplete="off"
                spellCheck={false}
              />
              <input
                name="clientSecret"
                type="password"
                placeholder={tp ? '•••••••• (stored — enter to replace)' : 'Client secret'}
                className="input"
                autoComplete="new-password"
              />
              <SubmitButton pendingText="Checking the keys with TaifaPay…" className="btn-primary w-full">
                Verify &amp; save
              </SubmitButton>
            </form>
          ) : (
            <p className="mt-6 text-sm text-ink-500">Only the club owner can change payment settings.</p>
          )}
          <div className="mt-6 rounded-xl bg-ink-50 p-3 text-xs text-ink-500">
            In the TaifaPay merchant dashboard, set the webhook URL to:
            <div className="mt-1 select-all break-all font-mono text-[11px] text-ink-900">{webhook}</div>
          </div>
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
