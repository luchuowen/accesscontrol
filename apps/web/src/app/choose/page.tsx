import { myClubs, roleLabel } from '@lango/server';
import { ChevronRight } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AuthHeading, AuthShell } from '@/components/auth-shell';
import { getSession } from '@/lib/session';
import { db } from '@/server/db';
import { chooseClub } from '../login/actions';

export const metadata = { title: 'Choose a club · Lango' };

/** For people who work in more than one club: one login, a role per club. */
export default async function Choose() {
  const s = await getSession();
  if (!s) redirect('/login?m=signed-out');
  if (s.partner) redirect('/partner');
  const clubs = await myClubs(db(), s.uid);
  return (
    <AuthShell>
      <AuthHeading title="Choose a club" sub={`Signed in as ${s.email}. You can switch at any time from the menu.`} />
      <div className="mt-8 grid gap-2.5">
        {clubs.map((c) => (
          <form key={c.tenant_id} action={chooseClub}>
            <input type="hidden" name="tenantId" value={c.tenant_id} />
            <button
              type="submit"
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition hover:border-brand-500 hover:bg-emerald-50/40 ${c.tenant_id === s.tid ? 'border-brand-500' : 'border-slate-200'}`}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#0B1629] text-sm font-semibold text-white">
                {c.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-900">{c.name}</span>
                <span className="block text-xs text-slate-500">{roleLabel(c.role)}</span>
              </span>
              <ChevronRight size={16} className="text-slate-400" />
            </button>
          </form>
        ))}
        {clubs.length === 0 && (
          <p className="text-sm text-slate-600">
            You are not in any club at the moment. Ask the club’s owner to invite you again.
          </p>
        )}
      </div>
      <form action="/logout" method="post" className="mt-8 text-center">
        <button type="submit" className="text-[13px] text-slate-500 hover:text-ink-900">
          Sign out
        </button>
      </form>
    </AuthShell>
  );
}
