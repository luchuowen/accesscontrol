# Lango — specifications (hard parts only; detail in `docs/BLUEPRINT.md`)

## Data model
Partner → Tenant → Site → Bridge. Member (permanent `member_no` = AxTraxNG `EmpNumCompany` = M-Pesa account ref)
→ Credentials, Entitlements (member × zone × [starts, ends]). Products (membership/day pass/addon/bundle) map to
zones. Desired AxTraxNG state per member = `AccessState` (versioned), derived, never hand-edited.

## Money surfaces (critical)
- TaifaPay STK + checkout; webhook verified by re-querying the transaction; `provider_txn_id` unique.
- Entitlement only from a matched payment or an audited override with reason. Unmatched → wallet + alert.
- Integer KES, no floats. Period maths in tenant timezone (Africa/Nairobi).

## Auth / tenancy surfaces (critical)
- Postgres RLS on every tenant table; app sets `app.tenant_id` per request/transaction.
- Roles: partner_admin, owner, manager, reception, accountant; members via phone OTP.
- Bridge auth: HMAC per request with per-bridge secret; outbound only.

## Device floor
- Staff console: desktop/laptop Chrome/Edge, 1280 px+. Member portal: Android phone, 360 px, 3G.
- Site Bridge: Windows 10 / Server 2016+ (same machine as AxTraxNG 27.7.1.20+, REST API 2.0).

## Out of scope (v1)
Biometric template capture (vendor tool stays), AxTraxPro/ZKTeco adapters, POS/inventory, payroll,
accounting ledger beyond reconciliation report, native mobile apps.

## End-to-end proof
1. CI: payment webhook (fixture) → fake AxTraxNG user `dtStopDate` and `UserAccGrp` updated, within the test.
2. Lab: KES 10 TaifaPay payment → real AxTraxNG client shows new date/group < 10 s.
3. Hardware: John's kit — pay → open; lapse → denied.
