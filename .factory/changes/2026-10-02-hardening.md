# 2026-10-02 hardening (two review passes)

**Size:** large · **Critical paths:** payments, access, bridge, db/RLS, auth

## Why
Independent reviews of the walking skeleton found races (concurrent payments, seq vs commit order), webhook trust
gaps, app-role access to directory tables, weak console role checks, and bridge ack/event reliability issues.

## What changed
- 0003 directory functions + grants; legacy pair codes reissued in the new format with 30-day expiry.
- payments/access locking; per-zone renewal; intents completed atomically; desk payments audited to the staff user.
- TaifaPay: strict record parsing, intent amount match, 502 on unreadable, club-time paidAt.
- Bridge: ack dedupe/retry, event paging, hourly resync, 10-min guard, guarded group reader reconcile.
- Web: login/portal rate limits (failures-only per account), timing-equal login, deactivated staff signed out,
  role checks, W26 (1..65535) validation, result notices.

## Verification
`factory-check full` green: 46 tests (concurrent payments, envelope trick, unreadable webhook, ack failure,
pairing rotation/expiry, group reconcile). Legacy pair-code upgrade checked on a 0001+0002 database.
Lab: deploy v4 + bridge 9ab90277 + Proof 2 (results/45-proof, 46-verify-axtrax).
