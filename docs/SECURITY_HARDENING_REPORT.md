# Security hardening — local implementation

Release follow-up, 9 October: the implementation below is retained. A later exact-source CI run exposed an intermittent customer catalogue click race; the release review reproduced it and preserves normalized search state to avoid removing a pressed card. See [BROWSER_QA_REPORT.md](BROWSER_QA_REPORT.md) for before/after evidence and [REVIEW_HANDOFF.md](REVIEW_HANDOFF.md) for final-source verification, publication links and residual gates. The earlier 42/42 browser counts below are historical, not a claim about every later revision. The source-review push is now authorized; deployment and online payments remain unauthorized.

Scope: `codex/pilot-readiness`, existing dirty working tree preserved. No deployment, real messages, paid resources, or online payments authorized. The latest browser QA follow-up (40/40 Chrome and WebKit) supersedes the historical QA failures.

## Plan and attack surface

Customer Expo web/native and owner Next.js clients call a NestJS API. PostgreSQL owns identity, sessions, inventory, money, work queues and audit evidence. The API alone calls SMS/payment/OCR/AI/storage providers. Customer input and provider output are untrusted; owners explicitly review prices before publication. Public product photos and private supplier sheets have different storage boundaries.

1. **Confirmed, high:** authenticated COD requests reserve stock without pending-demand caps; distributed identities can overwhelm owners. Add serializable customer/store/stock-share limits and quotation queue caps. Recover by acknowledging/rejecting existing work, reviewed wholesale quotation, or a bounded audited owner exception. Never auto-cancel or release stock.
2. **Hardening, high:** OTP already has persistent phone/IP limits and timeouts; extraction already has staff/hour, batch-attempt, lease/concurrency and timeout controls. Add persistent global budgets, request/account/IP budgets, emergency switches and useful threshold alerts. These do not prevent network DDoS.
3. **Confirmed, high:** product photos use direct public presigned PUT with declared MIME/size only. Replace with authenticated bounded raster validation/re-encoding before storage; only recorded approved-origin assets may be published. Keep private Rate Studio storage and human approval.
4. **Confirmed, medium:** open staff SSE only checks authorization when connecting; frontends lack response CSP. Revalidate session/access/role/assurance before events and heartbeat; add compatible frontend headers. Revalidate existing IDOR, rotation, Origin, price and webhook safeguards.
5. **Deployment prerequisites:** runtime/migration credential separation, provider caps, exact proxy topology, storage bucket policy, TLS/domain, edge controls, backup/restore and alert delivery need real-environment evidence. Prepare scripts/runbooks and rehearse only with disposable data.

Implementation phases follow the order above, then targeted real PostgreSQL/API tests, sequential complete Chrome and WebKit suites, type/lint/build/audit checks and safe local restart. Additive migrations only; rollback code with services stopped while retaining audit/asset/override tables. Evidence goes in `.local/security-hardening/`; the source baseline is `before.diff` plus `source-before.json`.

## Proposed business defaults (require family agreement before staging)

Pending COD: at most 3 orders / ₹100,000 per customer, 25 orders / ₹1,000,000 store-wide, and 50% of each product's available-plus-unacknowledged stock (at least one selling unit). Pending quotation requests: 3 per customer / 30 store-wide. An owner may approve one new request for one customer for 30 minutes with a reason and explicit COD amount ceiling. Reviewed quotation conversion remains the wholesale route. No ageing job cancels orders: owners must review old pending work and use existing cancellation/physical-return flows.

## Findings and before/after evidence

