'use server';
import { createHmac } from 'node:crypto';
import { withTenant } from '@lango/db';
import { tenantTaifa } from '@lango/server';
import { cookies } from 'next/headers';
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
  const [t] = await db()<{ id: string }[]>`select id from tenants where slug = ${slug}`;
  if (!t || !Number.isSafeInteger(no)) redirect('/m?e=1');
  const [m] = await withTenant(
    db(),
    t.id,
    (tx) => tx<{ id: string; phone: string | null }[]>`select id, phone from members where member_no = ${no}`,
  );
  if (!m?.phone || digits(m.phone) !== phone) redirect('/m?e=1');
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
  const client = await tenantTaifa(db(), who.tenantId);
  const intent = await withTenant(db(), who.tenantId, async (tx) => {
    const [m] = await tx<
      { member_no: number; phone: string }[]
    >`select member_no, phone from members where id = ${who.memberId}`;
    const [p] = await tx<
      { price_kes: number; name: string }[]
    >`select price_kes, name from products where id = ${productId} and active`;
    if (!m || !p) throw new Error('not found');
    const [i] = await tx<
      { id: string }[]
    >`insert into payment_intents (tenant_id, member_id, product_id, amount_kes, phone, provider, created_by)
      values (${who.tenantId}, ${who.memberId}, ${productId}, ${p.price_kes}, ${m.phone}, 'taifapay', 'member') returning id`;
    return { id: i?.id as string, amount: p.price_kes, ref: String(m.member_no), phone: m.phone, name: p.name };
  });
  if (!client) redirect('/m?pay=unavailable');
  await client.stkPush({
    phone: intent.phone,
    amount: intent.amount,
    accountReference: intent.ref,
    description: intent.name.slice(0, 20),
    externalId: intent.id,
  });
  redirect('/m?pay=sent');
}
