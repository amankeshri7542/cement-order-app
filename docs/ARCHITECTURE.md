# Shiv Cement Store — implementation plan

## Scope and assumptions

Single store, INR, delivery throughout Bihar, English/Hindi customer UI. Phone/WhatsApp initially +91 9297513707. Admin controls store contact, flat delivery fee, free-delivery threshold, and online-payment switch. Example inventory is seeded in PostgreSQL for local development only; it is never embedded in the customer app. No provider accounts are available yet. COD works locally; production OTP, online checkout, push, and object storage need credentials.

## Architecture and trust boundaries

An npm monorepo contains Expo/React Native mobile, Next.js admin, NestJS API, and one small shared package for contracts, validation, and display formatting. PostgreSQL is authoritative. Native sessions use SecureStore; browser sessions use HttpOnly cookies with origin validation. Roles are loaded from the database on every authenticated request. No client can assign its own role or authoritative price. Admin bootstrap is an explicit local CLI action.

The API validates strict Zod schemas, exposes versioned REST and OpenAPI, and returns safe error codes with request IDs. Public product SSE messages only invalidate cached data. A single API instance supports in-process notification and rate limiting; database OTP limits protect phone numbers across restarts. HTTPS, exact CORS origins, secure cookies, and real OTP configuration are mandatory in production.

## Domain and contracts

User, Session, OtpChallenge, Address, Category, Product, ProductPriceHistory, CartItem, CheckoutReview, Order, OrderItem, OrderStatusHistory, Payment, PaymentEvent, Quote, QuoteItem, QuoteRevision, Notification, AuditLog, and singleton StoreSettings. Prices and all totals are integer paise. Order items and addresses are immutable snapshots.

- `/api/v1/auth`: request/verify OTP, rotate refresh token, logout; `/me`: profile and addresses.
- `/products`, `/categories`, `/store`, `/events`: public discovery and price invalidation.
- `/cart`: customer-owned cart; `/checkout/review`: current totals plus price-change details.
- `/orders`: consume a short-lived, customer-bound review, using an idempotency key; detail, history, reorder, invoice summary.
- `/payments`: create Razorpay order; verify callback; raw-body authenticated webhook is payment authority.
- `/quotes`: request, inspect, accept/reject current revision; `/admin`: products, categories, order fulfilment, quotes, customers, settings, audit history.

## Checkout and concurrency

Adding to cart records the current database price/version for later comparison. Review returns current values, changed lines, and a five-minute persisted review. Placing an order rechecks review ownership/expiry, current cart, prices, delivery policy, address, and stock in a SERIALIZABLE transaction. Conditional stock decrements prevent overselling. A stale review produces `PRICE_CHANGED`; nothing is charged. Clients must show and explicitly accept a new review. Serializable conflicts retry a bounded number of times. Idempotency keys prevent duplicate orders. Cancellation restores stock once in the same transaction. Online unpaid reservations expire; late successful payment is flagged for refund rather than silently reviving cancelled inventory.

## Payments and quotes

Razorpay orders are created from saved order totals. Callback signature and provider verification cannot override amount/currency/order checks. Raw webhook HMAC is compared in constant time; event IDs and payload hashes are persisted transactionally. Captured payment changes state once. Uncertain gateway creation is kept pending for reconciliation, never blindly retried. Full refunds are verified through provider events; partial refunds are outside V1.

Bulk requests record products/quantities, site, date, GST/company/contact, and notes. Admin can price/revise a quote with expiry. Customers accept only the revision they actually reviewed. Revisions remain audited. Accepted quotes are commercial agreements for store follow-up; automatic quote-to-paid-order conversion is outside this first implementation.

## Screens and visual direction

Customer: Home, Products, product detail, cart, address/delivery/payment review, confirmation, Orders/tracking/reorder, Account/addresses/language, Bulk quotes. Admin: overview, orders/detail, products/editor, quotes/editor, customers, finance/settings. Deep navy, construction yellow, cool concrete grey, white, and muted steel blue; strong sans-serif typography, large readable prices, a restrained cement-bag motif, and clear touch targets. No broad ecommerce marketplace UI.

## Phases and verification

1. Contracts, Prisma schema, migration, development seed, secure API foundations.
2. Cart/review/order transactions, Razorpay boundary, fulfilment and quotes.
3. Complete customer and admin journeys, errors/loading/empty states, bilingual navigation.
4. Unit tests, real PostgreSQL integration/concurrency tests, browser journey tests, typecheck/lint/build, security review.
5. Docker, GitHub Actions, deployment/environment documentation and honest implementation report.
