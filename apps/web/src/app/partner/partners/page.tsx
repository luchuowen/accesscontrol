import { partnerRoleLabel, partnerTeam } from '@lango/server';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';
import { InviteUser } from './invite-user';
import { type Org, type UserRow, UsersView } from './users-view';

export const metadata = { title: 'Users · Lango' };

const NAVAC = 'NAVAC Global';
const MSG: Record<string, [string, string]> = {
  'partner-on': ['green', 'User reactivated.'],
  'partner-off': ['green', 'User deactivated. They were signed out at once.'],
  self: ['amber', 'You can’t deactivate yourself.'],
  denied: ['amber', 'You can’t change that user.'],
  missing: ['amber', 'That user was not found.'],
  assigned: ['green', 'Clubs assigned. The technician sees them on their next page.'],
  'invite-sent': ['green', 'Invite resent. The earlier link no longer works.'],
  'invite-failed': ['amber', 'That invite could not be sent. It may already have been accepted.'],
};

/** Users (design B "Organizations first", 5 Oct 2026): organization cards, the users table, and Invite user. */
export default async function Users({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requirePartner();
  if (s.kind !== 'partner_admin') redirect('/partner');
  const { m } = await searchParams;
  const msg = m ? MSG[m] : undefined;
  const [[plat], people, clubs] = await Promise.all([
    db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`,
    partnerTeam(db(), s.uid),
    db()<{ id: string; name: string; partner_id: string | null }[]>`
      select c.id, c.name, t.partner_id from app_partner_clubs(${s.uid}) c join tenants t on t.id = c.id`,
  ]);
  const platform = !!plat?.ok;
  const myOrg = people.find((p) => p.id === s.uid)?.partner ?? NAVAC;

  const users: UserRow[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role,
    roleLabel: partnerRoleLabel(p),
    org: p.partner ?? NAVAC,
    orgId: p.partner_id,
    status: !p.accepted_at ? 'pending' : p.active ? 'active' : 'deactivated',
    clubs: p.clubs,
    you: p.id === s.uid,
  }));
  const orgs: Org[] = [...new Map(users.map((u) => [u.org, u.orgId])).entries()].map(([name, id]) => ({
    name,
    id,
    platform: !id,
    users: users.filter((u) => u.org === name).length,
    clubs: id ? clubs.filter((c) => c.partner_id === id).length : null,
    pending: users.filter((u) => u.org === name && u.status === 'pending').length,
  }));

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={
          platform
            ? 'Everyone who signs in to this console, by organization. Technicians see only the clubs assigned to them.'
            : `Everyone at ${myOrg} who signs in to Lango. Technicians see only the clubs you assign them.`
        }
        actions={<InviteUser platform={platform} orgs={orgs.map((o) => o.name)} myOrg={myOrg} />}
      />
      {msg && (
        <div
          className={`mb-5 rounded-xl p-3 text-sm ring-1 ${msg[0] === 'green' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {msg[1]}
        </div>
      )}
      <UsersView users={users} orgs={orgs} clubs={clubs} platform={platform} />
    </>
  );
}
