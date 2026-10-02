'use client';
import { Building2, CircleUserRound, LogOut, Settings2, UsersRound } from 'lucide-react';
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
    {
      href: '/partner',
      label: 'Clubs',
      icon: Building2,
      on: path === '/partner' || path.startsWith('/partner/new') || path.startsWith('/partner/clubs'),
    },
    ...(people
      ? [{ href: '/partner/partners', label: 'People', icon: UsersRound, on: path.startsWith('/partner/partners') }]
      : []),
    ...(platform
      ? [
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
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-[#0B1629] px-3.5 py-5 text-[#C9D1DE] lg:flex print:hidden">
        <div className="flex items-center gap-2.5 px-2 pb-6">
          <LangoMark size={32} />
          <div>
            <div className="text-sm font-semibold text-white">Lango</div>
            <div className="text-[11px] text-[#7B8799]">{subtitle}</div>
          </div>
        </div>
        <div className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[#5D6A7E]">Platform</div>
        <nav className="flex flex-col gap-0.5">
          {items.map(({ href, label, icon: Icon, on }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition ${on ? 'bg-white/[0.08] text-white' : 'hover:bg-white/[0.05] hover:text-white'}`}
            >
              <Icon size={16} className={on ? 'text-[#10B981]' : 'text-[#5D6A7E]'} />
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
            <button type="submit" className="flex items-center gap-1.5 text-xs text-[#7B8799] hover:text-white">
              <LogOut size={13} /> Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
