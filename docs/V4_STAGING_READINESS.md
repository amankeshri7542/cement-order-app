# Phase 4 — staging readiness

Review snapshot: 11 October 2026. Branch `codex/v4-staging-readiness`, based on
`codex/v3-ux-excellence` at `ba6c372645793eeae972dece17df382ae5cfa468`. Nothing has been
deployed, merged or migrated outside disposable local databases. **The product is not
production-ready**: hosting, real SMS sign-in, family content and physical-device acceptance
are still open (see [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)).

Operational procedures: [STAGING_RUNBOOK.md](STAGING_RUNBOOK.md). Acceptance matrix and gates:
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). Content approvals:
[FAMILY_CONTENT_CHECKLIST.md](FAMILY_CONTENT_CHECKLIST.md).

## Starting state (verified)

| Item                    | State                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local branch / HEAD     | `codex/v3-ux-excellence` at `ba6c372`, clean, equal to `origin`                                                                                                                                  |
| PR #2                   | Draft, `codex/v2-storefront-foundation` → `codex/pilot-readiness`, head `8816dd9`, `verify` passed, no reviews or comments                                                                       |
| PR #3                   | Draft, `codex/v2-customer-experience` → `codex/v2-storefront-foundation`, head `8ccfe2c`, `verify` passed, no reviews or comments                                                                |
| PR #4                   | Draft, `codex/v3-ux-excellence` → `codex/v2-customer-experience`, head `ba6c372`; `verify` run 38111747732 was in progress at the start and **passed** during this phase; no reviews or comments |
| Tooling on this machine | PostgreSQL 16 client/server, Chrome, Playwright WebKit. **No Docker, no Xcode simulator, no Android tooling, no physical devices.**                                                              |

