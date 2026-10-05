import { randomInt } from 'node:crypto';
import { type Sql, type Tx, withTenant } from '@lango/db';
import { DateTime } from 'luxon';
import { rebuildAccessState } from './access.js';
import { rateLimit } from './bridge-api.js';
import { memberRules } from './self-service.js';
import { msisdn } from './sms.js';
import { initiatedTransactionId, type TaifaPay, tenantTaifa } from './taifapay.js';

/**
 * Guest pass (5 Oct 2026): a member pays for a friend's day pass from their phone. The friend gets a 6-digit code by
 * SMS; at reception staff type it and hand over a day wristband from the pool, which opens the paid areas until
 * 23:59 that day (the walk-in path). No cash at the desk, and the club learns the friend's number.
 */

const POOL = [11001, 11999] as const;
export type GuestOffer = { productId: string; label: string; service: string; price: number };

/** What a member can buy for a guest: the club's 1-day passes on sale to walk-ins. */
export async function guestOffers(tx: Tx): Promise<GuestOffer[]> {
  return tx<GuestOffer[]>`
    select distinct on (s.name) p.id as "productId", p.name as label, s.name as service, p.price_kes as price
    from products p join services s on s.id = p.service_id
    where p.active and s.active and s.deleted_at is null and s.sold_to <> 'members'
      and p.duration_unit = 'day' and p.duration_count = 1
    order by s.name, p.price_kes`;
}

export type GuestResult = 'sent' | 'failed' | 'wait' | 'unavailable' | 'invalid' | 'limit' | 'off';

export async function startGuestPass(
  sql: Sql,
  tenantId: string,
  hostId: string,
  a: { name: string; phone: string; date: string; productIds: string[] },
  client?: TaifaPay,
): Promise<GuestResult> {
  const name = a.name.trim().replace(/\s+/g, ' ').slice(0, 80);
  const phone = msisdn(a.phone);
  const ids = [...new Set(a.productIds)].filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!name || !phone || !ids.length || ids.length > 5) return 'invalid';
  const taifa = client ?? (await tenantTaifa(sql, tenantId));
  if (!taifa) return 'unavailable';
  const made = await withTenant(sql, tenantId, async (tx) => {
    const rules = (await memberRules(tx, tenantId)).guest;
    if (!rules.enabled) return 'off' as const;
    const [t] = await tx<
      { timezone: string; name: string }[]
    >`select timezone, name from tenants where id = ${tenantId}`;
    const tz = t?.timezone ?? 'Africa/Nairobi';
    const today = DateTime.now().setZone(tz).startOf('day');
    const day = DateTime.fromISO(a.date, { zone: tz }).startOf('day');
    if (!day.isValid || day < today || day > today.plus({ days: 14 })) return 'invalid' as const;
    const [host] = await tx<{ member_no: number; phone: string | null; status: string }[]>`
      select member_no, phone, status from members where id = ${hostId} for update`;
    if (!host?.phone || host.status !== 'active') return 'invalid' as const;
    const [used] = await tx<{ n: number }[]>`
      select count(*)::int as n from guest_passes where host_id = ${hostId} and status in ('paid', 'used', 'awaiting_payment')
        and created_at > date_trunc('month', now()) and (status <> 'awaiting_payment' or created_at > now() - interval '15 minutes')`;
    if ((used?.n ?? 0) >= rules.perMonth) return 'limit' as const;
    const offers = (await guestOffers(tx)).filter((o) => ids.includes(o.productId));
    if (offers.length !== ids.length || new Set(offers.map((o) => o.service)).size !== offers.length)
      return 'invalid' as const;
    // Only a valid bill counts towards the limit of 3 prompts in 5 minutes.
    if (!rateLimit(`member-pay:${hostId}`, 3, 5 * 60_000)) return 'wait' as const;
    const lines = offers.map((o) => ({ productId: o.productId, priceKes: o.price, label: o.label }));
    const total = lines.reduce((s, l) => s + l.priceKes, 0);
    let code = '';
    for (let i = 0; i < 20 && !code; i++) {
      const c = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const [taken] = await tx`select 1 from guest_passes where tenant_id = ${tenantId} and code = ${c}`;
      if (!taken) code = c;
    }
    const [g] = await tx<{ id: string }[]>`
      insert into guest_passes (tenant_id, host_id, guest_name, guest_phone, visit_date, lines, total_kes, code)
      values (${tenantId}, ${hostId}, ${name}, ${phone}, ${day.toISODate()}, ${tx.json(lines as never)}, ${total}, ${code})
      returning id`;
    const [i] = await tx<{ id: string }[]>`
      insert into payment_intents (tenant_id, member_id, product_id, amount_kes, phone, provider, created_by, lines, guest_pass_id)
      values (${tenantId}, ${hostId}, ${null}, ${total}, ${host.phone}, 'taifapay', 'member-guest', ${tx.json(lines as never)}, ${g?.id ?? null})
      returning id`;
    await tx`update guest_passes set intent_id = ${i?.id ?? null} where id = ${g?.id ?? null}`;
    return { gid: g?.id as string, iid: i?.id as string, total, ref: String(host.member_no), phone: host.phone };
  });
  if (typeof made === 'string') return made;
  try {
    const res = await taifa.stkPush({
      phone: made.phone,
      amount: made.total,
      accountReference: made.ref,
      description: 'Guest pass',
      externalId: made.iid,
    });
    const ref = initiatedTransactionId(res);
    if (ref)
      await withTenant(
        sql,
        tenantId,
        (tx) => tx`update payment_intents set provider_ref = ${ref} where id = ${made.iid}`,
      );
    return 'sent';
  } catch (err) {
    console.error('guest stk push failed', err instanceof Error ? err.message : err);
    await withTenant(sql, tenantId, async (tx) => {
      await tx`update payment_intents set status = 'failed' where id = ${made.iid}`;
      await tx`update guest_passes set status = 'failed' where id = ${made.gid}`;
    });
    return 'failed';
  }
}

