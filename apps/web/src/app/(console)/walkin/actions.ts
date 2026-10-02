'use server';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@lango/db';
import { can, initiatedTransactionId, rebuildAccessState, recordPayment, tenantTaifa } from '@lango/server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

/**
 * Walk-in day pass (design A, approved 2 Oct 2026): name + mobile, the passes they want, M-Pesa prompt or cash, and
 * a free wristband. The band only opens once the money is in, and stops on its own when the pass ends.
 */
const POOL = [11001, 11999] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const kePhone = (raw: string) => {
  const d = raw.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, '');
  return /^[17]\d{8}$/.test(d) ? `+254${d}` : null;
};

/** Free bands right now, and the band last tapped on any reader in the past 90 seconds (to pick it at the desk). */
export async function bandsNow(): Promise<{ free: number[]; tapped: number | null }> {
  const s = await requireSession();
  return withTenant(db(), s.tid, async (tx) => {
    const [free, [tap]] = await Promise.all([
      tx<{ no: number }[]>`
        select m.member_no as no from members m
        where m.member_no between ${POOL[0]} and ${POOL[1]}
          and not exists (select 1 from entitlements e where e.member_id = m.id and e.ends_at > now() and e.starts_at <= now())
          and not exists (select 1 from day_passes d where d.band_id = m.id and d.status = 'awaiting_payment'
                          and d.created_at > now() - interval '15 minutes')
        order by m.member_no`,
      tx<{ no: number }[]>`
        select member_no as no from access_events
        where member_no between ${POOL[0]} and ${POOL[1]} and at > now() - interval '90 seconds' order by at desc limit 1`,
    ]);
    return { free: free.map((x) => x.no), tapped: tap?.no ?? null };
  });
}

/** A returning visitor, recognised by phone: visits and spend this month. */
export async function visitorHistory(phoneRaw: string): Promise<{ visits: number; kes: number; name: string | null }> {
  const s = await requireSession();
  const phone = kePhone(phoneRaw);
  if (!phone) return { visits: 0, kes: 0, name: null };
  return withTenant(db(), s.tid, async (tx) => {
    const [r] = await tx<{ visits: number; kes: number; name: string | null }[]>`
      select count(*)::int as visits, coalesce(sum(total_kes), 0)::int as kes,
             (select visitor_name from day_passes where visitor_phone = ${phone} order by created_at desc limit 1) as name
      from day_passes where visitor_phone = ${phone} and status = 'active' and created_at > date_trunc('month', now())`;
    return r ?? { visits: 0, kes: 0, name: null };
  });
}

export type SaleState = { error?: string; waitingId?: string; done?: { band: number; until: string; name: string } };

