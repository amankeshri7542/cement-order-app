# Google Play listing: Shiv Cement Store

Draft for the Play Console. Fill the items marked **(owner)** before the first upload. Claims
stay factual: no awards, rankings or dealership wording until the certificates are approved
(docs/FAMILY_CONTENT_CHECKLIST.md).

## Store presence

| Field                    | English                                                                     | हिंदी                                                                       |
| ------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| App name (≤ 30)          | Shiv Cement Store                                                           | शिव सीमेंट स्टोर                                                            |
| Short description (≤ 80) | Today's cement, steel and sand rates in Patna. Order with cash on delivery. | पटना में सीमेंट, सरिया, बालू के आज के भाव। डिलीवरी पर भुगतान से ऑर्डर करें। |
| Category                 | Shopping                                                                    |                                                                             |
| Contact email            | **(owner)**                                                                 |                                                                             |
| Contact phone            | **(owner)**: the confirmed shop number                                      |                                                                             |
| Website                  | **(owner)**: `https://<domain>` once bought (phase 5)                       |                                                                             |
| Privacy policy           | **(owner)**: `https://<admin-domain>/privacy` (public owner-desk page)      |                                                                             |

### Full description: English

Shiv Cement Store, Patna, on your phone.

- **Today's rates first.** Cement, steel (TMT), bricks, sand and aggregates, with the price per
  bag, kg or load, as on the shop's rate board.
- **Order in a few taps.** Add materials, pick your site and a delivery day, and pay cash or UPI
  when the materials arrive. You see the full total, delivery included, before you confirm.
- **Bulk quotes for builders and contractors.** Send your list and site address; the shop
  replies with a written price, freight and validity that you accept in the app.
- **Track every order,** and order again with one tap.
- **Hindi or English,** with voice questions to Shiv Sahayak, our materials assistant.
- **Call or WhatsApp the shop** from any screen.

Prices and stock come straight from the shop. Delivery areas and charges are shown for your
pincode before you order.

### पूरा विवरण: हिंदी

शिव सीमेंट स्टोर, पटना, अब आपके फ़ोन पर।

- **सबसे पहले आज के भाव।** सीमेंट, सरिया (TMT), ईंट, बालू और गिट्टी: बोरी, किलो या गाड़ी
  के हिसाब से भाव, जैसे दुकान के भाव-बोर्ड पर।
- **कुछ ही टैप में ऑर्डर।** सामग्री जोड़ें, साइट और डिलीवरी का दिन चुनें, और सामान आने पर
  नकद या UPI से भुगतान करें। पक्का करने से पहले डिलीवरी सहित पूरा कुल दिखता है।
- **ठेकेदारों और बिल्डरों के लिए थोक भाव।** अपनी सूची और साइट का पता भेजें; दुकान भाड़े
  और अंतिम तारीख के साथ लिखित भाव भेजेगी, जिसे आप ऐप में स्वीकार करें।
- **हर ऑर्डर ट्रैक करें,** और एक टैप में फिर से मँगाएँ।
- **हिंदी या अंग्रेज़ी,** और शिव सहायक से बोलकर सवाल पूछें।
- **किसी भी स्क्रीन से दुकान को फ़ोन या WhatsApp करें।**

भाव और स्टॉक सीधे दुकान से आते हैं। ऑर्डर से पहले आपके पिनकोड की डिलीवरी और शुल्क दिखता है।

## Graphics

| Asset                                      | File                                             | Status                                                 |
| ------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| App icon 512×512                           | `apps/mobile/assets/icon.png` (1024, scale down) | Ready                                                  |
| Feature graphic 1024×500                   | `docs/play-store/feature-graphic.png`            | Ready                                                  |
| Phone screenshots (2–8), Hindi and English | `apps/mobile/.maestro/screenshots/store.yaml`    | Capture on staging with the real catalogue (phase 5/7) |

All graphics are generated from code: `node scripts/make-app-icons.mjs`.

## Data safety form

| Data                    | Collected                                | Why                                                                                               | Optional      |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------- |
| Phone number            | Yes                                      | Sign-in (SMS code), order updates                                                                 | No            |
| Name                    | Yes                                      | Delivery and order records                                                                        | Yes           |
| Address                 | Yes                                      | Delivery                                                                                          | No (to order) |
| Purchase history        | Yes                                      | Orders, quotes, reorder                                                                           | No            |
| Messages / app content  | Yes                                      | Questions sent to Shiv Sahayak                                                                    | Yes           |
| Voice / audio           | No                                       | Speech is turned into text by the phone's own speech service; the app does not send or keep audio | —             |
| Crash logs, diagnostics | Yes, when crash reporting is switched on | Fixing crashes (Sentry; no IP address, no request bodies)                                         | No            |
| Device or other IDs     | Yes, if order notifications are on       | Push notification token                                                                           | Yes           |
| Location                | No                                       | Delivery uses the typed pincode                                                                   | —             |
| Payment info            | No                                       | Cash/UPI at delivery; online payment is off                                                       | —             |

- Data is encrypted in transit (HTTPS only; the build refuses a non-HTTPS API).
- Data is not sold or shared with third parties for advertising.
- Account deletion: in the app (Account → Delete account) and on the website
  (`/delete-account` on the admin domain). Order records without personal details are kept for the shop's accounts.

## Content rating and release

- Content rating questionnaire: shopping app, no user-to-user content, no gambling: expect
  "Everyone".
- Target audience: 18+ (purchasing).
- Personal developer account: 14-day closed test with at least 12 testers before production.

The [Phase 5 handoff](../P5_STAGING_SETUP.md#family-apk-and-play-closed-test) documents
the staging APK, closed-test AAB, draft submission and public privacy/deletion URLs.