/** TaifaPay confirmed a guest-pass payment: record it once, mark the pass paid, and text the code to the guest. */
export async function settleGuestPayment(
  sql: Sql,
  tenantId: string,
  p: {
    guestPassId: string;
    intentId: string;
    txId: string;
    amount: number;
    phone?: string | null;
    paidAt: Date;
    raw: unknown;
  },
): Promise<{ status: 'applied' | 'duplicate'; paymentId: string; guestPass: string }> {
  return withTenant(sql, tenantId, async (tx) => {
    const [g] = await tx<
      {
        host_id: string;
        guest_name: string;
        guest_phone: string;
        visit_date: string;
        code: string;
        lines: { productId: string; priceKes: number; label: string }[];
        member_no: number;
        host_first: string;
        host_phone: string | null;
      }[]
    >`select g.host_id, g.guest_name, g.guest_phone, to_char(g.visit_date, 'YYYY-MM-DD') as visit_date, g.code, g.lines,
             m.member_no, m.first_name as host_first, m.phone as host_phone
      from guest_passes g join members m on m.id = g.host_id where g.id = ${p.guestPassId} for update of g`;
    const ins = await tx<{ id: string }[]>`
      insert into payments (tenant_id, provider, provider_txn_id, amount_kes, account_ref, phone, external_ref, status, raw,
                            paid_at, channel, member_id, applied_at)
      values (${tenantId}, 'taifapay', ${p.txId}, ${p.amount}, ${String(g?.member_no ?? '')}, ${p.phone ?? null}, ${p.intentId},
              'applied', ${tx.json(p.raw as never)}, ${p.paidAt}, 'mpesa', ${g?.host_id ?? null}, now())
      on conflict (provider, provider_txn_id) do nothing returning id`;
    if (!ins[0]) {
      const [dup] = await tx<
        { id: string }[]
      >`select id from payments where provider = 'taifapay' and provider_txn_id = ${p.txId}`;
      return { status: 'duplicate' as const, paymentId: dup?.id ?? '', guestPass: p.guestPassId };
    }
    const paymentId = ins[0].id;
    if (!g) return { status: 'applied' as const, paymentId, guestPass: p.guestPassId };
    for (const l of g.lines)
      await tx`insert into payment_lines (tenant_id, payment_id, product_id, label, zone_keys, price_kes, duration_unit, duration_count)
               select ${tenantId}, ${paymentId}, p.id, ${`Guest pass · ${l.label} · ${g.guest_name}`}, p.zone_keys, ${l.priceKes},
                      p.duration_unit, p.duration_count from products p where p.id = ${l.productId}`;
    await tx`update guest_passes set status = 'paid', payment_id = ${paymentId} where id = ${p.guestPassId} and status = 'awaiting_payment'`;
    await tx`update payment_intents set status = 'completed', provider_ref = ${p.txId} where id = ${p.intentId}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, 'system', 'guest_pass.paid', ${p.guestPassId}, ${tx.json({ amount: p.amount, guest: g.guest_name } as never)})`;
    const [t] = await tx<
      { name: string; timezone: string }[]
    >`select name, timezone from tenants where id = ${tenantId}`;
    const day = DateTime.fromISO(g.visit_date, { zone: t?.timezone ?? 'Africa/Nairobi' }).toFormat('ccc d LLL');
    const what = g.lines.map((l) => l.label).join(' + ');
    const code = `${g.code.slice(0, 3)} ${g.code.slice(3)}`;
    await tx`insert into sms_messages (tenant_id, phone, body, kind, dedupe_key)
             values (${tenantId}, ${g.guest_phone}, ${`${t?.name}: ${g.host_first} has booked you a ${what} for ${day}. Show code ${code} at reception to get your wristband.`},
                     'system', ${`guest-code:${p.guestPassId}`})
             on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing`;
    if (g.host_phone)
      await tx`insert into sms_messages (tenant_id, member_id, phone, body, kind, dedupe_key)
               values (${tenantId}, ${g.host_id}, ${g.host_phone}, ${`${t?.name}: KES ${p.amount.toLocaleString('en-KE')} received for ${g.guest_name}'s guest pass on ${day}. We sent them code ${code}.`},
                       'receipt', ${`guest-receipt:${p.guestPassId}`})
               on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing`;
    return { status: 'applied' as const, paymentId, guestPass: p.guestPassId };
  });
}

export type GuestLookup = {
  id: string;
  guestName: string;
  guestPhone: string;
  host: string;
  hostNo: number;
  what: string;
  visitDate: string;
  status: 'paid' | 'used' | 'wrong-day' | 'unpaid';
};

/** Reception: find a guest pass by its code or the guest's phone (today's first). */
export async function findGuestPass(tx: Tx, tenantId: string, q: string): Promise<GuestLookup | null> {
  const digits = q.replace(/\D/g, '');
  const phone = msisdn(q);
  if (digits.length !== 6 && !phone) return null;
  const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${tenantId}`;
  const today = DateTime.now()
    .setZone(t?.timezone ?? 'Africa/Nairobi')
    .toISODate() as string;
  const [g] = await tx<
    {
      id: string;
      guest_name: string;
      guest_phone: string;
      host: string;
      host_no: number;
      lines: { label: string }[];
      visit_date: string;
      status: string;
    }[]
  >`select g.id, g.guest_name, g.guest_phone, m.first_name || coalesce(' ' || m.last_name, '') as host, m.member_no as host_no,
           g.lines, to_char(g.visit_date, 'YYYY-MM-DD') as visit_date, g.status
    from guest_passes g join members m on m.id = g.host_id
    where ${digits.length === 6 ? tx`g.code = ${digits}` : tx`g.guest_phone = ${phone}`}
    order by (to_char(g.visit_date, 'YYYY-MM-DD') = ${today}) desc, g.status = 'paid' desc, g.created_at desc limit 1`;
  if (!g) return null;
  const status =
    g.status === 'used' ? 'used' : g.status !== 'paid' ? 'unpaid' : g.visit_date !== today ? 'wrong-day' : 'paid';
  return {
    id: g.id,
    guestName: g.guest_name,
    guestPhone: g.guest_phone,
    host: g.host,
    hostNo: g.host_no,
    what: g.lines.map((l) => l.label).join(' + '),
    visitDate: g.visit_date,
    status,
  };
}

/** Reception hands over a free day wristband: it opens the paid areas until 23:59 today, then stops by itself. */
export async function redeemGuestPass(
  sql: Sql,
  tenantId: string,
  a: { guestPassId: string; bandNo: number; actor: string },
): Promise<{ ok: true; band: number; until: string } | { ok: false; why: string }> {
  if (!Number.isInteger(a.bandNo) || a.bandNo < POOL[0] || a.bandNo > POOL[1])
    return { ok: false, why: 'Choose a wristband.' };
  return withTenant(sql, tenantId, async (tx) => {
    const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${tenantId}`;
    const tz = t?.timezone ?? 'Africa/Nairobi';
    const now = DateTime.now().setZone(tz);
    const [g] = await tx<
      {
        id: string;
        guest_name: string;
        guest_phone: string;
        lines: { productId: string; priceKes: number; label: string }[];
        total_kes: number;
        payment_id: string | null;
        status: string;
        visit_date: string;
      }[]
    >`select id, guest_name, guest_phone, lines, total_kes, payment_id, status, to_char(visit_date, 'YYYY-MM-DD') as visit_date
      from guest_passes where id = ${a.guestPassId} for update`;
    if (!g || g.status !== 'paid')
      return { ok: false as const, why: 'This guest pass is not paid or was already used.' };
    if (g.visit_date !== now.toISODate())
      return { ok: false as const, why: `This pass is for ${g.visit_date}, not today.` };
    const [band] = await tx<{ id: string; busy: boolean }[]>`
      select m.id, exists (select 1 from entitlements e where e.member_id = m.id and e.ends_at > now() and e.starts_at <= now())
        or exists (select 1 from day_passes d where d.band_id = m.id and d.status = 'awaiting_payment'
                   and d.created_at > now() - interval '15 minutes') as busy
      from members m where m.member_no = ${a.bandNo} for update`;
    if (!band) return { ok: false as const, why: `Band ${a.bandNo} isn’t set up yet.` };
    if (band.busy) return { ok: false as const, why: `Band ${a.bandNo} is already in use. Pick another.` };
    const until = now.endOf('day');
    const [dp] = await tx<{ id: string }[]>`
      insert into day_passes (tenant_id, band_id, visitor_name, visitor_phone, lines, total_kes, channel, status, payment_id, ends_at, created_by)
      values (${tenantId}, ${band.id}, ${g.guest_name}, ${g.guest_phone}, ${tx.json(g.lines as never)}, ${g.total_kes}, 'mpesa', 'active',
              ${g.payment_id}, ${until.toJSDate()}, ${a.actor}) returning id`;
    for (const l of g.lines)
      await tx`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source, source_id, service_id, product_id)
               select ${tenantId}, ${band.id}, z, ${now.toJSDate()}, ${until.toJSDate()}, 'payment', ${g.payment_id}, p.service_id, p.id
               from products p, unnest(p.zone_keys) as z where p.id = ${l.productId}`;
    await tx`update guest_passes set status = 'used', day_pass_id = ${dp?.id ?? null}, used_at = now(), used_by = ${a.actor} where id = ${g.id}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${a.actor}, 'guest_pass.used', ${g.id}, ${tx.json({ band: a.bandNo, guest: g.guest_name } as never)})`;
    await rebuildAccessState(tx, tenantId, band.id);
    return { ok: true as const, band: a.bandNo, until: until.toFormat('HH:mm') };
  });
}

/** The member's guest passes, newest first (portal). */
export async function myGuestPasses(tx: Tx, hostId: string) {
  return tx<
    {
      id: string;
      guest_name: string;
      visit_date: string;
      code: string;
      status: string;
      total_kes: number;
      what: string;
    }[]
  >`select id, guest_name, to_char(visit_date, 'YYYY-MM-DD') as visit_date, code, status, total_kes,
           (select string_agg(x->>'label', ' + ') from jsonb_array_elements(lines) x) as what
    from guest_passes where host_id = ${hostId} and status <> 'failed'
      and (status <> 'awaiting_payment' or created_at > now() - interval '15 minutes')
    order by created_at desc limit 20`;
}
