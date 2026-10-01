#!/usr/bin/env bash
# Usage: factory-check.sh gates|quick|full   — same entry point for hooks, humans and CI.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-quick}"
step() { echo "▸ $1"; shift; "$@"; }
step gates node scripts/gates.mjs
[ "$mode" = gates ] && exit 0
step typecheck pnpm -s tsc -b --pretty false
[ "$mode" = quick ] && exit 0
step lint pnpm -s biome check .
step test pnpm -s vitest run
echo "✔ factory-check $mode green"
