# Local testing — Shiv Cement Store

This checkout is for local review. No deployment, real SMS or money movement has been performed.
Use the **TEST — Cement PPC** practice product and **800099** practice pincode below; neither is a real commercial offer or coverage claim.

The current V2 review branch is `codex/v2-customer-experience`, based on the preserved
foundation `8816dd913fcb1b67a9102ea2163953f8959b19a2`. It adds the redesigned storefront,
customer commerce and Shiv Assistant. Final verification is in progress: this
checklist defines expected results and does not claim every step has passed. See
[feature parity](V2_CUSTOMER_FEATURE_PARITY.md), [design/motion](V2_DESIGN_MOTION.md)
and [the roadmap](V2_INTEGRATION_ROADMAP.md) for scope and open approvals.

## Start from a fresh Mac checkout

Use Node **22.12 or newer** (verified here on 24.19.0), npm (verified 11.17.0), PostgreSQL **16**, and Google Chrome. The project retains Prisma 6, Next.js 16, Expo 55 and React 19; do not independently upgrade their major versions.

```sh
brew install node@22 postgresql@16
export PATH="$(brew --prefix node@22)/bin:$(brew --prefix postgresql@16)/bin:$PATH"
git clone --branch codex/v2-customer-experience https://github.com/amankeshri7542/cement-order-app.git
cd cement-order-app
# For an exact review, check out the commit SHA supplied in the review handoff.
npm ci
npm run local:setup
LOCAL_ADMIN_PORT=3002 npm run local:start
npm run local:status
```

`local:setup` creates missing secret-bearing `.env` files with owner-only permissions, uses an existing local PostgreSQL server or creates an isolated cluster in ignored `.local/postgres`, and prepares separate development and test databases. It generates Prisma, builds shared contracts, applies migrations, then adds idempotent practice fixtures. Existing `.env` files, products, balances and accounts are preserved. An existing `apps/api/.env.test` is used for test migrations; its `TEST_DATABASE_URL` must use the same local PostgreSQL server and credentials as development, with a different database name ending in `_test`. Setup stops before database work if these settings disagree. It does **not** run a destructive reset or enable online payments.

Apple Silicon and Intel Homebrew PostgreSQL paths are detected. For another installation set `PG_BIN=/absolute/path/to/postgresql/bin`. Default database binds only `127.0.0.1:55439`. Default databases: `shiv_cement` for development, `shiv_cement_test` for existing integration/browser tests. The OTP hash secret is generated randomly; the database password is an intentional fixed local-only fixture. Both are for local development, never staging.

| Service                 | URL                                 | Foreground command instead of `local:start`                                                        |
| ----------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| Customer browser app    | http://localhost:8081               | `npm run dev:web`                                                                                  |
| Owner desk              | http://localhost:3002 (configured)  | `npm exec -w @shiv/admin -- next dev --port 3002 --hostname 127.0.0.1`                             |
| Customer storefront     | http://localhost:3003               | `npm exec -w @shiv/storefront -- next dev --port 3003 --hostname 127.0.0.1`                          |
| API health              | http://localhost:4000/api/v1/health | `CORS_ORIGINS='http://localhost:3002,http://localhost:8081,http://localhost:3003' npm run dev:api` |
| OpenAPI                 | http://localhost:4000/api/docs      | API must be running                                                                                |
| Native Expo development | terminal QR/device instructions     | `npm run dev:mobile`                                                                               |

Use **localhost consistently** for browser apps; do not mix it with 127.0.0.1. The apps use HTTP-only cookies and exact allowed origins. Open the customer in a separate browser profile or incognito window from owners: cookies are shared across localhost ports. To use father and uncle simultaneously, use two browser profiles.

`local:start` leaves processes running with logs in `.local/{api,admin,customer,storefront}.log`. `npm run local:stop` checks the recorded start time, process group, project directory and command before signaling each managed group. It never kills an unrelated listener. A stale or unverified live record is retained for manual inspection. The database and development data are retained. `node scripts/local.mjs db-stop` stops the database cluster separately, when no tests or services need it.

