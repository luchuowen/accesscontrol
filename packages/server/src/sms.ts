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
  /** SMS units Source Code charged (multi-part messages cost more than one) */
  cost?: number;
  /** false for errors a retry cannot fix (bad number, bad sender, bad key, no credit) */
  retry: boolean;
  /** NAVAC's remaining Source Code credit, as Source Code reports it after the send */
  balance?: number;
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

  get defaultSender() {
    return this.sender;
  }

  async send(mobile: string, message: string, sender?: string): Promise<SmsResult> {
    const j = (await this.post('sendsms', {
      api_key: this.apiKey,
      service_id: 0,
      mobile,
      response_type: 'json',
      shortcode: sender || this.sender,
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
      ...(Number(r.message_cost) > 0 ? { cost: Number(r.message_cost) } : {}),
      retry: !ok && !FINAL.has(code),
      ...(r.credit_balance != null && String(r.credit_balance) !== '' && Number.isFinite(Number(r.credit_balance))
        ? { balance: Number(r.credit_balance) }
        : {}),
    };
  }

  /**
   * Proves the API key works without sending anything. Source Code's documented profile endpoint does not exist
   * (404, checked 2026-10-02), but sendsms checks the key before the number: an impossible number answers
   * 1006 for a bad key and a number error for a good one. No SMS is sent and nothing is charged.
   */
  async profile(): Promise<{ ok: boolean; balance: string | null; company: string | null; desc: string }> {
    const j = (await this.post('sendsms', {
      api_key: this.apiKey,
      service_id: 0,
      mobile: '0',
      response_type: 'json',
      shortcode: this.sender,
      message: 'key check',
    })) as Record<string, unknown> | Record<string, unknown>[];
    const r = ((Array.isArray(j) ? j[0] : j) ?? {}) as Record<string, unknown>;
    const code = String(r.status_code ?? '0');
    const balance = r.credit_balance != null && String(r.credit_balance) !== '' ? String(r.credit_balance) : null;
    return {
      ok: code !== '1006' && code !== '1011' && code !== '0',
      balance,
      company: null,
      desc: String(r.status_desc ?? ''),
    };
  }
}

export interface PlatformSms {
  apiKey: string; // encrypted
  sender: string;
  /** what one SMS unit costs NAVAC at Source Code (KES) */
  costKes?: number;
  /** default resale price per SMS unit (KES); a club can have its own */
  priceKes?: number;
  /** NAVAC's phone for platform alerts (Source Code credit low, club door PCs offline) */
  alertPhone?: string;
  /** alert NAVAC when Source Code credit falls below this */
  lowCredit?: number;
}

export async function platformSmsConfig(sql: Sql): Promise<PlatformSms | null> {
  const [row] = await sql<{ data: PlatformSms | null }[]>`select app_platform_get('sms') as data`;
  return row?.data ?? null;
}

/** SMS units a message uses: 160 GSM characters (153 per part when split), 70/67 when it needs Unicode. */
export function smsUnits(body: string): number {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: GSM-7 basic set check
  const gsm = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]*$/.test(body);
  const [one, part] = gsm ? [160, 153] : [70, 67];
  return body.length <= one ? 1 : Math.ceil(body.length / part);
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
  /** alert when the SMS balance falls below this many units */
  lowBalance?: number;
  /** phone that gets low-balance alerts and auto top-up M-Pesa prompts */
  alertPhone?: string;
  autoTopup?: boolean;
  autoTopupKes?: number;
  /** "we'll sort it, no need to pay again" when an M-Pesa payment cannot be matched (default on) */
  unmatched?: boolean;
  /** one "we miss you" a week after a plan ends without renewal (default on) */
  winback?: boolean;
  /** staff alerts to the alert phone (default on) */
  bridgeAlerts?: boolean;
  tamperAlerts?: boolean;
  /** end-of-day summary to the alert phone at 19:00 (default off) */
  dailySummary?: boolean;
  /** local hours; nothing but receipts and sign-in codes is sent from quietFrom until quietTo (default 20 → 7) */
  quietFrom?: number;
  quietTo?: number;
}

