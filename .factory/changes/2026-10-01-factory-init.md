# factory-init — 2026-10-01
Size: standard · Branch: main (initial commit)

## Intent
- Ask: set up the repository with Software Factory Playbook v2.1 (Mode B, new project) for Lango.
- Outcome: committed factory (CLAUDE.md, manifest, hooks, skills, agents, gates, CI), blueprint, spec, research.
- Out of scope: features (walking skeleton is change 0001).

## Spec
- `bash scripts/factory-check.sh full` green on the empty monorepo; hooks proven by piping tool JSON.

## Verification
- factory-check full → gates ok, tsc ok, biome ok, vitest 1 passed.
- guard: protected manifest → exit 2; normal file → 0; 200-line Write changing 1 line → exit 2.
- stop-gate: clean → 0; injected type error → exit 2 with tsc output. session-context prints artifact/changes.

## Learned
- Hooks implemented in node (guard.mjs) so they run identically on macOS, Linux and CI without jq.
