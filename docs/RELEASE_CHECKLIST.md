# Release checklist and acceptance matrix

Prepared 11 October 2026 (Phase 4). Use this for every staging release and, later, for the
production decision. A row passes only with the evidence named. **Automated** means a test in
this repository ran against a disposable database; it is not proof on a real phone, real
network, real SMS or real provider. **Manual** rows are pending until a named person records
the result.

Status key: ✅ passed (with evidence) · ⏳ pending · ⛔ blocked by an external decision.

## A. Release gates

| #   | Gate                                                                                                                                                                                                                   | Owner                      | Status             | Evidence / next action                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| G1  | Exact commit passed GitHub Actions `verify` (lint, types, unit, integration, workflows, Chrome + WebKit journeys, restore rehearsal, builds, CSP/nonce checker, credential scan, audit, Docker build, container smoke) | Developer                  | ⏳ for this branch | PR checks for the exact head SHA                                                                    |
| G2  | Hosting, database plan, domain/DNS chosen and approved                                                                                                                                                                 | Owner                      | ⛔                 | [STAGING_RUNBOOK.md §3](STAGING_RUNBOOK.md#3-hosting-options-decision-required-approval)            |
| G3  | Twilio Verify for India configured with approved test numbers                                                                                                                                                          | Owner + technical operator | ⛔                 | No credentials exist; mock OTP is refused in production                                             |
| G4  | Staging database with separate migration and runtime roles; backup taken and restore rehearsed on the provider                                                                                                         | Technical operator         | ⏳                 | Local rehearsal passed (§D); provider rehearsal pending                                             |
| G5  | Family content decisions C1–C3, C8–C10                                                                                                                                                                                 | Family                     | ⏳                 | [FAMILY_CONTENT_CHECKLIST.md](FAMILY_CONTENT_CHECKLIST.md#decisions-needed-from-the-family-now)     |
| G6  | Physical-device acceptance (§C)                                                                                                                                                                                        | Family + developer         | ⏳                 | No device or remote-device service was available to the developer                                   |
| G7  | Online payments remain disabled; Razorpay variables unset                                                                                                                                                              | Developer                  | ✅                 | `StoreSettings.onlinePaymentsEnabled=false` in dev data; staging template leaves `RAZORPAY_*` unset |
| G8  | Live assistant provider                                                                                                                                                                                                | Owner                      | ⛔ (not required)  | `ASSISTANT_PROVIDER=fallback` serves approved FAQ/catalogue answers                                 |
| G9  | Production go/no-go                                                                                                                                                                                                    | Owner                      | ⛔                 | Not before G1–G6 pass on staging                                                                    |

## B. Customer and owner acceptance

Prerequisites for manual rows: staging deployed per the runbook, TEST products and at least
one served pincode configured, two approved test phone numbers (customer A, customer B), one
staff phone with passphrase, a second browser profile.

| #   | Scenario                                          | Exact steps                                                                | Expected                                                       | Automated evidence (local, 11 Oct 2026)                                                                                                                                            | Staging/manual     |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| B1  | Browse in English and Hindi                       | Open home, switch to हिन्दी, open Materials and a product                  | Labels translate; prices show unit; no overflow at 360 px      | `storefront persists Hindi…`, `comparison distinguishes selling units; Hindi and enlarged…` ✅                                                                                     | ⏳                 |
| B2  | Search, filter, inspect units                     | Search "cement", filter brand, open product                                | Results match; minimum, step and pack visible                  | `storefront filters, sorts and paginates…`, `phone catalogue keeps products near the top…` ✅                                                                                      | ⏳                 |
| B3  | Add, edit, remove basket items                    | Add 2, type 12, remove line                                                | Basket updates; empty state after removal                      | `cart badge and product card show quantities…`, `typing a multi-digit cart quantity…`, `double-tapping Place COD order… removing the last basket line` ✅                          | ⏳                 |
| B4  | Delivery eligibility                              | Check served and unserved pincodes                                         | Served shows fee/minimum/estimate; unserved says not listed    | `storefront checks supported and unsupported delivery pincodes`, `…rechecks owner zone changes` ✅                                                                                 | ⏳ with real zones |
| B5  | COD checkout without duplicates                   | Review, consent, double-tap **Place COD order**                            | One order number, one owner task                               | `double-tapping Place COD order creates one order…`, `COD lost success recovers exactly one owner task…` ✅                                                                        | ⏳                 |
| B6  | Network failure / uncertain checkout              | Go offline at **Place COD order**, reconnect, **Recover order result**     | Same order recovered; no second order                          | `COD lost success recovers…`, `lost creation response survives reload…` ✅                                                                                                         | ⏳ on a phone      |
| B7  | Sign in, sign out, switch accounts                | Sign in as A, add address, sign out, sign in as B                          | B sees none of A's basket, addresses, orders                   | `saved address editing works; account switches and revocation clear private forms`, `late checkout success cannot… switched account` ✅                                            | ⏳ with real SMS   |
| B8  | Expired / revoked session                         | Revoke session from owner desk or wait for expiry                          | Customer is asked to sign in; saved requests recoverable       | `…revocation clear private forms`, `revoked staff session offers sign-in recovery` ✅                                                                                              | ⏳                 |
| B9  | Order history and quotations                      | Open Orders, open a quote with an offer                                    | Status timeline; offer terms; accept only current revision     | `customer places a COD order, tracks it, reorders…`, `multi-material quotation recovers… converts once` ✅                                                                         | ⏳                 |
| B10 | Assistant text, cancel, provider failure          | Ask a question, cancel, retry; simulate failure                            | Answers from catalogue/FAQ; cancel stops; failure labelled     | `assistant answers with current public catalogue… cancels and retries without private tools` ✅                                                                                    | ⏳                 |
| B11 | Voice unavailable/denied                          | Tap voice in a browser without speech or deny mic                          | Clear message; typed chat works                                | `voice is explicit, editable before sending, handles denied/unsupported…` (simulated) ✅                                                                                           | ⏳ real microphone |
| O1  | Owner reviews incoming orders and quotes          | Owner desk → Today                                                         | New COD order appears within 15 s                              | `phone COD: automatic owner queue…`, `SSE outage: polling finds new work…` ✅                                                                                                      | ⏳                 |
| O2  | Permitted order transitions                       | Acknowledge → prepare → dispatch → collect → deliver; try refused delivery | Only allowed transitions; stock restored once on cancel/return | `phone COD…`, `phone refused delivery…`, `collected COD cancellation…` ✅                                                                                                          | ⏳                 |
| O3  | Quote conversion                                  | Offer, customer accepts, convert                                           | One order at the accepted revision                             | `wholesale UI: freight confirmation, renewed consent and one order…` ✅                                                                                                            | ⏳                 |
| O4  | Customer cannot reach other records or owner desk | Customer token on another's order/quote; customer opens owner desk         | 404/403; owner desk refused                                    | API integration (cross-account), `admin UI denies a customer account…`, `invalid and expired OTPs reject login and a customer cannot open the owner desk` ✅                       | ⏳                 |
| O5  | Loading, empty, error, recovery states            | Throttle network; empty catalogue/search                                   | Clear states, retry works, no fabricated data                  | `storefront loading, network failure and retry…`, `storefront distinguishes out-of-stock, missing products and empty search`, `a failed sign-in check explains guest browsing…` ✅ | ⏳                 |

## C. Device and accessibility (physical devices required)

None of these rows has been performed on a physical device. Browser emulation (Playwright
Chrome and WebKit at 360–1440 px) passed and is listed as supporting evidence only.

| #   | Device / condition                | Steps                                                               | Expected                                                                   | Status                              |
| --- | --------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------- |
| D1  | Android phone, Chrome, Hindi      | B1–B7                                                               | All pass; touch targets ≥44 px; keyboard does not hide **Place COD order** | ⏳                                  |
| D2  | iPhone, Safari, English           | B1–B7, back gesture from product and checkout                       | No stuck overlays; focus returns after closing the assistant               | ⏳                                  |
| D3  | Tablet (either platform)          | Home, catalogue, checkout                                           | Hero stacks; rates board readable                                          | ⏳                                  |
| D4  | Largest system text size          | Home, product, checkout in Hindi                                    | Labels wrap, nothing clipped                                               | ⏳ (emulated 200% text passed)      |
| D5  | Keyboard only (desktop)           | Tab through home → product → basket → checkout                      | Visible focus on every control; skip link works                            | ⏳ (automated keyboard test passed) |
| D6  | Reduced motion                    | System setting on, reload home                                      | No hero animation                                                          | ⏳ (emulated passed)                |
| D7  | Slow network / offline transition | Throttle to slow 3G; toggle aeroplane mode on Products and checkout | Clear error below header; recovers on reconnect; no duplicate order        | ⏳                                  |
| D8  | Session expiry on a phone         | Leave the app 30+ min, return, continue checkout                    | Asked to sign in; basket kept                                              | ⏳                                  |
| D9  | Real microphone                   | Assistant voice: allow, deny, close while recording                 | Transcript editable; never auto-sent; typed chat works                     | ⏳                                  |

Record for every failed row: device model, OS and browser version, language, text size,
network, steps, screenshot. Do not mark a row ✅ from emulator evidence.

### C2. Android app on real phones (Phase 3)

The emulator results are in [P3_HARDENING.md](P3_HARDENING.md); these rows need the actual phones
(Papa's, Chacha's, one 2–3 GB budget Android, yours).

**Setup, once per phone:** on the phone, open Settings → About phone → tap "Build number" seven
times → Developer options → turn on USB debugging. Connect it by cable to the development Mac,
accept the prompt on the phone, then on the Mac:

```bash
npm run local:start
adb devices
adb reverse tcp:4000 tcp:4000
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

The phone reaches only this Mac's loopback API over the cable (mock sign-in codes appear on
screen; nothing is exposed on Wi-Fi). Then run the journeys on that phone:
`ANDROID_SERIAL=<id from adb devices> scripts/android-drills.sh` and
`npm run android:baseline -- --serial <id>`.

| #   | Phone / condition                  | Steps                                                                                                                | Expected                                                      | Status |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| P1  | Budget Android (2–3 GB RAM)        | `npm run android:baseline -- --serial <id>`                                                                          | Cold start < 2.5 s; janky frames < 5%                         | ⏳     |
| P2  | Each phone, Hindi                  | First launch → हिंदी → order 1 bag COD → track → order again                                                         | No English left on screen; four taps from product to order    | ⏳     |
| P3  | Each phone, keyboard               | Sign in; add an address with the phone's own keyboard                                                                | The field being typed is always visible; next/done move along | ⏳     |
| P4  | Each phone, largest font           | Settings → Display → Font size largest; Home, product, basket                                                        | Main buttons visible without scrolling; nothing cut off       | ⏳     |
| P5  | TalkBack on                        | Swipe through Home, a product, the basket                                                                            | Every control is read out in the chosen language              | ⏳     |
| P6  | Network loss                       | `scripts/android-drills.sh` on the phone (the cable ignores aeroplane mode, so the drill cuts the connection itself) | "Check order result" confirms exactly one order               | ⏳     |
| P7  | Real microphone                    | Shiv Sahayak: allow, deny, stop mid-sentence                                                                         | Text editable before sending; typing works when denied        | ⏳     |
| P8  | Family bug bash (Papa, Chacha + 2) | 20 minutes each of free use; note every hesitation                                                                   | No P0/P1 bugs left open                                       | ⏳     |

## D. Automated results for this branch

See [V4_STAGING_READINESS.md](V4_STAGING_READINESS.md#automated-checks) for exact commands and
counts.

## E. Sign-off

| Role                | Name | Date | Decision |
| ------------------- | ---- | ---- | -------- |
| Shop owner (retail) |      |      |          |
| Shop owner (bulk)   |      |      |          |
| Technical operator  |      |      |          |
