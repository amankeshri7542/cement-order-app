# Shiv Cement Store

**Status (17 October 2026):** code complete through Phase 9; nothing is deployed, no money has
been spent and online payments are off. The next steps need the owner's accounts and approval:
the [operator checklist](docs/OPERATOR_CHECKLIST.md) lists them in order, and the
[release checklist](docs/RELEASE_CHECKLIST.md) records which gates have passed.

Phase reports: [P1 app foundations](docs/P1_APP_FOUNDATIONS.md) ·
[P2 Android app](docs/P2_ANDROID_APP.md) · [P3 hardening](docs/P3_HARDENING.md) ·
[P4 owner desk](docs/P4_OWNER_DESK.md) · [P5 staging setup](docs/P5_STAGING_SETUP.md) ·
[P6 wave 1 hardening](docs/P6_HARDENING_WAVE1.md) ·
[P7 website parity, Hindi catalogue, demo kit](docs/P7_PARITY_HINDI_DEMO.md) ·
[P8 Direction A redesign](docs/P8_DIRECTION_A_REDESIGN.md) ·
[P9 Teko and rate cards](docs/P9_TEKO_RATE_CARDS.md) ·
[P10 launch prep](docs/P10_LAUNCH_PREP.md). Hosting: [staging runbook](docs/STAGING_RUNBOOK.md)
and `render.yaml` (deploys from `main`, manual deploys only).

Planning your first release? See the [launch plan for 50–100 customers](docs/LAUNCH_PLAN.md).

Testing and the family demo: [testing guide](docs/TESTING_GUIDE.md) for all three products,
[manual setup](docs/MANUAL_SETUP.md) for accounts and keys, the
[demo script](docs/DEMO_SCRIPT.md) and the Hindi [owner desk guide](docs/FAMILY_GUIDE_HI.md).

An Expo Android customer app, a Next.js customer website, a Next.js owner desk, and a NestJS/PostgreSQL commerce backend for **Shiv Cement Store**, serving **Patna and Bihar**. Contact/WhatsApp initially **9297513707**, editable under **Finance & settings**.

The backend owns prices, delivery charges, inventory and payment state. Local example inventory and mock OTP are for development. **Do not accept real payments until the production setup and provider verification below are complete.**

The [pilot implementation report](docs/PILOT_IMPLEMENTATION.md) covers inventory movements, paginated catalogues, pincode zones, staff security, and the updated UI.

[Rate Studio](docs/RATE_STUDIO.md) adds private rate-sheet imports, reviewed bulk price publication and deterministic shareable rate cards. Manual workflows work without AI credentials.

## Local review handoff

The customer website in `apps/storefront` is bilingual and transactional: catalogue, basket,
COD checkout, orders, quotations and account pages (profile, signed-in devices, account
deletion), at feature parity with the Android app (`packages/shared/src/features.ts`). It
started as the read-only [V2 storefront foundation](docs/V2_STOREFRONT_FOUNDATION.md).
Run `LOCAL_ADMIN_PORT=3002 npm run local:start` on this machine; the storefront is
at <http://localhost:3003>. Family content, physical-phone acceptance and hosting remain pending.

[Current feature inventory and release evidence](docs/REVIEW_HANDOFF.md) · [Proposed V2 integration phases](docs/V2_INTEGRATION_ROADMAP.md).

Start with [the tested local setup and manual checklist](docs/LOCAL_TESTING.md):
`npm ci`, `npm run local:setup`, `npm run local:start`.
Use separate customer/owner browser profiles. Practice accounts, exact ₹20,000 COD
smoke test, recovery instructions and test-database isolation are documented there.
See [progress and verification scope](docs/LOCAL_PROGRESS.md) and
[Hindi family review / staging prerequisites](docs/FAMILY_REVIEW.md). Nothing is deployed.
The [follow-up reliability review and build order](docs/RELIABILITY_REVIEW.md) records the cart report, additional fixes, tradeoffs and the recommended release sequence.

## Run locally

Use Node.js 22.12+ and PostgreSQL 16+. From this repository:

```bash
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/admin/.env.example apps/admin/.env
cp apps/mobile/.env.example apps/mobile/.env
cp apps/storefront/.env.example apps/storefront/.env
# Edit DATABASE_URL and generate a random OTP_HASH_SECRET in apps/api/.env.
# If Docker is available, this starts a local database with the example credentials:
docker compose up -d db
npm run db:generate
npm run build -w @shiv/shared
npm run db:migrate
npm run db:seed
# Supply ADMIN_BOOTSTRAP_PASSWORD through your shell or secret manager first.
# Use a unique 12–200 character staff passphrase; do not put it in command history.
npm run admin:grant -w @shiv/api -- +919297513707
```

Run each app in its own terminal:

```bash
npm run dev:api    # API: http://localhost:4000/api/v1
npm run dev:admin  # Admin: http://localhost:3000
npm run dev:web    # Customer browser preview: http://localhost:8081
npm run dev:storefront # Customer website: http://localhost:3003
npm run dev:mobile # Expo customer app for Android/iOS
```

