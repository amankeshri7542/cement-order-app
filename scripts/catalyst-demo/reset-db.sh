#!/usr/bin/env bash
# Resets the Catalyst demo database to a clean seed: drops and recreates ONLY the database named
# in NEON_OWNER_URL (it must end in /shiv_demo), then migrations, runtime grants, sample catalogue
# and the two demo owners. Reads .local/demo/neon.env and .local/demo/secrets.env; prints no secrets.
# Usage: bash scripts/catalyst-demo/reset-db.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
set -a
. "$root/.local/demo/neon.env"
. "$root/.local/demo/secrets.env"
set +a

db="$(python3 -c 'import os,urllib.parse as u; print(u.urlparse(os.environ["NEON_OWNER_URL"]).path.lstrip("/"))')"
if [ "$db" != "shiv_demo" ]; then
  echo "Refusing: NEON_OWNER_URL points at '$db', not shiv_demo" >&2
  exit 1
fi
# Same server and owner, maintenance database neondb, to drop and recreate shiv_demo.
admin_url="$(python3 -c 'import os,urllib.parse as u; p=u.urlparse(os.environ["NEON_OWNER_URL"]); print(u.urlunparse(p._replace(path="/neondb")))')"

echo "== drop and recreate shiv_demo"
psql "$admin_url" -v ON_ERROR_STOP=1 -q -c 'DROP DATABASE IF EXISTS shiv_demo WITH (FORCE)'
psql "$admin_url" -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE shiv_demo OWNER neondb_owner'

cd "$root/apps/api"
echo "== migrations"
DATABASE_URL="$NEON_OWNER_URL" npx prisma migrate deploy | tail -1
echo "== runtime grants"
psql "$NEON_OWNER_URL" -v ON_ERROR_STOP=1 -q -v database=shiv_demo -v migration_role=neondb_owner \
  -v runtime_role=shiv_demo_runtime -f "$root/scripts/runtime-grants.sql"
echo "== sample catalogue"
DATABASE_URL="$NEON_OWNER_URL" NODE_ENV=development npx tsx prisma/seed.ts | tail -1
echo "== demo owners"
DATABASE_URL="$NEON_OWNER_URL" NODE_ENV=development npx tsx scripts/grant-admin.ts "$DEMO_ADMIN_PHONE" "Demo Owner" | tail -1
DATABASE_URL="$NEON_OWNER_URL" NODE_ENV=development npx tsx scripts/grant-admin.ts "$DEMO_BACKUP_ADMIN_PHONE" "Demo Owner 2" | tail -1
psql "$NEON_OWNER_URL" -At -c "select count(*) || ' products, ' || (select count(*) from \"DeliveryPincode\") || ' pincodes, ' || (select count(*) from \"User\" where role = 'ADMIN') || ' owners, ' || (select count(*) from \"Order\") || ' orders' from \"Product\""
