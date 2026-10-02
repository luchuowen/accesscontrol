import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { nextPeriod, periodEnd } from './period.js';

const tz = 'Africa/Nairobi';
const at = (iso: string) => DateTime.fromISO(iso, { zone: tz });
const ymd = (d: DateTime) => d.toFormat('yyyy-MM-dd HH:mm:ss');

describe('periodEnd', () => {
  it.each([
    ['2026-10-01', 1, '2026-10-31'],
    ['2026-09-02', 1, '2026-10-01'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-08-31', 6, '2027-02-28'],
    ['2026-03-15', 12, '2027-03-14'],
  ])('month: %s + %i → %s', (s, n, e) => {
    expect(ymd(periodEnd(at(s), { unit: 'month', count: n }))).toBe(`${e} 23:59:59`);
  });
  it('day pass ends tonight', () => {
    expect(ymd(periodEnd(at('2026-10-01T17:30'), { unit: 'day', count: 1 }))).toBe('2026-10-01 23:59:59');
  });
  it('rejects non-positive counts', () => {
    expect(() => periodEnd(at('2026-10-01'), { unit: 'day', count: 0 })).toThrow();
  });
});

describe('nextPeriod (renewal anchor)', () => {
  const month = { unit: 'month', count: 1 } as const;
  it('active member extends from current end', () => {
    const p = nextPeriod(at('2026-10-20T09:00'), at('2026-10-31').endOf('day'), month);
    expect(ymd(p.start)).toBe('2026-11-01 00:00:00');
    expect(ymd(p.end)).toBe('2026-11-30 23:59:59');
  });
  it('lapsed member starts today', () => {
    const p = nextPeriod(at('2026-10-20T09:00'), at('2026-08-31').endOf('day'), month);
    expect(ymd(p.start)).toBe('2026-10-20 00:00:00');
    expect(ymd(p.end)).toBe('2026-11-19 23:59:59');
  });
  it('new member starts today', () => {
    expect(ymd(nextPeriod(at('2026-10-01T06:00'), null, month).end)).toBe('2026-10-31 23:59:59');
  });
});

describe('hours, weeks, years', () => {
  it('hours end exactly N hours later and stack from the minute the last one ends', () => {
    const p = nextPeriod(at('2026-10-02T14:10'), null, { unit: 'hour', count: 2 });
    expect(p.end.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-10-02 16:10');
    const q = nextPeriod(at('2026-10-02T15:00'), p.end, { unit: 'hour', count: 2 });
    expect(q.end.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-10-02 18:10');
  });
  it('a week is seven calendar days including today; a year is twelve months', () => {
    expect(ymd(periodEnd(at('2026-10-02T09:00'), { unit: 'week', count: 1 }))).toBe('2026-10-08 23:59:59');
    expect(ymd(periodEnd(at('2026-10-01T09:00'), { unit: 'year', count: 1 }))).toBe('2027-09-30 23:59:59');
  });
});
