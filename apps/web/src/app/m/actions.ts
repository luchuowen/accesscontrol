'use server';
import { withTenant } from '@lango/db';
import {
  blockCards,
  clientIp,
  confirmPhoneChange,
  endPause,
  isLimited,
  type MemberMatch,
  membersByPhone,
  msisdn,
  otpAvailable,
  rateLimit,
  recordFailure,
  requestOtp,
  requestPhoneChange,
  setEmergencyContact,
  startGuestPass,
  startMemberPrompt,
  startPause,
  unblockCards,
  verifyOtp,
} from '@lango/server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/server/db';
import { PHONE, PICK, type Pick, pendingPhone, pendingPicks, short, sign } from './session';

const COOKIE = 'lango_member';
export async function readMember(): Promise<{ tenantId: string; memberId: string } | null> {
  const raw = (await cookies()).get(COOKIE)?.value ?? '';
  const i = raw.lastIndexOf('.');
  if (i < 0 || sign(raw.slice(0, i)) !== raw) return null;
  const [tenantId, memberId] = raw.slice(0, i).split(':');
  return tenantId && memberId ? { tenantId, memberId } : null;
}

const setMember = async (tenantId: string, memberId: string) => {
  const jar = await cookies();
  jar.delete({ name: PHONE, path: '/m' });
  jar.delete({ name: PICK, path: '/m' });
  jar.set(COOKIE, sign(`${tenantId}:${memberId}`), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/m',
    maxAge: 30 * 86400,
    secure: process.env.NODE_ENV === 'production',
  });
};

/** Signed in when the code (or member number) fits one membership; several clubs → pick one. */
async function finish(ms: MemberMatch[], from: string): Promise<never> {
  const [one] = ms;
  if (ms.length === 1 && one) {
    await setMember(one.tenantId, one.memberId);
    redirect('/m');
  }
  const picks: Pick[] = ms.map((m) => ({ t: m.tenantId, m: m.memberId, c: m.club, n: m.memberNo }));
  (await cookies()).set(PICK, sign(Buffer.from(JSON.stringify(picks)).toString('base64url')), {
    ...short,
    secure: process.env.NODE_ENV === 'production',
  });
  redirect(`/m?step=club${from}`);
}

/** Keeps the way back to the staff sign-in for someone who came from it. */
const fromStaff = (form: FormData) => (form.get('from') === 'staff' ? '&from=staff' : '');

/**
 * Step 1: the phone number. A 6-digit code goes by SMS to it; the answer is the same whether or not it belongs
 * to a member. When none of the member's clubs can send SMS, the portal asks for the member number instead.
 */
export async function memberStart(form: FormData) {
  const from = fromStaff(form);
  const phone = msisdn(String(form.get('phone') ?? '')) ?? (form.get('resend') ? await pendingPhone() : null);
  if (!phone) redirect(`/m?e=3${from}`);
  const ip = clientIp(await headers());
  if (!rateLimit(`member-start-ip:${ip}`, 20, 10 * 60_000)) redirect(`/m?e=2${from}`);
  (await cookies()).set(PHONE, phone, { ...short, secure: process.env.NODE_ENV === 'production' });
  if (!(await otpAvailable(db(), phone))) redirect(`/m?step=number${from}`);
  const r = await requestOtp(db(), phone);
  if (r === 'fallback') redirect(`/m?step=number${from}`);
  redirect(`/m?step=code${r === 'wait' ? '&w=1' : ''}${from}`);
}

/** Step 2: the code from the SMS. */
export async function memberVerify(form: FormData) {
  const from = fromStaff(form);
  const phone = await pendingPhone();
  if (!phone) redirect(`/m?${from.slice(1)}`);
  const code = String(form.get('code') ?? '').replace(/\D/g, '');
  const ip = clientIp(await headers());
  const account = `member-code:${phone}`;
  if (!rateLimit(`member-code-ip:${ip}`, 30, 10 * 60_000) || isLimited(account, 8, 15 * 60_000))
    redirect(`/m?step=code&e=2${from}`);
  const ms = await verifyOtp(db(), phone, code);
  if (!ms.length) {
    recordFailure(account, 15 * 60_000);
    redirect(`/m?step=code&e=1${from}`);
  }
  await finish(ms, from);
}

