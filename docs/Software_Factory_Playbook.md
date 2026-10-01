# The Software Factory Playbook

**Version 2.1.0** · An AI-native development operating system for Claude Code · tuned for Claude Fable 5.1

The factory is not a document you read. It is a small set of committed files that make every session
cheaper, more correct and more autonomous than the last. This playbook defines those files, the loop they
enforce, and how the factory installs itself into a project and upgrades in place.

Sources: Anthropic's *AI-native SDLC playbook*, the Claude Code docs (CLAUDE.md, rules, skills, agents,
hooks, permissions, effort), *Prompting Claude Fable 5.1* and *Prompting Claude Sonnet 5*, and the v2.0
playbook this replaces. What changed in 2.1 is listed in §9.

---

## 0. Operating the playbook

| Situation | Say to Claude Code |
|---|---|
| Existing project | `Update the environment using the new playbook.` |
| New project | `Use the playbook to develop <ABC>.` |

Claude reads this file once, runs §6 (migrate) or §7 (init), and from then on the repository carries the
factory. Sessions read `CLAUDE.md` (~60 lines), the current change artifact, and whatever the hooks say.

---

## 1. The five principles

1. **Artifacts carry context, not conversations.** Every stage ends by committing a file the next stage
   reads. A session can be cleared, compacted, resumed or handed to another model without loss.
2. **Prose is the most expensive and least reliable enforcement.** Anything that must always hold is a
   hook, a test, a lint rule or a permission. `CLAUDE.md` keeps only what cannot be mechanised.
3. **Persistent context is a budget with a test.** The always-loaded set has line caps enforced by
   `factory-check`. Growth is compacted into history, not accumulated.
4. **Verification is what buys autonomy.** One command runs everything a contributor would run. Hooks run
   its cheap subset at turn end; CI runs the whole thing. A session that cannot make it green stops with
   the failure in front of it, never silently.
5. **Route by risk, and spend effort, not model swaps.** The manifest names the critical paths. Work inside
   them gets plan mode, `high` effort and a domain review. Everything else runs at the project default.
   Mechanical work goes to scripts first, a cheap read-only agent second.

---

## 2. Anatomy of a factory-managed repository

```
CLAUDE.md                     always loaded; ≤ 80 lines; commands, loop, working style, invariants
.factory/
  manifest.json               version, check commands, gates, protected/append-only/critical paths, caps
  DECISIONS.md                loaded via CLAUDE.md; ≤ 250 lines; current facts + lessons
  changes/TEMPLATE.md         the per-change artifact (intent → spec → plan → verification → learn)
  changes/<date>-<slug>.md    one file per non-trivial change, committed with the diff
  history/                    compacted logs and superseded files; never loaded, grep-able
.claude/
  settings.json               effortLevel, permissions (deny/ask/allow), hook wiring; committed
  hooks/guard.sh              PreToolUse: protected paths, append-only dirs, wasteful whole-file Writes
  hooks/stop-gate.sh          Stop: runs the quick gate when source changed; blocks on red
  hooks/session-context.sh    SessionStart(compact|resume): re-injects artifact + governing rules
  rules/<area>.md             path-scoped reference; loads only when a matching file is touched
  skills/factory|change|verify|ship
  agents/reviewer.md          fresh-context reviewer, model: inherit, effort: medium
  agents/<domain>-review.md   domain reviewer, model: inherit, effort: high
  agents/explorer.md          read-only summariser on the cheapest adequate model
scripts/factory-check.sh      gates | quick | full; CI calls it too
docs/Software_Factory_Playbook.md   this file; /factory migrate reads its migration entries
```

### What lives where

| Need | Mechanism | Never |
|---|---|---|
| Fact every turn needs | `CLAUDE.md` | a paragraph of explanation |
| Fact still true and expensive to rediscover | `.factory/DECISIONS.md` | narrative, superseded entries |
| Reference for one area of code | `.claude/rules/<area>.md` with `paths:` | a prohibition (rules drop after compaction) |
| Something that must never happen | `PreToolUse` hook or `permissions.deny` | a "NEVER" in prose |
| Something that must always be checked | test, lint, gate, Stop hook | a checklist |
| Context that must survive `/compact` | `SessionStart(compact)` hook | a "re-read X after compaction" line |
| Repeatable workflow with side effects | skill, `disable-model-invocation: true` | a saved prompt |
| Reading a lot to learn a little | read-only agent, cheapest adequate model | the main context |
| Adversarial verification | `reviewer` agent against the artifact | self-review in the same context |
| Evidence and history | `.factory/history/`, git log | the always-loaded set |