> **Superseded (16 October 2026):** the PR rows above record the state on that date. PR #1 has
> since merged into `main` (13 October). PRs #2–#4 are still open drafts, now the bottom of a
> longer stack (#2 → #12, top `codex/p6-hardening`). Check GitHub for each head's current
> `verify` result. Android tooling was added on 12 October (see [P2_ANDROID_APP.md](P2_ANDROID_APP.md)).

## What is real, simulated or pending

| Area                                        | Implemented and exercised locally                                                 | Simulated in tests               | Needs credentials / external setup        | Unverified                             |
| ------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------- | -------------------------------------- |
| Storefront, owner desk, Expo web            | Yes (Chrome + WebKit journeys)                                                    | —                                | HTTPS hosting, domain                     | Physical phones, real networks         |
| NestJS API + PostgreSQL                     | Yes (unit, integration, workflows, restore rehearsal)                             | —                                | Managed Postgres, runtime/migration roles | Provider backups/PITR                  |
| OTP sign-in                                 | Mock provider on loopback                                                         | Mock codes                       | Twilio Verify for India                   | Real SMS delivery, sender registration |
| COD orders, quotations, addresses, delivery | Yes, server-authoritative                                                         | —                                | Real delivery zones                       | Real fulfilment                        |
| Shiv Assistant                              | Fallback (approved FAQ + catalogue)                                               | Provider simulation              | OpenAI key, model, prices, budget         | Live model responses                   |
| Voice input                                 | Browser API wiring                                                                | Speech recognition simulated     | —                                         | Real microphones/permissions           |
| Online payments                             | Disabled                                                                          | Razorpay test flows in API tests | Razorpay (not requested)                  | —                                      |
| Push notifications                          | Code paths only                                                                   | —                                | Firebase/APNs                             | Delivery                               |
| Product photos                              | Approved-asset pipeline                                                           | Simulated object storage         | R2 bucket + asset origin                  | —                                      |
| Legacy attendance/payroll                   | **Not present** in the API schema or routes; the assistant refuses such questions | —                                | —                                         | —                                      |

## Risk register

| #   | Severity | Finding (evidence)                                                                                                                                                                                                                                                                                                                                                                                                                                           | Customer impact                                                                             | Status / fix                                                                                                                                                                                                                             | Acceptance criteria                                                                                                           |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| R1  | High     | **One open event stream blocked graceful shutdown.** Reproduced: with one `/events` client connected, `app.close()` was still pending after 8 s. Every storefront visitor holds that stream.                                                                                                                                                                                                                                                                 | Each deploy/restart would hang until force-killed, cutting in-flight checkouts.             | **Fixed.** SSE streams end on shutdown; drained shutdown in `lifecycle.ts`.                                                                                                                                                              | `runtime.test.ts` "graceful shutdown"; process smoke: exit 0 in 111 ms after SIGTERM with an open stream; CI container smoke. |
| R2  | High     | **Database disconnected before HTTP drained.** Nest runs `onModuleDestroy` (DB `$disconnect`, worker stop) before closing the server.                                                                                                                                                                                                                                                                                                                        | In-flight requests during a deploy could lose their DB connection.                          | **Fixed.** `main.ts` drains HTTP (8 s budget) before Nest teardown; Docker `STOPSIGNAL SIGTERM`.                                                                                                                                         | Same as R1.                                                                                                                   |
| R3  | High     | **Mock sign-in reachable through a local tunnel or proxy.** The guard trusted `remoteAddress` = loopback, which a tunnel on the same computer also satisfies; a DNS-rebinding page could too. Mock mode shows sign-in codes on screen.                                                                                                                                                                                                                       | Anyone with the tunnel URL could sign in as any phone number on a developer's stack.        | **Fixed.** Mock mode refuses tunnel/proxy headers and non-loopback `Host`; startup refuses mock OTP with `TRUST_PROXY_HOPS > 0`. Residual: a hand-made local proxy that adds no headers and rewrites `Host` is undetectable; documented. | `runtime-unit.test.ts`; `runtime.test.ts` (the tunnel case returned 401 = accepted on the old guard, 403 now).                |
| R4  | Medium   | Production accepted placeholder OTP secrets other than `change-me`/`development`.                                                                                                                                                                                                                                                                                                                                                                            | A copied template could run staging with a guessable hash secret.                           | **Fixed.** `REPLACE`, `example`, `placeholder` also refused.                                                                                                                                                                             | `env-templates.test.ts`.                                                                                                      |
| R5  | Medium   | No liveness/readiness split; Docker healthcheck depended on the database.                                                                                                                                                                                                                                                                                                                                                                                    | A DB blip marks the container unhealthy (restart loops); load balancer cannot see draining. | **Fixed.** `/health/live`, `/health/ready`; Docker uses liveness; `/health` kept.                                                                                                                                                        | `runtime.test.ts`; process smoke.                                                                                             |
| R6  | Medium   | Startup failures were swallowed (`API startup failed` with no reason).                                                                                                                                                                                                                                                                                                                                                                                       | Slow diagnosis of a broken staging deploy.                                                  | **Fixed.** `API_STARTUP_FAILED` with redacted reason.                                                                                                                                                                                    | `runtime-unit.test.ts` redaction; process smoke refusal cases.                                                                |
| R7  | Medium   | Next apps with a non-HTTPS production API URL kept running and returned 500 on every request.                                                                                                                                                                                                                                                                                                                                                                | Broken deploy looks healthy to the host.                                                    | **Fixed.** `instrumentation.ts` exits with `FRONTEND_STARTUP_FAILED`.                                                                                                                                                                    | Verified locally: HTTP build exits 1; HTTPS build serves 200.                                                                 |
| R8  | Medium   | Request logs lacked route and duration; no proxy correlation.                                                                                                                                                                                                                                                                                                                                                                                                | Hard to trace a customer's failed request.                                                  | **Fixed.** Route pattern + duration; trusted `X-Request-Id` reuse. No query strings or IDs logged.                                                                                                                                       | `runtime.test.ts` request-log test.                                                                                           |
| R9  | Medium   | No staging environment template; storefront had no template; nothing validated templates.                                                                                                                                                                                                                                                                                                                                                                    | Misconfigured staging.                                                                      | **Fixed.** `staging.env.example`, storefront `.env.example`, template tests in `npm test`.                                                                                                                                               | `env-templates.test.ts`.                                                                                                      |
| R10 | Medium   | Restore was rehearsed only as a manual script, not in CI, and never booted the app on the restored copy.                                                                                                                                                                                                                                                                                                                                                     | Untested backups.                                                                           | **Fixed.** Rehearsal boots the production-mode API on the restored copy; CI runs it.                                                                                                                                                     | `npm run test:restore` PASS (37 tables); CI step.                                                                             |
| R11 | Medium   | **Support number `+91 9297513707` is already public** in the Expo app, privacy page and schema default, while the storefront treats contact details as unapproved.                                                                                                                                                                                                                                                                                           | Customers may call/WhatsApp a number the family has not confirmed for public use.           | **Open — owner decision** (content register C2). Not changed in code.                                                                                                                                                                    | Family confirms or replaces; register updated.                                                                                |
| R12 | Medium   | API integration suite failed intermittently (random 401/200/400 on unrelated tests), including at the unchanged starting commit. **Root cause:** given an idle server, supertest calls `listen(0)` on the wildcard address for every request; on macOS another local process listening on `127.0.0.1` with the same port receives the request instead (demonstrated with a two-server script; 8 such listeners were active). Clean CI runners rarely hit it. | CI could fail spuriously; real defects could hide in noise.                                 | **Fixed.** Integration and workflow suites listen once on `127.0.0.1`.                                                                                                                                                                   | 30 consecutive green integration runs after the fix (baseline: ~1 failure per 5–7 runs); workflows 5/5.                       |
| R13 | Low      | Throttling and SSE are in-process: one API instance only.                                                                                                                                                                                                                                                                                                                                                                                                    | Scaling out breaks rate limits and events.                                                  | Documented constraint (runbook §2).                                                                                                                                                                                                      | Shared limiter/job claiming before scaling.                                                                                   |
| R14 | Low      | Readiness cannot check migration state (runtime role is denied `_prisma_migrations` by design).                                                                                                                                                                                                                                                                                                                                                              | A half-applied migration is not visible to the load balancer.                               | Documented: `prisma migrate status` in the release job.                                                                                                                                                                                  | Release procedure step 3.                                                                                                     |
| R15 | Low      | Docker build and container behaviour cannot be run on this machine.                                                                                                                                                                                                                                                                                                                                                                                          | Container regressions found only in CI.                                                     | CI container smoke added.                                                                                                                                                                                                                | CI step passes on the exact head.                                                                                             |
| R16 | Medium   | **Expo customer app lost the first digit of a typed quantity** ("12" became "2"). Event logs showed react-native-web applying `selectTextOnFocus` after a delay; when the first digit was typed before that, it got selected and the next digit replaced it. This was the cause of the failed Chrome check on PR #5.                                                                                                                                         | A customer typing quickly (or on a slow phone) could place the wrong quantity.              | **Fixed.** On web the field selects all only if the customer has not typed yet; native keeps `selectTextOnFocus`.                                                                                                                        | The quantity journey passed 15/15 repeats after the fix (2/10 failed before).                                                 |

No IDOR or ownership defects were found: customer routes scope by `userId`, owner routes carry
`@Admin()`, and the existing integration suite covers cross-account rejection. COD placement is
idempotent by `(userId, idempotencyKey)` and review id; prices, stock and delivery are
re-validated server-side in a serializable transaction.

## Changes in this phase

**API runtime (`apps/api`)**

- `src/lifecycle.ts`: drained shutdown (stop accepting, end event streams, close idle sockets,
  8 s budget, then Nest teardown), redacted error messages, safe correlation IDs.
- `src/main.ts`: `API_STARTED` / `API_STARTUP_FAILED` / `API_STOPPING` / `API_STOPPED` events;
  SIGTERM/SIGINT handled once.
- `src/app.ts`: `/health/live`, `/health/ready`; request logs with route pattern and duration;
  `X-Request-Id` reuse only behind a trusted proxy.
- `src/catalog.ts`, `src/owner-work.ts`: event streams end on shutdown.
- `src/auth.ts`, `src/config.ts`: mock OTP refuses tunnelled/foreign-host requests and trusted
  proxies; production refuses placeholder OTP secrets.
- `Dockerfile`: liveness healthcheck, explicit `STOPSIGNAL SIGTERM`.
- `staging.env.example`; tests `runtime-unit`, `runtime` (DB-backed, serial with the
  integration suite), `env-templates`.
- `scripts/restore-rehearsal.ts`: boots the production-mode API on the restored copy.

**Frontends**

- `apps/storefront/instrumentation.ts`, `apps/admin/instrumentation.ts`: exit at startup on a
  non-HTTPS production origin.
- `apps/storefront/.env.example`.
- Account-gated storefront pages (checkout, orders, quotes) show **"We could not confirm your
  sign-in"** with **Try again** during an outage, instead of asking a possibly signed-in
  customer to sign in again. Before/after: `docs/screenshots/v4/before-checkout-outage-en-360.png`,
  `checkout-outage-en-360.png`, `checkout-outage-hi-360.png`.

**CI and tooling**

- CI: backup/restore rehearsal after the browser suites; container smoke after the Docker build
  (`scripts/ci-container-smoke.sh` + `scripts/api-process-smoke.mjs`).
- New browser journeys: double-tap **Place COD order** → one order and one owner task; remove
  the last basket line → empty shared cart; outage gate → retry → normal state.

**Documentation**

- [STAGING_RUNBOOK.md](STAGING_RUNBOOK.md), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md), this
  report; content approval workflow and register in
  [FAMILY_CONTENT_CHECKLIST.md](FAMILY_CONTENT_CHECKLIST.md); updates to DEPLOYMENT, SECURITY
  and LOCAL_TESTING.

