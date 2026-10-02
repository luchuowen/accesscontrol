import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { Notice } from '@/components/notice';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader } from '@/components/ui';
import { members } from '@/lib/data';
import { date, daysLeft } from '@/lib/format';
import { requireSession } from '@/lib/session';
import { createMember } from '../actions';

export default async function Members({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; new?: string; n?: string }>;
}) {
  const s = await requireSession();
  const { q = '', new: showNew, n } = await searchParams;
  const rows = await members(s.tid, q);
  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Every member keeps one permanent number — it is their card code and their M-Pesa account number."
        actions={
          <Link href="/members?new=1" className="btn-primary">
            <Plus size={16} /> New member
          </Link>
        }
      />
      <Notice code={n} />
      {showNew && (
        <form action={createMember} className="card mb-6 grid gap-4 p-6 md:grid-cols-5">
          <input name="firstName" required placeholder="First name" className="input" />
          <input name="lastName" required placeholder="Last name" className="input" />
          <input name="phone" placeholder="Phone (07…)" className="input" />
          <input name="memberNo" type="number" min={1} max={65535} placeholder="Member no. (auto)" className="input" />
          <SubmitButton pendingText="Creating…" className="btn-primary">
            Create &amp; enrol
          </SubmitButton>
          <p className="text-xs text-ink-500 md:col-span-5">
            The member is created in the access system straight away, with no access until a plan is paid. Present their
            card or wristband at any reader to link it.
          </p>
        </form>
      )}
      <form className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3.5 top-3 text-ink-300" />
        <input name="q" defaultValue={q} placeholder="Search name, number or phone" className="input pl-10" />
      </form>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50/60 text-left">
            <tr>
              {['No.', 'Member', 'Phone', 'Access now', 'Paid until', 'Door sync'].map((h) => (
                <th key={h} className="label px-5 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((m) => {
              const left = daysLeft(m.activeUntil);
              const active = left !== null && left >= 0 && m.zones.length > 0;
              return (
                <tr key={m.id} className="hover:bg-ink-50/50">
                  <td className="px-5 py-3 font-mono text-xs text-ink-500">{m.memberNo}</td>
                  <td className="px-5 py-3">
                    <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                      {m.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-ink-500">{m.phone ?? '—'}</td>
                  <td className="px-5 py-3">
                    {active ? (
                      <div className="flex flex-wrap gap-1">
                        {m.zones.map((z) => (
                          <Badge key={z} tone="green">
                            {z}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <Badge tone="gray">no access</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {m.activeUntil ? (
                      <span
                        className={
                          left !== null && left < 0
                            ? 'text-ink-300'
                            : left !== null && left <= 3
                              ? 'text-amber-700'
                              : ''
                        }
                      >
                        {date(m.activeUntil)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {m.synced ? <Badge tone="green">in sync</Badge> : <Badge tone="amber">pending</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
