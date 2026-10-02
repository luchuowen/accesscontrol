'use client';
import {
  Activity,
  ArrowLeftRight,
  CreditCard,
  DoorOpen,
  Layers,
  LayoutDashboard,
  LogOut,
  Plug,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/members', label: 'Members', icon: Users },
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/plans', label: 'Plans & pricing', icon: Layers },
  { href: '/access', label: 'Doors & access', icon: DoorOpen },
  { href: '/settings', label: 'Settings', icon: Plug },
];

export function Nav({
  tenant,
  user,
  role,
  partner,
}: {
  tenant: string;
  user: string;
  role: string;
  partner?: boolean;
}) {
  const path = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-ink-950 px-4 py-6 text-ink-300 lg:flex">
      <div className="flex items-center gap-2.5 px-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-ink-950">
          <Activity size={18} strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-[15px] font-semibold tracking-tight text-white">Lango</div>
          <div className="text-[11px] text-ink-500">{tenant}</div>
        </div>
      </div>
      <nav className="mt-10 flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const on = href === '/' ? path === '/' : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${on ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'}`}
            >
              <Icon size={17} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-xl bg-white/5 p-3">
        <div className="text-sm text-white">{user}</div>
        <div className={`text-[11px] text-ink-500 ${partner ? '' : 'capitalize'}`}>
          {partner ? 'Partner · acting as owner' : role}
        </div>
        {partner && (
          <Link href="/partner" className="mt-3 flex items-center gap-2 text-xs text-ink-300 hover:text-white">
            <ArrowLeftRight size={14} /> All clubs
          </Link>
        )}
        <form action="/logout" method="post" className="mt-3">
          <button type="submit" className="flex items-center gap-2 text-xs text-ink-300 hover:text-white">
            <LogOut size={14} /> Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
