# TaifaPay Merchant API — Integration Research

Researched 2026-10-01 from https://merchants.taifapay.africa/docs (all 7 guides plus the API reference sidebar pages). Direct HTTP and headless-browser access to the domain were blocked by our egress proxy, so everything here comes through a page-to-text fetcher. **The API reference pages render their request/response schemas client-side, and those schemas did not come through.** Field lists below come from the guides' prose and curl samples. Legend: **[V]** verified in the docs, **[U]** unverified or inferred.

## 1. Company
- **TaifaPay Limited**, Kenya. It runs two products: *Taifa Chat* (a P2P chat wallet) and *Taifa Merchants* (the gateway: M-Pesa, cards, bank and Pesalink collections and payouts). Contact: info@taifapay.africa, +254 741 685 607 **[V, taifapay.africa]**.
- No CBK PSP licence, fee schedule, funding or press coverage turned up anywhere **[U]**. Web searches return almost nothing on the company. Don't confuse it with "Taifapay", the 2020 Nairobi County/KRA revenue system. That one is unrelated.
- The SDKs `@taifa/payments-node` (backend) and `@taifa/payments-js` (frontend) are named in the docs, but **neither is on the public npm registry** (both return 404). They are probably private or unreleased. Plan on raw REST.

## 2. Environments [V]
| Env | Base URL |
|---|---|
| Sandbox | `https://sandbox.merchants.taifapay.africa/v1` (docs) → use `/api/v1` [U] |
| Live | `https://merchants.taifapay.africa/v1` (docs) → **actually `/api/v1`** [V, lab 2026-10-02: `/v1/auth/token` returns the dashboard HTML with 200; `/api/v1/auth/token` returns JSON 401 for bad keys] |

Each environment has its own credential pair, and tokens only work in the environment that issued them.

## 3. Authentication [V]
OAuth2 client-credentials flow, which returns a JWT.
```bash
curl -X POST https://sandbox.merchants.taifapay.africa/v1/auth/token \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials"}'
# -> {"access_token":"<jwt>","expires_in":"3599","token_type":"Bearer"}
```
- Send `Authorization: Bearer <token>` on every call. The token lasts about 1 hour, so cache it per merchant and refresh it early.
- The reference also lists an `x-auth-token` API-key header and Basic auth as security schemes. Their use isn't documented **[U]**.
- **There is no request signing on outbound calls.** The token is the only auth.
- The token is **company-level**: one company equals one credential pair. **No sub-merchant, platform or "on-behalf-of" model is documented [V by absence].** For multi-tenancy, each club would need its own TaifaPay merchant account and its own `client_id`/`client_secret` (and webhook secret), stored per tenant. Confirm with TaifaPay whether a platform/aggregator account exists **[U]**.

## 4. Collections

### 4a. M-Pesa STK push [V]
`POST /v1/transactions/m-pesa/c2b/initiate` returns 201.
```json
{
  "phoneNumber": "0712345678",
  "amount": 100,
  "accountReference": "Account123",
  "transactionDesc": "Top-up",
  "externalId": "your-transaction-id"
}
```
All 5 fields are listed as required. The response body schema wasn't visible. It presumably carries a transaction `id` **[U]**. The docs say to treat the initial status as provisional and wait for the webhook.

### 4b. Paybill/Till C2B where the customer pays from the M-Pesa menu with an account number. **Not documented.**
- No endpoint covers registering a merchant-owned paybill or till, or receiving **unsolicited** C2B confirmations (Daraja-style validation/confirmation URLs).
- The only manual-paybill flow is inside **hosted checkout** (method `mpesa_manual`). The page shows TaifaPay's paybill details, and the account number is **the invoice number, pre-filled**. The customer then taps "I've Paid". So the account number is per-invoice, not a standing member number **[V]**.
- **Gap for our use case:** "member pays to paybill X with account = member no." can't be built from the documented API. Options:
  1. STK push initiated by our app, with `accountReference` set to the member number.
  2. A payment-link/invoice per renewal, with `accountReference` set to member number plus period.
  3. Ask TaifaPay whether they offer a dedicated paybill or till per merchant with C2B forwarding **[U]**.

### 4c. Pesalink C2B [V]
`POST /v1/transactions/pesalink/c2b/initiate` with `amount, accountReference, transactionDesc, externalId`. The transaction stays pending until the customer makes the transfer.

### 4d. Cards [V, partial]
Cards are **only available through hosted checkout** (method `card`): card number, expiry, CVC, name, processed synchronously. There's no direct card API (PCI stays with TaifaPay). The processor, 3DS behaviour and tokenisation/recurring support aren't documented **[U]**.

## 5. Payment links / hosted checkout [V]
`POST /v1/checkout/invoices`
| Field | Req | Notes |
|---|---|---|
| `amount` | Y | fixed |
| `currency` | Y* | `KES` (*the guide lists it as required, but the getting-started sample omits it) |
| `accountReference` | Y | unique per merchant; `invoiceNo` = company identifier letters + `accountReference` |
| `description`, `customerName`, `customerEmail`, `customerPhone` | N | phone pre-fills STK |
| `externalId` | N | your ID for reconciliation |
| `methods` | N | `mpesa_stk`, `mpesa_manual`, `card`, `bank` |
| `returnUrl` | N | HTTPS |
| `expiresInMinutes` | N | 1–10080, default 30 |

