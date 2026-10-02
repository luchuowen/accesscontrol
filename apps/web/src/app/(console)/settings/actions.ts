'use server';
import { withTenant } from '@lango/db';
import {
  changedPasswordAftermath,
  clubSms,
  encrypt,
  hashPassword,
  inviteStaff,
  msisdn,
  passwordProblem,
  platformSms,
  platformSmsConfig,
  rateLimit,
  resendInvite,
  roleLabel,
  staffById,
  startTopup,
  TaifaAuthError,
  TaifaPay,
  verifyPassword,
} from '@lango/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { publicUrl, requireSession, sessionToken } from '@/lib/session';
import { db } from '@/server/db';

export async function saveTaifaPay(form: FormData) {
  const s = await requireSession();
  if (s.role !== 'owner') redirect('/settings?taifa=forbidden');
  const env = String(form.get('env')) === 'live' ? 'live' : 'sandbox';
  const clientId = String(form.get('clientId') ?? '').trim();
  const clientSecret = String(form.get('clientSecret') ?? '').trim();
  if (!clientId || !clientSecret) redirect('/settings?taifa=missing');
  // Prove the keys work before storing them (one call to TaifaPay, 15 s limit).
  let outcome: 'ok' | 'rejected' | 'unreachable' = 'ok';
  try {
    await new TaifaPay({ env, clientId, clientSecret }).verify();
  } catch (e) {
    outcome = e instanceof TaifaAuthError ? 'rejected' : 'unreachable';
  }
  if (outcome !== 'ok') redirect(`/settings?taifa=${outcome}`);
  await withTenant(db(), s.tid, async (tx) => {
    const data = { taifapay: { env, clientId, clientSecret: encrypt(clientSecret) } };
    await tx`insert into tenant_settings (tenant_id, data) values (${s.tid}, ${tx.json(data as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'settings.taifapay', ${tx.json({ env, clientId: `…${clientId.slice(-4)}` } as never)})`;
  });
  revalidatePath('/settings');
  redirect('/settings?taifa=ok');
}

const SHORTCODE = /^\d{5,7}$/;

/** How members pay: the club's paybill/till as linked on TaifaPay, and bank settlement confirmation. */
export async function saveChannels(form: FormData) {
  const s = await requireSession();
  if (s.role !== 'owner') redirect('/settings?ch=forbidden');
  const paybill = String(form.get('paybill') ?? '').replace(/\s/g, '');
  const till = String(form.get('till') ?? '').replace(/\s/g, '');
  const linksOnly = form.get('linksOnly') === 'on';
  const settlementConfirmed = form.get('settlementConfirmed') === 'on';
  const settlementBank = String(form.get('settlementBank') ?? '')
    .trim()
    .slice(0, 80);
  if ((paybill && !SHORTCODE.test(paybill)) || (till && !SHORTCODE.test(till))) redirect('/settings?ch=number');
  const channels = { paybill: paybill || null, till: till || null, linksOnly, settlementConfirmed, settlementBank };
  await withTenant(db(), s.tid, async (tx) => {
    await tx`insert into tenant_settings (tenant_id, data) values (${s.tid}, ${tx.json({ channels } as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'settings.channels', ${tx.json(channels as never)})`;
  });
  revalidatePath('/settings');
  redirect('/settings?ch=ok');
}

const ROLES = ['owner', 'manager', 'reception', 'accountant'] as const;

export interface AddStaffState {
  error?: string;
  done?: { name: string; email: string; emailed: boolean };
}

