# Shiv Cement Store

Planning your first release? See the [launch plan for 50–100 customers](docs/LAUNCH_PLAN.md).

An Expo customer app, Next.js store dashboard, and NestJS/PostgreSQL commerce backend for **Shiv Cement Store**, serving **Patna and Bihar**. Contact/WhatsApp initially **9297513707**, editable under **Finance & settings**.

The backend owns prices, delivery charges, inventory and payment state. Local example inventory and mock OTP are for development. **Do not accept real payments until the production setup and provider verification below are complete.**

## Run locally

Use Node.js 22.12+ and PostgreSQL 16+. From this repository:

```bash
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/admin/.env.example apps/admin/.env
cp apps/mobile/.env.example apps/mobile/.env
# Edit DATABASE_URL and generate a random OTP_HASH_SECRET in apps/api/.env.
# If Docker is available, this starts a local database with the example credentials:
docker compose up -d db
npm run db:generate
npm run build -w @shiv/shared
npm run db:migrate
npm run db:seed
npm run admin:grant -w @shiv/api -- +919297513707
```

Run each app in its own terminal:

```bash
npm run dev:api    # API: http://localhost:4000/api/v1
npm run dev:admin  # Admin: http://localhost:3000
npm run dev:web    # Customer browser preview: http://localhost:8081
npm run dev:mobile # Expo customer app for Android/iOS
```

OpenAPI documentation: `http://localhost:4000/api/docs` (disabled in production). Health: `GET /api/v1/health` checks the database.

For the prepared local workspace on this machine, an isolated PostgreSQL instance uses port **55439**, with data in ignored `.local/postgres`. Its development and test databases are separate. It binds only to loopback. `.env` files already point to it; you do not need Docker to use this prepared workspace. After a reboot, start it with:

```bash
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D .local/postgres -l .local/postgres.log -o '-h 127.0.0.1 -p 55439 -k /tmp' start
```

For local OTP sign-in, request a code using a valid Indian mobile number. A clearly labelled random development code appears in the form. It expires in 5 minutes, is single-use and limited to five attempts. The store number has admin access only after the grant command; signing up never grants admin privileges.

## Store controls

- **Products:** create/edit products, stock, prices, visibility, category and images. Price edits use version checks and create an audit trail.
- **Orders:** inspect customer/payment/history; prepare, dispatch and deliver; record cash received; cancel eligible orders and restore stock; record cash refunds; reconcile verified Razorpay payments.
- **Bulk quotes:** price each requested material, set a custom delivery charge and expiry, and send revisions. Customers accept the exact revision they reviewed. Accepted quotes require store follow-up to arrange an order/payment.
- **Customers:** contact, saved addresses and order history.
- **Finance & settings:** change phone/WhatsApp, flat delivery fee, free-delivery threshold, delivery message and online-payment switch. Existing orders keep agreed totals.

Seed data uses a **₹500 delivery charge** and **free delivery from ₹50,000**, purely as editable development examples. Review actual product prices and policies before using this with customers. Prices are treated as final selling prices; GST calculation and statutory tax invoices are not enabled.

## Verification

Set `TEST_DATABASE_URL` to a **separate database whose name ends in `_test`**. The tests intentionally reset that database. For local runs, put it in `apps/api/.env.test`.

```bash
# First create the empty test database and apply migrations to it:
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
```

Browser tests start separate API/admin/customer servers on 4010/3001/8082. They use Chrome (`npx playwright install chrome` if needed). Unit and integration tests cover server pricing, transaction races, OTP/session security, authorization, webhook replay, refunds and quote revisions. Browser tests cover ordering, admin management, quotations, localization, mobile sizing and network recovery. See [implementation report](docs/IMPLEMENTATION.md) for actual verification results and limits.

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
