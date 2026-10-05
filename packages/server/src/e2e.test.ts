import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AxtraxClient, demoSeed, FakeAxtrax } from '@lango/axtrax';
import { Bridge, Journal, sign } from '@lango/bridge';
import { connect, migrate, type Sql, withTenant } from '@lango/db';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rebuildAccessState } from './access.js';
import {
  acceptInvite,
  checkLink,
  codeResendAt,
  createSession,
  inviteStaff,
  noteFailedSignIn,
  readSession,
  requestPasswordReset,
  resetPassword,
  revokeAllSessions,
  staffByEmail,
  startSignInCode,
  verifySignInCode,
} from './accounts.js';
import { billingState, clubPlan, reconcileSubscriptions, startSubscriptionPayment } from './billing.js';
import { handleAck, handleDrift, handleEvents, handleInventory, handlePair, handleSync } from './bridge-api.js';
import { parseMeta, ReplyError, receiveEmail, receiveWhatsApp, sendReply, verifyMeta } from './comms.js';
import { encrypt } from './crypto.js';
import { applyResendEvent, Resend, sendEmail, verifySvix } from './email.js';
import {
  platformAlerts,
  previewAnnouncement,
  queueAnnouncement,
  queueDailySummaries,
  queueTamperAlert,
  queueWinbacks,
  watchBridges,
} from './notify.js';
import { importMembers, onboardingChecklist, planImport } from './onboarding.js';
import { requestOtp, verifyOtp } from './otp.js';
import { assignPayment, recordPayment } from './payments.js';
import { dispatchSms, msisdn, queueReminders, SourceCodeSms, smsUnits } from './sms.js';
import { reconcileTopups, smsDescription, startTopup } from './sms-topup.js';
import { handleTaifaWebhook, reconcileTaifaPay, TaifaAuthError, TaifaPay } from './taifapay.js';
import {
  acceptOwnership,
  assignClubs,
  changeRole,
  clubTeam,
  myClubs,
  offerOwnership,
  removeMember,
  resetRolePerms,
  setPermissions,
  setRolePerm,
  suspendMember,
} from './team.js';

/**
 * Walking skeleton, end to end: payment → entitlement → AccessState → bridge long-poll → AxTraxNG (fake)
 * → panel decision. Requires Postgres (DATABASE_OWNER_URL / DATABASE_APP_URL, defaults for local + CI).
 */
