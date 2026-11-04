# Phase 5: staging and family-demo preparation

13 October 2026. Based on phase 4 (`f91b79a`), on `codex/p5-staging-setup`.
The owner requested **prepare and push only: no purchases or deployment**. This delivers
the repository setup. Hosted staging, signed binaries, Play enrollment and physical-phone
acceptance remain pending; this is not a completed launch.

## Scope, architecture and acceptance

The Next.js storefront and owner desk, plus the Expo Android app, share one NestJS API
and PostgreSQL. The API owns prices, inventory, orders and payments. Reuse these clients
and their existing flows; no extra demo UI, dependency, migration or API contract is needed.

| Step                 | Files                                                                   | Acceptance                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting              | `render.yaml`                                                           | One API, two Next services, PostgreSQL 16; manual deploys; secret prompts; API uses a restricted database role                                             |
| Android distribution | `apps/mobile/eas.json`, `app.config.ts`, `test/release-config.test.mjs` | Preview APK and closed-test AAB use EAS preview environment; release builds reject missing/sample/HTTP URLs and local cleartext; submissions remain drafts |
| Deployment check     | `scripts/staging-smoke.mjs`, `staging-smoke.test.mjs`, root scripts     | Read-only checks reject wrong origins, failed readiness, enabled payments, empty catalogue and unsafe headers                                              |
| Inherited CI gate    | `tests/owner-workflows.spec.ts`                                         | Both acknowledgment requests reach the real API concurrently and produce one durable assignee and audit record                                             |
| Handoff              | This document, runbook, checklist, listing and README                   | Provider steps and family scenarios distinguish repository evidence from pending real-world acceptance                                                     |

Render matches the session brief but has not been approved for purchase. The template uses
three paid Starter services and a small paid PostgreSQL database in Singapore. Confirm
current pricing and measure memory/latency before approving; this is not a capacity promise.
One provider reduces coordination. Sibling HTTPS subdomains are required for browser cookies.
The optional Expo web preview stays local; browser customers already have the storefront.

Phase 4's CI run 38357608761 failed in WebKit: the first acknowledgment could remove the
other owner's button before its click finished. The test now blocks the alert service
worker only in its routed fault-injection contexts, holds both real POSTs until both
clicks arrive, and asserts both requests reached that barrier. CORS preflights are not
counted. The separate alert-worker test remains unchanged. No production handler or API
response is mocked or changed. The catalogue journey in `tests/journeys.spec.ts` also waits
for the first page to commit before WebKit fills its controlled search input. This prevents
initial rendering from discarding the test's query; no application code was changed.

## Before any deployment

Record the owned domain, billing approval, account operators and tester participants.
Keep credentials and tester contact lists outside Git.

- GitHub: `amankeshri7542/cement-order-app`. This branch includes the existing stacked
  phase 4 work. Push does not merge earlier PRs or deploy; release only a green exact SHA.
- Render: approve all service/database plans and region before importing the Blueprint.
  **Import creates paid resources and attempts an initial deployment**, even with
  `autoDeployTrigger: off`. Subsequent pushes do not deploy automatically.
- Domain: choose `api.staging.<domain>`, `shop.staging.<domain>`, `admin.staging.<domain>`.
  Register each custom domain in Render and follow its DNS instructions. Unrelated default
  `onrender.com` hosts do not provide the required browser-cookie setup.
- Twilio Verify: configure India delivery requirements and approved tester numbers. Real
  SMS costs money; production-mode staging refuses mock OTP.
- Expo/EAS: link the owner's project, confirm package `in.shivcement.store`, and configure
  signing. Keep signing keys, Firebase files and Play service-account JSON out of Git.
- Play Console: complete personal-account identity/device verification, listing, contact,
  privacy, Data safety, content rating and tester enrollment. Check current eligibility.
- Optional alerts: staging-only VAPID keys go in API secrets. Firebase/Sentry need their
  own configuration and live evidence for native push/crashes. WhatsApp stays fake until
  Meta approval and separately authorized real-message tests.

## Database and deployment sequence

Use [STAGING_RUNBOOK.md](STAGING_RUNBOOK.md) for backups, provider restore rehearsal and
rollback. The Blueprint deliberately does not migrate, seed or create owner accounts.
Never wire API `DATABASE_URL` to `fromDatabase.connectionString`: the initial provider
database user owns the schema and must not be the runtime login.

1. After approval, import the reviewed branch. Expect readiness to fail until migrations,
   roles and store settings exist. Keep `OTP_PAUSED=true`, `DEMAND_PAUSED=true`; invite nobody.
2. Get the migration connection URL in a trusted release environment. Public database
   access starts disabled (`ipAllowList: []`). If releasing from an external shell,
   temporarily allow only its approved IP, then remove it. Never allow `0.0.0.0/0`.
   The API uses the internal database host.