/** Sent at any hour and never counted against the member's one-message-a-day limit. */
export const URGENT_KINDS = new Set(['receipt', 'unmatched', 'otp', 'test', 'topup']);
/** Messages a member gets at most one of per day (the rest wait for the next day, or lapse). */
export const CAPPED_KINDS = new Set(['reminder', 'welcome', 'announcement', 'winback']);
/** Lango's own operational messages to club staff: free, sent under the platform sender. */
export const FREE_KINDS = new Set(['system', 'topup']);

export const quietHours = (n: NotifySettings) => ({
  from: Number.isInteger(n.quietFrom) ? (n.quietFrom as number) : 20,
  to: Number.isInteger(n.quietTo) ? (n.quietTo as number) : 7,
});

/** True while it is quiet time in the club's timezone (from 20:00 to 07:00 by default). */
export function isQuiet(at: DateTime, tz: string, n: NotifySettings): boolean {
  const { from, to } = quietHours(n);
  if (from === to) return false;
  const h = at.setZone(tz).hour;
  return from > to ? h >= from || h < to : h >= from && h < to;
}

/** The club's SMS sender ID, price per unit and current balance (units). */
export async function clubSms(tx: Tx, tenantId: string, platform: PlatformSms | null) {
  const [c] = await tx<{ sender: string | null; price_kes: string | null }[]>`
    select sender, price_kes from tenant_sms where tenant_id = ${tenantId}`;
  const [b] = await tx<{ units: string | null }[]>`select sum(units) as units from sms_ledger`;
  return {
    sender: c?.sender || platform?.sender || 'NAVAC',
    priceKes: Number(c?.price_kes ?? platform?.priceKes ?? 1),
    balance: Number(b?.units ?? 0),
  };
}

export const clubNotify = async (tx: Tx, tenantId: string): Promise<NotifySettings> => {
  const [s] = await tx<{ n: NotifySettings | null }[]>`
    select data->'notifications' as n from tenant_settings where tenant_id = ${tenantId}`;
  return s?.n ?? {};
};

/**
 * Send queued messages for every club with SMS switched on, under the club's sender ID, paid from the club's SMS
 * wallet. Messages wait (up to a day) when the wallet is empty; system messages (low-balance alerts, top-up
 * receipts) are free. Permanent errors are not retried; at most 5 attempts. Low balance triggers an alert and, if
 * the club chose it, an automatic M-Pesa top-up prompt.
 */
