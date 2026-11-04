# Phase 1: App foundations

Branch `codex/p1-app-foundations` (from Phase 4, `198814b`). Goal: real Android testing on
this Mac, one shared code layer for the app and website, and quality tooling, before the
Phase 2 app rebuild.

## Result

| Item                             | Status                       | Evidence                                                                                                                         |
| -------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Android toolchain                | Done                         | JDK 17, SDK 35/36, emulators `shiv_budget_api29` (Android 10) and `shiv_modern_api35` (Android 15), Maestro 2.11                 |
| Release APK runs on Android      | Done                         | `APP_VARIANT=local` release build; installs and launches without crashing                                                        |
| Shared layer                     | Done                         | `packages/shared/src/{i18n,labels,errors,quantity,dates,rates,theme,cart}.ts`, used by the website; the app adopts it in Phase 2 |
| Untranslated error codes blocked | Done                         | `apps/api/test/error-codes.test.ts` scans the API for every thrown code                                                          |
| Crash reporting                  | Done, off until a DSN is set | Sentry, native-only, no personal data                                                                                            |
| Performance baseline             | Done (emulator)              | `npm run android:baseline`                                                                                                       |
| Maestro smoke flows              | Done                         | 3/3 pass on Android 10 (twice in a row) and Android 15                                                                           |
| Existing suites still green      | Done                         | Playwright 77/77 (website, owner desk, app web build; Chrome + WebKit), lint, typecheck, shared tests, security scan             |

## Release-blocking bugs found and fixed

These only appear in a real Android build. Expo web and its Playwright journeys could not
catch them.

1. **No request ever left the Android app.** `fetch` was given `AbortSignal.timeout()`,
   which React Native does not have. The call threw before sending, and every screen said
   "Cannot reach the store". Fixed with an `AbortController` timer, and a lint rule now bans
   `AbortSignal.timeout/any` in app and shared code.
2. **The release app crashed on launch.** `@vector-icons` pulled in `expo-font` 57, which
   is built for a newer Expo. Pinned to the SDK 55 line, with an npm override.
3. **Release builds could not reach the laptop API.** Android blocks plain HTTP in release
   builds. Local QA builds (`APP_VARIANT=local`) now permit HTTP to `localhost` and
   `127.0.0.1` only. A clean production prebuild has no such exception (checked).

## Performance baseline

Release build, local API, median of 5 cold starts. Both emulators run headless with a
software GPU.

| Measure                                      | Android 10 (1080×1920) | Android 15 (1080×2400)               | Target     |
| -------------------------------------------- | ---------------------- | ------------------------------------ | ---------- |
| Cold start to first frame                    | 305 ms                 | 321 ms                               | —          |
| Cold start to first API request (JS running) | 616 ms                 | 678 ms                               | < 2,500 ms |
| Product list scrolling                       | 0% janky, p90 14 ms    | 55% janky, p90 61 ms (inconclusive*) | < 5% janky |
| Memory (PSS)                                 | 126 MB                 | 112 MB                               | —          |
| APK, universal (4 CPU types)                 | 72.4 MB                |                                      | —          |
| APK, one phone (arm64 estimate)              | ≈ 31.5 MB              |                                      | < 30 MB    |

\* The Android 15 emulator draws with CPU-emulated Vulkan (lavapipe) at a larger screen
while the other emulator was running, so its scroll figure measures the emulator as much as
the app. The list is a plain ScrollView with heavy cards, though, so Phase 2's virtualised list
and compact cards are needed either way.

The emulators run on Apple silicon and are much faster than a ₹8,000 phone. These numbers are
a regression reference only. Phase 3 measures the targets on real budget phones.

## Found for Phase 2 (not fixed here)

Found while writing the smoke flows on a 360 dp screen:

- **Products:** no product is visible without scrolling; header, search and filters fill
  the first screen. Each card is about 1.5 screens tall, so 8 products are about 7 screens.
- **Product page:** "Add to cart" is below the fold.
- **Sign-in:** "Verify & continue" is below the fold, pushed down by the staff passphrase
  field (removed in M1).
- **Back from a product** clears the search, so the shopper loses their place.
- **Spec lines** ("All brands · All stock", grade/pack) use Android's monospace system font.
  It looks technical and won't match the shop theme; it gets a theme font in Phase 2.
- **APK size:** about 1.5 MB over target. Trim the bundled icon fonts and enable resource
  shrinking.

The smoke flows scroll to these buttons today. Phase 2 removes those scrolls, so the flows
become tests of the tap and scroll budgets.

## How to run

See `docs/LOCAL_TESTING.md` → "Android app on an emulator or USB phone".

## Waiting on you

- Merge PRs #1 → #5 into `main`, in order, with merge commits. My merge attempt was blocked
  as needing human review.
- Sentry account: create a free project (React Native) and send the DSN. For readable stack
  traces also send an auth token, org and project slug. These are build variables, never
  committed.
- Started earlier, slow to complete: Play Console identity verification, 12+ testers' Gmail
  addresses, Meta Business + WhatsApp Business number, certificate photos.
