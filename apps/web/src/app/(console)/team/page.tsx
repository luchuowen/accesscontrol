import { CLUB_ROLES, can, clubActivity, clubTeam, PERMISSIONS, roleDefaults, roleLabel } from '@lango/server';
import { Crown, ShieldCheck } from 'lucide-react';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader } from '@/components/ui';
import { ago, dateTime } from '@/lib/format';
import { requirePerm } from '@/lib/session';
import { db } from '@/server/db';
import { offerClub, remove, resend, setPerms, setRole } from './actions';
import { InviteForm } from './invite-form';

export const metadata = { title: 'Team · Lango' };

const MSG: Record<string, [tone: 'green' | 'amber' | 'red', text: string]> = {
  'invite-sent': ['green', 'A new invitation is on its way. The earlier link no longer works.'],
  'invite-failed': ['amber', 'That invitation could not be sent. It may already have been accepted or cancelled.'],
  'role-ok': ['green', 'Role changed. It applies the next time they open a page, and they were told by email.'],
  'role-denied': ['red', 'That change is not allowed. Only the owner can add or change admins.'],
  'perms-ok': ['green', 'Permissions saved for that person.'],
  'perms-denied': ['red', 'That change is not allowed. Only the owner can let someone manage the team.'],
  removed: ['green', 'Removed. They were signed out of this club at once; everything they did stays on record.'],
  'remove-denied': ['red', 'That person can’t be removed by you. Only the owner can remove an admin.'],
  'owner-offered': ['green', 'Ownership offered. Nothing changes until they accept from the email we sent them.'],
  'owner-denied': ['red', 'Ownership can only go to an admin who has accepted their invitation.'],
  'owner-password': ['red', 'Your password was not right, so nothing was sent.'],
  'owner-now': ['green', 'You are now the owner of this club.'],
  missing: ['amber', 'That person is no longer in this club.'],
};

const EVENT: Record<string, string> = {
  'signin.ok': 'signed in',
  'club.opened': 'opened the club',
  'invite.sent': 'was invited',
  'invite.accepted': 'accepted the invitation',
  'role.changed': 'had their role changed',
  'perms.changed': 'had their permissions changed',
  'member.removed': 'was removed',
  'ownership.offered': 'was offered ownership',
  'ownership.transferred': 'became the owner',
  'signout.everywhere': 'signed out everywhere',
  'password.changed': 'changed their password',
};