export async function dispatchSms(
  sql: Sql,
  client: SourceCodeSms,
  log: (m: string) => void = console.log,
  onLowBalance?: (tenantId: string, balance: number, n: NotifySettings) => Promise<void>,
  now: DateTime = DateTime.now(),
) {
  let sent = 0;
  const platform = await platformSmsConfig(sql);
  const tenants = await sql<{ id: string; timezone: string }[]>`select id, timezone from tenants`;
  let navacBalance: number | undefined;
  for (const t of tenants) {
    const low = await withTenant(sql, t.id, async (tx) => {
      const n = await clubNotify(tx, t.id);
      const quiet = isQuiet(now, t.timezone, n);
      const dayStart = now.setZone(t.timezone).startOf('day').toJSDate();
      if (!n.enabled) {
        // Club has SMS off: member messages are dropped, not piled up; system messages still go out.
        await tx`update sms_messages set status = 'skipped', error = 'SMS is off for this club'
                 where status = 'queued' and kind not in ('test', 'system', 'topup')`;
      }
      await tx`update sms_messages set status = 'skipped', error = 'too old to send'
               where status = 'queued' and (send_before < now() or (send_before is null and created_at < now() - interval '24 hours'))`;
      const club = await clubSms(tx, t.id, platform);
      let balance = club.balance;
      // Waiting messages are labelled in bulk and left out of the batch, so they never hold up the rest.
      const urgent = [...URGENT_KINDS];
      const capped = [...CAPPED_KINDS];
      if (quiet)
        await tx`update sms_messages set error = 'waiting for quiet hours to end'
                 where status = 'queued' and kind <> all(${urgent}) and error is distinct from 'waiting for quiet hours to end'`;
      await tx`update sms_messages q set error = 'waiting: one message per member per day'
               where q.status = 'queued' and q.kind = any(${capped}) and q.member_id is not null
                 and q.error is distinct from 'waiting: one message per member per day'
                 and exists (select 1 from sms_messages s where s.member_id = q.member_id and s.status = 'sent'
                             and s.kind = any(${capped}) and s.sent_at >= ${dayStart})`;
      const batch = await tx<
        { id: string; phone: string; body: string; attempts: number; kind: string; member_id: string | null }[]
      >`
        select id, phone, body, attempts, kind, member_id from sms_messages q where status = 'queued'
          and (${!quiet} or kind = any(${urgent}))
          and not (kind = any(${capped}) and member_id is not null and exists (
            select 1 from sms_messages s where s.member_id = q.member_id and s.status = 'sent'
              and s.kind = any(${capped}) and s.sent_at >= ${dayStart}))
        order by kind = any(${urgent}) desc, (kind = 'system') desc, (kind = 'reminder') desc, created_at
        limit 40 for update skip locked`;
      for (const m of batch) {
        const to = msisdn(m.phone);
        if (!to) {
          await tx`update sms_messages set status = 'failed', error = 'not a Kenyan mobile number' where id = ${m.id}`;
          continue;
        }
        // Two capped messages for one member in the same batch: the first goes, the second waits.
        if (CAPPED_KINDS.has(m.kind) && m.member_id) {
          const [had] = await tx`select 1 from sms_messages where member_id = ${m.member_id} and status = 'sent'
            and kind = any(${capped}) and sent_at >= ${dayStart} limit 1`;
          if (had) {
            await tx`update sms_messages set error = 'waiting: one message per member per day' where id = ${m.id}`;
            continue;
          }
        }
        const free = FREE_KINDS.has(m.kind);
        const units = smsUnits(m.body);
        if (!free && balance < units) {
          await tx`update sms_messages set error = 'waiting for SMS credit' where id = ${m.id}`;
          continue;
        }
        let r: SmsResult;
        try {
          r = await client.send(to, m.body, free ? platform?.sender || client.defaultSender : club.sender);
        } catch (e) {
          r = { ok: false, code: 'network', desc: (e as Error).message, retry: true };
        }
        const attempts = m.attempts + 1;
        if (r.balance != null) navacBalance = r.balance;
        if (r.ok) {
          sent++;
          await tx`update sms_messages set status = 'sent', sent_at = now(), attempts = ${attempts},
                   provider_ref = ${r.messageId ?? null}, error = null where id = ${m.id}`;
          if (!free) {
            const used = Math.max(units, r.cost ?? 0);
            balance -= used;
            await tx`insert into sms_ledger (tenant_id, units, kind, ref, amount_kes)
                     values (${t.id}, ${-used}, 'send', ${m.id}, ${used * club.priceKes})
                     on conflict do nothing`;
          }
        } else {
          const final = !r.retry || attempts >= 5;
          await tx`update sms_messages set status = ${final ? 'failed' : 'queued'}, attempts = ${attempts},
                   error = ${`${r.code} ${r.desc}`.slice(0, 300)} where id = ${m.id}`;
          if (final) log(`sms ${m.id} failed: ${r.code} ${r.desc}`);
        }
      }
      const threshold = n.lowBalance ?? 100;
      // Low-balance alerts and automatic M-Pesa prompts never arrive during quiet hours.
      if (!n.enabled || balance >= threshold || quiet) return null;
      // At most one low-balance alert per day.
      const [recent] =
        await tx`select 1 from audit_log where action = 'sms.low_balance' and at > now() - interval '24 hours'`;
      if (recent) return null;
      await tx`insert into audit_log (tenant_id, actor, action, data)
               values (${t.id}, 'system', 'sms.low_balance', ${tx.json({ balance, threshold } as never)})`;
      const alert = msisdn(n.alertPhone);
      if (alert) {
        const [club2] = await tx<{ name: string }[]>`select name from tenants where id = ${t.id}`;
        const body = n.autoTopup
          ? `${club2?.name}: SMS balance is ${balance}. An M-Pesa prompt for KES ${(n.autoTopupKes ?? 1000).toLocaleString('en-KE')} SMS credit is on its way to this phone.`
          : `${club2?.name}: SMS balance is ${balance}, below your alert level of ${threshold}. Buy SMS credit in Lango > Settings.`;
        await tx`insert into sms_messages (tenant_id, phone, body, kind) values (${t.id}, ${alert}, ${body}, 'system')`;
      }
      return { balance, n };
    });
    if (low && onLowBalance)
      await onLowBalance(t.id, low.balance, low.n).catch((e) => log(`auto top-up ${t.id}: ${(e as Error).message}`));
  }
  if (navacBalance != null)
    await sql`select app_platform_note('sms_status', ${sql.json({ balance: navacBalance, at: new Date().toISOString() } as never)})`;
  return sent;
}

