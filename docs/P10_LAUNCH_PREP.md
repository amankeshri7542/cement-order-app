# Phase 10: launch preparation

17–18 October 2026. Branch `codex/p10-launch-prep`, based on `codex/p9-teko-ratecards`
(`beefb65`). Nothing was deployed, bought or sent to a real provider. Online payments stay off.

✅ = proved by a command run for this report · ⏳ = pending · ⛔ = blocked on the owner,
family or a provider.

## What changed

| Commit    | Change                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `de5b923` | ESLint skips agent worktrees under `.claude/` (they made `eslint .` report 258 false errors on this Mac; CI never had them)                                                        |
| `1258c26` | `render.yaml`: all three services deploy from `main` instead of the stale `codex/p5-staging-setup`; staging template lists `OTP_PAUSED`/`DEMAND_PAUSED`; a test keeps them in step |
| `b1e0936` | Test fix: the catalogue paging journey pointed at a row the virtualised list could swap out (one WebKit failure, see below)                                                        |
| `4c7e973` | Fix (P1): booking-limit refusals no longer leave checkout stuck on "could not confirm the result" in the app and on the website                                                    |
| `8f2e075` | Fix (P1): a pasted `91…`/`+91 …` number no longer sends the sign-in code to a different number in the app and on the owner desk                                                    |
| `697f09f` | Dependencies: `xcode` gets `uuid@11` (npm audit 34 → 27)                                                                                                                           |
| docs      | P6–P9 reports, this report, [OPERATOR_CHECKLIST.md](OPERATOR_CHECKLIST.md), README, release checklist gate rows                                                                    |

## Proof

Run on this Mac, Node 22.23.2 (the CI version), against a private loopback database
`shiv_cement_p10_test`. Final run on head `697f09f`, one suite at a time.

| Check                                                | Result                                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                             | ✅                                                                                                                                 |
| Prisma migrations vs schema (drift check, as CI)     | ✅ no difference                                                                                                                   |
| `npm run lint`, workspace `typecheck`                | ✅ (lint needed `de5b923` on this Mac)                                                                                             |
| API unit (`npm test`)                                | ✅ 109/109                                                                                                                         |
| Shared / mobile / storefront / local scripts tests   | ✅ 23/23 · 7/7 · 14/14 · 19/19                                                                                                     |
| API integration / workflows / bootstrap              | ✅ 116/116 · 20/20 · PASS                                                                                                          |
| Playwright Chrome (`playwright.qa.config.ts`)        | ✅ 110/110 (includes the new desk paste test)                                                                                      |
| Playwright WebKit                                    | ✅ 109 passed, 1 skipped (Chrome-only alert-worker check), 0 failed                                                                |
| `npm run build` (all workspaces)                     | ✅                                                                                                                                 |
| Production headers/CSP checker                       | ✅ PASS (self-test and Chrome/WebKit run)                                                                                          |
| `npm run security:scan`                              | ✅ 0 findings in 471 files                                                                                                         |
| `npm audit --omit=dev` API, shared, storefront, desk | ✅ 0 vulnerabilities                                                                                                               |
| `npm audit` whole repo                               | 27 (22 high, 5 moderate), all in the Expo/React Native toolchain; see below                                                        |
| Restore rehearsal (`npm run test:restore`)           | ⏳ not runnable here: the script connects over TCP and this Mac's test login has no working password. CI ran it green at `beefb65` |
| GitHub Actions for `beefb65` (p9 head)               | ✅ Verify 38957327500 and Android app journeys 38957327569                                                                         |
| GitHub Actions for the p10 head                      | ⏳ runs when the PR opens                                                                                                          |

Baseline before any change (head `beefb65`): the same counts except API unit 108, shared 19
(new tests were added since), Chrome 109/109, WebKit 107 passed, 1 failed, 1 skipped.

**The one WebKit failure.** `customer-recovery.spec.ts` › "catalog refresh retains loaded
pages and search selection" failed once with "element is not attached" when it scrolled to
the last row of the virtualised catalogue. It passed 5 of 5 times when run alone, and in CI.
The test grabbed whichever row was last while the list was still rendering rows in batches.
It now hovers the first row (always rendered) before scrolling with the wheel; no app code
changed. The skipped WebKit test is the alert-worker check, which runs in Chrome only by
design.

## render.yaml

- `branch:` is now `main` for the API, desk and shop. Merge this PR first; importing earlier
  would deploy code without Phases 6–10.
- Every API variable in `render.yaml` is a real config key and appears in
  `apps/api/staging.env.example` (now tested). Nothing the API needs to boot is missing.
- Optional, not in `render.yaml` on purpose: `WEB_PUSH_*` (set both keys or neither, or the API
  refuses to start), `NEXT_PUBLIC_ASSET_ORIGIN` (only with R2), assistant limits (defaults).
- `NEXT_PUBLIC_API_URL` is compiled into the desk and shop at build time: set it before the
  first Render build.

## Dependency audit

| Package (high)                            | Where it is                                                         | In production?                                                     | Fix                                                              |
| ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `braces` ≤3.0.3 (GHSA-vfj7-8cjw-p6xm)     | `micromatch` → Metro, Jest transforms (Expo/RN)                     | No. Build tooling only; not in the exported app bundle (checked)   | None released (3.0.3 is the latest)                              |
| `node-forge` ≤1.4.0 (GHSA-86w9-cpqp-85rv) | `@expo/code-signing-certificates` (Expo CLI)                        | No. Expo CLI on the build machine; not in the app bundle (checked) | None released (1.4.0 is the latest)                              |
| 20 more highs                             | `expo`, `react-native`, `metro*`, `@jest/*`, `@sentry/react-native` | Flagged only because they depend on the two above                  | npm suggests `expo@44` (a forced downgrade) or RN 0.88; not done |