---

## 3. The loop (per change)

One artifact, `.factory/changes/<date>-<slug>.md`, filled section by section. Diff and artifact land in the
same commit, so git history is the audit trail.

| Step | Writes | Who | Skip when |
|---|---|---|---|
| **Intent** | the ask, the user-visible outcome, what is out of scope, every known constraint | human says it, Claude writes it | trivial (no artifact) |
| **Spec** | behaviour, files, edge cases, acceptance checks | Claude; `AskUserQuestion` only at a genuine fork | trivial |
| **Plan** | ordered steps with their verification; blast radius | plan mode for `critical`, inline for `standard` | trivial |
| **Build** | the diff | Claude, autonomously; Stop hook gates every turn | — |
| **Verify + Review** | commands run and their output; reviewer findings and fixes | `factory-check full`; `reviewer`; domain reviewer for `critical` | trivial: quick gate only |
| **Learn + Ship** | 0–3 bullets → `DECISIONS.md`; commit + PR | `/ship` | — |

**Intent is where autonomy is bought.** A fully specified first turn (constraints, out-of-scope, how it is
proven) lets the build run without further owner turns. Ambiguity discovered later is handled by doing
everything that does not depend on the answer, then stating the assumption or asking once, as the first line.

### Sizing (decided once, at Intent)

- **trivial** — one-sentence diff, no critical path, no schema, no new dependency. No artifact. Stop hook only.
- **standard** — everything else outside the critical paths. Artifact, inline plan, `reviewer`. Default effort.
- **critical** — touches `manifest.critical_paths` (money, auth, tenancy, schema, deploy). Artifact, plan mode,
  `/effort high`, `reviewer` plus the domain reviewer, property or golden tests where the manifest demands them.

`/change` applies this from the paths the intent touches; the human only overrides it. A `protected` path is
not sized: the guard hook blocks it until the owner names the exact file.

### Scope discipline (Fable 5.1)

The request is the deliverable. A pre-existing bug, a performance concern or a nearby cleanup found on the way
is reported as a follow-up, not fixed in the diff, unless the requested behaviour cannot work without it.
Tests are committed only where the ask or the repo's convention calls for them, sized like their neighbours;
scratch checks are not new test files. Existing code: Spec starts with a failing test, Plan with blast radius.
Incidents: a new change whose Intent is the incident record; `## Learned` is mandatory; a bug seen twice becomes
a test, gate or hook in the same change.

---

## 4. Model, effort and context routing

One model per session; effort is the dial. Changing effort mid-session is safe; changing the model or the
system prompt mid-session invalidates the prompt cache and the thinking blocks after it.

| Work | Where | Setting |
|---|---|---|
| Build loop, standard changes, trivial changes | main session | project default `effortLevel: medium` |
| Intent/Spec/Plan for `critical` | main session, plan mode | `/effort high` (`xhigh` only where measured) |
| Fresh-context review | `reviewer` agent | `model: inherit`, `effort: medium` |
| Critical-domain review | `<domain>-review` agent | `model: inherit`, `effort: high` |
| Read a lot, learn a little | `explorer` agent | cheapest adequate model (Haiku-class) |
| Mechanical, fully specified, high volume | a script; else `claude -p` fan-out | lowest effort that passes on three items |

Why `medium` as the default: on Claude Fable 5.1, `medium` roughly matches Claude Fable 5 quality at lower
cost, and `low` is competitive with Opus/Sonnet-class models on cost per task. Pin effort in agent frontmatter
and in `settings.json`, never in prose. Re-run the effort sweep when the model changes: level names do not map
to the same thinking across models.

Context: cache reads are cheap on Fable 5.1, so compact later rather than earlier (`/autocompact`,
`autoCompactWindow`). When compaction does happen, the `SessionStart(compact)` hook restores the open artifact,
the changed files and the rule files that govern them; skills are re-loaded by name. `/clear` between
unrelated tasks; two failed corrections → clear and re-prompt.

---

## 5. Deterministic guardrails (reference implementation)

All are in this repository and are copied by `/factory init|migrate`. Each reads the manifest, so a project
customises the factory by editing one JSON file.

