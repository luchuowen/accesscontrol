import { AxtraxClient, demoSeed, FakeAxtrax, UNAUTHORIZED_GROUP_ID } from '@lango/axtrax';
import type { AccessState } from '@lango/protocol';
import { DateTime } from 'luxon';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { converge } from './converge.js';

const zones = { gym: [11], sauna: [12], pool: [13], spa: [14] };
const tz = 'Africa/Nairobi';
const now = (s: string) => DateTime.fromISO(s, { zone: tz });
const base: AccessState = {
  memberNo: 21001,
  firstName: 'Jane',
  lastName: 'Wanjiru',
  version: 1,
  credentials: [{ siteCode: 0, cardCode: 21001, cardType: 1 }],
  segments: [],
};

let fake: FakeAxtrax;
let ax: AxtraxClient;
beforeEach(async () => {
  fake = new FakeAxtrax(demoSeed());
  ax = new AxtraxClient({ baseUrl: await fake.listen(), username: 'lango', password: 'lango' });
});
afterEach(() => fake.close());

describe('converge', () => {
  it('enrolled but unpaid member is created, locked out', async () => {
    const r = await converge(ax, base, zones, now('2026-10-01T08:00'));
    expect(r.changes).toContain('user created');
    expect(fake.userView(r.axtraxUserId)?.UserAccGrp.ID).toBe(UNAUTHORIZED_GROUP_ID);
    expect(fake.swipe(21001, 0, 11, '2026-10-01T08:05:00')).toBe(false);
  });

  it('payment for gym month opens the gym door only, until 31 Oct 23:59', async () => {
    await converge(ax, base, zones, now('2026-10-01T08:00'));
    const paid = {
      ...base,
      version: 2,
      segments: [{ from: '2026-10-01T00:00:00', until: '2026-10-31T23:59:59', zones: ['gym'] }],
    };
    const r = await converge(ax, paid, zones, now('2026-10-01T08:10'));
    expect(r.changes.some((c) => c.startsWith('stop'))).toBe(true);
    expect(fake.swipe(21001, 0, 11, '2026-10-01T08:15:00')).toBe(true); // gym
    expect(fake.swipe(21001, 0, 12, '2026-10-01T08:16:00')).toBe(false); // sauna
    expect(fake.swipe(21001, 0, 11, '2026-11-01T00:00:01')).toBe(false); // expired, offline-safe
  });

  it('a lost card is switched off while its replacement opens the door', async () => {
    const seg = [{ from: '2026-10-01T00:00:00', until: '2026-10-31T23:59:59', zones: ['gym'] }];
    await converge(ax, { ...base, segments: seg }, zones, now('2026-10-01T08:00'));
    expect(fake.swipe(21001, 0, 11, '2026-10-02T08:00:00')).toBe(true);
    // Reception links card 31001; the old card 21001 is revoked but still sits on the AxTraxNG user.
    const replaced: AccessState = {
      ...base,
      version: 2,
      credentials: [{ siteCode: 0, cardCode: 31001, cardType: 1 }],
      revoked: [{ siteCode: 0, cardCode: 21001, cardType: 1 }],
      segments: seg,
    };
    const r = await converge(ax, replaced, zones, now('2026-10-02T09:00'));
    expect(r.changes).toContain('card 21001 revoked');
    expect(fake.swipe(21001, 0, 11, '2026-10-02T09:05:00')).toBe(false);
    expect(fake.swipe(31001, 0, 11, '2026-10-02T09:05:00')).toBe(true);
    expect((await converge(ax, replaced, zones, now('2026-10-02T09:10'))).changes).toEqual([]);
  });

  it('is idempotent: second apply changes nothing', async () => {
    const paid = {
      ...base,
      segments: [{ from: '2026-10-01T00:00:00', until: '2026-10-31T23:59:59', zones: ['gym', 'sauna'] }],
    };
    await converge(ax, paid, zones, now('2026-10-01T08:00'));
    const again = await converge(ax, paid, zones, now('2026-10-01T08:01'));
    expect(again.changes).toEqual([]);
  });

  it('Tamper Guard: a manual extension in AxTraxNG is detected and reverted', async () => {
    const paid = { ...base, segments: [{ from: '2026-10-01T00:00:00', until: '2026-10-31T23:59:59', zones: ['gym'] }] };
    const { axtraxUserId } = await converge(ax, paid, zones, now('2026-10-01T08:00'));
    const u = fake.users.get(axtraxUserId);
    if (u) u.dtStopDate = '2027-03-31T23:59:59'; // receptionist "extends six months"
    const r = await converge(ax, paid, zones, now('2026-10-02T08:00'));
    expect(r.changes).toEqual(['stop 2027-03-31T23:59:59 -> 2026-10-31T23:59:59']);
    expect(fake.swipe(21001, 0, 11, '2026-11-15T10:00:00')).toBe(false);
  });

  it('bundle reuses one combo access group per zone set', async () => {
    const seg = [{ from: '2026-10-01T00:00:00', until: '2026-10-31T23:59:59', zones: ['gym', 'pool'] }];
    await converge(ax, { ...base, segments: seg }, zones, now('2026-10-01T08:00'));
    await converge(
      ax,
      { ...base, memberNo: 21002, credentials: [{ siteCode: 0, cardCode: 21002, cardType: 1 }], segments: seg },
      zones,
      now('2026-10-01T08:00'),
    );
    expect([...fake.groups.values()].filter((g) => g.tDesc === 'LG: gym + pool')).toHaveLength(1);
    expect(fake.swipe(21002, 0, 13, '2026-10-01T09:00:00')).toBe(true);
  });

  it('refuses to steal a card owned by another user', async () => {
    await converge(ax, base, zones, now('2026-10-01T08:00'));
    await expect(converge(ax, { ...base, memberNo: 21099 }, zones, now('2026-10-01T08:00'))).rejects.toThrow(
      /belongs to another/,
    );
  });
  it('keeps combo groups in step with the zone map (a reader moved out of a zone stops opening)', async () => {
    const paid = { ...base, segments: [{ from: '2026-10-01T00:00:00', until: '2026-10-31T23:59:59', zones: ['gym'] }] };
    await converge(ax, paid, zones, now('2026-10-01T08:00'));
    expect(fake.swipe(21001, 0, 11, '2026-10-01T08:05:00')).toBe(true);
    await converge(ax, paid, { ...zones, gym: [12] }, now('2026-10-01T08:10'));
    expect(fake.swipe(21001, 0, 11, '2026-10-01T08:15:00')).toBe(false);
    expect(fake.swipe(21001, 0, 12, '2026-10-01T08:15:00')).toBe(true);
  });
  it('a never-paid member gets a real (past) validity window, and an update AxTraxNG ignores is an error', async () => {
    await converge(ax, base, zones, now('2026-10-01T08:00'));
    const u = [...fake.users.values()].find((x) => x.EmpNumCompany === 21001);
    expect([u?.bValidDate, u?.dtStartDate, u?.dtStopDate]).toEqual([
      true,
      '2000-01-01T00:00:00',
      '2000-01-01T23:59:59',
    ]);
    expect(fake.swipe(21001, 0, 11, '2026-10-01T08:05:00')).toBe(false);
    // Simulate a server that drops the write: the converge must fail loudly, not report success.
    const realUpdate = ax.updateUser.bind(ax);
    ax.updateUser = (async (x) => ax.getUser(x.ID)) as typeof ax.updateUser;
    const paid = {
      ...base,
      version: 2,
      segments: [{ from: '2026-10-01T00:00:00', until: '2026-10-31T23:59:59', zones: ['gym'] }],
    };
    await expect(converge(ax, paid, zones, now('2026-10-01T08:10'))).rejects.toThrow(/did not apply/);
    ax.updateUser = realUpdate;
  });
});
