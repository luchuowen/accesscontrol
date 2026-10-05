'use server';
import { withTenant } from '@lango/db';
import {
  can,
  clubSms,
  msisdn,
  type NotifySettings,
  normaliseRules,
  platformSms,
  platformSmsConfig,
  rateLimit,
  startSubscriptionPayment,
  startTopup,
} from '@lango/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

export async function sendTestSms(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'messages.manage')) redirect('/settings?tab=sms&sms=forbidden');
  const to = msisdn(String(form.get('phone') ?? ''));
  if (!to) redirect('/settings?tab=sms&sms=number');
  if (!rateLimit(`sms-test:${s.tid}`, 5, 10 * 60_000)) redirect('/settings?tab=sms&sms=wait');
  const client = await platformSms(db());
  if (!client) redirect('/settings?tab=sms&sms=platform');
  const [t] = await db()<{ name: string }[]>`select name from tenants where id = ${s.tid}`;
  const body = `${t?.name}: this is a test message from Lango. SMS receipts and reminders are working.`;
  // Sent under the club's own sender ID, so this also proves the sender is registered.
  const club = await withTenant(db(), s.tid, async (tx) => clubSms(tx, s.tid, await platformSmsConfig(db())));
  let r: Awaited<ReturnType<typeof client.send>>;
  try {
    r = await client.send(to, body, club.sender);
  } catch (e) {
    r = { ok: false, code: 'network', desc: (e as Error).message, retry: true };
  }
  await withTenant(db(), s.tid, async (tx) => {
    await tx`insert into sms_messages (tenant_id, phone, body, kind, status, provider_ref, error, attempts, sent_at)
             values (${s.tid}, ${to}, ${body}, 'test', ${r.ok ? 'sent' : 'failed'}, ${r.messageId ?? null},
                     ${r.ok ? null : `${r.code} ${r.desc}`.slice(0, 300)}, 1, ${r.ok ? new Date() : null})`;
  });
  revalidatePath('/settings');
  redirect(`/settings?tab=sms&sms=${r.ok ? 'test-sent' : 'test-failed'}`);
}

/** Buy SMS credit: M-Pesa prompt to the given phone, paid to NAVAC; credit lands when TaifaPay confirms. */
export async function buySms(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'sms.buy')) redirect('/settings?tab=sms&sms=forbidden');
  const amountKes = Number(String(form.get('amountKes') ?? '').replace(/[,\s]/g, ''));
  const r = await startTopup(db(), s.tid, {
    amountKes,
    phone: String(form.get('phone') ?? ''),
    trigger: 'manual',
    actor: s.uid,
  });
  revalidatePath('/settings');
  redirect(`/settings?tab=sms&sms=${r.ok ? 'topup-sent' : `topup-${r.reason}`}`);
}

const hour = (v: FormDataEntryValue | null, d: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d;
};

export async function saveNotifications(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'messages.manage')) redirect('/settings?tab=notifications&m=forbidden');
  const on = (k: string) => form.get(k) === 'on';
  const notifications: NotifySettings = {
    enabled: on('enabled'),
    receipts: on('receipts'),
    unmatched: on('unmatched'),
    reminders: on('reminders'),
    reminderDays: Math.min(14, Math.max(1, Number(form.get('reminderDays') ?? 3) || 3)),
    welcome: on('welcome'),
    winback: on('winback'),
    alertPhone: msisdn(String(form.get('alertPhone') ?? '')) ?? undefined,
    bridgeAlerts: on('bridgeAlerts'),
    tamperAlerts: on('tamperAlerts'),
    dailySummary: on('dailySummary'),
    lowBalance: Math.min(100_000, Math.max(0, Number(form.get('lowBalance') ?? 100) || 0)),
    autoTopup: on('autoTopup'),
    autoTopupKes: Math.min(150_000, Math.max(100, Number(form.get('autoTopupKes') ?? 1000) || 1000)),
    quietFrom: hour(form.get('quietFrom'), 20),
    quietTo: hour(form.get('quietTo'), 7),
  };
  const staffAlerts = notifications.autoTopup || notifications.dailySummary;
  if (staffAlerts && !notifications.alertPhone) redirect('/settings?tab=notifications&m=alert-phone');
  await withTenant(db(), s.tid, async (tx) => {
    await tx`insert into tenant_settings (tenant_id, data) values (${s.tid}, ${tx.json({ notifications } as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'settings.notifications', ${tx.json(notifications as never)})`;
  });
  revalidatePath('/settings');
  redirect('/settings?tab=notifications&m=saved');
}

/** Pay NAVAC for the Lango subscription: an M-Pesa prompt for 1 or more billing cycles. */
export async function payPlan(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'billing.manage')) redirect('/settings?tab=billing&b=forbidden');
  if (!rateLimit(`billing:${s.tid}`, 5, 10 * 60_000)) redirect('/settings?tab=billing&b=wait');
  const r = await startSubscriptionPayment(db(), s.tid, {
    cycles: Number(form.get('cycles') ?? 1),
    phone: String(form.get('phone') ?? ''),
    actor: s.uid,
    kind: form.get('kind') === 'setup' ? 'setup' : 'subscription',
  });
  revalidatePath('/settings');
  redirect(`/settings?tab=billing&b=${r.ok ? 'sent' : r.reason}`);
}

/** Settings › Member app: the club's self-service rules (pause limits, replacement card fee). */
export async function saveMemberRules(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'members.edit')) redirect('/settings?tab=member-app&m=forbidden');
  const memberRules = normaliseRules({
    pause: {
      enabled: form.get('pause') === 'on',
      minDays: form.get('minDays'),
      maxDays: form.get('maxDays'),
      perYear: form.get('perYear'),
    },
    card: { replaceFeeKes: String(form.get('replaceFeeKes') ?? '0').replace(/[^\d]/g, '') || 0 },
  });
  await withTenant(db(), s.tid, async (tx) => {
    await tx`insert into tenant_settings (tenant_id, data) values (${s.tid}, ${tx.json({ memberRules } as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'settings.member_rules', ${tx.json(memberRules as never)})`;
  });
  revalidatePath('/settings');
  redirect('/settings?tab=member-app&m=saved');
}
