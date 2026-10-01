import { DateTime } from 'luxon';

/** A member's right to enter one zone during [start, end] (tenant-local instants). */
export interface Entitlement {
  zone: string;
  start: DateTime;
  end: DateTime;
}

export interface Segment {
  from: DateTime;
  until: DateTime;
  zones: string[]; // sorted, non-empty
}

/**
 * Cut entitlements into contiguous segments with a constant zone set.
 * Gaps (no zone active) are omitted; adjacent segments with equal zone sets are merged.
 */
export function toSegments(ents: Entitlement[]): Segment[] {
  const valid = ents.filter((e) => e.end > e.start);
  const points = [...new Set(valid.flatMap((e) => [e.start.toMillis(), e.end.toMillis() + 1]))].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as number;
    const b = points[i + 1] as number;
    const zones = [
      ...new Set(valid.filter((e) => e.start.toMillis() <= a && e.end.toMillis() >= a).map((e) => e.zone)),
    ].sort();
    if (zones.length === 0) continue;
    const zone = valid[0]?.start.zone;
    const from = DateTime.fromMillis(a, zone ? { zone } : {});
    const until = DateTime.fromMillis(b - 1, zone ? { zone } : {});
    const prev = out[out.length - 1];
    if (prev && prev.zones.join('|') === zones.join('|') && prev.until.toMillis() + 1 === a) prev.until = until;
    else out.push({ from, until, zones });
  }
  return out;
}

/** What AxTraxNG must hold for this member at instant `now`. */
export interface AxtraxDesired {
  validFrom: DateTime | null;
  validUntil: DateTime | null;
  zones: string[]; // zones of the segment active now ([] = unauthorized group)
  cardsActive: boolean;
}

export function desiredAt(segments: Segment[], now: DateTime): AxtraxDesired {
  const future = segments.filter((s) => s.until >= now);
  if (future.length === 0) {
    const last = segments[segments.length - 1];
    return { validFrom: segments[0]?.from ?? null, validUntil: last?.until ?? null, zones: [], cardsActive: false };
  }
  const current = future.find((s) => s.from <= now);
  const first = future[0] as Segment;
  const last = future[future.length - 1] as Segment;
  return {
    validFrom: current ? current.from : first.from,
    validUntil: last.until,
    zones: current ? current.zones : first.zones, // future-only: panel enforces dtStartDate
    cardsActive: true,
  };
}

/** Stable AxTraxNG access-group name for a zone set. */
export function comboGroupName(zones: string[]): string {
  return `LG: ${[...zones].sort().join(' + ')}`;
}
