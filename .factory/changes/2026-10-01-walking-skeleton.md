# 0001-walking-skeleton — 2026-10-01
Size: critical (money, access-state, bridge, schema) · Branch: change/0001-walking-skeleton

## Intent
- Ask: thinnest end-to-end slice — payment → entitlement → AccessState → Site Bridge → AxTraxNG → door decision.
- Outcome: CI proves a KES 5000 payment opens the gym door (not the sauna) via the real bridge code against a
  fake AxTraxNG with the v2.0 API shape; replays never double-extend; unknown amounts are held.
- Out of scope: UI, TaifaPay HTTP, SMS, pairing, Windows packaging, real AxTraxNG (lab VM in progress).
- Constraints: integer KES; Africa/Nairobi; one access group per AxTraxNG user; outbound-only bridge; RLS.

## Spec
- packages/core: periodEnd/nextPeriod (calendar month, clamp, 23:59:59; renewal anchor), toSegments/desiredAt/comboGroupName.
- packages/axtrax: typed client ({Data,Errors} envelope, bearer, 401 retry) + FakeAxtrax with panel `swipe()`.
- packages/protocol: zod AccessState, SyncResponse, Ack, Events. packages/db: SQL migration 0001 + RLS + migrate().
- apps/bridge: converge (GET→merge→PUT, combo groups, card status), Bridge (pull/apply/ack/events/guard), Journal.
- apps/web: recordPayment/applyPayment, rebuildAccessState, bridge API handlers (HMAC + timestamp), Next routes.
- Acceptance: `bash scripts/factory-check.sh full` green; e2e.test.ts 8/8; converge.test.ts 6/6.

## Verification
- factory-check full → gates ok, tsc -b ok, web tsc ok, biome ok, vitest 34/34 (core 20, bridge 6, e2e 8).
- Proven: unpaid → denied; 5000 → gym granted, sauna denied; replay → duplicate, 1 entitlement; 4999 → unmatched;
  600 add-on → sauna granted + `LG: gym + sauna` group; events uploaded once; RLS cross-tenant = 0 rows;
  forged signature → 401; Tamper Guard reverts a manual 6-month extension.

## Learned
- Superusers and table owners bypass RLS: the app connects as `lango_app`; tests use separate owner/app URLs.
- Paid-in-advance members get their next zone group immediately; AxTraxNG's dtStartDate gates entry offline.
