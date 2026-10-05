'use server';
import { withTenant } from '@lango/db';
import {
  clientIp,
  initiatedTransactionId,
  isLimited,
  type MemberMatch,
  membersByPhone,
  msisdn,
  otpAvailable,
  rateLimit,
  recordFailure,
  requestOtp,
  tenantTaifa,
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

export async function memberPay(form: FormData) {
  const who = await readMember();
  if (!who) redirect('/m');
  const productId = String(form.get('productId'));
  if (!/^[0-9a-f-]{36}$/.test(productId)) redirect('/m');
  if (!rateLimit(`member-pay:${who.memberId}`, 3, 5 * 60_000)) redirect('/m?pay=wait');
  const client = await tenantTaifa(db(), who.tenantId);
  if (!client) redirect('/m?pay=unavailable');
  const intent = await withTenant(db(), who.tenantId, async (tx) => {
    const [m] = await tx<
      { member_no: number; phone: string }[]
    >`select member_no, phone from members where id = ${who.memberId} and status = 'active' and phone is not null`;
    const [p] = await tx<
      { price_kes: number; name: string }[]
    >`select price_kes, name from products where id = ${productId} and active
      and (products.service_id is null or exists (select 1 from services sv where sv.id = products.service_id and sv.active and sv.deleted_at is null and sv.sold_to <> 'walkins'))`;
    if (!m || !p) return null;
    const [i] = await tx<
      { id: string }[]
    >`insert into payment_intents (tenant_id, member_id, product_id, amount_kes, phone, provider, created_by)
      values (${who.tenantId}, ${who.memberId}, ${productId}, ${p.price_kes}, ${m.phone}, 'taifapay', 'member') returning id`;
    return { id: i?.id as string, amount: p.price_kes, ref: String(m.member_no), phone: m.phone, name: p.name };
  });
  if (!intent) redirect('/m?pay=unavailable');
  let sent = true;
  try {
    const res = await client.stkPush({
      phone: intent.phone,
      amount: intent.amount,
      accountReference: intent.ref,
      description: intent.name.slice(0, 20),
      externalId: intent.id,
    });
    const ref = initiatedTransactionId(res);
    if (ref)
      await withTenant(
        db(),
        who.tenantId,
        (tx) => tx`update payment_intents set provider_ref = ${ref} where id = ${intent.id}`,
      );
  } catch (err) {
    sent = false;
    console.error('stk push failed', err instanceof Error ? err.message : err);
    await withTenant(
      db(),
      who.tenantId,
      (tx) => tx`update payment_intents set status = 'failed' where id = ${intent.id}`,
    );
  }
  redirect(sent ? '/m?pay=sent' : '/m?pay=failed');
}
