'use server';
import { withTenant } from '@lango/db';
import { memberLastPlan, readRenewLink, startMemberPrompt } from '@lango/server';
import { redirect } from 'next/navigation';
import { db } from '@/server/db';

/** Renew link (from a reminder SMS): pays the member's last plan with a prompt to their own phone. Nothing else. */
export async function renewPay(form: FormData) {
  const code = String(form.get('code') ?? '');
  const link = await readRenewLink(db(), code);
  if (!link) redirect(`/r/${encodeURIComponent(code)}`);
  const plan = await withTenant(db(), link.tenantId, (tx) => memberLastPlan(tx, link.memberId));
  if (!plan) redirect(`/r/${code}`);
  const r = await startMemberPrompt(db(), link.tenantId, link.memberId, [plan.id], 'renew-link');
  redirect(`/r/${code}?pay=${r}`);
}