The launcher defaults to API **4000**, owner **3000**, customer **8081**, storefront **3003**. This Mac has an unrelated AptoPro listener on IPv6 `localhost:3000`, so the command above explicitly chooses owner **3002**. Set any of these on the start command:

```sh
LOCAL_API_PORT=4000 LOCAL_ADMIN_PORT=3002 LOCAL_CUSTOMER_PORT=8081 LOCAL_STOREFRONT_PORT=3003 npm run local:start
npm run local:status
npm run local:stop
npm run local:start
```

Successful starts save the selected ports in ignored `.local/ports.env`, so subsequent status/start commands use the same selection. Environment variables override that saved selection. Stop running managed services before changing ports. API CORS origins and every frontend's API URL are derived from the selected ports at launch; existing secret-bearing `.env` files are preserved. These overrides apply to the launcher, not separate foreground commands.

Start probes **both IPv4 and IPv6** for all four ports and the customer's private Metro port (`LOCAL_CUSTOMER_PORT + 10`). It refuses conflicts before starting the database or app processes, rather than picking a different port silently. All services remain on loopback, including mock authentication. Test ports **4010 / 3001 / 8082 / 3004**, plus Metro **8092**, are reserved and rejected for development.

Status requires the expected application response **and** matching recorded process/listener ownership. An unrelated HTTP 200 is reported as unverified/wrong application. A service still compiling is not ready; check its log and rerun status. Status exits nonzero until all four applications are verified. Start/stop use `.local/launcher.lock` to prevent concurrent changes; after an interrupted launcher command, remove a leftover lock only after checking that no start/stop command is running. Do not run build and development commands against the same Next output directory simultaneously.

For records written by the old launcher, use `LOCAL_ADMIN_PORT=3002 npm run local:status` before the first restart; old records did not contain their actual port. The new launcher accepts their ownership only when the recorded start time, process group, exact known command and this checkout's working directory still match.

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

## V2 storefront review