/**
 * Send one member message right now (portal sign-in codes): club sender, paid from the club's SMS credit, recorded
 * like any other message. Returns false when SMS is off, the club has no credit, or Source Code refuses.
 */
export async function sendNow(
  sql: Sql,
  tenantId: string,
  m: { phone: string; body: string; kind: string; memberId?: string },
  client?: SourceCodeSms | null,
): Promise<boolean> {
  const sms = client ?? (await platformSms(sql));
  const to = msisdn(m.phone);
  if (!sms || !to) return false;
  const platform = await platformSmsConfig(sql);
  const ready = await withTenant(sql, tenantId, async (tx) => {
    const n = await clubNotify(tx, tenantId);
    const club = await clubSms(tx, tenantId, platform);
    return n.enabled && club.balance >= smsUnits(m.body) ? club : null;
  });
  if (!ready) return false;
  let r: SmsResult;
  try {
    r = await sms.send(to, m.body, ready.sender);
  } catch (e) {
    r = { ok: false, code: 'network', desc: (e as Error).message, retry: true };
  }
  const units = Math.max(smsUnits(m.body), r.cost ?? 0);
  await withTenant(sql, tenantId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into sms_messages (tenant_id, member_id, phone, body, kind, status, provider_ref, error, attempts, sent_at)
      values (${tenantId}, ${m.memberId ?? null}, ${to}, ${m.body}, ${m.kind}, ${r.ok ? 'sent' : 'failed'},
              ${r.messageId ?? null}, ${r.ok ? null : `${r.code} ${r.desc}`.slice(0, 300)}, 1, ${r.ok ? new Date() : null})
      returning id`;
    if (r.ok)
      await tx`insert into sms_ledger (tenant_id, units, kind, ref, amount_kes)
               values (${tenantId}, ${-units}, 'send', ${row?.id ?? null}, ${units * ready.priceKes})`;
  });
  return r.ok;
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
        const r = await tx`insert into sms_messages (tenant_id, member_id, phone, body, kind, dedupe_key, send_before)
          values (${t.id}, ${d.member_id}, ${d.phone}, ${body}, 'reminder', ${`reminder:${which}:${d.member_id}:${end.toISODate()}`}, ${d.ends})
          on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing returning id`;
        q += r.length;
      }
      return q;
    });
  }
  return queued;
}
