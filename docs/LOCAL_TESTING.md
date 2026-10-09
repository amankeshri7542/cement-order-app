# Local testing — Shiv Cement Store

This checkout is for local review. No deployment, real SMS or money movement has been performed.
Use the **TEST — Cement PPC** practice product and **800099** practice pincode below; neither is a real commercial offer or coverage claim.

## Start from a fresh Mac checkout

Use Node **22.12 or newer** (verified here on 24.19.0), npm (verified 11.17.0), PostgreSQL **16**, and Google Chrome. The project retains Prisma 6, Next.js 16, Expo 55 and React 19; do not independently upgrade their major versions.

```sh
brew install node@22 postgresql@16
export PATH="$(brew --prefix node@22)/bin:$(brew --prefix postgresql@16)/bin:$PATH"
git clone --branch codex/pilot-readiness https://github.com/amankeshri7542/cement-order-app.git
cd cement-order-app
# For an exact review, check out the commit SHA supplied in the review handoff.
npm ci
npm run local:setup
npm run local:start
npm run local:status
```

`local:setup` creates missing secret-bearing `.env` files with owner-only permissions, uses an existing local PostgreSQL server or creates an isolated cluster in ignored `.local/postgres`, and prepares separate development and test databases. It generates Prisma, builds shared contracts, applies migrations, then adds idempotent practice fixtures. Existing `.env` files, products, balances and accounts are preserved. An existing `apps/api/.env.test` is used for test migrations; its `TEST_DATABASE_URL` must use the same local PostgreSQL server and credentials as development, with a different database name ending in `_test`. Setup stops before database work if these settings disagree. It does **not** run a destructive reset or enable online payments.

Apple Silicon and Intel Homebrew PostgreSQL paths are detected. For another installation set `PG_BIN=/absolute/path/to/postgresql/bin`. Default database binds only `127.0.0.1:55439`. Default databases: `shiv_cement` for development, `shiv_cement_test` for existing integration/browser tests. The OTP hash secret is generated randomly; the database password is an intentional fixed local-only fixture. Both are for local development, never staging.

| Service                 | URL                                 | Foreground command instead of `local:start` |
| ----------------------- | ----------------------------------- | ------------------------------------------- |
| Customer browser app    | http://localhost:8081               | `npm run dev:web`                           |
| Owner desk              | http://localhost:3000               | `npm run dev:admin`                         |
| API health              | http://localhost:4000/api/v1/health | `npm run dev:api`                           |
| OpenAPI                 | http://localhost:4000/api/docs      | API must be running                         |
| Native Expo development | terminal QR/device instructions     | `npm run dev:mobile`                        |

Use **localhost consistently** for browser apps; do not mix it with 127.0.0.1. The apps use HTTP-only cookies and exact allowed origins. Open the customer in a separate browser profile or incognito window from owners: cookies are shared across localhost ports. To use father and uncle simultaneously, use two browser profiles.

`local:start` leaves processes running with logs in `.local/api.log`, `.local/admin.log`, `.local/customer.log`. `npm run local:stop` stops only its recorded app process groups. `node scripts/local.mjs db-stop` stops this database cluster separately. Restart with `npm run local:start`; it starts the cluster when needed. Do not run build and development commands against the same Next output directory simultaneously.

## Test identities and OTP

| Persona                  | Phone      | Staff passphrase         |
| ------------------------ | ---------- | ------------------------ |
| Father — retail owner    | 9900000001 | `Local-owner-only-2026!` |
| Uncle — wholesale owner  | 9900000002 | `Local-owner-only-2026!` |
| Ravi — customer          | 9900000003 | none                     |
| Named technical operator | 9900000004 | `Local-owner-only-2026!` |

Choose **Get verification code**, copy the clearly labelled development OTP displayed in the form, then verify. Staff also enter the passphrase. Codes are random, expire in five minutes, have five attempts and are single use. These phones/passwords are **local fixture identities only**. The API's production startup rejects mock OTP. No real SMS is sent locally.

For a separate real staff account, supply `ADMIN_BOOTSTRAP_PASSWORD` through your shell/secret manager and run:

```sh
npm run admin:grant -w @shiv/api -- +91YOUR_NUMBER 'Owner name'
```

