import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Sql } from '@lango/db';
import { decrypt } from './crypto.js';

/** Resend (api.resend.com): NAVAC's email account. One platform key; every send is logged in email_messages. */
const BASE = 'https://api.resend.com';
const TIMEOUT_MS = 15_000;

export interface PlatformEmail {
  apiKey: string; // encrypted
  from: string; // e.g. "Lango <lango@navac.co.ke>"
  replyTo?: string;
  webhookSecret?: string; // encrypted, "whsec_…"
}

export class ResendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class Resend {
  constructor(
    private apiKey: string,
    private f: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const r = await this.f(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await r.text();
    let j: unknown = null;
    try {
      j = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    if (!r.ok) {
      const msg = (j as { message?: string } | null)?.message ?? `HTTP ${r.status}`;
      throw new ResendError(msg, r.status);
    }
    return j as T;
  }

  send(m: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
    idempotencyKey?: string;
    tags?: { name: string; value: string }[];
  }) {
    return this.call<{ id: string }>(
      'POST',
      '/emails',
      {
        from: m.from,
        to: [m.to],
        subject: m.subject,
        html: m.html,
        text: m.text,
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        ...(m.tags ? { tags: m.tags } : {}),
      },
      m.idempotencyKey ? { 'Idempotency-Key': m.idempotencyKey.slice(0, 256) } : {},
    );
  }

  /**
   * Domains on the account and whether Resend has verified them. A sending-only key may not list domains
   * (403/401 restricted); the caller then accepts the key and relies on the first test send.
   */
  async domains(): Promise<{ name: string; status: string }[] | null> {
    try {
      const j = await this.call<{ data?: { name: string; status: string }[] }>('GET', '/domains');
      return (j.data ?? []).map((d) => ({ name: d.name, status: d.status }));
    } catch (e) {
      if (e instanceof ResendError && (e.status === 401 || e.status === 403)) {
        if (/restricted|only send/i.test(e.message)) return null;
        throw e;
      }
      throw e;
    }
  }
}

export async function platformEmailConfig(sql: Sql): Promise<PlatformEmail | null> {
  const [row] = await sql<{ data: PlatformEmail | null }[]>`select app_platform_get('email') as data`;
  return row?.data?.apiKey && row.data.from ? row.data : null;
}

/**
 * Send one email and record its real outcome. Never throws: returns false (and logs why) when email is not set
 * up or Resend refuses. The idempotency key stops a retried request sending the same email twice.
 */
export async function sendEmail(
  sql: Sql,
  m: {
    to: string;
    subject: string;
    html: string;
    text: string;
    kind: string;
    key: string;
    tenantId?: string;
    replyTo?: string;
  },
  client?: Resend | null,
): Promise<boolean> {
  const cfg = await platformEmailConfig(sql);
  const [row] = await sql<{ id: string; status: string }[]>`
    insert into email_messages (tenant_id, to_email, subject, kind, idempotency_key, status)
    values (${m.tenantId ?? null}, ${m.to}, ${m.subject}, ${m.kind}, ${m.key}, 'queued')
    on conflict (idempotency_key) do update set updated_at = now()
    returning id, status`;
  if (!row) return false;
  if (row.status !== 'queued' && row.status !== 'failed') return true; // already sent once
  if (!cfg) {
    await sql`update email_messages set status = 'skipped', error = 'email is not set up', updated_at = now() where id = ${row.id}`;
    return false;
  }
  const resend = client ?? new Resend(decrypt(cfg.apiKey));
  try {
    const r = await resend.send({
      from: cfg.from,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      replyTo: m.replyTo ?? cfg.replyTo,
      idempotencyKey: m.key,
      tags: [{ name: 'kind', value: m.kind.replace(/[^A-Za-z0-9_-]/g, '_') }],
    });
    await sql`update email_messages set status = 'sent', provider_id = ${r.id}, error = null, updated_at = now() where id = ${row.id}`;
    return true;
  } catch (e) {
    await sql`update email_messages set status = 'failed', error = ${String((e as Error).message).slice(0, 300)}, updated_at = now() where id = ${row.id}`;
    return false;
  }
}

/**
 * Resend signs webhooks with Svix: signature = base64(HMAC-SHA256(secret, "<id>.<timestamp>.<raw body>")), the
 * secret being the base64 part after "whsec_". Several signatures may be sent ("v1,<sig> v1,<sig>"). Events
 * older than 5 minutes are refused (replay protection).
 */
export function verifySvix(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const want = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

const STATUS: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

/** Apply a verified Resend event to the delivery log. Returns true when a message was updated. */
export async function applyResendEvent(sql: Sql, event: { type?: string; data?: { email_id?: string } }) {
  const status = event.type ? STATUS[event.type] : undefined;
  const id = event.data?.email_id;
  if (!status || !id) return false;
  const r = await sql`update email_messages set status = ${status}, updated_at = now()
                      where provider_id = ${id} and status <> ${status} returning id`;
  return r.length > 0;
}

// ---------- templates ----------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * Lango's one email layout ("Editorial", approved 2 Oct 2026): a navy header with an optional eyebrow, the
 * heading and an optional large amount; the body; one button; a shaded, centred footer. Tables and inline
 * styles so it renders in Gmail and Outlook; a plain-text twin is always sent.
 */
export function accountEmail(e: {
  heading: string;
  eyebrow?: string;
  amount?: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  after?: string[];
  footer?: string[];
}): { html: string; text: string } {
  const font = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
  const p = (t: string) =>
    `<p style="margin:0 0 16px;font:15px/1.65 ${font};color:#3C4657">${esc(t).replace(/^Please note:/, '<b>Please note:</b>')}</p>`;
  const small = (t: string) =>
    `<p style="margin:0 0 12px;font:13px/1.6 ${font};color:#6B7586">${esc(t).replace(/^Please note:/, '<b style="color:#3C4657">Please note:</b>')}</p>`;
  const foot = e.footer ?? DEFAULT_FOOTER;
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  // Gmail does not show SVG, so the mark is a hosted PNG; without a public address a plain emerald tile stands in.
  const logo = base
    ? `<img src="${esc(base)}/brand/lango-mark.png" width="30" height="30" alt="Lango" style="display:block;border:0;border-radius:8px">`
    : '<div style="width:30px;height:30px;background:#10B981;border-radius:8px"></div>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#F5F6F8;padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E6E9EE;border-radius:16px;border-collapse:separate;overflow:hidden">
<tr><td style="background:#0B1629;border-radius:16px 16px 0 0;padding:32px 36px 36px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:30px;height:30px">${logo}</td>
<td style="padding-left:10px;font:600 16px ${font};color:#FFFFFF">Lango</td></tr></table>
<div style="height:32px;line-height:32px">&nbsp;</div>
${e.eyebrow ? `<div style="font:600 11px ${font};letter-spacing:2px;color:#34D399;margin-bottom:10px">${esc(e.eyebrow.toUpperCase())}</div>` : ''}
<h1 style="margin:0;font:600 27px/1.25 ${font};color:#FFFFFF">${esc(e.heading)}</h1>
${e.amount ? `<div style="margin-top:14px;font:600 36px ${font};color:#FFFFFF">${esc(e.amount)}</div>` : ''}
</td></tr>
<tr><td style="padding:30px 36px 10px">
${e.paragraphs.map(p).join('')}
${
  e.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 24px"><tr><td style="background:#0B1629;border-radius:10px">
<a href="${esc(e.button.url)}" style="display:inline-block;padding:13px 24px;font:600 15px ${font};color:#FFFFFF;text-decoration:none">${esc(e.button.label)} &rarr;</a></td></tr></table>`
    : ''
}
${(e.after ?? []).filter(Boolean).map(small).join('')}
${e.button ? small(`If the button does not work, copy this link into your browser: ${e.button.url}`) : ''}
</td></tr>
<tr><td align="center" style="background:#F3F5F8;border-top:1px solid #E6E9EE;border-radius:0 0 16px 16px;padding:22px 36px 26px;font:12.5px/1.6 ${font};color:#6B7586;text-align:center">
${foot.map(esc).join('<br>').replace('support@navac.co.ke', '<a href="mailto:support@navac.co.ke" style="color:#2563EB">support@navac.co.ke</a>')}
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    e.heading,
    ...(e.amount ? [e.amount] : []),
    '',
    ...e.paragraphs,
    ...(e.button ? ['', `${e.button.label}: ${e.button.url}`] : []),
    ...(e.after?.filter(Boolean).length ? ['', ...(e.after?.filter(Boolean) ?? [])] : []),
    '',
    ...foot,
  ].join('\n');
  return { html, text };
}

export const DEFAULT_FOOTER = [
  'Sent by Lango, a NAVAC Global service · Nairobi, Kenya',
  'You’re receiving this email because you have a Lango account. For assistance, contact support@navac.co.ke.',
];
