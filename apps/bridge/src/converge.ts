import type { AxtraxClient, CardInfoDT, EmployeeInfoDT } from '@lango/axtrax';
import { TZ_ALWAYS, UNAUTHORIZED_GROUP_ID } from '@lango/axtrax';
import { comboGroupName, desiredAt, type Segment } from '@lango/core';
import type { AccessState, ZoneMap } from '@lango/protocol';
import { DateTime } from 'luxon';

const NAIVE = "yyyy-MM-dd'T'HH:mm:ss";
const NEVER = '2000-01-01T00:00:00';
export const toLocal = (d: DateTime | null) => (d ? d.toFormat(NAIVE) : null);
const norm = (s: string | null | undefined) => (s ? s.slice(0, 19) : null);

export interface ConvergeResult {
  axtraxUserId: number;
  changes: string[]; // human-readable list of fields changed in AxTraxNG ([] = already in desired state)
  wantKey: string; // fingerprint of the desired state at `now` (changes ⇒ scheduled switch, same ⇒ tamper)
}

/** Ensure an access group exists for exactly this zone set; returns its ID. */
export async function ensureGroup(ax: AxtraxClient, zones: string[], map: ZoneMap): Promise<number> {
  if (zones.length === 0) return UNAUTHORIZED_GROUP_ID;
  const name = comboGroupName(zones);
  // Only readers that really exist on this AxTraxNG server (a mis-mapped zone must not break the member).
  const known = new Set((await ax.readers()).map((r) => r.ID));
  const readers = [...new Set(zones.flatMap((z) => map[z] ?? []))].filter((r) => known.has(r)).sort((a, b) => a - b);
  const want = readers.map((IdReader) => ({ IdReader, IdTimeZone: TZ_ALWAYS }));
  const existing = (await ax.accessGroups()).find((g) => g.tDesc === name);
  if (!existing) return (await ax.addAccessGroup({ ID: 0, tDesc: name, TimezoneReaders: want })).ID;
  // Keep the group in step with the zone map: a reader moved out of a zone must stop opening for it.
  // If the server's list omits TimezoneReaders we cannot compare, so we leave the group alone.
  if (!Array.isArray(existing.TimezoneReaders)) return existing.ID;
  const key = (l: { IdReader: number; IdTimeZone: number }[]) =>
    l
      .map((t) => `${t.IdReader}:${t.IdTimeZone}`)
      .sort()
      .join(',');
  if (key(existing.TimezoneReaders) !== key(want)) {
    try {
      await ax.updateAccessGroup({
        ...existing,
        TimezoneReaders: want.map((t) => ({ ...t, IdAccessGroup: existing.ID })),
      });
    } catch (e) {
      // The member must still converge (dates are what lock people out); the group is retried next pass.
      console.warn(`access group "${name}" reader update failed: ${(e as Error).message}`);
    }
  }
  return existing.ID;
}

/**
 * Converge AxTraxNG to the desired AccessState at `now` (site-local). Idempotent.
 * GET → merge → PUT: unknown user fields are round-tripped untouched.
 */