| Finding                                  | Before                                                                                                   | Implemented / evidence                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-01 — COD and quotation demand, high  | Fourth pending COD accepted; no cumulative customer/store/stock-share guard                              | Reproduced in `before-regressions.log`; now serializable caps, admitted-request account/IP/global budgets, Hindi recovery and one-use audited exceptions. Concurrent callers cannot exceed caps. No auto-cancel/release job added.                                                                                                          |
| SEC-02 — public image bytes, high        | An attacker-origin image URL was saved; public presigned PUT trusted declared MIME/size                  | Reproduced URL acceptance before fix; authenticated byte upload, 5 MiB/20MP/single-frame limits, bounded decode, WebP rewrite, recorded approved-origin asset requirement. HTTP and decoder tests reject SVG, mismatches, truncation, excessive bytes/pixels and guessed asset keys. S3 transport is simulated.                             |
| SEC-03 — open owner SSE, medium          | Revoked session still received an event                                                                  | Reproduced before fix; each event/20-second heartbeat rechecks session hash, access/refresh expiry, role and staff assurance. Revocation, rotation, demotion, expiry and changed credentials now close the stream.                                                                                                                          |
| SEC-04 — browser policy, medium          | API helmet did not protect actual frontend HTML                                                          | Next production nonce CSP; actual customer response wrappers for dev and export hosting. Header regressions plus production Chrome/WebKit rendered checks pass with parser-injected scripts blocked. Local self-signed TLS fixture explicitly trusts its certificate; real staging certificate/proxy validation is still pending.           |
| SEC-05 — local mock exposure, medium     | Development API listened on all interfaces                                                               | Mock API now binds loopback and rejects non-loopback socket addresses, even with a forged forwarded header. Production mock rejection remains tested. A final failed-before configuration regression also proved HTTP/credential-bearing object-storage endpoints were accepted; production now rejects them (`storage-config-before.log`). |
| SEC-06 — shared cost controls, hardening | Existing OTP/IP and Rate Studio staff/job limits were real; global daily caps/emergency switches missing | Persistent global OTP/extraction/admitted-demand budgets, upload budgets, OTP/photo concurrency leases, 80% audit/log warnings, owner status UI and restart-applied pause switches. Existing timeouts, private sources, strict extraction schema and price consent preserved.                                                               |
| SEC-07 — operational preparation         | Infrastructure controls were unverified                                                                  | Production runtime DB privilege rejection, operator grant template, corrected CI commands, local secret-pattern scan, advisory/SDK checks, and real disposable backup/restore plus restricted-role rehearsal. Managed infrastructure remains pending.                                                                                       |

Existing protections were revalidated rather than replaced: customer/staff and record ownership, injected role/price rejection, rotating/revocable sessions, exact Origin failures, transactional stock and idempotency, duplicate cancellation/refund handling, invalid/replayed signed payment events, quote revision consent, private supplier sources and explicit human price review. Gateway, OCR/AI, SMS and object-storage tests use clearly labelled simulations; none proves live provider behavior.

The first expanded Chrome run found three integration/test-model problems (39/42): the new CSP blocked API-hosted Rate Studio images; Expo HTML bypassed Metro's middleware hook; a script created by trusted Playwright evaluation inherited strict-dynamic trust. The fix allows only the exact API image origin, applies customer headers outside Expo's HTML handler, and tests parser-injected HTML with the original CSP intact. Targeted browser rerun: **8/8**. The original Rate Studio and stock assertions were retained; last-stock fixtures now explicitly obtain owner wholesale approval.

## Verification ledger

All evidence is local under `.local/security-hardening/`. Fresh complete browser runs use real API/PostgreSQL and separate disposable databases from development. Each database-sharing suite runs sequentially.

| Check                                          | Result / evidence                                                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before-change targeted security regressions    | 3 failed as expected, `before-regressions.log`                                                                                                      |
| Unit/provider/config/image tests               | 61/61, `unit-final.log`                                                                                                                             |
| Real API/PostgreSQL suite                      | 67/67, `integration-final.log`                                                                                                                      |
| Shop workflows                                 | 20/20, `workflows-final.log`                                                                                                                        |
| Clean migration/staff bootstrap                | PASS, `bootstrap-final.log`                                                                                                                         |
| Disposable dump/restore and restricted runtime | PASS; 37 tables matched, CRUD allowed; DDL/migration-table/immutable-ledger writes denied, `restore-result.json`, `restore-final.log`               |
| Typechecks, ESLint, whitespace                 | PASS, `typecheck-final.log`, `lint-final.log`, `git diff --check`                                                                                   |
| Shared/API/Next/Expo exports                   | PASS; `build-api-final.log`, `production-admin-build.log`, `production-customer-build.log`; initial all-platform Expo export in `build-initial.log` |
| Production frontend CSP                        | Chrome and WebKit × both frontends PASS, `production-headers.json`, `.log`, four screenshots; API responses simulated                               |
| Complete Chrome                                | **42/42**, no retries/skips, `chrome-final.json`, `chrome-final-results/`, `chrome-final-html/`; zero uncaught/View text-node errors                |
| Complete WebKit                                | **42/42**, no retries/skips, `webkit-final.json`, `webkit-final-results/`, `webkit-final-html/`; zero uncaught/View text-node errors                |
| API and owner production dependencies          | 0 advisories each, `audit-api.json`, `audit-admin.json`                                                                                             |
| All workspace dependencies                     | 32 advisory entries: 21 high, 11 moderate, `audit-all.json`; dry-run offers 0 compatible changes                                                    |
| Expo SDK compatibility                         | PASS, `expo-compatibility.log`                                                                                                                      |
| Working-tree credential-pattern scan           | 162 files, 0 findings, `secret-scan-final.log`; limited patterns, not a full history/provider scan                                                  |
| Container / maintained scanners                | Docker, Trivy and Hadolint CLIs unavailable; not claimed tested. Secretlint was run ephemerally                                                     |