export async function sellDayPass(_prev: SaleState, form: FormData): Promise<SaleState> {
  const s = await requireSession();
  if (!can(s, 'payments.record')) return { error: 'Your role can’t take payments.' };
  const name = String(form.get('name') ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  const phoneRaw = String(form.get('phone') ?? '').trim();
  const phone = phoneRaw ? kePhone(phoneRaw) : null;
  const channel = form.get('channel') === 'cash' ? 'cash' : 'mpesa';
  const ids = form
    .getAll('priceId')
    .map(String)
    .filter((x) => UUID.test(x));
  const bandNo = Number(form.get('band'));
  if (!name) return { error: 'Enter the visitor’s name.' };
  if (phoneRaw && !phone) return { error: 'Enter a Kenyan mobile number, like 712 345 678.' };
  if (channel === 'mpesa' && !phone) return { error: 'Enter their mobile number for the M-Pesa prompt.' };
  if (!ids.length) return { error: 'Choose at least one pass.' };
  if (!Number.isInteger(bandNo) || bandNo < POOL[0] || bandNo > POOL[1]) return { error: 'Choose a wristband.' };

  const sale = await withTenant(db(), s.tid, async (tx) => {
    const prices = await tx<{ id: string; name: string; price_kes: number }[]>`
      select p.id, p.name, p.price_kes from products p join services sv on sv.id = p.service_id
      where p.id = any(${ids}) and p.active and sv.active and sv.sold_to <> 'members'`;
    if (prices.length !== ids.length)
      return { error: 'One of the passes is no longer on sale. Refresh and try again.' };
    const [band] = await tx<{ id: string; busy: boolean }[]>`
      select m.id, exists (select 1 from entitlements e where e.member_id = m.id and e.ends_at > now() and e.starts_at <= now())
        or exists (select 1 from day_passes d where d.band_id = m.id and d.status = 'awaiting_payment'
                   and d.created_at > now() - interval '15 minutes') as busy
      from members m where m.member_no = ${bandNo} for update`;
    if (!band) return { error: `Band ${bandNo} isn’t set up yet. Add it under Members → Day passes.` };
    if (band.busy) return { error: `Band ${bandNo} is already in use. Pick another.` };
    const lines = prices.map((p) => ({ productId: p.id, priceKes: p.price_kes, label: p.name }));
    const total = lines.reduce((a, l) => a + l.priceKes, 0);
    const [dp] = await tx<{ id: string }[]>`
      insert into day_passes (tenant_id, band_id, visitor_name, visitor_phone, lines, total_kes, channel, created_by)
      values (${s.tid}, ${band.id}, ${name}, ${phone}, ${tx.json(lines as never)}, ${total}, ${channel}, ${s.uid}) returning id`;
    let intentId: string | null = null;
    if (channel === 'mpesa') {
      const [i] = await tx<{ id: string }[]>`
        insert into payment_intents (tenant_id, member_id, product_id, lines, amount_kes, phone, provider, created_by)
        values (${s.tid}, ${band.id}, ${null}, ${tx.json(lines.map(({ productId, priceKes }) => ({ productId, priceKes })) as never)},
                ${total}, ${phone as string}, 'taifapay', ${s.uid}) returning id`;
      intentId = i?.id ?? null;
      await tx`update day_passes set intent_id = ${intentId} where id = ${dp?.id as string}`;
    }
    return { id: dp?.id as string, lines, total, intentId, label: prices.map((p) => p.name).join(' + ') };
  });
  if ('error' in sale) return { error: sale.error };

  if (channel === 'cash') {
    const r = await recordPayment(db(), s.tid, {
      provider: 'desk-cash',
      providerTxnId: `DESK-${randomUUID()}`,
      amountKes: sale.total,
      accountRef: String(bandNo),
      lines: sale.lines.map(({ productId, priceKes }) => ({ productId, priceKes })),
      dayPassId: sale.id,
      channel: 'cash',
      recordedBy: s.uid,
      paidAt: new Date(),
    });
    if (r.status !== 'applied') return { error: 'The cash sale could not be applied. Check Payments.' };
    revalidatePath('/members');
    return { done: { band: bandNo, until: r.until, name } };
  }

  const client = await tenantTaifa(db(), s.tid);
  const fail = async (msg: string): Promise<SaleState> => {
    await withTenant(db(), s.tid, async (tx) => {
      await tx`update day_passes set status = 'failed' where id = ${sale.id}`;
      if (sale.intentId) await tx`update payment_intents set status = 'failed' where id = ${sale.intentId}`;
    });
    return { error: msg };
  };
  if (!client) return fail('M-Pesa isn’t connected yet (Settings → Payments). Take cash instead.');
  try {
    const res = await client.stkPush({
      phone: phone as string,
      amount: sale.total,
      accountReference: String(bandNo),
      description: 'Day pass',
      externalId: sale.intentId as string,
    });
    const ref = initiatedTransactionId(res);
    if (ref)
      await withTenant(
        db(),
        s.tid,
        (tx) => tx`update payment_intents set provider_ref = ${ref} where id = ${sale.intentId as string}`,
      );
  } catch (err) {
    console.error('walk-in stk push failed', err instanceof Error ? err.message : err);
    return fail('The M-Pesa prompt could not be sent. Try again or take cash.');
  }
  return { waitingId: sale.id };
}

/** Polled while the desk waits for the visitor to approve the M-Pesa prompt. */
export async function dayPassStatus(id: string): Promise<{ status: string; band: number; until: string | null }> {
  const s = await requireSession();
  if (!UUID.test(id)) return { status: 'failed', band: 0, until: null };
  return withTenant(db(), s.tid, async (tx) => {
    const [r] = await tx<{ status: string; band: number; ends_at: Date | null; created_at: Date }[]>`
      select d.status, m.member_no as band, d.ends_at, d.created_at from day_passes d join members m on m.id = d.band_id where d.id = ${id}`;
    if (!r) return { status: 'failed', band: 0, until: null };
    const stale = r.status === 'awaiting_payment' && Date.now() - r.created_at.getTime() > 15 * 60_000;
    return {
      status: stale ? 'expired' : r.status,
      band: r.band,
      until: r.ends_at
        ? r.ends_at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
        : null,
    };
  });
}

/** Cancel a sale still waiting for M-Pesa (visitor changed their mind); frees the band. */
export async function cancelDayPass(id: string) {
  const s = await requireSession();
  if (!UUID.test(id)) return;
  await withTenant(
    db(),
    s.tid,
    (tx) => tx`update day_passes set status = 'cancelled' where id = ${id} and status = 'awaiting_payment'`,
  );
  revalidatePath('/members');
}

/** Add wristbands to the pool: the next free numbers from 11001, each opening with its own number as card code. */
export async function addBands(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'members.edit')) return;
  const n = Math.min(100, Math.max(1, Number(form.get('count')) || 0));
  await withTenant(db(), s.tid, async (tx) => {
    const [last] = await tx<{ no: number | null }[]>`
      select max(member_no) as no from members where member_no between ${POOL[0]} and ${POOL[1]}`;
    let no = (last?.no ?? POOL[0] - 1) + 1;
    for (let i = 0; i < n && no <= POOL[1]; i++, no++) {
      const [m] = await tx<{ id: string }[]>`
        insert into members (tenant_id, member_no, first_name, last_name)
        values (${s.tid}, ${no}, 'Wristband', ${String(no - POOL[0] + 1).padStart(2, '0')}) returning id`;
      await tx`insert into credentials (tenant_id, member_id, kind, card_code) values (${s.tid}, ${m?.id as string}, 'wristband', ${no})
               on conflict (tenant_id, site_code, card_code) do nothing`;
      await rebuildAccessState(tx, s.tid, m?.id as string);
    }
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${s.tid}, ${s.uid}, 'bands.added', 'day-passes', ${tx.json({ count: n } as never)})`;
  });
  revalidatePath('/members');
}