const OWNER = process.env.TEST_DATABASE_OWNER_URL ?? 'postgres://lango:lango@localhost:5432/lango_test';
const APP = process.env.TEST_DATABASE_APP_URL ?? 'postgres://lango_app:lango_app@localhost:5432/lango_test';
let owner: Sql;
let app: Sql;
let fake: FakeAxtrax;
let ax: AxtraxClient;
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
  ax = new AxtraxClient({ baseUrl: await fake.listen(), username: 'lango', password: 'lango' });
  const route = (req: Request) => {
    const p = new URL(req.url).pathname;
    if (p === '/api/bridge/sync') return handleSync(app, req);
    if (p === '/api/bridge/ack') return handleAck(app, req);
    if (p === '/api/bridge/events') return handleEvents(app, req);
    if (p === '/api/bridge/drift') return handleDrift(app, req);
    if (p === '/api/bridge/inventory') return handleInventory(app, req);
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
    expect(await res.json()).toMatchObject({ ignored: 'not completed', state: 'failed' });
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
  it('three M-Pesa payments landing at once stack into three consecutive periods', async () => {
    const [m] = await owner`insert into members (tenant_id, member_no, first_name, last_name) values
      (${tenantId}, 21050, 'Concurrent', 'Payer') returning id`;
    await Promise.all(
      [1, 2, 3].map((i) =>
        recordPayment(app, tenantId, {
          provider: 'taifapay',
          providerTxnId: `TP-RACE-${i}`,
          amountKes: 5000,
          accountRef: '21050',
          paidAt: new Date(),
        }),
      ),
    );
    const ents = await owner<{ starts_at: Date; ends_at: Date }[]>`
      select starts_at, ends_at from entitlements where member_id = ${m?.id} order by starts_at`;
    expect(ents).toHaveLength(3);
    for (let i = 1; i < ents.length; i++) {
      const gap = (ents[i]?.starts_at.getTime() ?? 0) - (ents[i - 1]?.ends_at.getTime() ?? 0);
      expect(gap).toBeGreaterThan(0); // no overlap
      expect(gap).toBeLessThanOrEqual(1000); // no gap: next period starts the second after the last ends
    }
  });

  it('TaifaPay webhook: an envelope saying "completed" around a failed transaction is ignored', async () => {
    const fakeFetch = (async (u: string) =>
      new Response(
        JSON.stringify(
          String(u).endsWith('/auth/token')
            ? { access_token: 't', expires_in: '3599' }
            : { status: 'completed', data: { transactionId: 'TP-ENV-1', status: 'failed', amount: 5000 } },
        ),
        { status: 200 },
      )) as typeof fetch;
    const client = new TaifaPay({ env: 'sandbox', clientId: 'c3', clientSecret: 's' }, fakeFetch);
    const body = JSON.stringify({ data: { transactionId: 'TP-ENV-1' } });
    const res = await handleTaifaWebhook(app, new Request('http://x', { method: 'POST', body }), 'demo-club', client);
    expect(await res.json()).toMatchObject({ ignored: 'not completed', state: 'failed' });
  });

  it('a failed apply keeps the last applied version (the doors still hold it) and records the error', async () => {
    const [b] = await owner`select id from bridges limit 1`;
    const [st] = await owner<{ version: number; applied_version: number }[]>`
      select s.version, s.applied_version from access_states s join members m on m.id = s.member_id where m.member_no = 21001`;
    const raw = JSON.stringify({
      results: [{ memberNo: 21001, version: st?.version, ok: false, error: 'panel offline' }],
    });
    const ts = String(Date.now());
    const res = await handleAck(
      app,
      new Request('http://cloud.test/api/bridge/ack', {
        method: 'POST',
        body: raw,
        headers: {
          authorization: `Bridge ${b?.id}:${sign('test-secret', 'POST', '/api/bridge/ack', ts, raw)}`,
          'x-lango-timestamp': ts,
        },
      }),
    );
    expect(res.status).toBe(200);
    const [after] = await owner`
      select s.applied_version, s.error from access_states s join members m on m.id = s.member_id where m.member_no = 21001`;
    expect(after).toEqual({ applied_version: st?.applied_version, error: 'panel offline' });
  });

  it('pairing: a code works once, rotates the secret, and expired codes are refused', async () => {
    const [s] = await owner`select id from sites limit 1`;
    const [b] = await owner`insert into bridges (tenant_id, site_id, secret, pair_code, pair_expires_at)
      values (${tenantId}, ${s?.id}, 'old', 'ABCDE-FGHJK', now() + interval '1 day') returning id`;
    await owner`insert into bridges (tenant_id, site_id, secret, pair_code, pair_expires_at)
      values (${tenantId}, ${s?.id}, 'old', 'MNPQR-STVWX', now() - interval '1 minute')`;
    const pair = (code: string) =>
      handlePair(app, new Request('http://x/api/bridge/pair', { method: 'POST', body: JSON.stringify({ code }) }));
    const ok = await pair('abcde fghjk');
    expect(ok.status).toBe(200);
    const j = (await ok.json()) as { bridgeId: string; secret: string };
    expect(j.bridgeId).toBe(b?.id);
    const [row] = await owner`select secret, pair_code from bridges where id = ${b?.id}`;
    expect(row).toEqual({ secret: j.secret, pair_code: null });
    expect((await pair('ABCDE-FGHJK')).status).toBe(404);
    expect((await pair('MNPQR-STVWX')).status).toBe(404);
  });
  it('TaifaPay webhook: a response we cannot read is answered 502 (so TaifaPay retries) and audited', async () => {
    const fakeFetch = (async (u: string) =>
      new Response(
        JSON.stringify(String(u).endsWith('/auth/token') ? { access_token: 't', expires_in: '3599' } : { ok: true }),
        { status: 200 },
      )) as typeof fetch;
    const client = new TaifaPay({ env: 'sandbox', clientId: 'c4', clientSecret: 's' }, fakeFetch);
    const body = JSON.stringify({ data: { transactionId: 'TP-ODD-1' } });
    const res = await handleTaifaWebhook(app, new Request('http://x', { method: 'POST', body }), 'demo-club', client);
    expect(res.status).toBe(502);
    const [a] = await owner`select entity from audit_log where action = 'payment.unreadable'`;
    expect(a).toEqual({ entity: 'TP-ODD-1' });
    const [fn] = await owner`select has_function_privilege('public', 'app_staff_login(text)', 'execute') as p`;
    expect(fn).toEqual({ p: false });
  });
  it('TaifaPay key check: an HTML page is "wrong address", a 401 is "rejected", and the /api/v1 base is used', async () => {
    const seen: string[] = [];
    const html = (async (u: string) => {
      seen.push(String(u));
      return new Response('<!DOCTYPE html><html></html>', { status: 200 });
    }) as typeof fetch;
    const e1 = await new TaifaPay({ env: 'live', clientId: 'h1', clientSecret: 's' }, html).verify().catch((e) => e);
    expect(e1).toBeInstanceOf(Error);
    expect(e1).not.toBeInstanceOf(TaifaAuthError);
    expect(seen[0]).toBe('https://merchants.taifapay.africa/api/v1/auth/token');
    const denied = (async () => new Response('{"message":"invalid client"}', { status: 401 })) as typeof fetch;
    const e2 = await new TaifaPay({ env: 'live', clientId: 'h2', clientSecret: 's' }, denied).verify().catch((e) => e);
    expect(e2).toBeInstanceOf(TaifaAuthError);
  });
  it('reconciliation settles a completed STK payment whose webhook never arrived, exactly once', async () => {
    const [m] = await owner`select id from members where member_no = 21001`;
    const [p] = await owner`select id from products where price_kes = 10 limit 1`;
    const [i] =
      await owner`insert into payment_intents (tenant_id, member_id, product_id, amount_kes, phone, provider, provider_ref, created_by, created_at)
      values (${tenantId}, ${m?.id}, ${p?.id}, 10, '0700000001', 'taifapay', 'TP-LOST-1', 'test', now() - interval '2 minutes') returning id`;
    // No TaifaPay keys are stored for this tenant in the test DB, so the poller must skip it…
    expect(await reconcileTaifaPay(app, () => {})).toBe(0);
    // …and once keys exist it uses them; here we drive the same settlement with a fake client via the webhook path.
    const fakeFetch = (async (u: string) =>
      new Response(
        JSON.stringify(
          String(u).endsWith('/auth/token')
            ? { access_token: 't', expires_in: '3599' }
            : {
                transaction: {
                  id: 'TP-LOST-1',
                  status: 'COMPLETED',
                  amount: 10,
                  accountReference: '21001',
                  externalReference: i?.id,
                },
              },
        ),
        { status: 200 },
      )) as typeof fetch;
    const client = new TaifaPay({ env: 'live', clientId: 'c9', clientSecret: 's' }, fakeFetch);
    const hook = () =>
      handleTaifaWebhook(
        app,
        new Request('http://x', { method: 'POST', body: JSON.stringify({ data: { transactionId: 'TP-LOST-1' } }) }),
        'demo-club',
        client,
      );
    expect(await (await hook()).json()).toMatchObject({ status: 'applied' });
    expect(await (await hook()).json()).toMatchObject({ status: 'duplicate' });
    const [it] = await owner`select status from payment_intents where id = ${i?.id}`;
    expect(it).toEqual({ status: 'completed' });
  });
  it('missed-payment queue: a mistyped account number is assigned to the right member and applied', async () => {
    const r = await recordPayment(app, tenantId, {
      provider: 'taifapay',
      providerTxnId: 'TP-TYPO-1',
      amountKes: 5000,
      accountRef: '2100l', // letter l instead of 1
      paidAt: new Date(),
    });
    expect(r.status).toBe('unmatched');
    const [p] = await owner`select id from products where price_kes = 5000`;
    const wrongPlan = await assignPayment(app, tenantId, {
      paymentId: r.paymentId,
      memberNo: 21001,
      productId: (await owner`select id from products where price_kes = 600`)[0]?.id,
      actor: 'test',
    });
    expect(wrongPlan.status).toBe('unmatched'); // KES 5000 can never buy the KES 600 add-on
    const ok = await assignPayment(app, tenantId, {
      paymentId: r.paymentId,
      memberNo: 21001,
      productId: p?.id,
      actor: 'test',
    });
    expect(ok.status).toBe('applied');
    const again = await assignPayment(app, tenantId, {
      paymentId: r.paymentId,
      memberNo: 21001,
      productId: p?.id,
      actor: 'test',
    });
    expect(again.status).toBe('not_found');
  });

  it('onboarding an existing AxTraxNG site: inventory → import keeps today’s access, leaves staff alone', async () => {
    // John's existing setup: a members group on the gym reader, a staff group, and users with cards.
    const members = await ax.addAccessGroup({
      ID: 0,
      tDesc: 'Gym Members',
      TimezoneReaders: [{ IdReader: 11, IdTimeZone: 2 }],
    });
    const staff = await ax.addAccessGroup({
      ID: 0,
      tDesc: 'Staff',
      TimezoneReaders: [
        { IdReader: 11, IdTimeZone: 2 },
        { IdReader: 12, IdTimeZone: 2 },
      ],
    });
    const mk = (n: number, g: number, enforced: boolean, until: string | null) =>
      ax.addUser({
        ID: 0,
        EmpNumCompany: n,
        tFirstName: `First${n}`,
        tLastName: `Last${n}`,
        UserAccGrp: { ID: g },
        UserDepartment: { ID: 1 },
        bValidDate: enforced,
        dtStartDate: enforced ? '2026-01-01T00:00:00' : null,
        dtStopDate: until,
        UserCards: [],
      });
    const u1 = await mk(30001, members.ID, false, null);
    await mk(30002, members.ID, true, '2027-03-31T23:59:59');
    await mk(30003, members.ID, true, '2026-01-31T23:59:59'); // expired already
    const s1 = await mk(39001, staff.ID, false, null);
    await ax.addCard({
      ID: 0,
      iSiteCode: 0,
      iCardCode: 30001,
      eCardType: 1,
      CredentialType: 1,
      wStatus: 1,
      IdEmpNum: u1.ID,
    });
    await ax.addCard({
      ID: 0,
      iSiteCode: 0,
      iCardCode: 39001,
      eCardType: 1,
      CredentialType: 1,
      wStatus: 1,
      IdEmpNum: s1.ID,
    });

    bridge.inventoryWanted = true;
    await bridge.cycle(0);
    const [site] = await owner`select id from sites where tenant_id = ${tenantId}`;
    const [inv] =
      await owner`select jsonb_array_length(data->'users') as n from site_inventory where site_id = ${site?.id}`;
    expect(Number(inv?.n)).toBeGreaterThanOrEqual(4);

    const preview = await withTenant(app, tenantId, (tx) =>
      planImport(tx, site?.id, 'Africa/Nairobi', 14, [members.ID]),
    );
    expect(preview.create.map((c) => c.user.number).sort()).toEqual([30001, 30002, 30003]);
    const r = await importMembers(app, tenantId, {
      siteId: site?.id,
      graceDays: 14,
      groupIds: [members.ID],
      actor: 'test',
    });
    expect(r).toMatchObject({ created: 3, withAccess: 2 });

    await bridge.cycle(0);
    const today = new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Nairobi' }).replace(' ', 'T').slice(0, 19);
    expect(fake.swipe(30001, 0, 11, today)).toBe(true); // grace period, same card
    const u2 = [...fake.users.values()].find((u) => u.EmpNumCompany === 30002);
    expect(u2?.dtStopDate?.slice(0, 10)).toBe('2027-03-31'); // their paid-up end date is kept
    expect(fake.swipe(39001, 0, 12, today)).toBe(true); // staff untouched by Lango
    const st = [...fake.users.values()].find((u) => u.EmpNumCompany === 39001);
    expect(st?.UserAccGrp.ID).toBe(staff.ID);
    const again = await importMembers(app, tenantId, {
      siteId: site?.id,
      graceDays: 14,
      groupIds: [members.ID],
      actor: 'test',
    });
    expect(again).toMatchObject({ created: 0, existing: 3 });
  });

  it('onboarding checklist reflects live data', async () => {
    const items = await onboardingChecklist(app, tenantId);
    const by = Object.fromEntries(items.map((i) => [i.key, i.done]));
    expect(by).toMatchObject({ bridge: true, doors: true, plans: true, members: true, taifapay: false });
  });
  it('partner: a platform admin creates a club in one call; club staff cannot', async () => {
    const [pa] =
      await owner`insert into staff_users (email, name, role, password_hash) values ('ops@navac.test', 'NAVAC Ops', 'partner_admin', 'x') returning id`;
    const [club] = await app`select app_create_club(${pa?.id}, 'muthaiga-test', 'Muthaiga Test', 'Africa/Nairobi',
      'GM@Muthaiga.test', 'General Manager', 'hash', 'ABCDE-23456', 'secret') as id`;
    const [t] = await owner`select slug, (select count(*)::int from sites where tenant_id = ${club?.id}) as sites,
      (select pair_code from bridges where tenant_id = ${club?.id}) as code,
      (select m.role from club_memberships m join staff_users s on s.id = m.staff_id
        where s.email = 'gm@muthaiga.test' and m.tenant_id = ${club?.id}) as owner_role from tenants where id = ${club?.id}`;
    expect(t).toEqual({ slug: 'muthaiga-test', sites: 1, code: 'ABCDE-23456', owner_role: 'owner' });
    const seen = await app`select slug from app_partner_clubs(${pa?.id})`;
    expect(seen.map((r) => r.slug)).toEqual(expect.arrayContaining(['demo-club', 'muthaiga-test']));
    const [clubOwner] = await owner`select id from staff_users where email = 'gm@muthaiga.test'`;
    await expect(
      app`select app_create_club(${clubOwner?.id}, 'x-club', 'X', 'Africa/Nairobi', 'x@x.test', 'X', 'h', 'BCDEF-23456', 's')`,
    ).rejects.toThrow(/not a partner admin/);
    expect(await app`select * from app_partner_clubs(${clubOwner?.id})`).toHaveLength(0);
  });
  it('SMS: nothing is sent while a club has SMS off; once on, receipts and reminders go out once each', async () => {
    expect([msisdn('0712 345 678'), msisdn('+254 112 345678'), msisdn('712345678'), msisdn('020 222 2222')]).toEqual([
      '254712345678',
      '254112345678',
      '254712345678',
      null,
    ]);
    const sent: { mobile: string; message: string; sender?: string }[] = [];
    const fakeFetch = (async (_u: string, i: RequestInit) => {
      const b = JSON.parse(String(i.body));
      if (b.mobile === '254700000666')
        return new Response(JSON.stringify({ status_code: '1003', status_desc: 'Invalid mobile number' }));
      sent.push({ mobile: b.mobile, message: b.message, sender: b.shortcode });
      return new Response(JSON.stringify({ status_code: '1000', status_desc: 'Success', message_id: sent.length }));
    }) as typeof fetch;
    const client = new SourceCodeSms('key', 'NAVAC', fakeFetch);

    // SMS off (default): a payment queues nothing, and stray queued rows are skipped, never sent.
    await recordPayment(app, tenantId, {
      provider: 'taifapay',
      providerTxnId: 'TP-SMS-0',
      amountKes: 600,
      accountRef: '21001',
      paidAt: new Date(),
    });
    await owner`insert into sms_messages (tenant_id, phone, body, kind) values (${tenantId}, '254700000001', 'stray', 'receipt')`;
    expect(await dispatchSms(app, client, () => {})).toBe(0);
    expect(sent).toHaveLength(0);

    await owner`insert into tenant_settings (tenant_id, data) values (${tenantId}, '{"notifications":{"enabled":true,"reminderDays":3,"quietFrom":0,"quietTo":0}}')
      on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await recordPayment(app, tenantId, {
      provider: 'taifapay',
      providerTxnId: 'TP-SMS-1',
      amountKes: 600,
      accountRef: '21001',
      paidAt: new Date(),
    });
    // SMS on but no credit yet: messages wait instead of going out.
    expect(await dispatchSms(app, client, () => {})).toBe(0);
    const [waiting] =
      await owner`select status, error from sms_messages where kind = 'receipt' order by created_at desc limit 1`;
    expect(waiting).toEqual({ status: 'queued', error: 'waiting for SMS credit' });
    const [pa] =
      await owner`insert into staff_users (email, name, role, password_hash) values ('sms-admin@navac.test', 'SMS Admin', 'partner_admin', 'x') returning id`;
    await app`select app_platform_grant_sms(${pa?.id}, ${tenantId}, 3, 'test credit')`;
    await app`select app_platform_set_club_sms(${pa?.id}, ${tenantId}, 'DEMOCLUB', 1.5)`;
    const [m] = await owner`insert into members (tenant_id, member_no, first_name, last_name, phone) values
      (${tenantId}, 29977, 'Bad', 'Number', '0700000666') returning id`;
    await owner`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source)
      values (${tenantId}, ${m?.id}, 'gym', now() - interval '20 days', now() + interval '2 days', 'override')`;
    expect(await queueReminders(app, 'https://lango.test')).toBeGreaterThanOrEqual(1);
    expect(await queueReminders(app, 'https://lango.test')).toBe(0); // never twice for the same end date
    expect(await dispatchSms(app, client, () => {})).toBeGreaterThanOrEqual(1);
    expect(
      sent.some((x) => x.mobile === '254700000001' && /received for Sauna/.test(x.message) && x.sender === 'DEMOCLUB'),
    ).toBe(true);
    const [bal] = await owner`select sum(units)::int as n from sms_ledger where tenant_id = ${tenantId}`;
    expect(bal?.n).toBeLessThan(3); // each SMS sent was paid from the club's credit
    const [bad] = await owner`select status, error from sms_messages where phone = '0700000666'`;
    expect(bad).toMatchObject({ status: 'failed' }); // permanent error: not retried
    const n = sent.length;
    expect(await dispatchSms(app, client, () => {})).toBe(0);
    expect(sent).toHaveLength(n);
  });
  it('SMS credit: units are counted per part; an M-Pesa top-up to NAVAC adds credit once', async () => {
    expect([
      smsUnits('a'.repeat(160)),
      smsUnits('a'.repeat(161)),
      smsUnits('é'.repeat(70)),
      smsUnits('😀'.repeat(36)),
    ]).toEqual([1, 2, 1, 2]);
    let status = 'PENDING';
    const fakeFetch = (async (u: string) =>
      new Response(
        JSON.stringify(
          String(u).endsWith('/auth/token')
            ? { access_token: 't', expires_in: '3599' }
            : { transaction: { id: 'TP-TOPUP-1', status, amount: 1500, mpesaReceiptNumber: 'TJ12ABC3XY' } },
        ),
      )) as typeof fetch;
    const client = new TaifaPay({ env: 'live', clientId: 'navac', clientSecret: 's' }, fakeFetch);
    const [t] =
      await owner`insert into sms_topups (tenant_id, amount_kes, price_kes, units, phone, trigger, created_by, provider_ref, created_at)
      values (${tenantId}, 1500, 1.5, 1000, '254726049097', 'manual', 'test', 'TP-TOPUP-1', now() - interval '2 minutes') returning id`;
    const total = async () =>
      Number(
        (await owner`select coalesce(sum(units), 0)::int as n from sms_ledger where tenant_id = ${tenantId}`)[0]?.n,
      );
    const before = await total();
    expect(await reconcileTopups(app, () => {}, client)).toBe(0); // still pending at TaifaPay
    status = 'COMPLETED';
    expect(await reconcileTopups(app, () => {}, client)).toBe(1);
    expect(await reconcileTopups(app, () => {}, client)).toBe(0); // credited once
    expect((await total()) - before).toBe(1000);
    const [row] = await owner`select status, invoice_no, receipt_ref from sms_topups where id = ${t?.id}`;
    expect(row).toMatchObject({ status: 'completed', receipt_ref: 'TJ12ABC3XY' });
    expect(row?.invoice_no).toMatch(/^LSMS-\d{5}$/); // also the M-Pesa account reference on NAVAC's statement
    const [note] = await owner`select body from sms_messages where kind = 'topup' order by created_at desc limit 1`;
    expect(note?.body).toContain(`(${row?.invoice_no})`);
    expect(smsDescription('Demo Club')).toBe('Lango SMS Demo Club');
    expect(
      await startTopup(app, tenantId, { amountKes: 1000, phone: '0726049097', trigger: 'manual', actor: 'test' }),
    ).toEqual({
      ok: false,
      reason: 'no-platform-taifapay',
    });
  });
  it('Lango subscription: NAVAC sets the plan, the owner pays by M-Pesa, paid-until moves on once', async () => {
    const [pa] = await owner`select id from staff_users where email = 'sms-admin@navac.test'`;
    // Price not agreed yet: nothing to pay.
    await owner`select app_platform_set_plan(${pa?.id}, ${tenantId}, 'Lango Club', ${null}, 'monthly', ${null}, '', '', ${null})`;
    expect(billingState(await clubPlan(app, tenantId))).toBe('unpriced');
    expect(await startSubscriptionPayment(app, tenantId, { cycles: 1, phone: '0726049097', actor: 'test' })).toEqual({
      ok: false,
      reason: 'unpriced',
    });
    // Only NAVAC can set a plan.
    await expect(
      app`select app_platform_set_plan(${tenantId}, ${tenantId}, 'x', 100, 'monthly', ${null}, '', '', ${null})`,
    ).rejects.toThrow(/platform/);
    const paidUntil = DateTime.now().plus({ days: 3 }).toISODate();
    await owner`select app_platform_set_plan(${pa?.id}, ${tenantId}, 'Lango Club', 5000, 'monthly', ${paidUntil}, '', '', ${null})`;
    expect(billingState(await clubPlan(app, tenantId))).toBe('due');
    // A pending payment for 3 months, as startSubscriptionPayment records it, confirmed by the gateway.
    let status = 'PENDING';
    const fakeFetch = (async (u: string) =>
      new Response(
        JSON.stringify(
          String(u).endsWith('/auth/token')
            ? { access_token: 't', expires_in: '3599' }
            : { transaction: { id: 'TP-SUB-1', status, amount: 15000, mpesaReceiptNumber: 'TK12ABC3XY' } },
        ),
      )) as typeof fetch;
    const client = new TaifaPay({ env: 'live', clientId: 'navac', clientSecret: 's' }, fakeFetch);
    const from = DateTime.fromISO(paidUntil as string).plus({ days: 1 });
    const to = from.plus({ months: 3 }).minus({ days: 1 }).toISODate();
    const [inv] = await owner`insert into subscription_invoices (tenant_id, plan_name, cycles, period_from, period_to,
      amount_kes, phone, created_by, provider_ref, created_at)
      values (${tenantId}, 'Lango Club', 3, ${from.toISODate()}, ${to}, 15000, '254726049097', 'test', 'TP-SUB-1',
              now() - interval '2 minutes') returning id, invoice_no`;
    expect(inv?.invoice_no).toMatch(/^LSUB-\d{5}$/);
    expect(await reconcileSubscriptions(app, () => {}, client)).toBe(0);
    status = 'COMPLETED';
    await owner`update club_plans set billing_email = 'accounts@demo.club' where tenant_id = ${tenantId}`;
    expect(await reconcileSubscriptions(app, () => {}, client)).toBe(1);
    expect(await reconcileSubscriptions(app, () => {}, client)).toBe(0);
    // The receipt also goes by email to the club's billing address, once (skipped here: no email account in tests).
    expect(
      await owner`select to_email, kind from email_messages where idempotency_key = ${`receipt-${inv?.invoice_no}`}`,
    ).toEqual([{ to_email: 'accounts@demo.club', kind: 'receipt' }]);
    const plan = await clubPlan(app, tenantId);
    expect(plan?.paid_until).toBe(to);
    expect(billingState(plan)).toBe('active');
    const [r] = await owner`select status, receipt_ref from subscription_invoices where id = ${inv?.id}`;
    expect(r).toMatchObject({ status: 'paid', receipt_ref: 'TK12ABC3XY' });
    // A second payment for the same period (asked for twice) buys the next period, never the same one again.
    await owner`insert into subscription_invoices (tenant_id, plan_name, cycles, period_from, period_to,
      amount_kes, phone, created_by, provider_ref, created_at)
      values (${tenantId}, 'Lango Club', 3, ${from.toISODate()}, ${to}, 15000, '254726049097', 'test', 'TP-SUB-2',
              now() - interval '2 minutes')`;
    expect(await reconcileSubscriptions(app, () => {}, client)).toBe(1);
    const next = DateTime.fromISO(to as string)
      .plus({ days: 1 })
      .plus({ months: 3 })
      .minus({ days: 1 })
      .toISODate();
    expect((await clubPlan(app, tenantId))?.paid_until).toBe(next);
    // A prompt nobody paid is closed after a day.
    const [old] = await owner`insert into subscription_invoices (tenant_id, plan_name, cycles, period_from, period_to,
      amount_kes, phone, created_by, created_at)
      values (${tenantId}, 'Lango Club', 1, ${from.toISODate()}, ${to}, 5000, '254726049097', 'test',
              now() - interval '25 hours') returning id`;
    await reconcileSubscriptions(app, () => {}, client);
    expect((await owner`select status from subscription_invoices where id = ${old?.id}`)[0]?.status).toBe('expired');
    // The club can't change its own plan.
    await expect(withTenant(app, tenantId, (tx) => tx`update club_plans set fee_kes = 10`)).rejects.toThrow(
      /permission/,
    );
  });
  it('SMS etiquette: quiet hours, one message a day, nothing twice; staff and NAVAC alerts; portal sign-in codes', async () => {
    // The previous test switched quiet hours off to run at any time of day; this one tests them.
    await owner`update tenant_settings set data = jsonb_set(data, '{notifications}', (data->'notifications') - 'quietFrom' - 'quietTo') where tenant_id = ${tenantId}`;
    const sent: { mobile: string; message: string }[] = [];
    const fakeFetch = (async (_u: string, i: RequestInit) => {
      const b = JSON.parse(String(i.body));
      sent.push({ mobile: b.mobile, message: b.message });
      return new Response(
        JSON.stringify({ status_code: '1000', status_desc: 'Success', message_id: sent.length, credit_balance: '250' }),
      );
    }) as typeof fetch;
    const client = new SourceCodeSms('key', 'NAVAC', fakeFetch);
    const night = DateTime.now().setZone('Africa/Nairobi').set({ hour: 22 });
    const day = night.set({ hour: 10 });
    const to = (m: string) => sent.filter((x) => x.mobile === m);
    await owner`update sms_messages set status = 'skipped' where status = 'queued'`;
    await owner`update tenant_settings set data = jsonb_set(data, '{notifications}',
      data->'notifications' || '{"alertPhone":"0726049097","lowBalance":0}') where tenant_id = ${tenantId}`;
    const [w] = await owner`insert into members (tenant_id, member_no, first_name, last_name, phone) values
      (${tenantId}, 21088, 'Wanjiku', 'Kamau', '0711000088') returning id`;
    await owner`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source)
      values (${tenantId}, ${w?.id}, 'gym', now() - interval '40 days', now() - interval '7 days 1 minute', 'override')`;

    // A TaifaPay payment that matches no plan: the payer is reassured at once, even at night.
    await recordPayment(app, tenantId, {
      provider: 'taifapay',
      providerTxnId: 'TP-ODD-1',
      amountKes: 777,
      accountRef: '21001',
      phone: '0711000099',
      paidAt: new Date(),
    });
    expect(await queueWinbacks(app)).toBe(1);
    expect(await queueWinbacks(app)).toBe(0); // once
    const pv = await previewAnnouncement(app, tenantId, {
      audience: 'all',
      text: ' Pool closed  Saturday for cleaning. ',
    });
    expect(pv.body).toBe('Demo Club: Pool closed Saturday for cleaning.');
    expect(pv.recipients).toBeGreaterThanOrEqual(2);
    expect(pv.costKes).toBe(pv.recipients * 1.5);
    expect(
      await queueAnnouncement(app, tenantId, {
        audience: 'all',
        text: 'Pool closed Saturday for cleaning.',
        actor: 'test',
      }),
    ).toMatchObject({ ok: true });

    await dispatchSms(app, client, () => {}, undefined, night);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ mobile: '254711000099' });
    expect(sent[0]?.message).toMatch(/No need to pay again/);
    const [waiting] = await owner`select error from sms_messages where kind = 'winback' and member_id = ${w?.id}`;
    expect(waiting).toEqual({ error: 'waiting for quiet hours to end' });

    // Morning: Wanjiku gets one message today (the "we miss you"); the news waits for tomorrow.
    await dispatchSms(app, client, () => {}, undefined, day);
    expect(to('254711000088')).toHaveLength(1);
    expect(to('254711000088')[0]?.message).toMatch(/^We miss you at Demo Club, Wanjiku\./);
    expect(to('254700000001').filter((x) => /Pool closed/.test(x.message))).toHaveLength(1);
    const n = sent.length;
    expect(await dispatchSms(app, client, () => {}, undefined, day)).toBe(0);
    expect(sent).toHaveLength(n);
    const [held] =
      await owner`select status, error from sms_messages where kind = 'announcement' and member_id = ${w?.id}`;
    expect(held).toEqual({ status: 'queued', error: 'waiting: one message per member per day' });
    await owner`update members set sms_news = false where id = ${w?.id}`;
    expect((await previewAnnouncement(app, tenantId, { audience: 'all', text: 'x' })).recipients).toBe(
      pv.recipients - 1,
    );

    // Staff alerts: tamper once per member per day; door PC offline once, cancelled if it returns before sending.
    await withTenant(app, tenantId, async (tx) => {
      await queueTamperAlert(tx, tenantId, 21088);
      await queueTamperAlert(tx, tenantId, 21088);
    });
    expect(
      (await owner`select count(*)::int as n from sms_messages where dedupe_key like 'tamper:21088:%'`)[0]?.n,
    ).toBe(1);
    await owner`update bridges set last_seen_at = now() where last_seen_at is not null`;
    expect(await watchBridges(app)).toBe(0);
    const [br] = await owner`select id from bridges where tenant_id = ${tenantId} order by created_at limit 1`;
    await owner`update bridges set last_seen_at = now() - interval '20 minutes' where id = ${br?.id}`;
    expect(await watchBridges(app)).toBe(1);
    expect(await watchBridges(app)).toBe(0);
    await owner`update bridges set last_seen_at = now() where id = ${br?.id}`;
    expect(await watchBridges(app)).toBe(0); // back before the alert went out: both are dropped
    await owner`update bridges set last_seen_at = now() - interval '2 hours' where id = ${br?.id}`;
    expect(await watchBridges(app)).toBe(1);
    await dispatchSms(app, client, () => {}, undefined, day);
    expect(to('254726049097').some((x) => /lost contact with the Main door PC/.test(x.message))).toBe(true);
    expect(to('254726049097').some((x) => /changed Wanjiku Kamau \(21088\) directly in AxTraxNG/.test(x.message))).toBe(
      true,
    );

    // NAVAC: Source Code credit (250, reported by the last send) is below 1,000, and a door PC is down for 2 h.
    await owner`insert into platform_settings (key, data) values ('sms', '{"sender":"NAVAC","alertPhone":"0722000001","lowCredit":1000}')
      on conflict (key) do update set data = platform_settings.data || excluded.data`;
    expect(await platformAlerts(app, client, day)).toBe(2);
    expect(await platformAlerts(app, client, day)).toBe(0); // once a day
    expect(to('254722000001').map((x) => x.message.slice(0, 40))).toEqual([
      'Lango: Source Code SMS credit is 250, be',
      'Lango: 1 club door PC offline over 1 h: ',
    ]);
    await owner`update bridges set last_seen_at = now() where id = ${br?.id}`;
    expect(await watchBridges(app)).toBe(1); // back online
    await owner`update tenant_settings set data = jsonb_set(data, '{notifications,dailySummary}', 'true') where tenant_id = ${tenantId}`;
    expect(await queueDailySummaries(app, day)).toBe(0); // only at 19:00
    expect(await queueDailySummaries(app, day.set({ hour: 19 }))).toBe(1);
    expect(await queueDailySummaries(app, day.set({ hour: 19, minute: 30 }))).toBe(0);
    await dispatchSms(app, client, () => {}, undefined, day);
    expect(to('254726049097').some((x) => /back online/.test(x.message))).toBe(true);
    expect(to('254726049097').some((x) => /^Demo Club today: KES/.test(x.message))).toBe(true);
    for (const m of sent) expect([m.message, smsUnits(m.message)]).toEqual([m.message, 1]); // every message fits one SMS

    // Portal sign-in by phone number: code sent at once, one per minute, single use, wrong codes refused.
    expect(await requestOtp(app, '0711 000 088', client)).toBe('sent');
    const code = sent.at(-1)?.message.match(/\b(\d{6})\b/)?.[1] as string;
    expect(sent.at(-1)?.mobile).toBe('254711000088');
    expect(await requestOtp(app, '+254711000088', client)).toBe('wait');
    expect(await verifyOtp(app, '254711000088', code === '000000' ? '111111' : '000000')).toEqual([]);
    expect(await verifyOtp(app, '0711000088', code)).toEqual([
      { tenantId, club: 'Demo Club', memberId: w?.id, memberNo: 21088 },
    ]);
    expect(await verifyOtp(app, '0711000088', code)).toEqual([]);
    expect(await requestOtp(app, '0799 999 999', client)).toBe('unknown');
  });
  it('accounts: invitation, password reset, sessions and sign-in codes, with email through Resend', async () => {
    const mails: { to: string[]; subject: string; html: string; key: string | null }[] = [];
    const resendFetch = (async (_u: string, i: RequestInit) => {
      const b = JSON.parse(String(i.body));
      mails.push({ to: b.to, subject: b.subject, html: b.html, key: new Headers(i.headers).get('Idempotency-Key') });
      return new Response(JSON.stringify({ id: `em_${mails.length}` }));
    }) as typeof fetch;
    const noPwned = (async () => new Response('')) as typeof fetch;
    const resend = new Resend('re_test', resendFetch);
    // Every Resend call in this test goes to the fake (invitations and resets build their own client).
    vi.stubGlobal('fetch', resendFetch);
    vi.stubEnv('APP_ENCRYPTION_KEY', 'test-only-key-0123456789abcdef0123456789');
    await owner`insert into platform_settings (key, data) values ('email', ${owner.json({ apiKey: encrypt('re_test'), from: 'Lango <lango@navac.co.ke>' } as never)})
      on conflict (key) do update set data = excluded.data`;
    // A plain send is logged, and the same idempotency key never sends twice.
    expect(
      await sendEmail(
        app,
        { to: 'a@x.test', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', kind: 'test', key: 'k1' },
        resend,
      ),
    ).toBe(true);
    expect(
      await sendEmail(
        app,
        { to: 'a@x.test', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', kind: 'test', key: 'k1' },
        resend,
      ),
    ).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.key).toBe('k1');

    // Signed delivery events update the log; a forged signature is refused.
    const secret = `whsec_${Buffer.from('lango-test-secret').toString('base64')}`;
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1' } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', Buffer.from('lango-test-secret')).update(`msg_1.${ts}.${body}`).digest('base64');
    expect(verifySvix(secret, { id: 'msg_1', timestamp: ts, signature: `v1,${sig}` }, body)).toBe(true);
    expect(verifySvix(secret, { id: 'msg_1', timestamp: ts, signature: 'v1,AAAA' }, body)).toBe(false);
    expect(verifySvix(secret, { id: 'msg_1', timestamp: String(Number(ts) - 900), signature: `v1,${sig}` }, body)).toBe(
      false,
    );
    expect(await applyResendEvent(app, JSON.parse(body))).toBe(true);
    expect((await owner`select status from email_messages where provider_id = 'em_1'`)[0]).toEqual({
      status: 'delivered',
    });

    // Invitation: the account starts switched off; the emailed link sets the password once.
    const [pa] = await owner`select id from staff_users where email = 'sms-admin@navac.test'`;
    const inv = await inviteStaff(
      app,
      {
        inviterId: pa?.id,
        email: 'desk@demo.test',
        name: 'Akinyi Desk',
        role: 'reception',
        tenantId,
        baseUrl: 'https://lango.test',
        ctx: { inviterName: 'SMS Admin', to: 'Demo Club', roleLabel: 'Front desk' },
      },
      null,
    );
    expect(inv.emailed).toBe(true);
    const link = mails.at(-1)?.html.match(/https:\/\/lango\.test\/invite\/([A-Za-z0-9_-]+)/)?.[1] as string;
    expect(link).toBeTruthy();
    expect((await staffByEmail(app, 'desk@demo.test'))?.active).toBe(false);
    expect((await checkLink(app, 'invite', link)).ok).toBe(true);
    expect(await acceptInvite(app, link, { password: 'password123' }, noPwned)).toMatchObject({
      ok: false,
      reason: 'password',
    });
    expect(await acceptInvite(app, link, { password: 'blue gate at dawn 7' }, noPwned)).toMatchObject({ ok: true });
    expect(await acceptInvite(app, link, { password: 'blue gate at dawn 7' }, noPwned)).toMatchObject({
      ok: false,
      reason: 'used',
    });
    const desk = await staffByEmail(app, 'desk@demo.test');
    expect(desk).toMatchObject({ active: true, role: 'club', tenant_id: tenantId });
    // Only NAVAC adds partner logins; a club cannot invite into another club.
    await expect(
      inviteStaff(
        app,
        {
          inviterId: desk?.id as string,
          email: 'x@y.test',
          name: 'X',
          role: 'manager',
          tenantId: otherTenant,
          baseUrl: 'https://lango.test',
          ctx: { inviterName: 'X', to: 'Other', roleLabel: 'Manager' },
        },
        null,
      ),
    ).rejects.toThrow();

    // Sessions live on the server: revoking ends them at once.
    const s1 = await createSession(app, { staff: desk as NonNullable<typeof desk> });
    expect(await readSession(app, s1.token)).toMatchObject({ uid: desk?.id, tid: tenantId, role: 'reception' });
    expect(await readSession(app, 'not-a-real-session-token-xxxxxxxx')).toBeNull();

    // Password reset: same outcome for unknown emails; the link works once; old sessions end.
    const before = mails.length;
    await requestPasswordReset(app, 'nobody@nowhere.test', 'https://lango.test');
    expect(mails).toHaveLength(before);
    await requestPasswordReset(app, 'desk@demo.test', 'https://lango.test');
    const reset = mails.at(-1)?.html.match(/https:\/\/lango\.test\/reset\/([A-Za-z0-9_-]+)/)?.[1] as string;
    expect(await resetPassword(app, reset, 'a new phrase for the gate', noPwned)).toMatchObject({ ok: true });
    expect(await resetPassword(app, reset, 'another phrase entirely', noPwned)).toMatchObject({
      ok: false,
      reason: 'used',
    });
    expect(await readSession(app, s1.token)).toBeNull();
    expect(mails.at(-1)?.subject).toBe('Your Lango password was changed');

    // Sign-in code by email (no phone): wrong code refused, right code accepted once.
    const ch = await startSignInCode(app, desk as NonNullable<typeof desk>, 'sms', null);
    expect(ch).toMatchObject({ channel: 'email' });
    // Resend policy: the next code only after a pause, and asking again straight away reuses the live code.
    const wait = await codeResendAt(app, desk?.id as string);
    expect(wait.capped).toBe(false);
    expect(wait.at).toBeGreaterThan(Date.now() + 50_000);
    expect(await startSignInCode(app, desk as NonNullable<typeof desk>, 'sms', null)).toMatchObject({
      id: (ch as { id: string }).id,
    });
    const code = mails.at(-1)?.subject.match(/(\d{6})/)?.[1] as string;
    const id = (ch as { id: string }).id;
    expect(await verifySignInCode(app, id, desk?.id as string, code === '000000' ? '111111' : '000000')).toBe(false);
    expect(await verifySignInCode(app, id, desk?.id as string, code)).toBe(true);
    expect(await verifySignInCode(app, id, desk?.id as string, code)).toBe(false);
    expect(await revokeAllSessions(app, desk?.id as string, 'test')).toBe(0);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('user management: roles and permissions, per-person changes, removal, several clubs, ownership, partner teams', async () => {
    const mails: { to: string[]; subject: string; html: string }[] = [];
    const fake = (async (u: string, i: RequestInit) => {
      if (String(u).includes('pwnedpasswords')) return new Response('');
      const b = JSON.parse(String(i.body));
      mails.push({ to: b.to, subject: b.subject, html: b.html });
      return new Response(JSON.stringify({ id: `em_um_${mails.length}` }));
    }) as typeof fetch;
    vi.stubGlobal('fetch', fake);
    vi.stubEnv('APP_ENCRYPTION_KEY', 'test-only-key-0123456789abcdef0123456789');
    await owner`insert into platform_settings (key, data) values ('email', ${owner.json({ apiKey: encrypt('re_test'), from: 'Lango <lango@navac.co.ke>' } as never)})
      on conflict (key) do update set data = excluded.data`;
    const perms = async (staff: string, tenant: string) =>
      (await app<{ role: string; perms: string[] }[]>`select * from app_staff_perms(${staff}, ${tenant})`)[0] ?? null;
    const lastLink = (kind: string) =>
      mails.at(-1)?.html.match(new RegExp(`https://lango\\.test/${kind}/([A-Za-z0-9_-]+)`))?.[1] as string;
    /** Invite and accept in one go; returns the new person's id. */
    const join = async (inviterId: string, email: string, role: string, tenant: string | null, partnerId?: string) => {
      const r = await inviteStaff(
        app,
        {
          inviterId,
          email,
          name: email.split('@')[0] as string,
          role,
          tenantId: tenant,
          partnerId: partnerId ?? null,
          baseUrl: 'https://lango.test',
          ctx: { inviterName: 'Test', to: 'Test', roleLabel: role },
        },
        null,
      );
      if (!r.added)
        expect((await acceptInvite(app, lastLink('invite'), { password: 'a long test phrase 42' })).ok).toBe(true);
      return r.staffId;
    };

    // NAVAC sets up each club's owner (a club has exactly one).
    const [pa] = await owner`select id from staff_users where email = 'sms-admin@navac.test'`;
    const ownerId = await join(pa?.id, 'owner@um.test', 'owner', tenantId);
    const otherOwnerId = await join(pa?.id, 'owner2@um.test', 'owner', otherTenant);
    await expect(join(pa?.id, 'owner3@um.test', 'owner', tenantId)).rejects.toThrow(/already has an owner/);
    expect(await perms(ownerId, tenantId)).toMatchObject({
      role: 'owner',
      perms: expect.arrayContaining(['club.own']),
    });

    // The owner invites a manager and an admin; a manager cannot invite anyone; an admin cannot add admins.
    const mgr = await join(ownerId, 'mgr@um.test', 'manager', tenantId);
    // Door setup is the installer's alone: a club owner can't hand it to their staff.
    await expect(
      app`select app_set_member_perms(${ownerId}, ${tenantId}, ${mgr}, ${['doors.setup']}, ${[]})`,
    ).rejects.toThrow(/unknown permission/);
    const adm = await join(ownerId, 'adm@um.test', 'admin', tenantId);
    expect((await perms(mgr, tenantId))?.perms).not.toContain('team.manage');
    expect((await perms(adm, tenantId))?.perms).toEqual(expect.arrayContaining(['team.manage', 'billing.manage']));
    expect((await perms(adm, tenantId))?.perms).not.toContain('club.own');
    await expect(join(mgr, 'nope@um.test', 'viewer', tenantId)).rejects.toThrow(/not allowed/);
    await expect(join(adm, 'adm2@um.test', 'admin', tenantId)).rejects.toThrow(/only the owner/);
    const viewer = await join(adm, 'view@um.test', 'viewer', tenantId);
    expect((await perms(viewer, tenantId))?.perms).toEqual(['members.view', 'reports.all']);

    // A role change applies on the next request of an open session.
    const mgrStaff = await staffByEmail(app, 'mgr@um.test');
    const sm = await createSession(app, { staff: mgrStaff as NonNullable<typeof mgrStaff> });
    expect(await readSession(app, sm.token)).toMatchObject({ role: 'manager', tid: tenantId });
    const who = { actorId: adm, actorName: 'Adm', tenantId };
    await changeRole(app, who, mgr, 'reception');
    expect(await readSession(app, sm.token)).toMatchObject({ role: 'reception' });
    expect(mails.at(-1)?.subject).toMatch(/Your role at .* changed/);
    // Nobody changes the owner; an admin cannot touch another admin or hand out team rights.
    await expect(changeRole(app, who, ownerId, 'viewer')).rejects.toThrow(/owner/);
    await expect(changeRole(app, { ...who, actorId: mgr }, viewer, 'manager')).rejects.toThrow(/team/);
    await expect(setPermissions(app, who, mgr, ['team.manage'], [])).rejects.toThrow(/team/);

    // Per-person fine-tuning: a front-desk lead may give complimentary access but not edit members.
    await setPermissions(app, who, mgr, ['access.comp'], ['members.edit']);
    const tuned = (await readSession(app, sm.token))?.perms ?? [];
    expect(tuned).toContain('access.comp');
    expect(tuned).not.toContain('members.edit');
    await expect(setPermissions(app, who, mgr, ['club.own'], [])).rejects.toThrow(/unknown permission/);

    // Pausing a login signs them out at once and blocks the club until restored; their role is kept.
    await suspendMember(app, who, mgr, true);
    expect(await readSession(app, sm.token)).toBeNull();
    expect(await perms(mgr, tenantId)).toBeNull();
    await expect(suspendMember(app, { ...who, actorId: mgr }, viewer, true)).rejects.toThrow(/not allowed/);
    await expect(suspendMember(app, who, ownerId, true)).rejects.toThrow(/owner/);
    await suspendMember(app, who, mgr, false);
    expect((await perms(mgr, tenantId))?.role).toBe('reception');

    // The owner tunes a role for this club: front desk may also assign unmatched payments, and may not edit members.
    const ownerWho = { actorId: ownerId, actorName: 'Owner', tenantId };
    await expect(setRolePerm(app, who, 'reception', 'payments.assign', true)).rejects.toThrow(/only the owner/);
    await setRolePerm(app, ownerWho, 'reception', 'payments.assign', true);
    await setRolePerm(app, ownerWho, 'reception', 'members.view', false);
    expect((await perms(mgr, tenantId))?.perms).toContain('payments.assign');
    expect((await perms(mgr, tenantId))?.perms).not.toContain('members.view');
    expect(await perms(mgr, otherTenant)).toBeNull();
    await expect(setRolePerm(app, ownerWho, 'reception', 'club.own', true)).rejects.toThrow(/unknown permission/);
    // NAVAC support acts as viewer: a club tuning the viewer role never changes what NAVAC can see.
    const [nav] = await owner`select id from staff_users where email = 'sms-admin@navac.test'`;
    const navBefore = (await perms(nav?.id, tenantId))?.perms ?? [];
    await setRolePerm(app, ownerWho, 'viewer', 'members.view', false);
    await setRolePerm(app, ownerWho, 'viewer', 'payments.assign', true);
    expect((await perms(nav?.id, tenantId))?.perms ?? []).toEqual(navBefore);
    await resetRolePerms(app, ownerWho, 'viewer');
    await resetRolePerms(app, ownerWho, 'reception');
    expect((await perms(mgr, tenantId))?.perms).not.toContain('payments.assign');

    // Removal: signed out of the club at once; history stays; they can no longer work anywhere.
    await removeMember(app, who, mgr);
    expect(await readSession(app, sm.token)).toBeNull();
    expect(await myClubs(app, mgr)).toHaveLength(0);
    expect((await clubTeam(app, tenantId)).map((t) => t.id)).not.toContain(mgr);

    // One login, one club: an email already in a club cannot be invited into another.
    await expect(
      inviteStaff(
        app,
        {
          inviterId: otherOwnerId,
          email: 'adm@um.test',
          name: 'Adm',
          role: 'manager',
          tenantId: otherTenant,
          baseUrl: 'https://lango.test',
          ctx: { inviterName: 'Other', to: 'Other Club', roleLabel: 'Manager' },
        },
        null,
      ),
    ).rejects.toThrow(/another club/);
    expect((await myClubs(app, adm)).map((c) => c.role)).toEqual(['admin']);
    // Five seats including the owner: four more fit.
    for (let i = 0; i < 4; i++) await join(otherOwnerId, `seat${i}@um.test`, 'reception', otherTenant);
    await expect(join(otherOwnerId, 'seat5@um.test', 'reception', otherTenant)).rejects.toThrow(/team limit/);

    // Ownership: offered by the owner to an admin, confirmed by the admin; the old owner stays as admin.
    expect(
      (await offerOwnership(app, { actorId: adm, actorName: 'Adm', tenantId }, viewer, 'https://lango.test')).ok,
    ).toBe(false);
    const offer = await offerOwnership(
      app,
      { actorId: ownerId, actorName: 'Owner', tenantId },
      adm,
      'https://lango.test',
    );
    expect(offer.ok).toBe(true);
    const tt = lastLink('transfer');
    expect(await acceptOwnership(app, tt, viewer)).toBe(false);
    expect(await acceptOwnership(app, tt, adm)).toBe(true);
    expect(await acceptOwnership(app, tt, adm)).toBe(false);
    expect((await perms(adm, tenantId))?.role).toBe('owner');
    expect((await perms(ownerId, tenantId))?.role).toBe('admin');

    // Partner teams: a technician sees only the clubs assigned to them and works there with door rights only.
    const [trisol] = await app<{ id: string }[]>`select app_platform_partner_id(${pa?.id}, 'Trisol UM') as id`;
    await owner`update tenants set partner_id = ${trisol?.id} where id = ${tenantId}`;
    const tech = await join(pa?.id, 'tech@um.test', 'partner_tech', null, trisol?.id);
    expect(await app`select * from app_partner_clubs(${tech})`).toHaveLength(0);
    expect(await perms(tech, tenantId)).toBeNull();
    await assignClubs(app, pa?.id, tech, [tenantId, otherTenant]);
    expect((await app`select id from app_partner_clubs(${tech})`).map((r) => r.id)).toEqual([tenantId]);
    expect(await perms(tech, tenantId)).toMatchObject({ role: 'technician' });
    expect((await perms(tech, tenantId))?.perms).not.toContain('payments.record');
    // Door setup (pairing, re-reading AxTraxNG, linking doors) is the installer's: the technician and partner/NAVAC
    // admins have it; the club owner sees the doors but cannot set them up, nor give setup to their staff.
    expect((await perms(tech, tenantId))?.perms).toContain('doors.setup');
    expect((await perms(pa?.id, tenantId))?.perms).toContain('doors.setup');
    expect((await perms(ownerId, tenantId))?.perms).toContain('doors.manage');
    expect((await perms(ownerId, tenantId))?.perms).not.toContain('doors.setup');
    // NAVAC support sees every club, read-only.
    const sup = await join(pa?.id, 'support@um.test', 'navac_support', null);
    expect((await perms(sup, otherTenant))?.role).toBe('viewer');
    await expect(join(tech, 'x2@um.test', 'partner_tech', null, trisol?.id)).rejects.toThrow(/not allowed/);

    // Repeated failed sign-ins: the account holder is told once.
    const before = mails.length;
    for (let i = 0; i < 6; i++) await noteFailedSignIn(app, 'view@um.test', '10.0.0.1');
    expect(mails.slice(before).map((m) => m.subject)).toEqual(['Failed sign-ins on your Lango account']);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('partner shares: setup fee and subscriptions earn the partner its agreed share once; only NAVAC and that partner see it', async () => {
    const [pa] = await owner`select id from staff_users where email = 'sms-admin@navac.test'`;
    const [t] = await owner`select partner_id from tenants where id = ${tenantId}`;
    const partner = t?.partner_id as string;
    expect(partner).toBeTruthy();
    const [boss] = await owner`insert into staff_users (email, name, role, password_hash, partner_id)
      values ('boss@um.test', 'Boss', 'partner_admin', 'x', ${partner}) returning id`;
    const [tech] = await owner`select id from staff_users where email = 'tech@um.test'`;
    // Only NAVAC sets a partner's terms and a club's setup fee.
    await expect(
      app`select app_platform_set_terms(${boss?.id}, ${partner}, 30, 20, ${null}, 14, 5, 'mpesa', '0712345678', 'a1')`,
    ).rejects.toThrow(/platform/);
    await app`select app_platform_set_terms(${pa?.id}, ${partner}, 30, 20, ${null}, 14, 5, 'mpesa', '0712345678', 'a1')`;
    await app`select app_platform_set_plan(${pa?.id}, ${tenantId}, 'Lango Club', 4500, 'monthly', ${null}, '', '', 50000)`;
    expect(await clubPlan(app, tenantId)).toMatchObject({ setup_fee_kes: 50000, setup_paid: false });
    // The owner pays the setup fee and a month; the gateway confirms both.
    const fakeFetch = (async (u: string) =>
      new Response(
        JSON.stringify(
          String(u).endsWith('/auth/token')
            ? { access_token: 't', expires_in: '3599' }
            : String(u).includes('TP-SET-1')
              ? { transaction: { id: 'TP-SET-1', status: 'COMPLETED', amount: 50000 } }
              : { transaction: { id: 'TP-SUB-9', status: 'COMPLETED', amount: 4500 } },
        ),
      )) as typeof fetch;
    const client = new TaifaPay({ env: 'live', clientId: 'navac', clientSecret: 's' }, fakeFetch);
    await owner`insert into subscription_invoices (tenant_id, kind, plan_name, cycles, amount_kes, phone, created_by, provider_ref, created_at)
      values (${tenantId}, 'setup', 'Lango setup', 1, 50000, '254726049097', 'test', 'TP-SET-1', now() - interval '2 minutes')`;
    await owner`insert into subscription_invoices (tenant_id, kind, plan_name, cycles, amount_kes, phone, created_by, provider_ref, created_at)
      values (${tenantId}, 'subscription', 'Lango Club', 1, 4500, '254726049097', 'test', 'TP-SUB-9', now() - interval '2 minutes')`;
    expect(await reconcileSubscriptions(app, () => {}, client)).toBe(2);
    expect(await reconcileSubscriptions(app, () => {}, client)).toBe(0);
    const mine = await app`select kind, amount_kes, base_kes from app_partner_earnings(${boss?.id}) order by kind`;
    expect(mine).toEqual([
      { kind: 'setup', amount_kes: 15000, base_kes: 50000 },
      { kind: 'subscription', amount_kes: 900, base_kes: 4500 },
    ]);
    expect((await clubPlan(app, tenantId))?.setup_paid).toBe(true);
    expect(
      await startSubscriptionPayment(app, tenantId, { cycles: 1, phone: '0726049097', actor: 't', kind: 'setup' }),
    ).toEqual({ ok: false, reason: 'paid' });
    // Technicians see no money; the app cannot read NAVAC's books directly; NAVAC-only figures stay NAVAC's.
    expect(await app`select * from app_partner_earnings(${tech?.id})`).toHaveLength(0);
    expect(await app`select * from app_partner_club_billing(${tech?.id})`).toHaveLength(0);
    await expect(app`select * from partner_earnings`).rejects.toThrow(/permission/);
    await expect(
      app`select * from app_platform_revenue(${boss?.id}, now() - interval '1 day', now() + interval '1 minute')`,
    ).rejects.toThrow(/platform/);
    const [rev] =
      await app`select * from app_platform_revenue(${pa?.id}, now() - interval '1 day', now() + interval '1 minute')`;
    expect([Number(rev?.setup_kes), Number(rev?.shares_kes)]).toEqual([50000, 15900]);
    expect((await app`select * from app_partner_terms(${boss?.id})`).map((r) => r.partner_id)).toEqual([partner]);
  });
  it('services: equal prices are fine, a paybill renews what the member usually buys, the rest is held', async () => {
    const [gym] = await owner`select id, service_id from products where name = 'Gym · 1 month'`;
    const [sv] =
      await owner`insert into services (tenant_id, name, zone_keys) values (${tenantId}, 'Steam', '{sauna}') returning id`;
    const [steam] =
      await owner`insert into products (tenant_id, service_id, name, price_kes, duration_unit, duration_count, zone_keys)
      values (${tenantId}, ${sv?.id}, 'Steam · 1 month', 5000, 'month', 1, '{sauna}') returning id`;
    // Jane has bought the gym month before: KES 5000 on paybill renews the gym, not the new steam room.
    const usual = await recordPayment(app, tenantId, {
      provider: 'test',
      providerTxnId: 'SVC-1',
      amountKes: 5000,
      accountRef: '21001',
      paidAt: new Date(),
    });
    expect(usual).toMatchObject({ status: 'applied', product: 'Gym · 1 month' });
    // Someone new paying KES 5000 could mean either: held for staff, never guessed.
    await owner`insert into members (tenant_id, member_no, first_name, last_name) values (${tenantId}, 28461, 'New', 'Person')`;
    const held = await recordPayment(app, tenantId, {
      provider: 'test',
      providerTxnId: 'SVC-2',
      amountKes: 5000,
      accountRef: '28461',
      paidAt: new Date(),
    });
    expect(held.status).toBe('unmatched');
    // One payment for two services: both lines are kept with their own dates.
    const two = await recordPayment(app, tenantId, {
      provider: 'test',
      providerTxnId: 'SVC-3',
      amountKes: 5600,
      accountRef: '28461',
      lines: [
        { productId: steam?.id as string, priceKes: 5000 },
        { productId: (await owner`select id from products where price_kes = 600`)[0]?.id as string, priceKes: 600 },
      ],
      paidAt: new Date(),
    });
    expect(two.status).toBe('applied');
    const lines =
      await owner`select label from payment_lines where payment_id = ${(two as { paymentId: string }).paymentId} order by created_at`;
    expect(lines.length).toBe(2);
    expect(gym?.id).toBeTruthy();
  });

  it('paybill never sells a service that is off sale, walk-in only or new to the member; a late walk-in payment is held', async () => {
    const pay = (ref: string, tx: string, extra: Record<string, unknown> = {}) =>
      recordPayment(app, tenantId, {
        provider: 'test',
        providerTxnId: tx,
        amountKes: 4321,
        accountRef: ref,
        paidAt: new Date(),
        ...extra,
      });
    const [sv] =
      await owner`insert into services (tenant_id, name, zone_keys, active) values (${tenantId}, 'Lockers', '{sauna}', false) returning id`;
    const [pr] =
      await owner`insert into products (tenant_id, service_id, name, price_kes, duration_unit, duration_count, zone_keys)
      values (${tenantId}, ${sv?.id}, 'Lockers · 1 month', 4321, 'month', 1, '{sauna}') returning id`;
    await owner`insert into members (tenant_id, member_no, first_name, last_name) values (${tenantId}, 28911, 'Off', 'Sale')`;
    // The service is switched off (its price still on): not sold.
    expect((await pay('28911', 'GATE-1')).status).toBe('unmatched');
    // On sale, but walk-ins only: not sold to a member.
    await owner`update services set active = true, sold_to = 'walkins' where id = ${sv?.id}`;
    expect((await pay('28911', 'GATE-2')).status).toBe('unmatched');
    // Sold to everyone: a new member paying that exact amount gets it.
    await owner`update services set sold_to = 'both' where id = ${sv?.id}`;
    expect(await pay('28911', 'GATE-3')).toMatchObject({ status: 'applied', product: 'Lockers · 1 month' });
    // Someone who paid 4,321 for the gym before (its price has changed since) is not moved onto lockers by it.
    const [gymPrice] = await owner`select id from products where name = 'Gym · 1 month'`;
    await owner`insert into members (tenant_id, member_no, first_name, last_name) values (${tenantId}, 28912, 'Old', 'Price')`;
    await pay('28912', 'GATE-4a', { lines: [{ productId: gymPrice?.id as string, priceKes: 4321 }] });
    expect((await pay('28912', 'GATE-4')).status).toBe('unmatched');

    // A walk-in prompt paid after the visit was cancelled: the band stays shut, the money is held.
    const [band] =
      await owner`insert into members (tenant_id, member_no, first_name, last_name) values (${tenantId}, 11911, 'Wristband', '11') returning id`;
    const [it] =
      await owner`insert into payment_intents (tenant_id, member_id, product_id, amount_kes, phone, provider, created_by, status)
      values (${tenantId}, ${band?.id}, ${pr?.id}, 4321, '254700000000', 'taifapay', 'test', 'expired') returning id`;
    const lines = [{ productId: pr?.id as string, priceKes: 4321 }];
    await owner`insert into day_passes (tenant_id, band_id, visitor_name, lines, total_kes, channel, status, intent_id, created_by)
      values (${tenantId}, ${band?.id}, 'Late Payer', ${owner.json(lines as never)}, 4321, 'mpesa', 'cancelled', ${it?.id}, 'test')`;
    const late = await pay('11911', 'GATE-5', { intentId: it?.id, lines });
    expect(late.status).toBe('unmatched');
    const [open] = await owner`select count(*)::int as n from entitlements where member_id = ${band?.id}`;
    expect(open?.n).toBe(0);
  });

  it('walk-in wristbands start fresh for every visitor (never pushed to tomorrow)', async () => {
    const [band] =
      await owner`insert into members (tenant_id, member_no, first_name, last_name) values (${tenantId}, 11901, 'Wristband', '01') returning id`;
    const [pass] = await owner`select id from products where price_kes = 600`;
    for (const tx of ['BAND-1', 'BAND-2'])
      await recordPayment(app, tenantId, {
        provider: 'test',
        providerTxnId: tx,
        amountKes: 600,
        accountRef: '11901',
        productId: pass?.id as string,
        paidAt: new Date(),
      });
    const starts = await owner`select distinct starts_at::date as d from entitlements where member_id = ${band?.id}`;
    expect(starts.length).toBe(1);
  });
  it('a short service ends on the minute: the bridge switches the door group without waiting for the guard', async () => {
    const [m] =
      await owner`insert into members (tenant_id, member_no, first_name, last_name) values (${tenantId}, 28777, 'Short', 'Sauna') returning id`;
    await owner`insert into credentials (tenant_id, member_id, card_code) values (${tenantId}, ${m?.id}, 28777)`;
    const tz = 'Africa/Nairobi';
    const start = DateTime.now().setZone(tz).minus({ hours: 1 });
    const end = DateTime.now().setZone(tz).plus({ minutes: 1 });
    await owner`insert into entitlements (tenant_id, member_id, zone_key, starts_at, ends_at, source) values
      (${tenantId}, ${m?.id}, 'sauna', ${start.toJSDate()}, ${end.toJSDate()}, 'override'),
      (${tenantId}, ${m?.id}, 'gym', ${start.toJSDate()}, ${start.plus({ days: 30 }).toJSDate()}, 'override')`;
    await withTenant(app, tenantId, (tx) => rebuildAccessState(tx, tenantId, m?.id as string));
    await bridge.cycle(0);
    expect(fake.swipe(28777, 0, 12, today())).toBe(true);
    await bridge.switchDue(); // marks "now" as checked
    const later = DateTime.now().setZone(tz).plus({ minutes: 2 });
    const realNow = bridge.now.bind(bridge);
    bridge.now = () => later;
    expect(bridge.secondsToNextSwitch()).not.toBe(0);
    expect(await bridge.switchDue()).toBeGreaterThanOrEqual(1);
    bridge.now = realNow;
    const at = later.toFormat("yyyy-MM-dd'T'HH:mm:ss");
    expect(fake.swipe(28777, 0, 12, at)).toBe(false);
    expect(fake.swipe(28777, 0, 11, at)).toBe(true);
  });
});