Use [the storefront](http://localhost:3003) for the following steps. Open
[the owner desk](http://localhost:3002) in a separate browser profile; owner and
customer cookies share the API origin and must not overwrite each other. The
[Expo customer app](http://localhost:8081) is a second customer client, not the
new storefront. All these `localhost` links refer to this development computer.

1. **Browse as a guest.** Open Materials, search for a practice product, inspect its grade, selling unit, pack, minimum/step and current stock. Add a valid quantity to Basket, navigate away and reload. Compare two or three products; different selling units must remain explicit. Do not interpret illustrations as genuine shop/product photographs.
2. **Sign in and recover the basket.** Choose Sign in and use Ravi's local fixture OTP. The guest selection should merge once with any existing authenticated basket. Reload once more. If a merge result is uncertain, use its recovery action before editing; a rejected minimum/stock rule should explain how to correct or remove that line.
3. **Check shared cart state.** Enter a full multi-digit quantity in Basket and leave the field. Open the Expo customer app as the same customer in the same customer browser profile; refresh it to read the current cart. Change a quantity there, return focus to the storefront, and check reconciliation. Keep only one cart edit in flight while comparing the clients.
4. **Complete COD review.** Use Account/checkout to add or edit a practice address, then choose TEST Site, a future date and delivery notes. Select **Review current order**. Verify current material quantities/units, price, address, fee, delivery terms and total, then consent and place once. The ₹20,000 smoke-test total applies only while the original ₹390 product and ₹500 fee fixtures remain unchanged. Record the persisted order number and check one matching task in the owner desk. Online payment must remain unavailable.
5. **Exercise changed terms and recovery.** Before confirmation, have the owner change a practice price or delivery zone, or change the checkout address/date. Obtain a fresh review and renew consent. With a technical operator, simulate a lost response after a successful submission; reload and choose **Recover order result**. Match the same order number and a single inventory reservation. Do not create a new request while the outcome is unknown.
6. **Review history.** Open Orders, inspect the current status and delivery updates after owner actions. On a fresh eligible order, test cancellation; inspect its resulting state and stock through the owner desk. Use **Reorder at current prices**, review any changed minimum/step/availability warnings, and confirm the new basket before ordering.
7. **Request a bulk quotation.** Add at least two materials with **Add to quote**, open Bulk quotes, choose an address/date and enter optional company/GST/site details. Select **Request written quotation** and record the server reference. In the owner's Bulk quotes screen, acknowledge, price every line, set freight/date/expiry and confirm transport feasibility before sending. Refresh offers on the storefront, review all terms and accept. Revise the offer on the owner side and verify renewed customer acceptance is required; convert the accepted current revision and inspect the linked order. An estimate or accepted offer alone is not an order.
8. **Try Shiv Assistant.** Open its launcher, ask about a material in English, Hindi or Hinglish, and follow a product link. Use the product-page **Ask about this material** entry, ask a follow-up, cancel/retry and clear the conversation. Only explicitly selected shopping actions may alter the basket or quote. Default responses are approved FAQ/catalogue fallback; labelled provider simulations are not live AI proof. Ask for staff/attendance/private-customer information and verify that it is unavailable.
9. **Check voice and account boundaries.** Choose voice only deliberately. Confirm the transcript is editable before sending, then test stop/cancel, denied permission and closing the panel. Text chat must remain usable when speech recognition is unsupported. Sign out and use another fixture account; previous private cart/history/quote/assistant state must not appear. A technical operator can revoke a session in the owner desk and verify recovery without a redirect loop.
10. **Inspect the design and recovery.** Repeat homepage, listing/detail, populated basket, checkout, tracking, quotation and assistant at 360px and 390px widths, tablet and desktop, in both languages. Test enlarged text, 200% browser zoom, keyboard focus and reduced motion. Check that sticky basket, assistant and keyboard do not hide actions. Try offline/online recovery and note visible errors. Missing approved shop contact/history/gallery content must remain clearly pending; no invented awards, years or contact links should appear.

Keep a short record: browser/device, language, product and quantity, order/quote
reference, observed result and screenshot of any defect. Use new practice orders
for destructive or terminal transitions such as cancellation/return.

## परिवार के लिए छोटा हिंदी समीक्षा क्रम

1. इस कंप्यूटर पर `http://localhost:3003` खोलें और **हिन्दी** चुनें। सामग्री का नाम, भाव, इकाई, पैक, न्यूनतम मात्रा और स्टॉक पढ़कर बताएँ कि क्या स्पष्ट है और क्या नहीं।
2. मेहमान के रूप में सामग्री **टोकरी** में डालें, दूसरा पन्ना खोलें और वापस आएँ। रवि के अभ्यास खाते से साइन इन करें; मात्रा एक ही बार जुड़नी चाहिए। दो अंक की सही मात्रा लिखकर पन्ना दोबारा खोलें।
3. अभ्यास पता **TEST Site / 800099** चुनें। डिलीवरी तारीख, सामग्री का कुल, भाड़ा और अंतिम कुल जाँचें। शर्तें स्वीकार करके एक COD ऑर्डर करें और उसका नंबर लिखें। यह अभ्यास है; कोई असली भुगतान या डिलीवरी नहीं करनी है।
4. पिता/चाचा अलग ब्राउज़र प्रोफ़ाइल में `http://localhost:3002` खोलें। वही ऑर्डर एक बार दिखना चाहिए। स्वीकार करने और आगे की स्थिति बदलने पर ग्राहक के **ऑर्डर** पन्ने में सही स्थिति देखें।
5. दो सामग्री का **थोक भाव** माँगें। चाचा भाव, भाड़ा, तारीख और अवधि भरकर प्रस्ताव भेजें। ग्राहक पूरी शर्तें पढ़कर स्वीकार करे। नया प्रस्ताव आए तो दोबारा स्वीकृति लगे; दुकान के ऑर्डर में बदलने के बाद ही उसे पक्का ऑर्डर मानें।
6. **शिव सहायक** से पूछें: “सीमेंट के पैक की तुलना कैसे करूँ?” जवाब और सामग्री लिंक जाँचें। आवाज़ बटन चाहें तभी दबाएँ; लिखी हुई बात सुधारने के बाद ही भेजें। माइक न चले तो लिखकर सवाल पूछें।
7. छोटे और बड़े अक्षरों में देखें: कोई भाव, इकाई, बटन या हिंदी शब्द कट तो नहीं रहा? दुकान का सही पता, नंबर, समय, परिवार की जानकारी और असली तस्वीरें अलग सूची में स्वीकृत करें; अभी लंबित जानकारी को सही मानकर न चलें।

## Separate real-device access plan

Current services and mock OTP are loopback-only. A phone's `localhost` points to
the phone, not this Mac. Do not bind the mock API to `0.0.0.0`, use a public tunnel,
open router ports or disable the loopback guard to make phone testing work. The
Expo QR/native command does not make this mock-auth environment safe for LAN use.

Actual-phone acceptance requires a separately authorized staging setup: isolated
synthetic data, no development/production database sharing, real OTP for approved
test recipients, HTTPS with valid certificates, exact frontend/API origins and
verified cookie/CORS/CSRF policies. Keep owner access controlled, payments off,
staging excluded from indexing and secrets only on the backend. Provider setup,
SMS sends, hosting and the test recipient list remain pending approval; this
document does not start any of them.

Once that setup is approved and verified, supply its actual HTTPS URLs and test
COD/quote recovery on iPhone Safari and Android Chrome, native keyboard/zoom,
network loss, speech supported/denied/unsupported states and panel cleanup. Test
call, WhatsApp and map handoffs only after the family approves their settings;
opening an app is separate from sending a message. Record device/OS/browser and
results. Desktop emulation and simulated speech events cannot close these gates.

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
npm run test:local # isolated launcher port/identity/ownership/lifecycle checks
npm test -w @shiv/storefront # public data projection, exact money and query contracts
npm run test:bootstrap -w @shiv/api # migrations + staff setup, empty disposable PostgreSQL
npm run test:integration -w @shiv/api # existing real PostgreSQL API suite
npm run test:workflows -w @shiv/api # real PostgreSQL races and business workflows
npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome
TMPDIR=/private/tmp npm run test:e2e -- --config=playwright.qa.config.ts --project=webkit
npm run local:stop
npm run build -w @shiv/shared
npm run build -w @shiv/api
npm run build -w @shiv/admin
npm run build -w @shiv/mobile # Expo Android/iOS/web JS exports
NEXT_DIST_DIR=.next-e2e npm run build -w @shiv/storefront # after browser suites finish
node scripts/check-production-headers.mjs --self-test
node scripts/check-production-headers.mjs # owns temporary production builds/TLS ports
npm run local:start
```

Browser tests use installed Chrome and ports **4010 / 3001 / 8082 / 3004** (API / owner / customer / storefront), independent of manual dev servers. `npx playwright install chrome` installs it if missing. For WebKit, install the engine with `npx playwright install webkit`. Run exactly one project per invocation: global setup resets the shared disposable database. Firefox is currently blocked at native browser launch; see [the QA report](BROWSER_QA_REPORT.md). The rate-extraction test adapter is confined to `apps/api/scripts/e2e-api.ts` and requires NODE_ENV=test plus a database ending `_test`. Provider simulations do not establish live Razorpay, Twilio or OpenAI integration. The standard development assistant uses the approved FAQ/catalogue fallback unless explicitly configured otherwise; assistant simulation is rejected in production.

For focused V2 review, run `tests/storefront.spec.ts` and
`tests/storefront-commerce.spec.ts` through the same QA config, one engine at a
time, with `--trace=on`. Set `UPDATE_REVIEW_EVIDENCE=1 REVIEW_VIDEO=1` to retain the
commerce review captures. Keep application source stable while a suite runs.
Run the original native WebKit navigation diagnostic separately, retain its
trace/error even if it fails, and report it separately from journey results:

```sh
RUN_STOREFRONT_WEBKIT_DIAGNOSTIC=1 npm run test:e2e -- --config=playwright.qa.config.ts --project=webkit tests/storefront-webkit-diagnostic.spec.ts --trace=on
```

The production checker uses reserved ports **43120–43125**, temporary local TLS
and simulated unavailable/signed-out API responses. It checks application
identity, enforced CSP, applicable nonce presence/rotation, DOM nonce matching,
no-store and microphone policy in Chrome/WebKit. It enforces the existing
**450 KiB gzip** initial storefront script budget and records incremental lazy
assistant JavaScript after an explicit click separately. Evidence is written to
`.local/security-hardening` by default; `HEADER_EVIDENCE_DIR` selects another
review directory. These unthrottled local results do not establish phone/network
performance or live-provider acceptance. Run it after other build/browser work,
not concurrently with files or output directories it owns.

## Reset and recovery

- **Safe fixture rerun:** `npm run local:setup` does not replenish used stock, reset prices or rotate passwords. Record a Purchase in through the owner stock ledger to restore practice stock with evidence, or create a new clearly labelled test product. Run `npm run local:fixtures -w @shiv/api` to add missing fixture records only. Disposable test suites reset their own databases automatically. Never use `prisma migrate reset` on the development database to “fix” a migration.
- **Occupied port:** run `npm run local:status` and `lsof -nP -iTCP:3000 -iTCP:3002 -iTCP:3003 -iTCP:4000 -iTCP:8081 -iTCP:8091 -sTCP:LISTEN`. Preserve unrelated services and choose an explicit `LOCAL_*_PORT`. Use `local:stop` only for this launcher’s managed processes. An IPv6-only listener is a conflict even when IPv4 is free.
- **Database unavailable:** `npm run local:start` starts the cluster; inspect `.local/postgres.log`. Ensure port 55439 matches DATABASE_URL. Do not remove a postmaster.pid until you have confirmed its process is absent. Database tools can require macOS permissions outside a restricted agent sandbox.
- **Migration error:** stop app servers, back up first, inspect `npm exec -w @shiv/api -- prisma migrate status` so Prisma loads `apps/api/.env`. Fix permissions/connectivity; this app uses `pg_trgm`. Re-run `npm run db:migrate`. Do not mark a failed migration applied without reviewing its actual SQL/state.
- **Login problem:** confirm mock OTP and CORS values in `apps/api/.env`, use localhost consistently, request a new OTP after five failed/expired attempts. Check browser profile: customer and owner cookies must be separate. Re-grant a local staff credential deliberately if it was changed; this revokes sessions.
- **Missing dependencies/client:** `npm ci`, then `npm run db:generate` and `npm run build -w @shiv/shared`.
- **Stale Next/Metro output:** stop app servers, retry the build/start; keep e2e `.next-e2e` separate from manual `.next`. Inspect the service log instead of repeatedly submitting an uncertain order.

For family review and cloud prerequisites see [FAMILY_REVIEW.md](FAMILY_REVIEW.md). The finding matrix and exact verification limits are in [LOCAL_PROGRESS.md](LOCAL_PROGRESS.md).

## Security hardening follow-up

See [SECURITY_HARDENING_REPORT.md](SECURITY_HARDENING_REPORT.md) for baseline evidence and staging gates. Run `npm exec -w @shiv/api -- tsx scripts/restore-rehearsal.ts` only after a synthetic test suite, sequentially with other database tests; it creates/removes its own restore database and role. `node scripts/security-scan.mjs` is a limited working-tree credential-pattern check. Current V2 pass/fail results must be tied to the final source revision; older reports do not certify the new customer screens.

The local customer web command puts security headers around Expo HTML. Browser port 8081 uses a private loopback Expo listener on 8091; the browser harness uses 8082/8092. Keep those pairs free. Production exports use `node scripts/serve-customer.mjs` behind a verified HTTPS proxy and need the same build/serve API origin. Use `expo export --clear` when changing API build variables to avoid cached bundles with old origins. Mock API authentication is loopback-only; real phone/staging access follows the separate plan above.

Finance & settings → Booking limits shows demand warnings and audited one-request exceptions. Defaults are proposals requiring family agreement before staging; they do not cancel orders or release stock. Keep online payments off.
