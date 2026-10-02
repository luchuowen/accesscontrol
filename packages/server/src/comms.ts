import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Sql } from '@lango/db';
import { withTenant } from '@lango/db';
import { decrypt } from './crypto.js';
import { platformEmailConfig, sendEmail } from './email.js';
import { msisdn, sendNow } from './sms.js';

/**
 * Communications: one inbox per club for SMS, WhatsApp and email (design from NAVAC CRM, 2 Oct 2026).
 * - SMS goes out through Source Code from the club's SMS credit; Source Code has no replies, so SMS is send-only.
 * - WhatsApp uses the club's own WhatsApp Business number (Meta Cloud API), connected in the partner console.
 * - Email goes out from NAVAC's Resend account under the club's name; replies come back to <club code>@<inbound
 *   domain> when NAVAC has set up receiving.
 */
type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];
export type CommChannel = 'sms' | 'whatsapp' | 'email';
export const COMM_CHANNELS: CommChannel[] = ['sms', 'whatsapp', 'email'];

export interface WhatsAppConfig {
  phoneNumberId: string;
  displayPhone?: string;
}
export interface WhatsAppSecret {
  accessToken: string;
  appSecret: string;
}

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Meta signs every webhook: X-Hub-Signature-256 = "sha256=" + hex HMAC-SHA256(app secret, raw body). */
export function verifyMeta(appSecret: string, raw: string, header: string | null): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const want = createHmac('sha256', appSecret).update(raw, 'utf8').digest();
  const got = Buffer.from(header.slice(7), 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface MetaInbound {
  from: string;
  name: string | null;
  id: string;
  body: string;
  at: Date;
}
export interface MetaStatus {
  id: string;
  status: string;
  error: string | null;
}

/** Text (and a short note for anything else) from a WhatsApp Cloud API webhook, plus delivery updates. */
export function parseMeta(payload: unknown): { messages: MetaInbound[]; statuses: MetaStatus[] } {
  const messages: MetaInbound[] = [];
  const statuses: MetaStatus[] = [];
  type V = {
    contacts?: { wa_id?: string; profile?: { name?: string } }[];
    messages?: {
      from?: string;
      id?: string;
      timestamp?: string;
      type?: string;
      text?: { body?: string };
      button?: { text?: string };
      interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
      image?: { caption?: string };
      document?: { filename?: string; caption?: string };
      location?: { name?: string; address?: string };
    }[];
    statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[];
  };
  const entries = (payload as { entry?: { changes?: { value?: V }[] }[] })?.entry ?? [];
  for (const e of entries)
    for (const c of e.changes ?? []) {
      const v = c.value ?? {};
      const names = new Map((v.contacts ?? []).map((x) => [x.wa_id ?? '', x.profile?.name ?? null]));
      for (const m of v.messages ?? []) {
        if (!m.from || !m.id) continue;
        const body =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          (m.type === 'image'
            ? `📷 Photo${m.image?.caption ? `: ${m.image.caption}` : ''}`
            : m.type === 'document'
              ? `📄 ${m.document?.filename ?? 'Document'}${m.document?.caption ? `: ${m.document.caption}` : ''}`
              : m.type === 'location'
                ? `📍 ${m.location?.name ?? m.location?.address ?? 'Location'}`
                : m.type === 'audio'
                  ? '🎤 Voice note (open WhatsApp on the club phone to listen)'
                  : `(${m.type ?? 'message'} — open WhatsApp on the club phone to see it)`);
        messages.push({
          from: m.from,
          name: names.get(m.from) ?? null,
          id: m.id,
          body: body.slice(0, 4000),
          at: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
        });
      }
      for (const s of v.statuses ?? []) {
        if (!s.id || !s.status) continue;
        const err = s.errors?.[0];
        statuses.push({ id: s.id, status: s.status, error: err ? (err.message ?? err.title ?? 'failed') : null });
      }
    }
  return { messages, statuses };
}

/** The member with this phone (any format) or email, if there is one. */
export async function matchMember(tx: Tx, channel: CommChannel, address: string) {
  if (channel === 'email') {
    const [m] = await tx<{ id: string; name: string }[]>`
      select id, first_name || ' ' || last_name as name from members where lower(email) = ${address} limit 1`;
    return m ?? null;
  }
  const local = address.replace(/^254/, '');
  const [m] = await tx<{ id: string; name: string }[]>`
    select id, first_name || ' ' || last_name as name from members
    where regexp_replace(coalesce(phone, ''), '\\D', '', 'g') in (${address}, ${`0${local}`}, ${local})
    order by member_no not between 11001 and 11999 desc limit 1`;
  return m ?? null;
}

/** The conversation with this address on this channel, made on first contact and linked to the member. */
export async function openConversation(
  tx: Tx,
  tenantId: string,
  channel: CommChannel,
  address: string,
  name?: string | null,
): Promise<string> {
  const member = await matchMember(tx, channel, address);
  const [c] = await tx<{ id: string }[]>`
    insert into conversations (tenant_id, channel, address, name, member_id)
    values (${tenantId}, ${channel}, ${address}, ${member?.name ?? name ?? null}, ${member?.id ?? null})
    on conflict (tenant_id, channel, address) do update set
      member_id = coalesce(conversations.member_id, excluded.member_id),
      name = coalesce(conversations.name, excluded.name)
    returning id`;
  return c?.id as string;
}

/** WhatsApp messages and delivery updates for one club. Each message is stored once (Meta may resend). */
export async function receiveWhatsApp(sql: Sql, tenantId: string, p: ReturnType<typeof parseMeta>) {
  return withTenant(sql, tenantId, async (tx) => {
    let n = 0;
    for (const m of p.messages) {
      const address = msisdn(m.from) ?? m.from;
      const conv = await openConversation(tx, tenantId, 'whatsapp', address, m.name);
      const r = await tx`
        insert into comm_messages (tenant_id, conversation_id, direction, body, status, provider_ref, created_at)
        values (${tenantId}, ${conv}, 'in', ${m.body}, 'received', ${m.id}, ${m.at})
        on conflict do nothing returning id`;
      if (r.length) {
        n++;
        await tx`update conversations set unread = unread + 1, status = 'open', last_at = greatest(last_at, ${m.at}),
                 last_in_at = greatest(coalesce(last_in_at, ${m.at}), ${m.at}) where id = ${conv}`;
      }
    }
    const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
    for (const s of p.statuses) {
      if (s.status === 'failed')
        await tx`update comm_messages set status = 'failed', error = ${s.error} where provider_ref = ${s.id}`;
      else if (rank[s.status])
        await tx`update comm_messages set status = ${s.status} where provider_ref = ${s.id} and direction = 'out'
                 and status <> 'failed' and coalesce(array_position(array['queued','sent','delivered','read'], status), 0)
                     < array_position(array['queued','sent','delivered','read'], ${s.status}::text)`;
    }
    return n;
  });
}

/** "Name <a@b.c>" or "a@b.c" → { email, name }. */
export function parseAddress(v: string): { email: string; name: string | null } | null {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(v) ?? null;
  const email = (m?.[2] ?? v).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return { email, name: m?.[1]?.trim() || null };
}

/** The new part of an email reply: stops at the quoted earlier message. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const l of lines) {
    if (/^On .+wrote:\s*$/i.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^From: .+/i.test(l)) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').trim() || text.trim();
}

/**
 * An email received by Resend for <club code>@<inbound domain>. The webhook carries no text, so it is read back
 * from Resend with the inbound key (receiving needs a full-access key; NAVAC's sending key stays sending-only).
 */
export async function receiveEmail(
  sql: Sql,
  data: { email_id?: string; from?: string; to?: string[]; received_for?: string[]; subject?: string },
  f: typeof fetch = fetch,
): Promise<boolean> {
  const cfg = await platformEmailConfig(sql);
  const domain = cfg?.inboundDomain?.toLowerCase();
  if (!domain || !data.email_id || !data.from) return false;
  const slug = [...(data.received_for ?? []), ...(data.to ?? [])]
    .map((a) => parseAddress(a)?.email ?? '')
    .find((a) => a.endsWith(`@${domain}`))
    ?.split('@')[0]
    ?.split('+')[0];
  if (!slug) return false;
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = ${slug}`;
  const from = parseAddress(data.from);
  if (!t || !from) return false;
  const [ch] = await withTenant(
    sql,
    t.id,
    (tx) => tx<{ enabled: boolean }[]>`select enabled from comm_channels where channel = 'email'`,
  );
  if (!ch?.enabled) return false;
  let body = '';
  if (cfg?.inboundKey) {
    try {
      const r = await f(`https://api.resend.com/emails/receiving/${encodeURIComponent(data.email_id)}`, {
        headers: { Authorization: `Bearer ${decrypt(cfg.inboundKey)}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) {
        const j = (await r.json()) as { text?: string | null; html?: string | null };
        body =
          j.text ??
          (j.html ?? '')
            .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&');
      }
    } catch {
      /* keep the subject only */
    }
  }
  body = stripQuoted(body).slice(0, 20_000) || '(No text. Open the email in Resend to see it.)';
  await withTenant(sql, t.id, async (tx) => {
    const conv = await openConversation(tx, t.id, 'email', from.email, from.name);
    const r = await tx`
      insert into comm_messages (tenant_id, conversation_id, direction, body, subject, status, provider_ref)
      values (${t.id}, ${conv}, 'in', ${body}, ${(data.subject ?? '').slice(0, 300)}, 'received', ${`resend:${data.email_id}`})
      on conflict do nothing returning id`;
    if (r.length)
      await tx`update conversations set unread = unread + 1, status = 'open', last_at = now(), last_in_at = now()
               where id = ${conv}`;
  });
  return true;
}

export class ReplyError extends Error {}

const escHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * Send a staff reply on the conversation's channel. Throws ReplyError with a sentence for the person replying.
 * WhatsApp only allows free text within 24 hours of the customer's last message (Meta's rule).
 */
export async function sendReply(
  sql: Sql,
  tenantId: string,
  conversationId: string,
  m: { body: string; subject?: string; staffName: string },
  f: typeof fetch = fetch,
): Promise<void> {
  const body = m.body.trim().slice(0, 4000);
  if (!body) throw new ReplyError('Type a message first.');
  const ctx = await withTenant(sql, tenantId, async (tx) => {
    const [c] = await tx<
      {
        channel: CommChannel;
        address: string;
        member_id: string | null;
        last_in_at: Date | null;
        club: string;
        slug: string;
      }[]
    >`select c.channel, c.address, c.member_id, c.last_in_at, t.name as club, t.slug
      from conversations c join tenants t on t.id = c.tenant_id where c.id = ${conversationId}`;
    const [ch] = c
      ? await tx<{ enabled: boolean; config: WhatsAppConfig; secret: string | null }[]>`
          select enabled, config, secret from comm_channels where channel = ${c.channel}`
      : [];
    return c ? { c, ch } : null;
  });
  if (!ctx) throw new ReplyError('That conversation is no longer here.');
  const { c, ch } = ctx;
  if (c.channel === 'sms') {
    const ok = await sendNow(sql, tenantId, {
      phone: c.address,
      body,
      kind: 'chat',
      memberId: c.member_id ?? undefined,
      conversationId,
      staffName: m.staffName,
    });
    if (!ok)
      throw new ReplyError('The SMS was not sent: SMS is off for the club, or there is no SMS credit. See Settings.');
  } else if (c.channel === 'whatsapp') {
    if (!ch?.enabled || !ch.secret) throw new ReplyError('WhatsApp is not connected for this club.');
    if (!c.last_in_at || Date.now() - c.last_in_at.getTime() > 24 * 3600_000)
      throw new ReplyError(
        'WhatsApp only allows replies within 24 hours of their last message. Send an SMS instead, or wait for them to write.',
      );
    const sec = JSON.parse(decrypt(ch.secret)) as WhatsAppSecret;
    let ref: string | null = null;
    let err: string | null = null;
    try {
      const r = await f(`${GRAPH}/${encodeURIComponent(ch.config.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sec.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: c.address, type: 'text', text: { body } }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
      ref = j.messages?.[0]?.id ?? null;
      if (!r.ok || !ref) err = j.error?.message ?? `WhatsApp answered ${r.status}`;
    } catch (e) {
      err = (e as Error).message;
    }
    await withTenant(sql, tenantId, async (tx) => {
      await tx`insert into comm_messages (tenant_id, conversation_id, direction, body, status, provider_ref, error, staff_name)
               values (${tenantId}, ${conversationId}, 'out', ${body}, ${err ? 'failed' : 'sent'}, ${ref}, ${err}, ${m.staffName})`;
    });
    if (err) throw new ReplyError(`WhatsApp did not take the message: ${err}`);
  } else {
    if (!ch?.enabled) throw new ReplyError('Email is not switched on for this club.');
    const cfg = await platformEmailConfig(sql);
    if (!cfg) throw new ReplyError('Email is not set up on the platform yet.');
    const subject = (m.subject?.trim() || `Message from ${c.club}`).slice(0, 200);
    const replyTo = cfg.inboundDomain ? `${c.slug}@${cfg.inboundDomain}` : undefined;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.55;color:#0f172a">${escHtml(body).replace(/\n/g, '<br>')}<p style="margin-top:20px;color:#64748b;font-size:12px">${escHtml(m.staffName)} · ${escHtml(c.club)}</p></div>`;
    const key = `chat:${conversationId}:${Date.now()}`;
    const ok = await sendEmail(sql, {
      to: c.address,
      subject,
      html,
      text: `${body}\n\n${m.staffName} · ${c.club}`,
      kind: 'chat',
      key,
      tenantId,
      replyTo,
      fromName: c.club,
    });
    await withTenant(sql, tenantId, async (tx) => {
      await tx`insert into comm_messages (tenant_id, conversation_id, direction, body, subject, status, error, staff_name)
               values (${tenantId}, ${conversationId}, 'out', ${body}, ${subject}, ${ok ? 'sent' : 'failed'},
                       ${ok ? null : 'Resend did not accept the email'}, ${m.staffName})`;
    });
    if (!ok) throw new ReplyError('The email was not sent. Try again in a minute.');
  }
  await withTenant(sql, tenantId, async (tx) => {
    await tx`update conversations set last_at = now(), unread = 0 where id = ${conversationId}`;
  });
}

/** Address for a new conversation: a Kenyan mobile (SMS, WhatsApp) or an email address. */
export function normaliseAddress(channel: CommChannel, raw: string): string | null {
  return channel === 'email' ? (parseAddress(raw)?.email ?? null) : msisdn(raw);
}

/** Ask Meta whether this access token can use this phone number; returns the number as Meta shows it. */
export async function checkWhatsApp(
  phoneNumberId: string,
  accessToken: string,
  f: typeof fetch = fetch,
): Promise<{ ok: true; display: string; name: string | null } | { ok: false; error: string }> {
  try {
    const r = await f(`${GRAPH}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json().catch(() => ({}))) as {
      display_phone_number?: string;
      verified_name?: string;
      error?: { message?: string };
    };
    if (!r.ok || !j.display_phone_number) return { ok: false, error: j.error?.message ?? `Meta answered ${r.status}` };
    return { ok: true, display: j.display_phone_number, name: j.verified_name ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
