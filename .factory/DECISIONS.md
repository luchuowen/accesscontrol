# DECISIONS — current truth (cap 250 lines; compact superseded entries into history/)

## Product
- Working name Lango; brand TBD with John. Multi-tenant: Partner → Tenant → Site → Bridge.
- Cloud owns entitlement; AxTraxNG + panels enforce. Dates are written ahead; never rely on "revoke now".
- member_no = AxTraxNG EmpNumCompany = M-Pesa account reference; permanent.

## Architecture
- Monorepo pnpm: apps/web (Next.js + API), apps/bridge (Windows service), packages/core|db|axtrax|protocol.
- Bridge is outbound-only long-poll; desired-state (AccessState, versioned) convergence; local journal + scheduler.
- AxTraxNG allows one access group per user → bridge maintains combo groups named `LG: <zones sorted>`.
- Postgres RLS by tenant_id; jobs on pg-boss; no Redis.
- Fake AxTraxNG server (packages/axtrax) is the test double for everything above the HTTP boundary.

## Integrations
- TaifaPay: per-tenant credentials; webhook verified by re-query (signature scheme undocumented as of 2026-10-01).
- Source Code SMS: provider interface; API docs need portal login.

## Lessons
- App DB role `lango_app` (no BYPASSRLS); migrations run as owner. FORCE RLS on all tenant tables.
- Future-dated plans: set next segment's group now; panel enforces dtStartDate (offline-safe).
- Tamper Guard = periodic idempotent converge; any change it makes is drift or a scheduled switch.
- AxTraxNG NG is EOL 31 Dec 2026 (support to Dec 2027); AxTraxPro adapter is the next adapter.
