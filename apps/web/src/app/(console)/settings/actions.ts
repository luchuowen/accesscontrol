'use server';
import { withTenant } from '@lango/db';
import {
  can,
  clubSms,
  encrypt,
  msisdn,
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
  if (!can(s, 'settings.payments')) redirect('/settings?taifa=forbidden');
  const env = String(form.get('env')) === 'live' ? 'live' : 'sandbox';
  const clientId = String(form.get('clientId') ?? '').trim();
  const clientSecret = String(form.get('clientSecret') ?? '').trim();
  if (!clientId || !clientSecret) redirect('/settings?taifa=missing');
  // Prove the keys work before storing them (one call to TaifaPay, 15 s limit).
  let outcome: 'ok' | 'rejected' | 'unreachable' = 'ok';
  try {
    await new TaifaPay({ env, clientId, clientSecret }).verify();
  } catch (e) {
    outcome = e instanceof TaifaAuthError ? 'rejected' : 'unreachable';
  }
  if (outcome !== 'ok') redirect(`/settings?taifa=${outcome}`);
  await withTenant(db(), s.tid, async (tx) => {
    const data = { taifapay: { env, clientId, clientSecret: encrypt(clientSecret) } };
    await tx`insert into tenant_settings (tenant_id, data) values (${s.tid}, ${tx.json(data as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'settings.taifapay', ${tx.json({ env, clientId: `…${clientId.slice(-4)}` } as never)})`;
  });
  revalidatePath('/settings');
  redirect('/settings?taifa=ok');
}

const SHORTCODE = /^\d{5,7}$/;

/** How members pay: the club's paybill/till as linked on TaifaPay, and bank settlement confirmation. */
export async function saveChannels(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'settings.payments')) redirect('/settings?ch=forbidden');
  const paybill = String(form.get('paybill') ?? '').replace(/\s/g, '');
  const till = String(form.get('till') ?? '').replace(/\s/g, '');
  const linksOnly = form.get('linksOnly') === 'on';
  const settlementConfirmed = form.get('settlementConfirmed') === 'on';
  const settlementBank = String(form.get('settlementBank') ?? '')
    .trim()
    .slice(0, 80);
  if ((paybill && !SHORTCODE.test(paybill)) || (till && !SHORTCODE.test(till))) redirect('/settings?ch=number');
  const channels = { paybill: paybill || null, till: till || null, linksOnly, settlementConfirmed, settlementBank };
  await withTenant(db(), s.tid, async (tx) => {
    await tx`insert into tenant_settings (tenant_id, data) values (${s.tid}, ${tx.json({ channels } as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'settings.channels', ${tx.json(channels as never)})`;
  });
  revalidatePath('/settings');
  redirect('/settings?ch=ok');
}

/** Club SMS switches: on/off, receipts, expiry reminders (N days before + last day), welcome message. */
/** Send one SMS now to a number the owner types, to prove delivery end to end. */
export async function sendTestSms(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'messages.manage')) redirect('/settings?sms=forbidden');
  const to = msisdn(String(form.get('phone') ?? ''));
  if (!to) redirect('/settings?sms=number');
  if (!rateLimit(`sms-test:${s.tid}`, 5, 10 * 60_000)) redirect('/settings?sms=wait');
  const client = await platformSms(db());
  if (!client) redirect('/settings?sms=platform');
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
  redirect(`/settings?sms=${r.ok ? 'test-sent' : 'test-failed'}`);
}

/** Buy SMS credit: M-Pesa prompt to the given phone, paid to NAVAC; credit lands when TaifaPay confirms. */
export async function buySms(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'sms.buy')) redirect('/settings?sms=forbidden');
  const amountKes = Number(String(form.get('amountKes') ?? '').replace(/[,\s]/g, ''));
  const r = await startTopup(db(), s.tid, {
    amountKes,
    phone: String(form.get('phone') ?? ''),
    trigger: 'manual',
    actor: s.uid,
  });
  revalidatePath('/settings');
  redirect(`/settings?sms=${r.ok ? 'topup-sent' : `topup-${r.reason}`}`);
}
