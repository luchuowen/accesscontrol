import type { Sql } from '@lango/db';
import {
  checkLink,
  type InviteContext,
  issueLink,
  logAuth,
  roleLabel,
  type StaffRow,
  staffById,
  useLink,
} from './accounts.js';
import { accountEmail, sendEmail } from './email.js';

/**
 * User management: what each role may do, club teams (role changes, per-person permissions, removal, ownership
 * transfer) and partner teams. The database (role_permissions + app_* functions) is the single source of truth and
 * re-checks every rule; this module adds the audit trail and the emails.
 */

export const PERMISSIONS = [
  { key: 'members.view', label: 'See members and access' },
  { key: 'members.edit', label: 'Add and edit members, link cards' },
  { key: 'payments.record', label: 'Record cash, send M-Pesa prompts' },
  { key: 'payments.assign', label: 'Assign unmatched payments' },
  { key: 'access.comp', label: 'Give complimentary access' },
  { key: 'plans.manage', label: 'Services and prices' },
  { key: 'doors.manage', label: 'Doors and Site Bridge' },
  { key: 'messages.manage', label: 'Messages and club news' },
  { key: 'sms.buy', label: 'Buy SMS credit' },
  { key: 'reports.all', label: 'Reports beyond today' },
  { key: 'settings.payments', label: 'Payment keys and how members pay' },
  { key: 'billing.manage', label: 'Club subscription, invoices, setup fee' },
  { key: 'team.manage', label: 'Team: invite, roles, remove' },
  { key: 'club.own', label: 'Close the club, transfer ownership' },
] as const;
export type Perm = (typeof PERMISSIONS)[number]['key'];

/** Club roles in the order they are offered, with one line on what each is for. */
export const CLUB_ROLES = [
  { key: 'admin', label: 'Admin', hint: 'Everything except closing the club or handing it over' },
  { key: 'manager', label: 'Manager', hint: 'Runs the club day to day; no team or subscription' },
  { key: 'reception', label: 'Front desk', hint: 'Registers members, takes payments, links cards' },
  { key: 'accountant', label: 'Accountant', hint: 'Payments, reports, invoices and SMS credit' },
  { key: 'viewer', label: 'Viewer', hint: 'Sees members and reports; changes nothing' },
] as const;
export type ClubRole = 'owner' | (typeof CLUB_ROLES)[number]['key'];

/** True when the session may do this. */
export const can = (s: { perms: readonly string[] } | null | undefined, perm: Perm) => !!s?.perms.includes(perm);

/** Each role's default permissions, from the database. */
export async function roleDefaults(sql: Sql): Promise<Record<string, string[]>> {
  const rows = await sql<{ role: string; perm: string }[]>`select role, perm from role_permissions order by role, perm`;
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.role] ??= []).push(r.perm);
  return out;
}

export interface ClubOption {
  tenant_id: string;
  name: string;
  slug: string;
  role: string;
}
export const myClubs = (sql: Sql, staffId: string) =>
  sql<ClubOption[]>`select * from app_my_clubs(${staffId})`.then((r) => [...r]);

export interface TeamRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: ClubRole;
  grants: string[];
  denies: string[];
  accepted_at: Date | null;
  invited_at: Date | null;
  member_since: Date;
  last_seen: Date | null;
}
/** Team members besides the owner (invited or active), and the allowance (5 for now; per plan later). */
export const clubSeats = async (sql: Sql, tenantId: string) =>
  (await sql<{ used: number; cap: number }[]>`select * from app_club_seats(${tenantId})`)[0] ?? { used: 0, cap: 5 };

export const clubTeam = (sql: Sql, tenantId: string) =>
  sql<TeamRow[]>`select * from app_club_team(${tenantId})`.then((r) => [...r]);

const clubName = async (sql: Sql, tenantId: string) =>
  (await sql<{ name: string }[]>`select name from tenants where id = ${tenantId}`)[0]?.name ?? 'your club';

/** Plain-words reason for a refused team change (the database raises these). */
export function teamError(e: unknown): string {
  const m = (e as Error).message ?? '';
  if (m.includes('yourself')) return 'You can’t change your own access.';
  if (m.includes('not allowed: owner')) return 'The owner’s access can’t be changed. Hand over ownership first.';
  if (m.includes('not allowed: admin') || m.includes('only the owner'))
    return 'Only the owner can add, change or remove an admin.';
  if (m.includes('not allowed: team')) return 'Only the owner can let someone manage the team.';
  if (m.includes('already in this club')) return 'That person is already in this club.';
  if (m.includes('another club'))
    return 'That email already belongs to another club. Each login is for one club only, so use a different email.';
  if (m.includes('team limit'))
    return 'Your team is full: a club can have up to 5 team members besides the owner. Remove someone to invite another.';
  if (m.includes('already has an owner')) return 'This club already has an owner.';
  if (m.includes('partner login')) return 'That email belongs to a partner login. Use a different email.';
  if (m.includes('already has a login')) return 'That email already has a Lango login.';
  if (m.includes('not in this club')) return 'That person is no longer in this club.';
  return 'That change is not allowed.';
}