Response (201):
```json
{"message":"Invoice created","invoice":{
  "transactionId":"a3f1c2d4-5e6b-7a8c-9d0e-1f2a3b4c5d6e",
  "checkoutUrl":"https://pay.taifapay.africa/pay/ABCINV-1001",
  "invoiceNo":"ABCINV-1001","amount":1500,"currency":"KES",
  "status":"open","methods":["mpesa_stk","card"],
  "expiresAt":"2026-07-17T12:30:00.000Z"}}
```
Other endpoints:
- `GET /v1/checkout/invoices/{invoiceNo}`
- Public endpoint (called by the checkout page): `POST /v1/checkout/public/:invoiceNo/mpesa/stk`

Invoice statuses: `open | processing | complete | failed | expired | cancelled`.

Because `accountReference` must be unique, a member number can't be reused across invoices. Use something like `M1234-2026-10` **[U: the uniqueness scope isn't stated]**.

The checkout page puts wallet users through SMS-OTP and KYC (name, national ID). That friction may matter for gym members **[V]**.

## 6. Transaction status query [V]
`GET /v1/transactions/{id}` returns 200 "Transaction details". The schema wasn't visible **[U]**.

**Status casing is inconsistent across the docs:**
- getting-started: `PENDING → COMPLETED/FAILED`
- payments guide: `pending → complete/failed`
- webhook: `"status":"complete"`

Normalise status strings case-insensitively, and treat `complete` and `completed` as the same.

## 7. Webhooks
**Verified [V]:**
- One webhook per **company**: an HTTPS URL plus a **secret** "used to sign every delivery". You set it at onboarding or in the merchant dashboard, not through the API. An inactive webhook stops deliveries.
- Test delivery: `POST /v1/webhooks/test` (Bearer, no body) returns 200.
- Payload:
```json
{
  "id": "0b0e9a3c-8f1d-4a7b-b1a2-3c4d5e6f7a8b",
  "eventType": "transaction.completed",
  "timestamp": "2026-07-18T09:15:00.000Z",
  "data": {
    "transactionId": "a3f1c2d4-...",
    "status": "complete",
    "amount": 1500,
    "accountReference": "INV-1001",
    "externalReference": "your-transaction-id"
  },
  "metadata": {}
}
```
Note that the request's `externalId` comes back as `data.externalReference`.

**Unverified [U]:** The docs say "Headers on every delivery:", but the header table is empty or truncated in the published page. That leaves undocumented:
- the signature header name and algorithm (probably HMAC-SHA256 of the raw body with the secret, but **unconfirmed**)
- timestamp tolerance
- retry schedule and back-off
- the expected response code
- the full list of event types (only `transaction.completed` is shown; failed, expired and payout events are presumably separate)

Ask TaifaPay for these before going live.

**Our handling:** deduplicate on the event `id` and on `transactionId`, verify the signature against the raw body, return 2xx fast and queue the access-control update. Back this up with a poller on `GET /v1/transactions/{id}` for anything still pending. Because there's one webhook URL per company, give each tenant its own path (`/webhooks/taifapay/{tenantId}`) and verify with that tenant's secret.

## 8. Idempotency [V, partial]
- There's no `Idempotency-Key` header. The docs say to "set `externalId` for idempotency matching", and on a timeout to check whether the transaction exists before retrying.
- No lookup-by-`externalId` endpoint is documented, so if the call times out before an `id` comes back, recovery is unclear **[U]**.

## 9. Reconciliation / settlement / refunds / fees
- **Refunds:** no endpoint **[V by absence]**. The closest substitute is a B2C payout (`POST /v1/transactions/m-pesa/b2c/initiate`), which needs prepaid float equal to amount plus fee.
- **Reconciliation:** collections have no list, statement or settlement-report endpoint, only the per-ID GET. Ledgers exist only for customer wallets **[V]**.
- **Fees:** not published. Payouts follow "standard M-Pesa tariffs" and the fee comes back from Pesalink verify. Collection MDR, card fees and settlement timing are all unknown **[U]**.

## 10. Other endpoints [V]
- **Payouts** (under `/v1/transactions`): `/m-pesa/b2c/initiate`, `/m-pesa/pochi/initiate`, `/m-pesa/till/initiate` and `/m-pesa/paybill/initiate`. Pesalink payouts take two steps: `POST /v1/pesalink/bank-transfer/verify`, then `/complete`.
- **Customers & wallets:** `/v1/customers` supports POST, GET and PATCH, plus lookup by phone and deactivate. The create body takes `phoneNumber` (required), `email`, `firstName`, `lastName` and `metadata`. Every customer gets a KES wallet, adjusted with `POST /v1/wallets/{customerId}/adjust`.

## 11. Fit assessment for multi-tenant gym/club SaaS
| Need | Status |
|---|---|
| Per-tenant merchant keys | Yes: separate merchant account and credentials per club. No sub-merchant API. |
| Member-number paybill (customer-initiated) | **Not supported in docs.** Use STK or payment links. |
| Near-real-time trigger | Webhook (`transaction.completed`) plus GET polling as backstop |
| Webhook security spec | **Incomplete:** header and algorithm are missing |
| Refunds and reconciliation | Missing (B2C workaround; per-ID lookups only) |
| Pricing and licensing | Unknown |

**Questions for TaifaPay:**
1. Is there a platform or sub-merchant model, and onboarding through an API?
2. Can each merchant get a dedicated paybill or till with C2B callbacks carrying `BillRefNumber`?
3. What are the webhook signature header and algorithm, the retry policy and the full list of event types?
4. Can transactions be looked up by `externalId`, and is there a transaction list or settlement report API?
5. Is there a refund API?
6. What is the fee schedule and settlement time?
7. What is the CBK licence status?
8. Can we get access to the SDKs?