Fixed: `uuid` <11.1.1 under `xcode` (moderate, 7 advisories in the chain). Remaining moderates:
`sprintf-js` ≤1.1.3 via `js-yaml@3`/`argparse@1` in Jest's coverage tooling, no fixed release.
The API, desk, website and shared package have no advisories. Re-check when Expo SDK 56 ships.

## Gap scan

Read-only review of the API, desk, website and app for defects that tests do not cover
(money, stock, auth, IDOR, error handling). No P0: prices, totals, stock and payment state are
server-side; stock is restored once; every customer id route is scoped to the user.

| #   | Rank | Finding                                                                                                                                                                                       | Where                                                                                                     | Status                                                      |
| --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | P1   | Booking-limit refusals (`DEMAND_REVIEW_REQUIRED`, `DEMAND_PAUSED`, `RESOURCE_LIMIT`) shown as "result not confirmed"; checkout stuck up to 5 min                                              | `apps/mobile/src/checkout.tsx`, `apps/storefront/components/checkout.tsx`                                 | ✅ fixed `4c7e973`, tests                                   |
| 2   | P1   | Pasted `919876543210` becomes `9198765432`: the code goes to a stranger (app and desk)                                                                                                        | `apps/mobile/src/account.tsx:121`, `apps/admin/app/page.tsx:1282`                                         | ✅ fixed `8f2e075`, tests                                   |
| 3   | P1   | The store-wide daily SMS budget (200) is a kill switch: about 7 IPv4 addresses (or one IPv6 host, no /64 grouping) can stop sign-in for everyone for up to 24 h                               | `apps/api/src/security.ts:58-67,100-110`, `abuse.ts:40-45`, `config.ts:79`                                | ⏳ needs your decision (MANUAL_SETUP D1 accepted this risk) |
| 4   | P1   | Same for orders (audit F30): place and cancel COD orders from a few accounts until the store-wide order budget (500/day) stops all ordering                                                   | `apps/api/src/orders.ts:397-401`, `abuse.ts:88-94`                                                        | ⏳ needs your decision                                      |
| 5   | P2   | Staff passphrase can be tested without the SMS code by response time (wrong passphrase replies before the Twilio check)                                                                       | `apps/api/src/auth.ts:244-256`                                                                            | ⏳ medium change                                            |
| 6   | P2   | Anyone can keep a known number's per-phone send cap full (5/hour), locking that person out, including staff                                                                                   | `apps/api/src/auth.ts:176-183`                                                                            | ⏳ medium change                                            |
| 7   | P2   | A lost refresh reply retried after the 5-minute grace signs the customer out and logs a false theft event                                                                                     | `apps/api/src/auth.ts:310-327`, `apps/mobile/src/api.ts:54-57`                                            | ⏳ medium change                                            |
| 8   | P2   | Suspected: every order/quote/review updates one shared budget row inside a serializable transaction, so a burst of checkouts may get 409s. Not measured                                       | `apps/api/src/abuse.ts:88-94`, `db.ts:32-49`                                                              | ⏳ needs a load test                                        |
| 9   | P2   | Website guest basket keeps old prices from `localStorage`; after sign-in the review shows no "price changed"                                                                                  | `apps/storefront/components/commerce.tsx:23-28`                                                           | ⏳ small–medium                                             |
| 10  | P2   | Website quote page clears the consent tick every 20 s poll and on focus                                                                                                                       | `apps/storefront/components/quotations.tsx:120`                                                           | ⏳ small                                                    |
| 11  | P2   | Private drafts (notes, company, GSTIN) stay in browser storage after website sign-out, and in SecureStore after app account deletion                                                          | `apps/storefront/components/commerce.tsx:355-371`, `apps/mobile/src/account.tsx:475-479`                  | ⏳ small                                                    |
| 12  | P2   | Malformed request bodies (bad charset, unknown encoding, aborted body) return 500 instead of 400/415                                                                                          | `apps/api/src/http.ts:92-113`                                                                             | ⏳ small                                                    |
| 13  | P2   | Order and quote numbers take the year from the server clock (UTC): 00:00–05:30 IST on 1 January gets last year                                                                                | `apps/api/src/orders.ts:59-60`                                                                            | ⏳ small                                                    |
| 14  | P2   | Unknown `categoryId` on a staff product save returns 500; desk upload errors show a raw parse error; website restores a past delivery date; unused `@aws-sdk/s3-request-presigner` dependency | `catalog.ts:190`, `admin/lib/api.ts:71`, `storefront/components/checkout.tsx:76`, `apps/api/package.json` | ⏳ small                                                    |

Items 1–2 were verified and fixed here, each with a test that fails on the old code. Items 3,
4, 10 and 13 were spot-checked in the code for this report; the rest come from the review's reading of
the code and were not reproduced.

## Still pending

Everything in [OPERATOR_CHECKLIST.md](OPERATOR_CHECKLIST.md): domain, Render, Twilio Verify,
database roles, EAS build, Play closed test, family content C1–C10 and physical-phone rows
P1–P8 and D1–D9 in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). No real-phone or provider
result is claimed anywhere in this report.
