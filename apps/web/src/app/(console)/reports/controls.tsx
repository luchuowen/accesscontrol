'use client';

import { CalendarDays, ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { PERIODS } from '@/lib/periods';

export function PeriodSelect({ days }: { days: number }) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  return (
    <label
      className={`flex h-10 items-center gap-2 rounded-xl border border-[#E5E8EE] bg-white pl-3 text-[13px] ${pending ? 'opacity-60' : ''}`}
    >
      <CalendarDays size={15} className="text-ink-500" />
      <select
        aria-label="Period"
        value={days}
        onChange={(e) => start(() => router.replace(`${path}?p=${e.target.value}`, { scroll: false }))}
        className="h-full cursor-pointer appearance-none bg-transparent pr-8 font-medium outline-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2398A2B3' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 10px center',
        }}
      >
        {PERIODS.map(([d, l]) => (
          <option key={d} value={d}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Export one section (or everything): Excel, CSV, or a print-ready PDF of just that part of the page. */
export function ExportMenu({
  section,
  primary,
}: {
  section: 'all' | 'money' | 'members' | 'walkins';
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sp = useSearchParams();
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  const href = (f: string) => `/reports/export?f=${f}&s=${section}&p=${sp.get('p') ?? '30'}`;
  const pdf = () => {
    setOpen(false);
    if (section !== 'all') document.body.dataset.print = section;
    const done = () => {
      delete document.body.dataset.print;
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-slate-50';
  return (
    <div ref={ref} className="relative print:hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={primary ? 'btn-primary' : 'btn-ghost px-3 py-1.5 text-[12.5px]'}
      >
        <Download size={primary ? 15 : 13} /> {primary ? 'Export all' : 'Export'} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-[#E7EBF3] bg-white p-1.5 shadow-lg">
          <a href={href('xlsx')} className={item}>
            <FileSpreadsheet size={15} /> Excel <span className="ml-auto text-[11.5px] text-ink-500">.xlsx</span>
          </a>
          {section !== 'all' && (
            <a href={href('csv')} className={item}>
              <FileText size={15} /> CSV <span className="ml-auto text-[11.5px] text-ink-500">.csv</span>
            </a>
          )}
          <button type="button" onClick={pdf} className={item}>
            <FileText size={15} /> PDF <span className="ml-auto text-[11.5px] text-ink-500">print-ready</span>
          </button>
        </div>
      )}
    </div>
  );
}
