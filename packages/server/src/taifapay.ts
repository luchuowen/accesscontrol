import { createHash } from 'node:crypto';
import type { Sql } from '@lango/db';
import { withTenant } from '@lango/db';
import { DateTime } from 'luxon';
import { decrypt } from './crypto.js';
import { recordPayment } from './payments.js';

/** TaifaPay merchant API (docs/research/taifapay.md). One merchant account per tenant. */
export interface TaifaCreds {
  env: 'sandbox' | 'live';
  clientId: string;
  clientSecret: string;
}
const base = (env: TaifaCreds['env']) =>
  // The guides say /v1, but on the live host /v1 is the dashboard web app; the API answers under /api/v1 (lab, 2 Oct 2026).
  env === 'live' ? 'https://merchants.taifapay.africa/api/v1' : 'https://sandbox.merchants.taifapay.africa/api/v1';
const tokens = new Map<string, { token: string; exp: number }>();
const TIMEOUT_MS = 15_000; // never leave a webhook or a staff click hanging on a slow provider
/** The provider answered and refused the credentials (as opposed to being unreachable). */
export class TaifaAuthError extends Error {}

export class TaifaPay {
  constructor(
    private c: TaifaCreds,
    private f: typeof fetch = fetch,
  ) {}

  private async token(): Promise<string> {
    const k = createHash('sha256').update(`${this.c.env}|${this.c.clientId}|${this.c.clientSecret}`).digest('hex'); // secret is part of the key
    const hit = tokens.get(k);
    if (hit && hit.exp > Date.now() + 60_000) return hit.token;
    const r = await this.f(`${base(this.c.env)}/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.c.clientId}:${this.c.clientSecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status === 400 || r.status === 401 || r.status === 403)
      throw new TaifaAuthError(`Payment Gateway auth failed: HTTP ${r.status}`);
    if (!r.ok) throw new Error(`Payment Gateway auth endpoint error: HTTP ${r.status}`);
    const text = await r.text();
    let j: { access_token?: string; expires_in?: string | number };
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error('Payment Gateway auth endpoint did not return JSON (wrong API address?)');
    }
    if (!j.access_token) throw new TaifaAuthError('Payment Gateway auth returned no access token');
    tokens.set(k, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 300) * 1000 });
    return j.access_token;
  }

  /** One round trip: proves the client ID + secret are accepted (used when the owner saves keys). */
  async verify(): Promise<void> {
    await this.token();
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.f(`${base(this.c.env)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Payment Gateway ${method} ${path}: HTTP ${r.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** M-Pesa STK push. `externalId` is our payment_intent id and comes back as externalReference. */
  stkPush(a: { phone: string; amount: number; accountReference: string; description: string; externalId: string }) {
    return this.call<Record<string, unknown>>('POST', '/transactions/m-pesa/c2b/initiate', {
      phoneNumber: a.phone,
      amount: a.amount,
      accountReference: a.accountReference,
      transactionDesc: a.description,
      externalId: a.externalId,
    });
  }

  /** Hosted checkout link (M-Pesa STK/manual, card, bank). accountReference must be unique per merchant. */
  invoice(a: {
    amount: number;
    accountReference: string;
    description: string;
    externalId: string;
    phone?: string;
    name?: string;
    returnUrl?: string;
  }) {
    return this.call<{ invoice: { transactionId: string; checkoutUrl: string; invoiceNo: string } }>(
      'POST',
      '/checkout/invoices',
      {
        amount: a.amount,
        currency: 'KES',
        accountReference: a.accountReference,
        description: a.description,
        externalId: a.externalId,
        ...(a.phone ? { customerPhone: a.phone } : {}),
        ...(a.name ? { customerName: a.name } : {}),
        ...(a.returnUrl ? { returnUrl: a.returnUrl } : {}),
        methods: ['mpesa_stk', 'card'],
        expiresInMinutes: 60,
      },
    );
  }

  transaction(id: string) {
    return this.call<Record<string, unknown>>('GET', `/transactions/${encodeURIComponent(id)}`);
  }
}

const channelOf = (m: string): 'mpesa' | 'card' | 'bank' =>
  /card|visa|master/i.test(m) ? 'card' : /bank|pesalink|eft|rtgs/i.test(m) ? 'bank' : 'mpesa';

export const normalStatus = (s: unknown) => {
  const v = String(s ?? '').toLowerCase();
  if (v === 'complete' || v === 'completed' || v === 'success' || v === 'successful') return 'completed';
  return v === 'failed' || v === 'cancelled' || v === 'canceled' || v === 'expired' || v === 'reversed'
    ? 'failed'
    : 'pending';
};

/**
 * The transaction object from `GET /transactions/{id}`: the body itself, or its `data` / `transaction` member.
 * Fields are read from that one object only (no deep search), so an envelope's own `status` can't be mistaken for it.
 */
export function transactionRecord(truth: unknown): {
  id?: string;
  channel: 'mpesa' | 'card' | 'bank';
  status: unknown;
  amount: unknown;
  accountReference?: string;
  externalReference?: string;
  phone: string | null;
  paidAt?: string;
} | null {
  if (!truth || typeof truth !== 'object') return null;
  const o = truth as Record<string, unknown>;
  const inner = [o.data, o.transaction].find((x) => x && typeof x === 'object' && !Array.isArray(x)) as
    | Record<string, unknown>
    | undefined;
  const r = inner && ('amount' in inner || 'status' in inner) ? inner : o;
  if (!('status' in r) || !('amount' in r)) return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return {
    id: str(r.transactionId) ?? str(r.id),
    status: r.status,
    amount: r.amount,
    accountReference: str(r.accountReference),
    externalReference: str(r.externalReference) ?? str(r.externalId),
    phone: str(r.phoneNumber) ?? str(r.msisdn) ?? null,
    paidAt: str(r.completedAt) ?? str(r.updatedAt),
    channel: channelOf(str(r.paymentMethod) ?? str(r.method) ?? str(r.channel) ?? str(r.gateway) ?? ''),
  };
}

/** Find a value at any depth (TaifaPay response schemas are not published; be tolerant). */
export function pick(o: unknown, ...keys: string[]): unknown {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of keys) if (k in (o as Record<string, unknown>)) return (o as Record<string, unknown>)[k];
  for (const v of Object.values(o as Record<string, unknown>)) {
    const x = pick(v, ...keys);
    if (x !== undefined) return x;
  }
  return undefined;
}

export async function tenantTaifa(sql: Sql, tenantId: string): Promise<TaifaPay | null> {
  const [row] = await withTenant(
    sql,
    tenantId,
    (tx) => tx<{ data: { taifapay?: { env: 'sandbox' | 'live'; clientId: string; clientSecret: string } } }[]>`
    select data from tenant_settings where tenant_id = ${tenantId}`,
  );
  const t = row?.data.taifapay;
  if (!t) return null;
  return new TaifaPay({ env: t.env, clientId: t.clientId, clientSecret: decrypt(t.clientSecret) });
}

type Settled = { status: number; body: Record<string, unknown> };

/**
 * Apply one TaifaPay transaction for a club, trusting only TaifaPay's own record of it (re-fetched with the
 * club's credentials). Shared by the webhook and the reconciliation poller, so both behave identically and a
 * payment is recorded exactly once whichever arrives first.
 */
export async function settleTaifaTransaction(
  sql: Sql,
  t: { id: string; timezone: string },
  txId: string,
  client: TaifaPay,
  raw: unknown,
): Promise<Settled> {
  const truth = await client.transaction(txId);
  const rec = transactionRecord(truth);
  // A response we cannot read must never be acknowledged as handled: 502 so TaifaPay retries, plus an audit trail.
  const unreadable = async (why: string): Promise<Settled> => {
    await withTenant(
      sql,
      t.id,
      (tx) => tx`insert into audit_log (tenant_id, actor, action, entity, data)
      values (${t.id}, 'taifapay', 'payment.unreadable', ${txId}, ${tx.json({ why, verified: truth } as never)})`,
    );
    console.error(`taifapay ${t.id} ${txId}: ${why}`);
    return { status: 502, body: { error: why } };
  };
  if (!rec) return unreadable('unrecognised transaction response');
  if (rec.id && rec.id !== txId) return { status: 200, body: { ignored: 'transaction id mismatch' } };
  const state = normalStatus(rec.status);
  if (state !== 'completed') return { status: 200, body: { ignored: 'not completed', state } };
  const amount = Number(rec.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0)
    return unreadable(`unexpected amount ${String(rec.amount).slice(0, 40)}`);
  // Intents carry member + product; they only count when TaifaPay itself echoes our id and the amount matches.
  let productId: string | null = null;
  let intentId: string | null = null;
  let expectedKes: number | null = null;
  let lines: { productId: string; priceKes: number }[] | null = null;
  let ref = rec.accountReference ?? '';
  const externalRef = rec.externalReference ?? '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(externalRef)) {
    const [it] = await withTenant(
      sql,
      t.id,
      (tx) => tx<
        {
          product_id: string | null;
          member_no: number;
          amount_kes: number;
          lines: { productId: string; priceKes: number }[] | null;
        }[]
      >`
      select i.product_id, m.member_no, i.amount_kes, i.lines from payment_intents i join members m on m.id = i.member_id where i.id = ${externalRef}`,
    );
    if (it && it.amount_kes === amount) {
      productId = it.product_id;
      lines = it.lines;
      expectedKes = it.amount_kes;
      intentId = externalRef;
      ref = String(it.member_no);
    }
  }
  // Naive provider timestamps are club-local; an explicit offset is respected. Never in the future.
  const parsed = rec.paidAt ? DateTime.fromISO(rec.paidAt, { zone: t.timezone }) : null;
  const paid = parsed?.isValid && parsed.toMillis() <= Date.now() + 60_000 ? parsed.toJSDate() : new Date();
  // Paybill/till payments carry what the member typed as the account; accept "21002", "21002-OCT", " 21002 ".
  const typed = ref.trim().split(/[-\s/]/)[0] ?? '';
  const r = await recordPayment(sql, t.id, {
    provider: 'taifapay',
    providerTxnId: txId,
    amountKes: amount,
    accountRef: typed || ref,
    phone: rec.phone,
    externalRef,
    productId,
    expectedKes,
    lines,
    intentId,
    channel: rec.channel,
    paidAt: paid,
    raw: { event: raw, verified: truth },
  });
  return { status: 200, body: r as unknown as Record<string, unknown> };
}

/**
 * POST /api/webhooks/taifapay/{tenantSlug}. The body is only a hint: the transaction is re-fetched from TaifaPay
 * with the club's own credentials before anything is applied.
 */
export async function handleTaifaWebhook(
  sql: Sql,
  req: Request,
  slug: string,
  verifyClient?: TaifaPay,
): Promise<Response> {
  const [t] = await sql<{ id: string; timezone: string }[]>`select id, timezone from tenants where slug = ${slug}`;
  if (!t) return new Response('unknown tenant', { status: 404 });
  let evt: { eventType?: string; data?: Record<string, unknown> };
  try {
    evt = JSON.parse(await req.text());
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const txId = String(evt.data?.transactionId ?? evt.data?.id ?? '');
  if (!txId || !/^[\w-]{6,80}$/.test(txId)) return new Response('missing transactionId', { status: 400 });
  const client = verifyClient ?? (await tenantTaifa(sql, t.id));
  if (!client) return new Response('tenant has no Payment Gateway credentials', { status: 409 });
  const r = await settleTaifaTransaction(sql, t, txId, client, evt);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
}

/** The transaction id TaifaPay returns when an STK push or invoice is created (stored on the intent for polling). */
export function initiatedTransactionId(res: unknown): string | null {
  const r = (res ?? {}) as Record<string, unknown>;
  const inner = [r.transaction, r.invoice, r.data].find((x) => x && typeof x === 'object') as
    | Record<string, unknown>
    | undefined;
  const v = inner?.id ?? inner?.transactionId ?? r.id ?? r.transactionId;
  return typeof v === 'string' && /^[\w-]{6,80}$/.test(v) ? v : null;
}

/**
 * Safety net for missed webhooks (TaifaPay's own docs recommend polling as the fallback): look up every club's
 * pending payment requests from the last 24 h and settle the ones TaifaPay reports as finished.
 */
/**
 * minAgeSec: the background poller leaves fresh requests to the webhook (45 s); a page someone is watching passes a
 * few seconds so the payment shows as soon as M-Pesa confirms, even when the webhook is late or missed.
 */
export async function reconcileTaifaPay(
  sql: Sql,
  log: (m: string) => void = console.log,
  minAgeSec = 45,
): Promise<number> {
  let settled = 0;
  const tenants = await sql<{ id: string; timezone: string }[]>`select id, timezone from tenants`;
  for (const t of tenants) {
    const pending = await withTenant(
      sql,
      t.id,
      (tx) => tx<{ id: string; provider_ref: string }[]>`
        select id, provider_ref from payment_intents
        where status = 'pending' and provider = 'taifapay' and provider_ref is not null
          and created_at > now() - interval '24 hours' and created_at < now() - make_interval(secs => ${minAgeSec})
        order by created_at limit 50`,
    );
    if (!pending.length) continue;
    const client = await tenantTaifa(sql, t.id);
    if (!client) continue;
    for (const i of pending) {
      try {
        const r = await settleTaifaTransaction(sql, t, i.provider_ref, client, { source: 'reconcile' });
        if (r.body.status === 'applied' || r.body.status === 'unmatched') settled++;
        if (r.body.state === 'failed')
          await withTenant(sql, t.id, (tx) => tx`update payment_intents set status = 'failed' where id = ${i.id}`);
      } catch (e) {
        log(`reconcile ${i.provider_ref}: ${(e as Error).message}`);
      }
    }
  }
  // Requests nobody completed within a day are closed so they stop being polled.
  for (const t of tenants)
    await withTenant(
      sql,
      t.id,
      (tx) =>
        tx`update payment_intents set status = 'expired' where status = 'pending' and created_at < now() - interval '24 hours'`,
    );
  return settled;
}
