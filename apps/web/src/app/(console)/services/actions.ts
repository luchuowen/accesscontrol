'use server';
import { durationLabel } from '@lango/core';
import { type Tx, withTenant } from '@lango/db';
import { can } from '@lango/server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';
import { CATALOG_ITEMS, CATEGORIES, type SoldTo } from './catalog';

/**
 * Services (design A "Table + side panel", 2 Oct 2026): a club picks what it sells from the ready list (or names its
 * own), which areas each opens, who can buy it, and its prices with a length in hours, days, weeks, months or years.
 * Editing or retiring never touches anyone already paid: what they bought is copied onto their payment.
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

type Result = { error?: string; ok?: string };
const ICONS = new Set([...CATALOG_ITEMS.map((i) => i.icon), 'layers']);

async function editor() {
  const s = await requireSession();
  return can(s, 'plans.manage') ? s : null;
}

/** The area a new service opens by default: an existing area with its name, or a new area named after it. */
async function areaFor(tx: Tx, tid: string, name: string) {
  const key = areaKey(name);
  if (!key) return null;
  const [hit] = await tx<{ key: string }[]>`
    select key from zones where key = ${key} or lower(name) = lower(${name}) limit 1`;
  if (hit) return hit.key;
  const [site] = await tx<{ id: string }[]>`select id from sites order by created_at limit 1`;
  if (!site) return null;
  await tx`insert into zones (tenant_id, site_id, key, name, reader_ids) values (${tid}, ${site.id}, ${key}, ${name}, ${[]})`;
  return key;
}

/**
 * Add services from the ready list (or one of the club's own). Each opens an area with its name (an existing one when
 * it matches, e.g. "Gym"); doors are linked to that area under Doors & access. Prices are added next.
 */
export async function addServices(picks: { name: string; category?: string; icon?: string }[]): Promise<Result> {
  const s = await editor();
  if (!s) return { error: 'Your role can’t change services.' };
  const list = (Array.isArray(picks) ? picks : []).slice(0, 40).map((p) => {
    const name = clean(String(p?.name ?? ''), 60);
    const known = CATALOG_ITEMS.find((i) => i.name === name);
    const category = known?.cat ?? (CATEGORIES.includes(String(p?.category)) ? String(p?.category) : 'Other');
    const icon = known?.icon ?? (ICONS.has(String(p?.icon)) ? String(p?.icon) : 'layers');
    return { name, category, icon };
  });
  if (!list.length || list.some((p) => !p.name)) return { error: 'Give the service a name.' };
  const r = await withTenant(db(), s.tid, async (tx) => {
    let added = 0;
    for (const p of list) {
      const [dupe] = await tx`select 1 from services where lower(name) = lower(${p.name})`;
      if (dupe) continue;
      const zone = await areaFor(tx, s.tid, p.name);
      if (!zone) return 'Set up the club’s site first (Doors & access).';
      const [sv] = await tx<{ id: string }[]>`
        insert into services (tenant_id, name, zone_keys, category, icon)
        values (${s.tid}, ${p.name}, ${[zone]}, ${p.category}, ${p.icon}) returning id`;
      await tx`insert into audit_log (tenant_id, actor, action, entity, data)
               values (${s.tid}, ${s.uid}, 'service.created', ${sv?.id as string}, ${tx.json(p as never)})`;
      added++;
    }
    return added ? `${added}` : 'Those services are already on your list.';
  });
  if (!/^\d+$/.test(r)) return { error: r };
  revalidatePath('/services');
  return { ok: r };
}

