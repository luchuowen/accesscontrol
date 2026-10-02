'use client';
import {
  AlertTriangle,
  Bell,
  Check,
  CreditCard,
  MessageSquare,
  MessagesSquare,
  MonitorSmartphone,
  UserRoundX,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { HealthArea, HealthIcon } from '@/lib/alerts';

const ICON: Record<HealthIcon, typeof Bell> = {
  money: Wallet,
  card: CreditCard,
  door: MonitorSmartphone,
  alert: AlertTriangle,
  users: Users,
  away: UserRoundX,
  sms: MessageSquare,
  chat: MessagesSquare,
};
const TONE = {
  red: 'bg-rose-50 text-rose-600',
  amber: 'bg-amber-50 text-amber-600',
  blue: 'bg-sky-50 text-sky-600',
};

/**
 * The bell and its Club health drawer (design C): every area this person can act in, what needs them in each, and a
 * plain "All good" for the rest. Refreshes every minute while the tab is visible.
 */
export function HealthBell({ areas }: { areas: HealthArea[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const path = usePathname();
  const count = areas.reduce((n, a) => n + a.items.length, 0);
  const urgent = areas.some((a) => a.items.some((i) => i.tone === 'red'));
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  return (
    <>
      <button
        type="button"
        aria-label={count ? `Club health: ${count} to look at` : 'Club health: all good'}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`relative grid h-9 w-9 place-items-center rounded-full text-ink-700 transition hover:bg-slate-100 ${open ? 'bg-slate-100' : ''}`}
      >
        <Bell size={19} />
        {count > 0 && (
          <span
            className={`absolute -right-0.5 top-0.5 grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white ${urgent ? 'bg-rose-600' : 'bg-amber-500'}`}
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 print:hidden">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink-950/30 animate-[fadein_.15s_ease-out]"
          />
          <aside
            role="dialog"
            aria-label="Club health"
            className="absolute inset-y-0 right-0 flex w-[min(400px,100vw)] flex-col bg-white shadow-[-16px_0_40px_-20px_rgba(11,22,41,0.35)] animate-[slidein_.18s_ease-out]"
          >
            <header className="flex items-start gap-3 border-b border-[#EEF1F6] px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] font-semibold">Club health</h2>
                <p className="text-[12.5px] text-ink-500">
                  {count ? `${count} thing${count === 1 ? '' : 's'} to look at` : 'Everything is running'} · updated
                  just now
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-slate-100"
              >
                <X size={17} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {areas.map((a) => (
                <section key={a.name} className="border-b border-[#EEF1F6] px-5 py-3.5">
                  <div className="flex items-center text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-500">
                    {a.name}
                    {a.items.length ? (
                      <span className="ml-auto rounded-full bg-rose-50 px-2 py-0.5 text-[11px] normal-case tracking-normal text-rose-700">
                        {a.items.length}
                      </span>
                    ) : (
                      <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold normal-case tracking-normal text-emerald-700">
                        <Check size={13} strokeWidth={2.6} /> All good
                      </span>
                    )}
                  </div>
                  {a.items.map((i) => {
                    const I = ICON[i.icon];
                    return (
                      <Link
                        key={i.id}
                        href={i.href}
                        onClick={() => setOpen(false)}
                        className="group mt-2.5 flex items-start gap-3 rounded-xl p-2 -mx-2 hover:bg-[#F7F8FA]"
                      >
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${TONE[i.tone]}`}>
                          <I size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <b className="block text-[13.5px] font-semibold leading-snug text-ink-900">{i.title}</b>
                          <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-500">{i.sub}</span>
                        </span>
                        <span
                          className={`shrink-0 self-center rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ${i.tone === 'red' ? 'bg-ink-900 text-white' : 'ring-1 ring-[#E1E5EC] text-ink-900 group-hover:bg-white'}`}
                        >
                          {i.action}
                        </span>
                      </Link>
                    );
                  })}
                </section>
              ))}
              {areas.length === 0 && (
                <p className="px-5 py-10 text-center text-[13px] text-ink-500">Nothing here for your role.</p>
              )}
            </div>
            <footer className="border-t border-[#EEF1F6] px-5 py-3 text-[11.5px] text-ink-500">
              Shows what your role can act on. Items clear themselves once fixed.
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