/** Step 3, only for a phone that is a member at more than one club: which one. */
export async function memberPick(form: FormData) {
  const id = String(form.get('member') ?? '');
  const p = (await pendingPicks()).find((x) => x.m === id);
  if (!p) redirect(`/m?${fromStaff(form).slice(1)}`);
  await setMember(p.t, p.m);
  redirect('/m');
}

export async function memberLogout() {
  (await cookies()).delete({ name: COOKIE, path: '/m' });
  redirect('/m');
}

/** Club news and "we miss you" by SMS: the member's own choice (receipts and reminders always come). */
export async function setNews(form: FormData) {
  const me = await readMember();
  if (!me) redirect('/m');
  const on = form.get('news') === 'on';
  await withTenant(db(), me.tenantId, async (tx) => {
    await tx`update members set sms_news = ${on} where id = ${me.memberId}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${me.tenantId}, 'member', 'member.sms_news', ${me.memberId}, ${tx.json({ on } as never)})`;
  });
  redirect(`/m?news=${on ? 'on' : 'off'}`);
}

/** Fallback when no club of the member can send SMS: the phone number plus the member number. */
export async function memberLogin(form: FormData) {
  const from = fromStaff(form);
  const phone = await pendingPhone();
  if (!phone) redirect(`/m?${from.slice(1)}`);
  const no = Number.parseInt(String(form.get('memberNo') ?? '').replace(/\D/g, ''), 10);
  const ip = clientIp(await headers());
  const account = `member-login:${phone}`;
  if (!rateLimit(`member-login-ip:${ip}`, 20, 5 * 60_000) || isLimited(account, 5, 15 * 60_000))
    redirect(`/m?step=number&e=2${from}`);
  const ms = (await membersByPhone(db(), phone)).filter((m) => m.memberNo === no);
  if (!ms.length) {
    recordFailure(account, 15 * 60_000);
    redirect(`/m?step=number&e=1${from}`);
  }
  await finish(ms, from);
}

/** Self-service purchase (design A): the bill's services in one M-Pesa prompt to the member's own phone. */
export async function memberPay(form: FormData) {
  const who = await readMember();
  if (!who) redirect('/m');
  // Each bill line is "memberId:productId" (family) or a bare productId (the member themself).
  const items = form
    .getAll('item')
    .map(String)
    .map((x) => {
      const [m, p] = x.includes(':') ? x.split(':') : [who.memberId, x];
      return { memberId: m as string, productId: p as string };
    });
  const r = await startMemberPrompt(db(), who.tenantId, who.memberId, items, 'member');
  redirect(r === 'invalid' ? '/m?v=add' : `/m?pay=${r}`);
}

/** Guest pass: the member pays for a friend's day pass; the friend gets a code by SMS. */
export async function memberGuest(form: FormData) {
  const who = await readMember();
  if (!who) redirect('/m');
  const r = await startGuestPass(db(), who.tenantId, who.memberId, {
    name: String(form.get('name') ?? ''),
    phone: String(form.get('phone') ?? ''),
    date: String(form.get('date') ?? ''),
    productIds: form.getAll('productId').map(String),
  });
  const why: Record<string, string> = {
    invalid: 'Check the guest’s name, their Kenyan mobile number and the day.',
    limit: 'You have used all your guest passes for this month.',
    off: 'This club does not sell guest passes online. Ask at reception.',
    unavailable: 'Online payment isn’t switched on for this club yet. Pay at reception.',
    wait: 'A payment request was just sent. Give it a few minutes before trying again.',
    failed: 'We couldn’t reach M-Pesa just now. Try again in a minute.',
  };
  redirect(
    r === 'sent' ? '/m?v=guests&n=guest-sent' : `/m?v=guest&e=${encodeURIComponent(why[r] ?? (why.failed as string))}`,
  );
}

