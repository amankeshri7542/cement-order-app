# V2 storefront foundation — 9 October 2026

This is a reversible local engineering prototype for P1 source discovery and the
read-only portion of P2. It does not complete family/content approval, physical
device acceptance, the P0 external readiness gates, or authorize publication.

## Scope and architecture

`apps/storefront` is a separate Next.js application alongside the owner desk and
Expo customer app. All three use the existing NestJS/PostgreSQL commerce API.
No second product database, schema migration, importer, legacy service, identity
import, cart, ordering, quotation submission or payment flow was added.

The storefront offers a shopping homepage, category links, searchable catalogue,
brand/stock filters, API-supported sorting, bounded cursor pagination and stable
`/products/[id]` routes. Product pages render useful server HTML and metadata at
request time; builds require no live database. Integer paise, units, packs,
minimums and increments come from the current API. Empty, unavailable, loading,
failed-request, retry and stale/offline states are explicit. English/Hindi choice
persists in the browser. Delivery lookup uses the public read-only pincode route.

The typed boundary validates and projects only known public response fields.
Browser fetches omit credentials; the public SSE connection does not request
credentials. Catalogue events, focus, visibility and reconnect trigger refetch.
Request generations reject old responses; pagination rebuilds the current set
from bounded API pages and deduplicates identifiers. An unchanged normalized
search preserves the request and the pressed card. URL filters and loaded-page
count restore on browser Back. No catalogue operation reserves stock.

Production HTML and API reads use `no-store`; Next development HTML enforces
`no-cache, must-revalidate`. The UI distinguishes last checked
time from the API's price-updated date and warns when updates are disconnected.
There is no personalized public cache. Per-response nonce CSP, exact configured
API/asset origins, no framing, restrictive permissions and nosniff follow the
existing frontend policy. Only approved product WebP paths on the configured
asset origin may render. Production origins must use HTTPS.

## Source and design decisions

See [the discovery register](V2_DISCOVERY_REGISTER.md) for pinned legacy revisions,
collection dispositions and source anchors. Both legacy main revisions remain
unchanged from the earlier roadmap. All legacy records and attendance workflows
remain preserved. Rupee/paise and legacy-ID conversion rules are documented only;
there is no production importer or inferred stock conversion.

Only the shop name, building-material business and Patna context are approved by
the brief. Legacy contacts, hours, exact address, founding-year/dealership/award
claims and image rights are inconsistent or unverified. They are not copied into
the public prototype. Some legacy shop images were explicitly described as
placeholders or AI-generated; no image is presented as an authentic shop photo.

The provisional design uses warm concrete surfaces, charcoal type and restrained
ochre, with a materials-counter composition and simple material drawings. Prices
and selling units lead the cards. A compact shared CSS vocabulary supports clear
English/Devanagari text, large controls, visible focus and reduced motion.
Unapproved family content and physical-phone review remain acceptance gates.

The requested find-skills workflow checked the skills.sh leaderboard and source
reputation: Anthropic frontend-design (966,410 installs; repository 180,063 stars)
and Vercel React best practices (782,175 installs; repository 32,105 stars).
Existing installed guidance was sufficient; no new skill was installed. Current
Context7 Next.js guidance and the installed framework documentation were read.
The lockfile retains existing versions; installed Next.js is 16.3.8, React 19.2.

## Changed files

| Area                    | Files and purpose                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public app              | `apps/storefront/app/`, `components/`, `lib/`, `proxy.ts`, framework/package configuration: bilingual pages, validated public reads, freshness and security policy.                                            |
| Launcher                | `scripts/local.mjs`, `scripts/local-services.mjs`, `scripts/local.test.mjs`: explicit ports, identity/ownership checks, safe lifecycle and regression tests.                                                   |
| Verification            | `tests/storefront.spec.ts`, `playwright.config.ts`, `scripts/check-production-headers.mjs`, `.github/workflows/ci.yml`: real-API browser journeys, isolated server, production CSP/performance and unit gates. |
| Integration and handoff | Root `package.json`/lockfile, README, local-testing guide, V2 roadmap, this report, discovery register and three storefront screenshots. Existing migration and backend application files remain unchanged.    |

## Local review

```sh
npm ci
npm run local:setup                     # fresh checkout only; preserves existing development data
LOCAL_API_PORT=4000 LOCAL_ADMIN_PORT=3002 LOCAL_CUSTOMER_PORT=8081 LOCAL_STOREFRONT_PORT=3003 npm run local:start
npm run local:status
npm run local:stop                      # only verified managed process groups
npm run local:db-stop                   # only when no services/tests need the local cluster
```

