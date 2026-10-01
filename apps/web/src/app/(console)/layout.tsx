import { Nav } from '@/components/nav';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const [t] = await db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`;
  return (
    <div className="min-h-screen">
      <Nav tenant={t?.name ?? ''} user={s.name} role={s.role} />
      <main className="px-5 py-8 lg:ml-64 lg:px-10">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}
