# Master Plan v2 — Phase 2: owner dashboard

This report uses the 20 October 2026 master plan numbering. The repository's earlier P1–P11 reports describe the previous roadmap. Phase 1 backend changes and this dashboard rebuild are delivered together on `codex/owner-dashboard-phase2` because Phase 1 had not yet been committed.

## What changed

- `apps/admin/app/(owner)` replaces the hash router with `/today`, `/orders`, `/orders/new`, `/orders/[id]`, `/customers`, `/customers/[id]`, `/khata`, `/stock` and `/more`. Shared layout owns authentication, navigation, offline state, confirmations and unsaved-form guards.
- `packages/design` supplies shared tokens and accessible phone-sized controls. `packages/i18n` supplies typed Hindi/English catalogues, interpolation/parity checks and a static-copy check for the new owner screens. Hindi is the default; Mukta and Inter are loaded by Next.js.
- TanStack Query caches each domain separately. SSE and fallback polling invalidate dashboard and order lists; mutations refresh their affected records even when a lost response may conceal a committed write.
- Three-step phone orders use server-authoritative prices, quantity controls, date chips, saved address suggestions, customer credit policy, a review sheet and a WhatsApp/call success sheet. Uncertain submissions retain the original payload and idempotency key. Anonymous cash walk-ins use a non-login customer sentinel.
- Today presents collections, outstanding credit and actions for pending work. Routed order details preserve preparation, dispatch, delivery, cash receipts/refunds, delivery problems, retry, physical returns, history and printable summaries. Online-payment reconciliation remains conditional on the existing disabled payment setting.
- Customer details expose khata, payments, adjustments, reversals, notes, area/tags and credit settings. Khata summaries include overdue customers and recorded WhatsApp reminder handoffs. Stock supports price changes, incoming stock, walk-ins and sharing a card rendered from current catalog prices. Uncertain incoming-stock receipts retain their original payload and key across reopening.
- More includes store information, zones, devices, owner alerts, activity, language and date-range reports/CSV. Advanced product and quote tools remain available. Rate Studio remains behind `NEXT_PUBLIC_FEATURE_RATE_STUDIO=false` by default; its preservation tests explicitly enable it.
- API support includes configurable OTP-only sliding owner sessions, session labels and renaming, customer-scoped order filters, credit-report figures/top customers, current-price card rendering and ledger reversal references. Existing strict passphrase tests now opt into strict policy explicitly.
- Closing pass: the "+ नया ऑर्डर" button is now on every owner screen except the order form itself (it was only on Today), so a phone order is one tap from anywhere. The five old hash-router desk screens that nothing imports any more (`money`, `orders`, `security-controls`, `settings`, `setup` under `apps/admin/components`) were deleted. The P11 setup checklist that sat on Today went with `setup.tsx` on purpose, because the plan's Today shows nothing else; first-run store setup is done under More (store details, delivery areas, alerts) and is covered by `tests/first-run.spec.ts`.

## Plan coverage (§6)

| Plan item                                                                                              | Status                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| App Router segments, hash router and duplicate dirty-guards removed, one `useUnsavedGuard()`           | Done                                                                                                                     |
| TanStack Query, per-key invalidation, SSE/poll refresh only the dashboard and order lists              | Done                                                                                                                     |
| `lib/api.ts` maps network, timeout and 5xx failures to `error.*` keys                                  | Done, unit tested                                                                                                        |
| `<html lang="hi">`, `tokens.css`, Mukta and Inter through `next/font`                                  | Done                                                                                                                     |
| Login: empty phone, OTP, 30-day sliding session, device list, rename and revoke                        | Done. Default device names come from the browser ("Android phone"), editable under More, not "Papa ka phone"             |
| आज: collections and due hero cards, ordered work list, new-order button on every screen                | Done                                                                                                                     |
| नया ऑर्डर: three steps, customer lookup, date chips, saved address, cash/credit, review sheet, share   | Done                                                                                                                     |
| ऑर्डर: list, search, filters, one primary action, problems under "समस्या दर्ज करें"                    | Done                                                                                                                     |
| ग्राहक: list by due or recent, detail with khata, orders, notes, settings                              | Done                                                                                                                     |
| खाता: total due, customers with due, 30-day section, WhatsApp reminders                                | Done                                                                                                                     |
| भाव और स्टॉक: price change, stock in, counter sale, low-stock badge, rate card share                   | Done                                                                                                                     |
| और: store info, zones, devices, activity, language, Rate Studio flag; रिपोर्ट with CSV export          | Done                                                                                                                     |
| Confirm sheets, numeric ₹ keypad, Indian grouping, offline banner, install prompt                      | Done                                                                                                                     |
| Playwright specs for phone order and khata, axe at 360 px and 200% text on Today, order entry, details | Done                                                                                                                     |
| Zero English in owner screens (grep test)                                                              | Done for the new screens (`npm run i18n:check`). The older quote, product and staff tools keep paired Hindi/English text |
| Lighthouse PWA installable                                                                             | Not measured. Manifest, icons and service worker are in place; needs a hosted HTTPS origin                               |
| Family task list on a real Android phone, six-tap target                                               | Not done, needs a phone. Measured in the browser: 5 taps to place an order, 10 to deliver it and record cash             |

## Contract and configuration

