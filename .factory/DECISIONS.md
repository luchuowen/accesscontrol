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
- Directory tables (staff_users, bridges) are invisible to the app role; it uses narrow SECURITY DEFINER `app_*`
  functions (0003), EXECUTE revoked from PUBLIC. tenants/partners are read-only to the app role.
- Payments serialise per member (`for update`); access_states writes take a per-site advisory lock so seq order =
  commit order (bridge cursor never skips). Sites are locked in id order.
- TaifaPay webhook trusts only its own GET of the transaction; unreadable records → 502 + audit (provider retries).
- Bridge: acks deduped per member and retried; events paged with 10-min overlap; hourly full resync (cursor 0);
  Tamper Guard every 10 min. Group reader updates are best-effort (members still converge).
- Rate limits: per-IP (last X-Forwarded-For hop, Caddy) for all attempts; per-account for failures only.
- TaifaPay live API base is `https://merchants.taifapay.africa/api/v1` (the documented `/v1` serves the dashboard
  HTML with HTTP 200). Key checks treat non-JSON or 5xx as "unreachable", 400/401/403 as "rejected".
- TaifaPay is the only fee-bearing gateway: card/bank go through TaifaPay; the desk records cash only (with who).
  A club's own paybill/till is linked on TaifaPay (Path A); clubs without one use TaifaPay links/prompts (Path B).
- TaifaPay webhooks can be missed (seen live 2026-10-02): a 60 s poller settles pending STK/invoice requests through
  the same code path as the webhook, exactly once.
- Onboarding: partner_admin (partner_id null = NAVAC platform) creates clubs in one step (`app_create_club`) and opens
  any club as owner. The Site Bridge sends an AxTraxNG inventory (readers, groups, users+cards) for zone mapping and
  member import; staff groups are never imported; imported users keep today's end date or get a grace period.
- Site Bridge installs with `irm <lango>/bridge/install.ps1 | iex`; the AxTraxNG login stays in
  C:\ProgramData\Lango\site.json (SYSTEM/Administrators only).
- Active plans have unique prices (a paybill payment must match exactly one plan); mismatches go to the
  missed-payment queue, where staff assign them (amount must equal the plan price).
