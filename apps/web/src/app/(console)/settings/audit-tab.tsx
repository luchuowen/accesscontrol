import { CreditCard, DoorOpen, History, KeyRound, Layers, MessageSquare, Settings2, Users } from 'lucide-react';
import { DateTime } from 'luxon';
import { Pager } from '@/components/pager';
import { AUDIT_CATS, type AuditCat, clubAudit, describe } from '@/lib/audit';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { AuditFilters } from './audit-filters';
import { SectionHead } from './bits';

const PER = 30;
const LOOK: Record<AuditCat, { icon: typeof Users; tone: string }> = {
  team: { icon: KeyRound, tone: 'bg-slate-100 text-ink-700' },
  payments: { icon: CreditCard, tone: 'bg-emerald-50 text-emerald-700' },
  members: { icon: Users, tone: 'bg-sky-50 text-sky-700' },
  services: { icon: Layers, tone: 'bg-violet-50 text-violet-700' },
  doors: { icon: DoorOpen, tone: 'bg-amber-50 text-amber-700' },
  messages: { icon: MessageSquare, tone: 'bg-teal-50 text-teal-700' },
  settings: { icon: Settings2, tone: 'bg-rose-50 text-rose-700' },
};

export type AuditParams = { r?: string; from?: string; to?: string; c?: string; w?: string; pg?: string };

/** Settings › System audit: every sign-in and change in the club, by day, filterable by dates, events and person. */
export async function AuditTab({ s, sp }: { s: Session; sp: AuditParams }) {
  const [t] = await db()<{ timezone: string }[]>`select timezone from tenants where id = ${s.tid}`;
  const tz = t?.timezone ?? 'Africa/Nairobi';
  const today = DateTime.now().setZone(tz).startOf('day');
  const r = sp.r ?? '30';
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? DateTime.fromISO(v, { zone: tz }) : null);
  const from = r === 'today' ? today : r === 'custom' ? day(sp.from) : today.minus({ days: (Number(r) || 30) - 1 });
  const to = r === 'custom' ? (day(sp.to)?.plus({ days: 1 }) ?? null) : null;
  const page = Math.max(1, Math.floor(Number(sp.pg)) || 1);
  const { rows, count, people } = await clubAudit(s.tid, {
    from: from?.toJSDate() ?? null,
    to: to?.toJSDate() ?? null,
    cat: sp.c ?? '',
    who: sp.w ?? '',
    limit: PER,
    offset: (page - 1) * PER,
  });
  const href = (n: number) => {
    const u = new URLSearchParams({ tab: 'audit' });
    for (const k of ['r', 'from', 'to', 'c', 'w'] as const) if (sp[k]) u.set(k, sp[k] as string);
    if (n > 1) u.set('pg', String(n));
    return `/settings?${u}`;
  };
  const dayOf = (d: Date) => DateTime.fromJSDate(d).setZone(tz);
  const label = (d: DateTime) =>
    d.hasSame(today, 'day')
      ? 'Today'
      : d.hasSame(today.minus({ days: 1 }), 'day')
        ? 'Yesterday'
        : d.toFormat('cccc d LLLL');
  return (
    <>
      <SectionHead icon={History} title="System audit" sub="Every sign-in and change in the club, newest first." />
      <AuditFilters
        cats={Object.entries(AUDIT_CATS).map(([key, v]) => ({ key, label: v.label }))}
        people={people.sort((a, b) => Number(a.partner) - Number(b.partner) || a.name.localeCompare(b.name))}
      />
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#E5E8EE] px-5 py-14 text-center text-[13px] text-ink-500">
          Nothing in this period.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#E7EBF3]">
          {rows.map((x, i) => {
            const d = dayOf(x.at);
            const prev = rows[i - 1];
            const head = !prev || !dayOf(prev.at).hasSame(d, 'day');
            const e = describe(x);
            const L = LOOK[e.cat];
            const I = L.icon;
            const system = e.text.startsWith('· ');
            const text = system ? e.text.slice(2) : e.text;
            return (
              <div key={`${x.at.toISOString()}${x.kind}${i}`}>
                {head && (
                  <div className="border-b border-[#EEF1F6] bg-[#FAFBFC] px-4 py-2 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                    {label(d)}
                  </div>
                )}
                <div className="flex items-center gap-3 border-b border-[#F0F2F6] px-4 py-3 last:border-b-0">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${L.tone}`}>
                    <I size={16} />
                  </span>
                  <div className="min-w-0 flex-1 text-[13.5px]">
                    {system ? (
                      <span className="text-ink-900">{text.charAt(0).toUpperCase() + text.slice(1)}</span>
                    ) : (
                      <>
                        <b className="font-semibold text-ink-900">{x.who && x.who !== 'system' ? x.who : 'Lango'}</b>
                        {x.partner && (
                          <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-500">
                            Partner
                          </span>
                        )}{' '}
                        <span className="text-ink-700">{text}</span>
                      </>
                    )}
                    {e.detail && <div className="truncate text-[12px] text-ink-500">{e.detail}</div>}
                  </div>
                  <span className="shrink-0 text-[12.5px] text-ink-500 tabular-nums">{d.toFormat('HH:mm')}</span>
                </div>
              </div>
            );
          })}
          <Pager page={page} per={PER} total={count} noun="events" href={href} />
        </div>
      )}
    </>
  );
}
