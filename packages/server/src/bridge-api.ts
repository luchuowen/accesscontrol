import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Sql } from '@lango/db';
import { withTenant } from '@lango/db';
import {
  type AccessState,
  AckRequest,
  DriftRequest,
  EventsRequest,
  InventoryRequest,
  type SyncResponse,
} from '@lango/protocol';
import { queueTamperAlert } from './notify.js';

interface BridgeRow {
  id: string;
  tenant_id: string;
  site_id: string;
  secret: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Verify `Authorization: Bridge <id>:<hmac>` + X-Lango-Timestamp (±5 min). Returns the bridge or null. */
export async function authBridge(sql: Sql, req: Request, raw: string): Promise<BridgeRow | null> {
  const m = /^Bridge ([0-9a-f-]{36}):([0-9a-f]{64})$/.exec(req.headers.get('authorization') ?? '');
  const ts = req.headers.get('x-lango-timestamp') ?? '';
  if (!m || !/^\d{10,16}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > 5 * 60_000) return null;
  const [b] = await sql<BridgeRow[]>`select * from app_bridge_auth(${m[1] as string})`;
  if (!b) return null;
  const path = new URL(req.url).pathname;
  const h = createHash('sha256').update(raw).digest('hex');
  const want = createHmac('sha256', b.secret).update(`${req.method}|${path}|${ts}|${h}`).digest();
  const got = Buffer.from(m[2] as string, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  await sql`select app_bridge_touch(${b.id})`;
  return b;
}

async function changedSince(sql: Sql, b: BridgeRow, cursor: number): Promise<SyncResponse> {
  return withTenant(sql, b.tenant_id, async (tx) => {
    const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${b.tenant_id}`;
    const zones = await tx<
      { key: string; reader_ids: number[] }[]
    >`select key, reader_ids from zones where site_id = ${b.site_id}`;
    const [inv] = await tx<{ wanted: boolean }[]>`
      select s.inventory_requested_at is not null
             and s.inventory_requested_at > coalesce((select received_at from site_inventory i where i.site_id = s.id), 'epoch')
             as wanted
      from sites s where s.id = ${b.site_id}`;
    const rows = await tx<{ doc: AccessState; seq: bigint }[]>`
      select doc, seq from access_states where site_id = ${b.site_id} and seq > ${cursor} order by seq limit 500`;
    const last = rows[rows.length - 1];
    return {
      cursor: last ? Number(last.seq) : cursor,
      timezone: t?.timezone ?? 'Africa/Nairobi',
      zones: Object.fromEntries(zones.map((z) => [z.key, z.reader_ids])),
      states: rows.map((r) => r.doc),
      ...(inv?.wanted ? { inventoryRequested: true } : {}),
    };
  });
}

/** GET /api/bridge/sync?cursor=n&wait=s — long-poll for desired states newer than cursor. */
export async function handleSync(sql: Sql, req: Request): Promise<Response> {
  const b = await authBridge(sql, req, '');
  if (!b) return json(401, { error: 'unauthorized' });
  const u = new URL(req.url);
  const cursor = Math.max(0, Number(u.searchParams.get('cursor') ?? 0) || 0);
  const wait = Math.min(25, Math.max(0, Number(u.searchParams.get('wait') ?? 0) || 0));
  const deadline = Date.now() + wait * 1000;
  for (;;) {
    const res = await changedSince(sql, b, cursor);
    if (res.states.length || Date.now() >= deadline || req.signal.aborted) return json(200, res);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** POST /api/bridge/inventory — what the site's AxTraxNG holds (readers, groups, users + cards) for onboarding. */
export async function handleInventory(sql: Sql, req: Request): Promise<Response> {
  const raw = await req.text();
  const b = await authBridge(sql, req, raw);
  if (!b) return json(401, { error: 'unauthorized' });
  const body = InventoryRequest.safeParse(safeJson(raw));
  if (!body.success) return json(400, { error: body.error.message.slice(0, 500) });
  await withTenant(sql, b.tenant_id, async (tx) => {
    await tx`insert into site_inventory (site_id, tenant_id, data, received_at)
             values (${b.site_id}, ${b.tenant_id}, ${tx.json(body.data as never)}, now())
             on conflict (site_id) do update set data = excluded.data, received_at = now()`;
  });
  return json(200, { ok: true, users: body.data.users.length });
}

/** POST /api/bridge/ack — record which versions the site applied (or why not). */
export async function handleAck(sql: Sql, req: Request): Promise<Response> {
  const raw = await req.text();
  const b = await authBridge(sql, req, raw);
  if (!b) return json(401, { error: 'unauthorized' });
  const body = AckRequest.safeParse(safeJson(raw));
  if (!body.success) return json(400, { error: body.error.message });
  await withTenant(sql, b.tenant_id, async (tx) => {
    for (const r of body.data.results) {
      // A failure keeps the last applied version (the doors still hold that state); it only records the error.
      await tx`update access_states s set applied_version = case when ${r.ok} then ${r.version}::int else s.applied_version end,
                 applied_at = case when ${r.ok} then now() else s.applied_at end,
                 error = ${r.ok ? null : (r.error ?? 'failed').slice(0, 500)}
               from members m where s.member_id = m.id and m.member_no = ${r.memberNo} and s.site_id = ${b.site_id}
                 and s.version = ${r.version}`;
    }
  });
  return json(200, { ok: true });
}

/** POST /api/bridge/events — door events from AxTraxNG (deduplicated by AxTraxNG event ID). */
export async function handleEvents(sql: Sql, req: Request): Promise<Response> {
  const raw = await req.text();
  const b = await authBridge(sql, req, raw);
  if (!b) return json(401, { error: 'unauthorized' });
  const body = EventsRequest.safeParse(safeJson(raw));
  if (!body.success) return json(400, { error: body.error.message });
  const n = await withTenant(sql, b.tenant_id, async (tx) => {
    const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${b.tenant_id}`;
    let inserted = 0;
    for (const e of body.data.events) {
      const r =
        await tx`insert into access_events (tenant_id, site_id, axtrax_event_id, at, reader_id, door_id, member_no, card_code, granted)
        values (${b.tenant_id}, ${b.site_id}, ${e.id}, (${e.at}::timestamp at time zone ${t?.timezone ?? 'Africa/Nairobi'}),
                ${e.readerId}, ${e.doorId}, ${e.userNo}, ${e.cardCode}, ${e.granted})
        on conflict (site_id, axtrax_event_id) do nothing`;
      inserted += r.count;
    }
    return inserted;
  });
  return json(200, { inserted: n });
}

/** POST /api/bridge/pair {code} — one-time pairing: exchanges the code shown in the console for credentials. */
export async function handlePair(sql: Sql, req: Request): Promise<Response> {
  const ip = clientIp(req.headers);
  if (!rateLimit(`pair:${ip}`, 10, 60_000)) return json(429, { error: 'too many attempts, wait a minute' });
  const body = (await req.json().catch(() => ({}))) as { code?: string; version?: string };
  const code = normalisePairCode(String(body.code ?? ''));
  if (!code) return json(400, { error: 'invalid pairing code' });
  const secret = randomBytes(32).toString('hex'); // fresh secret at pairing time; never reused
  const [b] = await sql<
    { id: string }[]
  >`select * from app_bridge_pair(${code}, ${secret}, ${String(body.version ?? '').slice(0, 40)})`;
  if (!b) return json(404, { error: 'unknown, expired or already used pairing code' });
  return json(200, { bridgeId: b.id, secret });
}

const PAIR_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // no 0/O/1/I/L/U
/** 10 characters from a 30-symbol alphabet (~49 bits), shown as XXXXX-XXXXX. */
export function newPairCode(): string {
  const b = randomBytes(10);
  const c = [...b].map((x) => PAIR_ALPHABET[x % PAIR_ALPHABET.length]).join('');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}
export function normalisePairCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return /^[2-9A-HJKMNP-TV-Z]{10}$/.test(c) ? `${c.slice(0, 5)}-${c.slice(5)}` : null;
}

const hits = new Map<string, number[]>();
const recentHits = (key: string, windowMs: number) => {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.set(key, recent);
  if (hits.size > 50_000) for (const [k, v] of hits) if (!v.length) hits.delete(k);
  return recent;
};
/** Small in-process sliding-window limiter (per instance): records this attempt, false when over `max`. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const recent = recentHits(key, windowMs);
  recent.push(Date.now());
  return recent.length <= max;
}
/** True when `key` already has `max` recorded failures in the window (does not record anything). */
export function isLimited(key: string, max: number, windowMs: number): boolean {
  return recentHits(key, windowMs).length >= max;
}
/** Record one failed attempt against `key` (use with isLimited for per-account limits). */
export function recordFailure(key: string, windowMs: number): void {
  recentHits(key, windowMs).push(Date.now());
}
/**
 * Client IP as seen by our reverse proxy (Caddy replaces X-Forwarded-For from untrusted clients, so the
 * last entry is the one it appended). Anything a client sends further left is ignored.
 */
export function clientIp(h: Headers): string {
  const xff = h.get('x-forwarded-for');
  return xff?.split(',').pop()?.trim() || 'local';
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

/** POST /api/bridge/drift — Tamper Guard found AxTraxNG edited outside Lango and reverted it. */
export async function handleDrift(sql: Sql, req: Request): Promise<Response> {
  const raw = await req.text();
  const b = await authBridge(sql, req, raw);
  if (!b) return json(401, { error: 'unauthorized' });
  const body = DriftRequest.safeParse(safeJson(raw));
  if (!body.success) return json(400, { error: body.error.message });
  await withTenant(sql, b.tenant_id, async (tx) => {
    for (const d of body.data.drift) {
      // Scheduled segment switches are expected; only edits to dates/group/cards made by people are tamper.
      await tx`insert into audit_log (tenant_id, actor, action, entity, data)
               values (${b.tenant_id}, 'site-bridge', 'access.tamper_reverted', ${String(d.memberNo)}, ${tx.json({ changes: d.changes } as never)})`;
      await queueTamperAlert(tx, b.tenant_id, d.memberNo);
    }
  });
  return json(200, { ok: true });
}
