# Lango — agent rules (factory v2.1)

Pay-to-access membership SaaS that writes into Rosslare AxTraxNG via an on-site Site Bridge.
Read `docs/BLUEPRINT.md` (architecture, data model, rules, protocol) before designing anything.

## Commands
- verify quick: `bash scripts/factory-check.sh quick` · full: `bash scripts/factory-check.sh full`
- install: `pnpm install` · dev web: `pnpm --filter web dev` · fake AxTraxNG: `pnpm --filter @lango/axtrax fake`
- db: `DATABASE_URL=postgres://lango:lango@localhost:5432/lango` · migrate: `pnpm --filter @lango/db migrate`

## Loop
1. `/change <slug>` sizes the work and opens `.factory/changes/…` (trivial = no artifact).
2. Critical paths (`.factory/manifest.json`) → plan mode, `/effort high`, `access-review` agent.
3. Build. The Stop hook runs the quick gate; a red gate is a blocker, not a note.
4. `/verify` before claiming done; `/ship` to learn, commit, push, open the PR. Agents never merge.

## Working style
- Scope = the ask: pre-existing bugs and nearby cleanups go in the summary as follow-ups, not the diff.
- Tests sized like their neighbours; scratch checks are not new test files.
- Batch every read/search/command that does not depend on another's result into one response.
- Own the whole mission: the owner is usually not watching; never ask permission for work already
  requested; end the turn only when done or blocked on input only the owner has.
- Owner (Owen) wants one step at a time when he must act, saying where to run it; never ask him to paste secrets.

## Invariants without a mechanical check
- Entitlement changes come only from a matched payment or an audited override with a reason.
- AccessState is derived from entitlements; never hand-edit it or write AxTraxNG outside the bridge adapter.
- Bridge writes are idempotent desired-state convergence: GET → merge → PUT; always set `dtStopDate`.
- Every tenant-table query runs under RLS with `app.tenant_id`; the bridge may only touch its own site.
- No biometric data or AxTraxNG credentials ever leave the site.
- Client-facing copy: natural, premium, Kenyan context (KES, M-Pesa); no guessed prices.

## Memory
- `.factory/DECISIONS.md` is current truth; read it before assuming something is unbuilt.
- `/ship` appends what was learned; `factory-check` fails when it exceeds its cap → compact.
- After `/compact`/resume the SessionStart hook names the rule files to re-read; skills re-load by name.