- **`guard.sh`** (PreToolUse, Edit|Write). Blocks edits under `manifest.protected`; blocks edits to a file under
  `append_only_dirs` that already exists in `HEAD`; blocks a `Write` that re-emits a ≥150-line file to change
  fewer than 25 % of its lines (use Edit — same result, a fraction of the output tokens). Exit 2 with the reason.
- **`stop-gate.sh`** (Stop). If tracked source changed since the last green run, runs `factory-check quick` and
  exits 2 with the output on failure. Honours `stop_hook_active`; skips instantly on an unchanged tree.
- **`session-context.sh`** (SessionStart, `compact|resume`). Prints the open artifact and its size, the files
  changed on the branch, the `.claude/rules/*.md` whose `paths:` match them, and any invariant reminder the
  project maps to those paths. Replaces every "re-read X after compaction" sentence.
- **`factory-check.sh`** — `gates`: manifest text gates + context caps (~1 s). `quick`: gates + incremental
  typecheck (`--incremental --tsBuildInfoFile`, 6–16 s warm vs ~36 s cold). `full`: quick + tests + all guards.
  CI runs the same pieces, so local and CI never disagree about "green".
- **`settings.json`** — `effortLevel`; `deny` for the irreversible (force-push, hard reset, rebase, amend,
  secrets); `ask` for the few files whose shape is an owner decision; `allow` for read-only and verification
  commands plus the live-site health URLs, so an autonomous run is not interrupted. Path rules use `Edit(...)`.

Project-specific tripwires (for NAVAC: the PostToolUse `guards-for-path.sh` that runs the mapped guard scripts
and restates the currency invariant on finance edits) are project-owned and survive migrations untouched.

---

## 6. Mode A — existing project: `Update the environment using the new playbook.`

`/factory migrate` performs this; idempotent and version-aware.

1. **Inspect.** Read `manifest.json` (else version 0), `CLAUDE.md`, `.claude/**`, decision logs, CI config,
   package scripts, test layout. One-screen inventory: prose vs mechanised vs stale; loaded-set line cost.
2. **Preserve.** Every still-true, expensive-to-rediscover fact → `DECISIONS.md`; originals → `history/`.
3. **Mechanise.** For each prose rule: is there a hook, permission, gate, lint or test that enforces it? Wire it
   and delete the prose. Replace LLM subagents doing deterministic work with scripts or the type system.
4. **Install.** Write missing factory files; overwrite factory-owned files (`hooks/guard.sh`, `hooks/stop-gate.sh`,
   `hooks/session-context.sh`, `skills/factory|change|verify|ship`, `agents/reviewer.md`, `factory-check.sh`,
   `changes/TEMPLATE.md`); merge, never overwrite, project-owned files.
5. **Rewrite `CLAUDE.md`** to §8. Target ≤ 60 lines, cap 80.
6. **Validate.** `factory-check full`; prove each hook fires by piping tool JSON into it; record the version in
   `applied_migrations`; write a change artifact for the migration.

Incremental upgrades: `/factory migrate` applies only the `## Migration from` entries after
`manifest.playbook_version`, in order. Factory-owned files are replaced; project-owned files receive only the
listed edits. A project is never rebuilt.

---

## 7. Mode B — new project: `Use the playbook to develop ABC.`

`/factory init <name>`:

1. **Interview → `specifications.md`** on the hard parts only: data model, money/auth surfaces, device floor,
   out of scope, end-to-end proof. The one stage where back-and-forth is the point.
2. **Stack + skeleton.** Smallest stack that makes verification cheap (typed language, one test runner, one
   lint). `factory-check full` green on the empty project before any feature.
3. **Install the factory** (§2) with `critical_paths` and `gates` derived from the spec; `CLAUDE.md` from §8.
4. **Walking skeleton** as the first change: one thin slice through every layer, through the full loop.
5. **Then the loop, autonomously.** One artifact, one branch, one PR per feature. Parallel work in worktrees;
   shared surfaces are append-only registries.

---

## 8. `CLAUDE.md` template (project-owned; migrate merges into it)

