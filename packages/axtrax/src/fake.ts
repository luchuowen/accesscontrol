import { createServer, type Server } from 'node:http';
import type { AccessGroupDT, CardInfoDT, DoorInfoDT, EmployeeInfoDT, EventPanelInfoDT, ReaderInfoDT } from './types.js';
import { TZ_ALWAYS, UNAUTHORIZED_GROUP_ID } from './types.js';

/**
 * In-memory fake of the AxTraxNG REST API v2.0 (same paths, `{Data, Errors}` envelope, bearer auth),
 * plus `swipe()` which applies panel logic (validity dates + access-group readers) so tests can prove
 * that a payment changes what a door does. Local times are naive ISO strings, as AxTraxNG uses.
 */
export interface FakeSeed {
  readers: ReaderInfoDT[];
  doors: DoorInfoDT[];
  groups?: AccessGroupDT[];
  users?: EmployeeInfoDT[];
}

export class FakeAxtrax {
  users = new Map<number, EmployeeInfoDT>();
  cards = new Map<number, CardInfoDT>();
  groups = new Map<number, AccessGroupDT>();
  events: EventPanelInfoDT[] = [];
  readers: ReaderInfoDT[];
  doors: DoorInfoDT[];
  calls: string[] = [];
  private seq = 100;
  private tokens = new Set<string>();
  server: Server | null = null;

  constructor(
    seed: FakeSeed,
    private creds = { username: 'lango', password: 'lango' },
  ) {
    this.readers = seed.readers;
    this.doors = seed.doors;
    for (const g of [
      {
        ID: 1,
        tDesc: 'Master',
        IsMaster: true,
        TimezoneReaders: seed.readers.map((r) => ({ IdReader: r.ID, IdTimeZone: TZ_ALWAYS })),
      },
      { ID: UNAUTHORIZED_GROUP_ID, tDesc: 'Unauthorized', IsUnauthorized: true, TimezoneReaders: [] },
      ...(seed.groups ?? []),
    ])
      this.groups.set(g.ID, g);
    for (const u of seed.users ?? []) this.putUser(u);
  }

  private id() {
    return ++this.seq;
  }
  private putUser(u: EmployeeInfoDT) {
    for (const c of u.UserCards ?? []) this.cards.set(c.ID, { ...c, IdEmpNum: u.ID });
    this.users.set(u.ID, { ...u, UserCards: [] });
  }
  userView(id: number): EmployeeInfoDT | null {
    const u = this.users.get(id);
    if (!u) return null;
    return { ...u, UserCards: [...this.cards.values()].filter((c) => c.IdEmpNum === id) };
  }

  /** Panel decision for a credential at a reader at local time `at` (naive ISO). */
  swipe(cardCode: number, siteCode: number, readerId: number, at: string): boolean {
    const card = [...this.cards.values()].find((c) => c.iCardCode === cardCode && c.iSiteCode === siteCode);
    const u = card && card.wStatus === 1 ? this.users.get(card.IdEmpNum) : undefined;
    const g = u ? this.groups.get(u.UserAccGrp.ID) : undefined;
    const inDates =
      !!u && (!u.bValidDate || ((!u.dtStartDate || u.dtStartDate <= at) && (!u.dtStopDate || at <= u.dtStopDate)));
    const ok =
      !!u &&
      !u.bAccessDenied &&
      inDates &&
      !!g?.TimezoneReaders.some((t) => t.IdReader === readerId && t.IdTimeZone !== 1);
    const r = this.readers.find((x) => x.ID === readerId);
    this.events.push({
      ID: this.id(),
      IdPanel: r?.IdPanel ?? 0,
      IdReader: readerId,
      IdDoor: r?.IdDoor ?? 0,
      IdEmpNum: u?.ID ?? 0,
      iCardCode: cardCode,
      iSiteCode: siteCode,
      iEventType: ok ? 17 : 33,
      dtEventReal: at,
      dtEventUpload: at,
    });
    return ok;
  }

