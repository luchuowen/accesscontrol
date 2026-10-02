import { can, roleLabel } from '@lango/server';
import type { Theme } from '@/components/account-card';
import { Nav } from '@/components/nav';
import { TopBar } from '@/components/topbar';
import { clubHealth } from '@/lib/alerts';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const [[t], [plat], alerts, [me]] = await Promise.all([
    db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`,
    s.partner ? db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok` : Promise.resolve([]),
    clubHealth(s),
    db()<{ avatar: string | null; theme: Theme }[]>`select avatar, theme from app_staff_profile(${s.uid})`,
  ]);
  const theme = me?.theme ?? 'system';
  const role = s.partner ? `Partner · acting as ${roleLabel(s.role)}` : roleLabel(s.role);
  return (
    <div className="min-h-screen">
      <Nav
        tenant={t?.name ?? ''}
        user={s.name}
        roleLabel={roleLabel(s.role)}
        perms={s.perms}
        partner={s.partner}
        platform={!!plat?.ok}
      />
      {/* Set the theme before the page paints, so dark mode never flashes light. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(t){var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.mode=d?'dark':'light';document.documentElement.dataset.theme=t})(${JSON.stringify(theme)})`,
        }}
      />
      <TopBar
        user={s.name}
        roleLabel={role}
        health={alerts}
        canSearch={can(s, 'members.view')}
        perms={s.perms}
        avatar={me?.avatar ?? null}
        theme={theme}
      />
      <main data-console className="px-5 py-8 lg:ml-64 lg:px-10 print:ml-0 print:p-0">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}
