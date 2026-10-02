import { withTenant } from '@lango/db';
import { can } from '@lango/server';
import { Search, Upload } from 'lucide-react';
import Link from 'next/link';
import { AddMember } from '@/components/add-member';
import { Notice } from '@/components/notice';
import { PageHeader } from '@/components/ui';
import { WalkIn } from '@/components/walk-in';
import { membersBoard, nextMemberNo, walkinPrices } from '@/lib/data';
import { requirePerm } from '@/lib/session';
import { db } from '@/server/db';
import { AutoSelect } from './auto-select';
import { DayPasses } from './day-passes';
import { MembersTable } from './table';

/**
 * Members (design A "Clean table + drawer", approved 2 Oct 2026): summary cards that double as filters, search and
 * filters, the list, and a side drawer with the member's services and quick actions. Day passes have their own tab.
 */
type Params = { q?: string; n?: string; tab?: string; f?: string; service?: string; page?: string };

export default async function Members({ searchParams }: { searchParams: Promise<Params> }) {
  const s = await requirePerm('members.view');
  const sp = await searchParams;
  const day = sp.tab === 'day';
  const page = Math.max(1, Number(sp.page) || 1);
  const [board, nextNo, [t], walkins, [bands]] = await Promise.all([
    membersBoard(s.tid, { q: sp.q, f: sp.f, service: sp.service, page }),
    nextMemberNo(s.tid),
    db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`,
    walkinPrices(s.tid),
    withTenant(
      db(),
      s.tid,
      (tx) => tx<{ n: number }[]>`select count(*)::int as n from members where member_no between 11001 and 11999`,
    ),
  ]);
  const club = t?.name ?? '';
  const c = board.counts;
  const f = sp.f ?? '';
  // Links keep the other filters; changing a filter goes back to page 1.
  const href = (p: Partial<Params>) => {
    const u = new URLSearchParams();
    const next = { q: sp.q, f: sp.f, service: sp.service, ...p };
    for (const [k, v] of Object.entries(next)) if (v) u.set(k, String(v));
    const qs = u.toString();
    return qs ? `/members?${qs}` : '/members';
  };
  const tabClass = (on: boolean) =>
    `inline-flex items-center gap-2 border-b-2 px-1 pb-2.5 text-sm font-semibold ${on ? 'border-ink-900 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'}`;
  const cards = [
    { key: '', label: 'All members', n: c.all, sub: `+${c.joined} this month` },
    {
      key: 'active',
      label: 'Active now',
      n: c.active,
      sub: c.all ? `${Math.round((c.active / c.all) * 100)}% of members` : '—',
    },
    { key: 'ending', label: 'Ending in 7 days', n: c.ending, sub: `KES ${c.dueKes.toLocaleString('en-KE')} due` },
    { key: 'lapsed', label: 'Lapsed', n: c.lapsed, sub: 'Ended in the last 30 days' },
    { key: 'never', label: 'Never paid', n: c.never, sub: 'Added, no payment yet' },
  ];
  const pages = Math.max(1, Math.ceil(board.total / 50));

  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Everyone with a membership, what they pay for and when it ends."
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
      <Notice code={sp.n} />
      <nav className="mb-5 flex gap-6 border-b border-[#E7EBF3]" aria-label="Members or day passes">
        <Link href="/members" className={tabClass(!day)} aria-current={!day ? 'page' : undefined}>
          Members <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums">{c.all}</span>
        </Link>
        <Link href="/members?tab=day" className={tabClass(day)} aria-current={day ? 'page' : undefined}>
          Day passes{' '}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums">{bands?.n ?? 0}</span>
        </Link>
      </nav>

      {day ? (
        <DayPasses canAdd={can(s, 'members.edit')} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {cards.map((k) => {
              const on = f === k.key;
              return (
                <Link
                  key={k.key || 'all'}
                  href={href({ f: k.key || undefined, page: undefined })}
                  aria-current={on ? 'true' : undefined}
                  className={`rounded-2xl border bg-white p-4 transition hover:border-slate-300 ${on ? 'border-ink-900 shadow-[0_0_0_1px_#0c1220]' : 'border-[#E7EBF3]'}`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{k.label}</div>
                  <div className="mt-2 text-[26px] font-semibold tabular-nums tracking-tight">{k.n}</div>
                  <div className="mt-0.5 truncate text-[12.5px] text-ink-500">{k.sub}</div>
                </Link>
              );
            })}
          </div>

          <section className="rounded-2xl border border-[#E7EBF3] bg-white">
            <form action="/members" className="flex flex-wrap items-center gap-2 border-b border-[#EEF1F6] p-3">
              {f && <input type="hidden" name="f" value={f} />}
              <div className="relative min-w-[220px] flex-1">
                <Search size={16} className="absolute left-3 top-3 text-ink-300" />
                <input
                  name="q"
                  defaultValue={sp.q}
                  placeholder="Search name, number or phone"
                  className="h-10 w-full rounded-[10px] border border-[#E5E8EE] bg-white pl-9 pr-3 text-sm outline-none focus:border-ink-300"
                />
              </div>
              <AutoSelect
                name="service"
                value={sp.service ?? ''}
                label="Service"
                options={[['', 'All services'], ...board.services.map((n) => [n, n] as [string, string])]}
              />
              {(f || sp.q || sp.service) && (
                <Link href="/members" className="px-2 text-[13px] text-ink-500 hover:text-ink-900">
                  Clear
                </Link>
              )}
            </form>
            {board.rows.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-ink-500">
                {c.all === 0 ? (
                  <>
                    No members yet.{' '}
                    <Link href="/members/import" className="font-semibold text-[#047857] hover:underline">
                      Import them
                    </Link>{' '}
                    or add the first one.
                  </>
                ) : (
                  'No members match. Try another search or filter.'
                )}
              </div>
            ) : (
              <MembersTable
                canPay={can(s, 'payments.record')}
                rows={board.rows.map((r) => ({ ...r, lastVisit: r.lastVisit ? r.lastVisit.toISOString() : null }))}
              />
            )}
            <div className="flex items-center justify-between border-t border-[#EEF1F6] px-4 py-3 text-[13px] text-ink-500">
              <span>
                Showing {board.rows.length} of {board.total}
              </span>
              {pages > 1 && (
                <span className="flex gap-1.5">
                  {page > 1 && (
                    <Link
                      href={href({ page: String(page - 1) })}
                      className="rounded-lg border border-[#E5E8EE] px-3 py-1.5 hover:bg-slate-50"
                    >
                      Previous
                    </Link>
                  )}
                  <span className="px-2 py-1.5">
                    Page {page} of {pages}
                  </span>
                  {page < pages && (
                    <Link
                      href={href({ page: String(page + 1) })}
                      className="rounded-lg border border-[#E5E8EE] px-3 py-1.5 hover:bg-slate-50"
                    >
                      Next
                    </Link>
                  )}
                </span>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
