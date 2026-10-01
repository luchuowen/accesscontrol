import type { DateTime } from 'luxon';

export type DurationUnit = 'day' | 'month';
export interface PlanDuration {
  unit: DurationUnit;
  count: number;
}

export interface Period {
  start: DateTime;
  end: DateTime;
}

/**
 * End of a period that starts at `start` (tenant-local), inclusive, at 23:59:59.999.
 * month: same calendar day N months later minus one day (Oct 1 → Oct 31); when the target month is
 * shorter and the day clamps (Jan 31 → Feb 28), the clamped day itself is the last day.
 * day: N calendar days including the start day (a day pass ends tonight).
 */
export function periodEnd(start: DateTime, d: PlanDuration): DateTime {
  if (!Number.isInteger(d.count) || d.count < 1) throw new Error(`invalid duration count ${d.count}`);
  const day0 = start.startOf('day');
  if (d.unit === 'day') return day0.plus({ days: d.count - 1 }).endOf('day');
  const target = day0.plus({ months: d.count });
  const clamped = target.day !== day0.day;
  return (clamped ? target : target.minus({ days: 1 })).endOf('day');
}

/**
 * Renewal anchor: an active entitlement extends from the minute after its current end;
 * a lapsed (or missing) one starts at the beginning of the payment day.
 */
export function renewalStart(paidAt: DateTime, currentEnd: DateTime | null): DateTime {
  if (currentEnd && currentEnd > paidAt) return currentEnd.plus({ milliseconds: 1 }).startOf('day');
  return paidAt.startOf('day');
}

export function nextPeriod(paidAt: DateTime, currentEnd: DateTime | null, d: PlanDuration): Period {
  const start = renewalStart(paidAt, currentEnd);
  return { start, end: periodEnd(start, d) };
}
