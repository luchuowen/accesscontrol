import { withTenant } from '@lango/db';
import { can } from '@lango/server';
import Link from 'next/link';
import { AddMember } from '@/components/add-member';
import { Notice } from '@/components/notice';
import { Pager } from '@/components/pager';
import { PageHeader } from '@/components/ui';
import { WalkIn } from '@/components/walk-in';
import { membersBoard, nextMemberNo, walkinPrices } from '@/lib/data';
import { requirePerm } from '@/lib/session';
import { settlePending } from '@/lib/settle';
import { db } from '@/server/db';
import { LiveRefresh } from '../_dash/live-refresh';
import { DayPasses } from './day-passes';
import { MemberFilters } from './filters';
import { ImportMembers } from './import/import-modal';
import { MemberGroups } from './table';

/**
 * Members (design C "Money first", approved 2 Oct 2026): a band leading with the money due this week and one button
 * to remind everyone, status tiles that filter, search that filters as you type, then the list grouped by who needs
 * action first. A row opens the side drawer. Day passes have their own tab.
 */
type Params = { q?: string; n?: string; tab?: string; f?: string; service?: string; page?: string };

export default async function Members({ searchParams }: { searchParams: Promise<Params> }) {
  const s = await requirePerm('members.view');
  const sp = await searchParams;
  const day = sp.tab === 'day';
  const page = Math.max(1, Number(sp.page) || 1);
  // A member paying from their phone shows up here by itself: every 2 s while a prompt is out, else every 15 s.
  const waiting = await settlePending(s.tid);
  const [board, nextNo, [t], walkins, [bands]] = await Promise.all([
    membersBoard(s.tid, { q: sp.q, f: sp.f, service: sp.service, page }),
    nextMemberNo(s.tid),
    db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`,
    walkinPrices(s.tid),
    withTenant(
      db(),
      s.tid,
      (tx) => tx<{ n: number }[]>`select count(*)::int as n from day_passes
        where status = 'active' and created_at > date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi'`,
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
  const tiles = [
    { key: 'active', label: 'Active now', n: c.active, dot: 'bg-emerald-400' },
    { key: 'ending', label: 'Ending in 7 days', n: c.ending, dot: 'bg-amber-400' },
    { key: 'lapsed', label: 'Lapsed', n: c.lapsed, dot: 'bg-rose-400' },
    { key: 'never', label: 'Never paid', n: c.never, dot: 'bg-slate-300' },
  ];

  return (
    <>
      <LiveRefresh seconds={waiting ? 2 : 15} />
      <PageHeader
        title="Members"
        subtitle="Everyone with a membership, what they pay for and when it ends."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(s, 'payments.record') && <WalkIn prices={walkins} variant="outline" />}
            {can(s, 'members.edit') && <ImportMembers />}
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
          <section className="relative mb-5 grid items-center gap-5 overflow-hidden rounded-[18px] bg-[linear-gradient(120deg,#0B1629_0%,#11284A_62%,#0E3A33_100%)] px-6 py-5 text-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-28 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.28),transparent_65%)]"
            />
            <div className="relative">
              <div className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#8FB7AA]">
                Due in the next 7 days
              </div>
              <div className="mt-1.5 text-[34px] font-semibold tabular-nums tracking-[-0.03em]">
                KES {c.dueKes.toLocaleString('en-KE')}
              </div>
            </div>
            <div className="relative grid grid-cols-2 gap-2.5 self-center sm:grid-cols-4">
              {tiles.map((k) => {
                const on = f === k.key;
                return (
                  <Link
                    key={k.key}
                    href={href({ f: on ? undefined : k.key, page: undefined })}
                    aria-current={on ? 'true' : undefined}
                    className={`rounded-2xl border px-3.5 py-3 transition ${on ? 'border-white bg-white text-[#0B1629]' : 'border-white/10 bg-white/[0.06] hover:bg-white/10'}`}
                  >
                    <span
                      className={`flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-medium ${on ? 'text-ink-500' : 'text-[#B9C6D8]'}`}
                    >
                      <i className={`h-1.5 w-1.5 rounded-full ${k.dot}`} />
                      {k.label}
                    </span>
                    <span className="mt-1 block text-[26px] font-semibold tabular-nums tracking-[-0.02em]">{k.n}</span>
                  </Link>
                );
              })}
            </div>
          </section>

          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <div className="min-w-0 flex-1">
              <MemberFilters services={board.services} total={board.total} />
            </div>
            {(f || sp.service) && (
              <Link href="/members" className="px-2 text-[13px] font-medium text-ink-500 hover:text-ink-900">
                Show all {c.all}
              </Link>
            )}
          </div>

          <div>
            {board.rows.length === 0 ? (
              <div className="rounded-2xl border border-[#E7EBF3] bg-white px-5 py-12 text-center text-sm text-ink-500">
                {c.all === 0 ? (
                  <>
                    No members yet. {can(s, 'members.edit') ? <ImportMembers variant="link" /> : 'Import them'} or add
                    the first one.
                  </>
                ) : (
                  'No members match. Try another name, number or phone.'
                )}
              </div>
            ) : (
              <MemberGroups
                q={sp.q ?? ''}
                canPay={can(s, 'payments.record')}
                rows={board.rows.map((r) => ({
                  ...r,
                  lastVisit: r.lastVisit ? r.lastVisit.toISOString() : null,
                  endsAt: r.endsAt ? r.endsAt.toISOString() : null,
                }))}
              />
            )}
            {board.total > 0 && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-[#E7EBF3] bg-white">
                <Pager
                  page={page}
                  per={50}
                  total={board.total}
                  noun="members"
                  href={(n) => href({ page: n > 1 ? String(n) : undefined })}
                />
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
