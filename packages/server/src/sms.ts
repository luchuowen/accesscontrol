import type { Sql, Tx } from '@lango/db';
import { withTenant } from '@lango/db';
import { DateTime } from 'luxon';
import { decrypt } from './crypto.js';

/** Source Code bulk SMS (api.sourcecode.co.ke). One platform account; the sender ID (e.g. NAVAC) is per platform. */
const BASE = 'https://api.sourcecode.co.ke/sms';
const TIMEOUT_MS = 15_000;

export interface SmsResult {
  ok: boolean;
  code: string;
  desc: string;
  messageId?: string;
  /** false for errors a retry cannot fix (bad number, bad sender, bad key, no credit) */
  retry: boolean;
}

/** Kenyan mobile → 2547XXXXXXXX / 2541XXXXXXXX, or null when it is not a mobile number. */
export function msisdn(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  const n = d.startsWith('254') ? d : d.startsWith('0') ? `254${d.slice(1)}` : d.length === 9 ? `254${d}` : d;
  return /^254[17]\d{8}$/.test(n) ? n : null;
}

const FINAL = new Set(['1001', '1002', '1003', '1004', '1006', '1011']);

export class SourceCodeSms {
  constructor(
    private apiKey: string,
    private sender: string,
    private f: typeof fetch = fetch,
  ) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const r = await this.f(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Source Code answered HTTP ${r.status} without JSON`);
    }
  }

  async send(mobile: string, message: string): Promise<SmsResult> {
    const j = (await this.post('sendsms', {
      api_key: this.apiKey,
      service_id: 0,
      mobile,
      response_type: 'json',
      shortcode: this.sender,
      message,
    })) as Record<string, unknown> | Record<string, unknown>[];
    const r = (Array.isArray(j) ? j[0] : j) ?? {};
    const code = String(r.status_code ?? r.response_code ?? '0');
    const ok = code === '1000' || code === '1';
    return {
      ok,
      code,
      desc: String(r.status_desc ?? r.response_description ?? ''),
      ...(r.message_id != null ? { messageId: String(r.message_id) } : {}),
      retry: !ok && !FINAL.has(code),
    };
  }

  /** Proves the key works and returns the prepaid balance (SMS units). */
  async profile(): Promise<{ ok: boolean; balance: string | null; company: string | null; desc: string }> {
    const j = (await this.post('profile', { api_key: this.apiKey })) as
      | Record<string, unknown>
      | Record<string, unknown>[];
    const r = ((Array.isArray(j) ? j[0] : j) ?? {}) as Record<string, Record<string, unknown> | string | undefined>;
    const ok = String(r.status_code) === '1000' || String(r.status_code) === '1';
    const wallet = r.wallet as Record<string, unknown> | undefined;
    const partner = r.partner as Record<string, unknown> | undefined;
    return {
      ok,
      balance: wallet?.credit_balance != null ? String(wallet.credit_balance) : null,
      company: partner?.company != null ? String(partner.company) : null,
      desc: String(r.status_desc ?? ''),
    };
  }
}

export interface PlatformSms {
  apiKey: string; // encrypted
  sender: string;
}

export async function platformSms(sql: Sql): Promise<SourceCodeSms | null> {
  const [row] = await sql<{ data: PlatformSms | null }[]>`select app_platform_get('sms') as data`;
  if (!row?.data?.apiKey) return null;
  return new SourceCodeSms(decrypt(row.data.apiKey), row.data.sender || 'NAVAC');
}

/** Per-club notification switches (Settings → SMS). Off until the club turns SMS on. */
export interface NotifySettings {
  enabled?: boolean;
  receipts?: boolean;
  reminders?: boolean;
  reminderDays?: number;
  welcome?: boolean;
}

export const clubNotify = async (tx: Tx, tenantId: string): Promise<NotifySettings> => {
  const [s] = await tx<{ n: NotifySettings | null }[]>`
    select data->'notifications' as n from tenant_settings where tenant_id = ${tenantId}`;
  return s?.n ?? {};
};

/**
 * Send queued messages for every club with SMS switched on. Messages older than a day are never sent (a receipt
 * that arrives tomorrow is noise); permanent errors are not retried; at most 5 attempts.
 */
export async function dispatchSms(sql: Sql, client: SourceCodeSms, log: (m: string) => void = console.log) {
  let sent = 0;
  const tenants = await sql<{ id: string }[]>`select id from tenants`;
  for (const t of tenants) {
    await withTenant(sql, t.id, async (tx) => {
      const n = await clubNotify(tx, t.id);
      if (!n.enabled) {
        // Club has SMS off: nothing is sent and nothing piles up for later.
        await tx`update sms_messages set status = 'skipped', error = 'SMS is off for this club'
                 where status = 'queued' and kind <> 'test'`;
        return;
      }
      await tx`update sms_messages set status = 'skipped', error = 'too old to send'
               where status = 'queued' and created_at < now() - interval '24 hours'`;
      const batch = await tx<{ id: string; phone: string; body: string; attempts: number }[]>`
        select id, phone, body, attempts from sms_messages where status = 'queued'
        order by created_at limit 30 for update skip locked`;
      for (const m of batch) {
        const to = msisdn(m.phone);
        if (!to) {
          await tx`update sms_messages set status = 'failed', error = 'not a Kenyan mobile number' where id = ${m.id}`;
          continue;
        }
        let r: SmsResult;
        try {
          r = await client.send(to, m.body);
        } catch (e) {
          r = { ok: false, code: 'network', desc: (e as Error).message, retry: true };
        }
        const attempts = m.attempts + 1;
        if (r.ok) {
          sent++;
          await tx`update sms_messages set status = 'sent', sent_at = now(), attempts = ${attempts},
                   provider_ref = ${r.messageId ?? null}, error = null where id = ${m.id}`;
        } else {
          const final = !r.retry || attempts >= 5;
          await tx`update sms_messages set status = ${final ? 'failed' : 'queued'}, attempts = ${attempts},
                   error = ${`${r.code} ${r.desc}`.slice(0, 300)} where id = ${m.id}`;
          if (final) log(`sms ${m.id} failed: ${r.code} ${r.desc}`);
        }
      }
    });
  }
  return sent;
}

/**
 * Expiry reminders: one SMS N days before a member's access ends and one on the last day, never twice for the
 * same end date (renewing moves the end date, so the next cycle gets fresh reminders).
 */
export async function queueReminders(sql: Sql, portalUrl: string): Promise<number> {
  let queued = 0;
  const tenants = await sql<{ id: string; name: string; timezone: string }[]>`select id, name, timezone from tenants`;
  for (const t of tenants) {
    queued += await withTenant(sql, t.id, async (tx) => {
      const n = await clubNotify(tx, t.id);
      if (!n.enabled || n.reminders === false) return 0;
      const days = Math.min(14, Math.max(1, n.reminderDays ?? 3));
      const [ch] = await tx<{ paybill: string | null }[]>`
        select data->'channels'->>'paybill' as paybill from tenant_settings where tenant_id = ${t.id}`;
      const [slug] = await tx<{ slug: string }[]>`select slug from tenants where id = ${t.id}`;
      const due = await tx<{ member_id: string; member_no: number; first_name: string; phone: string; ends: Date }[]>`
        select m.id as member_id, m.member_no, m.first_name, m.phone, x.ends from members m
        join (select member_id, max(ends_at) as ends from entitlements group by member_id) x on x.member_id = m.id
        where m.status = 'active' and m.phone is not null
          and x.ends > now() and x.ends < now() + make_interval(days => ${days} + 1)`;
      let q = 0;
      const now = DateTime.now().setZone(t.timezone);
      for (const d of due) {
        const end = DateTime.fromJSDate(d.ends, { zone: t.timezone });
        const left = Math.floor(end.startOf('day').diff(now.startOf('day'), 'days').days);
        const which = left <= 0 ? 'today' : left <= days ? `${days}d` : null;
        if (!which) continue;
        const how = ch?.paybill
          ? `Renew on M-Pesa Paybill ${ch.paybill}, account ${d.member_no}, or at ${portalUrl}/m (club code ${slug?.slug}).`
          : `Renew at ${portalUrl}/m (club code ${slug?.slug}, member no. ${d.member_no}).`;
        const body =
          which === 'today'
            ? `${t.name}: ${d.first_name}, your access ends today at ${end.toFormat('HH:mm')}. ${how}`
            : `${t.name}: ${d.first_name}, your access ends on ${end.toFormat('d LLL')}. ${how}`;
        const r = await tx`insert into sms_messages (tenant_id, member_id, phone, body, kind, dedupe_key)
          values (${t.id}, ${d.member_id}, ${d.phone}, ${body}, 'reminder', ${`reminder:${which}:${d.member_id}:${end.toISODate()}`})
          on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing returning id`;
        q += r.length;
      }
      return q;
    });
  }
  return queued;
}
