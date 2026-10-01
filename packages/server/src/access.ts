import { toSegments } from '@lango/core';
import type { Tx } from '@lango/db';
import type { AccessState } from '@lango/protocol';
import { DateTime } from 'luxon';

const NAIVE = "yyyy-MM-dd'T'HH:mm:ss";

/**
 * Derive each site's desired AxTraxNG state for a member from entitlements and bump its version when it
 * changed. AccessState is derived only — never edited by hand (CLAUDE.md invariant).
 */
export async function rebuildAccessState(tx: Tx, tenantId: string, memberId: string): Promise<number> {
  const [t] = await tx<{ timezone: string }[]>`select timezone from tenants where id = ${tenantId}`;
  const tz = t?.timezone ?? 'Africa/Nairobi';
  const [m] = await tx<
    { member_no: number; first_name: string; last_name: string; phone: string | null; status: string }[]
  >`
    select member_no, first_name, last_name, phone, status from members where id = ${memberId}`;
  if (!m) throw new Error(`member ${memberId} not found`);
  const creds = await tx<{ site_code: number; card_code: bigint; card_type: number }[]>`
    select site_code, card_code, card_type from credentials where member_id = ${memberId} order by card_code`;
  const ents = await tx<{ zone_key: string; starts_at: Date; ends_at: Date }[]>`
    select zone_key, starts_at, ends_at from entitlements where member_id = ${memberId}`;
  const sites = await tx<{ id: string; keys: string[] }[]>`
    select s.id, coalesce(array_agg(z.key) filter (where z.key is not null), '{}') as keys
    from sites s left join zones z on z.site_id = s.id group by s.id`;
  let bumped = 0;
  for (const site of sites) {
    const mine = m.status === 'active' ? ents.filter((e) => site.keys.includes(e.zone_key)) : [];
    const segments = toSegments(
      mine.map((e) => ({
        zone: e.zone_key,
        start: DateTime.fromJSDate(e.starts_at, { zone: tz }),
        end: DateTime.fromJSDate(e.ends_at, { zone: tz }),
      })),
    ).map((s) => ({ from: s.from.toFormat(NAIVE), until: s.until.toFormat(NAIVE), zones: s.zones }));
    const body: Omit<AccessState, 'version'> = {
      memberNo: m.member_no,
      firstName: m.first_name,
      lastName: m.last_name,
      ...(m.phone ? { mobile: m.phone } : {}),
      credentials: creds.map((c) => ({ siteCode: c.site_code, cardCode: Number(c.card_code), cardType: c.card_type })),
      segments,
    };
    const [cur] = await tx<{ version: number; doc: AccessState }[]>`
      select version, doc from access_states where site_id = ${site.id} and member_id = ${memberId} for update`;
    const { version: _v, ...curBody } = cur?.doc ?? ({} as AccessState);
    if (cur && JSON.stringify(curBody) === JSON.stringify(body)) continue;
    const version = (cur?.version ?? 0) + 1;
    const doc = { ...body, version };
    await tx`
      insert into access_states (tenant_id, site_id, member_id, version, doc)
      values (${tenantId}, ${site.id}, ${memberId}, ${version}, ${tx.json(doc as never)})
      on conflict (site_id, member_id) do update
        set version = excluded.version, doc = excluded.doc, seq = nextval('access_state_seq'), error = null`;
    await tx`select pg_notify('access_state', ${site.id})`;
    bumped++;
  }
  return bumped;
}
