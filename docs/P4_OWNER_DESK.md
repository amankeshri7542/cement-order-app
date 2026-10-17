# Phase 4: owner desk — Hindi-first, alerts, operations

Branch `codex/p4-owner-desk` (from Phase 3). Goal: Papa and Chacha can run the shop from the
owner desk on a phone, in Hindi, and hear about new work even when the desk is closed.

## What changed

### Hindi everywhere

- One language provider for the whole desk (`apps/admin/lib/i18n.tsx`). Hindi is the default;
  the top bar (and the sign-in page) switches every screen to English and back. The choice is
  remembered per device.
- Today, Orders, order detail, Bulk quotes, Prices & stock, stock ledger, Customers, Delivery
  areas, Settings, Booking limits, Rate Studio and the new screens all speak Hindi.
- Statuses, ages ("2 घंटे / 3 दिन") and dates come from the shared bilingual helpers.
- Errors: customer codes use the shared Hindi text; 30+ owner-only codes have their own Hindi
  wording; in English the server's own (most specific) reason is shown.
- Store activity reads in plain language: "ऑर्डर रवाना · Papa · SC-1042 · ₹4,100.00", with
  names instead of IDs and no raw JSON (`GET /admin/audit` now returns `actorName` and
  `entityLabel`).
- Minimum text size 14px across the desk (the logo wordmark excepted).

### Fixes from the audit

| Audit finding                                  | Now                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Irreversible one-tap buttons                   | Confirmation before prepare, dispatch, deliver, cancel, send quote, convert    |
| "Mark delivered" failed before "cash received" | While cash is due the only way to finish is "नकद मिला · डिलीवरी पूरी" (or UPI) |
| Ages read "4320 min"                           | "3 दिन"                                                                        |
| Login pre-filled with a real number            | Empty                                                                          |
| Staff listed as customers                      | Removed                                                                        |
| No way to resend a failed alert                | "Retry alert" on orders and quotes; "फिर भेजें" on WhatsApp messages           |
| Fixed low-stock threshold of 25                | Per-product "इतना बचने पर चेतावनी"                                             |

### Operations

- **Counter sale** from Today: material, quantity, agreed price per unit (prefilled with the list
  price), cash or UPI, buyer name/phone. Stock and money update together; one idempotency key.
- **Cash vs UPI** recorded on every COD collection.
- **Money report** ("हिसाब"): Today / Yesterday / Last 7 days / This month or any range up to a
  year. Net collected, cash and UPI (orders and counter), cash still to collect, orders
  placed/delivered/cancelled, counter sales, refunds, quotes asked/sent/won/lost, and a per-day
  table. "Excel के लिए डाउनलोड (CSV)" saves a bilingual CSV that Excel opens in Hindi correctly.
- **Delivery terms** per delivery area and per quote (unloading, floors, vehicle). Customers see
  them on the pincode check and on the quote, in the app and on the website.

### Alerts, both channels

- **Push + sound.** The desk installs to the home screen (manifest, icons, service worker). "यहाँ
  अलर्ट चालू करें" subscribes the device with VAPID web push; every new order and quote request
  then shows a notification with sound and vibration even when the desk is closed. Tapping it
  opens that order. While the desk is open, a bell rings for new work (can be switched off per
  device) and the home-screen icon shows the count.
- **WhatsApp Business API.** An outbox with retries (5 attempts with back-off), a daily budget
  (default 200), per-owner opt-in and four templates: `shiv_new_order`, `shiv_new_quote`,
  `shiv_order_status` (customers, off by default) and `shiv_test_alert`. Recipients are masked
  in the desk. **Only the fake provider has been used; no real message has been sent.**
- **Staff & alerts screen**: names and roles, WhatsApp opt-in, alerts on this device, test alert,
  message log with resend. Creating a staff login stays a terminal command.

## Database

One additive migration, `20261013090000_owner_operations`: payment channel and buyer on money
movements, `Product.lowStockAt`, delivery terms on zones and quotes, staff title and WhatsApp
opt-in, `Notification.pushedAt`, and the `PushSubscription` and `OutboundMessage` tables. Runtime
role grants already cover new tables.

## Verification (local, before any deployment)

