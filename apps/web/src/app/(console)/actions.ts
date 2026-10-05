'use server';
import { withTenant } from '@lango/db';
import {
  assignPayment,
  can,
  clubNotify,
  initiatedTransactionId,
  newPairCode,
  rebuildAccessState,
  recordPayment,
  tenantTaifa,
} from '@lango/server';
import { DateTime } from 'luxon';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

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

type NewMember = { first: string; last: string; phone: string | null; wanted: number | null };
type MemberError = 'forbidden' | 'names' | 'number' | 'taken' | 'phone';

/** Kenyan mobile in +2547…/+2541… form, or null when blank; 'bad' when it is not a mobile number. */
function kePhone(raw: string): string | null | 'bad' {
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  const local = d.replace(/^254/, '').replace(/^0/, '');
  return /^[17]\d{8}$/.test(local) ? `+254${local}` : 'bad';
}

function readMember(form: FormData): NewMember | MemberError {
  const first = String(form.get('firstName') ?? '')
    .trim()
    .slice(0, 80);
  const last = String(form.get('lastName') ?? '')
    .trim()
    .slice(0, 80);
  const phone = kePhone(String(form.get('phone') ?? ''));
  const rawNo = String(form.get('memberNo') ?? '').trim();
  const wanted = rawNo ? Number(rawNo) : null;
  if (!first || !last) return 'names';
  if (phone === 'bad') return 'phone';
  if (wanted !== null && !(Number.isInteger(wanted) && wanted >= 1 && wanted <= W26_MAX)) return 'number';
  return { first, last, phone, wanted };
}

/** Creates the member, their default card and access state, and queues the welcome SMS. */
async function insertMember(
  s: Awaited<ReturnType<typeof requireSession>>,
  m: NewMember,
): Promise<string | MemberError> {
  const { first, last, phone, wanted } = m;
  try {
    return await withTenant(db(), s.tid, async (tx) => {
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
      const notify = await clubNotify(tx, s.tid);
      if (phone && notify.enabled && notify.welcome !== false) {
        const [t] = await tx<{ name: string; slug: string; paybill: string | null }[]>`
          select t.name, t.slug, ts.data->'channels'->>'paybill' as paybill
          from tenants t left join tenant_settings ts on ts.tenant_id = t.id where t.id = ${s.tid}`;
        const portal = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
        const pay = t?.paybill ? ` Pay by M-Pesa Paybill ${t.paybill}, account ${memberNo}.` : '';
        const body = `Welcome to ${t?.name}, ${first}. Your member number is ${memberNo}.${pay} Check or renew your plan at ${portal}/m.`;
        await tx`insert into sms_messages (tenant_id, member_id, phone, body, kind, dedupe_key)
                 values (${s.tid}, ${newId}, ${phone}, ${body}, 'welcome', ${`welcome:${newId}`})`;
      }
      return newId;
    });
  } catch (e) {
    if (uniqueViolation(e)) return 'taken';
    if ((e as { code?: string })?.code === 'FULL') return 'number';
    throw e;
  }
}

const MEMBER_ERRORS: Record<MemberError, string> = {
  forbidden: 'Your role can’t add members.',
  names: 'Enter a first and last name.',
  phone: 'Enter a Kenyan mobile number, like 712 345 678.',
  number: 'Member number must be between 1 and 65535.',
  taken: 'That member number is already in use.',
};

/** The Add member modal: returns an error to show in the form, or opens the new member. */
export async function addMember(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const s = await requireSession();
  if (!can(s, 'members.edit')) return { error: MEMBER_ERRORS.forbidden };
  const m = readMember(form);
  if (typeof m === 'string') return { error: MEMBER_ERRORS[m] };
  const r = await insertMember(s, m);
  if (r in MEMBER_ERRORS) return { error: MEMBER_ERRORS[r as MemberError] };
  revalidatePath('/');
  redirect(`/members/${r}?n=added`);
}

