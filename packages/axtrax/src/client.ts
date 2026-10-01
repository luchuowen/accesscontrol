import type {
  AccessGroupDT,
  ApiResult,
  CardInfoDT,
  DoorInfoDT,
  EmployeeInfoDT,
  EventPanelInfoDT,
  ReaderInfoDT,
} from './types.js';

export class AxtraxError extends Error {}

export interface AxtraxClientOptions {
  baseUrl: string; // e.g. http://localhost:8080
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
}

/** Typed client for the AxTraxNG REST API v2.0. Treats a non-empty `Errors` envelope as failure. */
export class AxtraxClient {
  private token: string | null = null;
  private readonly f: typeof fetch;
  constructor(private readonly o: AxtraxClientOptions) {
    this.f = o.fetchImpl ?? fetch;
  }

  private async login(): Promise<string> {
    const body = new URLSearchParams({ grant_type: 'password', username: this.o.username, password: this.o.password });
    const r = await this.f(`${this.o.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!r.ok) throw new AxtraxError(`AxTraxNG login failed: HTTP ${r.status}`);
    const j = (await r.json()) as { access_token?: string };
    if (!j.access_token) throw new AxtraxError('AxTraxNG login returned no access_token');
    this.token = j.access_token;
    return this.token;
  }

  async call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, retry = true): Promise<T> {
    const token = this.token ?? (await this.login());
    const r = await this.f(`${this.o.baseUrl}/api/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (r.status === 401 && retry) {
      this.token = null;
      return this.call<T>(method, path, body, false);
    }
    if (!r.ok) throw new AxtraxError(`${method} ${path}: HTTP ${r.status}`);
    const j = (await r.json()) as ApiResult<T>;
    if (j.Errors && j.Errors.length > 0) throw new AxtraxError(`${method} ${path}: ${j.Errors.join('; ')}`);
    return j.Data;
  }

  findUserByNumber(n: number) {
    return this.call<EmployeeInfoDT[] | null>('GET', `User/GetUserByFilter?UserNumber=${n}&ByAnd=true`).then(
      (list) => (list ?? []).find((u) => u.EmpNumCompany === n) ?? null,
    );
  }
  getUser(id: number) {
    return this.call<EmployeeInfoDT>('GET', `User/GetUser?Id=${id}&WithPicture=false`);
  }
  getUsers(count = 1000, offset = 0) {
    return this.call<EmployeeInfoDT[]>('GET', `User/GetUsers?count=${count}&offset=${offset}`);
  }
  addUser(u: Partial<EmployeeInfoDT>) {
    return this.call<EmployeeInfoDT>('POST', 'User/AddUser', u);
  }
  updateUser(u: EmployeeInfoDT) {
    return this.call<EmployeeInfoDT>('PUT', 'User/UpdateUser', u);
  }
  addCard(c: Partial<CardInfoDT>) {
    return this.call<CardInfoDT>('POST', 'Card/AddCard', c);
  }
  updateCard(c: CardInfoDT) {
    return this.call<CardInfoDT>('PUT', 'Card/UpdateCard', c);
  }
  getCardByCode(code: number, site: number, type: number) {
    return this.call<CardInfoDT | null>(
      'GET',
      `Card/GetCardByCode?iCardCode=${code}&iSiteCode=${site}&eCardType=${type}`,
    );
  }
  accessGroups() {
    return this.call<AccessGroupDT[]>('GET', 'AccessGroup/GetAccessGroups');
  }
  addAccessGroup(g: Partial<AccessGroupDT>) {
    return this.call<AccessGroupDT>('POST', 'AccessGroup/Add', g);
  }
  readers() {
    return this.call<ReaderInfoDT[]>('GET', 'ReaderInfo/GetAll');
  }
  doors() {
    return this.call<DoorInfoDT[]>('GET', 'Door/GetAll');
  }
  accessEvents(from: string, to: string, limit = 5000) {
    return this.call<EventPanelInfoDT[]>(
      'GET',
      `EventPanelInfo/GetAccessEvent?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${limit}`,
    );
  }
}
