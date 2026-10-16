# Testing guide: website, app and owner desk

Three products share one API and one database:

| Product              | For                                      | Local address                             | Staging address                  |
| -------------------- | ---------------------------------------- | ----------------------------------------- | -------------------------------- |
| Website (storefront) | Customers on a computer or phone browser | http://localhost:3003                     | `https://shop.staging.<domain>`  |
| Android app          | Customers on their phones                | Emulator or your own phone over USB       | APK from the EAS `preview` build |
| Owner desk           | Papa, Chacha and staff                   | http://localhost:3002 (chosen, see below) | `https://admin.staging.<domain>` |
| API                  | All three                                | http://localhost:4000/api/v1/health       | `https://api.staging.<domain>`   |

Use **separate browser profiles** (or one normal and one private window) for a customer and an
owner. Both sign in with cookies on the same API, and one sign-in would replace the other. Use
`localhost` everywhere; do not mix it with `127.0.0.1`.

Longer reference: [LOCAL_TESTING.md](LOCAL_TESTING.md) (every manual scenario) and
[STAGING_RUNBOOK.md](STAGING_RUNBOOK.md) (hosted staging).

## 1. Start everything on this Mac

First time on a fresh checkout: `npm ci`, then `npm run local:setup`. After that:

```bash
LOCAL_ADMIN_PORT=3002 npm run local:start
npm run local:status
```

`local:status` must say `ready (verified, managed)` for all four services: api, admin, customer
(Expo web, 8081) and storefront. The launcher's default desk port is 3000; this Mac already has
another program on 3000, so the desk is moved to 3002. A successful start saves the choice in
`.local/ports.env`, so later starts reuse it. Logs are in `.local/{api,admin,customer,storefront}.log`.
Stop everything with `npm run local:stop` (the database keeps running; `npm run local:db-stop`
stops it).

Sign-in codes are shown on screen in local mode, labelled as a local code. No SMS is sent.
Practice people (from `apps/api/scripts/local-fixtures.ts`):

| Person                   | Phone      | Staff passphrase         |
| ------------------------ | ---------- | ------------------------ |
| Papa (retail owner)      | 9900000001 | `Local-owner-only-2026!` |
| Chacha (wholesale owner) | 9900000002 | `Local-owner-only-2026!` |
| Ravi (customer)          | 9900000003 | none                     |
| Technical operator       | 9900000004 | `Local-owner-only-2026!` |

These are local practice values only. They never work on staging.

Practice product: **TEST — Cement PPC** (₹390 a 50 kg bag, 1,000 bags opening stock). Practice
pincode: **800099** (₹500 delivery). Ravi has a saved address **TEST Site** at 800099. 50 bags
cost ₹19,500 + ₹500 delivery = **₹20,000**, while those fixture prices are unchanged.

For the family demo, use the sample catalogue from the demo kit instead (section 6).

## 2. Test the website, step by step

Open http://localhost:3003 in the customer profile.

1. **Language.** Switch to **हिन्दी** in the header. Today's rates show, and every price has its
   unit.
2. **Hindi names and units (wave 2).** In Hindi, product names that have a Hindi name show it
   (for example सीमेंट, not "Cement"). Units read in Hindi too (for example बोरी for a 50 kg
   bag). Prices and quantities do not change with the language. A product without a Hindi name
   falls back to its English name. Switch back to English: everything is English again.
3. **Browse.** Open Materials, search, open a product, choose 50 and **Add to basket**
   (**टोकरी में जोड़ें**). The basket count rises. A quantity below the minimum or off the step
   is explained, not accepted silently.
4. **Sign in** as Ravi (9900000003). Copy the local code from the form. The guest basket joins
   the account once.
5. **Checkout.** Choose **TEST Site**, a future date, then **Review current order**. Check
   material + delivery = total. Tick the consent box, then **Place COD order** once. Tap twice on
   purpose: you still get one order number.
6. **Track.** Open Orders. Status changes from the desk appear without reloading.
7. **Share on WhatsApp (wave 2).** On the order page, choose the WhatsApp share action. WhatsApp
   (or WhatsApp Web) opens with an order summary ready to send. Check: order number, items,
   total and status are right; no staff phone number and no address beyond what the customer
   typed. Do not press Send in WhatsApp unless you mean to.
8. **Profile edit (wave 2).** In Account, change the name and the business/contractor choice,
   save, reload. The new values stay. Sign in on the app as the same person: the same profile
   shows there.
