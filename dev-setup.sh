#!/bin/bash
# One-time local setup for Lango on a Mac. Run it from the repository folder: bash dev-setup.sh
set -e
command -v brew >/dev/null || { echo "Homebrew is missing. Install it from https://brew.sh, then run this again."; exit 1; }
command -v psql >/dev/null || { brew install postgresql@16 && brew link --force postgresql@16; }
brew services start postgresql@16 >/dev/null 2>&1 || brew services start postgresql >/dev/null 2>&1 || true
command -v pnpm >/dev/null || npm install -g pnpm@10.28.0
for i in 1 2 3 4 5; do pg_isready -q && break; sleep 2; done
psql postgres -tAc "select 1 from pg_roles where rolname='lango'" | grep -q 1 || psql postgres -qc "create role lango login superuser password 'lango'"
psql postgres -tAc "select 1 from pg_roles where rolname='lango_app'" | grep -q 1 || psql postgres -qc "create role lango_app login password 'lango_app'"
psql postgres -tAc "select 1 from pg_database where datname='lango'" | grep -q 1 || psql postgres -qc "create database lango owner lango"
if [ ! -f apps/web/.env.local ]; then
  cat > apps/web/.env.local <<ENV
DATABASE_URL=postgres://lango_app:lango_app@localhost:5432/lango
DATABASE_OWNER_URL=postgres://lango:lango@localhost:5432/lango
SESSION_SECRET=$(openssl rand -hex 32)
APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
PUBLIC_URL=http://localhost:3000
ENV
fi
pnpm install
pnpm -s tsc -b
DATABASE_OWNER_URL=postgres://lango:lango@localhost:5432/lango DATABASE_URL=postgres://lango_app:lango_app@localhost:5432/lango \
  SEED_OWNER_EMAIL=luchuowen@gmail.com SEED_OWNER_NAME="Owen Luchu" SEED_ADMIN_EMAIL=owen@navac.co.ke SEED_ADMIN_NAME="Owen Luchu" \
  SEED_OWNER_PASSWORD=lango-local-demo SEED_NAME="Demo Club" npx -y tsx@4 packages/server/src/seed-cli.ts
echo
echo "Ready. Start it with:  pnpm --filter web dev    then open http://localhost:3000"
echo "Sign in as luchuowen@gmail.com (club owner) or owen@navac.co.ke (NAVAC admin). Password: lango-local-demo"
