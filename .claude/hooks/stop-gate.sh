#!/usr/bin/env bash
# Stop hook: run the quick gate only if tracked source changed since the last green run.
set -uo pipefail
root="${CLAUDE_PROJECT_DIR:-.}"; cd "$root"
input="$(cat)"
echo "$input" | grep -q '"stop_hook_active":\s*true' && exit 0
stamp=".factory/.last-green"
sig="$( { git diff HEAD --stat -- apps packages scripts 2>/dev/null; git ls-files -o --exclude-standard apps packages | xargs -r sha1sum 2>/dev/null; git diff HEAD -- apps packages | sha1sum; } | sha1sum | cut -c1-40)"
[ -f "$stamp" ] && [ "$(cat "$stamp")" = "$sig" ] && exit 0
if out="$(bash scripts/factory-check.sh quick 2>&1)"; then echo "$sig" > "$stamp"; exit 0; fi
echo "$out" | tail -40 >&2
echo "factory-check quick is RED — fix before ending the turn." >&2
exit 2