  handle(method: string, url: URL, body: unknown, auth: string | undefined): { status: number; json: unknown } {
    const ok = (Data: unknown) => ({ status: 200, json: { Data, Errors: null } });
    const err = (m: string) => ({ status: 200, json: { Data: null, Errors: [m] } });
    const p = url.pathname;
    const q = (k: string) => url.searchParams.get(k);
    this.calls.push(`${method} ${p}`);
    if (method === 'POST' && p === '/token') {
      const f = body as Record<string, string>;
      if (f.username !== this.creds.username || f.password !== this.creds.password)
        return { status: 400, json: { error: 'invalid_grant' } };
      const t = `tok${this.id()}`;
      this.tokens.add(t);
      return { status: 200, json: { access_token: t, token_type: 'bearer', expires_in: 86399 } };
    }
    if (!auth || !this.tokens.has(auth.replace(/^Bearer /, '')))
      return { status: 401, json: { Message: 'Authorization has been denied' } };
    const b = body as Record<string, unknown>;
    switch (`${method} ${p}`) {
      case 'GET /api/User/GetUserByFilter': {
        const n = Number(q('UserNumber'));
        return ok([...this.users.keys()].map((id) => this.userView(id)).filter((u) => u && u.EmpNumCompany === n));
      }
      case 'GET /api/User/GetUser':
        return this.users.has(Number(q('Id'))) ? ok(this.userView(Number(q('Id')))) : err('User not found');
      case 'GET /api/User/GetUsers':
        return ok([...this.users.keys()].map((id) => this.userView(id)));
      case 'POST /api/User/AddUser': {
        if (!b.tFirstName || !b.tLastName) return err('First and last name are required');
        if ([...this.users.values()].some((u) => u.EmpNumCompany === b.EmpNumCompany))
          return err('User number already exists');
        const u = { ...(b as unknown as EmployeeInfoDT), ID: this.id() };
        u.UserAccGrp = { ID: (b.UserAccGrp as { ID?: number })?.ID || UNAUTHORIZED_GROUP_ID };
        u.UserDepartment = { ID: (b.UserDepartment as { ID?: number })?.ID || 1 };
        for (const c of (b.UserCards as CardInfoDT[]) ?? [])
          this.cards.set(this.id(), { ...c, ID: this.seq, IdEmpNum: u.ID, wStatus: 1 });
        this.putUser({ ...u, UserCards: [] });
        return ok(this.userView(u.ID));
      }
      case 'PUT /api/User/UpdateUser': {
        const u = b as unknown as EmployeeInfoDT;
        if (!this.users.has(u.ID)) return err('User not found');
        if (u.UserAccGrp && !this.groups.has(u.UserAccGrp.ID)) return err('Access group not found');
        this.users.set(u.ID, { ...this.users.get(u.ID), ...u, UserCards: [] } as EmployeeInfoDT);
        return ok(this.userView(u.ID));
      }
      case 'POST /api/Card/AddCard': {
        const c = b as unknown as CardInfoDT;
        if ([...this.cards.values()].some((x) => x.iCardCode === c.iCardCode && x.iSiteCode === c.iSiteCode))
          return err('Card already exists');
        const n = { ...c, ID: this.id() };
        this.cards.set(n.ID, n);
        return ok(n);
      }
      case 'PUT /api/Card/UpdateCard': {
        const c = b as unknown as CardInfoDT;
        if (!this.cards.has(c.ID)) return err('Card not found');
        this.cards.set(c.ID, { ...this.cards.get(c.ID), ...c } as CardInfoDT);
        return ok(this.cards.get(c.ID));
      }
      case 'GET /api/Card/GetCardByCode':
        return ok(
          [...this.cards.values()].find(
            (c) => c.iCardCode === Number(q('iCardCode')) && c.iSiteCode === Number(q('iSiteCode')),
          ) ?? null,
        );
      case 'GET /api/AccessGroup/GetAccessGroups':
        return ok([...this.groups.values()]);
      case 'POST /api/AccessGroup/Add': {
        const g = { ...(b as unknown as AccessGroupDT), ID: this.id() };
        if ([...this.groups.values()].some((x) => x.tDesc === g.tDesc)) return err('Access group name already exists');
        this.groups.set(g.ID, g);
        return ok(g);
      }
      case 'GET /api/ReaderInfo/GetAll':
        return ok(this.readers);
      case 'GET /api/Door/GetAll':
        return ok(this.doors);
      case 'GET /api/EventPanelInfo/GetAccessEvent': {
        const from = q('from') ?? '';
        const to = q('to') ?? '9999';
        const limit = Number(q('limit') ?? 5000);
        return ok(this.events.filter((e) => e.dtEventReal >= from && e.dtEventReal <= to).slice(0, limit));
      }
      default:
        return { status: 404, json: { Message: `No HTTP resource ${method} ${p}` } };
    }
  }

  listen(port = 0): Promise<string> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://fake');
        const ct = req.headers['content-type'] ?? '';
        const body = !raw
          ? undefined
          : ct.includes('urlencoded')
            ? Object.fromEntries(new URLSearchParams(raw))
            : JSON.parse(raw);
        const r = this.handle(req.method ?? 'GET', url, body, req.headers.authorization);
        res.writeHead(r.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(r.json));
      });
    });
    return new Promise((ok) =>
      this.server?.listen(port, '127.0.0.1', () => {
        const a = this.server?.address();
        ok(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : port}`);
      }),
    );
  }
  close() {
    return new Promise<void>((ok) => (this.server ? this.server.close(() => ok()) : ok()));
  }
}

/** Demo club layout used by tests and the dev fake: gym, sauna, pool, spa doors. */
export const demoSeed = (): FakeSeed => ({
  doors: [
    { ID: 1, tDesc: 'Gym Entrance', IdPanel: 1 },
    { ID: 2, tDesc: 'Sauna', IdPanel: 1 },
    { ID: 3, tDesc: 'Pool Gate', IdPanel: 1 },
    { ID: 4, tDesc: 'Spa', IdPanel: 1 },
  ],
  readers: [
    { ID: 11, tDesc: 'Gym In', IdPanel: 1, IdDoor: 1 },
    { ID: 12, tDesc: 'Sauna In', IdPanel: 1, IdDoor: 2 },
    { ID: 13, tDesc: 'Pool In', IdPanel: 1, IdDoor: 3 },
    { ID: 14, tDesc: 'Spa In', IdPanel: 1, IdDoor: 4 },
  ],
});