```markdown
# <Project> — agent rules (factory v2.1)

## Commands
- verify quick: `bash scripts/factory-check.sh quick` · full: `bash scripts/factory-check.sh full`
- <dev / db / any command Claude cannot guess>

## Loop
1. `/change <slug>` sizes the work and opens `.factory/changes/…` (trivial = no artifact).
2. Critical paths (`.factory/manifest.json`) → plan mode, `/effort high`, domain reviewer.
3. Build. The Stop hook runs the quick gate; a red gate is a blocker, not a note.
4. `/verify` before claiming done; `/ship` to learn, commit, push, open the PR. Agents never merge.

## Working style
- Scope = the ask: pre-existing bugs and nearby cleanups go in the summary as follow-ups, not the diff.
- Tests sized like their neighbours; scratch checks are not new test files.
- Batch every read/search/command that does not depend on another's result into one response.
- Own the whole mission: the owner is usually not watching; never ask permission for work already
  requested; end the turn only when done or blocked on input only the owner has.

## Invariants without a mechanical check
- <only the rules no hook, lint or test can enforce; ≤ 8 bullets>

## Memory
- `.factory/DECISIONS.md` is current truth; read it before assuming something is unbuilt.
- `/ship` appends what was learned; `factory-check` fails when it exceeds its cap → compact.
- After `/compact`/resume the SessionStart hook names the rule files to re-read; skills re-load by name.
```

---

## 9. Versioning and migrations

`manifest.json` keys: `playbook_version`, `applied_migrations`, `checks` (`typecheck`, `test`, `guards`, …),
`gates[]` (`name`, `pattern`, `paths`, `exclude`), `protected[]`, `append_only_dirs[]`, `critical_paths[]`,
`source_globs[]`, `caps{}`. Semantic versioning: patch = factory-owned file fix; minor = new mechanism or
additive manifest key; major = a change to the loop or to project-owned files. `/factory status` prints the
version, pending migrations, the loaded-set budget and gate results.

### Migration from 2.0.0 (Fable 5.1 tuning)

Goal: fewer tokens per change, fewer owner turns, same or better quality. Nothing in the loop changes.

- **Effort replaces model swaps.** `settings.json`: `"effortLevel": "medium"`. Agents: `model: inherit` with an
  `effort:` pin (`reviewer` medium, domain reviewer high); the explorer keeps the cheapest model. Drop every
  "Sonnet-class / top tier" sentence from prose.
- **`session-context.sh`** wired as `SessionStart` with matcher `compact|resume`. Delete the "re-read the rule
  after compaction" line from `CLAUDE.md`.
- **`guard.sh`** gains the whole-file-rewrite check (Write, ≥150 lines, <25 % changed → exit 2).
- **`factory-check quick`** uses an incremental typecheck; add the buildinfo path to `.gitignore`.
- **`CLAUDE.md`** gains the four-line *Working style* block (scope, tests, batching, own the mission) and the
  effort note on the critical-path line.
- **`reviewer.md`** states a concrete reporting bar (any bug that could cause incorrect behaviour, a test
  failure or a misleading result; omit only pure style) instead of "never style" — newer models follow a
  vague bar literally and under-report.
- **`/change`** asks for every known constraint in Intent and, for `critical`, for `/effort high`.
- Owner options, not applied automatically: widen `permissions.allow` to `git add/commit/push -u origin`
  and the live health URLs so `/ship` runs prompt-free; raise `autoCompactWindow`.

### Migration from 1.x

Replace the six-stage prompt sequence with the change artifact and sizing table; move retrofit-checklist items
into mechanisms (frozen paths → `guard.sh`, self-verification → `factory-check` + Stop hook, gotchas →
`DECISIONS.md` with a cap, situational knowledge → `.claude/rules/`); replace prose model tables with pinned
tiers; drop the monthly manual reset. Keep worktrees for parallel work, `/clear` between unrelated tasks,
evidence over assurances, `claude -p` fan-out tested on three items first. Then apply 2.0.0 → 2.1.0.

### Migration from 0 (no factory)

Run §6 in full.

---

## 10. Deliberately left out

- **No per-session ritual prompts** — skills and a template; a human types one line.
- **No prose Definition-of-Done** — every item became a gate, lint, type, test or hook.
- **No LLM subagent for deterministic checks** — tokens are spent on judgment only.
- **No harness-level prompt lines duplicated in `CLAUDE.md`.** Progress updates, append-only history, quoting
  rules and compaction-summary instructions are the harness's job (Claude Code already does them); the
  playbook adds only what a repository can enforce or a repository-specific line can change.
- **No global auto-memory reliance** — memory that matters is committed.
- **No metrics dashboards** — `/factory status` and the git log are the measurement.
