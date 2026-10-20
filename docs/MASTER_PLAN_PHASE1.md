# Master Plan v2 — Phase 1: phone orders and khata

Implemented against `MASTER_PLAN.md` §5 on 20 October 2026. This is the backend
phase of the new master plan, distinct from the earlier `P1_APP_FOUNDATIONS.md`.
The NestJS/Prisma API, integer-paise money helpers, inventory reservations,
serializable transaction retries, authorization and generated OpenAPI remain the
source of truth. No frontend rebuild is part of this phase.

## What changed

- `apps/api/prisma/schema.prisma` and two additive migrations: nullable order
  reviews, order source/creator, CREDIT on the existing `Payment.method`, customer
  credit settings, cached balances, immutable ledger entries, notes and contacts.
  Existing app orders retain reviews; historical quote orders are tagged QUOTE;
  customer recency is backfilled. Database constraints enforce supported paise
  ranges, ledger sign/reference rules, one opening balance, one sale per order,
  one reversal per entry, and append-only ledger rows.
- `packages/shared/src/index.ts`: strict phone-order, payment, adjustment,
  reversal, customer settings, notes and contact contracts; `OrderSource`,
  `LedgerKind`, CREDIT payment typing and signed integer balance arithmetic.
  `errors.ts` includes the new error codes and bilingual account-deletion message.
- `apps/api/src/phone-orders.ts`: owner-only order creation, phone lookup or
  Hindi customer creation without login/session creation, database price
  snapshots, quantity/delivery policy checks, atomic stock reservation, confirmed
  orders, acknowledged owner work and audited idempotency receipts.
- `apps/api/src/khata.ts`: account snapshots, cash/UPI receipts, adjustments,
  reversals, due summary, FIFO debt aging, customer settings, notes and contacts.
  Financial and ledger records commit together. Negative balances represent
  customer advances. Reversing a receipt appends a matching financial reversal.
- `orders.ts`, `payments.ts`, `quotes.ts`: CREDIT posts to khata on delivery;
  COD receipt/refund actions reject CREDIT with 409. Cancellation before delivery
  restores stock and releases pending credit exposure. App and quote orders also
  maintain `lastOrderAt`; quotes record their source and creator.
- `admin.ts`, `pagination.ts`, `reports.ts`: customer search by name/phone/area,
  sorting by due (including negative-balance cursors), dashboard credit metrics net of sale reversals,
  and khata receipts/reversals in the existing cash reports. Credit orders stay
  out of the pending-payment queue; existing online-payment behavior is retained.
- `integrations.ts`: daily balance reconciliation logs KHATA_DRIFT without
  changing either the ledger or cached balance; failed checks are retried.
- `operations.ts`: account deletion requires a settled balance and scrubs the new
  CRM fields. Immutable financial/khata evidence is retained.

## API contract

All routes below are under `/api/v1/admin` and require a live ADMIN session.
Request bodies are described by the existing generated OpenAPI at `/api/docs`
and `/api/docs-json` in development/test.

| Method     | Route                                   | Behavior                                                                                        |
| ---------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| POST       | `/orders/phone`                         | Create PHONE (default) or WALK_IN order                                                         |
| GET        | `/customers/:id/khata?limit&cursor`     | Balance, credit policy, paginated `entries: {items,nextCursor}`                                 |
| POST       | `/customers/:id/khata/payment`          | Positive `amountPaise`, note, UUID idempotency key, optional business date and CASH/UPI channel |
| POST       | `/customers/:id/khata/adjust`           | Nonzero signed amount, note, UUID key, optional business date; first entry is OPENING_BALANCE   |
| POST       | `/customers/:id/khata/reverse/:entryId` | Required note and UUID key; one reversal per original entry                                     |
| GET        | `/khata/summary`                        | Positive total due, debtor count, debt outstanding for more than 30 days                        |
| PATCH      | `/customers/:id`                        | Credit permission/limit, area, tags                                                             |
| POST / GET | `/customers/:id/notes`                  | Add a note / read a cursor page of notes                                                        |
| POST       | `/customers/:id/contacts`               | Record CALL or WHATSAPP contact intent; sends no message                                        |

