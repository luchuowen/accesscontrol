import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';
import { PartnerNav } from './nav';

export const dynamic = 'force-dynamic';

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePartner();
  const [plat] = await db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`;
  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <PartnerNav name={s.name} platform={!!plat?.ok} />
      <main className="px-5 py-8 lg:ml-60 lg:px-9">
        <div className="mx-auto max-w-[1180px]">{children}</div>
      </main>
    </div>
  );
}
