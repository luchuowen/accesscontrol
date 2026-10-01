'use server';
import { withTenant } from '@lango/db';
import { rebuildAccessState, recordPayment } from '@lango/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

const can = (role: string, ...roles: string[]) => roles.includes(role);

export async function createMember(form: FormData) {
  const s = await requireSession();
  const first = String(form.get('firstName') ?? '').trim();
  const last = String(form.get('lastName') ?? '').trim();
  const phone = String(form.get('phone') ?? '').trim() || null;
  const wanted = Number.parseInt(String(form.get('memberNo') ?? ''), 10);
  if (!first || !last) throw new Error('First and last name are required');
  const id = await withTenant(db(), s.tid, async (tx) => {
    const [n] = await tx<
      { next: number }[]
    >`select coalesce(max(member_no), 21000) + 1 as next from members where member_no between 20000 and 29999`;
    const memberNo = Number.isSafeInteger(wanted) && wanted > 0 ? wanted : (n?.next ?? 21001);
    const [m] = await tx<{ id: string }[]>`insert into members (tenant_id, member_no, first_name, last_name, phone)
      values (${s.tid}, ${memberNo}, ${first}, ${last}, ${phone}) returning id`;
    const mid = m?.id as string;
    await tx`insert into credentials (tenant_id, member_id, card_code) values (${s.tid}, ${mid}, ${memberNo})`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data) values (${s.tid}, ${s.uid}, 'member.created', ${mid}, ${tx.json({ memberNo } as never)})`;
    await rebuildAccessState(tx, s.tid, mid);
    return mid;
  });
  redirect(`/members/${id}`);
}

/** Cash / card-at-desk payment. Goes through the same matching + period rules as M-Pesa; audited. */
export async function recordDeskPayment(form: FormData) {
  const s = await requireSession();
  if (!can(s.role, 'owner', 'manager', 'reception')) throw new Error('not allowed');
  const memberId = String(form.get('memberId'));
  const productId = String(form.get('productId'));
  const channel = String(form.get('channel') ?? 'cash');
  const [m] = await withTenant(
    db(),
    s.tid,
    (tx) => tx<{ member_no: number }[]>`select member_no from members where id = ${memberId}`,
  );
  const [p] = await withTenant(
    db(),
    s.tid,
    (tx) => tx<{ price_kes: number }[]>`select price_kes from products where id = ${productId}`,
  );
  if (!m || !p) throw new Error('member or plan not found');
  await recordPayment(db(), s.tid, {
    provider: `desk-${channel}`,
    providerTxnId: `DESK-${String(form.get('nonce') ?? Date.now())}`,
    amountKes: p.price_kes,
    accountRef: String(m.member_no),
    productId,
    paidAt: new Date(),
    raw: { recordedBy: s.uid, channel },
  });
  revalidatePath(`/members/${memberId}`);
}

/** Comp / goodwill access: reason is mandatory, manager+ only, shows on the owner's reports. */
export async function grantOverride(form: FormData) {
  const s = await requireSession();
  if (!can(s.role, 'owner', 'manager')) throw new Error('only managers can grant complimentary access');
  const memberId = String(form.get('memberId'));
  const zone = String(form.get('zone'));
  const days = Math.min(31, Math.max(1, Number.parseInt(String(form.get('days') ?? '1'), 10) || 1));
  const reason = String(form.get('reason') ?? '').trim();
  if (reason.length < 5) throw new Error('a reason is required');
  await withTenant(db(), s.tid, async (tx) => {
    const [e] = await tx<
      { id: string }[]
    >`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source)
      values (${s.tid}, ${memberId}, ${zone}, date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi',
              (date_trunc('day', now() at time zone 'Africa/Nairobi') + ${`${days} days`}::interval - interval '1 millisecond') at time zone 'Africa/Nairobi', 'override') returning id`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data) values (${s.tid}, ${s.uid}, 'access.override', ${memberId}, ${tx.json({ zone, days, reason, entitlement: e?.id } as never)})`;
    await rebuildAccessState(tx, s.tid, memberId);
  });
  revalidatePath(`/members/${memberId}`);
}

export async function linkCard(form: FormData) {
  const s = await requireSession();
  const memberId = String(form.get('memberId'));
  const code = Number.parseInt(String(form.get('cardCode') ?? ''), 10);
  const site = Number.parseInt(String(form.get('siteCode') ?? '0'), 10) || 0;
  if (!Number.isSafeInteger(code) || code <= 0) throw new Error('card code must be a number');
  await withTenant(db(), s.tid, async (tx) => {
    await tx`insert into credentials (tenant_id, member_id, kind, site_code, card_code) values (${s.tid}, ${memberId}, 'card', ${site}, ${code})`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data) values (${s.tid}, ${s.uid}, 'credential.linked', ${memberId}, ${tx.json({ site, code } as never)})`;
    await rebuildAccessState(tx, s.tid, memberId);
  });
  revalidatePath(`/members/${memberId}`);
}

/** Send an M-Pesa prompt to the member's phone through the club's TaifaPay account. */
export async function requestMpesa(form: FormData) {
  const s = await requireSession();
  const memberId = String(form.get('memberId'));
  const productId = String(form.get('productId'));
  const phone = String(form.get('phone') ?? '').replace(/\s+/g, '');
  if (!/^(\+?254|0)[17]\d{8}$/.test(phone)) throw new Error('enter a Kenyan phone number');
  const { tenantTaifa } = await import('@lango/server');
  const client = await tenantTaifa(db(), s.tid);
  if (!client) throw new Error('TaifaPay is not connected for this club yet');
  const intent = await withTenant(db(), s.tid, async (tx) => {
    const [m] = await tx<{ member_no: number }[]>`select member_no from members where id = ${memberId}`;
    const [p] = await tx<
      { price_kes: number; name: string }[]
    >`select price_kes, name from products where id = ${productId}`;
    if (!m || !p) throw new Error('member or plan not found');
    const [i] = await tx<
      { id: string }[]
    >`insert into payment_intents (tenant_id, member_id, product_id, amount_kes, phone, provider, created_by)
      values (${s.tid}, ${memberId}, ${productId}, ${p.price_kes}, ${phone}, 'taifapay', ${s.uid}) returning id`;
    return { id: i?.id as string, amount: p.price_kes, ref: String(m.member_no), name: p.name };
  });
  await client.stkPush({
    phone,
    amount: intent.amount,
    accountReference: intent.ref,
    description: intent.name.slice(0, 20),
    externalId: intent.id,
  });
  revalidatePath(`/members/${memberId}`);
}