That command safely ensures StoreSettings exists, assigns staff access, hashes the passphrase and revokes previous sessions. Migrations and staff setup work without any development seed. StoreSettings starts with online payments off and no inventory/coverage.

## First smoke test (about five minutes)

1. Open the owner desk as Father and leave **आज / Today** visible.
2. In a separate profile, sign in as Ravi. Open Products, search **TEST — Cement PPC**, select **50** bags, add to cart, and continue to checkout.
3. Select **TEST Site** at pincode **800099**, choose a future date, review, and check consent. Confirm **₹19,500 material + ₹500 delivery = ₹20,000**. Place the order once.
4. Keep the displayed order number. Owner Today → **नया काम / New work** must show it automatically (within 15 seconds with polling; no manual page reload needed).
5. Open it → **ज़िम्मेदारी लें / Acknowledge**. Father’s name appears. Prepare → dispatch → record **₹20,000 actually received** → mark delivered. In local practice only, the collection button records simulated cash; no payment provider is called.
6. Refresh both browsers. There is one order, one stock deduction of 50, one collection movement, and the customer sees Delivered.

## Cart feedback and recovery checks

1. Add the same material twice. Its card should show `2` with minus/plus controls and the header badge should increase to `2`. A second material increases the distinct-product count separately.
2. Open the cart, type a multi-digit quantity such as `12`, and leave the input or press Enter. Check the full value, reload, and verify it remains. Try a quantity outside the material's minimum, step or stock: the app explains the rule and restores the confirmed value.
3. Decrease a product card to its last selling unit and press minus again. The line disappears and Add to cart returns.
4. Add as a guest, complete sign-in, then add again. Wait for the first save to finish; both additions must remain.
5. From an existing order, use Order again. If its response is lost, reload and use Check reorder result; the same request must not add the materials twice.

## Complete manual checklist

Father and Uncle use one shared store inventory and ledger. Rate Studio publishes customer selling prices: if a supplier sheet contains purchase costs, replace them with agreed selling prices before marking rows reviewed and confirming publication. No margin is calculated automatically.

Use fresh orders for terminal scenarios. Record order/quote numbers and the observed outcome.

