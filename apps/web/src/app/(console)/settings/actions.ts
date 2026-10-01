'use server';
import { withTenant } from '@lango/db';
import { encrypt, TaifaPay } from '@lango/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

export async function saveTaifaPay(form: FormData) {
  const s = await requireSession();
  if (s.role !== 'owner') throw new Error('only the owner can change payment settings');
  const env = String(form.get('env')) === 'live' ? 'live' : 'sandbox';
  const clientId = String(form.get('clientId') ?? '').trim();
  const clientSecret = String(form.get('clientSecret') ?? '').trim();
  if (!clientId || !clientSecret) redirect('/settings?taifa=missing');
  // Prove the keys work before storing them.
  try {
    await new TaifaPay({ env, clientId, clientSecret }).transaction('connection-test').catch((e: Error) => {
      if (/auth failed/i.test(e.message)) throw e; // 404 for the dummy id means auth succeeded
    });
  } catch {
    redirect('/settings?taifa=rejected');
  }
  await withTenant(db(), s.tid, async (tx) => {
    const data = { taifapay: { env, clientId, clientSecret: encrypt(clientSecret) } };
    await tx`insert into tenant_settings (tenant_id, data) values (${s.tid}, ${tx.json(data as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'settings.taifapay', ${tx.json({ env, clientId } as never)})`;
  });
  revalidatePath('/settings');
  redirect('/settings?taifa=ok');
}
