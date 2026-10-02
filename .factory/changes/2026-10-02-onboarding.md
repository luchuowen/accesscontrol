# 2026-10-02 club onboarding + TaifaPay as default gateway

**Size:** large · **Critical paths:** payments, bridge, db/RLS, auth

## Why
NAVAC earns on every TaifaPay transaction, and clubs like Muthaiga already run AxTraxNG and a paybill. Onboarding a
club (and John's existing installations) has to be quick, and no payment may be missed.

## What changed
- Partner console (`/partner`): clubs, setup progress, TaifaPay vs cash volume; "Add a club" in one form; open any club.
- Club setup checklist (Overview + Settings), computed from live data.
- Settings: payment channels (paybill/till/links only, settlement), team (add/deactivate), change password.
- Plans editor with unique active prices. Zones ↔ readers editor fed by the bridge's AxTraxNG inventory.
- Import existing AxTraxNG users (group selection, staff excluded, grace period, end dates kept).
- Missed-payment queue on Payments. Cash-only desk with recorded-by.
- TaifaPay: real API base `/api/v1`, reconciliation poller, card/bank channel from the record.
- Site Bridge: inventory upload, `site.json` settings, downloadable installer.

## Verification
53 tests green (import keeps access and leaves staff untouched on the fake AxTraxNG; queue; partner functions;
reconcile). Browser smoke on a production build: settings, plans (duplicate price refused), team, zones, partner
create → open club. Live: real KES 10 STK payment settled via re-query after the webhook never arrived.
