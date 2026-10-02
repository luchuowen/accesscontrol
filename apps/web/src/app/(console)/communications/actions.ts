'use server';
import { withTenant } from '@lango/db';
import {
  type AnnouncementPreview,
  AUDIENCES,
  type Audience,
  type CommChannel,
  can,
  normaliseAddress,
  openConversation,
  previewAnnouncement,
  queueAnnouncement,
  ReplyError,
  sendReply,
} from '@lango/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { db } from '@/server/db';

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
  revalidatePath('/communications');
  return { step: 'done', queued: r.queued };
}

// ---------- inbox ----------

const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function inboxSession() {
  const s = await requireSession();
  if (!can(s, 'inbox.reply')) redirect('/communications?m=forbidden');
  return s;
}

export type ReplyState = { error?: string; sent?: number };

/** Send a reply on the conversation's channel; the thread refreshes with it. */
export async function reply(_prev: ReplyState, form: FormData): Promise<ReplyState> {
  const s = await inboxSession();
  const id = String(form.get('conversationId') ?? '');
  if (!UUIDRE.test(id)) return { error: 'That conversation is no longer here.' };
  try {
    await sendReply(db(), s.tid, id, {
      body: String(form.get('body') ?? ''),
      subject: String(form.get('subject') ?? ''),
      staffName: s.name,
    });
  } catch (e) {
    revalidatePath('/communications'); // a failed message is kept in the thread, with the reason
    return { error: e instanceof ReplyError ? e.message : 'Something went wrong. Try again.' };
  }
  revalidatePath('/communications');
  return { sent: Date.now() };
}

/** Done / reopen. */
export async function setDone(form: FormData) {
  const s = await inboxSession();
  const id = String(form.get('conversationId') ?? '');
  if (!UUIDRE.test(id)) return;
  const done = form.get('done') === '1';
  await withTenant(db(), s.tid, async (tx) => {
    await tx`update conversations set status = ${done ? 'done' : 'open'}, unread = 0 where id = ${id}`;
  });
  revalidatePath('/communications');
}

export interface Person {
  id: string;
  name: string;
  no: number;
  phone: string | null;
  email: string | null;
}

/** Members for "New message": name, member number or phone. */
export async function findPeople(q: string): Promise<Person[]> {
  const s = await requireSession();
  if (!can(s, 'inbox.reply')) return [];
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const digits = t.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, '');
  return withTenant(
    db(),
    s.tid,
    (tx) => tx<Person[]>`
      select id, first_name || ' ' || last_name as name, member_no as no, phone, email from members
      where status <> 'archived' and member_no not between 11001 and 11999
        and (lower(first_name || ' ' || last_name) like ${`%${t}%`} or member_no::text = ${t}
             or (${digits} <> '' and length(${digits}) >= 4
                 and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like ${`%${digits}%`}))
      order by first_name limit 8`,
  );
}

/** "New message": to a member or any phone / email, on the chosen channel. Opens the conversation. */
export async function startConversation(form: FormData) {
  const s = await inboxSession();
  const ch = String(form.get('channel') ?? '') as CommChannel;
  if (!['sms', 'whatsapp', 'email'].includes(ch)) redirect('/communications?m=channel');
  const memberId = String(form.get('memberId') ?? '');
  let raw = String(form.get('address') ?? '');
  let name: string | null = String(form.get('name') ?? '').trim() || null;
  if (UUIDRE.test(memberId)) {
    const [m] = await withTenant(
      db(),
      s.tid,
      (tx) => tx<{ phone: string | null; email: string | null; name: string }[]>`
        select phone, email, first_name || ' ' || last_name as name from members where id = ${memberId}`,
    );
    raw = (ch === 'email' ? m?.email : m?.phone) ?? '';
    name = m?.name ?? name;
  }
  const address = normaliseAddress(ch, raw);
  if (!address) redirect(`/communications?m=${ch === 'email' ? 'no-email' : 'no-phone'}`);
  const id = await withTenant(db(), s.tid, (tx) => openConversation(tx, s.tid, ch, address, name));
  redirect(`/communications?c=${id}`);
}