OpenAPI documentation: `http://localhost:4000/api/docs` (disabled in production). Health: `GET /api/v1/health` checks the database.

For the prepared local workspace on this machine, an isolated PostgreSQL instance uses port **55439**, with data in ignored `.local/postgres`. Its development and test databases are separate. It binds only to loopback. `.env` files already point to it; you do not need Docker to use this prepared workspace. After a reboot, start it with:

```bash
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D .local/postgres -l .local/postgres.log -o '-h 127.0.0.1 -p 55439 -k /tmp' start
```

For local OTP sign-in, request a code using a valid Indian mobile number. A clearly labelled random development code appears in the form. It expires in 5 minutes, is single-use and limited to five attempts. The store number has admin access only after the grant command; signing up never grants admin privileges.

Each staff sign-in requires phone OTP plus the staff passphrase. Re-running `admin:grant` rotates that passphrase and revokes existing sessions. Staff without a credential are accepted only in development/test; production rejects them.

## Store controls

- **Products:** edit specifications, selling units, pack description, minimum/step quantities, prices, visibility, and images. Record stock through the immutable **Stock ledger**, including purchases, walk-in sales, returns, damage, and signed manual corrections. Existing balances cannot be overwritten.
- **Orders:** inspect customer/payment/history; prepare, dispatch, and deliver; record cash received; cancel eligible orders and restore stock; record cash refunds; reconcile verified Razorpay payments.
- **Bulk quotes:** versioned prices, custom delivery charge, and expiry. Customer decisions and staff-recorded decisions have separate provenance; staff must record evidence. Accepted current revisions convert idempotently to managed COD orders after transport confirmation and availability checks. Changed terms require renewed consent.
- **Customers:** recent orders, contact details, and audited contractor verification. Asking for contractor access does not grant pricing or credit privileges.
- **Finance & settings:** contact/WhatsApp, online-payment switch, staff sessions, and delivery zones. Each pincode belongs to one zone with active status, charge, minimum order, free-delivery threshold, and delivery estimate.
- **Store activity:** paginated audit history. Product, order, customer, and quotation lists use server-side pages.

Development seed zones cover only **800001, 800002, and 800020**. They use example fees; review all prices and configure actual serviceable pincodes before inviting customers. Production migration creates no serviceable zones. Prices are final selling prices; statutory GST invoices are not implemented.

## Verification

Set `TEST_DATABASE_URL` to a **separate database whose name ends in `_test`**. The tests intentionally reset that database. For local runs, put it in `apps/api/.env.test`.

```bash
# First create the empty test database and apply migrations to it:
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm run lint
npm run typecheck --workspaces --if-present
npm test
npm test -w @shiv/shared && npm test -w @shiv/mobile && npm test -w @shiv/storefront
npm run test:local
npm run test:integration -w @shiv/api
npm run test:workflows
npm run test:bootstrap
# Run each browser engine separately: global setup resets the shared test database.
npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome
npm run test:e2e -- --config=playwright.qa.config.ts --project=webkit
npm run build
npm run security:scan
```

Browser tests start separate API/admin/storefront/customer servers on 4010/3001/3004/8082. CI runs Chrome and WebKit (`npx playwright install chrome webkit` if needed). The latest local counts are in [P10_LAUNCH_PREP.md](docs/P10_LAUNCH_PREP.md). Unit and integration tests cover server pricing, transaction races, OTP/session security, authorization, webhook replay, refunds and quote revisions. Browser tests cover ordering, admin management, quotations, localization, mobile sizing and network recovery. See [pilot implementation report](docs/PILOT_IMPLEMENTATION.md) for actual verification results and limits.

## Native app

Set `EXPO_PUBLIC_API_URL` to your computer’s LAN address for a physical device, or your HTTPS API address for distribution. Rebuild after changing public environment variables. Native session refresh tokens use Expo SecureStore; the browser preview uses HttpOnly cookies instead.

Native Razorpay and push notifications require a **development/EAS build**, not Expo Go. Configure your Expo project, signing and Firebase Android `google-services.json` locally; do not commit credentials. An Android Firebase config can be wired through `app.config.ts` and `GOOGLE_SERVICES_JSON`. Android push uses device FCM tokens. iOS FCM registration remains a documented integration task; order status is always available in-app.

```bash
cd apps/mobile
npx eas-cli build --profile development --platform android
# For release, finish provider setup and use the production profile.
```

The normal build command exports JavaScript bundles for Android, iOS and web; it does **not** produce signed APK/AAB/IPA binaries.

## Production setup

See [deployment instructions](docs/DEPLOYMENT.md), [architecture](docs/ARCHITECTURE.md), and [security review](docs/SECURITY.md). No production deployment is performed automatically. The GitHub Actions workflow verifies, tests, builds applications and builds the backend Docker image; it contains no deploy credentials.
