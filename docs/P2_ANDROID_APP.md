# Phase 2: Android app complete, Hindi-first

Branch `codex/p2-android-app` (from Phase 1). Goal: the Android app does everything the
website does, in Hindi first, in one shop theme, with the fewest taps, and runs smoothly on a
budget phone.

## What a customer now sees

- **First launch:** "अपनी भाषा चुनें · Choose your language" (Hindi first). Every screen follows the
  choice; the top bar switches it in one tap.
- **Home:** the latest order (Track / Order again) for returning customers, then today's rates
  board (मौजूदा भाव), quick actions (all materials, bulk quote, Shiv Sahayak, compare),
  categories, a pincode check that runs at six digits, and the brands at the counter.
- **Top bar on every screen:** call, WhatsApp and language, each one tap. **Bottom bar:** Home ·
  Materials · Basket · Orders · Account.
- **Materials:** compact rows (about 100 dp: four or more per screen) with Add. Once added, a row
  shows a typable quantity bar. Search, filters and scroll are kept when you go Back.
- **Basket:** works before signing in (saved on the phone). Delivery details sit inline with
  sensible defaults: saved address, tomorrow, cash on delivery. Dates are chips, not typed.
- **Review:** loads by itself. "Place order · ₹total" is the consent. A price change needs a
  fresh tick and shows exactly what changed.
- **Orders:** status timeline, Order again, WhatsApp help, share summary, cancel while allowed.
- **Bulk quotes:** a three-step request (materials, site, date chips). Offers show freight,
  delivery terms and expiry, and each revision needs its own consent tick.
- **Compare** (up to three; warns when the selling units differ) and **Shiv Sahayak** (answers from
  the catalogue, Hindi voice input reviewed before sending).
- **Theme:** the website's ink-blue / clay / ivory palette and the "शिव" stamp. New launcher
  icon, themed icon, splash and Play feature graphic, all generated from code
  (`scripts/make-app-icons.mjs`).

## Tap budgets: measured on Android 10 by Maestro

| Job                             | Budget | Result                                                                |
| ------------------------------- | ------ | --------------------------------------------------------------------- |
| See today's rates               | 0 taps | 0, first screen                                                       |
| Call / WhatsApp                 | 1 tap  | 1, top bar on every screen                                            |
| Track latest order              | 1 tap  | 1, Home "Track"                                                       |
| Reorder                         | 2 taps | 1 to put the last order in the basket                                 |
| Product → COD order (signed in) | ≤ 4    | 4: Add, Basket, Review order, Place order                             |
| Bulk quote                      | ≤ 5    | 4 for a repeat request: Bulk quote, add material, (date preset), Send |

`apps/mobile/.maestro/` (4 flows, 4/4 pass): browse, Hindi first launch and restart, a new
customer's guest basket carried through sign-in to a placed order, and the budgets above.

## Plan items

| Item                                                                                                         | Done                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| M1 Staff passphrase and developer text removed; material tiles instead of "photo pending"                    | Yes                                                                                          |
| M2 Hindi error messages from the shared catalogue; non-JSON replies; session expiry signs out with a message | Yes                                                                                          |
| M3 Full Hindi via `t(en, hi)` (300+ strings, CI-checked); first-launch language chooser                      | Yes                                                                                          |
| M4 Guest basket, sent once via the idempotent `POST /cart/merge`                                             | Yes                                                                                          |
| M5 Date chips instead of typed dates (checkout and quotes)                                                   | Yes                                                                                          |
| M6 No list polling; order detail polls once a minute only while moving and on screen                         | Yes                                                                                          |
| M7 Per-revision quote consent                                                                                | Yes                                                                                          |
| M8 Rate board                                                                                                | Yes                                                                                          |
| M9 Compare                                                                                                   | Yes                                                                                          |
| M10 Shiv Sahayak on `POST /assistant`                                                                        | Yes                                                                                          |
| M11 Hindi voice input (`expo-speech-recognition`)                                                            | Yes; mic only when the phone has a speech service                                            |
| Release config: icon, splash, EAS profiles, remote version codes                                             | Yes; API URLs are `.invalid` placeholders until the domain is bought                         |
| `GET /client-config` plus a forced "update the app" screen                                                   | Yes                                                                                          |
| Play listing text and Data safety answers                                                                    | `docs/play-store/LISTING.md`; screenshots wait for the real catalogue                        |
| Awards & recognition section                                                                                 | Built and hidden; it appears once certificate wording is added to `apps/mobile/src/trust.ts` |

Not done as written:

- **FlashList:** built-in virtualised `FlatList` instead. Scrolling met its target, so no extra
  native dependency was needed.
- **`expo-image`:** product photos are not in the catalogue yet; revisit in Phase 7 with real
  photos.

## Bugs found on the phone and fixed

1. The keyboard hid what customers were typing (sign-in sheet, address form). Edge-to-edge
   Android ignores `adjustResize`; the app now avoids the keyboard itself, hides the tab bar
   while typing, and the keyboard's next/done keys walk the form.
2. A basket save finishing mid-typing could overwrite the quantity being typed.
3. Closing a detail screen silently disabled pull-to-refresh on the tab below.
4. "Track" was below the fold; the latest-order card now comes first.
5. "Add another address" opened a list instead of the form.
6. Offline on most screens showed nothing; a slim "can't reach the store · Retry" bar now
   appears everywhere.

## Quality evidence

| Check                                                            | Result       |
| ---------------------------------------------------------------- | ------------ |
| Maestro on the Android 10 budget emulator (release build, R8 on) | 4/4          |
| Playwright (website, owner desk, app web build)                  | 77/77        |
| API unit / integration / workflows                               | 99 / 78 / 20 |
| Shared tests (incl. Hindi completeness, dates, versions)         | 7/7          |
| App Hindi coverage (`npm test -w @shiv/mobile`)                  | Pass, in CI  |
| Lint, typecheck, security scan                                   | Pass         |

**Performance** (Android 10 emulator, median of 5; the emulator is faster than a budget phone,
so Phase 3 re-measures on real phones):

| Measure                         | Phase 1   | Phase 2                             | Target     |
| ------------------------------- | --------- | ----------------------------------- | ---------- |
| Cold start to first API request | 616 ms    | 679 ms                              | < 2,500 ms |
| Scrolling, janky frames         | 0%        | 2.6%                                | < 5%       |
| One arm64 phone's APK           | ≈ 31.5 MB | ≈ 25.2 MB (R8 + resource shrinking) | < 30 MB    |
| Memory (PSS)                    | 126 MB    | 114 MB                              | —          |

## For Phase 3 (hardening)

- Physical phones (Papa's, Chacha's, a 2–3 GB budget Android): start-up, scrolling, keyboard,
  TalkBack and the largest font size.
- Failure drills: flight mode mid-checkout, killing the app during review, slow 2G, permission
  denials.
- Maestro on CI (Android emulator runner) for every app PR.
- Rupee formatting: prices show paise (₹390.00). Decide with the family whether whole-rupee
  prices drop ".00" everywhere (website, app, owner desk together).

## Waiting on you

- Merge PRs #1 → #6 (then this one) into `main`.
- The Phase 1 asks are still open: Sentry DSN, Play Console verification, 12+ testers, Meta /
  WhatsApp number, certificates.
- For the store listing: a contact email, and confirmation of the public shop phone and who
  answers WhatsApp.
