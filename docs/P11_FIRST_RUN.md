# Phase 11: first-run experience and visual polish

Branch `codex/p11-first-run`, cut from `codex/p10-p2-fixes` (draft PR #17) on 18 Oct 2026.
Nothing deployed, no money spent, online payments still off, no real SMS, payment or WhatsApp
provider called. No migrations and no API contract changes: everything uses existing
endpoints (`PATCH /me`, `GET /delivery/:pincode`, `GET /shop-content`, `GET /orders`,
`GET /admin/delivery-zones`, `GET /admin/staff`, `GET /store`).

Audit with the ranked problems: [P11_UX_AUDIT.md](P11_UX_AUDIT.md). Screenshots:
[`screenshots/p11/before`](screenshots/p11/before) and [`screenshots/p11/after`](screenshots/p11/after).

## What changed

### A brand-new customer (app and website behave the same)

| Moment                 | Before                                                     | Now                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First open             | App: language chooser. Website: nothing.                   | Unchanged chooser. Home shows **"Your first order in 3 steps"** (choose material and quantity · check your site pincode · pay cash on delivery), closable, gone once the customer has any order.                          |
| Pincode check          | Forgotten when you leave the screen.                       | Remembered on the device and checked again on return. Shows **Delivery to 800020 · fee · minimum · the shop's own estimate**. Unserved: "not on the delivery list yet… send a bulk quote" (quotes have no pincode limit). |
| Basket                 | "Delivery is calculated after you choose an address."      | The basket shows delivery for the remembered pincode (app: for the chosen address once signed in) before checkout.                                                                                                        |
| First sign-in          | Straight on; name only editable in Account.                | A nameless account is asked **"What should we call you?"** once (one field, **Skip for now**), saved with `PATCH /me`. Home greets "Namaste, Asha" (app). New addresses start with that name.                             |
| New address            | Website form blank; app pre-filled name and phone.         | Both start with the name, phone and remembered pincode. Website checkout opens the form when nothing is saved and picks a saved address by itself.                                                                        |
| Checkout               | Website: "Review current order" greyed out with no reason. | "Choose or add a delivery address first." under the button.                                                                                                                                                               |
| After placing an order | Website: "Your order, in progress." App: four status dots. | Website: **"Thank you. Your order is placed."** Both: **What happens next**: order received ✓ · **the shop calls you** (now) · material is prepared · on the way to your site · delivered, pay on delivery.               |
| Contact on that panel  | n/a                                                        | Call/WhatsApp buttons appear only once the family approves the number (`contactApproved` in `apps/api/src/public-content.ts`, C2). Today nothing is shown.                                                                |
| Empty states           | Website orders: one line; address book: a sentence.        | Orders: what will appear and where. Address book: "Add your first address" button. App empty states already said what to do (kept).                                                                                       |

The words live once in `packages/shared/src/first-run.ts` (unit-tested: complete in both
languages, no hours/minutes/"same day" promises) and both products render them.

### Website look (from the audit, in priority order)

- **P0-1** The "shop's own photograph goes here" slot is gone from production builds (shown only
  in review builds). Verified on a production build: no review notes, no placeholder text.
- **P1-2** No more blank block beside the hero: above 900 px the pincode check sits under the
  hero copy, next to the rate board.
- **P1-1** Home order: hero + rate board + pincode check, first-order steps, catalogue, a shorter
  "Two ways to buy" (one sentence and one button each), brands, shop story. "Before you buy"
  removed. The pincode check moved from ≈ 4,700 px down to right after the rate board.
- **P1-6** Mobile LCP: the headline no longer fades in from transparent, it only moves. Lighthouse
  performance 86 → 98, LCP 4.16 s → 2.46 s.
- **P1-7** With large phone text the brand name takes its own row instead of breaking word by word.
- **P2-4** The header brand link's accessible name matches its visible text (Lighthouse a11y
  audit now passes with no failures).

### A brand-new shop owner (desk)

Today shows **"Set up your store" / "दुकान तैयार करें"** with four rows that tick themselves from
the live records and each open the right screen (and scroll to the right panel):

