# Phase 3: hardening

Branch `codex/p3-hardening` (from Phase 2). Goal: the Android app is bug-free and smooth under
real-world failures, and keeps being checked automatically.

## Exit criteria

| Criterion                              | Result                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| Maestro journeys green 3 runs in a row | ✅ 6/6 three times on Android 10; 6/6 on Android 15                                 |
| Playwright journeys green              | ✅ Chrome and WebKit (CI and local)                                                 |
| No crash in any run                    | ✅ Android 10 crash log empty for the app across every journey and drill since boot |
| Start-up and scroll targets            | ✅ on the emulator (Phase 2 numbers); real budget phone is row P1                   |
| Every tap budget met                   | ✅ (Phase 2 table; bulk quote now measured: 3 taps)                                 |
| Failure drills                         | ✅ 9/9                                                                              |
| TalkBack names and 48dp targets        | ✅ Home, Materials, product, Basket, Account                                        |
| Zero open P0/P1 bugs                   | ✅ from automated testing; the family bug bash (P8) is still to do                  |
| Physical phones                        | ⏳ needs the phones; checklist and commands in RELEASE_CHECKLIST §C2                |

## Failure drills (`scripts/android-drills.sh`)

Each drill runs on the release build against the real API, through a loopback-only proxy that
can delay, throttle, cut or lose replies (`scripts/android-proxy.mjs`), and checks the database.

| Drill                                                               | Result                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| The reply to Place order is lost after the server created the order | Pass: "Check order result" returns the same order; exactly one exists         |
| No network when Place order is tapped, then it returns              | Pass: one order                                                               |
| The app is killed straight after Place order                        | Pass: on reopening, the unconfirmed request is checked, not resent; one order |
| Slow 2G (600 ms per reply, about 40 kbps)                           | Pass: browse to a product page in about 20 s, no errors                       |
| The session is ended on the server while the app is open            | Pass: "Your session ended. Sign in again to continue." and a clean sign-out   |
| Microphone permission refused                                       | Pass: the assistant says so; typing works                                     |
| Largest system font (1.3×)                                          | Pass: main actions stay on screen                                             |
| The shop requires a newer app version                               | Pass: "Please update the app" blocks ordering                                 |
| Android Back button                                                 | Pass: back through screens with search kept, leaves the app from Home         |

## New Maestro journeys

`05-quote-cancel-pincode`: a bulk quote in 3 taps; cancelling an order with confirmation; the
pincode check. `06-compare-assistant`: comparing two materials; asking Shiv Sahayak.

## Fixed in this phase

- A restored bulk-quote draft hid its company, GSTIN and notes after a reload (found by the
  WebKit journey in CI; also applied to the Phase 2 branch).
- Language switch was 40dp tall; quantity −/+ buttons were 44dp wide (both now 48dp).
- The shop name was cut off at the largest font size (header text now scales a little less).

## Checked automatically from now on

- **CI "Android app journeys"** (`.github/workflows/android.yml`): builds the release APK, seeds a
  loopback API on the runner and runs all Maestro journeys on an Android 10 emulator for every
  change to the app, shared code or API.
- CI "Verify": lint, types, all unit, integration and workflow tests, app Hindi coverage,
  Playwright in Chrome and WebKit, restore rehearsal, production headers, container smoke,
  security scan and dependency audit.

## Still needs people

- **Phones (RELEASE_CHECKLIST §C2, P1–P7):** Papa's, Chacha's, one 2–3 GB budget Android and
  yours, over USB, in about an hour. The commands are in the checklist.
- **Family bug bash (P8):** 20 minutes each of free use; every hesitation logged and fixed.
