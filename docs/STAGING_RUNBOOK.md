# Staging runbook

Phase 5's prepared Blueprint, EAS profiles and operator sequence are in
[P5_STAGING_SETUP.md](P5_STAGING_SETUP.md). The owner authorized preparation and Git push
only; importing the Blueprint, provider builds and deployment still require approval.

Prepared 11 October 2026 (Phase 4). Nothing here has been deployed. Every step marked
**[approval]** needs an explicit decision from the owner before it is carried out, because it
creates cost, exposes data or affects real people. See also [DEPLOYMENT.md](DEPLOYMENT.md)
(provider specifics), [SECURITY.md](SECURITY.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## 1. What staging is for

A private, HTTPS copy of the system where the family and a few named test customers try real
journeys on real phones with real SMS sign-in, using **test data only**. Staging runs
`NODE_ENV=production`, so every production startup guard applies. It never shares a database,
storage bucket, OTP service or secrets with production. Online payments stay disabled.

## 2. Components and order of operations

| Component                     | Source                         | Runs as                          | Health                                        |
| ----------------------------- | ------------------------------ | -------------------------------- | --------------------------------------------- |
| API (NestJS)                  | `Dockerfile` (API only)        | one always-on container/instance | `/api/v1/health/live`, `/api/v1/health/ready` |
| PostgreSQL 16                 | managed database               | separate staging database        | provider monitoring                           |
| Customer storefront (Next.js) | `apps/storefront`              | Node host                        | `/` returns 200                               |
| Owner desk (Next.js)          | `apps/admin`                   | Node host                        | `/` returns 200                               |
| Expo customer web app         | `apps/mobile` → static `dist/` | static host                      | page loads                                    |

The API is deliberately **one instance**: event streams, request throttling and the background
worker (reservation expiry, owner-work dispatch, notifications) run in-process. Do not scale
out without shared rate limiting and job claiming.

Release order: **backup → migrate → API → readiness → owner desk and storefront → smoke**.

## 3. Hosting options (decision required **[approval]**)

No provider has been chosen or paid for. Options compatible with the code as it is:

| Option                                                                                              | Fits                                   | Trade-offs                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render (web service for API + Node services for both Next apps) + managed Postgres (Render or Neon) | Docker API, Node Next apps, simple TLS | Free tiers sleep (delays worker, breaks prompt owner alerts) and free Postgres expires after 30 days; an always-on paid instance is needed for meaningful acceptance. |
| A single small VM (Docker Compose + Caddy/nginx for TLS) + managed Postgres                         | Full control, one bill                 | You own OS patching, TLS renewal, log shipping and restarts.                                                                                                          |
| Vercel for the two Next apps + container host for the API                                           | Good Next.js support                   | Three origins to coordinate; cookies need sibling subdomains of one owned domain.                                                                                     |

Hard requirement for all options: sibling HTTPS subdomains of a domain the shop owns (for
example `shop.`, `admin.`, `api.` under one staging subdomain) so cookie authentication works.
A domain purchase or DNS change is **[approval]**.

## 4. Configuration

Templates (placeholders only; tests in `apps/api/test/env-templates.test.ts` keep them
complete and valid):

- API: [`apps/api/staging.env.example`](../apps/api/staging.env.example)
- Storefront: [`apps/storefront/.env.example`](../apps/storefront/.env.example)
- Owner desk: [`apps/admin/.env.example`](../apps/admin/.env.example)
- Expo web: [`apps/mobile/.env.example`](../apps/mobile/.env.example)

Store values in the host's secret settings. Never in the repository, Docker build arguments or
`NEXT_PUBLIC_*` variables (those are compiled into public JavaScript).

| Variable                               | Staging value                                                        | Enforced at startup                                                      |
| -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `NODE_ENV`                             | `production`                                                         | yes                                                                      |
| `DATABASE_URL`                         | restricted **runtime** role, `sslmode=require`, `connection_limit=5` | runtime role must not be superuser, own tables or have CREATE            |
| `CORS_ORIGINS`                         | exact HTTPS origins of storefront, owner desk, Expo web              | must be canonical HTTPS origins                                          |
| `OTP_PROVIDER`                         | `twilio` (mock is refused in production)                             | yes                                                                      |
| `OTP_HASH_SECRET`                      | ≥32 random characters, unique to staging                             | placeholders such as `REPLACE…`/`change-me` are refused                  |
| `TWILIO_*`                             | staging Verify service **[approval: cost, sender registration]**     | presence required                                                        |
| `TRUST_PROXY_HOPS`                     | number of trusted proxies in front of the API (usually 1)            | 0–2; mock OTP requires 0                                                 |
| `ASSISTANT_PROVIDER`                   | `fallback`                                                           | `simulation` refused in production; `openai` needs key, model and prices |
| `RELEASE_SHA`                          | deployed commit                                                      | logged in `API_STARTED`                                                  |
| `RAZORPAY_*`                           | **unset**                                                            | online payments stay off                                                 |
| `NEXT_PUBLIC_API_URL` (both Next apps) | `https://api…/api/v1`                                                | Next apps exit at startup if not HTTPS                                   |
| `NEXT_PUBLIC_CONTENT_REVIEW`           | unset (or `on` only for a private family review build)               | —                                                                        |

## 5. Database roles

Use two roles. The migration role owns the schema; the runtime role only reads and writes rows,
and may delete only from the short list of tables the API really deletes from (sessions, carts,
addresses, notifications and similar). It can never delete orders, payments, payment events,
stock movements or audit rows. The grants live in one file, `scripts/runtime-grants.sql`, which the
CI container smoke and the restore rehearsal run as-is.

```sh
# once per database, as the migration/owner role (password from the secret manager)
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE ROLE shiv_runtime LOGIN PASSWORD '<from secret manager>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"

# after the first migration and again after EVERY migration
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v database=<staging_db> -v migration_role=<migration_role> -v runtime_role=shiv_runtime \
  -f scripts/runtime-grants.sql
```

New tables get `SELECT, INSERT, UPDATE` automatically (default privileges), never `DELETE`. If a
release makes the API delete from a new table, add it to the `GRANT DELETE` list in the script.
Do not paste older inline grant blocks: they grant `DELETE` on every table.

**Wave 1 release (October 2026):** `scripts/runtime-grants.sql` is the single source of the
runtime grants. This release changed it to revoke the broad `DELETE` that earlier grants gave.
Re-run it on every existing database after deploying this release, even if no migration ran.
Then, connected as the runtime role, `DELETE FROM "Order" WHERE false;` must fail with
"permission denied" (the same check `npm run test:restore` makes on its own disposable
database).

The API refuses to start under `NODE_ENV=production` if its role could change the schema.

## 6. Release procedure

Run from a trusted release shell or CI job with the **migration** role's `DATABASE_URL`.

1. **Confirm the commit.** The release SHA must equal a commit whose GitHub Actions `verify`
   run passed. Record it as `RELEASE_SHA`.
2. **Back up** (section 8). Do not continue without a verified dump.
3. **Check migrations:** `npm ci && npm run db:generate && npm exec -w @shiv/api -- prisma migrate status`.
   It must list only pending migrations from this release and no failed ones.
4. **Apply migrations:** `npm run db:migrate`. The runtime container never migrates itself.
   If a migration fails, stop: see section 9.
5. **Re-grant:** run `scripts/runtime-grants.sql` (section 5) after every migration.
6. **Deploy the API** with the runtime role. Watch for `API_STARTED` with the expected
   `release`; any `API_STARTUP_FAILED` event names the problem without printing secrets.
7. **Wait for readiness:** `curl -fsS https://api…/api/v1/health/ready` → `{"status":"ready"}`.
8. **Deploy the owner desk and storefront** built with the staging `NEXT_PUBLIC_API_URL`.
9. **Smoke test** (about 10 minutes): storefront home in Hindi and English, rates board shows
   prices, product page, basket, sign-in by real SMS to an approved test number, checkout
   review (do not place a real-money order; COD test orders only with TEST products), owner
   desk sees the test order. Record results in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## 7. Health, logs and diagnostics

| Endpoint                   | Meaning                                                       | Use for                                                                       |
| -------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /api/v1/health/live`  | process is running; no database access                        | container/orchestrator liveness (Docker `HEALTHCHECK`)                        |
| `GET /api/v1/health/ready` | database answered within 2 s and the instance is not draining | load balancer / readiness; 503 `DRAINING` or `DATABASE_UNAVAILABLE` otherwise |
| `GET /api/v1/health`       | legacy combined check (database query)                        | existing platform settings only                                               |

Migration state is **not** in readiness: the runtime role cannot read `_prisma_migrations` by
design. Check it with `prisma migrate status` in the release job.

Logs are one JSON object per line on stdout/stderr:

| Event                          | Fields                                                 | Notes                                                                              |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `API_STARTED`                  | port, nodeEnv, otpProvider, assistantProvider, release | once per start                                                                     |
| `API_STARTUP_FAILED`           | reason, hint                                           | reason is redacted: URLs lose credentials, `key=value` secrets become `[redacted]` |
| `HTTP_REQUEST`                 | requestId, method, route pattern, status, durationMs   | no query strings, search terms, IDs, bodies, phone numbers or tokens               |
| `REQUEST_FAILED`               | requestId, status, errorType                           | server errors; match with the `requestId` shown to the customer                    |
| `SECURITY_REQUEST_REJECTED`    | requestId, status                                      | 401/403/429                                                                        |
| `API_STOPPING` / `API_STOPPED` | signal                                                 | graceful shutdown                                                                  |

Every API response carries `X-Request-Id`. With `TRUST_PROXY_HOPS > 0` the API reuses a
proxy-supplied `X-Request-Id` (8–64 safe characters) so proxy and API logs correlate.

**Shutdown:** on SIGTERM the API stops accepting connections, ends open event streams (browsers
reconnect), gives in-flight requests up to 8 s, then closes the worker and database. Give the
platform a stop timeout of at least 10 s.

**Diagnostics checklist:** readiness 503 `DATABASE_UNAVAILABLE` → database host, network,
`sslmode`, connection limit. Startup `restricted runtime database role` → you used the
migration role at runtime. Startup `unique OTP hash secret` → a placeholder secret. Next app
exits with `FRONTEND_STARTUP_FAILED` → its API URL is not HTTPS.

## 8. Backup and restore

**Before every migration and at least daily during the review**, with the migration role:

```sh
pg_dump --format=custom --no-owner --no-privileges --file "shiv-staging-$(date -u +%Y%m%dT%H%MZ).dump" "$MIGRATION_DATABASE_URL"
pg_restore --list "shiv-staging-<timestamp>.dump" > /dev/null   # proves the archive is readable
```

Keep dumps encrypted, outside the repository and outside the API host, with a written deletion
date. Staging contains real test-customer phone numbers once real SMS is used: treat dumps as
personal data.

**Restore** (into a **new** database, never over the live one):

```sh
createdb shiv_staging_restore_<date>
pg_restore --exit-on-error --no-owner --no-privileges --dbname shiv_staging_restore_<date> "shiv-staging-<timestamp>.dump"
# apply section 5 grants for the runtime role, then point a staging API at it and check /health/ready
```

**Rehearsed locally, 11 October 2026:** `npm run test:restore` dumps the disposable test
database, restores it into a new database, compares every table's row count and checksum
(37 tables matched), proves the runtime role can read/write rows but cannot run DDL, read
migration metadata or rewrite the inventory ledger, and then boots the API in production mode
on the restored copy and checks `/health/ready` and the public catalogue. CI runs the same
rehearsal on every push. A rehearsal against a real staging provider (managed snapshots, PITR)
is still pending.

## 9. Rollback

| Situation                                                                                                  | Action                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New API version misbehaves, no migration in the release                                                    | Redeploy the previous image/commit. Readiness must pass.                                                                                                                                                                                                                   |
| Release included an **additive** migration (new tables, or new columns that are nullable or have defaults) | Redeploy the previous API version; leave the schema. Previous code does not read the new columns. A new `NOT NULL` column without a default breaks old code's inserts: such migrations need a two-step release.                                                            |
| Migration **failed** midway                                                                                | Do not start the new API. `prisma migrate status` shows the failed migration. Fix forward with a corrective migration, or restore the pre-release dump into a new database and repoint `DATABASE_URL` (section 8). Use `prisma migrate resolve` only with a reviewed plan. |
| Data damaged after release                                                                                 | Stop writes (`DEMAND_PAUSED=true`, `OTP_PAUSED=true`), restore the pre-release dump into a new database, compare, then repoint. Writes made after the backup are lost; record them first.                                                                                  |
| Frontend problem only                                                                                      | Redeploy the previous storefront/owner-desk build. They are stateless.                                                                                                                                                                                                     |

Never drop ledger tables or delete inventory movements to roll back code. Never run the
development seed or fixtures against staging or production.

## 10. Steps that need explicit approval

1. Choosing and paying for hosting, database and domain/DNS.
2. Creating the Twilio Verify service, India sender registration and approved test numbers.
3. Inviting real people (family, test customers) and the data-retention/deletion date for
   staging data.
4. Each staging deploy and each migration run.
5. Any live assistant provider key, model and budget.
6. Anything involving payments (remains off).