async function tell(sql: Sql, staff: StaffRow, tenantId: string, kind: string, heading: string, lines: string[]) {
  const mail = accountEmail({
    eyebrow: 'Team',
    heading,
    paragraphs: [`Hi ${staff.name.split(' ')[0] || staff.name},`, ...lines],
  });
  await sendEmail(sql, {
    to: staff.email,
    subject: heading,
    ...mail,
    kind,
    key: `${kind}:${staff.id}:${tenantId}:${Date.now()}`,
    tenantId,
  });
}

interface Who {
  actorId: string;
  actorName: string;
  tenantId: string;
  ip?: string;
}

/** Change someone's role. Takes effect on their next page. They are told by email. */
export async function changeRole(sql: Sql, w: Who, staffId: string, role: string) {
  const [r] = await sql<{ old: string }[]>`
    select app_set_member_role(${w.actorId}, ${w.tenantId}, ${staffId}, ${role}) as old`;
  await logAuth(sql, {
    kind: 'role.changed',
    staffId,
    tenantId: w.tenantId,
    actor: w.actorId,
    ip: w.ip,
    data: { from: r?.old, to: role },
  });
  const staff = await staffById(sql, staffId);
  if (staff?.accepted_at && r?.old !== role)
    await tell(sql, staff, w.tenantId, 'role_changed', `Your role at ${await clubName(sql, w.tenantId)} changed`, [
      `${w.actorName} changed your role from ${roleLabel(r?.old ?? '')} to ${roleLabel(role)}. It applies the next time you open a page.`,
    ]);
}

/** Add or take away single permissions for one person (shown on their row). */
export async function setPermissions(sql: Sql, w: Who, staffId: string, grants: string[], denies: string[]) {
  await sql`select app_set_member_perms(${w.actorId}, ${w.tenantId}, ${staffId}, ${grants}, ${denies})`;
  await logAuth(sql, {
    kind: 'perms.changed',
    staffId,
    tenantId: w.tenantId,
    actor: w.actorId,
    ip: w.ip,
    data: { grants, denies },
  });
}

/** Remove someone from the club: signed out of it at once; their history stays. A pending invite is cancelled. */
export async function removeMember(sql: Sql, w: Who, staffId: string) {
  const staff = await staffById(sql, staffId);
  await sql`select app_remove_member(${w.actorId}, ${w.tenantId}, ${staffId})`;
  await logAuth(sql, { kind: 'member.removed', staffId, tenantId: w.tenantId, actor: w.actorId, ip: w.ip });
  if (staff?.accepted_at)
    await tell(
      sql,
      staff,
      w.tenantId,
      'member_removed',
      `Your access to ${await clubName(sql, w.tenantId)} has ended`,
      [
        `${w.actorName} removed your access to ${await clubName(sql, w.tenantId)} on Lango. If you think this is a mistake, speak to them.`,
      ],
    );
}

// ---------- ownership ----------

/**
 * The owner offers the club to an admin. The admin confirms from the emailed link while signed in; until then
 * nothing changes. A newer offer replaces an older one.
 */
