import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AxtraxClient, demoSeed, FakeAxtrax } from '@lango/axtrax';
import { DateTime } from 'luxon';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Bridge } from './bridge.js';
import { Journal } from './journal.js';

let fake: FakeAxtrax;
let clock = DateTime.fromISO('2026-10-03T10:00', { zone: 'Africa/Nairobi' });
const uploads: string[] = [];
class TestBridge extends Bridge {
  override now() {
    return clock;
  }
}
let bridge: TestBridge;

beforeEach(async () => {
  fake = new FakeAxtrax(demoSeed());
  const ax = new AxtraxClient({ baseUrl: await fake.listen(), username: 'lango', password: 'lango' });
  const j = new Journal(join(mkdtempSync(join(tmpdir(), 'lb-')), 'j.json'));
  j.data.zones = { gym: [11], sauna: [12] };
  j.data.states['21001'] = {
    memberNo: 21001,
    firstName: 'Jane',
    lastName: 'W',
    version: 1,
    credentials: [{ siteCode: 0, cardCode: 21001, cardType: 1 }],
    segments: [
      { from: '2026-10-01T00:00:00', until: '2026-10-07T23:59:59', zones: ['gym', 'sauna'] },
      { from: '2026-10-08T00:00:00', until: '2026-10-31T23:59:59', zones: ['gym'] },
    ],
  };
  const fetchImpl = (async (u: string) => {
    uploads.push(String(u));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  bridge = new TestBridge({ cloudUrl: 'http://cloud', bridgeId: 'b', secret: 's', log: () => {}, fetchImpl }, ax, j);
  uploads.length = 0;
});
afterEach(() => fake.close());

it('offline scheduler: the sauna add-on ends on day 8 without any cloud contact, and is not reported as tampering', async () => {
  clock = DateTime.fromISO('2026-10-03T10:00', { zone: 'Africa/Nairobi' });
  await bridge.applyPending();
  expect(fake.swipe(21001, 0, 12, '2026-10-03T10:05:00')).toBe(true);
  clock = DateTime.fromISO('2026-10-08T06:00', { zone: 'Africa/Nairobi' });
  expect(await bridge.guard()).toEqual([]); // scheduled switch, not drift
  expect(uploads.filter((u) => u.includes('/drift'))).toHaveLength(0);
  expect(fake.swipe(21001, 0, 12, '2026-10-08T06:05:00')).toBe(false);
  expect(fake.swipe(21001, 0, 11, '2026-10-08T06:06:00')).toBe(true);
});

it('Tamper Guard reports a manual change exactly once', async () => {
  clock = DateTime.fromISO('2026-10-03T10:00', { zone: 'Africa/Nairobi' });
  await bridge.applyPending();
  const u = [...fake.users.values()][0];
  if (u) u.UserAccGrp = { ID: 1 }; // someone gives the member the Master group
  const d = await bridge.guard();
  expect(d).toHaveLength(1);
  expect(uploads.filter((x) => x.includes('/drift'))).toHaveLength(1);
  expect(await bridge.guard()).toEqual([]);
});
