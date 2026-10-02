'use server';
import { durationLabel } from '@lango/core';
import { withTenant } from '@lango/db';
import { can } from '@lango/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

/**
 * Services (Owen, 2 Oct 2026): a club names what it sells, which areas each opens, and its prices with a length in
 * hours, days, weeks, months or years. Prices may repeat. Editing or retiring never touches anyone already paid:
 * what they bought is copied onto their payment.
 */
const UNITS = ['hour', 'day', 'week', 'month', 'year'] as const;
type Unit = (typeof UNITS)[number];
const MAX: Record<Unit, number> = { hour: 72, day: 366, week: 104, month: 60, year: 10 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uid = (v: FormDataEntryValue | null) => (UUID.test(String(v ?? '')) ? String(v) : null);
const areaKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
const clean = (v: FormDataEntryValue | null, n: number) =>
  String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, n);

export type PriceInput = { count: number; unit: Unit; price: number };
function readPrice(count: unknown, unit: unknown, price: unknown): PriceInput | null {
  const c = Number(count);
  const u = String(unit) as Unit;
  const p = Number(String(price ?? '').replace(/[,\s]/g, ''));
  if (!UNITS.includes(u) || !Number.isInteger(c) || c < 1 || c > MAX[u]) return null;
  if (!Number.isSafeInteger(p) || p < 1 || p > 10_000_000) return null;
  return { count: c, unit: u, price: p };
}
const priceName = (service: string, d: PriceInput) => `${service} · ${durationLabel({ unit: d.unit, count: d.count })}`;

async function guard() {
  const s = await requireSession();
  if (!can(s, 'plans.manage')) redirect('/services?n=forbidden');
  return s;
}