Existing generated OpenAPI remains the API contract (`/api/docs-json` in development/test). Admin routes require a live owner session; session management is restricted to the caller's own sessions:

| Method | Route under `/api/v1`                           | Behavior                                                      |
| ------ | ----------------------------------------------- | ------------------------------------------------------------- |
| PATCH  | `/auth/sessions/:id`                            | Rename a session belonging to the caller; audited             |
| POST   | `/admin/rate-cards/current`                     | Render current active prices as PNG pages, Hindi or English   |
| GET    | `/admin/reports/export?from&to`                 | CSV export, including credit sales/payments and top customers |
| GET    | `/admin/orders?customerId&group&q&limit&cursor` | Scoped customer/date/status-group/name/phone filtering        |

`STAFF_PASSPHRASE_REQUIRED=false` and `OWNER_SESSION_DAYS=30` are documented in API environment templates. `NEXT_PUBLIC_FEATURE_RATE_STUDIO=false` is documented in the owner template. The existing `CREDIT_OVERRIDE_PHONE` configuration continues to restrict credit-limit overrides to Papa; it is not embedded in the browser. New customers start with credit disabled. No payment setting was activated.

Phase 2 adds no database migration. The two additive Phase 1 migrations and immutable khata triggers accompany this implementation; see the Phase 1 report for their invariants and rollback limits.

## Verification

Run on 20 and 21 October 2026 on the tree that was committed (Node 24.19, PostgreSQL 16 on loopback). Database and browser suites run one after another because Playwright setup resets the disposable `_test` database.

- `npm run lint` and `npm run typecheck`: passed across all seven workspaces.
- `npm test`: 115 API unit tests. `npm test -w @shiv/admin`: 19 transport/error/refresh/upload/download tests. `npm run i18n:check`: three catalogue/interpolation/static-owner-copy checks. `npm test -w @shiv/shared`, `-w @shiv/mobile`, `-w @shiv/storefront`: 30, seven and 16 tests.
- `npm run test:integration`: 152 real PostgreSQL tests, including the eight Phase 2 cases and 26 khata cases. `npm run test:workflows`: 20 tests. `npm run test:bootstrap`: migration-only bootstrap and repeated owner grants passed. A fresh local shadow database reported no Prisma migration drift.
- `npm run test:local`, then `node --env-file=apps/api/.env.test --test scripts/local.test.mjs scripts/staging-smoke.test.mjs scripts/demo.test.mjs`: theme output matched and all 19 local/demo/staging-script tests passed with no environment-dependent skip.
- `npm run build`: shared, i18n, design, API, owner desk (all nine owner routes listed), customer app export and storefront built.
- `npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome`: 124 passed. `--project=webkit`: 123 passed and one skipped by design (the service-worker check runs in Chrome only). CI runs the two engines the same way, in separate invocations.
- `npm audit --omit=dev --workspace @shiv/api --workspace @shiv/shared --workspace @shiv/i18n --workspace @shiv/storefront`: zero advisories. `npm run security:scan`: no findings. `npm ci --dry-run`: lockfile and manifests agree.

Browser coverage includes Hindi phone orders, live queue/poll recovery, competing owners, COD collections/refunds, delivery retry/physical returns, quote revision/consent, CRM notes/settings, credit posting/payment/reversal, device revocation, stock receipts, rate cards, unsaved edits, browser Back and the new-order button on every screen. Fault tests commit real transactions before hiding responses, then verify database movement counts and unchanged retry keys. Today, order entry and order details are checked with axe at 360 CSS pixels and 200% root text.

WebKit findings fixed in the specs, not the app:

- macOS WebKit runs the owner desk's service worker and then routes requests around `page.route()`, so the injected "lost response" never fired. Specs that inject faults on the desk now block service workers (as `desk-hardening` already did); Chromium still proves the worker activates.
- WebKit reports a fetch cancelled by a navigation as a page error. Runtime-error checks in the workflow and rate-studio specs now skip that one message (`isCancelledFetch` in `tests/fixtures.ts`).
- Two specs raced a request: one navigated before sign-in finished, one read the database before a note was saved. Both now wait for the response.

## Not done and limits

No deployment, provider activation, real outbound WhatsApp/SMS, payment processing or Phase 3 customer-app rebuild was performed. Browser WhatsApp actions open the user's own app and record handoff intent.

Real Android installation, notification delivery, WhatsApp file sharing, Papa/Chacha acceptance and the six-tap target require a physical-phone session. Browser emulation and exported Android bundles do not establish those results. The plan's "customer called → keyed → delivered → cash recorded in six taps" is not met as written: keying an order takes five taps plus typing, and delivering it with cash takes five more. A shorter path needs a product decision, for example one "delivered and cash received" action for counter orders.

Docker is unavailable on this machine, so the updated image was inspected but not built locally. The CI workflow runs on pull requests and on pushes to `main`, so pushing this branch alone does not start it; the Docker, restore-rehearsal and production-header checks run only there.

At 200% text size the new-order button grows with the text and covers more of a 360 px screen. Page content keeps room below it so nothing stays hidden, but on lists it overlays the bottom-right corner while scrolling. If Papa finds it in the way, collapse it to a round "+" while scrolling.

No additional product-policy question is blocking this phase. Phase 3 still needs the Play Console account details listed in the master plan.
