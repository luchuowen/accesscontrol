import { createHash, createHmac } from 'node:crypto';
import { type AxtraxClient, isGranted } from '@lango/axtrax';
import { type AccessEvent, type AckResult, SyncResponse } from '@lango/protocol';
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
    for (const s of Object.values(this.j.data.states)) {
      try {
        const r = await converge(this.ax, s, this.j.data.zones, this.now());
        if (r.changes.length) drift.push({ memberNo: s.memberNo, changes: r.changes });
      } catch (e) {
        this.log(`guard ${s.memberNo}: ${(e as Error).message}`);
      }
    }
    return drift;
  }

  async pushAcks() {
    if (!this.j.data.pendingAcks.length) return;
    await this.cloud('POST', '/api/bridge/ack', { results: this.j.data.pendingAcks });
    this.j.data.pendingAcks = [];
    this.j.save();
  }

  /** Read access events since the last window (with overlap) and upload them. */
  async pumpEvents(): Promise<number> {
    const to = this.now();
    const from = this.j.data.lastEventTo
      ? DateTime.fromISO(this.j.data.lastEventTo, { zone: to.zone }).minus({ minutes: 2 })
      : to.minus({ hours: 1 });
    const fmt = "yyyy-MM-dd'T'HH:mm:ss";
    const evs = await this.ax.accessEvents(from.toFormat(fmt), to.toFormat(fmt));
    const users = new Map<number, number>();
    const events: AccessEvent[] = [];
    for (const e of evs) {
      if (e.IdEmpNum && !users.has(e.IdEmpNum))
        users.set(e.IdEmpNum, (await this.ax.getUser(e.IdEmpNum)).EmpNumCompany);
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
    if (events.length) await this.cloud('POST', '/api/bridge/events', { events });
    this.j.data.lastEventTo = to.toFormat(fmt);
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
      await this.pumpEvents();
    } catch (e) {
      this.log(`upload: ${(e as Error).message}`);
    }
  }
}
