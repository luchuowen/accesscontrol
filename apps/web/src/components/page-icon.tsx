'use client';
import { usePathname } from 'next/navigation';
import { pageFor } from '@/components/nav';

/** The current page's icon in a soft tile, beside the page title (console pages only). */
export function PageIcon() {
  const path = usePathname();
  const Icon = path.startsWith('/partner') ? undefined : pageFor(path)?.icon;
  if (!Icon) return null;
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#0B1629] text-[#34D399]">
      <Icon size={20} />
    </span>
  );
}
