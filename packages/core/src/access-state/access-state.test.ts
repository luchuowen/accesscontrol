import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { comboGroupName, desiredAt, toSegments } from './access-state.js';

const tz = 'Africa/Nairobi';
const d = (s: string) => DateTime.fromISO(s, { zone: tz });
const e = (zone: string, a: string, b: string) => ({ zone, start: d(a).startOf('day'), end: d(b).endOf('day') });
const fmt = (s: { from: DateTime; until: DateTime; zones: string[] }) =>
  `${s.from.toFormat('MM-dd')}..${s.until.toFormat('MM-dd')} ${s.zones.join('+')}`;

describe('toSegments', () => {
  it('gym month + sauna week → two segments', () => {
    const segs = toSegments([e('gym', '2026-10-01', '2026-10-31'), e('sauna', '2026-10-01', '2026-10-07')]);
    expect(segs.map(fmt)).toEqual(['10-01..10-07 gym+sauna', '10-08..10-31 gym']);
  });
  it('back-to-back renewals merge', () => {
    const segs = toSegments([e('gym', '2026-10-01', '2026-10-31'), e('gym', '2026-11-01', '2026-11-30')]);
    expect(segs.map(fmt)).toEqual(['10-01..11-30 gym']);
  });
  it('gaps are dropped', () => {
    const segs = toSegments([e('gym', '2026-08-01', '2026-08-31'), e('gym', '2026-10-05', '2026-11-04')]);
    expect(segs.map(fmt)).toEqual(['08-01..08-31 gym', '10-05..11-04 gym']);
  });
});

describe('desiredAt', () => {
  const segs = toSegments([e('gym', '2026-10-01', '2026-10-31'), e('sauna', '2026-10-01', '2026-10-07')]);
  it('during bundle: both zones, valid until end of gym', () => {
    const x = desiredAt(segs, d('2026-10-03T10:00'));
    expect(x.zones).toEqual(['gym', 'sauna']);
    expect(x.validUntil?.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-10-31 23:59');
    expect(x.cardsActive).toBe(true);
  });
  it('after sauna ends: gym only', () => {
    expect(desiredAt(segs, d('2026-10-09T10:00')).zones).toEqual(['gym']);
  });
  it('after everything ends: no zones, cards inactive, dates kept', () => {
    const x = desiredAt(segs, d('2026-11-02T10:00'));
    expect(x).toMatchObject({ zones: [], cardsActive: false });
    expect(x.validUntil?.toFormat('MM-dd')).toBe('10-31');
  });
  it('paid in advance: next zones applied now, start date gates entry', () => {
    const x = desiredAt(toSegments([e('gym', '2026-11-01', '2026-11-30')]), d('2026-10-20T10:00'));
    expect(x).toMatchObject({ zones: ['gym'], cardsActive: true });
    expect(x.validFrom?.toFormat('MM-dd')).toBe('11-01');
  });
});

it('comboGroupName is order independent', () => {
  expect(comboGroupName(['sauna', 'gym'])).toBe(comboGroupName(['gym', 'sauna']));
  expect(comboGroupName(['sauna', 'gym'])).toBe('LG: gym + sauna');
});
