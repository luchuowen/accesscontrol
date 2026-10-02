import { withTenant } from '@lango/db';
import { can, msisdn, openConversation } from '@lango/server';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

/**
 * "Message" on a member: opens their latest conversation (any channel), or a new SMS conversation to their phone.
 */
export async function GET(req: Request) {
  const s = await requireSession();
  if (!can(s, 'inbox.reply')) redirect('/communications?m=forbidden');
  const id = new URL(req.url).searchParams.get('member') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) redirect('/communications');
  const conv = await withTenant(db(), s.tid, async (tx) => {
    const [had] = await tx<{ id: string }[]>`
      select id from conversations where member_id = ${id} order by last_at desc limit 1`;
    if (had) return had.id;
    const [m] = await tx<{ phone: string | null; name: string }[]>`
      select phone, first_name || ' ' || last_name as name from members where id = ${id}`;
    const phone = msisdn(m?.phone);
    return phone ? openConversation(tx, s.tid, 'sms', phone, m?.name) : null;
  });
  redirect(conv ? `/communications?c=${conv}` : '/communications?m=no-phone');
}
