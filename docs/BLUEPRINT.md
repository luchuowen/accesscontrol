# Lango — System Blueprint (v1)

Working name **Lango** (Swahili: gate). Final brand to be agreed with John.
Pay-to-access membership platform: a multi-tenant cloud business system that writes member access
directly into Rosslare AxTraxNG through an on-site **Site Bridge**.

Sources: `docs/research/*` (AxTraxNG REST API v2.0 spec, TaifaPay docs, meeting prep, AxTraxNG PDFs),
John's requirements (`docs/research/john-requirements.md`).

---

## 1. Mission and proof

- **Mission:** payment → entitlement → door, with no human in the loop; internet never locks anyone out;
  owners see every shilling; staff cannot quietly extend access.
- **Proof 1 (John's "90 %" test):** pay KES 10 via TaifaPay → member's `dtStopDate` / access group change
  in the AxTraxNG client within seconds, untouched by staff.
- **Proof 2:** John's demo kit (AC-825IP + reader + lock): pay → tap → open; lapse → tap → denied.

## 2. System context

```
 Member phone ──► Member Portal (PWA) ─┐
 Reception PC ──► Staff Console ───────┤        ┌──────────── CLIENT SITE (LAN) ────────────┐
 John ─────────► Partner Console ──────┤        │                                            │
                                       ▼        │  Site Bridge (Windows service)             │
                 ┌──────── Lango Cloud ───────┐ │   ├ outbound HTTPS long-poll  ◄────────────┼── no inbound ports
 TaifaPay ──────►│ Next.js app + API          │◄┼───┤ local journal (desired state, schedule)│
  (webhooks)     │ Postgres (RLS per tenant)  │ │   └ AxTraxNG adapter ──► REST API :8080     │
 Source Code ◄───│ Worker (jobs, SMS, recon)  │ │                          ▼                 │
  SMS            └────────────────────────────┘ │            AxTraxNG Server + SQL Server    │
                                                │                          ▼ auto download   │
                                                │            Panels (AC-825IP…) ─ readers ─ doors
                                                └────────────────────────────────────────────┘
```

**Ownership rule:** the cloud owns *who may enter and until when*; AxTraxNG + panels own *enforcement*.

## 3. AxTraxNG facts that shape the design

| Fact (from REST API v2.0 spec) | Design consequence |
|---|---|
| REST service is LAN-only, HTTP, Windows, port 8080; `POST /token` (password grant), bearer on every call | Site Bridge on the AxTraxNG server, talks to `localhost:8080`; cloud never reaches the site |
| Every response is `{Data, Errors}`, HTTP 200 even on failure | Adapter treats non-empty `Errors` as failure |
| User = `EmployeeInfoDT`: `EmpNumCompany` (user number), `bValidDate`, `dtStartDate`, `dtStopDate`, `bAccessDenied`, `UserAccGrp`, `UserDepartment`, `UserCards[]` | Member number = `EmpNumCompany` = M-Pesa account ref |
| **One access group per user** (`UserAccGrp`) | Bridge maintains *combination* groups (`LG: Gym+Sauna`) built from zone readers |
| Card = `CardInfoDT` (`iSiteCode`, `iCardCode`, `eCardType`, `wStatus` 0 free/1 active/2 inactive, `IdEmpNum`) | Cards suspended/activated per state; "tap to link" via free cards / denied events |
| Access group = `AccessGroupDT.TimezoneReaders[{IdReader, IdTimeZone}]`; TZ 2 = Always | Zone = set of readers; combo group = union of zone readers with TZ "Always" (or plan time zone) |
| Events: `GET EventPanelInfo/GetAccessEvent?from&to&limit` (≤5000, no cursor); SignalR 2 `AccessEventsHub` | Sliding-window poll + dedupe by `ID`; SignalR later |
| Server auto-downloads hardware-related changes to panels | No sync endpoint needed; bridge watches panel status |
| Panels hold users + dates and decide offline | Write **dates ahead**, never "revoke now" |

Unverified, must be proven in the lab (change `0001`): partial `UpdateUser` semantics (we always GET → merge → PUT),
whether `bValidDate` must be true, local-time vs UTC for dates, token TTL, AddUser with `EmpNumCompany` collision.

## 4. Components

### 4.1 Cloud (`apps/web`, one deployable)
- **Next.js (App Router) + TypeScript**, Tailwind + shadcn/ui, premium design system (dark/light).
- Route groups: `/(staff)` staff console, `/(partner)` partner console, `/m` member portal (PWA, phone-first),
  `/api/bridge/*`, `/api/webhooks/taifapay/[tenant]`, `/api/cron/*`.
- **Postgres 16** with row-level security: every tenant table has `tenant_id`, sessions set `app.tenant_id`.
- **Jobs:** Postgres-backed queue (`pg-boss`), no Redis. Jobs: apply payment, recompute access, SMS send,
  expiry reminders, reconciliation, event ingestion.
- Auth: staff = email/phone + password (+ SMS OTP for owners/managers); members = phone + SMS OTP.

### 4.2 Site Bridge (`apps/bridge`)
- Node 22 TypeScript service packaged as a single Windows executable, run as a Windows service (WinSW).
  Installer = MSI/zip + `pair <code>` command. Config in `%ProgramData%\Lango\bridge.json` (DPAPI-protected secret).
- **Outbound only:** `POST /api/bridge/pair`, then long-poll `GET /api/bridge/sync?cursor=` (25 s hold).
- **Declarative desired state, not commands:** the cloud sends per-member `AccessState` documents with a
  version; the bridge converges AxTraxNG to them. Re-sending is harmless (idempotent).
- **Local journal** (`journal.json` + append log): last applied state per member, pending schedule, event cursor.
- **Local scheduler:** applies future segments (e.g. sauna add-on ends before gym) at the right minute
  without internet.
- **Tamper Guard:** every 10 min (configurable) reads AxTraxNG users and compares with journal; drift →
  re-apply desired state + report `drift` event (old/new values) to cloud → owner alert.
- **Event pump:** every 5 s `GetAccessEvent` window `[last-60s, now]`, dedupe by `ID`, batch upload.
- **Discovery:** on pair and on demand, uploads panels, doors, readers, access groups, departments, users.
- Adapter interface (`AccessAdapter`) so AxTraxPro / ZKTeco can be added later.

### 4.3 Shared packages
- `packages/core` — pure domain logic, no I/O: period maths (calendar month in Africa/Nairobi), entitlement
  merge, payment → plan matching, AccessState derivation, zone-set → combo-group naming. Property-tested.
- `packages/db` — Drizzle schema + migrations + RLS policies + seed (demo club).
- `packages/axtrax` — typed AxTraxNG client (from the v2.0 spec) **and a fake AxTraxNG server**
  (in-memory, same endpoints/envelope) so everything is buildable and testable without Windows.
- `packages/protocol` — zod schemas for bridge ⇄ cloud messages, versioned.

## 5. Data model (Postgres)

Tenancy: `partners` → `tenants` (a client business) → `sites` (a location with one AxTraxNG server) → `bridges`.

| Table | Key columns |
|---|---|
| `tenants` | id, partner_id, name, slug, timezone (default Africa/Nairobi), currency KES, settings jsonb |
| `staff_users`, `staff_roles` | role ∈ owner, manager, reception, accountant, partner_admin; tenant scoped |
| `sites` | tenant_id, name, address |
| `bridges` | site_id, status, last_seen_at, version, secret_hash, adapter='axtraxng' |
| `zones` | tenant_id, site_id, name (Gym, Sauna, Pool…), reader_ids int[] (AxTraxNG `IdReader`) |
| `products` | tenant_id, kind ∈ membership, day_pass, addon, bundle; name; price_kes; duration {unit: day\|month, count}; zone_ids[]; time_zone_id? ; active |
| `members` | tenant_id, member_no (unique per tenant, int ≤ 6 digits, = `EmpNumCompany`), names, phone, email, photo, status, category |
| `credentials` | member_id, kind ∈ card, tag, wristband, biometric_ref; site_code, card_code, card_type; status |
| `entitlements` | member_id, zone_id, starts_at, ends_at, source ∈ payment, override, import; source_id |
| `payment_intents` | member_id, product_id, amount, phone, provider, external_id (unique), status |
| `payments` | tenant_id, provider, provider_txn_id (**unique**), amount, account_ref, phone, status, raw jsonb, matched_member_id, matched_product_id |
| `wallet_entries` | member_id, amount (+/-), reason — over/under-payments |
| `overrides` | member_id, staff_id, change, reason (required), approved_by |
| `access_states` | member_id, site_id, version, doc jsonb (desired AccessState), applied_version, applied_at |
| `access_events` | site_id, axtrax_event_id (unique per site), member_id?, zone_id?, door, granted bool, at |
| `drift_reports` | site_id, member_id, field, axtrax_value, expected_value, at, resolved |
| `sms_messages` | tenant_id, to, body, kind, provider_id, status |
| `audit_log` | append-only: actor, action, entity, before, after, at (DB trigger forbids UPDATE/DELETE) |

**AccessState** (protocol, per member per site):
```json
{ "memberNo": 21001, "name": ["Jane","Wanjiru"], "version": 7,
  "credentials": [{"siteCode":0,"cardCode":21001,"cardType":1}],
  "segments": [ {"from":"2026-10-01T00:00","until":"2026-10-07T23:59","zones":["gym","sauna"]},
                {"from":"2026-10-08T00:00","until":"2026-10-31T23:59","zones":["gym"]} ] }
```
Bridge applies: `bValidDate=true`, `dtStartDate`=first.from, `dtStopDate`=last.until, `UserAccGrp`=combo group of
the *current* segment (Unauthorized group if no segment is current), cards active if any future segment, else inactive.

## 6. Core rules (packages/core)

1. **Period:** `month` = same day next calendar month minus one day, ending 23:59:59 local
   (Oct 1 → Oct 31; Jan 31 → Feb 28/29; clamps). `day` = N days ending 23:59:59. Day pass = today 23:59:59.
2. **Renewal anchor:** if the member's entitlement for the product's zones is still active, the new period starts
   the minute after current `ends_at`; if lapsed, it starts at payment time (start of today).
3. **Payment matching** (in order): `payment_intent.external_id` → `account_ref` = member_no + exact product price
   → account_ref = member_no + tenant amount table (John's "5000 = gym month, 200 = swim") → else credit wallet
   and alert reception. Never extend from an unmatched amount.
4. **Idempotency:** `payments.provider_txn_id` unique; job `apply_payment(payment_id)` is a no-op if already applied.
5. **Overrides** (comp days, goodwill) require reason + role ≥ manager (configurable) and are audited and reported.
6. **AccessState** = union of a member's entitlements per site, cut into segments where the zone set changes.

## 7. Flows

- **Enrol (first time, at reception):** create member (number allocated) → AccessState with no segments → bridge
  creates AxTraxNG user (`EmpNumCompany`=member_no, Unauthorized group) → reception presents card/wristband at
  enrolment reader → denied event with unknown `iCardCode` appears in "Tap to link" → staff links → bridge
  `AddCard` / `UpdateCard` (`IdEmpNum`, `wStatus=1`). Biometric enrolment keeps the vendor tool; credential code
  is read back by user number.
- **Pay (portal or reception):** choose product → `POST /v1/transactions/m-pesa/c2b/initiate` (externalId =
  intent id, accountReference = member_no) → webhook → verify → `payments` insert (unique) → `apply_payment` →
  entitlements → AccessState v+1 → bridge long-poll wakes → AxTraxNG updated → ack → SMS receipt.
- **Walk-in day pass:** pool of wristband members (`member_no` range, e.g. 11001–11999, John's convention) →
  sell → entitlement today → returns to pool at 23:59.
- **Import existing site:** bridge discovery uploads users → wizard matches by `EmpNumCompany` → current
  `dtStopDate`/group become `import` entitlements → nothing re-enrolled.

## 8. Bridge ⇄ cloud protocol (v1)

| Call | Body / response |
|---|---|
| `POST /api/bridge/pair` | `{code, machine, adapter, version}` → `{bridgeId, secret}` |
| `GET /api/bridge/sync?cursor=n&wait=25` | → `{cursor, states:[AccessState], directives:[discover\|resync\|ensureGroups]}` |
| `POST /api/bridge/ack` | `{results:[{memberNo, version, ok, error?, axtraxUserId}]}` |
| `POST /api/bridge/events` | `{events:[{id, at, readerId, doorId, userNo, cardCode, siteCode, type}]}` |
| `POST /api/bridge/inventory` | panels, doors, readers, groups, users snapshot |
| `POST /api/bridge/drift` | `[{memberNo, field, found, expected}]` |
| `POST /api/bridge/heartbeat` | `{panelsOnline, queueDepth, lastAxtraxOk}` |

Auth: `Authorization: Bridge <bridgeId>:<HMAC-SHA256(secret, method|path|timestamp|sha256(body))>` + timestamp
(±5 min). TLS only.

## 9. Integrations

- **TaifaPay** (`docs/research/taifapay.md`): `POST /v1/auth/token`, STK `POST /v1/transactions/m-pesa/c2b/initiate`,
  checkout `POST /v1/checkout/invoices`, status `GET /v1/transactions/{id}`, webhook `transaction.completed`.
  Per-tenant credentials (each club its own merchant). Open questions to TaifaPay: paybill C2B with free
  account reference; webhook signature header/algorithm; retry policy. Until answered: verify every webhook by
  re-querying `GET /v1/transactions/{id}`. `PaymentProvider` interface leaves room for Daraja C2B.
- **Source Code SMS:** `SmsProvider` interface; credentials per platform (NAVAC account), sender ID per tenant
  later. API details pending portal access.

## 10. Non-functional

- Payment → AxTraxNG write: p95 < 10 s when site online.
- Bridge survives reboot, AxTraxNG restart, internet loss; resumes from journal.
- Security: secrets in env/Secret Manager; bridge secret DPAPI; RLS; audit log append-only; no biometric data in cloud;
  Kenya DPA: consent flag, export, retention settings.
- Observability: structured logs, `/api/health`, site health in Partner Console.

## 11. Environments and hosting (recommended)

| Env | Where |
|---|---|
| Dev / CI | Container: Postgres 16 + fake AxTraxNG; all tests run without Windows |
| Lab (mimic John) | **Google Cloud Compute Engine, Windows Server 2019 Datacenter, e2-standard-2, 60 GB SSD, region africa-south1 (Johannesburg)**: AxTraxNG 27.7.1.2x + SQL Express (VERITRAX) + REST API 2.0 + Site Bridge. RDP restricted to Owen's IP. |
| Production | Cloud Run (africa-south1) for `apps/web` + worker; Cloud SQL Postgres 16; Secret Manager; domain e.g. `lango.navac.co.ke` |

Why GCP: Owen already runs Cloud Run/Firebase there; Johannesburg is the closest region to Nairobi; Windows
licence is included in the VM price. Shut the lab VM down when not in use (budget alert required).

## 12. Build order (each = one change artifact)

1. `0001-walking-skeleton` — monorepo, core period maths, fake AxTraxNG, bridge converging one AccessState into
   the fake, cloud endpoint serving it. Proves the loop end-to-end in CI.
2. `0002-tenancy-and-auth` — tenants, staff, RLS, sessions.
3. `0003-catalog-and-members` — zones, products, members, credentials, enrolment.
4. `0004-payments-taifapay` — intents, STK, webhook, apply_payment, receipts. *(critical)*
5. `0005-bridge-real-axtrax` — lab VM validation of §3 unknowns, combo groups, discovery/import. **Proof 1.**
6. `0006-events-dashboard` — event pump, attendance, executive dashboard, reconciliation.
7. `0007-tamper-guard-overrides`, `0008-sms`, `0009-member-portal`, `0010-partner-console`, `0011-bridge-installer`.