/** Owner invites a colleague: they get an email to set their own password (7-day link). */
export async function addStaff(_prev: AddStaffState, form: FormData): Promise<AddStaffState> {
  const s = await requireSession();
  if (s.role !== 'owner') return { error: 'Only the owner can invite people.' };
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
  if (!(ROLES as readonly string[]).includes(role)) return { error: 'Choose a role.' };
  const [taken] = await db()<{ id: string }[]>`select id from app_staff_login(${email})`;
  if (taken) return { error: 'That email already has a Lango account.' };
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
    await withTenant(db(), s.tid, async (tx) => {
      await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'staff.invited', ${tx.json({ email, role } as never)})`;
    });
    revalidatePath('/settings');
    return { done: { name, email, emailed: r.emailed } };
  } catch (e) {
    console.error('staff invitation failed', (e as Error).message);
    return { error: 'The invitation could not be created. Try again.' };
  }
}

/** A fresh invitation link for someone who has not accepted yet (the earlier link stops working). */
export async function resendStaffInvite(form: FormData) {
  const s = await requireSession();
  if (s.role !== 'owner') redirect('/settings?team=forbidden#team');
  const id = String(form.get('staffId') ?? '');
  const target = await staffById(db(), id);
  if (!target || target.tenant_id !== s.tid) redirect('/settings?team=forbidden#team');
  const r = await resendInvite(db(), id, s.uid, publicUrl());
  redirect(`/settings?team=${r.ok ? 'invite-sent' : 'invite-failed'}#team`);
}

export async function setStaffActive(form: FormData) {
  const s = await requireSession();
  if (s.role !== 'owner') redirect('/settings?team=forbidden');
  const id = String(form.get('staffId') ?? '');
  if (id === s.uid) redirect('/settings?team=self');
  const active = form.get('active') === 'true';
  await withTenant(db(), s.tid, async (tx) => {
    await tx`select app_set_staff_active(${id}, ${active})`;
    await tx`insert into audit_log (tenant_id, actor, action, entity) values (${s.tid}, ${s.uid}, ${active ? 'staff.reactivated' : 'staff.deactivated'}, ${id})`;
  });
  revalidatePath('/settings');
  redirect('/settings?team=ok');
}

const PW_CODE: [RegExp, string][] = [
  [/at least 10/, 'short'],
  [/at most/, 'long'],
  [/too easy/, 'guessable'],
  [/breach/, 'breached'],
];

/** Change your own password: this session stays, every other session and remembered device ends. */
export async function changePassword(form: FormData) {
  const s = await requireSession();
  const current = String(form.get('current') ?? '');
  const next = String(form.get('next') ?? '');
  if (!rateLimit(`pw-change:${s.uid}`, 5, 15 * 60_000)) redirect('/settings?pw=wait#account');
  const [row] = await db()<{ h: string | null }[]>`select app_staff_hash(${s.uid}) as h`;
  if (!row?.h || !(await verifyPassword(current, row.h))) redirect('/settings?pw=wrong#account');
  const problem = await passwordProblem(next, s.email);
  if (problem) redirect(`/settings?pw=${PW_CODE.find(([re]) => re.test(problem))?.[1] ?? 'guessable'}#account`);
  await db()`select app_set_password(${s.uid}, ${await hashPassword(next)})`;
  const me = await staffById(db(), s.uid);
  if (me) await changedPasswordAftermath(db(), me, 'password-changed', await sessionToken());
  redirect('/settings?pw=ok#account');
}

/** Your mobile number: where sign-in codes go. Needs your password, so a borrowed session cannot redirect codes. */
export async function savePhone(form: FormData) {
  const s = await requireSession();
  if (!rateLimit(`pw-change:${s.uid}`, 5, 15 * 60_000)) redirect('/settings?pw=wait#account');
  const [row] = await db()<{ h: string | null }[]>`select app_staff_hash(${s.uid}) as h`;
  if (!row?.h || !(await verifyPassword(String(form.get('current') ?? ''), row.h)))
    redirect('/settings?pw=wrong#account');
  const phone = msisdn(String(form.get('phone') ?? ''));
  if (!phone) redirect('/settings?pw=phone#account');
  await db()`select app_staff_set_phone(${s.uid}, ${phone})`;
  redirect('/settings?pw=phone-ok#account');
}

/** Club SMS switches: on/off, receipts, expiry reminders (N days before + last day), welcome message. */
/** Send one SMS now to a number the owner types, to prove delivery end to end. */
export async function sendTestSms(form: FormData) {
  const s = await requireSession();
  if (!['owner', 'manager'].includes(s.role)) redirect('/settings?sms=forbidden');
  const to = msisdn(String(form.get('phone') ?? ''));
  if (!to) redirect('/settings?sms=number');
  if (!rateLimit(`sms-test:${s.tid}`, 5, 10 * 60_000)) redirect('/settings?sms=wait');
  const client = await platformSms(db());
  if (!client) redirect('/settings?sms=platform');
  const [t] = await db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`;
  const body = `${t?.name}: this is a test message from Lango. SMS receipts and reminders are working.`;
  // Sent under the club's own sender ID, so this also proves the sender is registered.
  const club = await withTenant(db(), s.tid, async (tx) => clubSms(tx, s.tid, await platformSmsConfig(db())));
  let r: Awaited<ReturnType<typeof client.send>>;
  try {
    r = await client.send(to, body, club.sender);
  } catch (e) {
    r = { ok: false, code: 'network', desc: (e as Error).message, retry: true };
  }
  await withTenant(db(), s.tid, async (tx) => {
    await tx`insert into sms_messages (tenant_id, phone, body, kind, status, provider_ref, error, attempts, sent_at)
             values (${s.tid}, ${to}, ${body}, 'test', ${r.ok ? 'sent' : 'failed'}, ${r.messageId ?? null},
                     ${r.ok ? null : `${r.code} ${r.desc}`.slice(0, 300)}, 1, ${r.ok ? new Date() : null})`;
  });
  revalidatePath('/settings');
  redirect(`/settings?sms=${r.ok ? 'test-sent' : 'test-failed'}`);
}

/** Buy SMS credit: M-Pesa prompt to the given phone, paid to NAVAC; credit lands when TaifaPay confirms. */
export async function buySms(form: FormData) {
  const s = await requireSession();
  if (!['owner', 'manager', 'accountant'].includes(s.role)) redirect('/settings?sms=forbidden');
  const amountKes = Number(String(form.get('amountKes') ?? '').replace(/[,\s]/g, ''));
  const r = await startTopup(db(), s.tid, {
    amountKes,
    phone: String(form.get('phone') ?? ''),
    trigger: 'manual',
    actor: s.uid,
  });
  revalidatePath('/settings');
  redirect(`/settings?sms=${r.ok ? 'topup-sent' : `topup-${r.reason}`}`);
}