1. Delivery pincodes and fees: any active delivery area with a pincode (`/admin/delivery-zones`).
2. First material with price and stock: any active, in-stock material (`/products?availability=in`).
3. Store phone and WhatsApp number: the store details saved at least once (`/store` version > 1;
   the phone always starts from a built-in default, so one save is the only honest signal).
4. New-order alerts switched on: a staff member with WhatsApp alerts or a registered device
   (`/admin/staff`).

The card disappears when all four are done.

## Proof

All on this Mac, emulator/browser only. **No real-phone results are claimed.**

Final run on the branch head (18 Oct 2026, sequential, loopback `_test` databases only):

| Check                                                              | Command                                                                                              | Result                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Lint                                                               | `npm run lint`                                                                                       | ✅ clean                                     |
| Types                                                              | `npm run typecheck --workspaces --if-present`                                                        | ✅ clean                                     |
| API unit                                                           | `npm test`                                                                                           | ✅ 110/110                                   |
| Shared (incl. new first-run and feature-parity tests)              | `npm test -w @shiv/shared`                                                                           | ✅ 26/26                                     |
| Mobile unit                                                        | `npm test -w @shiv/mobile`                                                                           | ✅ 7/7                                       |
| Local scripts and theme drift                                      | `npm run test:local`                                                                                 | ✅ 18 passed, 1 skipped (as before)          |
| Storefront unit                                                    | `npm test -w @shiv/storefront`                                                                       | ✅ 16/16                                     |
| Integration                                                        | `npm run test:integration -w @shiv/api`                                                              | ✅ 118/118                                   |
| Workflows                                                          | `npm run test:workflows`                                                                             | ✅ 20/20                                     |
| Bootstrap                                                          | `npm run test:bootstrap`                                                                             | ✅ PASS                                      |
| Browser journeys, Chrome                                           | `npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome`                              | ✅ 117/117 (114 before + 3 new)              |
| Browser journeys, WebKit                                           | same with `--project=webkit`                                                                         | ✅ 116 passed, 1 skipped (opt-in diagnostic) |
| Build (shared, API, desk, app web, website)                        | `npm run build`                                                                                      | ✅                                           |
| Credential scan                                                    | `npm run security:scan`                                                                              | ✅ 644 files, 0 findings                     |
| Production headers, CSP nonces, script budget (Chrome + WebKit)    | `node scripts/check-production-headers.mjs --self-test && node scripts/check-production-headers.mjs` | ✅ PASS                                      |
| After the last two small fixes (app sign-in sheet, large-text CSS) | the app sign-in specs and the website specs on both engines                                          | ✅ 31/31 and 25/25 per engine                |

Baseline before any change (same commands, start of phase): Chrome 114/114, WebKit 113 + 1
skipped, the same unit/integration counts. The database suites first failed only because the
test database login had no password; Aman approved using the repository's local-only default.

**New journeys** (`tests/first-run.spec.ts`, Chrome and WebKit):

- `app first run: language, pincode, basket, sign-in with name, order, what happens next`
- `website first run: language, pincode, basket, sign-in with name, order, what happens next`
- `owner first run: the setup checklist ticks itself from real data and then hides` (starts on a
  simulated empty store because the shared test database always has a zone and a product, then
  ticks from the real records and hides after a real settings save and a real alert setting).

**Mobile Lighthouse 12.8.2** (production website build, home page, demo catalogue, simulated
slow 4G and 4× CPU, median of 3; lab numbers on this Mac):

| Metric            | Before (`b45dab0`)                    | After             |
| ----------------- | ------------------------------------- | ----------------- |
| Performance       | 86                                    | **98**            |
| Accessibility     | 100 (1 failed audit: brand link name) | 100 (none failed) |
| Best practices    | 93                                    | 93                |
| LCP               | 4.16 s                                | **2.46 s**        |
| FCP / Speed Index | 0.76 s / 0.76 s                       | 0.76 s / 0.76 s   |
| TBT               | 51 ms                                 | 26 ms             |
| CLS               | 0.001                                 | 0.001             |
| Transfer          | 418 KiB                               | 418 KiB           |

Best practices stays 93 because a guest's session check answers 401, which Chrome logs as a
console error. The production build showed no review notes and no placeholder text. The first
baseline in the audit was wrong (the API was unreachable from Lighthouse); it is corrected there.

