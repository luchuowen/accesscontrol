import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Sql } from '@lango/db';
import { withTenant } from '@lango/db';
import { platformSmsConfig, type SourceCodeSms, sendNow } from './sms.js';

/**
 * Member portal sign-in by one-time SMS code (club code + member number → 6-digit code to the phone on file).
 * Codes last 10 minutes, allow 5 tries, and a member can ask for one a minute (5 an hour). When the club has
 * SMS off or no credit, the portal falls back to confirming the phone number.
 */
const TTL_MIN = 10;
const hash = (id: string, code: string) => createHash('sha256').update(`${id}:${code}`).digest('hex');

async function findMember(sql: Sql, slug: string, memberNo: number) {
  if (!/^[a-z0-9-]{2,40}$/.test(slug) || !Number.isSafeInteger(memberNo)) return null;
  const [t] = await sql<{ id: string; name: string }[]>`select id, name from tenants where slug = ${slug}`;
  if (!t) return null;
  const [m] = await withTenant(
    sql,
    t.id,
    (tx) =>
      tx<{ id: string; phone: string | null }[]>`
        select id, phone from members where member_no = ${memberNo} and status = 'active'`,
  );
  return m?.phone ? { tenantId: t.id, club: t.name, memberId: m.id, phone: m.phone } : null;
}

export type OtpRequest = 'sent' | 'unknown' | 'wait' | 'fallback';

export async function requestOtp(
  sql: Sql,
  slug: string,
  memberNo: number,
  client?: SourceCodeSms | null,
): Promise<OtpRequest> {
  const m = await findMember(sql, slug, memberNo);
  if (!m) return 'unknown';
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const ok = await withTenant(sql, m.tenantId, async (tx) => {
    const [r] = await tx<{ hour: number; minute: number }[]>`
      select count(*)::int as hour, (count(*) filter (where created_at > now() - interval '60 seconds'))::int as minute
      from member_otps where member_id = ${m.memberId} and created_at > now() - interval '1 hour'`;
    if ((r?.hour ?? 0) >= 5 || (r?.minute ?? 0) > 0) return false;
    await tx`insert into member_otps (id, tenant_id, member_id, code_hash, expires_at)
             values (${id}, ${m.tenantId}, ${m.memberId}, ${hash(id, code)}, now() + make_interval(mins => ${TTL_MIN}))`;
    return true;
  });
  if (!ok) return 'wait';
  const sent = await sendNow(
    sql,
    m.tenantId,
    {
      phone: m.phone,
      body: `${m.club}: your sign-in code is ${code}. It expires in ${TTL_MIN} minutes. Never share it.`,
      kind: 'otp',
      memberId: m.memberId,
    },
    client,
  );
  if (sent) return 'sent';
  await withTenant(sql, m.tenantId, (tx) => tx`update member_otps set used_at = now() where id = ${id}`);
  return 'fallback';
}

export async function verifyOtp(
  sql: Sql,
  slug: string,
  memberNo: number,
  code: string,
): Promise<{ tenantId: string; memberId: string } | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const m = await findMember(sql, slug, memberNo);
  if (!m) return null;
  return withTenant(sql, m.tenantId, async (tx) => {
    const [o] = await tx<{ id: string; code_hash: string }[]>`
      update member_otps set attempts = attempts + 1
      where id = (select id from member_otps where member_id = ${m.memberId} and used_at is null
                  and expires_at > now() and attempts < 5 order by created_at desc limit 1)
      returning id, code_hash`;
    if (!o) return null;
    const a = Buffer.from(hash(o.id, code));
    const b = Buffer.from(o.code_hash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    await tx`update member_otps set used_at = now() where id = ${o.id}`;
    return { tenantId: m.tenantId, memberId: m.memberId };
  });
}

/** Whether the portal can use SMS codes for this club right now (else it asks for the phone number). */
export async function otpAvailable(sql: Sql, slug: string): Promise<boolean> {
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = ${slug}`;
  if (!t) return true; // unknown clubs get the same screen as everyone else
  if (!(await platformSmsConfig(sql))?.apiKey) return false;
  return withTenant(sql, t.id, async (tx) => {
    const [s] = await tx<{ on: boolean | null }[]>`
      select (data->'notifications'->>'enabled')::boolean as on from tenant_settings where tenant_id = ${t.id}`;
    const [b] = await tx<{ units: string | null }[]>`select sum(units) as units from sms_ledger`;
    return !!s?.on && Number(b?.units ?? 0) > 0;
  });
}
