'use server';
import { withTenant } from '@lango/db';
import {
  can,
  clubSms,
  encrypt,
  msisdn,
  type NotifySettings,
  platformSms,
  platformSmsConfig,
  rateLimit,
  startTopup,
  TaifaAuthError,
  TaifaPay,
} from '@lango/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

export async function saveTaifaPay(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'settings.payments')) redirect('/settings?tab=payments&taifa=forbidden');
  const env = String(form.get('env')) === 'live' ? 'live' : 'sandbox';
  const clientId = String(form.get('clientId') ?? '').trim();
  const clientSecret = String(form.get('clientSecret') ?? '').trim();
  if (!clientId || !clientSecret) redirect('/settings?tab=payments&taifa=missing');
  // Prove the keys work before storing them (one call to TaifaPay, 15 s limit).
  let outcome: 'ok' | 'rejected' | 'unreachable' = 'ok';
  try {
    await new TaifaPay({ env, clientId, clientSecret }).verify();
  } catch (e) {
    outcome = e instanceof TaifaAuthError ? 'rejected' : 'unreachable';
  }
  if (outcome !== 'ok') redirect(`/settings?tab=payments&taifa=${outcome}`);
  await withTenant(db(), s.tid, async (tx) => {
    const data = { taifapay: { env, clientId, clientSecret: encrypt(clientSecret) } };
    await tx`insert into tenant_settings (tenant_id, data) values (${s.tid}, ${tx.json(data as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'settings.taifapay', ${tx.json({ env, clientId: `…${clientId.slice(-4)}` } as never)})`;
  });
  revalidatePath('/settings');
  redirect('/settings?tab=payments&taifa=ok');
}

const SHORTCODE = /^\d{5,7}$/;

/** How members pay: the club's paybill/till as linked on TaifaPay, and bank settlement confirmation. */
export async function saveChannels(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'settings.payments')) redirect('/settings?tab=payments&ch=forbidden');
  const paybill = String(form.get('paybill') ?? '').replace(/\s/g, '');
  const till = String(form.get('till') ?? '').replace(/\s/g, '');
  const linksOnly = form.get('linksOnly') === 'on';
  const settlementConfirmed = form.get('settlementConfirmed') === 'on';
  const settlementBank = String(form.get('settlementBank') ?? '')
    .trim()
    .slice(0, 80);
  if ((paybill && !SHORTCODE.test(paybill)) || (till && !SHORTCODE.test(till)))
    redirect('/settings?tab=payments&ch=number');
  const channels = { paybill: paybill || null, till: till || null, linksOnly, settlementConfirmed, settlementBank };
  await withTenant(db(), s.tid, async (tx) => {
    await tx`insert into tenant_settings (tenant_id, data) values (${s.tid}, ${tx.json({ channels } as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'settings.channels', ${tx.json(channels as never)})`;
  });
  revalidatePath('/settings');
  redirect('/settings?tab=payments&ch=ok');
}

/** Club SMS switches: on/off, receipts, expiry reminders (N days before + last day), welcome message. */
/** Send one SMS now to a number the owner types, to prove delivery end to end. */
export async function sendTestSms(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'messages.manage')) redirect('/settings?tab=messages&sms=forbidden');
  const to = msisdn(String(form.get('phone') ?? ''));
  if (!to) redirect('/settings?tab=messages&sms=number');
  if (!rateLimit(`sms-test:${s.tid}`, 5, 10 * 60_000)) redirect('/settings?tab=messages&sms=wait');
  const client = await platformSms(db());
  if (!client) redirect('/settings?tab=messages&sms=platform');
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
  redirect(`/settings?tab=messages&sms=${r.ok ? 'test-sent' : 'test-failed'}`);
}

/** Buy SMS credit: M-Pesa prompt to the given phone, paid to NAVAC; credit lands when TaifaPay confirms. */
export async function buySms(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'sms.buy')) redirect('/settings?tab=messages&sms=forbidden');
  const amountKes = Number(String(form.get('amountKes') ?? '').replace(/[,\s]/g, ''));
  const r = await startTopup(db(), s.tid, {
    amountKes,
    phone: String(form.get('phone') ?? ''),
    trigger: 'manual',
    actor: s.uid,
  });
  revalidatePath('/settings');
  redirect(`/settings?tab=messages&sms=${r.ok ? 'topup-sent' : `topup-${r.reason}`}`);
}

const hour = (v: FormDataEntryValue | null, d: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d;
};

export async function saveNotifications(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'messages.manage')) redirect('/settings?tab=messages&m=forbidden');
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
  if (staffAlerts && !notifications.alertPhone) redirect('/settings?tab=messages&m=alert-phone');
  await withTenant(db(), s.tid, async (tx) => {
    await tx`insert into tenant_settings (tenant_id, data) values (${s.tid}, ${tx.json({ notifications } as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'settings.notifications', ${tx.json(notifications as never)})`;
  });
  revalidatePath('/settings');
  redirect('/settings?tab=messages&m=saved');
}
