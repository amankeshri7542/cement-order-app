# Implementation report

**Store:** Shiv Cement Store · **Service area:** Patna and Bihar · **Initial contact:** +91 9297513707.

## Implemented

- npm/TypeScript monorepo with Expo React Native customer app, Next.js admin, NestJS API and shared strict contracts.
- PostgreSQL/Prisma schema, committed migrations, integrity constraints and development-only catalogue seed. No client-side product/price seed.
- Phone sign-in, development OTP, Twilio Verify adapter, sessions with refresh rotation/revocation, profile, saved addresses, customer/contractor/admin roles.
- Catalogue search/categories/detail, quantity selection, persisted customer cart, stock checks and current-price review.
- Server-owned integer-paise totals; customer approval of delivery-inclusive review; stale-price/delivery-policy detection; order idempotency; transactional stock reservation and cancellation.
- COD order lifecycle, payment-received recording, fulfilment, tracking/history, order summary sharing/access and reorder at current prices.
- Razorpay order creation, callback signature/provider verification, authenticated raw-body webhook processing, duplicate/conflicting-event handling, full-refund events, late-capture refund handling and admin reconciliation.
- Unpaid reservation expiry, persistent in-app notification records and a bounded single-instance maintenance/push worker.
- Bulk requests with materials, quantities, saved site address, delivery date, company/GSTIN and notes; priced/revised/expiring offers; customer accept/reject and staff acceptance/closure; immutable revision history.
- Admin overview, product/category/price/stock controls, orders/payment history, basic customer view, quotes and finance/store settings.
- Editable contact/WhatsApp, flat delivery fee, free-delivery threshold, delivery copy and online-payment switch. Online payments cannot be enabled without server credentials.
- SSE cache invalidation with reconnect refresh; pushed prices are never treated as authoritative.
- Responsive phone/desktop layouts, accessible control labels/state, reduced-motion web styles, loading/empty/network error states and English/Hindi navigation/core shopping copy.
- OpenAPI request contracts, structured request logs, audit trails, secure headers/CORS, strict validation, roles and owner-scoped data access.
- Backend Dockerfile, local PostgreSQL Compose file, GitHub Actions verification workflow, environment examples, architecture/setup/deployment/security documentation.

## Partially implemented

- **Online payments:** full server/client integration code and verified local signed-event tests; real Razorpay checkout/provider reconciliation/refunds await a test account and device testing. Refund initiation is performed by staff in Razorpay.
- **Notifications:** persistent in-app records and Android FCM registration/sending code; no actual Firebase delivery tested. iOS requires its FCM/APNs bridge/configuration. The worker offers bounded, at-least-once delivery, not exactly-once push.
- **Images:** product image URLs and R2 upload integration; real bucket/CORS credentials required. Seed products use illustrative material graphics, not official product photos.
- **Localization:** English/Hindi navigation and main shopping text. Some forms, validation messages and administrative copy remain English.
- **Invoices:** immutable order summaries are available; statutory GST tax invoices/PDF invoice storage are not implemented without business/tax details.
- **Bulk acceptance:** an accepted quotation is a recorded commercial agreement for store follow-up. It does not automatically reserve stock, charge payment or convert to an order.
- **Native delivery:** Android/iOS JavaScript exports built successfully. Signed APK/AAB/IPA builds and physical-device verification are not completed.

## Not implemented

- GST calculation, statutory tax invoicing, partial/automatic refunds and automatic quote-to-order conversion.
- Live GPS, drivers, multi-store support, advanced accounting/ERP, AI, recommendations, loyalty/referrals and the other explicitly excluded systems.
- Offline order submission. Existing content can stay visible, but orders require a live authoritative server check.
- Distributed rate limits, cross-instance SSE, multi-worker work claiming, sophisticated analytics or warehouse management. V1 intentionally targets one store and one API instance.
- Full historical-list pagination beyond the documented bounded list queries (100 customer orders, 300 admin orders/customers/quotes, 1,000 admin products). These limits should be replaced with cursor pagination when real history approaches them.

## Requires external credentials

Razorpay key/secret/webhook secret; Twilio Verify; Firebase service account and Android config; Cloudflare R2 endpoint/bucket/access keys/public asset domain; production Neon/PostgreSQL; Expo/EAS and app-store signing/publishing accounts; hosting accounts.

Only placeholder examples and ignored local development values are supplied. No live account was created, no production payment taken and no production deployment performed.

## Requires manual configuration

Set verified inventory/prices and delivery policy; set final phone/store business details; provision production/staging databases and apply migrations; grant the real owner admin role; set exact HTTPS origins and proxy trust; configure providers and signed webhooks; configure R2 asset-domain/CORS; link EAS and Firebase; test native payment handoff, push, delivery operations and refund workflow; configure backups, monitoring and retention.

## Verification results

| Check                                         | Recorded result                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint                                        | Passed across the monorepo                                                                                                                                                                                                                                                                                                                                                |
| TypeScript                                    | Passed for shared, API, admin and mobile                                                                                                                                                                                                                                                                                                                                  |
| Domain unit tests                             | 5 passed: paise totals/thresholds, invalid/overflow amounts, injected inputs, state transitions, exact raw-body HMAC                                                                                                                                                                                                                                                      |
| Real PostgreSQL integration/service/API tests | 20 passed: OTP/brute-force/session rotation, CSRF/HttpOnly cookies, device revocation, admin/owner authorization, price/delivery/cart changes, expiry, concurrent last stock, concurrent duplicate orders/cancellations, COD lifecycle, reorder, forged/mismatched/replayed webhooks, late captures/refunds, quote revision/expiry/admin acceptance, database constraints |
| Browser journeys                              | 4 passed: customer COD/address/tracking/reorder/bulk/Hindi flow; admin price/fee/fulfilment/quote flow; live SSE price update plus mandatory re-approval of a changed total; unauthorized admin sign-in and network recovery                                                                                                                                              |
| Production builds                             | Shared and NestJS TypeScript builds passed; Next.js production build passed; Expo exported web, Android Hermes and iOS Hermes bundles                                                                                                                                                                                                                                     |
| API production dependency audit               | Zero advisories                                                                                                                                                                                                                                                                                                                                                           |
| Full dependency audit                         | 11 affected packages: 4 high, 7 moderate, 0 critical, in the Expo development/native tooling dependency tree; unresolved upstream issues documented in SECURITY.md                                                                                                                                                                                                        |
| Docker image build                            | Prepared in CI, not run locally because Docker is unavailable                                                                                                                                                                                                                                                                                                             |
| Native signed builds / live provider tests    | Not run; external accounts, credentials and device/signing configuration required                                                                                                                                                                                                                                                                                         |

Browser inspection found and fixed React Native web text-node warnings, a web-only BackHandler warning, and missing web ARIA checked/selected state on native controls. The final automated journeys passed after these fixes. There are no known failing application tests in the recorded suite.

## Skills and documentation used

The requested find-skills workflow inspected the public skills.sh leaderboard and verified the Vercel agent-skills repository. Vercel’s React Native skill had 229,528 installs; the repository had 31,823 stars when checked. Its native UI, state, accessibility and monorepo guidance was used without a global skill installation. Existing frontend-design and Playwright skills guided interface work and browser verification.

- [Vercel React Native skill](https://skills.sh/vercel-labs/agent-skills/vercel-react-native-skills)
- [Source repository](https://github.com/vercel-labs/agent-skills)
- Optional installation: `npx skills add vercel-labs/agent-skills@vercel-react-native-skills -g -y`

Current framework/provider documentation was fetched through Context7 for NestJS, Expo, Prisma, Next.js and Razorpay before implementation.
