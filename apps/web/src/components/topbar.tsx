'use client';
import { Bell, CircleHelp, CircleUserRound, LogOut, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { pageFor } from '@/components/nav';

export type Alert = { text: string; meta?: string; href?: string; tone: 'red' | 'amber' };

/** Opens one small panel under a bar button; closes on outside click or Escape. */
function Menu({ button, label, children }: { button: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-9 w-9 place-items-center rounded-full text-ink-700 transition hover:bg-slate-100"
      >
        {button}
      </button>
      {open && (
        <div
          onClick={(e) => (e.target as HTMLElement).closest('a,button') && setOpen(false)}
          className="absolute right-0 top-11 z-30 w-72 rounded-xl border border-[#E5E8EE] bg-white p-1.5 text-sm shadow-[0_12px_32px_-12px_rgba(11,22,41,0.25)]"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function TopBar({
  user,
  roleLabel,
  alerts,
  canSearch,
}: {
  user: string;
  roleLabel: string;
  alerts: Alert[];
  canSearch: boolean;
}) {
  const path = usePathname();
  const page = pageFor(path);
  const [searching, setSearching] = useState(false);
  const initials = user
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  const Icon = page?.icon;
  return (
    <header className="z-20 flex h-14 items-center gap-1.5 border-b border-[#E5E8EE] bg-white px-5 lg:sticky lg:top-0 lg:ml-64 lg:px-10 print:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 text-[15.5px] font-semibold text-ink-900">
        {Icon && <Icon size={18} className="shrink-0 text-brand-600" />}
        <span className="truncate">{page?.label}</span>
      </div>
      {canSearch &&
        (searching ? (
          <form action="/members" className="relative">
            <Search size={15} className="absolute left-3 top-2.5 text-ink-300" />
            <input
              name="q"
              autoFocus
              onBlur={(e) => !e.target.value && setSearching(false)}
              placeholder="Name, number or phone"
              className="h-9 w-48 rounded-full border border-[#E5E8EE] bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-brand-500 sm:w-64"
            />
          </form>
        ) : (
          <button
            type="button"
            aria-label="Search members"
            onClick={() => setSearching(true)}
            className="grid h-9 w-9 place-items-center rounded-full text-ink-700 transition hover:bg-slate-100"
          >
            <Search size={19} />
          </button>
        ))}
      <Menu
        label={alerts.length ? `${alerts.length} alerts` : 'Alerts'}
        button={
          <>
            <Bell size={19} />
            {alerts.length > 0 && (
              <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-rose-600 ring-2 ring-white" />
            )}
          </>
        }
      >
        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Needs attention
        </div>
        {alerts.length === 0 && <div className="px-2.5 py-2 text-ink-500">All clear</div>}
        {alerts.map((a) => {
          const body = (
            <>
              <span className={`h-2 w-2 shrink-0 rounded-full ${a.tone === 'red' ? 'bg-rose-600' : 'bg-amber-500'}`} />
              <span className="min-w-0 flex-1">{a.text}</span>
              {a.meta && <span className="font-mono text-[11.5px] text-slate-500">{a.meta}</span>}
            </>
          );
          return a.href ? (
            <Link
              key={a.text}
              href={a.href}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-50"
            >
              {body}
            </Link>
          ) : (
            <div key={a.text} className="flex items-center gap-2.5 px-2.5 py-2">
              {body}
            </div>
          );
        })}
      </Menu>
      <Menu label="Help" button={<CircleHelp size={19} />}>
        <div className="px-2.5 py-2">
          <div className="font-semibold text-ink-900">Need help?</div>
          <div className="mt-0.5 text-ink-500">
            Email <span className="select-all text-ink-900">support@navac.co.ke</span>
          </div>
        </div>
      </Menu>
      <Menu
        label="Your profile"
        button={
          <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-ink-700">
            {initials || <CircleUserRound size={18} />}
          </span>
        }
      >
        <div className="border-b border-slate-100 px-2.5 pb-2 pt-1.5">
          <div className="truncate font-semibold text-ink-900">{user}</div>
          <div className="text-xs text-ink-500">{roleLabel}</div>
        </div>
        <Link href="/account" className="mt-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-50">
          <CircleUserRound size={16} className="text-ink-500" /> Your account
        </Link>
        <form action="/logout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50"
          >
            <LogOut size={16} className="text-ink-500" /> Sign out
          </button>
        </form>
      </Menu>
    </header>
  );
}