export async function offerOwnership(sql: Sql, w: Who, toStaffId: string, baseUrl: string) {
  const [me] = await sql<{ role: string }[]>`select role from app_staff_perms(${w.actorId}, ${w.tenantId})`;
  const team = await clubTeam(sql, w.tenantId);
  const owner = team.find((t) => t.role === 'owner');
  const to = team.find((t) => t.id === toStaffId);
  if (me?.role !== 'owner' || owner?.id !== w.actorId)
    return { ok: false as const, error: 'Only the owner can do this.' };
  if (!to || to.role !== 'admin' || !to.accepted_at)
    return { ok: false as const, error: 'Ownership can only go to an admin who has accepted their invitation.' };
  const club = await clubName(sql, w.tenantId);
  const token = await issueLink(sql, 'transfer', to.id, w.actorId, { tenantId: w.tenantId, from: w.actorId, club });
  await logAuth(sql, { kind: 'ownership.offered', staffId: to.id, tenantId: w.tenantId, actor: w.actorId, ip: w.ip });
  const mail = accountEmail({
    eyebrow: 'Ownership',
    heading: `${w.actorName} wants to hand ${club} to you`,
    paragraphs: [
      `Hi ${to.name.split(' ')[0] || to.name},`,
      `${w.actorName} would like you to become the owner of ${club} on Lango. The owner is the account holder for the club’s subscription and contract, and the only person who can close the club or hand it on.`,
      `If you accept, ${w.actorName} stays on as an admin.`,
    ],
    button: { label: 'Review and accept', url: `${baseUrl}/transfer/${token}` },
    after: ['Please note: This link can only be used once and expires in 7 days.'],
  });
  const emailed = await sendEmail(sql, {
    to: to.email,
    subject: `${w.actorName} wants to hand ${club} to you`,
    ...mail,
    kind: 'ownership_offer',
    key: `ownership:${to.id}:${Date.now()}`,
    tenantId: w.tenantId,
  });
  return { ok: true as const, emailed, to: to.name };
}

export async function ownershipOffer(sql: Sql, token: string) {
  const link = await checkLink(sql, 'transfer', token);
  if (!link.ok) return link;
  const d = (link.data ?? {}) as { tenantId?: string; from?: string; club?: string };
  const from = d.from ? await staffById(sql, d.from) : null;
  return { ...link, tenantId: d.tenantId ?? '', club: d.club ?? 'the club', fromName: from?.name ?? 'The owner' };
}

/** The admin accepts. Both people are told; the old owner becomes an admin. */
export async function acceptOwnership(sql: Sql, token: string, staffId: string, ip?: string) {
  const offer = await ownershipOffer(sql, token);
  if (!offer.ok || offer.staff.id !== staffId) return false;
  if (!(await useLink(sql, offer.tokenId))) return false;
  const d = (offer.data ?? {}) as { tenantId: string; from: string };
  const [r] = await sql<{ ok: boolean }[]>`select app_transfer_ownership(${d.from}, ${d.tenantId}, ${staffId}) as ok`;
  if (!r?.ok) return false;
  await logAuth(sql, {
    kind: 'ownership.transferred',
    staffId,
    tenantId: d.tenantId,
    actor: d.from,
    ip,
    data: { from: d.from },
  });
  const old = await staffById(sql, d.from);
  if (old)
    await tell(sql, old, d.tenantId, 'ownership_done', `${offer.staff.name} is now the owner of ${offer.club}`, [
      `${offer.staff.name} accepted ownership of ${offer.club}. You stay on as an admin.`,
    ]);
  return true;
}

// ---------- partner teams ----------

export interface PartnerTeamRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  partner: string;
  partner_id: string | null;
  active: boolean;
  accepted_at: Date | null;
  clubs: string[];
}
export const partnerTeam = (sql: Sql, actorId: string) =>
  sql<PartnerTeamRow[]>`select * from app_partner_team(${actorId})`.then((r) => [...r]);

export const partnerRoleLabel = (r: Pick<PartnerTeamRow, 'role' | 'partner_id'>) =>
  r.role === 'partner_admin' && !r.partner_id ? 'NAVAC admin' : roleLabel(r.role);

export async function setPartnerLoginActive(sql: Sql, actorId: string, staffId: string, active: boolean, ip?: string) {
  await sql`select app_partner_set_active(${actorId}, ${staffId}, ${active})`;
  await logAuth(sql, { kind: active ? 'login.on' : 'login.off', staffId, actor: actorId, ip });
}

export async function assignClubs(sql: Sql, actorId: string, staffId: string, tenantIds: string[], ip?: string) {
  await sql`select app_partner_assign(${actorId}, ${staffId}, ${tenantIds})`;
  await logAuth(sql, { kind: 'tech.assigned', staffId, actor: actorId, ip, data: { clubs: tenantIds } });
}

/** Recent sign-in activity of a club's team (sign-ins, failures, invitations, role changes). */
export const clubActivity = (sql: Sql, tenantId: string, limit = 15) =>
  sql<{ at: Date; kind: string; name: string | null; actor: string | null; ip: string | null }[]>`
    select e.at, e.kind, s.name, a.name as actor, e.ip
    from auth_events e
    left join app_club_team(${tenantId}) s on s.id = e.staff_id
    left join app_club_team(${tenantId}) a on a.id = e.actor
    where e.tenant_id = ${tenantId}
    order by e.at desc limit ${limit}`.then((r) => [...r]);

export type { InviteContext };
