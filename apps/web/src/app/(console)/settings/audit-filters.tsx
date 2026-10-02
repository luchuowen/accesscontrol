'use client';
import { CalendarDays } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

const RANGES = [
  ['today', 'Today'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['custom', 'Pick dates'],
] as const;

/** Date range, area and person for the System audit; every change goes back to page 1. */
export function AuditFilters({
  cats,
  people,
}: {
  cats: { key: string; label: string }[];
  people: { id: string; name: string; partner: boolean }[];
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const go = (patch: Record<string, string>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v ? u.set(k, v) : u.delete(k);
    u.set('tab', 'audit');
    u.delete('pg');
    start(() => router.replace(`${path}?${u}`, { scroll: false }));
  };
  const range = sp.get('r') ?? '30';
  const sel = 'h-10 rounded-xl border border-[#E5E8EE] bg-white px-3 text-[13px] font-medium text-ink-900 outline-none';
  return (
    <div className={`mb-5 flex flex-wrap items-center gap-2 ${pending ? 'opacity-60' : ''}`}>
      <div className="flex h-10 items-center gap-1 rounded-xl bg-[#F2F4F8] p-1">
        {RANGES.map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => go({ r: k === '30' ? '' : k, from: '', to: '' })}
            className={`h-8 rounded-lg px-3 text-[12.5px] font-semibold ${range === k ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}
          >
            {l}
          </button>
        ))}
      </div>
      {range === 'custom' && (
        <span className="flex items-center gap-1.5 text-[13px] text-ink-500">
          <CalendarDays size={15} />
          <input
            type="date"
            aria-label="From"
            defaultValue={sp.get('from') ?? ''}
            onChange={(e) => go({ r: 'custom', from: e.target.value })}
            className={sel}
          />
          to
          <input
            type="date"
            aria-label="To"
            defaultValue={sp.get('to') ?? ''}
            onChange={(e) => go({ r: 'custom', to: e.target.value })}
            className={sel}
          />
        </span>
      )}
      <select
        aria-label="Events"
        value={sp.get('c') ?? ''}
        onChange={(e) => go({ c: e.target.value })}
        className={`${sel} ml-auto`}
      >
        <option value="">All events</option>
        {cats.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      <select aria-label="Person" value={sp.get('w') ?? ''} onChange={(e) => go({ w: e.target.value })} className={sel}>
        <option value="">Everyone</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.partner ? ' · partner' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
