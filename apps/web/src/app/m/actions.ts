'use server';
import { createHmac } from 'node:crypto';
import { withTenant } from '@lango/db';
import { clientIp, isLimited, rateLimit, recordFailure, tenantTaifa } from '@lango/server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionSecret } from '@/lib/session';
import { db } from '@/server/db';

const COOKIE = 'lango_member';
const sign = (v: string) => `${v}.${createHmac('sha256', sessionSecret()).update(`member:${v}`).digest('base64url')}`;
export async function readMember(): Promise<{ tenantId: string; memberId: string } | null> {
  const raw = (await cookies()).get(COOKIE)?.value ?? '';
  const i = raw.lastIndexOf('.');
  if (i < 0 || sign(raw.slice(0, i)) !== raw) return null;
  const [tenantId, memberId] = raw.slice(0, i).split(':');
  return tenantId && memberId ? { tenantId, memberId } : null;
}

const digits = (p: string) => p.replace(/\D/g, '').replace(/^0/, '254').slice(-12);

/** v1: club slug + member number + registered phone. (SMS one-time code replaces this once SMS is wired.) */
export async function memberLogin(form: FormData) {
  const slug = String(form.get('club') ?? '')
    .trim()
    .toLowerCase();
  const no = Number.parseInt(String(form.get('memberNo') ?? ''), 10);
  const phone = digits(String(form.get('phone') ?? ''));
  const ip = clientIp(await headers());
  const account = `member-login:${slug}:${no}`;
  if (!rateLimit(`member-login-ip:${ip}`, 20, 5 * 60_000) || isLimited(account, 5, 15 * 60_000)) redirect('/m?e=2');
  const [t] = await db()<{ id: string }[]>`select id from tenants where slug = ${slug}`;
  if (!t || !Number.isSafeInteger(no)) {
    recordFailure(account, 15 * 60_000);
    redirect('/m?e=1');
  }
  const [m] = await withTenant(
    db(),
    t.id,
    (tx) =>
      tx<
        { id: string; phone: string | null }[]
      >`select id, phone from members where member_no = ${no} and status = 'active'`,
  );
  if (!m?.phone || digits(m.phone) !== phone) {
    recordFailure(account, 15 * 60_000);
    redirect('/m?e=1');
  }
  (await cookies()).set(COOKIE, sign(`${t.id}:${m.id}`), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/m',
    maxAge: 30 * 86400,
    secure: process.env.NODE_ENV === 'production',
  });
  redirect('/m');
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
    >`select price_kes, name from products where id = ${productId} and active`;
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
    await client.stkPush({
      phone: intent.phone,
      amount: intent.amount,
      accountReference: intent.ref,
      description: intent.name.slice(0, 20),
      externalId: intent.id,
    });
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