**Measured page checks** (`scripts/shots/audit.shots.ts`, dev servers, `before/` and
`after/audit-demo.json`): tap targets under 44 px 0 → 0, unnamed controls 0 → 0, text under AA
contrast 0 → 0, one `h1` per website page. Home page height at 390 px 7,375 → 6,895 px and at
1440 px 4,517 → 3,965 px, with the new first-order card added. The pincode check moved from
≈ 4,700 px to ≈ 1,190 px from the top on a phone. Dev pages still include review notes that
production hides, so production pages are shorter still.

Keyboard and screen-reader basics: skip link first, then brand, nav, assistant, language and
the hero actions (unchanged order); the new steps carry "Done / Now / Next" for screen readers
and the current step is `aria-current="step"`; the checklist rows say "Done" or "Not done yet".
Not tried with TalkBack or VoiceOver.

## Screenshots

- BEFORE: `screenshots/p11/before/` (`storefront/`, `app/`, `desk/`; `empty-*` is a new store).
- AFTER: `screenshots/p11/after/`, same names. Good pairs to compare:
  - `storefront/home-fold-1440-en.jpg` (hero gap filled) and `storefront/home-390-en.jpg` (order).
  - `storefront/order-detail-390-en.jpg` (what happens next).
  - `app/home-en-scroll-1.jpg` (first-order card), `app/order-detail-en.jpg`.
  - `desk/empty-today-1440-hi.jpg` (setup checklist in Hindi).
- Screenshots come from development servers, so review notes still show there; the production
  check above covers what customers see.
- Re-run: `node scripts/shots/prepare.mjs demo && node scripts/shots/run.mjs demo <dir>` (and
  `empty`). Lighthouse: `node scripts/shots/lighthouse.mjs <out.json> 3`.

## Open items and not verified

- **Real phones**: nothing here was tried on a physical phone. Maestro flow
  `05-quote-cancel-pincode.yaml` was updated for the new wording but **not run** (no device).
- **C2 contact**: the new panel hides Call/WhatsApp until `contactApproved`. The app's **header**
  Call/WhatsApp icons and the order screen's **Help** button still use the default store phone
  (+91 9297513707) without that approval. Not changed: needs Aman's decision.
- **Desk row 3** ticks after any settings save; it cannot know whether the number is right.
- **Category names** stay English in Hindi (no Hindi field for categories; needs a schema change).
- The website's first-order card and greeting depend on `/orders?limit=1`; if that call fails the
  card stays hidden (on purpose: no beginner card for a regular customer).