The 32 advisory entries include transitive parent packages, not 32 independent exploits. Direct advisory packages are braces, node-forge, sprintf-js and older uuid, mainly through Expo/Metro/React Native tooling. npm proposes an Expo 44 downgrade or independent React Native 0.87 upgrade for the unresolved tree. Neither was applied; Expo's compatibility check passes on the current SDK. Do not expose development tooling. A supported SDK/toolchain remediation and container scan remain native/staging release gates. API production audit is separate from this result.

## Exact verification commands

From repository root (all tests use existing ignored local test configuration; never point these at development/staging):

```sh
npm test
npm run test:integration -w @shiv/api
npm run test:workflows
npm run test:bootstrap
npm run test:restore
npm run lint
npm run typecheck --workspaces --if-present
npm run security:scan
npm audit --omit=dev --workspace @shiv/api --workspace @shiv/shared
npm audit --omit=dev --workspace @shiv/admin
npm audit --json
npm exec -w @shiv/mobile -- expo install --check
npm run build -w @shiv/shared
npm run build -w @shiv/api
npm run build -w @shiv/admin
npm run build -w @shiv/mobile
git diff --check
```

Fresh browser suites, one invocation at a time:

```sh
PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_JSON_OUTPUT_FILE=.local/security-hardening/chrome-final.json PLAYWRIGHT_HTML_OUTPUT_DIR=.local/security-hardening/chrome-final-html npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome --reporter=list,json,html --trace=on --output=.local/security-hardening/chrome-final-results
TMPDIR=/private/tmp PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_JSON_OUTPUT_FILE=.local/security-hardening/webkit-final.json PLAYWRIGHT_HTML_OUTPUT_DIR=.local/security-hardening/webkit-final-html npm run test:e2e -- --config=playwright.qa.config.ts --project=webkit --reporter=list,json,html --trace=on --output=.local/security-hardening/webkit-final-results
```

Production frontend check (stop managed dev apps first; these origins are deliberate non-routable fixtures; start the two servers in separate terminals and stop them afterward):

```sh
npm run local:stop
NEXT_PUBLIC_API_URL=https://api.security.invalid/api/v1 NEXT_PUBLIC_ASSET_ORIGIN=https://assets.security.invalid npm run build -w @shiv/admin
EXPO_PUBLIC_API_URL=https://api.security.invalid/api/v1 npm exec -w @shiv/mobile -- expo export --platform web --clear
NEXT_PUBLIC_API_URL=https://api.security.invalid/api/v1 NEXT_PUBLIC_ASSET_ORIGIN=https://assets.security.invalid npm exec -w @shiv/admin -- next start --port 3002
PORT=8083 EXPO_PUBLIC_API_URL=https://api.security.invalid/api/v1 npm run serve:customer
# In the checking terminal, generate a one-day LOCAL TEST certificate only:
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout .local/security-hardening/tls.key -out .local/security-hardening/tls.crt -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
chmod 600 .local/security-hardening/tls.key
node scripts/check-production-headers.mjs
```

The checker creates temporary localhost TLS proxies, then closes them. Certificate-trust bypass is confined to its self-signed test browser contexts; it does not change application CSP/authentication. This is not a staging TLS assessment. Clear Expo's cache when changing build-time API origin: the initial verification export reused a cached localhost bundle until `--clear` was used.

## Exact manual/family checks

Use separate browser profiles for Father, Uncle and a TEST customer. Say “यह अभ्यास है। असली पैसे या सामान नहीं भेजना है।” Do not send messages or record real dispatch/cash during practice.

