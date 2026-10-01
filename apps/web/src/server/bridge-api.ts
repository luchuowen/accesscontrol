import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Sql } from '@lango/db';
import { withTenant } from '@lango/db';
import { type AccessState, AckRequest, EventsRequest, type SyncResponse } from '@lango/protocol';

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
  const [b] = await sql<BridgeRow[]>`select id, tenant_id, site_id, secret from bridges where id = ${m[1] as string}`;
  if (!b) return null;
  const path = new URL(req.url).pathname;
  const h = createHash('sha256').update(raw).digest('hex');
  const want = createHmac('sha256', b.secret).update(`${req.method}|${path}|${ts}|${h}`).digest();
  const got = Buffer.from(m[2] as string, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  await sql`update bridges set last_seen_at = now() where id = ${b.id}`;
  return b;
}

async function changedSince(sql: Sql, b: BridgeRow, cursor: number): Promise<SyncResponse> {
  return withTenant(sql, b.tenant_id, async (tx) => {
    const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${b.tenant_id}`;
    const zones = await tx<
      { key: string; reader_ids: number[] }[]
    >`select key, reader_ids from zones where site_id = ${b.site_id}`;
    const rows = await tx<{ doc: AccessState; seq: bigint }[]>`
      select doc, seq from access_states where site_id = ${b.site_id} and seq > ${cursor} order by seq limit 500`;
    const last = rows[rows.length - 1];
    return {
      cursor: last ? Number(last.seq) : cursor,
      timezone: t?.timezone ?? 'Africa/Nairobi',
      zones: Object.fromEntries(zones.map((z) => [z.key, z.reader_ids])),
      states: rows.map((r) => r.doc),
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

/** POST /api/bridge/ack — record which versions the site applied (or why not). */
export async function handleAck(sql: Sql, req: Request): Promise<Response> {
  const raw = await req.text();
  const b = await authBridge(sql, req, raw);
  if (!b) return json(401, { error: 'unauthorized' });
  const body = AckRequest.safeParse(JSON.parse(raw || '{}'));
  if (!body.success) return json(400, { error: body.error.message });
  await withTenant(sql, b.tenant_id, async (tx) => {
    for (const r of body.data.results) {
      await tx`update access_states s set applied_version = ${r.ok ? r.version : null}, applied_at = case when ${r.ok} then now() else applied_at end,
                 error = ${r.ok ? null : (r.error ?? 'failed')}
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
  const body = EventsRequest.safeParse(JSON.parse(raw || '{}'));
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
