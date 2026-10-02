'use server';
import { withTenant } from '@lango/db';
import {
  type AnnouncementPreview,
  AUDIENCES,
  type Audience,
  can,
  msisdn,
  type NotifySettings,
  previewAnnouncement,
  queueAnnouncement,
} from '@lango/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

const hour = (v: FormDataEntryValue | null, d: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d;
};

export async function saveNotifications(form: FormData) {
  const s = await requireSession();
  if (!can(s, 'messages.manage')) redirect('/messages?m=forbidden');
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
  if (staffAlerts && !notifications.alertPhone) redirect('/messages?m=alert-phone');
  await withTenant(db(), s.tid, async (tx) => {
    await tx`insert into tenant_settings (tenant_id, data) values (${s.tid}, ${tx.json({ notifications } as never)})
             on conflict (tenant_id) do update set data = tenant_settings.data || excluded.data`;
    await tx`insert into audit_log (tenant_id, actor, action, data) values (${s.tid}, ${s.uid}, 'settings.notifications', ${tx.json(notifications as never)})`;
  });
  revalidatePath('/messages');
  revalidatePath('/settings');
  redirect('/messages?m=saved');
}

export type AnnounceState =
  | { step: 'edit'; error?: string; text?: string; audience?: Audience }
  | { step: 'confirm'; text: string; audience: Audience; preview: AnnouncementPreview }
  | { step: 'done'; queued: number };

const audienceOf = (v: FormDataEntryValue | null): Audience =>
  String(v) in AUDIENCES ? (String(v) as Audience) : 'current';

/** Step 1 shows who receives it and what it costs; step 2 (confirm) queues it. */
export async function announce(_prev: AnnounceState, form: FormData): Promise<AnnounceState> {
  const s = await requireSession();
  if (!can(s, 'messages.manage')) return { step: 'edit', error: 'Only the owner or a manager can send news.' };
  const text = String(form.get('text') ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  const audience = audienceOf(form.get('audience'));
  if (text.length < 5) return { step: 'edit', error: 'Write the message first.', text, audience };
  if (form.get('confirm') !== 'yes') {
    const preview = await previewAnnouncement(db(), s.tid, { audience, text });
    if (preview.recipients === 0)
      return { step: 'edit', error: 'No members with a phone number are in that group.', text, audience };
    return { step: 'confirm', text, audience, preview };
  }
  const r = await queueAnnouncement(db(), s.tid, { audience, text, actor: s.uid });
  if (!r.ok)
    return {
      step: 'edit',
      text,
      audience,
      error:
        r.reason === 'credit'
          ? `Not enough SMS credit: this needs ${r.need?.toLocaleString('en-KE')} SMS. Buy SMS in Settings first.`
          : r.reason === 'off'
            ? 'SMS is off for this club. Switch it on below first.'
            : 'No members with a phone number are in that group.',
    };
  revalidatePath('/messages');
  return { step: 'done', queued: r.queued };
}
