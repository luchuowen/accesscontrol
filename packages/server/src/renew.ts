import { randomInt } from 'node:crypto';
import type { Sql, Tx } from '@lango/db';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * A renew link for a reminder SMS: `${portal}/r/<10 characters>`, valid 48 hours. It opens a pay-only screen for this
 * member's last plan (see apps/web/src/app/r); nothing else can be seen or changed through it.
 */
export async function renewLink(tx: Tx, tenantId: string, memberId: string, portal: string): Promise<string> {
  const code = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  await tx`insert into renew_links (code, tenant_id, member_id, expires_at)
           values (${code}, ${tenantId}, ${memberId}, now() + interval '48 hours')`;
  return `${portal.replace(/\/$/, '')}/r/${code}`;
}

/** Which club and member a renew link is for, or null when it is unknown or expired. */
export async function readRenewLink(sql: Sql, code: string): Promise<{ tenantId: string; memberId: string } | null> {
  if (!/^[A-Za-z0-9]{10}$/.test(code)) return null;
  const [r] = await sql<{ tenant_id: string; member_id: string }[]>`select * from app_renew_link(${code})`;
  return r ? { tenantId: r.tenant_id, memberId: r.member_id } : null;
}
