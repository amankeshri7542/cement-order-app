# Deployment and provider configuration

## PostgreSQL / Neon

Create a production database and a separate staging database. Configure `DATABASE_URL` with TLS (`sslmode=require`) and least-privilege application credentials. Apply committed migrations from a trusted release job using `npm run db:migrate`; the runtime container never automatically migrates. Keep migration privileges separate from runtime privileges when managing roles. Enable backups/PITR and rehearse restore. Do not run the development seed in production.

## NestJS / Render

Deploy the repository Dockerfile as one web service. Configure `PORT`, `DATABASE_URL`, `NODE_ENV=production`, a random `OTP_HASH_SECRET`, exact HTTPS `CORS_ORIGINS`, and the providers below. Use `TRUST_PROXY_HOPS=1` only if traffic reaches the app through exactly one trusted reverse proxy. Local default is zero. Set Render’s health check to `/api/v1/health`. Supply secrets in provider configuration, never build arguments or public environment variables. Grant the owner role with the explicit admin CLI against the intended database.

V1 is deliberately **one API instance**: SSE fanout, request throttling, and the scheduled reservation/notification worker run in-process. PostgreSQL still protects financial operations. Multiple API instances require shared event delivery/rate limiting and database work claiming before scaling. No Redis is used. Free hosts that sleep delay notification delivery and reservation expiry; use an always-on instance for commerce.

## Admin and customer web

Deploy Next.js to a Node-capable host or Vercel using `apps/admin` and `NEXT_PUBLIC_API_URL`. Build shared contracts first. Configure custom sibling subdomains, e.g. `admin.example.com`, `shop.example.com`, and `api.example.com`, so SameSite cookie authentication works without third-party-cookie dependence. Allow both frontend origins in API `CORS_ORIGINS`. The admin contains no service secrets. Expo web output is static in `apps/mobile/dist`; native builds call the same HTTPS API.

## OTP — Twilio Verify

Set `OTP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Complete India messaging registration, sender/template and delivery requirements with the provider. Validate SMS delivery and abuse limits using your verified numbers. Never enable mock OTP in production; startup refuses it. OTP request limits are persisted per phone, while route/IP throttling is local to the API instance.

## Razorpay

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and an independent `RAZORPAY_WEBHOOK_SECRET`. Create an HTTPS webhook for `/api/v1/payments/webhook`; subscribe to `payment.captured` and `refund.processed`. Configure automatic capture in Razorpay. Webhook signing uses the **exact raw request bytes**. Event IDs plus payload hashes detect retries and conflicting replays. No card, UPI or full webhook payload is stored in logs.

Before enabling the admin online-payment switch, verify in **Razorpay test mode**:

1. Payment amount, currency and merchant order receipt match the saved order.
2. A captured event confirms the order once; duplicate deliveries do not change inventory.
3. A customer closing checkout leaves the order pending until retry/expiry.
4. Expiry/cancellation followed by a delayed capture creates a refund requirement without re-reserving stock.
5. Issue a full refund from Razorpay and verify the `refund.processed` event.

If creating a gateway order times out, the backend intentionally blocks blind retries. Find the order by its receipt in Razorpay, then use **Verify gateway payment** on the admin order page. The backend independently checks provider receipt/amount/currency and captured payments. There is no automatic refund initiation: staff issues full refunds in Razorpay. Partial refunds and reconciling an external refund performed before local cancellation need operator handling.

## Cloudflare R2

Configure `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`. Use credentials restricted to the product-image bucket. Configure bucket CORS for the exact admin origin with PUT and Content-Type, and a public/custom asset domain. Admin gets a short-lived URL for a random object key, approved raster content type and declared size (max 5 MiB). SVG/HTML uploads are not supported. Use a separate asset domain so untrusted image bytes never share the API/admin cookie origin. Verify the storage provider enforces the signed headers in your deployment.

## Firebase / Android

Set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` in the API. Use least-privilege FCM send permissions. Configure `GOOGLE_SERVICES_JSON` with a local/EAS Android Firebase config path. Register notifications from Account in a real Android development build. The app sends a device FCM token. Tokens belong to the authenticated session and are removed when it is revoked. In-app notifications are saved transactionally; a worker delivers push with bounded retries. At-least-once delivery can produce a duplicate push after an uncertain network outcome.

iOS requires an FCM-compatible native registration bridge and APNs/Firebase credentials before push is advertised as supported. The app does not send APNs tokens to the FCM API.

## Expo / EAS

Create/link the Expo project, choose final package/bundle IDs and configure Android/iOS signing. Set public API origin for each build profile. Use development builds for native Razorpay/FCM testing. Test keyboard avoidance, Android back navigation, screen readers, offline recovery and payment app handoffs on devices before publishing.

## Release checklist

Replace seed inventory with verified stock/prices; set actual delivery policy; configure business/GST details and decide tax-invoice workflow; validate Bihar delivery pincodes operationally; complete provider tests; inspect dependency advisories; run CI; configure backups, health alerts and retention; rehearse refunds and reconciliation. Container and native signing should be verified in environments with Docker and the relevant SDKs. No production resources or credentials were created by this implementation.

## Pilot upgrade: migration, access, and privacy

Back up the database, apply `20261002120000_pilot_operations` in staging, then production. The migration adds ledger opening balances, quantity/zone constraints, cursor indexes, and trigram search indexes. Its migration role must be allowed to install PostgreSQL `pg_trgm`; ask the managed database operator to enable it if necessary. Never drop ledger records to roll back application code.

Release the API and customer/admin clients together: list endpoints now return `{items, nextCursor}` rather than arrays. Existing native builds need an enforced update or a separate compatibility rollout before this API is exposed to them. Take a short maintenance window for this initial pilot upgrade. Validate production data against new quantity constraints before migration.

Supply a unique `ADMIN_BOOTSTRAP_PASSWORD` (12–200 characters) securely in the release shell, then run the existing `admin:grant` command for each staff phone. The command stores a scrypt hash and revokes that user's sessions. Staff need both phone OTP and the passphrase; sessions have an eight-hour absolute lifetime. Keep the bootstrap variable out of the runtime environment after use. Configure trusted proxy hops accurately for the persistent hashed-IP OTP budgets.

Configure actual zones in Finance & settings. The migration creates none; do not run the development seed on production. Check active, inactive, unknown, minimum-order, and changed-fee pincodes at checkout. Existing CONTRACTOR roles become CUSTOMER/PENDING and require staff verification again. No contractor-only pricing or credit is enabled.

Host `/privacy` and `/delete-account` on the admin domain; these routes are public. Set `EXPO_PUBLIC_PRIVACY_URL` to the HTTPS privacy page before rebuilding customer clients. Fill in the real business identity, retention periods, backup-deletion schedule, support contact, and provider disclosures before publication. The current support number is 9297513707; update both public pages if it changes. Complete Play Console Data safety/account-deletion declarations and confirm the public deletion URL works without installing the app.

Deletion refuses staff accounts and customers with unresolved orders/refunds. It revokes sessions/devices, clears profile/contact snapshots and free-text customer notes, and retains de-identified transaction/audit records. Historical backups require the documented retention/restore procedure; application deletion does not erase old backups automatically.

## Rate Studio

Apply the Rate Studio and immutable OCR evidence migrations before starting the updated API. Configure backend-only Vision/OpenAI credentials and a separate private source bucket only when enabling extraction. Manual workflows need no AI setup. The Docker image includes fonts for deterministic PNG rendering. See [Rate Studio production setup and privacy](RATE_STUDIO.md) for exact variables, provider checks, limits, backup and acceptance procedures.