/** Cash / card-at-desk payment. Goes through the same matching + period rules as M-Pesa; audited. */
export async function recordDeskPayment(form: FormData) {
  const s = await requireSession();
  const memberId = id(form, 'memberId');
  if (!memberId) redirect('/members');
  if (!can(s, 'payments.record')) back(memberId, 'forbidden');
  const productId = id(form, 'productId');
  // Desk payments are cash only; card and bank go through TaifaPay so they are matched and fee-bearing.
  const channel = 'cash' as const;
  const nonce = String(form.get('nonce') ?? '');
  if (!productId || !UUID.test(nonce)) back(memberId, 'invalid');
  const found = await withTenant(db(), s.tid, async (tx) => {
    const [m] = await tx<{ member_no: number }[]>`select member_no from members where id = ${memberId}`;
    const [p] = await tx<{ price_kes: number }[]>`
      select price_kes from products where id = ${productId} and active and (products.service_id is null or exists (select 1 from services sv where sv.id = products.service_id and sv.active and sv.deleted_at is null and sv.sold_to <> 'walkins'))`;
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
  if (!can(s, 'access.comp')) back(memberId, 'forbidden');
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
  if (!can(s, 'members.edit')) back(memberId, 'forbidden');
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
  if (!can(s, 'payments.record')) back(memberId, 'forbidden');
  const productId = id(form, 'productId');
  const phone = String(form.get('phone') ?? '').replace(/\s+/g, '');
  if (!productId) back(memberId, 'invalid');
  if (!/^(\+?254|0)[17]\d{8}$/.test(phone)) back(memberId, 'phone');
  const client = await tenantTaifa(db(), s.tid);
  if (!client) back(memberId, 'no-taifapay');
  const intent = await withTenant(db(), s.tid, async (tx) => {
    const [m] = await tx<{ member_no: number }[]>`select member_no from members where id = ${memberId}`;
    const [p] = await tx<{ price_kes: number; name: string }[]>`
      select price_kes, name from products where id = ${productId} and active
        and (products.service_id is null or exists (select 1 from services sv where sv.id = products.service_id and sv.active and sv.deleted_at is null and sv.sold_to <> 'walkins'))`;
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

/** Missed-payment queue: point an unmatched payment at the right member and plan (amount must equal the price). */
export async function assignUnmatched(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'payments.assign')) redirect('/payments?n=forbidden');
  const paymentId = id(form, 'paymentId');
  const productId = id(form, 'productId');
  const memberNo = Number(String(form.get('memberNo') ?? '').trim());
  if (!paymentId || !productId || !Number.isInteger(memberNo) || memberNo < 1) redirect('/payments?n=invalid');
  const r = await assignPayment(db(), s.tid, { paymentId, memberNo, productId, actor: s.uid });
  revalidatePath('/payments');
  redirect(
    `/payments?n=${r.status === 'applied' ? 'assigned' : r.status === 'not_found' ? 'gone' : 'still-unmatched'}`,
  );
}

const zoneKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

/** Create a zone or change which AxTraxNG readers it opens (readers come from the Site Bridge's inventory). */
/**
 * Add or rename an area. Club owners and managers name their areas; only the installer links door readers to them
 * (doors.setup): for anyone else the readers already linked are kept as they are.
 */
export async function saveZone(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'doors.manage') && !can(s, 'doors.setup')) redirect('/access?n=forbidden');
  const installer = can(s, 'doors.setup');
  const zoneId = id(form, 'zoneId');
  const siteId = id(form, 'siteId');
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 60);
  // Readers come as checkboxes (from the bridge's inventory) or, before the bridge is installed, as typed IDs.
  const typed = String(form.get('readerIds') ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean);
  const readers = [...new Set([...form.getAll('readers'), ...typed].map(Number))].filter(
    (n) => Number.isInteger(n) && n > 0,
  );
  if (!siteId || !name || (!zoneId && !zoneKey(name))) redirect('/access?n=zone-invalid');
  const r = await withTenant(db(), s.tid, async (tx) => {
    if (zoneId && installer) {
      await tx`update zones set name = ${name}, reader_ids = ${readers} where id = ${zoneId} and site_id = ${siteId}`;
    } else if (zoneId) {
      await tx`update zones set name = ${name} where id = ${zoneId} and site_id = ${siteId}`;
    } else {
      const [dup] = await tx`select 1 from zones where site_id = ${siteId} and key = ${zoneKey(name)}`;
      if (dup) return 'zone-taken';
      await tx`insert into zones (tenant_id, site_id, key, name, reader_ids) values (${s.tid}, ${siteId}, ${zoneKey(name)}, ${name}, ${installer ? readers : []})`;
    }
    await tx`insert into audit_log (tenant_id, actor, action, entity, data) values (${s.tid}, ${s.uid}, 'zone.saved', ${zoneId ?? zoneKey(name)}, ${tx.json({ name, readers } as never)})`;
    return 'saved';
  });
  revalidatePath('/access');
  redirect(`/access?n=${r}`);
}

