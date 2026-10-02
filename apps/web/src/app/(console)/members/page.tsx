import { withTenant } from '@lango/db';
import { can } from '@lango/server';
import { AlertCircle, CheckCircle2, Clock, Search, Upload, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { AddMember } from '@/components/add-member';
import { Notice } from '@/components/notice';
import { PageHeader } from '@/components/ui';
import { WalkIn } from '@/components/walk-in';
import { membersBoard, nextMemberNo, walkinPrices } from '@/lib/data';
import { requirePerm } from '@/lib/session';
import { db } from '@/server/db';
import { DayPasses } from './day-passes';
import { MembersTable } from './table';

/**
 * Members (design A "Clean table + drawer", approved 2 Oct 2026): summary cards that double as filters, search and
 * filters, the list, and a side drawer with the member's services and quick actions. Day passes have their own tab.
 */
type Params = { q?: string; n?: string; tab?: string; f?: string; service?: string; card?: string; page?: string };

export default async function Members({ searchParams }: { searchParams: Promise<Params> }) {
  const s = await requirePerm('members.view');
  const sp = await searchParams;
  const day = sp.tab === 'day';
  const page = Math.max(1, Number(sp.page) || 1);
  const [board, nextNo, [t], walkins, [bands]] = await Promise.all([
    membersBoard(s.tid, { q: sp.q, f: sp.f, service: sp.service, card: sp.card, page }),
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
    const next = { q: sp.q, f: sp.f, service: sp.service, card: sp.card, ...p };
    for (const [k, v] of Object.entries(next)) if (v) u.set(k, String(v));
    const qs = u.toString();
    return qs ? `/members?${qs}` : '/members';
  };
  const tabClass = (on: boolean) =>
    `inline-flex items-center gap-2 border-b-2 px-1 pb-2.5 text-sm font-semibold ${on ? 'border-ink-900 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'}`;
  const cards = [
    {
      key: '',
      label: 'All members',
      n: c.all,
      sub: `+${c.joined} this month`,
      icon: Users,
      tone: 'bg-slate-100 text-ink-700',
      subCls: 'text-ink-500',
    },
    {
      key: 'active',
      label: 'Active now',
      n: c.active,
      sub: c.all ? `${Math.round((c.active / c.all) * 100)}% of members` : '—',
      icon: CheckCircle2,
      tone: 'bg-emerald-50 text-[#047857]',
      subCls: 'text-[#047857]',
    },
    {
      key: 'ending',
      label: 'Ending in 7 days',
      n: c.ending,
      sub: `KES ${c.dueKes.toLocaleString('en-KE')} due`,
      icon: Clock,
      tone: 'bg-amber-50 text-amber-700',
      subCls: 'text-amber-700',
    },
    {
      key: 'lapsed',
      label: 'Lapsed',
      n: c.lapsed,
      sub: 'Ended in the last 30 days',
      icon: AlertCircle,
      tone: 'bg-rose-50 text-rose-700',
      subCls: 'text-rose-700',
    },
    {
      key: 'never',
      label: 'Never paid',
      n: c.never,
      sub: 'Added, no payment yet',
      icon: UserPlus,
      tone: 'bg-slate-100 text-slate-600',
      subCls: 'text-ink-500',
    },
  ];
  const chips = [
    ['', 'All', ''],
    ['active', 'Active', 'bg-emerald-500'],
    ['ending', 'Ending in 7 days', 'bg-amber-500'],
    ['lapsed', 'Lapsed', 'bg-rose-500'],
    ['never', 'Never paid', 'bg-slate-400'],
  ] as const;
  const pages = Math.max(1, Math.ceil(board.total / 50));
  const sel = 'h-10 rounded-[10px] border border-[#E5E8EE] bg-white px-3 text-[13px] font-semibold text-ink-900';

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
          Members{' '}
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] tabular-nums text-[#047857]">
            {c.all}
          </span>
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
              const Icon = k.icon;
              const on = f === k.key;
              return (
                <Link
                  key={k.key || 'all'}
                  href={href({ f: k.key || undefined, page: undefined })}
                  aria-current={on ? 'true' : undefined}
                  className={`rounded-2xl border bg-white p-4 transition hover:border-slate-300 ${on ? 'border-[#10B981] ring-2 ring-emerald-500/20' : 'border-[#E7EBF3]'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                      {k.label}
                    </span>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${k.tone}`}>
                      <Icon size={15} />
                    </span>
                  </div>
                  <div className="mt-2 text-[26px] font-semibold tabular-nums tracking-tight">{k.n}</div>
                  <div className={`mt-0.5 truncate text-[12.5px] ${k.subCls}`}>{k.sub}</div>
                </Link>
              );
            })}
          </div>

          <section className="rounded-2xl border border-[#E7EBF3] bg-white">
            <form action="/members" className="flex flex-wrap items-center gap-2 border-b border-[#EEF1F6] p-3">
              {f && <input type="hidden" name="f" value={f} />}
              <div className="relative min-w-[220px] flex-1 md:max-w-[300px]">
                <Search size={16} className="absolute left-3 top-3 text-ink-300" />
                <input
                  name="q"
                  defaultValue={sp.q}
                  placeholder="Search name, number or phone"
                  className="h-10 w-full rounded-[10px] border border-[#E5E8EE] bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-[#10B981] focus:bg-white"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {chips.map(([k, l, dot]) => (
                  <Link
                    key={k || 'all'}
                    href={href({ f: k || undefined, page: undefined })}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold ${f === k ? 'border-ink-950 bg-ink-950 text-white' : 'border-[#E5E8EE] bg-white text-ink-700 hover:bg-slate-50'}`}
                  >
                    {dot && <i className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
                    {l}
                  </Link>
                ))}
              </div>
              <div className="ml-auto flex gap-2">
                <select name="service" defaultValue={sp.service ?? ''} aria-label="Service" className={sel}>
                  <option value="">All services</option>
                  {board.services.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <select name="card" defaultValue={sp.card ?? ''} aria-label="Card" className={sel}>
                  <option value="">Any card</option>
                  <option value="yes">Card linked</option>
                  <option value="no">No card</option>
                </select>
                <button
                  type="submit"
                  className="h-10 rounded-[10px] bg-ink-900 px-3.5 text-[13px] font-semibold text-white"
                >
                  Apply
                </button>
              </div>
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
