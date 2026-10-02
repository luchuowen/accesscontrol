import type { DateTime } from 'luxon';

export type DurationUnit = 'hour' | 'day' | 'week' | 'month' | 'year';
export const DURATION_UNITS: readonly DurationUnit[] = ['hour', 'day', 'week', 'month', 'year'];
export interface PlanDuration {
  unit: DurationUnit;
  count: number;
}

export interface Period {
  start: DateTime;
  end: DateTime;
}

/**
 * End of a period that starts at `start` (tenant-local).
 * hour: exactly N hours after the start (a 2-hour sauna).
 * day / week: N (or 7N) calendar days including the start day, to 23:59:59.999 (a day pass ends tonight).
 * month / year: same calendar day N months (12N for years) later minus one day (Oct 1 → Oct 31), at 23:59:59.999;
 * when the target month is shorter and the day clamps (Jan 31 → Feb 28), the clamped day itself is the last day.
 */
export function periodEnd(start: DateTime, d: PlanDuration): DateTime {
  if (!Number.isInteger(d.count) || d.count < 1) throw new Error(`invalid duration count ${d.count}`);
  if (d.unit === 'hour') return start.plus({ hours: d.count });
  const day0 = start.startOf('day');
  if (d.unit === 'day' || d.unit === 'week')
    return day0.plus({ days: d.count * (d.unit === 'week' ? 7 : 1) - 1 }).endOf('day');
  const target = day0.plus({ months: d.count * (d.unit === 'year' ? 12 : 1) });
  const clamped = target.day !== day0.day;
  return (clamped ? target : target.minus({ days: 1 })).endOf('day');
}

/**
 * Renewal anchor. Paying early never loses time: a still-running period of the same service is extended from its
 * end (whole days from the next day; hours from the exact minute). A lapsed or missing one starts now (hours) or
 * at the beginning of the payment day (days and longer).
 */
export function renewalStart(paidAt: DateTime, currentEnd: DateTime | null, unit: DurationUnit = 'day'): DateTime {
  const running = currentEnd && currentEnd > paidAt;
  if (unit === 'hour') return running ? (currentEnd as DateTime).plus({ milliseconds: 1 }) : paidAt;
  if (running) return (currentEnd as DateTime).plus({ milliseconds: 1 }).startOf('day');
  return paidAt.startOf('day');
}

export function nextPeriod(paidAt: DateTime, currentEnd: DateTime | null, d: PlanDuration): Period {
  const start = renewalStart(paidAt, currentEnd, d.unit);
  return { start, end: periodEnd(start, d) };
}

/** "2 hours", "1 day", "3 months", "1 year". */
export function durationLabel(d: PlanDuration): string {
  return `${d.count} ${d.unit}${d.count === 1 ? '' : 's'}`;
}
