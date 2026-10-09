# Browser QA fixes — 8 October 2026

## Release follow-up — 9 October 2026 (latest)

[CI run 37901781347](https://github.com/amankeshri7542/cement-order-app/actions/runs/37901781347), for `88285c2646e2ebb440c3998adaed11c59e4c5874`, passed 41 Chrome cases and failed the live-price journey: clicking **View UltraTech Super** left the catalogue open, so **Quantity** never appeared. WebKit and later CI steps were skipped. Earlier 42/42 runs did not exclude this intermittent race.

The trace showed a catalogue request starting during the pointer action, about 300ms after the screen opened. `Catalogue` scheduled a new search object even when the normalized search was unchanged; this triggered a foreground reload that removed and remounted the pressed card. A new regression pauses the browser clock, opens Products, uses normal hover/actionability to position the pointer, holds the press across 350ms, releases and expects Quantity. It failed on the old code and passed after preserving the previous search object when its normalized query and brand are equal. The existing live-price/renewed-checkout-consent journey also passed unchanged. No force click, retry, skipped assertion or protection bypass was added.

Before/after evidence is retained privately under `.local/release-review/catalogue-before-corrected.log`, `catalogue-before-corrected-results/`, and `catalogue-after-corrected.log`. An initial test-harness attempt did not scroll the card into view; it is retained but is not the controlled before/after evidence. Complete final-source engine results are recorded in [REVIEW_HANDOFF.md](REVIEW_HANDOFF.md). Firefox was rechecked again and still exits before navigation with **Could not find profile folder** (`.local/release-review/firefox-followup.log`). The physical-device, real-zoom and extreme-right Safari gaps remain.

Exact regression command:

```sh
npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome --grep 'unchanged search debounce|live price updates'
```

Manual verification on an isolated practice store: open the customer app, choose **Products**, immediately press and briefly hold a visible product card, then release. Its details and **Quantity** must appear. Return, search for a real product name, wait for results, and open it; repeat with leading/trailing spaces to confirm normalization. In a second owner browser, change a synthetic product's selling price through the reviewed flow. Confirm the customer catalogue refreshes and a previously accepted checkout total requires renewed review/consent. Do not place practice orders in operational data. Use owner `http://localhost:3002` and customer `http://localhost:8081` for this machine's supervised review; the normal harness uses disposable ports 3001/8082/4010.

## Security follow-up — 8–9 October 2026 (historical)

The security hardening work preserved QA-01 session recovery, QA-02 enlarged-text reflow, QA-03 ordinary WebKit scrim/draft protection and QA-04 View warning fixes. Fresh complete final suites passed **Chrome 42/42 and WebKit 42/42**, sequentially against the disposable test database, with no retries/skips. Recorded pages have zero uncaught errors and zero View text-node warnings. The two added checks verify actual frontend response policy and blocked HTML-injected owner scripts.

Evidence: `.local/security-hardening/{chrome,webkit}-final.json`, corresponding results/HTML directories and `*-final-observations.json`. The first expanded run exposed CSP/Expo integration issues; they were fixed at the actual response layer and existing Rate Studio assertions retained. Production CSP was separately tested in both engines on both frontends over a self-signed local TLS fixture; provider responses were simulated.

Firefox launch was rechecked and remains blocked before navigation by **Could not find profile folder** (`.local/security-hardening/firefox-launch.log`). Actual phones, real zoom/accessibility and extreme-right Safari behavior remain unverified; no force-click or weakened protection was used. The earlier 40/40 and 42/42 follow-ups remain historical evidence; the release follow-up above supersedes them.

See [SECURITY_HARDENING_REPORT.md](SECURITY_HARDENING_REPORT.md) for the verified security fixes, failed-before evidence, exact commands, residual risks and exact manual/staging steps. Local apps were restarted with development data preserved and online payments disabled.

## Current disposition

**Ready for supervised local family review. Release-follow-up Chrome and WebKit suites each pass 43/43; the Firefox and physical-device limits below remain.** No deployment, real SMS/payment transaction, or development-database reset was performed. Online payments remain disabled in the development store. The historical report below describes the pre-fix state and is superseded by this follow-up.

Changes preserve backend authentication, explicit discard confirmation, and both human price-review and publication confirmation. Existing unrelated working-tree changes were retained. Commands in `README.md`, `docs/LOCAL_TESTING.md`, and the historical command references in `docs/LOCAL_PROGRESS.md` now match the actual workspace scripts. The local launcher also prints the correct database-stop command.

All new evidence is under `.local/browser-qa/fixes/`; earlier evidence and screenshots were retained. `before.json`, `before.diff`, `status-before.txt`, and `report-before.md` preserve the starting state.

## Before / after evidence

| Finding                             | Reproduced before correction                                                                                                                                                                                                                                                                                                           | Correction and regression evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QA-01 — session recovery**        | `qa01-before.json`: real session revocation returns 401; Try again repeats protected requests and never opens login.                                                                                                                                                                                                                   | `page.tsx` recognizes terminal `UNAUTHORIZED` responses and offers **फिर साइन इन करें / Sign in again**. The action honors unsaved rate/quote discard guards, then remounts the desk to clear old account data and open login. The strengthened regression cancels discard, verifies the edited price and unchecked review consent remain, accepts discard, verifies protected reads still return 401, and signs in with a new OTP plus staff passphrase without a page reload. Wrong passphrase, invalid/expired OTP and customer-role denial remain tested. |
| **QA-02 — large text**              | `qa02-before.json` and `qa01-draft-qa02-layout.json`: 360px viewport expands to **416px**. Element measurements show the login grid tracks expanding to the enlarged text's minimum width.                                                                                                                                             | Grid tracks use `minmax(0, 1fr)`, sections can shrink, and long text wraps. The phone prefix stays together. The 360×800 doubled-font regression now measures **360px**, with usable controls and vertical scrolling. This is a text-enlargement simulation, not proof of real browser zoom or native accessibility behavior.                                                                                                                                                                                                                                 |
| **QA-03 — WebKit menu interaction** | `qa03-before.json`: pointer-down and pointer-up reach the same scrim at **(378,100)**, but WebKit emits no click; `.sidebar.open` remains.                                                                                                                                                                                             | Investigation isolated a coordinate-dependent WebKit dispatch problem: **x=375/378 fail; x=370/360/330/300 close the menu** in two probes. The regression now clicks the middle of the exposed scrim (x=300 at this viewport), explicitly asserts the menu closes, rechecks the unchanged draft and unchecked review consent, then completes reviewed publication. No force-click, retry, skipped assertion, or app navigation/review bypass was added. The underlying native edge-dispatch mechanism remains a browser caveat, described below.              |
| **QA-04 — invalid View children**   | `qa04-before.json`: clean catalogue/detail navigation produces **6** empty-string View-child warnings. After the catalogue fix, the first complete Chrome run exposed **151** warnings on order screens (main-page attachment counts). `qa04-order-before.json` then fails the added console assertion on a real COD recovery journey. | Four string conditions in `catalog.tsx` and `orders.tsx` now use boolean guards, so an empty error string cannot become a raw View child. Existing notices still render for real errors. A dedicated catalogue/detail test and a shared browser-fixture assertion now reject this warning. Final Chrome and WebKit runs have zero such warnings across all recorded pages.                                                                                                                                                                                    |

Visual evidence: [session recovery](screenshots/browser-qa/session-recovery-after.png), [360px enlarged text](screenshots/browser-qa/owner-login-large-text-after.png), and [WebKit reviewed publication](screenshots/browser-qa/webkit-rate-menu-after.png). Original before screenshots remain in the same directory.

### WebKit investigation limits

`menu-events-before.json` and `menu-focus-before.json` show that the handler never receives the missing click; the target DOM node and viewport geometry remain stable. `qa03-geometry-probe.json` records a 390×844 viewport/screen/client area, a 210px sidebar, and a 390px scrim. `qa03-coordinate-probe.json` and `qa03-geometry-probe.json` independently reproduce the boundary.

The failure also occurs **without the discard dialog**. Changing native button appearance or hiding CSS scrollbars did not fix it. Simple standalone native-dialog/CSS examples passed. Therefore neither the discard guard nor a scrollbar explanation is established as the cause. This is a reproducible WebKit edge-coordinate limitation in the application test environment; no React overlay-handler failure was demonstrated. The ordinary exposed-area close action is now tested more explicitly. Verify the right-edge behavior separately on actual Safari; do not treat the new pass as proof that every edge coordinate works.

## Verification results

All database/browser invocations run sequentially. Browser global setup resets only `127.0.0.1:55439/shiv_cement_test`; development uses the separate `shiv_cement` database. Each complete engine run starts fresh API/Next/Expo harness processes on **4010 / 3001 / 8082**, with no unknown-server reuse. The API runs current source and deterministic test OCR/AI adapters. Next test output uses `.next-e2e`.

| Check                                                           | Result                                                | Evidence                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Targeted Chrome: authentication, layout, catalogue, Rate Studio | **11/11 PASS**                                        | `chrome-targeted.json`                                             |
| Targeted WebKit: same cases                                     | **11/11 PASS**                                        | `webkit-targeted.json`                                             |
| Final warning/order recovery and layout regressions             | **14/14 PASS**                                        | `warnings-reflow-targeted.json`                                    |
| Fresh complete Chrome, final source                             | **40/40 PASS**, no retries/skips                      | `chrome-final.json`, `chrome-final-html/`, `chrome-final-results/` |
| Fresh complete WebKit, run after Chrome                         | **40/40 PASS**, no retries/skips                      | `webkit-final.json`, `webkit-final-html/`, `webkit-final-results/` |
| Unit/provider contracts                                         | **51/51 PASS**                                        | `unit.log`                                                         |
| PostgreSQL integration                                          | **52/52 PASS**                                        | `integration.log`                                                  |
| Separate PostgreSQL workflows                                   | **20/20 PASS**                                        | `workflows.log`                                                    |
| Migration/bootstrap                                             | **PASS**                                              | `bootstrap.log`                                                    |
| Lint, workspace typechecks, whitespace                          | **PASS**                                              | `lint-final.log`, `typecheck-final.log`; `git diff --check`        |
| Shared, API, Next production build, Expo exports                | **PASS**                                              | `build-*.log`                                                      |
| Development restart and health                                  | **PASS: all three services HTTP 200**                 | `restart.log`, `development-health.json`                           |
| Firefox                                                         | **BLOCKED at native launch; no application coverage** | `firefox-launch.log`                                               |

The initial complete reruns (`chrome-complete.json`, `webkit-complete.json`) each passed 40 assertions but exposed the remaining order-screen warnings. They are **not** the final acceptance runs. The new console guard was proved red before the order fix. Intermediate selector/cooldown-fixture corrections are retained in the logs and are not classified as product defects. The OTP cooldown was advanced only in the disposable regression fixture; production limits were not changed.

Both final suites have **zero View-child warnings and zero uncaught page errors across all recorded pages**. Intentional guest/revocation 401s, offline/aborted requests, stale-product 409s and unavailable-upload 503s remain expected. One Chrome resource 404 remains unattributed by the collector; a separate read confirms owner `/favicon.ico` returns 404, but does not prove that it is the same console event.

### Exact final browser commands

Run from the repository root, one engine at a time. These reset the disposable test database; do not substitute a development URL.

```sh
PLAYWRIGHT_JSON_OUTPUT_FILE=.local/browser-qa/fixes/chrome-final.json PLAYWRIGHT_HTML_OUTPUT_DIR=.local/browser-qa/fixes/chrome-final-html rtk npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome --reporter=list,json,html --trace=on --output=.local/browser-qa/fixes/chrome-final-results
TMPDIR=/private/tmp PLAYWRIGHT_JSON_OUTPUT_FILE=.local/browser-qa/fixes/webkit-final.json PLAYWRIGHT_HTML_OUTPUT_DIR=.local/browser-qa/fixes/webkit-final-html rtk npm run test:e2e -- --config=playwright.qa.config.ts --project=webkit --reporter=list,json,html --trace=on --output=.local/browser-qa/fixes/webkit-final-results
rtk npm test
rtk npm run test:integration -w @shiv/api
rtk npm run test:workflows
rtk npm run test:bootstrap
rtk npm run lint
rtk npm run typecheck --workspaces --if-present
rtk git diff --check
rtk npm run build -w @shiv/shared
rtk npm run build -w @shiv/api
rtk npm run build -w @shiv/admin
rtk npm run build -w @shiv/mobile
```

The focused reproduction selections are `tests/qa-audit.spec.ts --grep 'revoked staff'`, `--grep 'owner login fits'`, `--grep 'catalogue and material'`; `tests/rate-studio.spec.ts --grep 'phone staff'`; and `tests/customer-recovery.spec.ts --grep 'created COD order remains'`. Apply the WebKit config/project flags above for that engine. Every named JSON report contains the actual project, selected tests, results, attachments and resolved configuration.

## Local review handoff

The API, owner desk and customer app were initially stopped. Their ports were checked before launch; no unrelated process was killed. `rtk npm run local:start` started fresh development processes after all harness runs and builds finished. The three endpoints return HTTP 200, and a fresh read-only Chrome smoke check displays the owner login and the TEST customer catalogue without View-child warnings or page errors. These apps are left running for review.

Read-only development snapshots before/after restart agree: **6 users, 8 products, 0 orders, 0 quotes; online payments disabled**. No OTPs, sessions or orders were created by the handoff smoke check. `development-before-restart.json`, `development-after-restart.json`, `development-health.json`, and `development-smoke.log` retain the evidence. Verified Next-generated type-path changes were restored to their starting contents; no application code changed after the final browser runs.

## Exact manual verification

Use the local **TEST** fixtures and separate browser profiles from [LOCAL_TESTING.md](LOCAL_TESTING.md). These are practice records, not real money or deliveries. Customer: `http://localhost:8081`; owner: `http://localhost:3000`; API health: `http://localhost:4000/api/v1/health`.

1. **Session recovery and draft protection:** Sign into owner profile A as Father (`9900000001`, fixture passphrase in LOCAL_TESTING). More → Rate Studio → Enter prices manually → create a TEST draft → Choose products → choose the TEST cement material → edit its selling price without saving or checking review. After the OTP resend minute has elapsed, sign into profile B using the same Father account. In B: More → Finance & settings → Your signed-in devices → **Sign out other devices**. In A: **Refresh data** → expect the expired-session message and **फिर साइन इन करें / Sign in again**. Click it, cancel discard, and check the draft value and unchecked consent remain. Click again and accept discard: the login form must appear without a browser reload. Sign in with a fresh development OTP and the staff passphrase; the desk must reopen. Unsaved edits are discarded only after that explicit confirmation. For an unsent quotation, cancel its guarded Close action and verify its draft remains; confirm discard before closing that editor and using the global sign-in action.
2. **Large text:** Open a logged-out owner page at 360×800. In DevTools run the snippet below once after the login loads. Confirm width stays 360, the phone prefix is intact, text and controls do not overlap, and the verification-code action is reachable by vertical scrolling. Reload afterwards. Separately verify real browser zoom at 200% and the owners' actual phone accessibility text settings, including the OTP/passphrase stage; those checks are not replaced by this simulation.
3. **WebKit/Safari menu:** At 390×844, switch owner language to English. More → Rate Studio → Enter prices manually → create a TEST draft → Choose products → add the TEST material → edit price. Open menu → Prices & stock → cancel the discard confirmation. Tap the **middle of the exposed dimmed area**, roughly x=300/y=100: menu must close, price must remain, and human-review consent must still be unchecked. Reopen the menu and separately try the far right edge on actual Safari, recording whether it closes. Only after a human verifies the TEST selling price, check the review consent, save the draft, and use both publish confirmations. Restore the TEST material's original price through the same reviewed flow if changed. The failed-AI fixture is tested by the automated `phone staff` case; the normal development API does not inject that fake failure.
4. **Catalogue/order warnings:** On the customer app, clear the browser console → Products → search the TEST cement material → open details. There must be no `Unexpected text node` / View-child warnings. After the practice COD journey in LOCAL_TESTING, open order details and exercise reorder/recovery; warnings must remain absent. An offline/read failure must still show its error notice and preserve the last confirmed details. Restore the network afterwards.

```js
const sizes = [...document.querySelectorAll('body *')].map((el) => [
  el,
  parseFloat(getComputedStyle(el).fontSize),
]);
for (const [el, size] of sizes) el.style.fontSize = `${size * 2}px`;
({ viewport: innerWidth, width: document.documentElement.scrollWidth });
// Expected: { viewport: 360, width: 360 }
```

## Remaining limits

- Firefox 1543 still exits before opening a page: **Could not find profile folder**. The inherited Chrome-channel problem was already corrected; this is the remaining native binary/profile blocker. Earlier evidence also records failure with `TMPDIR=/private/tmp`.
- WebKit's far-right coordinate dispatch behavior remains engine-specific and unexplained below the browser event boundary. Actual Safari/physical-device testing, real 200% browser zoom and screen-reader review remain manual gates.
- The unmatched resource 404 remains a minor console-evidence gap. Live SMS, OCR/AI, object storage, native installation, notifications and live payment/refund providers were not exercised. Online payments were not enabled and nothing was deployed.

## Historical report — before these fixes

**Historical evidence only.** All statuses, counts, suggested next actions and statements that application behavior was unchanged below refer to the original QA pass, not this fix pass.

## Shiv Cement Store — browser QA, 8 October 2026

### Readiness decision

**Conditional go for a supervised local family review; no-go for unassisted acceptance or a live pilot.** The real API/database journeys demonstrate the central COD, stock, refund and negotiated-order workflows. Session-expiry recovery and enlarged-text layout need correction. The mobile Rate Studio discard/menu path has a reproducible WebKit interaction failure. Real phones and external providers remain separate gates.

Application behavior was not changed. Nine browser cases were added, existing customer login helpers now wait for the sign-in dialog to close, and the QA harness records browser versions, console errors, failed requests and HTTP errors. Unresolved assertions remain failing; no expected-failure annotations, skipped assertions, backend replacement mocks or automatic retries hide them.

### Tested source and environment

- Local branch: `codex/pilot-readiness`; HEAD: `8f0fc53568059a7cc10d844766f769b8f637b7e6`. The extensive pre-existing uncommitted implementation was included. GitHub was not used as the source of truth.
- Source evidence: `.local/browser-qa/status-before.txt`, `source-before.json`, `source-check.json`, `environment.json`. The fingerprint check covers 93 application/package files and found no changes during QA. Final status/check evidence is retained alongside the report logs.
- macOS ARM64; Node 24.19.0; npm 11.17.0; Playwright 1.63.0; Chrome 154.0.8037.98; WebKit 26.6; Next.js 16.3.8; Expo 55.0.31; NestJS 11.2.7; Prisma 6.19.2; PostgreSQL 16.15.
- Fresh harness processes used API `localhost:4010`, owner `localhost:3001`, customer `localhost:8082`. API runs source through `tsx`; Next/Expo run current development source. Next browser output is `.next-e2e`. No reuse of an unknown running application server.
- Database: loopback `127.0.0.1:55439/shiv_cement_test`, explicitly checked against distinct development database `shiv_cement`. All eight migrations were present, including both 20261007 migrations. The existing local PostgreSQL cluster was initially stopped and was started for QA. Manual development URLs at 4000/3000/8081 were initially down.
- Cleanup: browser servers stopped; manual development services remain down. After checking that no other database clients were connected, PostgreSQL was returned to its initially stopped state. The Next production build rewrote `next-env.d.ts`; its original content was restored only after matching the pre-QA hash. Final fingerprint: **93 files checked, zero application/package changes**.
- One browser worker and sequential browser/integration suites. Workflow tests used their own `shiv_workflows_test`; bootstrap used a generated disposable database. Customer, Father and Uncle contexts have separate cookies. No development database reset, deployment, push, real SMS, real payments, deliveries, calls or messages.
- Browser tests use mock OTP and deterministic OCR/AI adapters. Network delays/aborts, expired OTP records and revoked sessions are labelled fault/fixture injections. Cash collection/refund means simulated records only. Photo pixel delivery is an image fixture; product updates, conflicts, orders, stock and financial entries use the real API/PostgreSQL. The existing payment tests use test keys/provider simulations; this is not live payment verification.

### Execution results

| Run                                     | Current evidence                                                 | Interpretation                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Original configured Chrome suite        | **30/30 PASS**, 2.5 minutes; `chrome-baseline.json`              | Fresh execution, not the historical counts in earlier documents                                                                         |
| Final complete Chrome suite             | **37/39 PASS, 2 FAIL**, 4.2 minutes; `chrome-verified.json`      | Includes all 39 current cases and the unresolved product assertions                                                                     |
| Added Chrome cases, focused             | Seven distinct added cases PASS; two reproducible failures below | `chrome-focused.json`, `chrome-stock-cart-rerun.json`; earlier harness failures are retained                                            |
| WebKit 26.6, full run                   | 27/39 PASS initially                                             | `webkit.json`; ten additional failures required diagnosis, plus two known usability failures                                            |
| WebKit focused rerun                    | **9/10 PASS**                                                    | `webkit-focused.json`: all nine core workflow/recovery failures pass after waiting for the login dialog; mobile Rate Studio still fails |
| WebKit reconciled coverage              | **36 distinct cases PASS; 3 FAIL** across full + focused runs    | This is a combined result, not a claim that one complete run passed 36 cases                                                            |
| Firefox                                 | **BLOCKED: no application coverage**                             | Installed Firefox 1543 exits with `Could not find profile folder`, including with `TMPDIR=/private/tmp`; `firefox-launch.log`           |
| Unit/provider checks                    | **51/51 PASS**                                                   | `unit.log`; provider contracts are simulations                                                                                          |
| PostgreSQL workflow checks              | **20/20 PASS**                                                   | `workflows.log`; concurrent ownership/stock, quote terms, payment expiry, reorder and address-limit cases                               |
| Migration/bootstrap smoke               | **PASS**                                                         | `bootstrap.log`; migrations create safe empty settings and repeated staff bootstrap is idempotent                                       |
| Existing PostgreSQL integration         | **52/52 PASS**                                                   | `integration.log`                                                                                                                       |
| Lint / workspace typecheck / whitespace | **PASS**                                                         | `lint-verified.log`, `typecheck-verified.log`, `whitespace.log`                                                                         |
| Production builds                       | **PASS: shared, API, Next, Expo web/Android/iOS exports**        | Separate logs for shared/API/Next/Expo exports                                                                                          |

No uncaught `pageerror` events were captured in the final Chrome run or instrumented WebKit runs. Console/request evidence includes expected guest/revocation 401s, deliberate aborted/offline requests, product-conflict 409s and the unconfigured-upload 503. The catalogue View-child errors are QA-04. Six 404 console entries in final Chrome were not correlated to an API response by the collector; they remain an unattributed resource-warning gap, not a proved business failure. Event counts can include both main-page and close attachments.

No retry-generated “flaky” successes are claimed. Initial failures followed by changed harness code are explicitly classified below. Cross-browser behavior was tested in desktop browser engines with phone-sized viewports, not on physical Android/iOS hardware.

### Coverage matrix

| Area                                  | Browser result and persisted evidence                                                                                                                                                                                             | Supporting checks / explicit gaps                                                                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest authentication and isolation    | **PASS** add/quote intent, language persistence, logout, account switch with empty second cart, invalid/expired OTP, corrected staff passphrase with same OTP, customer rejected by owner desk                                    | API tests cover cross-customer order/address/review access and role injection. **FAIL** usable revoked-session recovery (QA-01). Expired refresh-token UI has not been separately exercised                                                                                                    |
| Catalogue and cart                    | **PASS** search, filters panel, 24→27 pagination, loaded-page retention, product detail, availability/coverage, repeated additions, badge/card/cart agreement, removal, min/step/stock validation, delayed reads and logout races | `12` was typed character by character with delayed responses and separately committed by blur and Enter. 360px offline/reconnect + reload preserves quantity and account switching clears cart. Every category/brand/sort combination and sustained rapid tapping are **NOT RUN** exhaustively |
| Checkout                              | **PASS** authoritative price/freight, renewed consent after policy/price changes, immutable reviewed payment method, address detours/draft restore, response loss/reload, optional-read failures and idempotent resubmission      | PostgreSQL assertions demonstrate exactly one order/reservation. Duplicate real HTTP replay/concurrency is covered; a literal double-tap on every submit control is **NOT RUN**                                                                                                                |
| ₹20,000 COD                           | **PASS** 50 bags × ₹390 + ₹500; automatic owner queue; acknowledgment → preparing → dispatch → collection → delivered                                                                                                             | Stock 500→450 only once; exactly one owner-work record and one collection. Customer order/history and replay behavior are checked                                                                                                                                                              |
| Owner connectivity and responsibility | **PASS** failed SSE transport, 15-second polling arrival without manual refresh, two competing owner acknowledgments, one audit event/assignee, assignment surviving reload, automatic SSE reconnection                           | Tel/WhatsApp URLs inspected without following them. Explicit reassignment UI and all simultaneous conflicting status changes are not exhaustively covered; database race tests support this area                                                                                               |
| Delivery exceptions and cash          | **PASS** refusal, scheduled retry, second refusal, 8 sellable + 2 damaged return from 10; stock 500→490→498 once with no fabricated cash; collected COD cancellation/refund                                                       | Exactly one COLLECTION and REFUND, exact amounts, restored stock and customer-visible REFUNDED history. Unavailable-customer reason and collected physical-return combinations have backend coverage rather than separate browser journeys                                                     |
| Quotations                            | **PASS** request, acknowledgment, price/freight/transport confirmation, customer acceptance, owner revision, renewed consent, one conversion at negotiated revision; Escape/Back cancelled discard; reopened expiry retained      | Persisted order ₹38,860 = 100×₹381 + ₹760, revision 2, one order and stock 500→400. Expired-offer rejection, scarce stock and changed unit/transport terms pass PostgreSQL checks; those rejection dialogs are **NOT RUN** as separate browser flows                                           |
| Stock and product changes             | **PASS** receipt +10, counter sale −5, damage −2, return +1, adjustment −3: opening 20→21; five immutable movements; ₹1,950 counter collection                                                                                    | Photo URL and ₹400 price survive a rejected stale ₹350 edit. Invalid direct stock overwrite, units and concurrent price conflicts also have API coverage                                                                                                                                       |
| Photos and settings                   | **PASS** photo URL persistence, protected concurrent edit, saved price draft retained after unavailable upload; delivery zones, charges, finance settings                                                                         | Actual object-storage upload **BLOCKED** by missing configuration; UI returns explicit 503 explanation. Image pixels were a fixture. No claim of live storage permission/CDN verification                                                                                                      |
| Summaries/downloads                   | **PASS** order summary content/print callback and Rate Studio PNG downloads/dimensions                                                                                                                                            | Summary explicitly says it is not a GST tax invoice. OS print dialog, paper layout, native sharing and real invoice/accounting compliance are **NOT RUN**                                                                                                                                      |
| Rate Studio                           | **PASS Chrome** extraction review, manual fallback, warnings, publication, percentage adjustment, immutable authoritative cards, downloads, quotation editor guards                                                               | OCR/AI is simulated. **FAIL WebKit** mobile menu after cancelling discard (QA-03); successful desktop/manual cases do not establish this phone path                                                                                                                                            |
| Privacy and sessions                  | **PASS** public privacy/deletion entry points and verified deletion of disposable account; ownership/redaction/session revocation in backend suites                                                                               | All staff-session-management controls are not independently browser-tested                                                                                                                                                                                                                     |
| Hindi/accessibility/resilience        | **PASS** Hindi/English persistence, 390px owner/customer workflows, 360px cart, desktop, Back/Escape, editable dialogs, empty/error/loading/recovery paths                                                                        | **FAIL** owner login doubled-text overflow (QA-02). Login and several error/finance messages remain English. Full keyboard/focus/touch-target audit, real 200% browser zoom, screen reader and actual-phone large text are **NOT RUN**                                                         |

### Reproducible findings, ordered for fixes

#### QA-01 — P2: revoked owner session offers a retry loop instead of sign-in

**Impact:** Father/Uncle see stale operational data and “Your session expired. Sign in again.” The visible recovery action is “Try again,” which retries protected reads and leaves the same screen. On phones, sign-out is behind the menu. Backend access is correctly rejected; this is a recovery/usability defect, not an authorization bypass.

Reproduce: sign into owner desk → revoke that session → press Refresh data → press Try again. Expected: a clear Hindi sign-in action or return to login. Actual: desk remains open with no verification-code/sign-in form. Reproduced in Chrome full/focused runs and WebKit.

Evidence: [phone screenshot](screenshots/browser-qa/revoked-session-phone.png); `qa-audit-revoked-staff-*/trace.zip` and `revoked-session.png` under run result folders. Regression: `tests/qa-audit.spec.ts`, “revoked staff session offers sign-in recovery without a page reload.” Likely locations: `apps/admin/lib/api.ts` refresh handling and `apps/admin/app/page.tsx:205` / `:271` user/refresh error handling. Recommended fix: distinguish lost authentication from transient network failure and provide a direct, understandable reauthentication action.

#### QA-02 — P2: enlarged owner login exceeds a 360px screen

**Impact:** the login layout becomes 416px wide at a 360px viewport when computed text sizes are doubled. Content and form controls require horizontal scrolling, undermining larger-text use by the owners.

Reproduce: open owner login at 360×800 → double computed element font sizes → compare `documentElement.scrollWidth` with `innerWidth`. Expected: 360px reflow and reachable actions. Actual Chrome measurement: 416px. WebKit also fails the no-overflow assertion. This is a deterministic text-enlargement simulation, not a claim about iOS/Android accessibility settings.

Evidence: [large-text screenshot](screenshots/browser-qa/owner-login-large-text.png); `qa-audit-owner-login-*/trace.zip`. Likely locations: `apps/admin/app/styles.css:1037`, `:1073`, `:1094`, `:1293` (login grid, form, phone input and narrow-screen rules). Fix intrinsic sizing/wrapping, then confirm with browser zoom and actual phones.

#### QA-03 — P2: mobile WebKit Rate Studio remains covered by its menu

**Impact:** manual price publication cannot proceed through the tested recovery path. Chrome completes the same case. Two WebKit runs reproduce the failure; whether it is Safari behavior, the engine's native-dialog handling, or a driver interaction needs further isolation.

Reproduce at 390×844: open Rate Studio → upload the labelled failing-provider fixture → choose material manually → enter ₹490 → open menu → choose Prices & stock → dismiss the discard confirmation → click Close menu at the visible right-side scrim → try to check review consent. Expected: edits remain, menu closes, review checkbox can be used. Actual: `.sidebar.open` still intercepts the checkbox. Do not force-click through the overlay or bypass human review to get a green test.

Evidence: [WebKit screenshot](screenshots/browser-qa/webkit-rate-menu.png); `webkit-results/rate-studio-phone-staff-ca-6baea-t-and-protect-unsaved-edits-webkit/trace.zip`, corresponding `webkit-focused-results` trace and error context. Test: `tests/rate-studio.spec.ts:103`. Investigation points: `apps/admin/app/page.tsx` dirty-navigation guard and scrim handler, `apps/admin/app/styles.css:1191`, and Playwright/WebKit dialog-dismiss sequencing. **Cause unresolved; physical Safari confirmation required.**

#### QA-04 — P3: customer catalogue emits repeated invalid View-child errors

**Impact:** browser console noise obscures new faults. No browser crash was observed. Native rendering impact is unverified.

Reproduce without fault injection: open customer site → Products. Console emits `Unexpected text node: . A text node cannot be a child of a <View>.` Clean read-only evidence: `.local/browser-qa/customer-clean-products-console.json` and `customer-clean-products.png`. The blank text in the message is consistent with empty-string conditionals; likely sites include `apps/mobile/src/catalog.tsx:660` and `:749`. React Native Web's `View` check emits this for string children. Wrap actual text in Text and make conditional rendering boolean; validate on native before asserting native safety.

### Harness problems and verification limits

- Early new-test failures were selector/expectation mistakes: singular `item`, cart `Quantity` label, bilingual navigation, select label versus combobox accessible name, duplicate alert/owner-name matches, restored dialog after reload, final `REFUNDED` status, and the article in the summary label. Corrected against observed UI/contracts; all affected business assertions were retained. Logs `chrome-audit`, `chrome-final`, `chrome-focused`, `chrome-stock-cart` preserve these attempts; do not count them as application bugs.
- WebKit exposed incomplete login synchronization in existing recovery/owner helpers. Waiting for the verification button to disappear was insufficient. Waiting for the entire dialog resolves nine previously failing journeys. Isolated `webkit-input-probe.json` also shows `fill('10')` and key-by-key typing retain the same quantity and price. There is no demonstrated wrong-quantity product bug from those initial failures.
- Initial Firefox configuration inherited `channel: chrome`; fixed in `playwright.qa.config.ts`. The subsequent native Firefox launch failure remains external. Initial 39 immediate launch failures are **BLOCKED execution**, not 39 functional failures.
- The documented root `npm run typecheck`, `npm run test:integration` and `npm run build` commands in LOCAL_TESTING do not match the current root scripts. Workspace-qualified commands below were used. This is a documentation/harness issue; existing user documents were preserved.
- Screenshots and traces establish browser behavior only. Live SMS delivery/India provider setup, real payment/webhook/refund service behavior, live OCR/AI, cloud storage, calls/WhatsApp handoff, closed-app notifications, actual-phone usability, deployment/proxy/SSE behavior, backups/restore and native installation remain **NOT RUN/BLOCKED** external gates.

### Reproduction commands and artifacts

From the repository root; prefix commands with `rtk` as required locally. Reporter paths below are under `.local/browser-qa/` and are intentionally local evidence, not published data.

```sh
rtk npm run test:e2e -- --reporter=list,json,html --trace=on --output=.local/browser-qa/chrome-verified-results
## Set PLAYWRIGHT_JSON_OUTPUT_FILE=.local/browser-qa/chrome-verified.json
## and PLAYWRIGHT_HTML_OUTPUT_DIR=.local/browser-qa/chrome-verified-html when retaining named reports.

rtk npm run test:e2e -- --config=playwright.qa.config.ts --project=webkit --reporter=list,json,html --trace=on --output=.local/browser-qa/webkit-results
## WebKit invocation used TMPDIR=/private/tmp and matching JSON/HTML environment paths.
## Run exactly one project per invocation: global setup resets shared disposable fixtures.

rtk npm test
rtk npm run test:workflows
rtk npm run test:bootstrap
rtk npm run test:integration -w @shiv/api
rtk npm run lint
rtk npm run typecheck --workspaces --if-present
rtk git diff --check
rtk npm run build -w @shiv/shared
rtk npm run build -w @shiv/api
rtk npm run build -w @shiv/admin
rtk npm run build -w @shiv/mobile
```

Detailed exact invocations are in each captured `*.log` npm header and corresponding JSON `config`. Focused reruns selected the named failing cases with `--grep`; `webkit-focused.log` retains its selection. Every test uses `--trace=on`; screenshots/error contexts live in each named `*-results` directory. HTML reports can be opened with `rtk npx playwright show-report .local/browser-qa/chrome-verified-html`; traces with `rtk npx playwright show-trace /absolute/path/to/trace.zip`. Event attachments contain console/request evidence without request headers or credentials. Browser-engine installation and Firefox diagnostics are in `browser-install.log` and `firefox-launch.log`.

### Five-minute family confirmation after fixes

Say **“यह अभ्यास है। असली पैसे या सामान नहीं भेजना है।”** Use separate customer/Father/Uncle browser profiles and documented TEST fixtures; no real goods or money.

1. Customer: add twice, type a quantity, reload; read unit, quantity, delivery charge and final total aloud. Use the documented ₹20,000 fixture.
2. Father: find the new order without refreshing, take responsibility, read customer/site/amount; find Call/WhatsApp without sending or calling.
3. Uncle: verify Father's name, prepare/dispatch, record simulated cash once, deliver; compare customer history, stock and cash.
4. Explain a refusal and count sellable/damaged return; confirm no fictional collection and no duplicate stock restoration.
5. Turn mobile data off/on, increase text size, and expire a test session. Ask each owner to recover without coaching. Separately repeat the Rate Studio discard/menu path on actual Safari if that is a target device.

The most useful next action is to fix the owner session-expiry recovery and rerun its failing phone regression, followed by large-text reflow and the WebKit menu investigation. Then conduct the uncoached review on Father's and Uncle's actual phones.