/** New service: name, the areas it opens (existing or a new one by name), and one or more prices. */
export async function createService(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const s = await requireSession();
  if (!can(s, 'plans.manage')) return { error: 'Your role can’t change services.' };
  const name = clean(form.get('name'), 60);
  const newArea = clean(form.get('newArea'), 40);
  let zones = form.getAll('zones').map(String).filter(Boolean);
  let prices: PriceInput[] = [];
  try {
    const raw = JSON.parse(String(form.get('prices') ?? '[]')) as { count: unknown; unit: unknown; price: unknown }[];
    prices = raw.map((r) => readPrice(r.count, r.unit, r.price)).filter((x): x is PriceInput => !!x);
    if (prices.length !== raw.length) return { error: 'Check the prices: each needs a length and an amount in KES.' };
  } catch {
    return { error: 'Check the prices.' };
  }
  if (!name) return { error: 'Give the service a name.' };
  if (newArea && !areaKey(newArea)) return { error: 'Give the new area a name with letters or numbers.' };
  if (!zones.length && !newArea) return { error: 'Choose at least one area this service opens.' };
  if (!prices.length) return { error: 'Add at least one price.' };
  const r = await withTenant(db(), s.tid, async (tx) => {
    const [dupe] = await tx`select 1 from services where lower(name) = lower(${name}) and active`;
    if (dupe) return 'A service with this name already exists.';
    const known = (await tx<{ key: string }[]>`select distinct key from zones`).map((z) => z.key);
    if (zones.some((z) => !known.includes(z))) return 'One of the areas no longer exists.';
    if (newArea) {
      const key = areaKey(newArea);
      if (!known.includes(key)) {
        const [site] = await tx<{ id: string }[]>`select id from sites order by created_at limit 1`;
        if (!site) return 'Set up the club’s site first.';
        await tx`insert into zones (tenant_id, site_id, key, name, reader_ids) values (${s.tid}, ${site.id}, ${key}, ${newArea}, ${[]})`;
      }
      zones = [...new Set([...zones, key])];
    }
    const [sv] = await tx<{ id: string }[]>`
      insert into services (tenant_id, name, zone_keys) values (${s.tid}, ${name}, ${zones}) returning id`;
    for (const p of prices)
      await tx`insert into products (tenant_id, service_id, name, price_kes, duration_unit, duration_count, zone_keys)
               values (${s.tid}, ${sv?.id as string}, ${priceName(name, p)}, ${p.price}, ${p.unit}, ${p.count}, ${zones})`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${s.tid}, ${s.uid}, 'service.created', ${sv?.id as string}, ${tx.json({ name, zones, prices } as never)})`;
    return null;
  });
  if (r) return { error: r };
  revalidatePath('/services');
  redirect('/services?n=service-saved');
}

/** Rename a service or change its areas. Prices follow; people already paid keep exactly what they bought. */
export async function updateService(form: FormData) {
  const s = await guard();
  const id = uid(form.get('serviceId'));
  const name = clean(form.get('name'), 60);
  const zones = form.getAll('zones').map(String).filter(Boolean);
  if (!id || !name || !zones.length) redirect('/services?n=service-invalid');
  await withTenant(db(), s.tid, async (tx) => {
    const known = (await tx<{ key: string }[]>`select distinct key from zones`).map((z) => z.key);
    if (zones.some((z) => !known.includes(z))) return;
    await tx`update services set name = ${name}, zone_keys = ${zones} where id = ${id}`;
    const prices = await tx<{ id: string; duration_unit: Unit; duration_count: number }[]>`
      select id, duration_unit, duration_count from products where service_id = ${id}`;
    for (const p of prices)
      await tx`update products set zone_keys = ${zones},
                 name = ${priceName(name, { unit: p.duration_unit, count: p.duration_count, price: 0 })} where id = ${p.id}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${s.tid}, ${s.uid}, 'service.updated', ${id}, ${tx.json({ name, zones } as never)})`;
  });
  revalidatePath('/services');
  redirect('/services?n=service-saved');
}

/** Add a price to a service, or change an existing price's amount (applies to new sales only). */
export async function savePrice(form: FormData) {
  const s = await guard();
  const serviceId = uid(form.get('serviceId'));
  const priceId = uid(form.get('priceId'));
  const p = readPrice(form.get('count') ?? 1, form.get('unit') ?? 'day', form.get('price'));
  if (!serviceId || !p) redirect('/services?n=price-invalid');
  await withTenant(db(), s.tid, async (tx) => {
    const [sv] = await tx<
      { name: string; zone_keys: string[] }[]
    >`select name, zone_keys from services where id = ${serviceId}`;
    if (!sv) return;
    if (priceId)
      await tx`update products set price_kes = ${p.price}, duration_unit = ${p.unit}, duration_count = ${p.count},
                 name = ${priceName(sv.name, p)} where id = ${priceId} and service_id = ${serviceId}`;
    else
      await tx`insert into products (tenant_id, service_id, name, price_kes, duration_unit, duration_count, zone_keys)
               values (${s.tid}, ${serviceId}, ${priceName(sv.name, p)}, ${p.price}, ${p.unit}, ${p.count}, ${sv.zone_keys})`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${s.tid}, ${s.uid}, ${priceId ? 'price.updated' : 'price.created'}, ${priceId ?? serviceId}, ${tx.json(p as never)})`;
  });
  revalidatePath('/services');
  redirect('/services?n=price-saved');
}

/** Stop selling a price or a whole service (or put it back). Never affects anyone already paid. */
export async function setOnSale(form: FormData) {
  const s = await guard();
  const serviceId = uid(form.get('serviceId'));
  const priceId = uid(form.get('priceId'));
  const on = form.get('on') === 'true';
  await withTenant(db(), s.tid, async (tx) => {
    if (priceId) await tx`update products set active = ${on} where id = ${priceId}`;
    else if (serviceId) {
      await tx`update services set active = ${on} where id = ${serviceId}`;
      await tx`update products set active = ${on} where service_id = ${serviceId}`;
    }
    await tx`insert into audit_log (tenant_id, actor, action, entity)
             values (${s.tid}, ${s.uid}, ${on ? 'sale.resumed' : 'sale.stopped'}, ${priceId ?? serviceId})`;
  });
  revalidatePath('/services');
  redirect('/services');
}