3. Use a separate clean release checkout, without development `.env` files. Supply
   `DATABASE_URL` through the shell's secret environment using the migration role. Back up
   and verify the dump before migrating an existing database, then run:

   ```sh
   npm ci --include=dev --workspace @shiv/api --workspace @shiv/shared --include-workspace-root
   npm run db:generate
   npm run build -w @shiv/shared
   npm exec -w @shiv/api -- prisma migrate status
   npm run db:migrate
   ```

   Never run `db:seed`, `local:fixtures`, `local:setup` or destructive automated tests on staging.

4. In an authenticated `psql` operator session create a separate `shiv_runtime` login:
   `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, no memberships or object ownership.
   Set its password with `\password shiv_runtime` rather than embedding it in SQL/history.
   Apply [runtime-grants.sql](../scripts/runtime-grants.sql) with `ON_ERROR_STOP=1` and
   the provider's exact `database`, `migration_role`, `runtime_role` variables. Reapply
   grants after migrations. Put this restricted login's internal URL in API secrets with
   `sslmode=require`, `connection_limit=5`, `pool_timeout=10`. Verify backup/PITR availability
   and rehearse restoring into a new provider database before inviting testers.
5. Set prompted API secrets, exact two HTTPS `CORS_ORIGINS`, and the tested `RELEASE_SHA`.
   Verify `TRUST_PROXY_HOPS=1` matches the actual proxy chain. Keep Razorpay variables unset
   and `ASSISTANT_PROVIDER=fallback`.
6. Securely supply each staff member's unique `ADMIN_BOOTSTRAP_PASSWORD`, phone/name and
   migration database environment. In the clean checkout, run:

   ```sh
   npm exec -w @shiv/api -- tsx scripts/grant-admin.ts "$STAFF_PHONE" "$STAFF_NAME"
   ```

   This also creates initial store settings with online payments off. The usual local
   `admin:grant` command reads `.env`; the explicit command avoids selecting a local database.

7. Set both Next services' `NEXT_PUBLIC_API_URL=https://api.staging.<domain>/api/v1`, finish
   custom-domain TLS, and deploy API → readiness → owner desk/storefront. Public URLs are
   compiled into client bundles; changing them requires rebuilding.
8. Verify readiness, then explicitly change the paused flags to `false` and redeploy for
   the tester window. Staging is internet reachable; a tester list is not access control.
   If private staging is required, configure an approved edge policy that supports native
   devices. Use test data only.
9. Sign in as staff with real SMS and passphrase. Use the desk to configure TEST products,
   accurate units/prices, a test delivery zone, unloading/floor/vehicle terms, approved
   contact details and alerts. Keep payments off. Optional uploads need a separate staging
   R2 bucket, asset domain, restricted credentials and exact admin CORS; rebuild clients
   with the asset origin. Never share production storage.

## Read-only staging gate

Set the three public values in the operator environment, replacing `<domain>`:

```sh
export STAGING_API_ORIGIN='https://api.staging.<domain>'
export STAGING_SHOP_ORIGIN='https://shop.staging.<domain>'
export STAGING_ADMIN_ORIGIN='https://admin.staging.<domain>'
npm run staging:smoke
```

The gate validates canonical sibling HTTPS origins before requests, verifies TLS, refuses
redirects and uses GET only. It checks the existing health contracts, both credentialed
CORS origins, disabled payments, a nonempty catalogue, the two frontends and public policy
routes with CSP/HSTS/no-store headers. It sends no OTP, order or deletion request, needs no
customer token and prints no customer responses. A pass is not an authenticated journey.
Use separate browser profiles for real SMS, staff passphrase, SameSite sign-in, sign-out
and cross-account isolation before APK distribution.

## Family APK and Play closed test

Set public `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_PRIVACY_URL` in EAS's **preview** environment.
The privacy URL is `https://admin.staging.<domain>/privacy`. These values must be available
when resolving app config; do not mark them secret. Configure **production** separately
when approved. Release builds refuse sample hosts and `APP_VARIANT=local`.
Optional `GOOGLE_SERVICES_JSON` is an EAS file variable; Sentry's auth token is secret and
its DSN is public. Existing config reads these without requiring them for a basic COD demo.

From `apps/mobile`, only after account/build approval and hosted browser acceptance:

```sh
npx eas-cli build --profile preview --platform android
npx eas-cli build --profile closed-test --platform android
npx eas-cli submit --profile closed-test --platform android --id '<approved-build-id>'
```

Preview produces an installable APK. Closed-test produces an AAB with remote version-code
incrementing, uses staging, and submits to `alpha` as a **draft**. There is no auto-submit
or public release. Use the exact approved build ID, not `--latest`. For a new app, finish
the required first upload/setup in Play Console before API submissions; configure its
service account separately. Finish the listing, tester group and explicit draft rollout
in the Console. Record build ID, SHA, version code, URLs and participant dates outside Git.