| Persona                    | Starting state                                   | Exact actions                                                                                                                                                                                                      | Expected result                                                                                  | Failure indicators                                                     |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Customer + Father          | Signed in; owner Today open                      | Run smoke test above; wait without clicking Refresh                                                                                                                                                                | Order arrives automatically; named acknowledgment persists                                       | Missing order after 15 seconds, duplicate order, owner identity lost   |
| Customer                   | TEST product at ₹390; zone fee ₹500              | Add 50; review and consent                                                                                                                                                                                         | ₹20,000 total, integer-paise server calculation                                                  | Different total, submit enabled without consent                        |
| Father                     | Newly placed order                               | Prices & stock → product → Stock ledger; refresh/retry original submission                                                                                                                                         | Exactly one -50 movement, balance reduced by 50                                                  | Two deductions or negative stock                                       |
| Father                     | Confirmed order                                  | Acknowledge → Mark preparing → Mark out for delivery → Record cash payment received → Mark delivered                                                                                                               | Ordered history, full collection once, delivered after collection                                | Delivery permitted before payment, backwards/skipped status            |
| Father                     | Dispatched unpaid order                          | Report delivery issue → Refused; enter note → Save issue                                                                                                                                                           | Delivery exception; payment remains Pending; stock stays reserved                                | Fake paid/delivered state or early stock restoration                   |
| Father                     | Delivery exception                               | Schedule retry, select date and note → dispatch retry; report issue again                                                                                                                                          | Retry date/history visible to customer; no extra stock movement                                  | Stock deducted twice or exception lost                                 |
| Father                     | Goods physically returned                        | Confirm physical return; enter sellable and damaged counts for every line, totaling dispatched quantity                                                                                                            | Only sellable stock restored once; unpaid order Cancelled; collected order Refund pending        | Full stock restored despite damaged goods; no count validation         |
| Father                     | COD Refund pending                               | Return the full cash in practice → Record cash refund returned                                                                                                                                                     | Refunded, one refund movement; no extra stock release                                            | Refund counted as collection or stock restored twice                   |
| Customer + Uncle           | Quote request draft                              | Select materials/valid quantities, address/date, send; Uncle More → Bulk quotes → acknowledge → price every item, freight/date/expiry, explicitly confirm transport feasibility → Send quotation; customer accepts | Revision and decision provenance retained                                                        | Missing agreed freight, unpriced lines, silent acceptance              |
| Uncle                      | Accepted current quote                           | Convert accepted quotation; repeat click/refresh                                                                                                                                                                   | One linked managed COD order; negotiated prices/freight/quantities retained, stock reserved once | Catalogue repricing, duplicate conversion, stock ignored               |
| Uncle + Customer           | Accepted quote, not converted                    | Change terms/date in a new offer → send; try conversion before and after customer accepts new revision                                                                                                             | Old consent cleared; conversion blocked until new acceptance                                     | Old acceptance authorizes new terms                                    |
| Customer                   | Past order or product with changed quantity rule | Order again; adjust quantities in product/cart; try unsupported quantity                                                                                                                                           | Valid lines added; invalid/unavailable/full-cart lines explained, no silent rule violation       | 51st product, below-minimum or off-step quantity accepted              |
| Customer                   | Checkout or quote with notes/quantities          | Add/edit address; Save; browser Back; refresh page                                                                                                                                                                 | Return to originating draft with quantities, notes, selected address retained                    | New blank draft or wrong destination                                   |
| Customer                   | Active draft/catalogue pages                     | Browser DevTools Network → Offline; use Back/refresh; restore Online                                                                                                                                               | Task stays visible, honest retry message, valid selections/pages retained                        | Task disappears, quantity resets without rule change                   |
| Customer                   | Order submission in progress                     | Throttle network; tap twice; reload after a lost response; use pending-order recovery                                                                                                                              | Same request key reconciles one order and keeps order ID                                         | New key/resubmission while outcome unknown, false success/failure      |
| Staff                      | Fresh OTP                                        | Wrong passphrase, then correct passphrase with same code; also test expired code                                                                                                                                   | Local attempts stay bounded; clear invalid/expired vs outage messaging                           | Forced new OTP after password typo, unlimited attempts, account bypass |
| Father                     | Product/stock controls                           | Prices & stock → Edit price; Stock ledger → Purchase in / Walk-in sale / Damage / Return / Manual adjustment with note and reference                                                                               | Version conflict handled, immutable ledger; counter collections separately reported              | Stock overwritten directly, price conflict ignored                     |
| Uncle                      | More → Rate Studio                               | Manual entry → select materials → edit → review → publish → create/download rate card                                                                                                                              | Works without AI keys, explicit human review; published prices/history/card retained             | Unreviewed extraction published, existing product images removed       |
| Any persona                | Hindi or English selected                        | Switch language; navigate, refresh, sign out/in                                                                                                                                                                    | Preference saved immediately; readable Hindi, visible focus, 44px owner actions                  | Reverts unexpectedly, clipped action, horizontal overflow              |
| Customer                   | Guest on product/protected destination           | Add valid quantity or open Orders, then log in                                                                                                                                                                     | Add intent or destination resumes once                                                           | Login abandons intended task or adds twice                             |
| Owner + technical operator | Exceptional ONLINE order in provider simulation  | Open Technical payment recovery; assign named operator; verify provider order                                                                                                                                      | Checking/pending/refund states stay honest; screenshots never prove payment                      | Manual screenshot marks Paid; missing operator; unverified refund      |

Browser DevTools failures are intentional only in the connection tests. Restore network/routing before another scenario. Test desktop and 390px phone width, long Hindi notes, keyboard tab/Enter, and browser zoom at 200%. Physical-device keyboard, native SDK and phone/WhatsApp handoffs require a real device and are not established by a browser screenshot.

## Automated evidence and commands

Run database/browser suites **sequentially**. The existing integration suite and Playwright share `shiv_cement_test`; either resets it. Never point TEST_DATABASE_URL at development or production. Workflow and bootstrap suites use separate disposable databases and clean them up.