Phone orders require customerPhone in canonical `+91…` form, items, deliveryDate
(`today` or ISO calendar date), COD/CREDIT paymentMethod and a UUID idempotencyKey.
customerName, notes and overrideLimit are optional. PHONE requires an inline
address using the existing address contract; WALK_IN may omit it and incurs no
delivery fee. Store pickup retains an address-shaped snapshot for existing order
consumers. Client-supplied prices/totals and duplicate products are rejected.

New customers start with credit disabled. Enabling credit requires an explicit
integer-paise limit. Exposure includes the posted balance, undelivered credit
orders and the proposed order. Credit must remain enabled even when requesting
an override. Overrides never bypass the supported ledger balance range. An already accepted credit order posts on delivery even if its
customer's policy subsequently changes.

Only Papa's authenticated ADMIN account may request an override. Configure his
canonical phone in `CREDIT_OVERRIDE_PHONE`; blank disables all overrides. The
number confirmed in this chat is configured only in the ignored local API `.env`.
Committed local/staging templates document the variable with a blank value.
Every override records CREDIT_LIMIT_OVERRIDE with actor, limit and exposure.

Monetary POSTs require client-generated UUID keys so a lost response can be
retried safely. Replaying the same parsed payload returns the original record;
reusing a key with different terms/operation returns 409. Business dates accept
ISO dates (interpreted at midnight IST) or ISO timestamps with offsets, no later
than now. Ledger order/running balances use posting time; business dates govern
reports and aging. Reversal of a reversal is rejected.

## Verification

Completed locally:

- `npm run lint` and `npm run typecheck` across the workspace.
- `npm test`: 110 API unit tests.
- `npm test -w @shiv/shared`: 30 tests, including four new contract/money tests.
- `npm run test:integration`: 144 PostgreSQL tests, including 26 new tests in
  `apps/api/test/khata.test.ts`.
- `npm run test:workflows`: 20 owner/customer workflow tests.
- `npm run test:bootstrap`: migrations-only bootstrap and idempotent owner setup.
- Mobile and storefront unit suites: 7 and 16 tests respectively.

The new database suite exercises authorization, atomic money/stock writes,
simultaneous creation/replay, different customers competing for the last bag,
concurrent credit-limit reservations, simultaneous payment/delivery, overflow
rollback, ledger immutability/reversals, CRM, aging, cash reports, deletion,
reconciliation drift and OpenAPI routes.

- `npm run build`: full shared/API/admin/mobile/storefront production build passed;
  the API was rebuilt after the final supported-balance and dashboard guards.
- Prisma migration diff in a fresh disposable shadow database: no difference.
- `npm run test:local`: theme output matched. Its one optional database test was
  then enabled with `node --env-file=apps/api/.env.test --test scripts/local.test.mjs
scripts/staging-smoke.test.mjs scripts/demo.test.mjs`: all 19 passed.
- `git diff --check`: passed. Generated Next declarations were restored to avoid
  unrelated frontend changes.

The first local-script attempt was blocked by sandbox loopback-listener limits;
its rerun outside the sandbox passed. Database tests likewise ran outside the
sandbox against the isolated `_test` database. Browser suites, Docker image checks,
remote CI and deployment were not run for this backend phase.

## Remaining scope and operating notes

- Phase 0 and Phase 2 UI work are separate. This phase adds no owner screens or
  frontend design/i18n packages. The existing OTP/passphrase policy is unchanged.
- No new dependencies, external providers, WhatsApp sends, payment activation,
  hosting changes, deployment or remote publication.
- Both additive migrations were applied to the local development and dedicated
  test databases; no development database reset or data deletion was performed.
  Prisma Client was regenerated. Production operators must run `npm run db:migrate`
  and reapply the existing runtime-grants script after migrating, as usual.
- Papa-only overrides use configuration rather than a new staff role. Before any
  deployment, set `CREDIT_OVERRIDE_PHONE` to his verified ADMIN phone. Other
  owners can manage credit settings but cannot submit a one-order limit override.
- A ledger payment is allocated to the customer's account rather than an
  individual order. CREDIT payment rows remain PENDING; account balance is the
  source of truth for money owed.
- Account closure retains immutable ledger notes as financial evidence. Owners
  should keep personal delivery instructions in CRM notes rather than ledger notes.
- Remote CI/physical-phone acceptance is not established by these local tests.
