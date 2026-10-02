'use client';
import { Loader2, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

/**
 * Search that filters as you type (no Enter) plus the service filter. Both update the URL in place, so the server
 * filters the whole club, the page stays shareable, and Back works. "/" jumps to the search box.
 */
export function MemberFilters({ services, total }: { services: string[]; total: number }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [pending, start] = useTransition();
  const box = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  const go = (patch: Record<string, string>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v ? u.set(k, v) : u.delete(k);
    u.delete('page');
    u.delete('n');
    const qs = u.toString();
    start(() => router.replace(qs ? `${path}?${qs}` : path, { scroll: false }));
  };

  // Debounce typing so the list updates a moment after the last key, not on every key.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (q.trim() === (sp.get('q') ?? '')) return;
    const t = setTimeout(() => go({ q: q.trim() }), 220);
    return () => clearTimeout(t);
  }, [q]);

  // A link elsewhere on the page (a summary tile, "Show all") may change the search; follow it.
  const urlQ = sp.get('q') ?? '';
  useEffect(() => {
    // Never while typing: a slower earlier search must not overwrite newer keystrokes.
    if (document.activeElement !== box.current && urlQ !== q.trim()) setQ(urlQ);
  }, [urlQ]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
        e.preventDefault();
        box.current?.focus();
      }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <label className="flex h-11 min-w-[220px] flex-1 items-center gap-2.5 rounded-xl border border-[#E5E8EE] bg-white px-3.5 text-ink-300 transition focus-within:border-slate-300 focus-within:shadow-[0_0_0_4px_rgba(15,23,42,0.05)]">
        {pending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        <input
          ref={box}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
          placeholder="Search name, number or phone"
          aria-label="Search members"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-300"
        />
        {q.trim() ? (
          <span className="whitespace-nowrap text-[12px] text-ink-500">
            {pending ? 'Searching…' : `${total} found`}
          </span>
        ) : (
          <kbd className="hidden rounded-md border border-[#E5E8EE] px-1.5 text-[11px] font-semibold text-ink-300 sm:block">
            /
          </kbd>
        )}
      </label>
      {services.length > 1 && (
        <select
          aria-label="Service"
          value={sp.get('service') ?? ''}
          onChange={(e) => go({ service: e.target.value })}
          className="h-11 rounded-xl border border-[#E5E8EE] bg-white px-3 text-[13px] font-medium text-ink-700 outline-none focus:border-slate-300"
        >
          <option value="">All services</option>
          {services.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