/** Ask the Site Bridge to read AxTraxNG again (doors, groups, users) on its next sync. */
export async function requestInventory(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'doors.setup')) redirect('/access?n=forbidden');
  const siteId = id(form, 'siteId');
  if (!siteId) redirect('/access');
  await withTenant(db(), s.tid, (tx) => tx`update sites set inventory_requested_at = now() where id = ${siteId}`);
  revalidatePath('/access');
  redirect('/access?n=inventory-requested');
}

/** A fresh pairing code, e.g. when the AxTraxNG PC is replaced (the old bridge must then be reinstalled). */
export async function reissuePairCode() {
  const s = await requireSession();
  if (!can(s, 'doors.setup')) redirect('/access?n=forbidden');
  await withTenant(db(), s.tid, async (tx) => {
    await tx`select app_reissue_pair_code(${newPairCode()})`;
    await tx`insert into audit_log (tenant_id, actor, action) values (${s.tid}, ${s.uid}, 'bridge.pair_code_reissued')`;
  });
  revalidatePath('/access');
  redirect('/access?n=pair-new');
}

/**
 * "Remind all" on the Dashboard: one renewal SMS to every member whose plan ends in the next 7 days, at most once per
 * end date (renewing moves the date, so the next cycle can be reminded again). Goes through the normal SMS queue.
 */
export async function remindEnding(_prev: { done?: string }, _form: FormData): Promise<{ done?: string }> {
  const s = await requireSession();
  if (!can(s, 'messages.manage')) return { done: 'Your role can’t send messages.' };
  const queued = await withTenant(db(), s.tid, async (tx) => {
    const [t] = await tx<{ name: string; slug: string; timezone: string; paybill: string | null }[]>`
      select t.name, t.slug, t.timezone, ts.data->'channels'->>'paybill' as paybill
      from tenants t left join tenant_settings ts on ts.tenant_id = t.id where t.id = ${s.tid}`;
    const due = await tx<{ member_id: string; member_no: number; first_name: string; phone: string; ends: Date }[]>`
      select m.id as member_id, m.member_no, m.first_name, m.phone, x.ends from members m
      join (select member_id, max(ends_at) as ends from entitlements group by member_id) x on x.member_id = m.id
      where m.status = 'active' and m.phone is not null and m.member_no not between 11001 and 11999
        and x.ends between now() and now() + interval '7 days'`;
    const portal = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
    let n = 0;
    for (const d of due) {
      const end = DateTime.fromJSDate(d.ends, { zone: t?.timezone ?? 'Africa/Nairobi' });
      const how = t?.paybill
        ? `Renew on M-Pesa Paybill ${t.paybill}, account ${d.member_no}, or at ${portal}/m.`
        : `Renew at ${portal}/m (member no. ${d.member_no}).`;
      const body = `${t?.name}: ${d.first_name}, your access ends on ${end.toFormat('d LLL')}. ${how}`;
      const r = await tx`insert into sms_messages (tenant_id, member_id, phone, body, kind, dedupe_key, send_before)
        values (${s.tid}, ${d.member_id}, ${d.phone}, ${body}, 'reminder', ${`reminder:manual:${d.member_id}:${end.toISODate()}`}, ${d.ends})
        on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing returning id`;
      n += r.length;
    }
    if (n)
      await tx`insert into audit_log (tenant_id, actor, action, entity, data) values (${s.tid}, ${s.uid}, 'reminders.sent', 'dashboard', ${tx.json({ count: n } as never)})`;
    return { n, due: due.length };
  });
  if (!queued.due) return { done: 'No mobile numbers to text' };
  return { done: queued.n ? `Reminder sent to ${queued.n}` : 'Already reminded' };
}
