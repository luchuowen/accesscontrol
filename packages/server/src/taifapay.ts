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
  env === 'live' ? 'https://merchants.taifapay.africa/v1' : 'https://sandbox.merchants.taifapay.africa/v1';
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
    if (!r.ok) throw new TaifaAuthError(`TaifaPay auth failed: HTTP ${r.status}`);
    const j = (await r.json()) as { access_token?: string; expires_in?: string | number };
    if (!j.access_token) throw new TaifaAuthError('TaifaPay auth returned no access token');
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
    if (!r.ok) throw new Error(`TaifaPay ${method} ${path}: HTTP ${r.status} ${text.slice(0, 200)}`);
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

export const normalStatus = (s: unknown) => {
  const v = String(s ?? '').toLowerCase();
  return v === 'complete' || v === 'completed' || v === 'success' ? 'completed' : v === 'failed' ? 'failed' : 'pending';
};

/**
 * The transaction object from `GET /transactions/{id}`: the body itself, or its `data` / `transaction` member.
 * Fields are read from that one object only (no deep search), so an envelope's own `status` can't be mistaken for it.
 */
export function transactionRecord(truth: unknown): {
  id?: string;
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

/**
 * POST /api/webhooks/taifapay/{tenantSlug}. The signature scheme is undocumented, so we never trust the
 * body: the transaction is re-fetched from TaifaPay with the tenant's own credentials before anything is applied.
 */
export async function handleTaifaWebhook(
  sql: Sql,
  req: Request,
  slug: string,
  verifyClient?: TaifaPay,
): Promise<Response> {
  const ok = (b: unknown) =>
    new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const [t] = await sql<{ id: string; timezone: string }[]>`select id, timezone from tenants where slug = ${slug}`;
  if (!t) return new Response('unknown tenant', { status: 404 });
  let evt: { eventType?: string; data?: Record<string, unknown> };
  try {
    evt = JSON.parse(await req.text());
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const txId = String(evt.data?.transactionId ?? '');
  if (!txId || !/^[\w-]{6,80}$/.test(txId)) return new Response('missing transactionId', { status: 400 });
  const client = verifyClient ?? (await tenantTaifa(sql, t.id));
  if (!client) return new Response('tenant has no TaifaPay credentials', { status: 409 });
  const truth = await client.transaction(txId);
  // Trust only TaifaPay's own record of this transaction (never fields from the unsigned webhook body).
  const rec = transactionRecord(truth);
  // A response we cannot read must never be acknowledged as handled: answer 502 so TaifaPay retries,
  // and leave a trail the owner can see.
  const unreadable = async (why: string) => {
    await withTenant(
      sql,
      t.id,
      (tx) => tx`insert into audit_log (tenant_id, actor, action, entity, data)
      values (${t.id}, 'taifapay', 'payment.unreadable', ${txId}, ${tx.json({ why, verified: truth } as never)})`,
    );
    console.error(`taifapay ${slug} ${txId}: ${why}`);
    return new Response(JSON.stringify({ error: why }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  if (!rec) return unreadable('unrecognised transaction response');
  if (rec.id && rec.id !== txId) return ok({ ignored: 'transaction id mismatch' });
  if (normalStatus(rec.status) !== 'completed') return ok({ ignored: 'not completed' });
  const amount = Number(rec.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0)
    return unreadable(`unexpected amount ${String(rec.amount).slice(0, 40)}`);
  // Intents carry member + product; they only count when TaifaPay itself echoes our id and the amount matches.
  let productId: string | null = null;
  let intentId: string | null = null;
  let ref = rec.accountReference ?? '';
  const externalRef = rec.externalReference ?? '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(externalRef)) {
    const [it] = await withTenant(
      sql,
      t.id,
      (tx) => tx<{ product_id: string; member_no: number; amount_kes: number }[]>`
      select i.product_id, m.member_no, i.amount_kes from payment_intents i join members m on m.id = i.member_id where i.id = ${externalRef}`,
    );
    if (it && it.amount_kes === amount) {
      productId = it.product_id;
      intentId = externalRef;
      ref = String(it.member_no);
    }
  }
  // Naive provider timestamps are club-local; an explicit offset is respected. Never in the future.
  const parsed = rec.paidAt ? DateTime.fromISO(rec.paidAt, { zone: t.timezone }) : null;
  const paid = parsed?.isValid && parsed.toMillis() <= Date.now() + 60_000 ? parsed.toJSDate() : new Date();
  const r = await recordPayment(sql, t.id, {
    provider: 'taifapay',
    providerTxnId: txId,
    amountKes: amount,
    accountRef: ref.split('-')[0] ?? ref,
    phone: rec.phone,
    externalRef,
    productId,
    intentId,
    channel: 'mpesa',
    paidAt: paid,
    raw: { webhook: evt, verified: truth },
  });
  return ok(r);
}
