---
name: change
description: Open a change — size it (trivial/standard/critical) and create .factory/changes/<date>-<slug>.md from the template.
disable-model-invocation: true
---
Arg: `<slug>` plus the owner's ask.
1. Decide size from the paths the intent touches: any `critical_paths` in `.factory/manifest.json` → **critical**;
   one-sentence diff, no schema/dependency → **trivial** (no artifact, stop here); else **standard**.
2. Copy `.factory/changes/TEMPLATE.md` to `.factory/changes/$(date +%F)-<slug>.md`; fill **Intent** with the ask,
   user-visible outcome, out of scope, and every known constraint (ask once for missing ones, as the first line).
3. Fill **Spec** (behaviour, files, edge cases, acceptance checks; existing code → start with a failing test).
4. critical → enter plan mode, tell the owner to run `/effort high`, plan with blast radius; standard → inline plan.
5. `git switch -c change/<slug>` if on main.
