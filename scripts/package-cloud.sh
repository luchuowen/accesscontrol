#!/usr/bin/env bash
# Build the lab/prod cloud release tarball: Next standalone + static + migrations + bundled migrate/seed tools.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-/tmp/lango-app.tar.xz}"
pnpm -s tsc -b
(cd apps/web && NEXT_TELEMETRY_DISABLED=1 pnpm -s build >/tmp/lango-build.log)
D=$(mktemp -d); mkdir -p "$D/app" "$D/tools"
cp -r apps/web/.next/standalone/. "$D/app/"; cp -r apps/web/.next/static "$D/app/apps/web/.next/static"; rm -f "$D/app/apps/web/.env.local"
cp -r packages/db/migrations "$D/migrations"
# Site Bridge bundle, served to installers at /bridge/lango-bridge.mjs (and checked by SHA-256 in install.ps1).
mkdir -p "$D/app/apps/web/public/bridge"; cp -r apps/web/public/. "$D/app/apps/web/public/"
npx esbuild apps/bridge/src/main.ts --bundle --platform=node --target=node22 --format=esm --log-level=warning --outfile="$D/app/apps/web/public/bridge/lango-bridge.mjs" --banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);"
B="--bundle --platform=node --target=node22 --format=esm --log-level=warning"
npx esbuild packages/server/src/seed-cli.ts $B --outfile="$D/tools/seed.mjs" --banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);"
npx esbuild packages/server/src/pay-cli.ts $B --outfile="$D/tools/pay.mjs" --banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);"
npx esbuild packages/server/src/taifa-check-cli.ts $B --outfile="$D/tools/taifa-check.mjs" --banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);"
npx esbuild packages/server/src/stk-cli.ts $B --outfile="$D/tools/stk.mjs" --banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);"
npx esbuild packages/db/src/migrate-cli.ts $B --outfile="$D/tools/migrate.mjs"
tar -cJf "$OUT" -C "$D" . && rm -rf "$D" && ls -la "$OUT"
