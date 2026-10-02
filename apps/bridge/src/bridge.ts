import { createHash, createHmac } from 'node:crypto';
import { type AxtraxClient, isGranted } from '@lango/axtrax';
import { type AccessEvent, type AckResult, type InventoryRequest, SyncResponse } from '@lango/protocol';
import { DateTime } from 'luxon';
import { converge } from './converge.js';
import type { Journal } from './journal.js';

export interface BridgeConfig {
  cloudUrl: string;
  bridgeId: string;
  secret: string;
  log?: (m: string) => void;
  fetchImpl?: typeof fetch;
}

/** Signed request to the cloud: HMAC-SHA256(secret, method|path|ts|sha256(body)). */
export function sign(secret: string, method: string, path: string, ts: string, body: string) {
  const h = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret).update(`${method}|${path}|${ts}|${h}`).digest('hex');
}

export class Bridge {
  private f: typeof fetch;
  private log: (m: string) => void;
  constructor(
    private c: BridgeConfig,
    private ax: AxtraxClient,
    private j: Journal,
  ) {
    this.f = c.fetchImpl ?? fetch;
    this.log = c.log ?? ((m) => console.log(`${new Date().toISOString()} ${m}`));
  }

  private async cloud(method: 'GET' | 'POST', path: string, body?: unknown) {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const ts = String(Date.now());
    const r = await this.f(`${this.c.cloudUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Lango-Timestamp': ts,
        Authorization: `Bridge ${this.c.bridgeId}:${sign(this.c.secret, method, path.split('?')[0] ?? path, ts, raw)}`,
      },
      ...(raw ? { body: raw } : {}),
    });
    if (!r.ok) throw new Error(`cloud ${method} ${path}: HTTP ${r.status}`);
    return r.json() as Promise<unknown>;
  }

  now() {
    return DateTime.now().setZone(this.j.data.timezone);
  }

  /** Set when the cloud asks for a fresh read of AxTraxNG (or at start-up). */
  inventoryWanted = true;

  /**
   * Read what this AxTraxNG already holds — readers/doors, access groups, users and their cards — so the club can
   * map doors to zones and import existing members. Read-only; never sends biometric data.
   */
  async collectInventory(): Promise<InventoryRequest> {
    const [readers, doors, groups] = await Promise.all([this.ax.readers(), this.ax.doors(), this.ax.accessGroups()]);
    const doorName = new Map(doors.map((d) => [d.ID, d.tDesc]));
    const users: InventoryRequest['users'] = [];
    const page = 500;
    for (let offset = 0; offset < 50_000; offset += page) {
      const batch = (await this.ax.getUsers(page, offset)) ?? [];
      for (const u of batch) {
        if (!u.EmpNumCompany) continue;
        users.push({
          number: u.EmpNumCompany,
          firstName: (u.tFirstName ?? '').slice(0, 120),
          lastName: (u.tLastName ?? '').slice(0, 120),
          ...(u.tMobile ? { mobile: String(u.tMobile).slice(0, 40) } : {}),
          validFrom: u.dtStartDate ? u.dtStartDate.slice(0, 19) : null,
          validUntil: u.dtStopDate ? u.dtStopDate.slice(0, 19) : null,
          datesEnforced: !!u.bValidDate,
          groupId: u.UserAccGrp?.ID ?? null,
          cards: (u.UserCards ?? [])
            .filter((c) => c.ID > 0 && c.iCardCode > 0)
            .slice(0, 16)
            .map((c) => ({
              siteCode: c.iSiteCode,
              cardCode: c.iCardCode,
              cardType: c.eCardType,
              active: c.wStatus === 1,
            })),
        });
      }
      if (batch.length < page) break;
    }
    return {
      readers: readers.map((r) => ({ id: r.ID, name: r.tDesc ?? `Reader ${r.ID}`, door: doorName.get(r.IdDoor) })),
      groups: groups.map((g) => ({
        id: g.ID,
        name: g.tDesc,
        readers: (g.TimezoneReaders ?? []).map((t) => t.IdReader),
      })),
      users,
    };
  }

  async pushInventory() {
    if (!this.inventoryWanted) return;
    const inv = await this.collectInventory();
    await this.cloud('POST', '/api/bridge/inventory', inv);
    this.inventoryWanted = false;
    this.log(`inventory sent: ${inv.readers.length} readers, ${inv.groups.length} groups, ${inv.users.length} users`);
  }

  /** Pull new desired states (long-poll) into the journal. Returns number of new states. */
  async pull(waitSeconds = 25): Promise<number> {
    const res = SyncResponse.parse(
      await this.cloud('GET', `/api/bridge/sync?cursor=${this.j.data.cursor}&wait=${waitSeconds}`),
    );
    this.j.data.zones = res.zones;
    this.j.data.timezone = res.timezone;
    for (const s of res.states) {
      const prev = this.j.data.states[s.memberNo];
      if (!prev || prev.version <= s.version) this.j.data.states[s.memberNo] = s;
    }
    this.j.data.cursor = res.cursor;
    this.j.save();
    if (res.inventoryRequested) this.inventoryWanted = true;
    return res.states.length;
  }

  /** Converge every member whose desired version is not yet applied. Works offline. */
  async applyPending(): Promise<AckResult[]> {
    const out: AckResult[] = [];
    for (const s of Object.values(this.j.data.states)) {
      if ((this.j.data.applied[s.memberNo] ?? -1) >= s.version) continue;
      try {
        const r = await converge(this.ax, s, this.j.data.zones, this.now());
        this.j.data.applied[s.memberNo] = s.version;
        (this.j.data.wantKeys ??= {})[s.memberNo] = r.wantKey;
        out.push({ memberNo: s.memberNo, version: s.version, ok: true, axtraxUserId: r.axtraxUserId });
        if (r.changes.length) this.log(`member ${s.memberNo} v${s.version}: ${r.changes.join(', ')}`);
      } catch (e) {
        out.push({ memberNo: s.memberNo, version: s.version, ok: false, error: (e as Error).message });
        this.log(`member ${s.memberNo} v${s.version} FAILED: ${(e as Error).message}`);
      }
    }
    this.j.data.pendingAcks.push(...out);
    this.j.save();
    return out;
  }

  /**
   * Tamper Guard + local scheduler: re-converge every member against the journal. Any change made
   * here is either a scheduled segment switch (e.g. add-on ending) or drift someone introduced by hand.
   */
  async guard(): Promise<{ memberNo: number; changes: string[] }[]> {
    const drift: { memberNo: number; changes: string[] }[] = [];
    const keys = (this.j.data.wantKeys ??= {});
    for (const s of Object.values(this.j.data.states)) {
      if ((this.j.data.applied[s.memberNo] ?? -1) < s.version) continue; // not applied yet: applyPending owns it
      try {
        const r = await converge(this.ax, s, this.j.data.zones, this.now());
        const scheduled = keys[s.memberNo] !== r.wantKey;
        keys[s.memberNo] = r.wantKey;
        if (r.changes.length && !scheduled) drift.push({ memberNo: s.memberNo, changes: r.changes });
        else if (r.changes.length) this.log(`member ${s.memberNo}: scheduled switch ${r.changes.join(', ')}`);
      } catch (e) {
        this.log(`guard ${s.memberNo}: ${(e as Error).message}`);
      }
    }
    this.j.save();
    if (drift.length) {
      for (const d of drift) this.log(`TAMPER reverted for member ${d.memberNo}: ${d.changes.join(', ')}`);
      await this.cloud('POST', '/api/bridge/drift', { drift }).catch((e) =>
        this.log(`drift upload: ${(e as Error).message}`),
      );
    }
    return drift;
  }

  async pushAcks() {
    if (!this.j.data.pendingAcks.length) return;
    // Only the latest result per member matters; this also bounds the queue during a long outage.
    const latest = new Map<number, AckResult>();
    for (const a of this.j.data.pendingAcks) {
      const prev = latest.get(a.memberNo);
      if (!prev || prev.version <= a.version) latest.set(a.memberNo, a);
    }
    const batch = [...latest.values()];
    this.j.data.pendingAcks = batch;
    for (let i = 0; i < batch.length; i += 500)
      await this.cloud('POST', '/api/bridge/ack', { results: batch.slice(i, i + 500) });
    // Keep anything queued while uploading (none today: the loop is single-threaded), drop what was sent.
    const sent = new Set(batch);
    this.j.data.pendingAcks = this.j.data.pendingAcks.filter((a) => !sent.has(a));
    this.j.save();
  }

  /** Ask the cloud for every state again (cursor 0); versions already applied are not re-written. */
  requestFullResync() {
    this.j.data.cursor = 0;
    this.j.save();
  }

  /**
   * Read access events since the last window and upload them. Windows overlap by 10 minutes (the cloud
   * dedupes by AxTraxNG event id) so events written late by a panel coming back online are not missed.
   * A full page means there may be more: the next window starts at the last event read.
   */
  async pumpEvents(limit = 5000): Promise<number> {
    const to = this.now();
    const fmt = "yyyy-MM-dd'T'HH:mm:ss";
    const from = this.j.data.lastEventTo
      ? DateTime.fromISO(this.j.data.lastEventTo, { zone: to.zone }).minus({ minutes: 10 })
      : to.minus({ hours: 1 });
    const evs = await this.ax.accessEvents(from.toFormat(fmt), to.toFormat(fmt), limit);
    const users = new Map<number, number | null>();
    const events: AccessEvent[] = [];
    for (const e of evs) {
      if (e.IdEmpNum && !users.has(e.IdEmpNum))
        users.set(
          e.IdEmpNum,
          await this.ax.getUser(e.IdEmpNum).then(
            (u) => u.EmpNumCompany ?? null,
            () => null,
          ),
        );
      events.push({
        id: e.ID,
        at: e.dtEventReal.slice(0, 19),
        readerId: e.IdReader,
        doorId: e.IdDoor,
        userNo: e.IdEmpNum ? (users.get(e.IdEmpNum) ?? null) : null,
        cardCode: e.iCardCode,
        siteCode: e.iSiteCode,
        granted: isGranted(e.iEventType),
      });
    }
    for (let i = 0; i < events.length; i += 1000)
      await this.cloud('POST', '/api/bridge/events', { events: events.slice(i, i + 1000) });
    const full = evs.length >= limit;
    if (full) this.log(`events: page of ${limit} was full; continuing from the newest event read`);
    const lastAt = events.reduce((m, e) => (e.at > m ? e.at : m), '');
    // When the page was full, continue from the newest event read (+10 min overlap covers the boundary).
    this.j.data.lastEventTo =
      full && lastAt
        ? DateTime.fromISO(lastAt, { zone: to.zone }).plus({ minutes: 10 }).toFormat(fmt)
        : to.toFormat(fmt);
    this.j.save();
    return events.length;
  }

  /** One full cycle; each step tolerates the others failing (offline cloud, AxTraxNG restart). */
  async cycle(waitSeconds = 25) {
    try {
      await this.pull(waitSeconds);
    } catch (e) {
      this.log(`pull: ${(e as Error).message} (working from journal)`);
    }
    await this.applyPending();
    try {
      await this.pushAcks();
    } catch (e) {
      this.log(`acks: ${(e as Error).message} (kept for retry)`);
    }
    try {
      await this.pumpEvents();
    } catch (e) {
      this.log(`events: ${(e as Error).message}`);
    }
    try {
      await this.pushInventory();
    } catch (e) {
      this.log(`inventory: ${(e as Error).message}`);
    }
  }
}
