#!/usr/bin/env bash
# SessionStart(compact|resume): restore the open change artifact, changed files and governing rules.
cd "${CLAUDE_PROJECT_DIR:-.}"
art="$(ls -t .factory/changes/2*.md 2>/dev/null | head -1)"
echo "## Factory context"
[ -n "$art" ] && echo "Open artifact: $art ($(wc -l < "$art") lines) — read it before continuing."
changed="$(git diff --name-only main...HEAD 2>/dev/null; git status --porcelain | awk '{print $2}')"
echo "Changed on branch:"; echo "$changed" | sort -u | sed '/^$/d;s/^/  - /' | head -40
echo "Rule files governing these paths (read them):"
for r in .claude/rules/*.md; do
  pats="$(sed -n '/^paths:/,/^---/p' "$r" | grep -E '^\s*-' | sed 's/^\s*-\s*//;s/"//g')"
  for p in $pats; do pre="${p%%\**}"; echo "$changed" | grep -q "^$pre" && { echo "  - $r"; break; }; done
done
echo "$changed" | grep -qE 'payments|money|period|access-state|bridge' && echo "Invariant: money is integer KES; entitlements only from matched payments or audited overrides; AccessState is derived, never hand-edited."
exit 0
