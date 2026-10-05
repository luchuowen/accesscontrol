import { withTenant } from '@lango/db';
import { reconcileTaifaPay } from '@lango/server';
import { db } from '@/server/db';

/**
 * Pages that show a payment (member portal, staff members list and profile) call this while an M-Pesa prompt is out:
 * it asks the gateway directly, at most every 3 s per club, so the payment lands without waiting for the webhook.
 * Returns whether a prompt is still waiting, so the page knows to keep refreshing.
 */
const last = new Map<string, number>();
export async function settlePending(tenantId: string, memberId?: string): Promise<boolean> {
  const [p] = await withTenant(
    db(),
    tenantId,
    (tx) => tx`select 1 from payment_intents where status = 'pending' and created_at > now() - interval '5 minutes'
                ${memberId ? tx`and member_id = ${memberId}` : tx``} limit 1`,
  );
  if (!p) return false;
  if (Date.now() - (last.get(tenantId) ?? 0) >= 3000) {
    last.set(tenantId, Date.now());
    await reconcileTaifaPay(db(), () => {}, 3).catch(() => 0);
  }
  return true;
}
