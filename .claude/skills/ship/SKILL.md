---
name: ship
description: Learn and ship the open change — DECISIONS bullets, commit artifact + diff together, push, open PR. Agents never merge.
disable-model-invocation: true
---
1. Require `/verify` evidence in the artifact; if missing, run `/verify` first.
2. Fill **Learned**: 0–3 bullets; append only still-true, expensive-to-rediscover facts to `.factory/DECISIONS.md`
   (if over cap, move superseded entries to `.factory/history/decisions-<date>.md`).
3. `git add -A && git commit` (message: `<slug>: <outcome>`), artifact and diff in the same commit.
4. `git push -u origin HEAD`; open a PR with the artifact Intent + Verification as body. Never merge.
