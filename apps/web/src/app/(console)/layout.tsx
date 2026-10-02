import { myClubs, roleLabel } from '@lango/server';
import { Nav } from '@/components/nav';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const [[t], clubs, [plat]] = await Promise.all([
    db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`,
    s.partner ? Promise.resolve([]) : myClubs(db(), s.uid),
    s.partner ? db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok` : Promise.resolve([]),
  ]);
  return (
    <div className="min-h-screen">
      <Nav
        tenant={t?.name ?? ''}
        user={s.name}
        roleLabel={roleLabel(s.role)}
        perms={s.perms}
        partner={s.partner}
        platform={!!plat?.ok}
        switchClubs={clubs.length > 1}
      />
      <main className="px-5 py-8 lg:ml-64 lg:px-10 print:ml-0 print:p-0">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}