| Surface           | Local review URL                      | Isolated browser-test port |
| ----------------- | ------------------------------------- | -------------------------- |
| Storefront        | <http://localhost:3003>               | 3004                       |
| Owner desk        | <http://localhost:3002>               | 3001                       |
| Existing customer | <http://localhost:8081>               | 8082                       |
| API health        | <http://localhost:4000/api/v1/health> | 4010                       |

The launcher accepts `LOCAL_API_PORT`, `LOCAL_ADMIN_PORT`,
`LOCAL_CUSTOMER_PORT`, `LOCAL_STOREFRONT_PORT` and persists the selected values in
ignored `.local/ports.env`. It refuses conflicts on either IPv4 or IPv6, does not
select a hidden fallback, reserves browser-test ports and the customer's Metro
port, and passes exact local Origins/API URLs to its child processes. Status
checks both app identity and ownership; HTTP 200 alone is insufficient. Stop
checks process start time, command, working directory and group before signaling.
See [LOCAL_TESTING.md](LOCAL_TESTING.md) for recovery and foreground commands.

## Verification record

Baseline: `6a44973e3a3fb5e4e24f1b8e38f1cc36ae086838`, clean checkout,
[`codex/pilot-readiness` CI](https://github.com/amankeshri7542/cement-order-app/actions/runs/37905742169)
passed at that exact SHA. Its recorded browsers were 43 Chrome and 43 WebKit.
New verification is performed sequentially against the loopback `_test` database;
development data and output directories are separate. Browser application source
is frozen during each run. No force-clicks, retries or skipped assertions are used.

Completed supporting commands in this session:

| Command                                                                                            | Result                                                                                 |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm test`                                                                                         | 61/61 unit/provider simulations                                                        |
| `npm run test:integration -w @shiv/api`                                                            | 67/67; initial sandbox connection failure was resolved by allowing loopback access     |
| `npm run test:workflows -w @shiv/api`                                                              | 20/20                                                                                  |
| `npm run test:bootstrap -w @shiv/api`                                                              | PASS, disposable migration-only staff bootstrap                                        |
| `npm run test:local`                                                                               | 10/10 launcher tests                                                                   |
| Shared/API/owner builds                                                                            | PASS; owner uses `.next-e2e`, separate from development                                |
| `npm run build -w @shiv/mobile`                                                                    | Android/iOS/web exports PASS                                                           |
| `npm exec -w @shiv/mobile -- expo install --check`                                                 | PASS with network access; offline fallback was not accepted as evidence                |
| `npm audit --omit=dev --workspace @shiv/api --workspace @shiv/shared --workspace @shiv/storefront` | 0 advisories                                                                           |
| `npm audit --json`                                                                                 | 32 existing workspace advisory entries: 21 high, 11 moderate, primarily Expo/toolchain |

New storefront unit checks: `npm test -w @shiv/storefront` passed 7/7 for paise
formatting, public-field projection, query bounds/round-trip, stable-ID deduplication
delivery-shape validation, an empty recommended-use note and stable IST time. `npm run lint` and workspace typechecks passed.

Verification exposed and fixed five real edge cases: an optional recommended-use note rejected by the public reader; category/brand choices not refreshing after owner edits; browser-dependent IST time formatting; a Retry banner disappearing before recovery; and delivery input accepted before hydration. The public reader accepts an absent note without relaxing money/stock checks, refreshes rebuild choices, timestamps use deterministic 24-hour IST, errors persist until success, and delivery controls wait for their handlers.

**Open WebKit diagnostic:** WebKit also reported an EventSource cancellation during hard navigation. Trace review showed correct exact-Origin responses, but a 27–29 ms gap before `pagehide` closed a connecting stream. Cleanup now runs at `beforeunload` and `pagehide`, restores the stream on persisted `pageshow`, and reopens a closed stream on focus. Instrumented timing runs did not independently reproduce the engine error; the original failing trace and lifecycle regression are retained. Both delayed-JavaScript delivery and early-close assertions failed before their fixes and passed afterward. No error assertion, CORS rule or forced-click policy was weakened.

Final frozen-source browser evidence uses these commands, sequentially:

```sh
PLAYWRIGHT_JSON_OUTPUT_FILE=.local/v2-storefront/chrome-acceptance.json \
PLAYWRIGHT_HTML_OUTPUT_DIR=.local/v2-storefront/chrome-acceptance-html \
npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome \
  --reporter=list,json,html --trace=on --output=.local/v2-storefront/chrome-acceptance-results
TMPDIR=/private/tmp PLAYWRIGHT_JSON_OUTPUT_FILE=.local/v2-storefront/webkit-review.json \
PLAYWRIGHT_HTML_OUTPUT_DIR=.local/v2-storefront/webkit-review-html \
npm run test:e2e -- --config=playwright.qa.config.ts --project=webkit \
  --reporter=list,json,html --trace=on --output=.local/v2-storefront/webkit-review-results
```

Chrome: **55/55 passed** (43 baseline + 12 new), zero retries/skips/unexpected/flaky results and zero uncaught page errors across 120 event attachments. Recorded engine: Chromium 154.0.8037.99 on arm64 macOS 27.0.1, Node 24.19.0. The updated unavailable-product navigation journey then passed **1/1** in Chrome (`chrome-navigation-check.json`). Final WebKit interactive suite: **55/55 passed** (43 baseline + 12 new), zero retries/skips/unexpected/flaky results and zero uncaught page errors across 120 event attachments (`webkit-review.json`). These green interactive results do not close the separate native-navigation diagnostic below.

The last rapid direct-navigation WebKit suite passed **54/55** (`webkit-acceptance.json`): product, unavailable and empty-state assertions succeeded, but its uncaught-error check captured `/localhost:4010/api/v1/events due to access control checks.` This remains an **unresolved native teardown diagnostic**, not a clean WebKit lifecycle acceptance. No application error was filtered out. The review journey instead checks direct 404 first, opens an out-of-stock product, then follows the site's Materials link and Search control; all original state and pageerror assertions remain.

To reproduce the original diagnostic after the isolated TEST fixtures are created, on one fresh WebKit page rapidly call `goto('/products/test-v2-26')`, wait only for visible “Out of stock”, call `goto('/products/does-not-exist')`, wait for its unavailable heading, then `goto('/products?q=NO-SUCH-TEST-V2-MATERIAL')`. Observe `pageerror` throughout. Its captured trace is `.local/v2-storefront/webkit-acceptance-results/storefront-storefront-dist-f6b68-g-products-and-empty-search-webkit/trace.zip`. It is timing-sensitive; instrumentation can prevent reproduction. Request traces show later SSE responses with the exact allowed Origin, so weakening CORS is not warranted. Check on an actual Safari/device runtime before P2 acceptance.

Firefox launch was rechecked and remains blocked before navigation:
`Could not find profile folder` in installed firefox-1543. No Firefox coverage is
claimed. Browser emulation and doubled-text tests do not establish physical-phone,
real browser zoom, screen-reader or family acceptance.

Raw local evidence is kept under ignored `.local/v2-storefront/`.

### CI portability correction

The first review commit `e91ff25fa4cc6bed370303c2eed20106143a865a` passed CI setup, lint/typechecks and all backend/launcher/contract suites, but Chrome was **54/55**: doubled text on Linux caused horizontal overflow. Local reproduction with the wider Arial fallback confirmed a 368 px page at a 360 px viewport. The long “Recommended use” heading set the description grid's intrinsic minimum width. One `overflow-wrap: anywhere` rule on those headings fixes wrapping without clipping content. The browser test now deliberately covers the portable fallback font and reports offending element bounds while retaining its original fit assertion.

The before-fix targeted Chrome case failed (`layout-before.json`); after-fix Chrome and WebKit each passed **1/1**, recorded in `layout-chrome-fixed.json` and `layout-webkit-fixed.json`. Lint, the browser-spec typecheck and the isolated production storefront rebuild passed. The final review SHA is validated again in CI; the first failed run remains linked in the review history. Earlier complete local suites above predate this one-line layout correction.

## Production checks and launcher lifecycle

Production checks use separate Next output directories and reserved temporary ports after browser suites stop. Build the owner and storefront with `NEXT_DIST_DIR=.next-e2e`, `NEXT_PUBLIC_API_URL=https://api.security.invalid/api/v1` and `NEXT_PUBLIC_ASSET_ORIGIN=https://assets.security.invalid`:

```sh
NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_API_URL=https://api.security.invalid/api/v1 NEXT_PUBLIC_ASSET_ORIGIN=https://assets.security.invalid npm run build -w @shiv/admin
NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_API_URL=https://api.security.invalid/api/v1 NEXT_PUBLIC_ASSET_ORIGIN=https://assets.security.invalid npm run build -w @shiv/storefront
EXPO_PUBLIC_API_URL=https://api.security.invalid/api/v1 EXPO_PUBLIC_ASSET_ORIGIN=https://assets.security.invalid npm exec -w @shiv/mobile -- expo export --platform web --clear
```

Start three temporary foreground servers in separate terminals with the same public-origin variables: `NEXT_DIST_DIR=.next-e2e npm exec -w @shiv/admin -- next start --port 3002 --hostname 127.0.0.1`; `PORT=8083 npm run serve:customer`; and `NEXT_DIST_DIR=.next-e2e npm exec -w @shiv/storefront -- next start --port 3005 --hostname 127.0.0.1`. Run `HEADER_EVIDENCE_DIR=.local/v2-storefront node scripts/check-production-headers.mjs`, then stop those owned foreground servers.

The script requires ignored `tls.key`/`tls.crt` one-day localhost test certificates in that evidence directory. It tests Chrome and WebKit against local TLS ports 3443/8443/3445 with simulated signed-out/unavailable API responses. It enforces the production CSP, blocks injected scripts, checks fresh nonces/no-store, exercises language switching and measures a predeclared **450 KiB gzip initial-script budget**. This is an unthrottled local production-build check, not a mobile-network or live-provider benchmark. All six engine/frontend checks **passed**; injected scripts were blocked, fresh nonces were observed, and no uncaught page errors occurred. Storefront initial JavaScript was **274.2 KiB gzip** in each engine, below the 450 KiB budget. Chrome FCP was 180 ms (load 222.7 ms); WebKit FCP was 53 ms (load 88 ms). These single local observations are not field performance claims. Evidence: `production-headers.json`, `production-check.log` and production screenshots under `.local/v2-storefront/`. Final owner/storefront builds and Expo web export passed; earlier Android/iOS exports also passed.

The real IPv6 conflict test refused owner port 3000 with an explicit `::1`/`EADDRINUSE` message and exit 1. The unrelated AptoPro process remained PID 70155. Temporary production servers were stopped through their own foreground sessions. Custom ports **4002/3006/8084/3007** passed ownership/identity status and browser smoke: every frontend used API 4002; its exact Origin was accepted and unapproved port-3000 Origin was rejected. No uncaught page errors occurred. Verified managed groups stopped cleanly. Final review ports **4000/3002/8081/3003** passed the same routing/Origin smoke. An immediate status during startup truthfully reported not-ready before compilation; once ready all four were verified. A saved-port stop/start (without overrides) was then exercised and all four are left running for local review.

No development reset/seed or migration occurred. Before/after counts remain 6 users, 8 products, 0 orders and 0 quotes; online payments remain false. All nine migration SHA-256 checksums match the starting files, including historical whitespace. The final launcher unit rerun required loopback/process permissions after the restricted sandbox returned `EPERM`; outside it all 10 passed, with all 7 storefront contract tests passing. Evidence: `launcher-*`, `dev-before.json`, `dev-after.json` and `migration-checksums.json` under the ignored evidence directory.

## Screenshots

These screenshots use explicitly isolated TEST products on the real local API;
they are not approved public stock, prices or genuine shop photographs.

- [Desktop shopping homepage](screenshots/storefront/desktop.png)
- [Hindi catalogue at 360px](screenshots/storefront/mobile-hindi.png)
- [Product details and selling terms](screenshots/storefront/product.png)

## Manual family review and open decisions

1. In the local browser, open the storefront. Actual-phone review requires a separately approved device/staging setup and remains pending. Browse, switch
   Hindi/English, search and filter, open a product, then use Back. Read the price,
   pack, minimum and increment aloud; check real browser zoom and enlarged text.
2. Turn network access off/on and confirm stale prices are clearly identified.
   On a clearly labelled TEST product, change the owner selling price and confirm
   the storefront and existing customer app refresh. Do not place a real order.
3. Approve exact shop contacts, address/map, hours, delivery wording and rights to
   authentic shop/material/award photographs. Approve selling units per SKU.
4. Confirm whether legacy attendance supports daily operations or payroll, who
   corrects records and who must retain access. Unanswered means preserve all.

Remaining outside this phase: transactional website P3, production data migration,
hosting/domain changes, paid provisioning, customer messages, real deliveries,
payment activation, attendance replacement, provider/infrastructure acceptance,
physical-device/real-zoom/family acceptance and Expo/toolchain remediation.

## Review publication

Branch: `codex/v2-storefront-foundation`, based on the verified baseline. The
existing pilot branch and draft PR remain separate. Fresh deployment-hook checks
found verification-only CI, no repository webhooks/deployment history and no
ordering-repository project in the accessible Vercel team. A draft PR triggers
verification for this feature branch; no merge or application publication is
authorized. Exact review commit, remote SHA confirmation and CI are recorded
after verification and push.