1. Use a disposable review environment with sufficient TEST stock. Place three small unacknowledged COD requests. A fourth must show the bilingual owner-review message; stock/order count must not change. Try a single request exceeding half the currently available stock: require a reviewed quote or owner exception.
2. Owner → Finance & settings → Booking limits: check pending counts and old-work warning. Call/check the customer outside the app only when explicitly authorized; in practice, simulate that verification. Enter the existing TEST customer's 10-digit number, COD, an amount ceiling, a specific reason and the review checkbox → Allow once. One matching request within 30 minutes succeeds; a second, expired, or over-ceiling request does not. Audit history must show grant and use with the correct actor.
3. Acknowledge a real existing request in Today; it leaves the pending cap but stock remains reserved. Use the existing cancellation/physical-return workflow only after checking actual fulfilment. Paid/dispatched orders must never regain stock just because a limit or age threshold is reached.
4. Submit three unacknowledged quote requests. A fourth is blocked. Uncle acknowledges/reviews work; send a versioned offer, obtain customer acceptance, convert once. Negotiated prices, provenance and one stock reservation must remain intact.
5. Technical operator toggles each pause flag in an isolated environment and restarts the API. New affected operations stop with a clear message; saved order retries still recover the same result. Restore the flag deliberately. Do not test provider emergency controls with real messages as part of local review.
6. Open two owner profiles. Revoke the first session from the second; the first open event stream closes by its next event/20-second heartbeat. Ordinary API reads reject immediately. On a dirty Rate Studio/quote draft, the existing bilingual sign-in action still honours discard protection; signing in as another owner clears the previous account's desk.
7. With staging storage configured, upload JPEG/PNG/WebP and inspect the stored object: random `.webp`, bounded dimensions, no original metadata. SVG renamed PNG, mismatched MIME, truncated, >5 MiB and >20MP images must fail without public objects. An external URL or invented approved-host key must not publish. Separately verify private supplier originals cannot be anonymously fetched/listed and still require human review before prices publish.
8. Through the real HTTPS staging proxy, inspect both HTML responses for CSP/nosniff/frame/referrer/HSTS headers. Check public product images, authenticated Rate Studio source/card previews, downloads and normal menu scrim interaction. Use real 200% zoom and the actual family phones; the historic far-right Safari edge and Firefox launch are separate gaps.

## Deployment and business gates still pending

- Family approval of pending-demand/value/share limits, wholesale exceptions, two-hour follow-up responsibility, return/refund policy and the proposed backup RPO/RTO/retention. Shared IP limits can affect families/NATs; tune from real data, not by removing global controls.
- Owned sibling HTTPS domains, exact CORS origins, both frontend API/asset build variables, correctly limited TLS ingress and **verified** `TRUST_PROXY_HOPS`. Test spoofed X-Forwarded-For, direct-origin bypass and short/long proxy paths. The hop count is not an IP identity guarantee. Enforce edge body/rate/connection limits, including public SSE, and block direct API ingress. Local throttles do not stop DDoS.
- Separate staging DB, runtime/release/backup roles, secret manager, TLS DB connection, controlled migration job and rollback snapshot. `runtime-grants.sql` is a template; its real provider grants have not been applied or verified.
- Twilio: separate staging Verify service, approved India recipients/setup, geographic permissions, Fraud Guard, service rate limits, usage alerts and an operator-tested emergency disable. An application counter is not a provider bill cap. No provider account was accessed.
- OCR/AI: separate projects/restricted server keys, Google Vision quotas, OpenAI model/project rate limits, separate spend alerts and a hard project spend limit at the lowest approved amount. Current official guidance distinguishes alerts (traffic continues) from hard spend limits (affected requests return 429); verify account availability and behavior. Confirm whether each budget actually blocks spend; an alert threshold is not a hard cap. Leave keys absent for manual-only family review until approved.
- R2: separate public/private buckets, least-privilege tokens scoped to required buckets, private bucket anonymous denial/no listing, approved public asset hostname, correct image headers, lifecycle/orphan retention and access logging. No storage policy is claimed verified by simulated S3 calls.
- Monitoring: route structured rejection/80% budget/maintenance/provider-failure signals to a named technical operator. Alert on sustained 401/403/429 spikes, provider costs, overdue unacknowledged work, failed jobs, DB health and backup age. Test actual alert delivery without contacting customers. Do not log bodies, tokens, OTPs, passphrases, full addresses, private images or provider payloads.
- Encrypted off-site backups, retention, a real provider restore rehearsal and incident drill; current successful rehearsal uses synthetic local data only.
- Resolve or formally assess the compatible Expo/toolchain advisory blocker; configure maintained scanning in CI with reviewed fixture exceptions and build/scan the runtime container, including native sharp/fonts/OS packages. Do not publish development servers.
- Actual phones/native builds, real zoom, assistive technology, Safari extreme-right scrim behavior and Firefox runtime still require verification. Keep online payments off; payment test events here were synthetic.

