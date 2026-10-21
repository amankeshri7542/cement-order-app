# Master Plan v2 — Phase 3: customer app polish and Play Store

This report uses the 20 October 2026 master plan numbering (§7). It is delivered on `codex/owner-dashboard-phase2`, after Phases 1 and 2. Three choices were confirmed before the work started and shaped it:

1. **Look:** the plan's colours (warm paper, construction amber, steel navy) are applied to the app, the website and the owner desk through the shared tokens; current layouts and Teko headings stay.
2. **Navigation and strings:** the hand-rolled router and the inline `t('English', 'हिन्दी')` pairs stay. The app has seven tabs and detail screens and works; `expo-router` and moving every string into `@shiv/i18n` would be a rewrite with no customer-visible gain.
3. **Website:** extended from `apps/storefront` in Phase 4, not a new app.

## What changed

**Look (all three surfaces).** `packages/shared/src/theme.ts` carries the new palette (ground `#F6F4EE`, ink `#202523`, amber `#E0A42B`, navy `#173345`, plus `accentInk` for amber used as text or an icon on a light ground, `onSolid` and `blue`). `scripts/theme-css.mjs` writes the CSS variables for the website and owner desk (`npm run theme:css`; `npm run test:local` fails on drift). Contrast tests cover every text/ground pair that is used. `scripts/make-app-icons.mjs` now reads the same palette and writes the app icon, adaptive icon, splash, the website's icons and the Play feature graphic. `app.json` splash and adaptive-icon colours follow.

**Offline and weak signal (plan task 4).**

- `cache.ts` keeps JSON in AsyncStorage (`shiv_cache_v1:*`; the browser build uses the same keys in `localStorage`): the rate list, the first page of each material view (category/availability/sort; searches are not kept) and, per signed-in user, recent orders. A saved copy is shown at once and replaced by the store's answer; it never overwrites a live answer that arrived first. Copies older than 14 days are dropped. Signing out, forgetting the account and deleting it erase everything.
- A banner says "Cannot reach the store. Check your internet connection." and, in a second line, how old the prices on screen are ("Showing prices saved 6 minutes ago."). The rate board's "checked" time is the time the copy was saved, not the time it was read. The material list repeats the age under its own notice. Reconnecting refreshes by itself; the banner cleared within four seconds of switching the emulator's network back on.
- `retry.ts` and `getWithRetry` retry a GET three times (1, 2, 4 s, each try limited to 10 s) and only for failures that can be transient (no answer, 502/503/504); never a 4xx and never a POST. Retries stop at once when the phone says it is offline, and any reply from the store counts as proof that it is not. A background refresh gets one try.
- `@react-native-community/netinfo` decides "online". On Android it trusts the system's own internet check (older phones fall back to our own `/health`, never a third party); on the browser build it reads only the online/offline events (NetInfo treats "no check" as "no internet" there).
- Server events already ran only while the app is in front; order detail now polls every 60 s, not 15.
- AsyncStorage rather than MMKV: MMKV is a second native module to keep in step with each Expo SDK for data this small (a few JSON documents), and AsyncStorage 2.2 is part of Expo 55's tested set.

**Sign-in (task 5).**

- The "Resend code" button counts down from `otpResendSeconds = 30`, a constant in `@shiv/shared` that the API uses too, so the button never promises a code the server refuses. The server's cooldown was 60 s and is now 30 s; the per-number and per-address hourly limits around it in `auth.ts` are unchanged.
- Android SMS Retriever (`react-native-otp-verify` 1.2.0, a legacy native module that works through the new-architecture interop layer). It is loaded only on Android, so the web export is untouched; a phone without Google Play services simply keeps the typed code. No SMS permission is requested. The provider's message must start `<#>` and end with the app's 11-character hash; `node scripts/sms-app-hash.mjs <certificate>` prints it. Checked on the emulator: after the code was requested, a message worded that way, carrying the hash printed for the debug build's key, made the app fill the code and sign in with no typing.
- There is no staff sign-in in the app (a staff number gets a plain "use the owner desk" message).

