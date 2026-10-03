import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';
import { PartnerNav } from './nav';
import { PartnerTopBar } from './topbar';

export const dynamic = 'force-dynamic';

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePartner();
  const [plat] = await db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`;
  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      <PartnerNav
        name={s.name}
        platform={!!plat?.ok}
        people={s.kind === 'partner_admin'}
        subtitle={
          plat?.ok
            ? 'NAVAC SaaS console'
            : s.kind === 'navac_support'
              ? 'NAVAC support'
              : s.kind === 'partner_tech'
                ? 'Technician'
                : 'Partner console'
        }
      />
      <PartnerTopBar name={s.name} />
      <main className="px-5 py-8 lg:ml-64 lg:px-10">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}
