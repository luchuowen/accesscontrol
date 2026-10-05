'use client';
import { Building2, CircleUserRound, Handshake, LayoutDashboard, LogOut, Settings2, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LangoMark } from '@/components/logo';

/** NAVAC console sidebar (deep navy, emerald accent: the NAVAC BMS look). */
export function PartnerNav({
  name,
  platform,
  people,
  subtitle,
}: {
  name: string;
  platform: boolean;
  people: boolean;
  subtitle: string;
}) {
  const path = usePathname();
  const items = [
    { href: '/partner', label: 'Home', icon: LayoutDashboard, on: path === '/partner' },
    {
      href: '/partner/clubs',
      label: 'Clubs',
      icon: Building2,
      on: path.startsWith('/partner/new') || path.startsWith('/partner/clubs'),
    },
    ...(people
      ? [{ href: '/partner/partners', label: 'Users', icon: UsersRound, on: path.startsWith('/partner/partners') }]
      : []),
    ...(platform
      ? [
          { href: '/partner/terms', label: 'Partner terms', icon: Handshake, on: path.startsWith('/partner/terms') },
          {
            href: '/partner/settings',
            label: 'Platform settings',
            icon: Settings2,
            on: path.startsWith('/partner/settings'),
          },
        ]
      : []),
  ];
  return (
    <>
      <header className="flex items-center gap-4 overflow-x-auto bg-[#0B1629] px-4 py-3 text-[13px] text-[#C9D1DE] lg:hidden print:hidden">
        <LangoMark size={28} className="shrink-0" />
        {items.map(({ href, label, on }) => (
          <Link key={href} href={href} className={`whitespace-nowrap ${on ? 'text-white' : ''}`}>
            {label}
          </Link>
        ))}
        <Link href="/partner/account" className="ml-auto shrink-0" aria-label="Your account">
          <CircleUserRound size={18} />
        </Link>
      </header>
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-[#0B1629] px-4 py-5 text-[#C9D1DE] lg:flex print:hidden">
        <div className="flex items-center gap-2.5 px-2 pb-6">
          <LangoMark size={32} />
          <div>
            <div className="text-sm font-semibold text-white">Lango</div>
            <div className="text-[11px] text-[#7B8799]">{subtitle}</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {items.map(({ href, label, icon: Icon, on }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition ${on ? 'bg-white/[0.08] text-white' : 'hover:bg-white/[0.05] hover:text-white'}`}
            >
              <Icon size={18} className={on ? 'text-white' : 'text-[#8E9AB3]'} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-xl bg-white/[0.05] p-3">
          <Link href="/partner/account" className="block truncate text-[13px] text-white hover:underline">
            {name}
          </Link>
          <Link
            href="/partner/account"
            className="mt-2 flex items-center gap-1.5 text-xs text-[#7B8799] hover:text-white"
          >
            <CircleUserRound size={13} /> Your account
          </Link>
          <form action="/logout" method="post" className="mt-1.5">
            <button type="submit" className="flex items-center gap-1.5 text-xs text-[#7B8799] hover:text-rose-400">
              <LogOut size={13} /> Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
