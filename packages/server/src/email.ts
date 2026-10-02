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
      replyTo: m.replyTo ?? cfg.replyTo ?? 'support@navac.co.ke',
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
 * Lango's one email layout (Editorial, final version approved 2 Oct 2026): a centred navy header with a subtle
 * gradient (plain navy where gradients are not shown, e.g. Outlook), the logo, an eyebrow and the heading; a white
 * body with a centred button; a centred note; a hairline fact line; and a plain white footer below the card. Type
 * is the reader's own system font, kept small. Tables and inline styles so it renders in Gmail and Outlook; a
 * plain-text twin is always sent. In any string, **text** is shown bold (and plain in the text twin).
 */
export function accountEmail(e: {
  heading: string;
  eyebrow?: string;
  amount?: string;
  /** a one-time code shown large in its own box */
  code?: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  /** small centred lines under the button; the last one sits under a hairline as the fact line */
  after?: string[];
  footer?: string[];
}): { html: string; text: string } {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
  const mono = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
  const rich = (t: string, strong = '#3B4556') =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, `<b style="color:${strong};font-weight:600">$1</b>`)
      .replace(/^Please note:/, `<b style="color:${strong};font-weight:600">Please note:</b>`);
  const plain = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1');
  const para = (t: string, i: number) =>
    `<p style="margin:0 0 14px;font:${i === 0 && /^Hi\b/.test(t) ? 500 : 400} 14px/1.65 ${font};color:${i === 0 && /^Hi\b/.test(t) ? '#0B0F19' : '#3B4556'}">${rich(t, '#0B0F19')}</p>`;
  const after = (e.after ?? []).filter(Boolean);
  const notes = after.slice(0, after.length > 1 ? -1 : after.length);
  const fact = after.length > 1 ? after[after.length - 1] : undefined;
  const foot = e.footer ?? DEFAULT_FOOTER;
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  // Gmail does not show SVG, so the mark is a hosted PNG; without a public address a plain emerald tile stands in.
  const logo = base
    ? `<img src="${esc(base)}/brand/lango-mark.png" width="26" height="26" alt="" style="display:block;border:0;border-radius:7px">`
    : '<div style="width:26px;height:26px;background:#10B981;border-radius:7px"></div>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;background:#FFFFFF;padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border:1px solid #E5E8EE;border-radius:16px;border-collapse:separate;overflow:hidden">
<tr><td align="center" bgcolor="#0B1629" style="background-color:#0B1629;background-image:linear-gradient(135deg,#0B1629 0%,#11284A 58%,#0E3A33 100%);border-radius:16px 16px 0 0;padding:34px 28px 0;text-align:center">
<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
<td style="width:26px;height:26px">${logo}</td>
<td style="padding-left:8px;font:600 15px ${font};color:#FFFFFF">Lango</td></tr></table>
<div style="height:24px;line-height:24px">&nbsp;</div>
${e.eyebrow ? `<div style="font:600 11px ${font};letter-spacing:2px;color:#34D399;margin-bottom:8px">${esc(e.eyebrow.toUpperCase())}</div>` : ''}
<h1 style="margin:0;font:650 22px/1.3 ${font};color:#FFFFFF;letter-spacing:-0.2px">${esc(e.heading)}</h1>
${e.amount ? `<div style="margin-top:12px;font:650 30px ${font};color:#FFFFFF">${esc(e.amount)}</div>` : ''}
<div style="height:30px;line-height:30px">&nbsp;</div>
<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td style="width:64px;height:3px;background:#10B981;border-radius:3px 3px 0 0;font-size:0;line-height:0">&nbsp;</td></tr></table>
</td></tr>
<tr><td style="padding:30px 34px 28px">
${e.paragraphs.map(para).join('')}
${
  e.code
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:20px auto 16px"><tr><td style="border:1px solid #E5E8EE;background:#F8FAF9;border-radius:12px;padding:14px 18px 14px 26px;font:600 28px ${mono};letter-spacing:9px;color:#0B0F19">${esc(e.code)}</td></tr></table>`
    : ''
}
${
  e.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 20px"><tr><td align="center" bgcolor="#0B1629" style="background:#0B1629;border-radius:10px">
<a href="${esc(e.button.url)}" style="display:inline-block;padding:13px 28px;font:600 14px ${font};color:#FFFFFF;text-decoration:none">${esc(e.button.label)}</a></td></tr></table>`
    : ''
}
${notes.map((t) => `<p style="margin:0 0 6px;font:12.5px/1.6 ${font};color:#6B7586;text-align:center">${rich(t)}</p>`).join('')}
${fact ? `<div style="border-top:1px solid #EEF0F4;margin-top:20px;padding-top:16px;font:12.5px/1.6 ${font};color:#6B7586;text-align:center">${rich(fact)}</div>` : ''}
${
  e.button
    ? `<p style="margin:14px 0 0;font:11.5px/1.6 ${font};color:#8A93A3;text-align:center;word-break:break-all">Button not working? Paste this link into your browser:<br><a href="${esc(e.button.url)}" style="color:#0E9F6E">${esc(e.button.url)}</a></p>`
    : ''
}
</td></tr></table>
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%"><tr><td align="center" style="padding:22px 28px 6px;font:11.5px/1.7 ${font};color:#8A93A3;text-align:center">
<div style="color:#5B6680;font-weight:600;letter-spacing:0.2px">${esc(foot[0] ?? '')}</div>
${foot.slice(1).map(esc).join('<br>').replace('support@navac.co.ke', '<a href="mailto:support@navac.co.ke" style="color:#0E9F6E;text-decoration:none">support@navac.co.ke</a>')}
</td></tr></table>
</td></tr></table></body></html>`;
  const text = [
    e.heading,
    ...(e.amount ? [e.amount] : []),
    '',
    ...e.paragraphs.map(plain),
    ...(e.code ? ['', e.code] : []),
    ...(e.button ? ['', `${e.button.label}: ${e.button.url}`] : []),
    ...(after.length ? ['', ...after.map(plain)] : []),
    '',
    ...foot,
  ].join('\n');
  return { html, text };
}

export const DEFAULT_FOOTER = [
  'Lango · a NAVAC Global service · Nairobi, Kenya',
  'You’re receiving this email because you have a Lango account.',
  'Need help? support@navac.co.ke',
];