```sh
npm run lint
npm run typecheck --workspaces --if-present
npm test                    # pure/unit + labelled provider-contract simulations
npm run test:bootstrap      # migrations + staff setup, empty disposable PostgreSQL
npm run test:integration -w @shiv/api # existing real PostgreSQL API suite
npm run test:workflows      # new real PostgreSQL races and business workflows
npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome
TMPDIR=/private/tmp npm run test:e2e -- --config=playwright.qa.config.ts --project=webkit
npm run local:stop
npm run build -w @shiv/shared
npm run build -w @shiv/api
npm run build -w @shiv/admin
npm run build -w @shiv/mobile # Expo Android/iOS/web JS exports
npm run local:start
```

Browser tests use installed Chrome and ports **4010 / 3001 / 8082**, independent of manual dev servers. `npx playwright install chrome` installs it if missing. For WebKit, install the engine with `npx playwright install webkit`. Run exactly one project per invocation: global setup resets the shared disposable database. Firefox is currently blocked at native browser launch; see [the QA report](BROWSER_QA_REPORT.md). Their rate-extraction adapter is deliberately confined to `scripts/e2e-api.ts` and requires NODE_ENV=test plus a database ending `_test`. Razorpay/Twilio provider simulations do not establish live integration. Standard dev server has no fake provider fallback beyond explicitly selected mock OTP.

## Reset and recovery

- **Safe fixture rerun:** `npm run local:setup` does not replenish used stock, reset prices or rotate passwords. Record a Purchase in through the owner stock ledger to restore practice stock with evidence, or create a new clearly labelled test product. Run `npm run local:fixtures -w @shiv/api` to add missing fixture records only. Disposable test suites reset their own databases automatically. Never use `prisma migrate reset` on the development database to “fix” a migration.
- **Occupied port:** run `npm run local:status` and `lsof -nP -iTCP:3000 -iTCP:4000 -iTCP:8081 -sTCP:LISTEN`. Stop the owning service yourself, or `local:stop` if this script started it. No command here kills an unrelated listener.
- **Database unavailable:** `npm run local:start` starts the cluster; inspect `.local/postgres.log`. Ensure port 55439 matches DATABASE_URL. Do not remove a postmaster.pid until you have confirmed its process is absent. Database tools can require macOS permissions outside a restricted agent sandbox.
- **Migration error:** stop app servers, back up first, inspect `npm exec -w @shiv/api -- prisma migrate status` so Prisma loads `apps/api/.env`. Fix permissions/connectivity; this app uses `pg_trgm`. Re-run `npm run db:migrate`. Do not mark a failed migration applied without reviewing its actual SQL/state.
- **Login problem:** confirm mock OTP and CORS values in `apps/api/.env`, use localhost consistently, request a new OTP after five failed/expired attempts. Check browser profile: customer and owner cookies must be separate. Re-grant a local staff credential deliberately if it was changed; this revokes sessions.
- **Missing dependencies/client:** `npm ci`, then `npm run db:generate` and `npm run build -w @shiv/shared`.
- **Stale Next/Metro output:** stop app servers, retry the build/start; keep e2e `.next-e2e` separate from manual `.next`. Inspect the service log instead of repeatedly submitting an uncertain order.

For family review and cloud prerequisites see [FAMILY_REVIEW.md](FAMILY_REVIEW.md). The finding matrix and exact verification limits are in [LOCAL_PROGRESS.md](LOCAL_PROGRESS.md).

## Security hardening follow-up

See [SECURITY_HARDENING_REPORT.md](SECURITY_HARDENING_REPORT.md) for the current evidence, exact security commands and staging gates. Run `npm run test:restore` only after a synthetic test suite, sequentially with other database tests; it creates/removes its own restore database and role. `npm run security:scan` is a limited working-tree credential-pattern check.

The local customer web command now puts security headers around Expo HTML. Browser port 8081 uses a private loopback Expo listener on 8091; the browser harness uses 8082/8092. Keep those pairs free. Production exports use `npm run serve:customer` behind a verified HTTPS proxy and need the same build/serve API origin. Use `expo export --clear` when changing API build variables to avoid cached bundles with old origins. Mock API authentication is loopback-only; real phone/staging access requires separately verified production authentication.

Finance & settings → Booking limits shows demand warnings and audited one-request exceptions. Defaults are proposals requiring family agreement before staging; they do not cancel orders or release stock. Keep online payments off.
