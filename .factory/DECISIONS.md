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
- VERIFIED on real AxTraxNG 27.7.1.20 + REST 2.0 (lab, 2026-10-01): token via `POST /token` form (operator
  Administrator; TTL 259199 s); naive local ISO dates round-trip exactly; a partial `UpdateUser` ({ID, dtStopDate})
  returns no error but changes nothing → always GET-merge-PUT; empty `AccessGroup/Add` works; default groups
  Master=1, Unauthorized=1000000; department General=1; time zones Never=1, Always=2.
- Wiegand-26 (eCardType 1) card codes must be ≤ 65535 ("card N is not valid") → member numbers used as card codes
  stay in 1..65535 (John's 1xxxx/2xxxx/3xxxx scheme fits).
- REST service starts ~2 min after boot; clients must retry token acquisition.
- Cloud lab DB owner role has BYPASSRLS (migrations/seed only); app role never.