/** Save a service's details: name, group, the areas it opens (or a new area by name) and who can buy it. */
export async function saveService(_prev: Result, form: FormData): Promise<Result> {
  const s = await editor();
  if (!s) return { error: 'Your role can’t change services.' };
  const id = uid(form.get('serviceId'));
  const name = clean(form.get('name'), 60);
  const category = CATEGORIES.includes(String(form.get('category'))) ? String(form.get('category')) : 'Other';
  const soldTo = String(form.get('soldTo')) as SoldTo;
  const newArea = clean(form.get('newArea'), 40);
  let zones = [...new Set(form.getAll('zones').map(String).filter(Boolean))];
  if (!id) return { error: 'That service no longer exists.' };
  if (!name) return { error: 'Give the service a name.' };
  if (!['members', 'walkins', 'both'].includes(soldTo)) return { error: 'Choose who can buy it.' };
  if (!zones.length && !newArea) return { error: 'Choose at least one area this service opens.' };
  const err = await withTenant(db(), s.tid, async (tx) => {
    const [dupe] = await tx`select 1 from services where lower(name) = lower(${name}) and id <> ${id}`;
    if (dupe) return 'Another service already has this name.';
    const known = (await tx<{ key: string }[]>`select distinct key from zones`).map((z) => z.key);
    if (zones.some((z) => !known.includes(z))) return 'One of the areas no longer exists.';
    if (newArea) {
      const key = await areaFor(tx, s.tid, newArea);
      if (!key) return 'Give the new area a name with letters or numbers.';
      zones = [...new Set([...zones, key])];
    }
    const [sv] = await tx<{ id: string }[]>`
      update services set name = ${name}, category = ${category}, sold_to = ${soldTo}, zone_keys = ${zones}
      where id = ${id} returning id`;
    if (!sv) return 'That service no longer exists.';
    const prices = await tx<{ id: string; duration_unit: Unit; duration_count: number }[]>`
      select id, duration_unit, duration_count from products where service_id = ${id}`;
    for (const p of prices)
      await tx`update products set zone_keys = ${zones},
                 name = ${priceName(name, { unit: p.duration_unit, count: p.duration_count, price: 0 })} where id = ${p.id}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${s.tid}, ${s.uid}, 'service.updated', ${id}, ${tx.json({ name, category, soldTo, zones } as never)})`;
    return null;
  });
  if (err) return { error: err };
  revalidatePath('/services');
  return { ok: 'Saved' };
}

/** Add a price to a service, or change one (applies to new sales only). One price per length per service. */
export async function savePrice(_prev: Result, form: FormData): Promise<Result> {
  const s = await editor();
  if (!s) return { error: 'Your role can’t change prices.' };
  const serviceId = uid(form.get('serviceId'));
  const priceId = uid(form.get('priceId'));
  const p = readPrice(form.get('count') ?? 1, form.get('unit') ?? 'day', form.get('price'));
  if (!serviceId) return { error: 'That service no longer exists.' };
  if (!p) return { error: 'Enter a length and an amount in KES.' };
  const err = await withTenant(db(), s.tid, async (tx) => {
    const [sv] = await tx<{ name: string; zone_keys: string[] }[]>`
      select name, zone_keys from services where id = ${serviceId}`;
    if (!sv) return 'That service no longer exists.';
    const [same] = await tx`
      select 1 from products where service_id = ${serviceId} and active and duration_unit = ${p.unit}
        and duration_count = ${p.count} and id is distinct from ${priceId}`;
    if (same) return 'There’s already a price for that length. Change that one instead.';
    if (priceId)
      await tx`update products set price_kes = ${p.price}, duration_unit = ${p.unit}, duration_count = ${p.count},
                 name = ${priceName(sv.name, p)} where id = ${priceId} and service_id = ${serviceId}`;
    else
      await tx`insert into products (tenant_id, service_id, name, price_kes, duration_unit, duration_count, zone_keys)
               values (${s.tid}, ${serviceId}, ${priceName(sv.name, p)}, ${p.price}, ${p.unit}, ${p.count}, ${sv.zone_keys})`;
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${s.tid}, ${s.uid}, ${priceId ? 'price.updated' : 'price.created'}, ${priceId ?? serviceId}, ${tx.json(p as never)})`;
    return null;
  });
  if (err) return { error: err };
  revalidatePath('/services');
  return { ok: priceId ? 'Price saved' : 'Price added' };
}

/** Stop selling a price or a whole service (or put it back). Never affects anyone already paid. */
export async function setOnSale(target: { serviceId?: string; priceId?: string }, on: boolean): Promise<Result> {
  const s = await editor();
  if (!s) return { error: 'Your role can’t change services.' };
  const serviceId = uid(target.serviceId ?? null);
  const priceId = uid(target.priceId ?? null);
  if (!serviceId && !priceId) return { error: 'Nothing to change.' };
  await withTenant(db(), s.tid, async (tx) => {
    if (priceId) await tx`update products set active = ${on} where id = ${priceId}`;
    else if (serviceId) await tx`update services set active = ${on} where id = ${serviceId}`;
    await tx`insert into audit_log (tenant_id, actor, action, entity)
             values (${s.tid}, ${s.uid}, ${on ? 'sale.resumed' : 'sale.stopped'}, ${priceId ?? serviceId})`;
  });
  revalidatePath('/services');
  return { ok: on ? 'On sale' : 'Stopped' };
}