No source was pushed or deployed. Passing local tests does not establish that the application or its unverified infrastructure is fully secure.

## Guidance consulted

Retrieved through Context7 on 8 October 2026 and checked against installed code/docs where applicable:

- [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): allowlisted raster types, actual bytes, size limits, generated names and image rewriting.
- [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy), plus installed `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`: nonce propagation requires dynamic rendering; development eval allowances do not belong in production.
- [Sharp output API](https://sharp.pixelplumbing.com/api-output/): bounded processing timeout and default metadata removal; timeout starts when libvips processes the image, so job concurrency also matters.
- [Twilio Verify Fraud Guard](https://www.twilio.com/docs/verify/preventing-toll-fraud/sms-fraud-guard), [Geo Permissions](https://www.twilio.com/docs/verify/preventing-toll-fraud/verify-geo-permissions), [Service Rate Limits](https://www.twilio.com/docs/verify/api/service-rate-limits).
- [OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits) and [rate limits](https://developers.openai.com/api/docs/guides/rate-limits): project isolation, separate notification thresholds and blocking spend limits.
- Expo guidance and installed SDK 55 CLI middleware ordering: the documented Metro enhancement hook does not cover this project's outer HTML handler. Actual responses are tested, and production hosting headers are explicit.

## Final local handoff — 9 October 2026

Both final browser suites passed 42/42 sequentially, without retries or skips; recorded pages have zero uncaught errors and zero View text-node warnings. Firefox was rechecked after the suites: installed `firefox-1543` exits before app navigation with **“Could not find profile folder”** (`firefox-launch.log`). No Firefox application result is claimed. Physical phones/zoom, screen readers and the extreme-right Safari scrim remain separate manual gaps.

Only the additive `20261008180000_security_hardening` migration was applied to development. Before/after counts: 6 users, 8 products, 0 orders, 0 quotations, online payments false; no existing product images needed migration. No development reset/seed occurred. The managed API, owner and customer apps were safely restarted; all three return HTTP 200. The final read-only smoke checks owner sign-in, TEST catalogue, correct localhost API routing, active headers and no uncaught browser errors. Review at http://localhost:3000 and http://localhost:8081.

Staging is **not yet cleared for public use**: the provider/storage/proxy/backup/alert/container/SDK/device gates above remain explicit. Keep the review supervised, local and COD-only until those gates and business defaults are approved and verified.

### Maintained secret-scan follow-up

Secretlint quick-start **13.0.7** (recommended rules) scanned all 162 tracked/unignored source files and the patches of all **3 locally available Git commits**, without adding a dependency. It reported five current-tree and three history database-connection-string matches. Each was reviewed: explicit staging placeholders, the intentional loopback-only local-development PostgreSQL credential template, isolated CI PostgreSQL credentials, and the local `.env.example`. No unreviewed provider/production secret was identified. The local-development and CI credentials are intentional fixtures and must never be reused for staging. Evidence: `secretlint-final.json`, `secretlint-triage.json`, `secretlint-history.json`, `secretlint-history-findings.json`, and tool metadata. Values are masked. Unavailable remote refs/provider-side key history were not inspected.

Exact maintained scanner commands (default masking stays enabled):

```sh
git ls-files --cached --others --exclude-standard -z | xargs -0 npx --yes @secretlint/quick-start@13.0.7 --no-glob --format=json --output=.local/security-hardening/secretlint-final.json
git log --all -p --format= | npx --yes @secretlint/quick-start@13.0.7 --stdinFileName=git-history.patch --format=json --output=.local/security-hardening/secretlint-history.json
```

Review JSON findings rather than trusting quick-start's exit status alone: this version returned zero even with reported matches. The repository's small scan is an additional CI check, not a substitute for maintained rules and reviewed fixture handling.
