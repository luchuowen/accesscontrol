'use server';
import { withTenant } from '@lango/db';
import { initiatedTransactionId, rebuildAccessState, recordPayment, tenantTaifa } from '@lango/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

const can = (role: string, ...roles: string[]) => roles.includes(role);
const FRONT_DESK = ['owner', 'manager', 'reception'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Wiegand 26 card numbers (and the member numbers used as default card numbers) are 1..65535. */
const W26_MAX = 65535;
const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';
function back(memberId: string, notice: string): never {
  redirect(`/members/${memberId}?n=${notice}`);
}
const id = (form: FormData, k: string) => {
  const v = String(form.get(k) ?? '');
  return UUID.test(v) ? v : null;
};

export async function createMember(form: FormData) {
  const s = await requireSession();
  if (!can(s.role, ...FRONT_DESK)) redirect('/members?new=1&n=forbidden');
  const first = String(form.get('firstName') ?? '')
    .trim()
    .slice(0, 80);
  const last = String(form.get('lastName') ?? '')
    .trim()
    .slice(0, 80);
  const phone = String(form.get('phone') ?? '').replace(/\s+/g, '') || null;
  const rawNo = String(form.get('memberNo') ?? '').trim();
  const wanted = rawNo ? Number(rawNo) : null;
  if (!first || !last) redirect('/members?new=1&n=names');
  if (wanted !== null && !(Number.isInteger(wanted) && wanted >= 1 && wanted <= W26_MAX))
    redirect('/members?new=1&n=number');
  let mid: string;
  try {
    mid = await withTenant(db(), s.tid, async (tx) => {
      const [n] = await tx<{ next: number }[]>`
        select coalesce(max(member_no), 21000) + 1 as next from members where member_no between 21001 and ${W26_MAX}`;
      const memberNo = wanted ?? n?.next ?? 21001;
      if (memberNo > W26_MAX) throw Object.assign(new Error('member numbers exhausted'), { code: 'FULL' });
      const [m] = await tx<{ id: string }[]>`insert into members (tenant_id, member_no, first_name, last_name, phone)
        values (${s.tid}, ${memberNo}, ${first}, ${last}, ${phone}) returning id`;
      const newId = m?.id as string;
      // Default credential: card number = member number (John's convention). Skipped if that card is already issued.
      await tx`insert into credentials (tenant_id, member_id, card_code) values (${s.tid}, ${newId}, ${memberNo})
               on conflict (tenant_id, site_code, card_code) do nothing`;
      await tx`insert into audit_log (tenant_id, actor, action, entity, data) values (${s.tid}, ${s.uid}, 'member.created', ${newId}, ${tx.json({ memberNo } as never)})`;
      await rebuildAccessState(tx, s.tid, newId);
      return newId;
    });
  } catch (e) {
    if (uniqueViolation(e)) redirect('/members?new=1&n=taken');
    if ((e as { code?: string })?.code === 'FULL') redirect('/members?new=1&n=number');
    throw e;
  }
  redirect(`/members/${mid}`);
}

/** Cash / card-at-desk payment. Goes through the same matching + period rules as M-Pesa; audited. */
export async function recordDeskPayment(form: FormData) {
  const s = await requireSession();
  const memberId = id(form, 'memberId');
  if (!memberId) redirect('/members');
  if (!can(s.role, ...FRONT_DESK)) back(memberId, 'forbidden');
  const productId = id(form, 'productId');
  // Desk payments are cash only; card and bank go through TaifaPay so they are matched and fee-bearing.
  const channel = 'cash' as const;
  const nonce = String(form.get('nonce') ?? '');
  if (!productId || !UUID.test(nonce)) back(memberId, 'invalid');
  const found = await withTenant(db(), s.tid, async (tx) => {
    const [m] = await tx<{ member_no: number }[]>`select member_no from members where id = ${memberId}`;
    const [p] = await tx<{ price_kes: number }[]>`select price_kes from products where id = ${productId} and active`;
    return m && p ? { memberNo: m.member_no, price: p.price_kes } : null;
  });
  if (!found) back(memberId, 'invalid');
  const r = await recordPayment(db(), s.tid, {
    provider: `desk-${channel}`,
    providerTxnId: `DESK-${nonce}`, // the form's one-time nonce makes a double-submit a duplicate, not a second sale
    amountKes: found.price,
    accountRef: String(found.memberNo),
    productId,
    channel,
    recordedBy: s.uid,
    paidAt: new Date(),
    raw: { channel },
  });
  revalidatePath(`/members/${memberId}`);
  back(memberId, r.status === 'applied' ? 'paid' : r.status === 'duplicate' ? 'duplicate' : 'unmatched');
}

/** Comp / goodwill access: reason is mandatory, manager+ only, shows on the owner's reports. */
export async function grantOverride(form: FormData) {
  const s = await requireSession();
  const memberId = id(form, 'memberId');
  if (!memberId) redirect('/members');
  if (!can(s.role, 'owner', 'manager')) back(memberId, 'forbidden');
  const zone = String(form.get('zone') ?? '');
  const days = Math.min(31, Math.max(1, Number.parseInt(String(form.get('days') ?? '1'), 10) || 1));
  const reason = String(form.get('reason') ?? '')
    .trim()
    .slice(0, 300);
  if (reason.length < 5) back(memberId, 'reason');
  const ok = await withTenant(db(), s.tid, async (tx) => {
    const [z] = await tx`select 1 from zones where key = ${zone} limit 1`;
    const [m] = await tx`select 1 from members where id = ${memberId}`;
    if (!z || !m) return false;
    // Whole local days in the club's own time zone: today 00:00 → (today + days) 00:00 minus 1 ms.
    const [e] = await tx<{ id: string }[]>`
      with t as (select timezone as tz from tenants where id = ${s.tid}),
           d as (select date_trunc('day', now() at time zone t.tz) as day, t.tz from t)
      insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source)
      select ${s.tid}, ${memberId}, ${zone}, d.day at time zone d.tz,
             (d.day + ${`${days} days`}::interval - interval '1 millisecond') at time zone d.tz, 'override' from d
      returning id`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data) values (${s.tid}, ${s.uid}, 'access.override', ${memberId}, ${tx.json({ zone, days, reason, entitlement: e?.id } as never)})`;
    await rebuildAccessState(tx, s.tid, memberId);
    return true;
  });
  revalidatePath(`/members/${memberId}`);
  back(memberId, ok ? 'granted' : 'invalid');
}

export async function linkCard(form: FormData) {
  const s = await requireSession();
  const memberId = id(form, 'memberId');
  if (!memberId) redirect('/members');
  if (!can(s.role, ...FRONT_DESK)) back(memberId, 'forbidden');
  const code = Number(String(form.get('cardCode') ?? '').trim());
  const site = Number(String(form.get('siteCode') ?? '0').trim() || 0);
  if (!Number.isInteger(code) || code < 1 || code > W26_MAX || !Number.isInteger(site) || site < 0 || site > 255)
    back(memberId, 'card');
  try {
    await withTenant(db(), s.tid, async (tx) => {
      await tx`insert into credentials (tenant_id, member_id, kind, site_code, card_code) values (${s.tid}, ${memberId}, 'card', ${site}, ${code})`;
      await tx`insert into audit_log (tenant_id, actor, action, entity, data) values (${s.tid}, ${s.uid}, 'credential.linked', ${memberId}, ${tx.json({ site, code } as never)})`;
      await rebuildAccessState(tx, s.tid, memberId);
    });
  } catch (e) {
    if (uniqueViolation(e)) back(memberId, 'card-taken');
    throw e;
  }
  revalidatePath(`/members/${memberId}`);
  back(memberId, 'card-linked');
}

/** Send an M-Pesa prompt to the member's phone through the club's TaifaPay account. */
export async function requestMpesa(form: FormData) {
  const s = await requireSession();
  const memberId = id(form, 'memberId');
  if (!memberId) redirect('/members');
  if (!can(s.role, ...FRONT_DESK)) back(memberId, 'forbidden');
  const productId = id(form, 'productId');
  const phone = String(form.get('phone') ?? '').replace(/\s+/g, '');
  if (!productId) back(memberId, 'invalid');
  if (!/^(\+?254|0)[17]\d{8}$/.test(phone)) back(memberId, 'phone');
  const client = await tenantTaifa(db(), s.tid);
  if (!client) back(memberId, 'no-taifapay');
  const intent = await withTenant(db(), s.tid, async (tx) => {
    const [m] = await tx<{ member_no: number }[]>`select member_no from members where id = ${memberId}`;
    const [p] = await tx<{ price_kes: number; name: string }[]>`
      select price_kes, name from products where id = ${productId} and active`;
    if (!m || !p) return null;
    const [i] = await tx<{ id: string }[]>`
      insert into payment_intents (tenant_id, member_id, product_id, amount_kes, phone, provider, created_by)
      values (${s.tid}, ${memberId}, ${productId}, ${p.price_kes}, ${phone}, 'taifapay', ${s.uid}) returning id`;
    return { id: i?.id as string, amount: p.price_kes, ref: String(m.member_no), name: p.name };
  });
  if (!intent) back(memberId, 'invalid');
  let sent = true;
  try {
    const res = await client.stkPush({
      phone,
      amount: intent.amount,
      accountReference: intent.ref,
      description: intent.name.slice(0, 20),
      externalId: intent.id,
    });
    const ref = initiatedTransactionId(res);
    if (ref)
      await withTenant(
        db(),
        s.tid,
        (tx) => tx`update payment_intents set provider_ref = ${ref} where id = ${intent.id}`,
      );
  } catch (err) {
    sent = false;
    console.error('stk push failed', err instanceof Error ? err.message : err);
    await withTenant(db(), s.tid, (tx) => tx`update payment_intents set status = 'failed' where id = ${intent.id}`);
  }
  revalidatePath(`/members/${memberId}`);
  back(memberId, sent ? 'prompt-sent' : 'prompt-failed');
}
