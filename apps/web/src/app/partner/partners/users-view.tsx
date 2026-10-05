'use client';
import { Search, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { assignTechClubs, resendPartnerInvite, setPartnerActive } from '../actions';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  org: string;
  orgId: string | null;
  status: 'active' | 'pending' | 'deactivated';
  clubs: string[];
  you: boolean;
}
export interface Org {
  name: string;
  id: string | null;
  platform: boolean;
  users: number;
  clubs: number | null;
  pending: number;
}
interface Club {
  id: string;
  name: string;
  partner_id: string | null;
}

const STATUS = {
  active: ['Active', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  pending: ['Pending', 'bg-amber-50 text-amber-800 ring-amber-200'],
  deactivated: ['Deactivated', 'bg-slate-100 text-ink-500 ring-ink-100'],
} as const;
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Users (design B "Organizations first"): organization cards that filter the users table below them. */
export function UsersView({
  users,
  orgs,
  clubs,
  platform,
}: {
  users: UserRow[];
  orgs: Org[];
  clubs: Club[];
  platform: boolean;
}) {
  const [org, setOrg] = useState<string | null>(orgs.length > 1 ? null : (orgs[0]?.name ?? null));
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users.filter(
      (u) => (!org || u.org === org) && (!s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)),
    );
  }, [users, org, q]);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {orgs.map((o) => (
          <button
            key={o.name}
            type="button"
            onClick={() => setOrg(org === o.name ? null : o.name)}
            aria-pressed={org === o.name}
            className={`grid gap-2.5 rounded-xl border bg-white px-4 py-3.5 text-left transition hover:border-ink-300 ${org === o.name ? 'border-ink-900 ring-1 ring-ink-900' : 'border-[#E4E8EF]'}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-[15px] font-semibold">{o.name}</span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${o.platform ? 'bg-slate-100 text-ink-700' : 'bg-emerald-50 text-emerald-700'}`}
              >
                {o.platform ? 'Platform' : 'Partner'}
              </span>
            </span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-500">
              <span>
                <b className="tabular-nums text-ink-900">{o.users}</b> {o.users === 1 ? 'user' : 'users'}
              </span>
              <span>
                <b className="tabular-nums text-ink-900">{o.clubs ?? 'All'}</b> {o.clubs === 1 ? 'club' : 'clubs'}
              </span>
              {o.pending > 0 && (
                <span>
                  <b className="tabular-nums text-amber-700">{o.pending}</b> pending
                </span>
              )}
            </span>
          </button>
        ))}
        {platform && (
          <div className="grid place-content-center rounded-xl border border-dashed border-[#D5DBE5] px-4 py-3.5 text-center text-[12.5px] text-ink-500">
            A new partner organization appears here when you invite its first admin.
          </div>
        )}
      </div>

      <section className="overflow-hidden rounded-xl border border-[#E4E8EF] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E4E8EF] px-3.5 py-3">
          <div className="flex flex-wrap gap-1">
            {orgs.length > 1 && (
              <Tab on={!org} onClick={() => setOrg(null)}>
                All <span className="tabular-nums text-ink-500">{users.length}</span>
              </Tab>
            )}
            {orgs.map((o) => (
              <Tab key={o.name} on={org === o.name} onClick={() => setOrg(o.name)}>
                {o.name} <span className="tabular-nums text-ink-500">{o.users}</span>
              </Tab>
            ))}
          </div>
          <label className="flex h-9 w-full items-center gap-2 rounded-[9px] border border-[#E5E8EE] px-2.5 text-ink-300 focus-within:border-slate-300 sm:w-64">
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or email"
              aria-label="Search users"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-900 outline-none placeholder:text-ink-300"
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="border-b border-[#E4E8EF] text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Organization</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Clubs</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F6]">
              {shown.map((u) => (
                <tr key={u.id} className={u.status === 'deactivated' ? 'text-ink-500' : ''}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-ink-700">
                        {initials(u.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {u.name}
                          {u.you && <span className="ml-1.5 text-xs font-normal text-ink-500">(you)</span>}
                        </div>
                        <div className="truncate text-xs text-ink-500">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{u.org}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                      {u.roleLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ClubsCell user={u} clubs={clubs} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STATUS[u.status][1]}`}>
                      {STATUS[u.status][0]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RowAction user={u} />
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-500">
                    No users match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1.5 text-[12.5px] ${on ? 'bg-slate-100 font-semibold text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}
    >
      {children}
    </button>
  );
}

function RowAction({ user: u }: { user: UserRow }) {
  if (u.you) return null;
  const btn = 'text-xs font-semibold text-ink-500 hover:text-ink-900';
  if (u.status === 'pending')
    return (
      <form action={resendPartnerInvite}>
        <input type="hidden" name="staffId" value={u.id} />
        <button type="submit" className={btn}>
          Resend invite
        </button>
      </form>
    );
  return (
    <form action={setPartnerActive}>
      <input type="hidden" name="staffId" value={u.id} />
      <input type="hidden" name="active" value={u.status === 'active' ? 'false' : 'true'} />
      <button type="submit" className={btn}>
        {u.status === 'active' ? 'Deactivate' : 'Reactivate'}
      </button>
    </form>
  );
}

function ClubsCell({ user: u, clubs }: { user: UserRow; clubs: Club[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  if (u.role === 'navac_support') return <span className="text-ink-500">All clubs, read-only</span>;
  if (!u.orgId) return <span className="text-ink-500">All clubs</span>;
  const mine = clubs.filter((c) => c.partner_id === u.orgId);
  if (u.role !== 'partner_tech')
    return (
      <span className="text-ink-500">
        All {u.org} clubs <span className="tabular-nums">({mine.length})</span>
      </span>
    );
  return (
    <>
      <span>{u.clubs.length ? u.clubs.join(', ') : <span className="text-ink-500">None yet</span>}</span>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="ml-2 text-xs font-semibold text-ink-500 hover:text-ink-900"
      >
        Assign
      </button>
      <dialog
        ref={ref}
        aria-label={`Clubs for ${u.name}`}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-full max-w-[420px] rounded-[18px] bg-white p-0 text-ink-900 shadow-[0_30px_80px_-20px_rgba(11,22,41,0.55)] backdrop:bg-[#0B1629]/45"
      >
        <form action={assignTechClubs} className="grid gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">Assign clubs</h3>
              <p className="mt-0.5 text-[13px] text-ink-500">{u.name} sees only the clubs ticked here.</p>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-slate-100"
            >
              <X size={16} />
            </button>
          </div>
          <input type="hidden" name="staffId" value={u.id} />
          <div className="grid gap-1 rounded-xl p-1 ring-1 ring-ink-100">
            {mine.map((c) => (
              <label key={c.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-ink-50">
                <input
                  type="checkbox"
                  name="club"
                  value={c.id}
                  defaultChecked={u.clubs.includes(c.name)}
                  className="h-4 w-4 accent-ink-900"
                />
                {c.name}
              </label>
            ))}
            {!mine.length && <p className="px-2.5 py-2 text-sm text-ink-500">{u.org} has no clubs yet.</p>}
          </div>
          <SubmitButton pendingText="Saving…" className="btn-primary">
            Save clubs
          </SubmitButton>
        </form>
      </dialog>
    </>
  );
}
