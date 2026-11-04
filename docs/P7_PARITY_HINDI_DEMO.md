# Phase 7: wave 2, website parity, Hindi catalogue and demo kit

16 October 2026. Branch `codex/p7-parity-demo` (draft PR #13), commits `6cda358..3b8ee7f`
(13 commits, 55 files, +4,422/−91). Written on 17 October from `git log` and the code; nothing
here was deployed.

## What changed

- **Feature parity list.** `packages/shared/src/features.ts` names every customer feature;
  `features.test.ts` fails if a feature lacks a test on the app or the website.
- **Website account.** Edit profile, signed-in devices (sign out one or all others), account
  deletion with a typed confirmation, and a per-order WhatsApp share that leaves out the address
  and phone. The website is no longer read-only: it has basket, COD checkout, orders, quotes
  and account pages.
- **Hindi catalogue.** Products gain `nameHi` and `descriptionHi` (migration
  `20261017090000_product_hindi`, with a trigram search index); `packages/shared/src/product-text.ts`
  shows Hindi names and unit words.
- **Demo kit.** `npm run demo -- prepare|reset|snapshot|restore` (refuses anything but a
  `_test` database or `DEMO_TARGET=staging`) and the read-only `npm run demo:preflight`.
- **Docs.** New [TESTING_GUIDE.md](TESTING_GUIDE.md), [MANUAL_SETUP.md](MANUAL_SETUP.md),
  [DEMO_SCRIPT.md](DEMO_SCRIPT.md) and the Hindi desk guide [FAMILY_GUIDE_HI.md](FAMILY_GUIDE_HI.md).
- **Review fixes.** Staging restore needs `--runtime-role`; `DEMO_PHONES` limits demo SMS to
  three family numbers; unit labels for cu ft and m².

## Tests added

About 32 new cases: `apps/api/test/catalogue-hindi.test.ts`, `apps/storefront/lib/account.test.ts`,
`packages/shared/src/{features,product-text}.test.ts`, `scripts/demo.test.mjs`,
`tests/{app-account,catalogue-hindi,storefront-account,storefront-orders}.spec.ts`.

## Evidence

GitHub Actions on `3b8ee7f`: Verify run 38944184916 ✅ and Android app journeys run
38944185153 ✅.
