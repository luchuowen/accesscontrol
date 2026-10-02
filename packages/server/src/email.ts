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
 * One branded layout for account emails: a heading, short paragraphs, one button, and a quiet footer. Table
 * layout and inline styles so it renders in Gmail and Outlook; a plain-text twin is always sent.
 */
export function accountEmail(e: {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  after?: string[];
  footer?: string;
}): { html: string; text: string } {
  const p = (t: string) =>
    `<p style="margin:0 0 16px;font:15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#334155">${esc(t)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#F4F7FB;padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #E2E8F0;border-radius:14px">
<tr><td style="background:#0B1629;border-radius:14px 14px 0 0;padding:20px 28px">
<span style="display:inline-block;width:28px;height:28px;border-radius:7px;background:#10B981;vertical-align:middle"></span>
<span style="font:600 17px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#ffffff;vertical-align:middle;margin-left:10px">Lango</span></td></tr>
<tr><td style="padding:32px 28px 12px">
<h1 style="margin:0 0 16px;font:600 22px/1.3 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0F1729">${esc(e.heading)}</h1>
${e.paragraphs.map(p).join('')}
${
  e.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="background:#132038;border-radius:10px">
<a href="${esc(e.button.url)}" style="display:inline-block;padding:13px 22px;font:600 15px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none">${esc(e.button.label)}</a></td></tr></table>
<p style="margin:0 0 16px;font:13px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#64748B">If the button does not work, open this link: <br><a href="${esc(e.button.url)}" style="color:#2563EB;word-break:break-all">${esc(e.button.url)}</a></p>`
    : ''
}
${(e.after ?? []).map(p).join('')}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #EEF1F5;font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#94A3B8">
${esc(e.footer ?? 'Lango by NAVAC Global · Nairobi')}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    e.heading,
    '',
    ...e.paragraphs,
    ...(e.button ? ['', `${e.button.label}: ${e.button.url}`] : []),
    ...(e.after?.length ? ['', ...e.after] : []),
    '',
    e.footer ?? 'Lango by NAVAC Global · Nairobi',
  ].join('\n');
  return { html, text };
}
