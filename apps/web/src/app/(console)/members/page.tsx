import { withTenant } from '@lango/db';
import { can } from '@lango/server';
import { Search, Upload } from 'lucide-react';
import Link from 'next/link';
import { AddMember } from '@/components/add-member';
import { Notice } from '@/components/notice';
import { Badge, PageHeader } from '@/components/ui';
import { WalkIn } from '@/components/walk-in';
import { members, nextMemberNo, walkinPrices } from '@/lib/data';
import { date, daysLeft } from '@/lib/format';
import { requirePerm } from '@/lib/session';
import { db } from '@/server/db';
import { DayPasses } from './day-passes';

export default async function Members({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; n?: string; tab?: string }>;
}) {
  const s = await requirePerm('members.view');
  const { q = '', n, tab } = await searchParams;
  const day = tab === 'day';
  const [rows, nextNo, [t], walkins, [counts]] = await Promise.all([
    members(s.tid, q),
    nextMemberNo(s.tid),
    db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`,
    walkinPrices(s.tid),
    withTenant(
      db(),
      s.tid,
      (tx) => tx<{ people: number; bands: number }[]>`
        select count(*) filter (where member_no not between 11001 and 11999)::int as people,
               count(*) filter (where member_no between 11001 and 11999)::int as bands from members`,
    ),
  ]);
  const club = t?.name ?? '';
  const tabClass = (on: boolean) =>
    `inline-flex items-center gap-2 border-b-2 px-1 pb-2.5 text-sm font-semibold ${on ? 'border-ink-900 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'}`;
  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Every member keeps one permanent number — it is their card code and their M-Pesa account number."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(s, 'payments.record') && <WalkIn prices={walkins} variant="outline" />}
            {can(s, 'members.edit') && (
              <Link
                href="/members/import"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#E5E8EE] bg-white px-3.5 text-sm font-semibold text-ink-900 hover:bg-slate-50"
              >
                <Upload size={15} /> Import
              </Link>
            )}
            {can(s, 'members.edit') && <AddMember club={club} nextNo={nextNo} variant="primary" />}
          </div>
        }
      />
      <Notice code={n} />
      <nav className="mb-5 flex gap-6 border-b border-[#E7EBF3]" aria-label="Members or day passes">
        <Link href="/members" className={tabClass(!day)} aria-current={!day ? 'page' : undefined}>
          Members{' '}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums">{counts?.people ?? 0}</span>
        </Link>
        <Link href="/members?tab=day" className={tabClass(day)} aria-current={day ? 'page' : undefined}>
          Day passes{' '}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums">{counts?.bands ?? 0}</span>
        </Link>
      </nav>
      {day ? (
        <DayPasses canAdd={can(s, 'members.edit')} />
      ) : (
        <>
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
      )}
    </>
  );
}