9. **Signed-in devices (wave 2).** Account lists every place this number is signed in (website
   and app), with "this device" marked. Sign out the app's entry from the website. The app asks
   Ravi to sign in again on its next request.
10. **Delete account (wave 2).** Use a throwaway customer number, not Ravi. Finish or cancel its
    open orders first. Follow the delete step in Account and its typed confirmation. Afterwards
    the number signs in as a new, empty customer. On the desk, the old orders stay but show
    "खाता हटाने पर संपर्क जानकारी हटा दी गई।" instead of contact details.
11. **Bulk quote.** **Add to quote** on two materials, open Bulk quotes, choose address and
    date, **Request written quotation**. Keep the reference number for the desk test.

## 3. Test the Android app, step by step

The app on an emulator or on your own phone (USB cable) reaches this Mac's API through
`adb reverse`. Nothing is opened on Wi-Fi. Mock sign-in refuses tunnels and LAN access on
purpose.

One-time tools: JDK 17, Android SDK, emulator images `shiv_budget_api29` (Android 10, low-end)
and `shiv_modern_api35` (Android 15), and Maestro.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
LOCAL_ADMIN_PORT=3002 npm run local:start
"$ANDROID_HOME/emulator/emulator" -avd shiv_budget_api29 -no-snapshot-save &
adb reverse tcp:4000 tcp:4000
cd apps/mobile
APP_VARIANT=local CI=1 npx expo prebuild --platform android --clean --no-install
APP_VARIANT=local CI=1 npx expo run:android --variant release --no-bundler --device shiv_budget_api29
```

- `--device` takes the AVD name, not `emulator-5554`.
- Run `adb reverse tcp:4000 tcp:4000` again after every reconnect, reboot or cable change.
- A quick probe of the reversed port without a `Host` header gets **403** from the loopback
  guard. That means the tunnel works; it is not a failure.
- For your own phone: turn on USB debugging, plug in, accept the prompt, check `adb devices`,
  then the same `adb reverse` and `expo run:android --device <phone name>`.

Then:

1. First launch asks for the language. Choose हिन्दी. Hindi names and units show as on the
   website (section 2, step 2).
2. Browse, add 50 bags, sign in as Ravi, place a COD order. One order number.
3. Orders: the desk's steps show as status changes. No staff phone number is visible.
4. Share the order: the share sheet offers WhatsApp with the same summary as the website.
5. Account: edit profile, signed-in phones, sign out, delete account (throwaway number).
6. Turn on airplane mode, reopen the app, turn it off. Ravi stays signed in. A bar says
   "Cannot reach the store. Check your connection and try again." with **Retry** (Hindi:
   **फिर से**), then it recovers.

Automated: `npm run test:maestro -w @shiv/mobile` (flows in `apps/mobile/.maestro`), failure
drills `scripts/android-drills.sh`, performance `npm run android:baseline`. Maestro also needs
`JAVA_HOME`.

## 4. Test the owner desk, step by step

Open http://localhost:3002 in a separate browser profile. The desk opens in Hindi; the top-bar
button switches to English.

1. **Sign in.** Staff mobile number → **कोड भेजें** → enter the 6-digit code and the staff
   passphrase → **दुकान डेस्क खोलें**. A wrong passphrase keeps the code field, so you can retry
   with the same code.
2. **आज (Today).** Leave it open. A new website or app order appears under **नया काम** within
   15 seconds without a reload.
3. **Order steps.** Open the order → **ज़िम्मेदारी लें** → **तैयार करना शुरू करें** →
   **माल रवाना करें** → **नकद मिला · डिलीवरी पूरी** (or **UPI मिला · डिलीवरी पूरी**). Each
   step asks to confirm. The customer sees each status.
4. **हिसाब (Money).** More (**और**) → **हिसाब** → **आज**. The cash from step 3 shows.
   **Excel के लिए डाउनलोड (CSV)** opens in Excel with Hindi intact.
5. **काउंटर बिक्री.** From Today's quick actions: material, quantity, price, cash or UPI,
   **बिक्री दर्ज करें**. Stock goes down once; Money shows it under counter.
6. **भाव और स्टॉक.** **बदलें** on TEST — Cement PPC, change the price, **सामग्री सहेजें**. The
   website and app show the new price without reload. **स्टॉक खाता** → **माल आया** with a
   reference → **एंट्री दर्ज करें**. Old entries never change.
7. **Hindi product name (wave 2).** In the product form, fill the Hindi name and save. The
   website and app show it in Hindi mode.
8. **थोक भाव (Bulk quotes).** Open Ravi's request → **ज़िम्मेदारी लें** → price every line, set
   भाड़ा, date and **कब तक मान्य**, tick the site/route/vehicle check → **भाव भेजें**. Ravi
   accepts on the website or app. Then **ऑर्डर बनाएँ**: one order, with the agreed prices.
9. **स्टाफ़ और अलर्ट.** **यहाँ अलर्ट चालू करें**, then **जाँच अलर्ट भेजें**. A notification
   with sound arrives.
10. **Lost connection.** Stop the API (`npm run local:stop`, or block `localhost:4000` in
    DevTools). The desk keeps the last screen and says
    "संपर्क में दिक्कत · पुरानी स्क्रीन दिख रही है; फिर कोशिश जारी". Start it again; the desk
    recovers on its own.

## 5. Ten-minute check of all three (before every family session)

| #   | Where              | Do                                                        | Expect                                                              |
| --- | ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Website, Hindi     | Open home, switch to हिन्दी                               | Today's rates show; every price has its unit, in Hindi              |
| 2   | Website            | Search a material, open it, add 50 bags                   | Basket count rises; quantity rules explained if wrong               |
| 3   | Website            | Sign in as Ravi, choose TEST Site 800099, review          | Material + delivery = total; consent box                            |
| 4   | Website            | Place the order once (double-tap on purpose)              | One order number, never two                                         |
| 5   | Desk, Papa         | Wait on आज without refreshing                             | The order appears under नया काम within 15 seconds                   |
| 6   | Desk               | ज़िम्मेदारी लें → तैयार → रवाना → नकद मिला · डिलीवरी पूरी | Each step asks to confirm; हिसाब shows the cash                     |
| 7   | App, Ravi          | Open Orders                                               | Same order, status Delivered; no staff phone number                 |
| 8   | App                | Airplane mode on, reopen, airplane mode off               | Still signed in; "Cannot reach the store" with Retry, then recovery |
| 9   | Desk, Chacha + App | Bulk quote: price, send; customer accepts; ऑर्डर बनाएँ    | One order created on convert                                        |
| 10  | Desk               | भाव और स्टॉक: change a price                              | Website and app show the new price without reload                   |
| 11  | Website or app     | Share the order on WhatsApp                               | Correct summary opens in WhatsApp; nothing sent by itself           |

## 6. Demo kit

The demo kit loads a sample catalogue (realistic materials, Hindi names and units, practice
pincode 800099) so the family sees a believable shop instead of TEST products.

| Command                    | What it does                                                         |
| -------------------------- | -------------------------------------------------------------------- |
| `npm run demo:preflight`   | Read-only check that the stack is ready for a demo. Must pass first. |
| `npm run demo -- prepare`  | Loads the sample catalogue, practice zone and practice people.       |
| `npm run demo -- snapshot` | Saves the current demo database so you can return to it.             |
| `npm run demo -- restore`  | Puts the database back to the last snapshot.                         |
| `npm run demo -- reset`    | Clears demo orders and quotes and reloads the sample catalogue.      |

Typical order: `demo:preflight` → `prepare` → `snapshot` → run the demo → `restore` (or `reset`).

Safety rules:

- Only on this Mac's local practice database, or a staging database that holds **no real
  customer data**. Never point it at production.
- Never run it while a family member is placing an order. Stop, then reset.
- Take a `snapshot` before every demo, and `restore` afterwards. Do not edit snapshot files by
  hand.
- Sample prices are examples, not the shop's rates. Say so out loud during the demo.
- Do not use real customer phone numbers in the demo. Use the practice people above or the
  approved test numbers on staging.
- Online payments stay off. The demo uses cash on delivery only.

## 7. Automated checks (what CI runs)

Run these one after another. Never run two database suites at the same time: the integration
suite and the browser suites share the `shiv_cement_test` database and reset it.

```bash
npm run lint
npm run typecheck --workspaces --if-present
npm test
npm test -w @shiv/shared
npm test -w @shiv/mobile
npm run test:local
npm test -w @shiv/storefront
npm run test:integration -w @shiv/api
npm run test:workflows
npm run test:bootstrap
npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome
npm run test:e2e -- --config=playwright.qa.config.ts --project=webkit
```

Browser tests start their own servers on **4010 / 3001 / 3004 / 8082** (API / desk / website /
Expo web), separate from the manual stack. Run one browser project per command.

Browser suites in `tests/`:

| Spec                                   | Covers                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| `journeys.spec.ts`                     | Customer app journeys end to end                                |
| `cart-feedback.spec.ts`                | Basket quantities, feedback and recovery                        |
| `customer-recovery.spec.ts`            | Lost replies, offline, uncertain order submit                   |
| `owner-desk.spec.ts`                   | Desk opens in Hindi, counter sale, low stock, staff alerts      |
| `owner-workflows.spec.ts`              | Order steps, money, returns, quotes on the desk                 |
| `desk-hardening.spec.ts`               | Wave 1 desk fixes: order search, money range, settings, outages |
| `qa-audit.spec.ts`, `qa-stock.spec.ts` | Sign-in edge cases, customer kept out of the desk, stock        |
| `rate-studio.spec.ts`                  | Rate Studio review and publish                                  |
| `security-browser.spec.ts`             | Browser security boundaries                                     |
| `storefront.spec.ts`                   | Website pages in both languages                                 |
| `storefront-commerce.spec.ts`          | Website basket, checkout, orders, quotes                        |
| `storefront-experience.spec.ts`        | Website rates board, outages, phone layout, review notes        |
| `storefront-hardening.spec.ts`         | Wave 1 website fixes: checkout review, double tap, sign-in      |
| `storefront-account.spec.ts`           | Wave 2: profile edit, signed-in devices, delete account         |
| `catalogue-hindi.spec.ts`              | Wave 2: Hindi product names and units                           |
| `storefront-webkit-diagnostic.spec.ts` | Opt-in WebKit diagnostic (`RUN_STOREFRONT_WEBKIT_DIAGNOSTIC=1`) |

To run one spec: `npm run test:e2e -- --config=playwright.qa.config.ts --project=chrome tests/storefront-account.spec.ts`.

Browser tests rewrite some screenshots under `docs/screenshots`. Discard those changes before
committing unless you meant to update them.

## 8. On staging, with real phones

1. `STAGING_API_ORIGIN=… STAGING_SHOP_ORIGIN=… STAGING_ADMIN_ORIGIN=… npm run staging:smoke`
   (read-only; checks health, CORS, headers, catalogue and that payments are off).
2. Sign in with a real SMS code on your phone, then Papa's and Chacha's.
3. Install the `preview` APK on each phone. It shows a small TEST mark and talks to staging only.
4. Walk through [DEMO_SCRIPT.md](DEMO_SCRIPT.md), then let each person use it freely for 20
   minutes.
5. Write down every hesitation: phone model, language, what they tapped, what they expected.

## 9. Security checks before inviting anyone

| Check                                           | How                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| A customer cannot open another customer's order | Sign in as two customers; paste one's order link into the other                  |
| A customer cannot open the desk                 | Sign in to the desk with a customer number: access is refused                    |
| Sign-in cannot be blocked for everyone          | Covered by `apps/api/test/hardening-auth.test.ts`                                |
| Staff passphrase guesses are limited            | Covered by `hardening-auth.test.ts` (10 wrong → that address locked for an hour) |
| Customers never see staff phone numbers         | Covered by `hardening-auth.test.ts`; check an order in the app                   |
| The runtime database login cannot delete orders | `npm run test:restore` asserts it                                                |

## 10. Before showing the family

- [ ] Latest commit passed CI (`verify`), and you know its SHA.
- [ ] `npm run local:status` (or `staging:smoke`) is all green.
- [ ] `npm run demo:preflight` passed; `npm run demo -- snapshot` taken.
- [ ] The ten-minute check (section 5) passed today, on the phones you will use.
- [ ] Each phone: charged, app installed, signed in, language set to हिन्दी, font size as the
      person normally uses it, notifications allowed for the desk.
- [ ] `adb reverse tcp:4000 tcp:4000` done (local) or phones on mobile data/Wi-Fi (staging).
- [ ] Sample prices clearly called examples. Online payments off.
- [ ] No real customer numbers or addresses on any screen.
- [ ] Feedback form printed or open ([DEMO_SCRIPT.md](DEMO_SCRIPT.md), last section).
- [ ] After the demo: `npm run demo -- restore`, and write up the notes the same day.
