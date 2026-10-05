'use client';
import { Building2, CircleUserRound, Handshake, LayoutDashboard, Settings2, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGES = [
  { href: '/partner/clubs', label: 'Clubs', icon: Building2 },
  { href: '/partner/new', label: 'Clubs', icon: Building2 },
  { href: '/partner/partners', label: 'Users', icon: UsersRound },
  { href: '/partner/terms', label: 'Partner terms', icon: Handshake },
  { href: '/partner/settings', label: 'Platform settings', icon: Settings2 },
  { href: '/partner/account', label: 'Your account', icon: CircleUserRound },
];

/** The partner console's top bar, as in the club console: the page's icon and name, and the signed-in person. */
export function PartnerTopBar({ name }: { name: string }) {
  const path = usePathname();
  const page = PAGES.find((p) => path.startsWith(p.href)) ?? { label: 'Home', icon: LayoutDashboard };
  const Icon = page.icon;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <header className="sticky top-0 z-20 hidden h-14 items-center gap-2.5 border-b border-[#EEF1F6] bg-white/95 px-10 backdrop-blur lg:ml-64 lg:flex print:hidden">
      <Icon size={18} className="text-brand-500" />
      <span className="text-[16px] font-semibold">{page.label}</span>
      <Link
        href="/partner/account"
        aria-label="Your account"
        className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-[#EEF1F6] text-[12px] font-bold text-ink-900 hover:bg-[#E2E7EF]"
      >
        {initials}
      </Link>
    </header>
  );
}
