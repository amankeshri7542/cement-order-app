#!/usr/bin/env bash
# CI-only: run the built API image against the disposable CI database.
# 1. With a restricted runtime role: must become ready, end event streams and stop cleanly.
# 2. With the superuser: must refuse to start, without printing the password.
# Requires: docker image shiv-cement-api:ci, psql, TEST_DATABASE_URL (loopback, *_test).
set -euo pipefail

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is required}"
case "$TEST_DATABASE_URL" in
  *localhost*_test | *127.0.0.1*_test) ;;
  *) echo "Refusing: container smoke needs a loopback *_test database" >&2; exit 1 ;;
esac

role=shiv_runtime_ci
role_password="ci-runtime-$(openssl rand -hex 16)"
admin_password=$(node -e 'console.log(decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).password))')
database=$(node -e 'console.log(new URL(process.env.TEST_DATABASE_URL).pathname.slice(1))')
runtime_url=$(ROLE="$role" PASS="$role_password" node -e '
  const u = new URL(process.env.TEST_DATABASE_URL);
  u.username = process.env.ROLE; u.password = process.env.PASS; console.log(u.href);')

migration_role=$(node -e 'console.log(decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).username))')

psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<SQL
DROP ROLE IF EXISTS $role;
CREATE ROLE $role LOGIN PASSWORD '$role_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
SQL
trap 'psql "$TEST_DATABASE_URL" -q -c "DROP OWNED BY $role; DROP ROLE IF EXISTS $role;" >/dev/null 2>&1 || true' EXIT
# The exact grants operators apply in staging and production.
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -v database="$database" \
  -v migration_role="$migration_role" -v runtime_role="$role" -f scripts/runtime-grants.sql

common=(
  -e NODE_ENV=production -e PORT=4100 -e OTP_PROVIDER=twilio
  -e TWILIO_ACCOUNT_SID=ci-placeholder -e TWILIO_AUTH_TOKEN=ci-placeholder
  -e TWILIO_VERIFY_SERVICE_SID=ci-placeholder
  -e OTP_HASH_SECRET="$(openssl rand -hex 32)"
  -e CORS_ORIGINS=https://shop.ci.invalid -e TRUST_PROXY_HOPS=0
  -e RELEASE_SHA="${GITHUB_SHA:-local}"
)

SMOKE_FORBIDDEN="$role_password,$admin_password" node scripts/api-process-smoke.mjs \
  --expect=ready --url=http://127.0.0.1:4100 -- \
  docker run --rm --network host "${common[@]}" -e DATABASE_URL="$runtime_url" \
  shiv-cement-api:ci

SMOKE_FORBIDDEN="$admin_password" node scripts/api-process-smoke.mjs \
  --expect=refuse --match="restricted runtime database role" -- \
  docker run --rm --network host "${common[@]}" -e DATABASE_URL="$TEST_DATABASE_URL" \
  shiv-cement-api:ci
