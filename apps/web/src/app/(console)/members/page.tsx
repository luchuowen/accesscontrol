import { can } from '@lango/server';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { AddMember } from '@/components/add-member';
import { Notice } from '@/components/notice';
import { Badge, PageHeader } from '@/components/ui';
import { members, nextMemberNo } from '@/lib/data';
import { date, daysLeft } from '@/lib/format';
import { requirePerm } from '@/lib/session';
import { db } from '@/server/db';

export default async function Members({ searchParams }: { searchParams: Promise<{ q?: string; n?: string }> }) {
  const s = await requirePerm('members.view');
  const { q = '', n } = await searchParams;
  const [rows, nextNo, [t]] = await Promise.all([
    members(s.tid, q),
    nextMemberNo(s.tid),
    db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`,
  ]);
  const club = t?.name ?? '';
  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Every member keeps one permanent number — it is their card code and their M-Pesa account number."
        actions={can(s, 'members.edit') && <AddMember club={club} nextNo={nextNo} variant="primary" />}
      />
      <Notice code={n} />
      <form className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3.5 top-3 text-ink-300" />
        <input name="q" defaultValue={q} placeholder="Search name, number or phone" className="input pl-10" />
      </form>
      <div className="card overflow-x-auto">
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