export default async function Team({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requirePerm('team.manage');
  const { m } = await searchParams;
  const msg = m ? MSG[m] : undefined;
  const [team, defaults, activity] = await Promise.all([
    clubTeam(db(), s.tid),
    roleDefaults(db()),
    clubActivity(db(), s.tid),
  ]);
  const iAmOwner = s.role === 'owner';
  const roles = CLUB_ROLES.filter((r) => r.key !== 'admin' || iAmOwner);
  const admins = team.filter((t) => t.role === 'admin' && t.accepted_at);
  const editable = (t: (typeof team)[number]) =>
    t.id !== s.uid && t.role !== 'owner' && (t.role !== 'admin' || iAmOwner);
  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Who can sign in to this club, and what each person may do. Changes apply on their next page."
      />
      {msg && (
        <div
          className={`mb-6 rounded-xl p-3 text-sm ring-1 ${msg[0] === 'green' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : msg[0] === 'amber' ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-rose-50 text-rose-700 ring-rose-200'}`}
        >
          {msg[1]}
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <section className="card divide-y divide-ink-100">
            {team.map((t) => {
              const def = defaults[t.role] ?? [];
              const effective = new Set(
                t.role === 'owner'
                  ? PERMISSIONS.map((p) => p.key)
                  : [...def, ...t.grants].filter((p) => !t.denies.includes(p)),
              );
              const tuned = t.grants.length + t.denies.length;
              return (
                <div key={t.id} className="p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink-50 text-sm font-semibold text-ink-700">
                      {t.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{t.name}</span>
                        {t.id === s.uid && <span className="text-xs text-ink-500">(you)</span>}
                        {!t.accepted_at && <Badge tone="amber">invited</Badge>}
                        {tuned > 0 && <Badge tone="blue">custom permissions</Badge>}
                      </div>
                      <div className="truncate text-xs text-ink-500">
                        {t.email}
                        {t.accepted_at
                          ? ` · ${t.last_seen ? `last active ${ago(t.last_seen)}` : 'not signed in yet'}`
                          : ` · invited ${dateTime(t.invited_at ?? t.member_since)}`}
                      </div>
                    </div>
                    {t.role === 'owner' ? (
                      <Badge tone="green">
                        <Crown size={11} /> Owner
                      </Badge>
                    ) : editable(t) ? (
                      <form action={setRole} className="flex items-center gap-2">
                        <input type="hidden" name="staffId" value={t.id} />
                        <select
                          name="role"
                          defaultValue={t.role}
                          aria-label={`Role for ${t.name}`}
                          className="input w-auto py-1.5 text-xs"
                        >
                          {roles.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="text-xs font-medium text-ink-500 hover:text-ink-900">
                          Save
                        </button>
                      </form>
                    ) : (
                      <Badge>{roleLabel(t.role)}</Badge>
                    )}
                  </div>
                  {editable(t) && (
                    <div className="mt-3 flex flex-wrap items-start gap-x-5 gap-y-2 pl-[52px] text-xs">
                      <details className="group w-full sm:w-auto">
                        <summary className="cursor-pointer list-none font-medium text-ink-500 hover:text-ink-900">
                          Permissions{tuned > 0 ? ` (${tuned} changed)` : ''}
                        </summary>
                        <form action={setPerms} className="mt-3 grid gap-1.5 rounded-xl bg-ink-50/60 p-3 sm:w-[420px]">
                          <input type="hidden" name="staffId" value={t.id} />
                          {PERMISSIONS.filter((p) => p.key !== 'club.own').map((p) => {
                            const isDef = def.includes(p.key);
                            const on = effective.has(p.key);
                            const locked = p.key === 'team.manage' && !iAmOwner;
                            return (
                              <label key={p.key} className="flex items-center gap-2 text-[13px]">
                                <input type="hidden" name={`d:${p.key}`} value={isDef ? '1' : '0'} />
                                <input
                                  type="checkbox"
                                  name={`p:${p.key}`}
                                  defaultChecked={on}
                                  disabled={locked}
                                  className="h-4 w-4 accent-ink-900"
                                />
                                {locked && on && <input type="hidden" name={`p:${p.key}`} value="on" />}
                                <span className="flex-1">{p.label}</span>
                                {on !== isDef && (
                                  <span className={on ? 'text-emerald-700' : 'text-rose-700'}>
                                    {on ? 'extra' : 'removed'}
                                  </span>
                                )}
                              </label>
                            );
                          })}
                          <p className="mt-1 text-[11px] text-ink-500">
                            Ticked boxes that differ from the {roleLabel(t.role)} defaults are marked.
                          </p>
                          <SubmitButton pendingText="Saving…" className="btn-ghost mt-1 py-2 text-xs">
                            Save permissions
                          </SubmitButton>
                        </form>
                      </details>
                      {!t.accepted_at && (
                        <form action={resend}>
                          <input type="hidden" name="staffId" value={t.id} />
                          <button type="submit" className="font-medium text-ink-500 hover:text-ink-900">
                            Resend invitation
                          </button>
                        </form>
                      )}
                      <details>
                        <summary className="cursor-pointer list-none font-medium text-rose-700 hover:text-rose-800">
                          {t.accepted_at ? 'Remove' : 'Cancel invitation'}
                        </summary>
                        <form
                          action={remove}
                          className="mt-2 rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200 sm:w-[340px]"
                        >
                          <input type="hidden" name="staffId" value={t.id} />
                          <p className="text-[13px] text-rose-900">
                            {t.accepted_at
                              ? `${t.name} is signed out of this club at once and can’t come back unless invited again. Their history stays.`
                              : 'The invitation link stops working.'}
                          </p>
                          <SubmitButton
                            pendingText="Removing…"
                            className="btn mt-2 bg-rose-700 py-2 text-xs text-white hover:bg-rose-800"
                          >
                            {t.accepted_at ? `Remove ${t.name.split(' ')[0]}` : 'Cancel invitation'}
                          </SubmitButton>
                        </form>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <section className="card p-5">
            <div className="mb-3 font-medium">Recent activity</div>
            {activity.length === 0 ? (
              <p className="text-sm text-ink-500">Sign-ins, invitations and changes will show here.</p>
            ) : (
              <ul className="divide-y divide-ink-100 text-sm">
                {activity.map((a) => (
                  <li key={`${a.at.toISOString()}${a.kind}${a.name}`} className="flex flex-wrap gap-x-3 py-2">
                    <span className="w-36 shrink-0 text-xs text-ink-500 tabular-nums">{dateTime(a.at)}</span>
                    <span className="flex-1">
                      <b className="font-medium">{a.name ?? 'Someone'}</b> {EVENT[a.kind] ?? a.kind}
                      {a.actor && a.kind !== 'signin.ok' && a.kind !== 'club.opened' ? ` by ${a.actor}` : ''}
                    </span>
                    {a.ip && <span className="text-xs text-ink-500">{a.ip}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card p-5">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck size={16} className="text-brand-600" /> What each role can do
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="text-ink-500">
                    <th className="py-1 pr-2 text-left font-medium" />
                    {['owner', ...CLUB_ROLES.map((r) => r.key)].map((r) => (
                      <th key={r} className="px-1 py-1 font-medium">
                        {roleLabel(r)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map((p) => (
                    <tr key={p.key} className="border-t border-ink-100">
                      <td className="py-2 pr-3 text-ink-700">{p.label}</td>
                      {['owner', ...CLUB_ROLES.map((r) => r.key)].map((r) => (
                        <td key={r} className="px-1 text-center">
                          {(defaults[r] ?? []).includes(p.key) ? (
                            <span className="text-emerald-600">●</span>
                          ) : (
                            <span className="text-ink-100">●</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-ink-500">Front desk sees today’s figures only.</p>
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          <section className="card p-5">
            <div className="font-medium">Invite someone</div>
            <p className="mb-4 mt-0.5 text-xs text-ink-500">
              They get an email (and an SMS if you add a mobile) to set their own password.
            </p>
            <InviteForm roles={roles.map((r) => ({ key: r.key, label: r.label, hint: r.hint }))} />
          </section>

          {can(s, 'club.own') && (
            <section className="card p-5">
              <div className="flex items-center gap-2 font-medium">
                <Crown size={16} className="text-gold-500" /> Hand over ownership
              </div>
              <p className="mt-1 text-xs text-ink-500">
                The owner holds the club’s subscription and contract. The new owner must be an admin and confirms from
                an email; you then stay on as an admin.
              </p>
              {admins.length === 0 ? (
                <p className="mt-3 text-sm text-ink-500">Make someone an admin first.</p>
              ) : (
                <form action={offerClub} className="mt-3 space-y-2.5">
                  <select name="staffId" className="input" aria-label="New owner">
                    {admins.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <input
                    name="current"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password to confirm"
                    className="input"
                  />
                  <SubmitButton pendingText="Sending…" className="btn-ghost w-full">
                    Offer ownership
                  </SubmitButton>
                </form>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