// ── Phase 2 self-service (5 Oct 2026) ─────────────────────────────────────────────────────────────────────────

/** Lost card: blocked at once; reception links a new one. */
export async function memberLostCard() {
  const who = await readMember();
  if (!who) redirect('/m');
  await blockCards(db(), who.tenantId, who.memberId, 'member');
  redirect('/m?v=card&n=blocked');
}
export async function memberFoundCard() {
  const who = await readMember();
  if (!who) redirect('/m');
  await unblockCards(db(), who.tenantId, who.memberId, 'member');
  redirect('/m?n=card-on');
}

export async function memberPause(form: FormData) {
  const who = await readMember();
  if (!who) redirect('/m');
  const r = await startPause(
    db(),
    who.tenantId,
    who.memberId,
    {
      start: String(form.get('start') ?? ''),
      days: Number(form.get('days')),
      reason: String(form.get('reason') ?? ''),
    },
    'member',
  );
  redirect(r.ok ? '/m?v=pause&n=paused' : `/m?v=pause&e=${encodeURIComponent(r.why)}`);
}
export async function memberEndPause() {
  const who = await readMember();
  if (!who) redirect('/m');
  await endPause(db(), who.tenantId, who.memberId, 'member');
  redirect('/m?n=pause-ended');
}

const NEWPHONE = 'lango_member_newphone';
export async function memberPhoneStart(form: FormData) {
  const who = await readMember();
  if (!who) redirect('/m');
  const phone = msisdn(String(form.get('phone') ?? ''));
  if (!phone) redirect(`/m?v=details&e=${encodeURIComponent('That doesn’t look like a Kenyan mobile number.')}`);
  if (!rateLimit(`member-phone:${who.memberId}`, 3, 15 * 60_000))
    redirect(`/m?v=details&e=${encodeURIComponent('Too many tries. Wait a few minutes.')}`);
  const r = await requestPhoneChange(db(), who.tenantId, who.memberId, phone);
  if (r !== 'sent') {
    const why = {
      invalid: 'That doesn’t look like a Kenyan mobile number.',
      same: 'That is already your number.',
      wait: 'Too many codes sent. Wait a few minutes.',
      failed: 'We couldn’t send the code just now. Try again later or ask at reception.',
    }[r];
    redirect(`/m?v=details&e=${encodeURIComponent(why)}`);
  }
  (await cookies()).set(NEWPHONE, sign(phone), short);
  const local = phone.replace(/^254/, '0');
  redirect(
    `/m?v=details&step=code&p=${encodeURIComponent(`${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`)}`,
  );
}
export async function memberPhoneConfirm(form: FormData) {
  const who = await readMember();
  if (!who) redirect('/m');
  const jar = await cookies();
  const raw = jar.get(NEWPHONE)?.value ?? '';
  const i = raw.lastIndexOf('.');
  const phone = i > 0 && sign(raw.slice(0, i)) === raw ? raw.slice(0, i) : null;
  if (!phone) redirect(`/m?v=details&e=${encodeURIComponent('That code has expired. Start again.')}`);
  const ok = await confirmPhoneChange(db(), who.tenantId, who.memberId, phone, String(form.get('code') ?? '').trim());
  if (!ok)
    redirect(`/m?v=details&step=code&e=${encodeURIComponent('That code is not right. Check the SMS and try again.')}`);
  jar.delete(NEWPHONE);
  redirect('/m?v=details&n=phone');
}
export async function memberEmergency(form: FormData) {
  const who = await readMember();
  if (!who) redirect('/m');
  const ok = await setEmergencyContact(db(), who.tenantId, who.memberId, {
    name: String(form.get('name') ?? ''),
    phone: String(form.get('phone') ?? ''),
  });
  redirect(
    ok ? '/m?v=details&n=contact' : `/m?v=details&e=${encodeURIComponent('Add both a name and a valid phone number.')}`,
  );
}