- `docs/AUDIT_2026-10-15.md` (Aman's untracked file) was reformatted by Prettier by mistake
  during this phase; Prettier keeps wording (prose wrap is "preserve") but spacing and markdown
  markers may differ from the original. There was no backup to restore from.

## New Hindi strings for Papa to review

Every string below is new in Phase 11 (English → Hindi). Please mark any that sound unnatural.

**Shared (app and website)**

| English                                                                                       | Hindi                                                                                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Your first order in 3 steps                                                                   | पहला ऑर्डर, 3 आसान कदम                                                                                  |
| Choose material and quantity                                                                  | सामग्री और मात्रा चुनें                                                                                 |
| Every price shows its selling unit: a bag, a tonne, a thousand bricks.                        | हर भाव के साथ उसकी इकाई लिखी है: बोरी, टन, हज़ार ईंट।                                                   |
| Check your site pincode                                                                       | साइट का पिनकोड जाँचें                                                                                   |
| See the delivery fee and minimum order before you sign in.                                    | साइन इन से पहले डिलीवरी शुल्क और न्यूनतम ऑर्डर देखें।                                                   |
| Pay cash on delivery                                                                          | डिलीवरी पर नकद दें                                                                                      |
| Pay in cash or UPI when the material reaches your site.                                       | सामग्री साइट पर पहुँचने पर नकद या UPI से भुगतान करें।                                                   |
| Choose materials                                                                              | सामग्री चुनें                                                                                           |
| Hide these steps                                                                              | ये कदम छिपाएँ                                                                                           |
| What happens next                                                                             | आगे क्या होगा                                                                                           |
| Order received                                                                                | ऑर्डर मिल गया                                                                                           |
| Order SC-… is with the shop. Keep this number for any question.                               | ऑर्डर SC-… दुकान को मिल गया है। कोई भी सवाल हो तो यह नंबर बताएँ।                                        |
| The shop calls you                                                                            | दुकान आपको फ़ोन करेगी                                                                                   |
| Someone from the shop calls to confirm your order and delivery day before preparing it.       | तैयारी से पहले दुकान से कोई आपको फ़ोन करके ऑर्डर और डिलीवरी का दिन पक्का करेगा।                         |
| Material is prepared                                                                          | सामग्री तैयार होती है                                                                                   |
| The shop gets your material ready for the vehicle.                                            | दुकान आपकी सामग्री गाड़ी के लिए तैयार करती है।                                                          |
| On the way to your site                                                                       | साइट के लिए रवाना                                                                                       |
| Keep someone at the site to receive and check the material.                                   | सामग्री लेने और जाँचने के लिए साइट पर किसी को रखें।                                                     |
| Delivered · pay on delivery                                                                   | डिलीवरी · पहुँचने पर भुगतान                                                                             |
| Check the material, then pay in cash or UPI at the site.                                      | सामग्री जाँचें, फिर साइट पर नकद या UPI से भुगतान करें।                                                  |
| Done. / Now. / Next. (screen readers only)                                                    | हो गया। / अभी। / आगे।                                                                                   |
| Call the shop                                                                                 | दुकान पर फ़ोन करें                                                                                      |
| About my order SC-… (WhatsApp message)                                                        | मेरे ऑर्डर SC-… के बारे में                                                                             |
| What should we call you?                                                                      | आपका नाम क्या है?                                                                                       |
| We use it to greet you and as the person receiving on new addresses. You can change it later. | इससे हम आपको नाम से बुलाएँगे और नए पते पर सामान लेने वाले का नाम भरेंगे। बाद में खाते में बदल सकते हैं। |
| Your name                                                                                     | आपका नाम                                                                                                |
| Save and continue                                                                             | सहेजें और आगे बढ़ें                                                                                     |
| Skip for now                                                                                  | अभी छोड़ें                                                                                              |
| Enter your name, up to 100 letters.                                                           | अपना नाम लिखें, 100 अक्षरों तक। (already used in Account)                                               |
| Ask for a bulk quote                                                                          | थोक भाव माँगें (existing words)                                                                         |

**Pincode check**

| English                                                                                                                                | Hindi                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Check delivery for your site (app Home)                                                                                                | अपनी साइट पर डिलीवरी जाँचें                                                                                               |
| Delivery to 800020 · (area)                                                                                                            | 800020 पर डिलीवरी · (क्षेत्र)                                                                                             |
| Delivery fee ₹… · minimum order ₹…                                                                                                     | डिलीवरी शुल्क ₹… · न्यूनतम ऑर्डर ₹…                                                                                       |
| Delivery time: (shop's text)                                                                                                           | डिलीवरी का समय: (दुकान का लिखा)                                                                                           |
| 800020 is not on the delivery list yet.                                                                                                | 800020 अभी डिलीवरी सूची में नहीं है।                                                                                      |
| Check that it is the pincode of your site. For another area, send a bulk quote: the shop replies with freight if it can deliver there. | जाँचें कि यह आपकी साइट का पिनकोड है। दूसरे इलाक़े के लिए थोक भाव माँगें: दुकान वहाँ पहुँचा सके तो भाड़े के साथ जवाब देगी। |
| This is a delivery check, not a booking. Checkout shows the current terms again before you confirm.                                    | यह डिलीवरी की जाँच है, बुकिंग नहीं। पुष्टि से पहले चेकआउट में मौजूदा शर्तें फिर दिखती हैं।                                |
| See the fee and minimum order for your site before checkout. (basket)                                                                  | चेकआउट से पहले अपनी साइट का डिलीवरी शुल्क और न्यूनतम ऑर्डर देखें।                                                         |

**Website only**

| English                                                                                                    | Hindi                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Thank you. Your order is placed.                                                                           | धन्यवाद। आपका ऑर्डर हो गया।                                                                   |
| Order SC-… is placed.                                                                                      | ऑर्डर SC-… हो गया।                                                                            |
| No orders yet.                                                                                             | अभी कोई ऑर्डर नहीं।                                                                           |
| Your orders and every step of their delivery will show here, on the website and in the app.                | आपके ऑर्डर और उनकी डिलीवरी का हर कदम यहाँ दिखेगा, वेबसाइट पर भी और ऐप में भी।                 |
| No saved address yet. Add your site or home address once; it is ready for every order.                     | अभी कोई पता सहेजा नहीं है। घर या साइट का पता एक बार जोड़ें; हर ऑर्डर में काम आएगा।            |
| Add your first address                                                                                     | पहला पता जोड़ें                                                                               |
| Choose or add a delivery address first.                                                                    | पहले डिलीवरी का पता चुनें या जोड़ें।                                                          |
| The delivery fee is added at checkout for your address. Stock is reserved only when an order is confirmed. | चेकआउट में आपके पते का डिलीवरी शुल्क जुड़ता है। ऑर्डर पक्का होने पर ही स्टॉक आरक्षित होता है। |
| Check your pincode                                                                                         | अपना पिनकोड जाँचें                                                                            |
| A few bags to a few hundred: add them to your basket at the listed price and pay cash when they arrive.    | कुछ बोरी से कुछ सौ तक: सूची के भाव पर टोकरी में डालें और सामान पहुँचने पर नकद दें।            |
| Truck-sized quantities: send one list and the shop replies with item prices, freight and an expiry date.   | ट्रक भर मात्रा: एक सूची भेजें, दुकान हर सामग्री का भाव, भाड़ा और समय-सीमा लिखकर भेजेगी।       |

**App only**

| English       | Hindi        |
| ------------- | ------------ |
| Namaste, Asha | नमस्ते, Asha |

**Owner desk**

| English                                                                                               | Hindi                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Set up your store                                                                                     | दुकान तैयार करें                                                                                                |
| Four things before the first customer order. Each one ticks itself when it is done.                   | पहले ग्राहक ऑर्डर से पहले चार काम। हर काम पूरा होते ही अपने-आप टिक हो जाता है।                                  |
| 2 of 4 done (screen readers)                                                                          | 4 में से 2 पूरे                                                                                                 |
| Delivery pincodes and fees                                                                            | डिलीवरी पिनकोड और भाड़ा                                                                                         |
| Add the pincodes you deliver to, with the fee and minimum order. Customers cannot order without this. | जिन पिनकोड पर माल भेजते हैं, उन्हें भाड़े और कम से कम ऑर्डर के साथ जोड़ें। इसके बिना ग्राहक ऑर्डर नहीं कर सकते। |
| Open delivery areas                                                                                   | डिलीवरी क्षेत्र खोलें                                                                                           |
| First material with price and stock                                                                   | पहली सामग्री, भाव और स्टॉक के साथ                                                                               |
| Add one material with its selling price and the stock you have now.                                   | एक सामग्री उसके बिक्री भाव और अभी के स्टॉक के साथ जोड़ें।                                                       |
| Open prices & stock                                                                                   | भाव और स्टॉक खोलें                                                                                              |
| Store phone and WhatsApp number                                                                       | दुकान का फ़ोन और WhatsApp नंबर                                                                                  |
| Check the number customers will call, then press Save settings once.                                  | ग्राहक जिस नंबर पर फ़ोन करेंगे, उसे जाँचें, फिर एक बार "सेटिंग सहेजें" दबाएँ।                                   |
| Open store details                                                                                    | दुकान की जानकारी खोलें                                                                                          |
| New-order alerts switched on                                                                          | नए ऑर्डर का अलर्ट चालू                                                                                          |
| Switch on alerts on this device or WhatsApp alerts for one staff member, so no order waits unseen.    | इस डिवाइस पर या किसी स्टाफ़ के WhatsApp पर अलर्ट चालू करें, ताकि कोई ऑर्डर बिना देखे न रहे।                     |
| Open staff & alerts                                                                                   | स्टाफ़ और अलर्ट खोलें                                                                                           |
| The setup checklist could not load.                                                                   | शुरुआती सूची लोड नहीं हुई।                                                                                      |
| Done. / Not done yet. (screen readers)                                                                | पूरा। / अभी बाकी।                                                                                               |
