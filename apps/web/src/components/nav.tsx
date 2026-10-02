'use client';
import {
  ArrowLeftRight,
  ChartColumn,
  CircleUserRound,
  CreditCard,
  DoorOpen,
  Layers,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Plug,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LangoMark } from '@/components/logo';

/** Each page and the permissions that open it (any one is enough). Pages a role cannot use are not shown. */
export const ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, any: [] },
  { href: '/members', label: 'Members', icon: Users, any: ['members.view'] },
  { href: '/services', label: 'Services', icon: Layers, any: ['plans.manage', 'reports.all'] },
  { href: '/access', label: 'Doors & access', icon: DoorOpen, any: ['doors.manage'] },
  {
    href: '/payments',
    label: 'Payments',
    icon: CreditCard,
    any: ['payments.record', 'payments.assign', 'reports.all'],
  },
  { href: '/reports', label: 'Reports', icon: ChartColumn, any: ['reports.all'] },
  { href: '/communications', label: 'Communications', icon: MessageSquare, any: ['inbox.reply', 'messages.manage'] },
  {
    href: '/settings',
    label: 'Settings',
    icon: SlidersHorizontal,
    any: ['settings.payments', 'sms.buy', 'messages.manage', 'team.manage'],
  },
];

/** The page the path belongs to (longest matching item), for the top bar title and page header icon. */
export function pageFor(path: string) {
  if (path.startsWith('/account')) return { href: '/account', label: 'Your account', icon: CircleUserRound };
  return ITEMS.filter((i) => (i.href === '/' ? path === '/' : path.startsWith(i.href))).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}

export function Nav({
  tenant,
  user,
  roleLabel,
  perms,
  partner,
  platform,
  switchClubs,
}: {
  tenant: string;
  user: string;
  roleLabel: string;
  perms: string[];
  partner?: boolean;
  platform?: boolean;
  switchClubs?: boolean;
}) {
  const path = usePathname();
  const items = ITEMS.filter((i) => i.any.length === 0 || i.any.some((p) => perms.includes(p)));
  const on = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <>
      <header className="sticky top-0 z-20 bg-ink-950 text-ink-300 lg:hidden print:hidden">
        <div className="flex items-center gap-2.5 px-4 pt-3">
          <LangoMark size={26} />
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-white">{tenant}</div>
          {(switchClubs || partner) && (
            <Link href={partner ? '/partner' : '/choose'} className="text-xs text-ink-300" aria-label="Switch club">
              <ArrowLeftRight size={16} />
            </Link>
          )}
        </div>
        <nav className="flex gap-4 overflow-x-auto px-4 pb-3 pt-2.5 text-[13px]">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 whitespace-nowrap ${on(href) ? 'text-white' : ''}`}
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-ink-950 px-4 py-6 text-ink-300 lg:flex print:hidden">
        <div className="flex items-center gap-2.5 px-2">
          <LangoMark size={32} />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight text-white">Lango</div>
            <div className="truncate text-[11px] text-ink-500">{tenant}</div>
          </div>
        </div>
        <nav className="mt-10 flex flex-col gap-1">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${on(href) ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'}`}
            >
              <Icon size={17} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-xl bg-white/5 p-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-white">{user}</div>
              <div className="truncate text-[11px] text-ink-500">
                {partner ? `Partner · acting as ${roleLabel}` : roleLabel}
              </div>
            </div>
            <form action="/logout" method="post">
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 transition hover:bg-rose-500/15 hover:text-rose-400"
              >
                <LogOut size={16} />
              </button>
            </form>
          </div>
          {switchClubs && (
            <Link href="/choose" className="mt-3 flex items-center gap-2 text-xs text-ink-300 hover:text-white">
              <ArrowLeftRight size={14} /> Switch club
            </Link>
          )}
          {partner && (
            <Link href="/partner" className="mt-3 flex items-center gap-2 text-xs text-ink-300 hover:text-white">
              <ArrowLeftRight size={14} /> All clubs
            </Link>
          )}
          {platform && (
            <Link
              href="/partner/settings"
              className="mt-2 flex items-center gap-2 text-xs text-ink-300 hover:text-white"
            >
              <Plug size={14} /> SaaS console
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
