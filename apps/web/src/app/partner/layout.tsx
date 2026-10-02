import { Activity, LogOut } from 'lucide-react';
import Link from 'next/link';
import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePartner();
  const [plat] = await db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`;
  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-[1240px] items-center gap-3 px-5 py-4 lg:px-10">
          <Link href="/partner" className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-ink-950">
              <Activity size={18} strokeWidth={2.5} />
            </div>
            <span className="text-[15px] font-semibold tracking-tight">Lango · Partner</span>
          </Link>
          <div className="ml-auto flex items-center gap-5 text-sm text-ink-500">
            {plat?.ok && (
              <Link href="/partner/settings" className="hover:text-ink-900">
                SaaS console
              </Link>
            )}
            <span>{s.name}</span>
          </div>
          <form action="/logout" method="post">
            <button type="submit" className="flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-900">
              <LogOut size={14} /> Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-[1240px] px-5 py-8 lg:px-10">{children}</main>
    </div>
  );
}
