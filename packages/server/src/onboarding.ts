import type { Sql, Tx } from '@lango/db';
import { withTenant } from '@lango/db';
import type { InventoryRequest } from '@lango/protocol';
import { DateTime } from 'luxon';
import { rebuildAccessState } from './access.js';

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  hint: string;
  href: string;
  /** Who does it: NAVAC (payments, during onboarding), the installer (door PC and readers) or the club. */
  by: 'navac' | 'installer' | 'club';
}

/** What is still missing before a club runs on its own. Every item is derived from data, never ticked by hand,
 * except bank settlement which only the club and TaifaPay can confirm. */
export async function onboardingChecklist(sql: Sql, tenantId: string): Promise<ChecklistItem[]> {
  return withTenant(sql, tenantId, async (tx) => {
    const [st] = await tx<{ data: Record<string, Record<string, unknown> | undefined> }[]>`
      select data from tenant_settings where tenant_id = ${tenantId}`;
    const taifa = st?.data.taifapay;
    const ch = st?.data.channels ?? {};
    const [b] = await tx<{ seen: Date | null }[]>`select max(last_seen_at) as seen from app_tenant_bridges()`;
    const [z] = await tx<{ total: number; mapped: number }[]>`
      select count(*)::int as total, count(*) filter (where cardinality(reader_ids) > 0)::int as mapped from zones`;
    const [unmappedInUse] = await tx<{ n: number }[]>`
      select count(*)::int as n from zones z
      where cardinality(z.reader_ids) = 0 and exists (select 1 from products p where p.active and z.key = any(p.zone_keys))`;
    const [p] = await tx<{ n: number }[]>`select count(*)::int as n from products where active`;
    const [m] = await tx<{ n: number }[]>`select count(*)::int as n from members where status = 'active'`;
    const [pay] = await tx<{ n: number }[]>`
      select count(*)::int as n from payments where provider = 'taifapay' and status = 'applied'`;
    return [
      {
        key: 'taifapay',
        label: 'Payment Gateway account connected',
        done: !!taifa,
        hint: 'Merchant keys verified with the Payment Gateway',
        href: '/settings?tab=payments',
        by: 'navac',
      },
      {
        key: 'channels',
        label: 'How members pay is set',
        done: !!(ch.paybill || ch.till || ch.linksOnly),
        hint: 'Paybill or till linked on the Payment Gateway, or payment links only',
        href: '/settings?tab=payments',
        by: 'navac',
      },
      {
        key: 'settlement',
        label: 'Bank settlement confirmed',
        done: !!ch.settlementConfirmed,
        hint: 'The Payment Gateway pays the club’s bank account',
        href: '/settings?tab=payments',
        by: 'navac',
      },
      {
        key: 'bridge',
        label: 'Site Bridge connected',
        done: !!b?.seen,
        hint: 'Installed on the AxTraxNG server PC and paired',
        href: '/access',
        by: 'installer',
      },
      {
        key: 'doors',
        label: 'Doors mapped to zones',
        done: (z?.mapped ?? 0) > 0 && (unmappedInUse?.n ?? 0) === 0,
        hint: 'Every zone a plan sells opens at least one reader',
        href: '/access',
        by: 'installer',
      },
      {
        key: 'plans',
        label: 'Plans priced',
        done: (p?.n ?? 0) > 0,
        hint: 'At least one plan on sale',
        href: '/services',
        by: 'club',
      },
      {
        key: 'members',
        label: 'Members on board',
        done: (m?.n ?? 0) > 0,
        hint: 'Imported from AxTraxNG or added',
        href: '/members',
        by: 'club',
      },
      {
        key: 'first-payment',
        label: 'First payment through the Payment Gateway',
        done: (pay?.n ?? 0) > 0,
        hint: 'A real KES 10 test is enough',
        href: '/payments',
        by: 'club',
      },
    ];
  });
}

type InvUser = InventoryRequest['users'][number];
export interface ImportPlan {
  receivedAt: Date | null;
  total: number;
  create: { user: InvUser; zones: string[]; until: string | null; cards: InvUser['cards'] }[];
  existing: number;
  skipped: { number: number; reason: string }[];
}

const MAX_NO = 2147483647;

