#!/usr/bin/env bash
# Puts a new version live: backup, build, migrate, grants, restart, check. Stops at the first error.
# Run from the repository root on the server.
set -euo pipefail
compose=(docker compose -f infra/docker-compose.yml --env-file infra/server.env)
set -a
# shellcheck disable=SC1091
. /srv/shiv/backup.env
set +a
infra/backup.sh nightly
"${compose[@]}" build
"${compose[@]}" run --rm migrate
# shellcheck disable=SC1091
. infra/server.env
"${compose[@]}" exec -T -e PGOPTIONS='-c client_min_messages=warning' db psql -U shiv_owner -d shiv_cement \
  -v ON_ERROR_STOP=1 -v database=shiv_cement -v migration_role=shiv_owner -v runtime_role=shiv_runtime \
  <scripts/runtime-grants.sql
"${compose[@]}" up -d
for _ in $(seq 1 30); do
  if "${compose[@]}" exec -T api node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "DEPLOY OK"
    exit 0
  fi
  sleep 2
done
echo "DEPLOY FAILED: the API did not become ready" >&2
exit 1