## Automated checks

Local runs on commit `c29dd81` content, 11 October 2026, disposable databases only. The
exact-SHA GitHub Actions result for the pushed head is recorded on the draft PR.

| Check                                                              | Command                                                                 | Result                                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Lint                                                               | `npm run lint`                                                          | Pass (exit 0)                                                                                             |
| Typechecks, all 5 workspaces                                       | `npm run typecheck --workspaces --if-present`                           | Pass                                                                                                      |
| API unit (adds runtime + template tests)                           | `npm test`                                                              | 98/98                                                                                                     |
| Storefront unit / launcher                                         | `npm test -w @shiv/storefront`, `npm run test:local`                    | 8/8, 10/10                                                                                                |
| API integration + runtime (serial)                                 | `npm run test:integration -w @shiv/api`                                 | 77/77 in **30 consecutive runs** after the R12 fix                                                        |
| Workflows / bootstrap                                              | `npm run test:workflows`, `npm run test:bootstrap`                      | 20/20, PASS                                                                                               |
| Full Playwright, Chrome                                            | `npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome` | **77/77** (75 + 2 new), none flaky or skipped                                                             |
| Full Playwright, WebKit                                            | same, `--project=webkit`                                                | **77/77**, none flaky or skipped                                                                          |
| Backup/restore rehearsal                                           | `npm run test:restore`                                                  | PASS: 37 tables matched; runtime role CRUD only; production-mode API ready on the restored copy           |
| Real entry point, graceful stop                                    | `scripts/api-process-smoke.mjs`                                         | Ready; open event stream ended; exit 0 in 115 ms after SIGTERM; no secrets logged                         |
| Startup refusals                                                   | same, `--expect=refuse`                                                 | Superuser runtime role refused; placeholder/mock config refused; no secrets logged                        |
| Next apps origin check                                             | manual production start                                                 | HTTP API URL → exit 1 `FRONTEND_STARTUP_FAILED`; HTTPS → 200                                              |
| All production builds                                              | `npm run build --workspaces --if-present`                               | Pass                                                                                                      |
| Production headers, CSP, nonces (Chrome + WebKit, three frontends) | `node scripts/check-production-headers.mjs` (+ `--self-test`)           | Pass                                                                                                      |
| Storefront core JS                                                 | same checker                                                            | **297,417 B gzip** (Phase 3: 297,368 B); budget 450 KiB unchanged; lazy assistant 5,019 B                 |
| Credential scan / production audit                                 | `npm run security:scan`, `npm audit --omit=dev …`                       | 0 findings (335 files) / 0 vulnerabilities                                                                |
| Development data                                                   | read-only count                                                         | Unchanged: 6 users, 8 products, 0 orders, 0 quotations, online payments off; no migration added or edited |