export async function converge(ax: AxtraxClient, s: AccessState, map: ZoneMap, now: DateTime): Promise<ConvergeResult> {
  const zone = now.zone;
  const segs: Segment[] = s.segments.map((x) => ({
    from: DateTime.fromISO(x.from, { zone }),
    until: DateTime.fromISO(x.until, { zone }),
    zones: x.zones,
  }));
  const want = desiredAt(segs, now);
  const groupId = await ensureGroup(ax, want.zones, map);
  const changes: string[] = [];

  let found = await ax.findUserByNumber(s.memberNo);
  if (!found) {
    found = await ax.addUser({
      ID: 0,
      EmpNumCompany: s.memberNo,
      tFirstName: s.firstName,
      tLastName: s.lastName,
      UserAccGrp: { ID: groupId },
      UserDepartment: { ID: 1 },
      bValidDate: true,
      dtStartDate: toLocal(want.validFrom) ?? NEVER,
      dtStopDate: toLocal(want.validUntil) ?? NEVER,
      UserCards: [],
    });
    changes.push('user created');
  }
  const cur = await ax.getUser(found.ID);
  const next: EmployeeInfoDT = {
    ...cur,
    tFirstName: s.firstName,
    tLastName: s.lastName,
    ...(s.mobile ? { tMobile: s.mobile } : {}),
    bValidDate: true, // dates are always enforced; a member who never paid gets a validity window in the past
    dtStartDate: toLocal(want.validFrom) ?? NEVER,
    dtStopDate: toLocal(want.validUntil) ?? NEVER,
    UserAccGrp: { ...cur.UserAccGrp, ID: groupId },
  };
  const diff: string[] = [];
  if (cur.tFirstName !== next.tFirstName || cur.tLastName !== next.tLastName) diff.push('name');
  if (s.mobile && cur.tMobile !== s.mobile) diff.push('mobile');
  if (cur.bValidDate !== next.bValidDate) diff.push('bValidDate');
  if (norm(cur.dtStartDate) !== next.dtStartDate) diff.push(`start ${norm(cur.dtStartDate)} → ${next.dtStartDate}`);
  if (norm(cur.dtStopDate) !== next.dtStopDate) diff.push(`stop ${norm(cur.dtStopDate)} → ${next.dtStopDate}`);
  if (cur.UserAccGrp?.ID !== groupId) diff.push(`group ${cur.UserAccGrp?.ID} → ${groupId}`);
  if (diff.length) {
    const { UserCards: _cards, ...rest } = next;
    await ax.updateUser({ ...rest, UserCards: cur.UserCards } as EmployeeInfoDT);
    changes.push(...diff);
  }

  const status: 1 | 2 = want.cardsActive ? 1 : 2;
  for (const c of s.credentials) {
    const found0 = await ax.getCardByCode(c.cardCode, c.siteCode, c.cardType);
    // Real AxTraxNG answers "not found" with an empty card (ID 0, code 0), not null.
    const card = found0 && found0.ID > 0 && found0.iCardCode === c.cardCode ? found0 : null;
    if (!card) {
      await ax.addCard({
        ID: 0,
        iSiteCode: c.siteCode,
        iCardCode: c.cardCode,
        eCardType: c.cardType,
        CredentialType: 1,
        wStatus: status,
        IdEmpNum: found.ID,
        iFacilityCodeSecond: -1,
        iIssueNumber: -1,
      });
      changes.push(`card ${c.cardCode} added`);
    } else if (card.IdEmpNum !== 0 && card.IdEmpNum !== found.ID) {
      throw new Error(`card ${c.siteCode}:${c.cardCode} belongs to another AxTraxNG user (${card.IdEmpNum})`);
    } else if (card.IdEmpNum !== found.ID || card.wStatus !== status) {
      await ax.updateCard({ ...card, IdEmpNum: found.ID, wStatus: status });
      changes.push(`card ${c.cardCode} ${status === 1 ? 'active' : 'inactive'}`);
    }
  }
  // Credentials enrolled on site (biometrics, extra tags) follow the member's state too.
  const after = await ax.getUser(found.ID);
  for (const card of (after.UserCards ?? ([] as CardInfoDT[])).filter((x) => x.ID > 0 && x.iCardCode > 0)) {
    if (
      card.wStatus !== status &&
      !s.credentials.some((c) => c.cardCode === card.iCardCode && c.siteCode === card.iSiteCode)
    ) {
      await ax.updateCard({ ...card, wStatus: status });
      changes.push(`card ${card.iCardCode} ${status === 1 ? 'active' : 'inactive'}`);
    }
  }
  const wantKey = JSON.stringify([toLocal(want.validFrom), toLocal(want.validUntil), want.zones, want.cardsActive]);
  return { axtraxUserId: found.ID, changes, wantKey };
}
