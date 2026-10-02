'use server';
import {
  acceptOwnership,
  CLUB_ROLES,
  can,
  changeRole,
  clientIp,
  inviteStaff,
  msisdn,
  offerOwnership,
  PERMISSIONS,
  removeMember,
  resendInvite,
  resetRolePerms,
  roleLabel,
  setPermissions,
  setRolePerm,
  staffById,
  suspendMember,
  teamError,
  verifyPassword,
} from '@lango/server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession, publicUrl, requireSession } from '@/lib/session';
import { db } from '@/server/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const back = (m: string): never => redirect(`/settings?tab=team&m=${m}`);

/** Every team action: signed in, in a club, allowed to manage its team. */
async function manager() {
  const s = await requireSession();
  if (!can(s, 'team.manage')) redirect('/?denied=1');
  const ip = clientIp(await headers());
  return { s, who: { actorId: s.uid, actorName: s.name, tenantId: s.tid, ip } };
}

const staffId = (form: FormData) => {
  const v = String(form.get('staffId') ?? '');
  return UUID.test(v) ? v : back('missing');
};

export interface InviteState {
  error?: string;
  done?: { name: string; email: string; emailed: boolean; added: boolean };
}

/** Invite a colleague. A new person sets their own password from the email; an existing login is added at once. */
export async function invite(_prev: InviteState, form: FormData): Promise<InviteState> {
  const { s } = await manager();
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 80);
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const phone = String(form.get('phone') ?? '').trim();
  const role = String(form.get('role') ?? 'reception');
  if (!name) return { error: 'Enter their name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email.' };
  if (phone && !msisdn(phone)) return { error: 'Enter their mobile as 07XX XXX XXX, or leave it blank.' };
  if (!CLUB_ROLES.some((r) => r.key === role)) return { error: 'Choose a role.' };
  const [t] = await db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`;
  try {
    const r = await inviteStaff(db(), {
      inviterId: s.uid,
      email,
      name,
      phone: phone || undefined,
      role,
      tenantId: s.tid,
      baseUrl: publicUrl(),
      ctx: { inviterName: s.name, to: t?.name ?? 'your club', roleLabel: roleLabel(role) },
    });
    revalidatePath('/settings');
    return { done: { name, email, emailed: r.emailed, added: r.added } };
  } catch (e) {
    return { error: teamError(e) };
  }
}

export async function resend(form: FormData) {
  const { s } = await manager();
  const id = staffId(form);
  const team = await db()<{ id: string }[]>`select id from app_club_team(${s.tid}) where id = ${id}`;
  if (!team.length) back('missing');
  const r = await resendInvite(db(), id, s.uid, publicUrl());
  back(r.ok ? 'invite-sent' : 'invite-failed');
}

export async function setRole(form: FormData) {
  const { who } = await manager();
  const id = staffId(form);
  try {
    await changeRole(db(), who, id, String(form.get('role') ?? ''));
  } catch {
    back('role-denied');
  }
  back('role-ok');
}

/** Per-person permissions: each box is either the role's default, an extra (grant) or taken away (deny). */
export async function setPerms(form: FormData) {
  const { who } = await manager();
  const id = staffId(form);
  const grants: string[] = [];
  const denies: string[] = [];
  for (const p of PERMISSIONS) {
    if (p.key === 'club.own') continue;
    const want = form.get(`p:${p.key}`) === 'on';
    const def = form.get(`d:${p.key}`) === '1';
    if (want && !def) grants.push(p.key);
    if (!want && def) denies.push(p.key);
  }
  try {
    await setPermissions(db(), who, id, grants, denies);
  } catch {
    back('perms-denied');
  }
  back('perms-ok');
}

/** Pause or restore someone's login (they are signed out at once; their record stays). */
export async function suspend(form: FormData) {
  const { who } = await manager();
  const id = staffId(form);
  const on = form.get('on') === '1';
  try {
    await suspendMember(db(), who, id, on);
  } catch {
    back('remove-denied');
  }
  back(on ? 'suspended' : 'restored');
}

export async function remove(form: FormData) {
  const { who } = await manager();
  const id = staffId(form);
  try {
    await removeMember(db(), who, id);
  } catch {
    back('remove-denied');
  }
  back('removed');
}

/** The owner offers the club to an admin (confirmed with the owner's password). */
export async function offerClub(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'club.own')) redirect('/?denied=1');
  const [row] = await db()<{ h: string | null }[]>`select app_staff_hash(${s.uid}) as h`;
  if (!row?.h || !(await verifyPassword(String(form.get('current') ?? ''), row.h))) back('owner-password');
  const r = await offerOwnership(
    db(),
    { actorId: s.uid, actorName: s.name, tenantId: s.tid, ip: clientIp(await headers()) },
    staffId(form),
    publicUrl(),
  );
  back(r.ok ? 'owner-offered' : 'owner-denied');
}

/** The admin accepts ownership from the emailed link (signed in as themselves). */
export async function takeClub(form: FormData) {
  const s = await getSession();
  const token = String(form.get('token') ?? '');
  if (!s) redirect(`/login?m=signed-out`);
  const me = await staffById(db(), s.uid);
  const ok = me ? await acceptOwnership(db(), token, me.id, clientIp(await headers())) : false;
  redirect(ok ? '/settings?tab=team&m=owner-now' : `/transfer/${encodeURIComponent(token)}?e=1`);
}

/** Owner only: switch one right on or off for a role in this club (no page reload; the table updates in place). */
export async function toggleRolePerm(role: string, perm: string, on: boolean): Promise<{ error?: string }> {
  const { s, who } = await manager();
  if (s.role !== 'owner') return { error: 'Only the owner can change what a role can do.' };
  try {
    await setRolePerm(db(), who, role, perm, on);
  } catch {
    return { error: 'That right can’t be changed.' };
  }
  revalidatePath('/settings');
  return {};
}

export async function resetRole(role: string): Promise<{ error?: string }> {
  const { s, who } = await manager();
  if (s.role !== 'owner') return { error: 'Only the owner can change what a role can do.' };
  await resetRolePerms(db(), who, role);
  revalidatePath('/settings');
  return {};
}