/** Work out what an import would do, without writing anything (shown to the club before they confirm). */
export async function planImport(
  tx: Tx,
  siteId: string,
  tz: string,
  graceDays: number,
  groupIds: number[] | null,
): Promise<ImportPlan> {
  const [inv] = await tx<{ data: InventoryRequest; received_at: Date }[]>`
    select data, received_at from site_inventory where site_id = ${siteId}`;
  if (!inv) return { receivedAt: null, total: 0, create: [], existing: 0, skipped: [] };
  const zones = await tx<
    { key: string; reader_ids: number[] }[]
  >`select key, reader_ids from zones where site_id = ${siteId}`;
  const members = new Set((await tx<{ member_no: number }[]>`select member_no from members`).map((m) => m.member_no));
  const cardsTaken = new Set(
    (await tx<{ k: string }[]>`select site_code || ':' || card_code as k from credentials`).map((c) => c.k),
  );
  const groups = new Map(inv.data.groups.map((g) => [g.id, g]));
  const now = DateTime.now().setZone(tz);
  const graceUntil = now.plus({ days: graceDays }).endOf('day');
  const plan: ImportPlan = {
    receivedAt: inv.received_at,
    total: inv.data.users.filter((u) => !groupIds || groupIds.includes(u.groupId ?? -1)).length,
    create: [],
    existing: 0,
    skipped: [],
  };
  for (const u of inv.data.users) {
    if (groupIds && !groupIds.includes(u.groupId ?? -1)) continue; // e.g. staff, security, Master: stay outside Lango
    if (members.has(u.number)) {
      plan.existing++;
      continue;
    }
    if (u.number < 1 || u.number > MAX_NO) {
      plan.skipped.push({ number: u.number, reason: 'user number out of range' });
      continue;
    }
    if (!u.firstName.trim() && !u.lastName.trim()) {
      plan.skipped.push({ number: u.number, reason: 'no name' });
      continue;
    }
    const g = u.groupId != null ? groups.get(u.groupId) : undefined;
    const readers = new Set(g?.readers ?? []);
    const zoneKeys = zones.filter((z) => z.reader_ids.some((r) => readers.has(r))).map((z) => z.key);
    // Today's access is carried over: an enforced end date in the future is kept; no end date gets the grace period.
    let until: DateTime | null = null;
    if (zoneKeys.length) {
      if (u.datesEnforced && u.validUntil) {
        const end = DateTime.fromISO(u.validUntil, { zone: tz });
        if (end.isValid && end > now) until = end;
      } else if (!u.datesEnforced) until = graceUntil;
    }
    const cards = u.cards.filter((c) => {
      const k = `${c.siteCode}:${c.cardCode}`;
      if (cardsTaken.has(k)) return false;
      cardsTaken.add(k);
      return true;
    });
    plan.create.push({ user: u, zones: until ? zoneKeys : [], until: until?.toISO() ?? null, cards });
  }
  return plan;
}

/** Create members (with their cards and current access) from the club's existing AxTraxNG users. Audited. */
export async function importMembers(
  sql: Sql,
  tenantId: string,
  a: { siteId: string; graceDays: number; groupIds: number[]; actor: string },
): Promise<{ created: number; withAccess: number; existing: number; skipped: number }> {
  return withTenant(sql, tenantId, async (tx) => {
    const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${tenantId}`;
    const tz = t?.timezone ?? 'Africa/Nairobi';
    const plan = await planImport(tx, a.siteId, tz, a.graceDays, a.groupIds);
    const now = DateTime.now().setZone(tz).toJSDate();
    let withAccess = 0;
    for (const c of plan.create) {
      const u = c.user;
      const [m] = await tx<{ id: string }[]>`
        insert into members (tenant_id, member_no, first_name, last_name, phone)
        values (${tenantId}, ${u.number}, ${u.firstName.trim() || '—'}, ${u.lastName.trim() || '—'}, ${u.mobile ?? null})
        on conflict (tenant_id, member_no) do nothing returning id`;
      if (!m) continue;
      for (const card of c.cards)
        await tx`insert into credentials (tenant_id, member_id, site_code, card_code, card_type)
                 values (${tenantId}, ${m.id}, ${card.siteCode}, ${card.cardCode}, ${card.cardType})
                 on conflict (tenant_id, site_code, card_code) do nothing`;
      if (c.until && c.zones.length) {
        withAccess++;
        for (const z of c.zones)
          await tx`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source)
                   values (${tenantId}, ${m.id}, ${z}, ${now}, ${new Date(c.until)}, 'import')`;
      }
      await rebuildAccessState(tx, tenantId, m.id);
    }
    const summary = {
      created: plan.create.length,
      withAccess,
      existing: plan.existing,
      skipped: plan.skipped.length,
    };
    await tx`insert into audit_log (tenant_id, actor, action, entity, data)
             values (${tenantId}, ${a.actor}, 'members.imported', ${a.siteId}, ${tx.json({ ...summary, graceDays: a.graceDays, groupIds: a.groupIds } as never)})`;
    return summary;
  });
}

/** Groups that hold staff, not paying members: never offered for import by default. */
export const STAFF_GROUP = /master|staff|admin|security|guard|clean|management|employee|contractor/i;

/** Inventory summary for the Doors & access page: readers, groups (with member counts) and freshness. */
export async function inventorySummary(tx: Tx, siteId: string) {
  const [inv] = await tx<{ data: InventoryRequest; received_at: Date }[]>`
    select data, received_at from site_inventory where site_id = ${siteId}`;
  if (!inv) return null;
  const counts = new Map<number, number>();
  for (const u of inv.data.users) if (u.groupId != null) counts.set(u.groupId, (counts.get(u.groupId) ?? 0) + 1);
  return {
    receivedAt: inv.received_at,
    readers: inv.data.readers,
    users: inv.data.users.length,
    groups: inv.data.groups
      .filter((g) => !g.name.startsWith('LG: '))
      .map((g) => ({
        ...g,
        users: counts.get(g.id) ?? 0,
        staff: STAFF_GROUP.test(g.name) || g.id === 1,
      })),
  };
}
