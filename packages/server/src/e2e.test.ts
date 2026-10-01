import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AxtraxClient, demoSeed, FakeAxtrax } from '@lango/axtrax';
import { Bridge, Journal } from '@lango/bridge';
import { connect, migrate, type Sql, withTenant } from '@lango/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rebuildAccessState } from './access.js';
import { handleAck, handleDrift, handleEvents, handleSync } from './bridge-api.js';
import { recordPayment } from './payments.js';
import { handleTaifaWebhook, TaifaPay } from './taifapay.js';

/**
 * Walking skeleton, end to end: payment → entitlement → AccessState → bridge long-poll → AxTraxNG (fake)
 * → panel decision. Requires Postgres (DATABASE_OWNER_URL / DATABASE_APP_URL, defaults for local + CI).
 */
const OWNER = process.env.TEST_DATABASE_OWNER_URL ?? 'postgres://lango:lango@localhost:5432/lango_test';
const APP = process.env.TEST_DATABASE_APP_URL ?? 'postgres://lango_app:lango_app@localhost:5432/lango_test';
let owner: Sql;
let app: Sql;
let fake: FakeAxtrax;
let bridge: Bridge;
let tenantId: string;
let otherTenant: string;

beforeAll(async () => {
  owner = connect(OWNER, 2);
  await owner.unsafe('drop schema public cascade; create schema public; grant all on schema public to public');
  await migrate(OWNER);
  app = connect(APP, 4);
  const [t] = await owner`insert into tenants (slug, name) values ('demo-club', 'Demo Club') returning id`;
  const [o] = await owner`insert into tenants (slug, name) values ('other-club', 'Other Club') returning id`;
  tenantId = t?.id as string;
  otherTenant = o?.id as string;
  const [s] = await owner`insert into sites (tenant_id, name) values (${tenantId}, 'Main') returning id`;
  const [b] =
    await owner`insert into bridges (tenant_id, site_id, secret) values (${tenantId}, ${s?.id}, 'test-secret') returning id`;
  await owner`insert into zones (tenant_id, site_id, key, name, reader_ids) values
    (${tenantId}, ${s?.id}, 'gym', 'Gym', '{11}'), (${tenantId}, ${s?.id}, 'sauna', 'Sauna', '{12}')`;
  await owner`insert into products (tenant_id, kind, name, price_kes, duration_unit, duration_count, zone_keys) values
    (${tenantId}, 'membership', 'Gym · 1 month', 5000, 'month', 1, '{gym}'),
    (${tenantId}, 'addon', 'Sauna · 1 week', 600, 'day', 7, '{sauna}')`;
  const [m] = await owner`insert into members (tenant_id, member_no, first_name, last_name, phone) values
    (${tenantId}, 21001, 'Jane', 'Wanjiru', '+254700000001') returning id`;
  await owner`insert into credentials (tenant_id, member_id, card_code) values (${tenantId}, ${m?.id}, 21001)`;
  await withTenant(app, tenantId, (tx) => rebuildAccessState(tx, tenantId, m?.id as string));

  fake = new FakeAxtrax(demoSeed());
  const ax = new AxtraxClient({ baseUrl: await fake.listen(), username: 'lango', password: 'lango' });
  const route = (req: Request) => {
    const p = new URL(req.url).pathname;
    if (p === '/api/bridge/sync') return handleSync(app, req);
    if (p === '/api/bridge/ack') return handleAck(app, req);
    if (p === '/api/bridge/events') return handleEvents(app, req);
    if (p === '/api/bridge/drift') return handleDrift(app, req);
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
  bridge = new Bridge(
    {
      cloudUrl: 'http://cloud.test',
      bridgeId: b?.id as string,
      secret: 'test-secret',
      log: () => {},
      fetchImpl: ((u: string, i: RequestInit) => route(new Request(u, i))) as typeof fetch,
    },
    ax,
    new Journal(join(mkdtempSync(join(tmpdir(), 'lango-')), 'journal.json')),
  );
});
afterAll(async () => {
  await fake?.close();
  await app?.end();
  await owner?.end();
});

const today = () => new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Nairobi' }).replace(' ', 'T');

describe('walking skeleton: pay → door', () => {
  it('enrolled member exists in AxTraxNG but cannot enter', async () => {
    await bridge.cycle(0);
    expect(fake.swipe(21001, 0, 11, today())).toBe(false);
  });

  it('KES 5000 opens the gym (not the sauna) within one bridge cycle', async () => {
    const r = await recordPayment(app, tenantId, {
      provider: 'test',
      providerTxnId: 'TX1',
      amountKes: 5000,
      accountRef: '21001',
      paidAt: new Date(),
    });
    expect(r.status).toBe('applied');
    await bridge.cycle(0);
    expect(fake.swipe(21001, 0, 11, today())).toBe(true);
    expect(fake.swipe(21001, 0, 12, today())).toBe(false);
    const [s] = await owner`select version, applied_version from access_states`;
    expect(s?.applied_version).toBe(s?.version);
  });

  it('a replayed webhook never extends twice', async () => {
    const r = await recordPayment(app, tenantId, {
      provider: 'test',
      providerTxnId: 'TX1',
      amountKes: 5000,
      accountRef: '21001',
      paidAt: new Date(),
    });
    expect(r.status).toBe('duplicate');
    const [{ n }] = (await owner`select count(*)::int as n from entitlements`) as unknown as [{ n: number }];
    expect(n).toBe(1);
  });

  it('an unknown amount is held, not guessed', async () => {
    const r = await recordPayment(app, tenantId, {
      provider: 'test',
      providerTxnId: 'TX2',
      amountKes: 4999,
      accountRef: '21001',
      paidAt: new Date(),
    });
    expect(r).toMatchObject({ status: 'unmatched' });
  });

  it('sauna add-on (KES 600) adds the sauna door', async () => {
    await recordPayment(app, tenantId, {
      provider: 'test',
      providerTxnId: 'TX3',
      amountKes: 600,
      accountRef: '21001',
      paidAt: new Date(),
    });
    await bridge.cycle(0);
    expect(fake.swipe(21001, 0, 12, today())).toBe(true);
    expect([...fake.groups.values()].some((g) => g.tDesc === 'LG: gym + sauna')).toBe(true);
  });

  it('door events reach the cloud once', async () => {
    await bridge.cycle(0);
    await bridge.cycle(0);
    const [{ n }] = (await owner`select count(*)::int as n from access_events`) as unknown as [{ n: number }];
    expect(n).toBe(fake.events.length);
  });

  it('TaifaPay webhook: KES 10 test payment via STK intent is verified by re-query, then applied', async () => {
    const [p] =
      await owner`insert into products (tenant_id, kind, name, price_kes, duration_unit, duration_count, zone_keys)
      values (${tenantId}, 'day_pass', 'Test', 10, 'day', 1, '{gym}') returning id`;
    const [m] = await owner`select id from members where member_no = 21001`;
    const [i] =
      await owner`insert into payment_intents (tenant_id, member_id, product_id, amount_kes, phone, provider, created_by)
      values (${tenantId}, ${m?.id}, ${p?.id}, 10, '0700000001', 'taifapay', 'test') returning id`;
    const truth = { status: 'complete', amount: 10, accountReference: '21001', externalReference: i?.id };
    const fakeFetch = (async (u: string) =>
      new Response(
        JSON.stringify(String(u).endsWith('/auth/token') ? { access_token: 't', expires_in: '3599' } : truth),
        { status: 200 },
      )) as typeof fetch;
    const client = new TaifaPay({ env: 'sandbox', clientId: 'c', clientSecret: 's' }, fakeFetch);
    const body = JSON.stringify({
      eventType: 'transaction.completed',
      data: { transactionId: 'TP-0001', status: 'complete', amount: 10, externalReference: i?.id },
    });
    const res = await handleTaifaWebhook(
      app,
      new Request('http://x/api/webhooks/taifapay/demo-club', { method: 'POST', body }),
      'demo-club',
      client,
    );
    expect(await res.json()).toMatchObject({ status: 'applied', memberNo: 21001, product: 'Test' });
    const [it] = await owner`select status, provider_ref from payment_intents where id = ${i?.id}`;
    expect(it).toMatchObject({ status: 'completed', provider_ref: 'TP-0001' });
  });

  it('TaifaPay webhook: a forged "completed" event is ignored when TaifaPay says otherwise', async () => {
    const fakeFetch = (async (u: string) =>
      new Response(
        JSON.stringify(
          String(u).endsWith('/auth/token')
            ? { access_token: 't', expires_in: '3599' }
            : { status: 'failed', amount: 5000 },
        ),
        { status: 200 },
      )) as typeof fetch;
    const client = new TaifaPay({ env: 'sandbox', clientId: 'c2', clientSecret: 's' }, fakeFetch);
    const body = JSON.stringify({
      eventType: 'transaction.completed',
      data: { transactionId: 'TP-FORGED', status: 'complete', amount: 5000, accountReference: '21001' },
    });
    const res = await handleTaifaWebhook(app, new Request('http://x', { method: 'POST', body }), 'demo-club', client);
    expect(await res.json()).toEqual({ ignored: 'not completed' });
  });

  it('Tamper Guard: a hand-made extension in AxTraxNG is reverted and reported to the owner', async () => {
    const u = [...fake.users.values()].find((x) => x.EmpNumCompany === 21001);
    if (u) u.dtStopDate = '2027-06-30T23:59:59';
    const drift = await bridge.guard();
    expect(drift).toHaveLength(1);
    expect(fake.users.get(u?.ID ?? 0)?.dtStopDate).not.toBe('2027-06-30T23:59:59');
    const [a] = await owner`select action, entity from audit_log where action = 'access.tamper_reverted'`;
    expect(a).toMatchObject({ entity: '21001' });
    expect(await bridge.guard()).toEqual([]); // nothing further to revert
  });

  it('RLS: another tenant sees none of this tenant’s members or payments', async () => {
    const seen = await withTenant(
      app,
      otherTenant,
      (tx) => tx`select (select count(*) from members)::int as m, (select count(*) from payments)::int as p`,
    );
    expect(seen[0]).toEqual({ m: 0, p: 0 });
  });

  it('a forged bridge signature is rejected', async () => {
    const res = await handleSync(
      app,
      new Request('http://cloud.test/api/bridge/sync?cursor=0', {
        headers: {
          authorization: `Bridge ${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}:${'a'.repeat(64)}`,
          'x-lango-timestamp': String(Date.now()),
        },
      }),
    );
    expect(res.status).toBe(401);
  });
});