**Checkout and order text (task 6).** Delivery-day chips were already in place, and checkout is one screen after the basket, so there is no step indicator to fix. "Min/step" is gone: a pack reads "1 bag = 50 kg · order 1, 2, 3 bags…" through `pack.ts` (tested). A "Prefer to order by phone?" card with Call and WhatsApp sits on Home above the rates and under every empty state; it appears only when the shop's number is approved in `apps/api/src/public-content.ts` (`contactApproved`), so no unapproved number is ever shown. The order screen shows the confirmation and "what happens next" first, then asks once about notifications.

**Notifications (task 7).** `apps/api/src/notify.ts` is the only place that words a customer notification: in the language kept for the account, order number and status only (no address, amount or name). Order, quote, payment and rate-card call sites use it. The app now tells the store the language chosen on the phone every time someone signs in (a new account starts as English on the server, and the name step, which used to be the only place it was sent, can be skipped). The app asks once per person, right after the first order on Android, whether to turn notifications on; the choice is remembered for that person, so the next person to sign in on the same phone is asked afresh and is not registered for notifications they never chose. The phone's token is registered when the answer is yes and refreshed at each sign-in of someone who said yes. With no signal the question is not counted as answered. Account keeps the switch. Delivery needs Firebase (see `docs/MANUAL_TASKS.md`); without it the app says so plainly and every update is still in Orders.

**Images and lists (task 3).** `expo-image` with `cachePolicy="memory-disk"` and `recyclingKey` replaces React Native's `Image` (photos stay on the phone after the first look). The catalogue and orders lists stay on `FlatList`; see "Decisions" below.

**Android build (task 10).** `app.json` sets compile and target SDK 36 and build tools 36.0.0 explicitly, `allowBackup: false`, and the splash and adaptive-icon colours. `eas.json` has `preview`, `closed-test` and `production` profiles and a Play submit profile that reads `apps/mobile/play-service-account.json` (git-ignored). The release build refuses a non-HTTPS API address on purpose.

**Play Store (task 8).** `docs/play-store/LISTING.md` has the Hindi and English text, the Data safety answers (now including what stays on the phone, the push token and the SMS Retriever), the website's privacy and deletion addresses (live in Phase 4) and the eight screenshots, taken in Hindi and in English with one Maestro run (`apps/mobile/.maestro/screenshots/store.yaml`).

## Independent review: findings and what was done

A reviewer who had not seen the work read the whole change and found eleven defects (no crash and no money risk). Each is fixed, and each has a test or a check where one is possible:

| Finding                                                                                                                                           | Fix                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notifications went out in English to most app customers (the server's language column defaults to English and the app never sent its own)         | The app sends the chosen language at every sign-in; a Playwright test proves a Hindi choice reaches the account, including when the name question is skipped                                                                                                            |
| A second customer could see the previous customer's orders on the Orders tab after an account switch                                              | Screens that show one person's details (Orders, order detail, Account, Addresses, Quotes, Checkout) are keyed by who is signed in, so they start empty for the next person                                                                                              |
| A saved copy looked live while the first request was still in flight (up to about 87 s on a slow network)                                         | The rate board says "saved 6 days ago" whenever it shows a copy; the Materials list, Orders and an order's page say they show a saved copy once the store has been slow for 1.5 seconds; each try for a read now gives up after 10 s, so four tries stay under a minute |
| Saved orders (addresses, phone numbers) survived a session ended elsewhere or an account deleted on the website                                   | They are erased when the session ends, when the saved sign-in is refused, and when a copy is found expired                                                                                                                                                              |
| Notification choice followed the phone, not the person; a failed registration was reported as "not available in this build"                       | The choice is stored per person; no signal is reported as no signal and the question comes back                                                                                                                                                                         |
| Android could say "offline" while the store was reachable (VPN, networks that block Google's check), pinning the banner and switching retries off | Any reply from the store clears "offline"                                                                                                                                                                                                                               |
| The sign-in countdown ran for the rest of the session; a late SMS could sign someone in after the sheet was closed                                | The countdown stops at zero, and closing the sheet cancels the sign-in and the SMS listener                                                                                                                                                                             |
| The SMS library logs every message it receives, including the code, in release builds                                                             | Release builds strip debug, verbose and info logging (an R8 rule, with a test)                                                                                                                                                                                          |
| "1 cu ft = 100", "12 mms" and similar wrong sentences from the new pack text on the shop's real units                                             | A "1 bag = 50 kg" line and unit names in the order rule appear only for container units (bag, bundle, piece, box, …); every other unit is shown as the shop wrote it. Tests cover the seed units                                                                        |
| The approved shop contact was fetched once per app run                                                                                            | Asked for again after ten minutes whenever a screen that shows it opens; a failed refresh keeps the last good answer                                                                                                                                                    |
| The new website icons were not tracked                                                                                                            | Added with this commit                                                                                                                                                                                                                                                  |

## A launch bug found and fixed

Maestro flow 06 failed after flow 05: Home opened scrolled half way down the page. The cause was not in the page. When an Android phone is not in touch mode (a keyboard is attached, a test or `adb` started the app, or a key was pressed since the last touch), the first view to announce itself as focusable gets the first focus. That was a brand label at the bottom of Home, and React Native's scroll view scrolls to whichever child takes focus. A native focus listener showed it (a focusable text view at the foot of Home, then the header button). `Screen` (`ui.tsx`) now keeps a new screen at the top until the customer first touches it. This also makes the sequence of Maestro flows repeatable. A phone in normal touch mode was never affected, so the effect on real customers should be small, but keyboard and Samsung DeX users would have seen it.

## Plan coverage (§7)

| Plan item                                                                                            | Status                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Navigation: keep the router if screens ≤ 8, else `expo-router`                                    | Kept (decision above): seven tabs and detail screens, Back handled, tested on Android                                                                 |
| 2. Full i18n through `packages/i18n`, language screen, localized status, API errors                  | Language screen, localized status and API errors were already in. The inline pairs stay by decision; push templates use `push.*` keys in `@shiv/i18n` |
| 3. Tokens, `expo-image` memory-disk, FlashList, no root `ScrollView`                                 | Tokens and `expo-image` done. FlashList not adopted (below). Screens use one `ScrollView` each, lists use `FlatList`                                  |
| 4. Offline cache, "last updated" banner, NetInfo, GET retry 3× 1/2/4 s, SSE foreground, polling 60 s | Done (AsyncStorage instead of MMKV)                                                                                                                   |
| 5. OTP countdown 30 s, SMS Retriever, remove staff UI                                                | Done; the retriever needs the provider's wording and the Play signing key's hash to work in production                                                |
| 6. Date chips, no "Min/step", step indicator, idempotency copy, call/WhatsApp card                   | Done (checkout is a single screen, so there is no step indicator)                                                                                     |
| 7. Push after the first order, FCM registration, Hindi templates                                     | Done in code; delivery needs Firebase credentials (manual)                                                                                            |
| 8. Play Store listing, Data safety, deletion and privacy URLs, screenshots                           | Text, answers and a draft screenshot set done; URLs go live with Phase 4; the screenshot set must be re-taken with the real catalogue                 |
| 9. Closed test with 12 testers for 14 days                                                           | Manual: needs a Play Console account and testers                                                                                                      |
| 10. `eas build` AAB, `eas submit`, API 36                                                            | Configured (SDK 36, profiles, submit path). Building needs an Expo login; the local release build compiles with SDK 36                                |

## Decisions with their evidence

- **FlashList not adopted.** On the project's emulator the scroll test reports between 5% and 32% janky frames from one run to the next on the same build (software graphics, shared CPU), so it can neither show a problem nor clear one. A real ₹8k phone is the only fair test and is on the manual list; if the catalogue judders there, the list in `Catalogue` and `Orders` is the only code to change.
- **AsyncStorage, not MMKV** (above).
- **One shared OTP interval**, so the app and the API cannot drift apart again.
- **No new environment variables** in the API. For tests, `EXPO_PUBLIC_RETRY_SCALE` shortens the retry waits in the browser build (`playwright.config.ts` sets `0.01`); it is unset in real builds.

## Measured on the emulator (Android 10, 1080×1920, release build)

| Measure                         | Phase 2      | Phase 3               | Target     |
| ------------------------------- | ------------ | --------------------- | ---------- |
| Cold start to first frame       | not recorded | 391 ms (median of 5)  | < 2,500 ms |
| Cold start to first API request | 679 ms       | 473 ms                | < 2,500 ms |
| One arm64 phone's APK           | ≈ 25.2 MB    | ≈ 27.1 MB             | < 30 MB    |
| Memory (PSS)                    | 114 MB       | 111 MB                | —          |
| Scrolling, janky frames         | 2.6%         | 5% to 32% (see above) | < 5%       |

The APK grew by about 1.9 MB (expo-image, AsyncStorage, NetInfo, the SMS module). Phase 3's cold start is faster in part because first paint no longer waits for the network: saved rates are drawn first.

Maestro on the emulator: all six flows pass (browse, language, guest order with a new customer, tap budgets, quote/cancel/pincode, compare and assistant). Checked by hand on the same emulator: cold start with the radios off shows the saved rates and materials with their age and recovers by itself; the SMS auto-fill signs in without typing.

## Configuration and migrations

None for the API: no new environment variable, no migration. The app needs `EXPO_PUBLIC_API_URL` (HTTPS) and `EXPO_PUBLIC_PRIVACY_URL` in the EAS environments, `GOOGLE_SERVICES_JSON` as an EAS file secret and, for the API, the existing `FIREBASE_*` settings; all are listed with steps in `docs/MANUAL_TASKS.md`.

## Verification

Run on 21 October 2026 on the tree that was committed (Node 24.19, PostgreSQL 16 on loopback, Android 10 emulator). Database and browser suites ran one after another because Playwright's setup resets the shared test database.

- `npm run lint`, `npm run typecheck`: clean across all workspaces.
- Unit: 120 API (115 before; the new notification tests are the difference), 19 owner desk, three i18n checks, 32 shared (palette contrast and drift tests included), 33 mobile (retry, age, countdown, pack wording, SMS code extraction, release config including the log-stripping rule), 16 storefront, 21 local-tooling (theme CSS matches the tokens; the SMS hash script).
- `npm run test:integration`: 152 real PostgreSQL tests. `test:workflows`: 20. `test:bootstrap`: passed. The API and database are unchanged by this phase, so no migration and no drift check was needed.
- `npm run build`: all workspaces, including the app's web export and both Next.js sites. `npm run security:scan`: 901 files, no findings. `npm audit --omit=dev` on the API, shared, i18n and storefront: zero advisories.
- Browser (`playwright.qa.config.ts`, one engine at a time): Chromium 131 specs, WebKit 131 passed and one skipped by design (the service-worker check runs in Chrome only). One Chromium spec from Phase 2 (`owner-phone-order`, "switching a credit limit override back to COD") failed once with "Fetch response has been disposed", a race in the test's own held request that does not involve this phase; the test now ignores that disposal, and it passed three times in a row afterwards and in the WebKit run. New browser coverage: seven offline and saved-copy specs (`app-offline.spec.ts`), and the account keeps the language chosen before sign-in (`first-run.spec.ts`).
- Android emulator, release build: all six Maestro flows pass on the final build (browse, language, guest order, tap budgets, quote/cancel/pincode, compare and assistant). By hand: cold start with the network off shows saved rates and materials with their age and recovers within four seconds of the network returning; a formatted SMS signs in by itself; the Play screenshot flow runs end to end in both languages.

## Not done and limits

Nothing was built with EAS, uploaded to Play, sent through a real SMS or Firebase, or tried on a real phone. Those need accounts and hardware: the manual list says exactly what to press. The scroll-smoothness and 3 GB RAM targets are unmeasured for the same reason.