| Check                                               | Result                                                                                                                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck (all 5 workspaces), lint, formatting      | ✅                                                                                                                                                                                             |
| API unit / integration / workflows                  | ✅ 99 / 84 / 20                                                                                                                                                                                |
| Shared, mobile, storefront, local-script unit tests | ✅ 8 / 1 / 8 / 11                                                                                                                                                                              |
| Browser journeys, Chrome (CI config)                | ✅ 82/82 (77 before this phase + 5 new)                                                                                                                                                        |
| Browser journeys, WebKit (CI config)                | ✅ 81/81; the service-worker check runs in Chrome only                                                                                                                                         |
| New owner-desk spec                                 | ✅ Hindi default, counter sale by UPI, money + CSV, low-stock, staff/alerts, manifest + worker under CSP                                                                                       |
| Production build (all workspaces)                   | ✅ desk ships `/manifest.webmanifest`                                                                                                                                                          |
| Production security headers (Chrome + WebKit)       | ✅ CSP nonces enforced; injected scripts blocked                                                                                                                                               |
| Security scan                                       | ✅ 0 findings in 412 files                                                                                                                                                                     |
| Bootstrap smoke, backup → restore rehearsal         | ✅                                                                                                                                                                                             |
| Android 10 release APK: Maestro journeys            | ✅ 6/6, two runs in a row; 0 crashes                                                                                                                                                           |
| Android 10 failure drills + accessibility audit     | ✅ 9/9 drills, 5/5 screens                                                                                                                                                                     |
| Android 15 release APK: Maestro journeys            | ✅ 6/6; 0 crashes                                                                                                                                                                              |
| Container smoke (Docker)                            | ⏳ Docker is not installed on this Mac; runs in CI on the PR                                                                                                                                   |
| Dependency audit (production)                       | ⚠️ 34 known issues, all in the Expo/React Native build tools (Metro, Jest, Expo CLI); none in the API, website or desk runtime, none new in this phase. Fixing them needs an Expo SDK upgrade. |

### Bugs found and fixed during verification

1. **Materials list could stop loading** after a fast fling on a phone (or a big scroll on the
   web): the list reached the bottom before drawing its last rows, so React Native never
   reported the end. The scroll position is now checked too, an end seen during a load is
   remembered, and each page is requested once.
2. **Live updates on Safari/iPhone** stopped for good if the first connection failed (Safari does
   not retry). The desk now reconnects itself, and "live connection interrupted" stays visible
   until it does instead of being hidden by the next poll.
3. **The owner's low-stock level leaked into public catalogue data.** The database client now
   leaves it out of every customer response; only staff endpoints include it.
4. **Order history showed "Order out_for_delivery."** to customers and staff. The server no longer
   writes those notes, old ones are hidden, and the server's fixed notes read in Hindi.
5. Desk details: in English the server's specific error reason is shown; quote states use the
   shop's wording ("Sent", not the customer's "Offer ready for review"); delivery dates read
   "14 अक्टू॰ 2026"; history steps and times no longer run together.

Not app bugs, seen during the runs: Google Play auto-updating Android System WebView on the
emulator stopped the app mid-test (Android stops apps using WebView while it updates); and the
store-wide guard of 25 unacknowledged cash orders blocked new orders on the local database after
many test runs, which is exactly what it is for.

## Setup the shop needs before alerts work

1. Web push: `npx web-push generate-vapid-keys`, then set `WEB_PUSH_PUBLIC_KEY`,
   `WEB_PUSH_PRIVATE_KEY` and `WEB_PUSH_SUBJECT=mailto:<shop email>` on the API.
2. WhatsApp: a verified Meta Business account and a dedicated WhatsApp Business number; create
   and get approval for the four templates below (category "Utility", language Hindi), then set
   `WHATSAPP_PROVIDER=meta`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.

| Template            | Body (Hindi, parameters in braces)                                 |
| ------------------- | ------------------------------------------------------------------ |
| `shiv_new_order`    | नया ऑर्डर {{1}}, ₹{{2}}, क्षेत्र {{3}}। दुकान डेस्क में देखें।     |
| `shiv_new_quote`    | नया थोक भाव अनुरोध {{1}}, {{2}} सामग्री। दुकान डेस्क में भाव भरें। |
| `shiv_order_status` | आपका ऑर्डर {{1}}: {{2}}। — शिव सीमेंट स्टोर                        |
| `shiv_test_alert`   | नमस्ते {{1}}, शिव सीमेंट स्टोर के अलर्ट इस नंबर पर आ रहे हैं।      |

## Known limits

- The WhatsApp rate card artwork is still English-only; whether customers get a Hindi card is a
  product decision for Phase 6.
- iPhone web push needs iOS 16.4+ and the desk added to the home screen first.
- Push and WhatsApp have only been tested locally with the fake provider and without real keys.
