import { platformSms } from '@lango/server';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader } from '@/components/ui';
import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';
import { savePlatformSms } from '../actions';

const MSG: Record<string, [string, string]> = {
  ok: ['green', 'Source Code connected. Clubs can now switch SMS on in their Settings.'],
  rejected: ['red', 'Source Code rejected that API key.'],
  unreachable: ['amber', 'Source Code did not answer in time; nothing was saved. Try again.'],
  missing: ['amber', 'Paste the API key from Source Code › Developers/API › Show API Key.'],
  forbidden: ['red', 'Only NAVAC platform admins can change this.'],
};

export default async function PlatformSettings({ searchParams }: { searchParams: Promise<{ sms?: string }> }) {
  const s = await requirePartner();
  const { sms } = await searchParams;
  const [plat] = await db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`;
  if (!plat?.ok) redirect('/partner');
  const [row] = await db()<
    { data: { sender?: string; apiKey?: string } | null }[]
  >`select app_platform_get('sms') as data`;
  const client = await platformSms(db());
  let status: { ok: boolean; balance: string | null } | null = null;
  if (client) {
    try {
      status = await client.profile();
    } catch {
      status = { ok: false, balance: null };
    }
  }
  const m = sms ? MSG[sms] : undefined;
  return (
    <>
      <Link href="/partner" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900">
        <ArrowLeft size={15} /> Clubs
      </Link>
      <PageHeader title="Platform settings" subtitle="Shared by every club on Lango." />
      {m && (
        <div
          className={`mb-6 max-w-2xl rounded-xl p-3 text-sm ring-1 ${m[0] === 'green' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : m[0] === 'red' ? 'bg-rose-50 text-rose-800 ring-rose-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {m[1]}
        </div>
      )}
      <section className="card max-w-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
            <MessageSquare size={18} />
          </div>
          <div className="flex-1">
            <div className="font-medium">SMS · Source Code</div>
            <div className="text-xs text-ink-500">Receipts, renewal reminders and welcome messages for all clubs</div>
          </div>
          {status?.ok ? (
            <Badge tone="green">connected · {status.balance ?? '?'} units</Badge>
          ) : row?.data?.apiKey ? (
            <Badge tone="red">key not accepted</Badge>
          ) : (
            <Badge>not connected</Badge>
          )}
        </div>
        <form action={savePlatformSms} className="mt-6 space-y-4">
          <label className="block">
            <span className="label">Sender ID</span>
            <input name="sender" defaultValue={row?.data?.sender ?? 'NAVAC'} maxLength={11} className="input mt-1.5" />
          </label>
          <label className="block">
            <span className="label">API key</span>
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              placeholder={
                row?.data?.apiKey
                  ? '•••••••• · stored, enter to replace'
                  : 'Source Code › Developers/API › Show API Key'
              }
              className="input mt-1.5"
            />
          </label>
          <SubmitButton pendingText="Checking with Source Code…" className="btn-primary w-full">
            Verify &amp; save
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