For applicable new personal accounts, Google's published requirement is at least 12
opted-in testers continuously for 14 days before applying for production access. An APK
or internal-track test does not meet this closed-test gate. Google reviews the application;
production access is not guaranteed after 14 days. Check the Console's current rules.
Sources: [Google testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465),
[EAS environments](https://docs.expo.dev/eas/environment-variables/usage),
[EAS submissions](https://docs.expo.dev/build/automate-submissions).

The real public paths are `/privacy` and `/delete-account` on the admin domain. The policy
still needs approved business identity, retention and provider wording before public tests.
[LISTING.md](play-store/LISTING.md) remains a draft, not a content/legal approval.

## Twenty-minute family demo

Use actual phones, approved numbers, TEST products and separate customer/owner sessions.
Keep a fallback phone/contact procedure for missed alerts. No real deliveries or payments.

| Time      | Journey                                                | Pass evidence                                                          |
| --------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| 0–3 min   | Hindi/English rates, search, units                     | Family identifies material, pack and price without coaching            |
| 3–7 min   | SMS, address, served/unserved pincode, COD review      | Full total/terms; double-tap creates one order                         |
| 7–11 min  | Papa: sign-in, new task, acknowledge/prepare/dispatch  | One named assignee; customer status correct; alert observed if enabled |
| 11–14 min | Chacha: cash/UPI, complete delivery, money report      | One collection, correct channel and total                              |
| 14–17 min | Quote request, offer/freight, accept, convert          | Current-revision consent; one resulting COD order                      |
| 17–20 min | Offline/reconnect, account switch, large text/TalkBack | No duplicate or private-data carryover; labels and keyboard usable     |

Then allow 20 minutes of uncoached use per person. Record hesitations and bugs with phone/OS,
language, network, exact steps and expected result. Record provider and physical-device
evidence in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md), including P1–P8. Emulator evidence
does not pass physical-phone rows.

## Verification, remaining gates and rollback

Repository completion means tests, lint, types, builds and browser regression pass, and
the descriptive commit is pushed. Full phase 5 acceptance additionally requires green
exact-SHA CI, hosted restore/SMS/cookie checks, signed APK/AAB, the closed test and family
device results. No provider credential or deployment workflow was added.

Run the existing CI commands: lint, typecheck, API/shared/mobile/storefront tests,
`test:local`, integration/workflows/bootstrap/restore, build, both
`playwright.qa.config.ts` projects, production-header checker and `security:scan`.
The new smoke unit tests join `test:local`; native config tests join mobile tests.
Docker remains a CI gate if unavailable locally. Hosted `staging:smoke` awaits deployment.

Local evidence on 13 October 2026 (Node 24.19.0; GitHub CI uses Node 22):

| Check                                                    | Result                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| Current official Render JSON Schema                      | Blueprint valid; no resources created                                     |
| ESLint / workspace typecheck                             | Passed                                                                    |
| API unit / integration / workflow tests                  | 99 / 84 / 20 passed                                                       |
| Shared / mobile / storefront tests                       | 8 / 3 / 8 passed                                                          |
| Local scripts, including smoke fixtures                  | 14 passed; hosted requests not run                                        |
| Expo CLI staging config resolution                       | Passed; no cleartext plugin; no binary built                              |
| Staff bootstrap / backup-restore rehearsal               | Passed; 39 table fingerprints matched; runtime-role restrictions verified |
| All workspace production builds                          | Passed                                                                    |
| Production CSP/headers, Chrome and WebKit                | Passed on isolated HTTPS fixtures; API responses simulated                |
| Production dependency audit, API/shared/admin/storefront | 0 vulnerabilities                                                         |
| Credential scan                                          | 0 findings in 417 files                                                   |
| Browser Chrome suite                                     | 82 passed                                                                 |
| Browser WebKit suite                                     | 81 passed; alert-worker check intentionally runs only in Chrome           |

> **Correction (16 October 2026):** the WebKit row is the local result. CI run 38377635607 at
> the same commit failed WebKit (1 failed, 80 passed), so WebKit was not green in CI for this
> phase. Treat the CI result as authoritative.

The final fault-injection test passed against a freshly reset test database and checks
that exactly two POSTs reached its barrier. The catalogue timing regression also passed
in isolation. Full suites use their normal separate database resets; failed development
iterations are not counted as release evidence.

Before deployment, revert this config/scripts/docs commit to roll back. Hosted releases
use the previous exact commit and the existing database runbook. This phase adds no schema
change. EAS variable edits cannot retarget an installed native binary: rebuild/distribute it.

Render reference: [Blueprint specification](https://render.com/docs/blueprint-spec).