describe('communications', () => {
  const key = 'test-only-key-0123456789abcdef0123456789';
  const meta = (id: string, body: string, from = '254700000001', at = Math.floor(Date.now() / 1000)) => ({
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: from, profile: { name: 'Jane W' } }],
              messages: [{ from, id, timestamp: String(at), type: 'text', text: { body } }],
            },
          },
        ],
      },
    ],
  });

  it('WhatsApp: a signed message opens one conversation linked to the member; replies only within 24 hours', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', key);
    const raw = JSON.stringify(meta('wamid.1', 'Is the pool open on Saturday?'));
    const sig = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;
    expect(verifyMeta('app-secret', raw, sig)).toBe(true);
    expect(verifyMeta('app-secret', raw, 'sha256=00')).toBe(false);
    expect(verifyMeta('other-secret', raw, sig)).toBe(false);
    await owner`insert into comm_channels (tenant_id, channel, enabled, config, secret, routing_token, verify_token)
      values (${tenantId}, 'whatsapp', true, ${owner.json({ phoneNumberId: '555' } as never)},
              ${encrypt(JSON.stringify({ accessToken: 'tok', appSecret: 'app-secret' }))}, 'route-token-0123456789abcdef', 'v')`;
    // Meta may deliver the same message twice: it is stored once.
    expect(await receiveWhatsApp(app, tenantId, parseMeta(JSON.parse(raw)))).toBe(1);
    expect(await receiveWhatsApp(app, tenantId, parseMeta(JSON.parse(raw)))).toBe(0);
    const [c] = await withTenant(
      app,
      tenantId,
      (tx) => tx<{ id: string; member_id: string | null; unread: number }[]>`
      select c.id, c.member_id, c.unread from conversations c where address = '254700000001'`,
    );
    const [jane] = await owner<
      { id: string }[]
    >`select id from members where member_no = 21001 and tenant_id = ${tenantId}`;
    expect(c?.member_id).toBe(jane?.id);
    expect(c?.unread).toBe(1);
    // Another club never sees it.
    expect(await withTenant(app, otherTenant, (tx) => tx`select 1 from conversations`)).toHaveLength(0);
    // A reply goes to Meta with the club's token, and delivery updates move its ticks forward only.
    const sent: { url: string; body: string; auth: string }[] = [];
    const graph = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: String(init.body), auth: String((init.headers as Record<string, string>).Authorization) });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.out1' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await sendReply(app, tenantId, c?.id as string, { body: 'Yes, 6am to 8pm.', staffName: 'Mary' }, graph);
    expect(sent[0]?.url).toContain('/555/messages');
    expect(sent[0]?.auth).toBe('Bearer tok');
    expect(JSON.parse(sent[0]?.body ?? '{}')).toMatchObject({ to: '254700000001', text: { body: 'Yes, 6am to 8pm.' } });
    await receiveWhatsApp(app, tenantId, {
      messages: [],
      statuses: [{ id: 'wamid.out1', status: 'read', error: null }],
    });
    await receiveWhatsApp(app, tenantId, {
      messages: [],
      statuses: [{ id: 'wamid.out1', status: 'delivered', error: null }],
    });
    const [out] = await withTenant(
      app,
      tenantId,
      (tx) => tx<{ status: string; staff_name: string }[]>`
      select status, staff_name from comm_messages where provider_ref = 'wamid.out1'`,
    );
    expect(out).toEqual({ status: 'read', staff_name: 'Mary' });
    // Past Meta's 24-hour window, free text is refused before anything is sent.
    await withTenant(app, tenantId, (tx) => tx`update conversations set last_in_at = now() - interval '25 hours'`);
    await expect(
      sendReply(app, tenantId, c?.id as string, { body: 'Hello again', staffName: 'Mary' }, graph),
    ).rejects.toThrow(ReplyError);
    expect(sent).toHaveLength(1);
  });

  it('email replies land in the club inbox by club code, without the quoted earlier message', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', key);
    await owner`insert into platform_settings (key, data) values ('email', ${owner.json({
      apiKey: encrypt('re_test'),
      from: 'Lango <lango@navac.co.ke>',
      inboundDomain: 'reply.test',
      inboundKey: encrypt('re_full'),
    } as never)}) on conflict (key) do update set data = excluded.data`;
    await owner`insert into comm_channels (tenant_id, channel, enabled) values (${tenantId}, 'email', true)`;
    const asked: string[] = [];
    const resend = (async (url: string, init: RequestInit) => {
      asked.push(`${url} ${(init.headers as Record<string, string>).Authorization}`);
      return new Response(
        JSON.stringify({ text: 'Thanks, see you Monday.\n\nOn Fri, Demo Club wrote:\n> Your plan ends soon' }),
      );
    }) as unknown as typeof fetch;
    const data = {
      email_id: 'em_1',
      from: 'Kevin O <Kevin@Example.com>',
      to: ['demo-club@reply.test'],
      subject: 'Re: Your plan',
    };
    expect(await receiveEmail(app, data, resend)).toBe(true);
    expect(await receiveEmail(app, data, resend)).toBe(true); // a resent webhook adds nothing
    expect(asked[0]).toBe('https://api.resend.com/emails/receiving/em_1 Bearer re_full');
    const msgs = await withTenant(
      app,
      tenantId,
      (tx) => tx<{ body: string; subject: string; address: string }[]>`
      select m.body, m.subject, c.address from comm_messages m join conversations c on c.id = m.conversation_id
      where c.channel = 'email'`,
    );
    expect(msgs).toEqual([{ body: 'Thanks, see you Monday.', subject: 'Re: Your plan', address: 'kevin@example.com' }]);
    // Unknown club codes and other domains are ignored.
    expect(await receiveEmail(app, { ...data, email_id: 'em_2', to: ['nobody@reply.test'] }, resend)).toBe(false);
    expect(await receiveEmail(app, { ...data, email_id: 'em_3', to: ['demo-club@elsewhere.test'] }, resend)).toBe(
      false,
    );
  });
});
