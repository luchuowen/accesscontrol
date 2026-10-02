'use server';
import { withTenant } from '@lango/db';
import { can } from '@lango/server';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

/** Find a member by name, number or phone (for "Record cash" / "Send M-Pesa prompt" from Payments). */
export async function findMembers(
  q: string,
): Promise<{ id: string; no: number; name: string; phone: string | null }[]> {
  const s = await requireSession();
  if (!can(s, 'payments.record')) return [];
  const t = String(q ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 60);
  if (t.length < 2) return [];
  const digits = t.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, '');
  return withTenant(db(), s.tid, async (tx) => {
    const rows = await tx<{ id: string; member_no: number; name: string; phone: string | null }[]>`
      select id, member_no, first_name || ' ' || last_name as name, phone from members
      where member_no not between 11001 and 11999 and status = 'active'
        and (lower(first_name || ' ' || last_name) like ${`%${t}%`} or member_no::text like ${`%${t}%`}
             or (${digits} <> '' and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like ${`%${digits}%`}))
      order by first_name limit 8`;
    return rows.map((r) => ({ id: r.id, no: r.member_no, name: r.name, phone: r.phone }));
  });
}