**Could not run here:** Docker build and the container smoke (no Docker on this machine; both
run in CI); physical-device tests (no devices or remote-device service); Lighthouse and field
Core Web Vitals (not run); any provider-backed check (no Twilio, hosting or managed database
credentials, by design).

## Still pending (owner actions)

In priority order. Owners are proposals; the shop decides.

1. **Choose hosting, database plan and domain** for staging (runbook §3). Owner. Blocks
   everything below.
2. **Twilio Verify for India**: account, sender registration, approved test numbers and a cost
   ceiling. Owner + technical operator.
3. **Confirm the support number `+91 9297513707`** (already public in the Expo app and privacy
   page) and whether WhatsApp is read on it. Father.
4. **Staging delivery zones** (pincodes, fee, minimum, estimate) and plain-language
   cancellation and quotation terms. Uncle.
5. **Who may use staging** (family, named test customers) and the date staging data is deleted.
   Owner.
6. **Physical-device acceptance** (release checklist §C) on the family's Android phone and one
   iPhone, after staging exists. Family + developer.
7. Approve or replace the shop story; business identity and retention text for the privacy
   page. Family.
8. ~~Fix the intermittent integration-test failure (R12).~~ Done: root cause found and fixed.
   release gate. Developer (separate task offered).
9. Later, optional: live assistant provider; product photos and brand permissions.
