# Catalyst demo guide (10 minutes)

A practice run of Shiv Cement Store on Zoho Catalyst for a family demo. **Everything is fake:**
sample prices, no SMS, no online payment (cash on delivery only), no real customers. The longer
family script with roles for Papa and Chacha is [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

## Links

| What                     | Link                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| Website (shop)           | https://shop-50047090067.development.catalystappsail.in                    |
| Customer app (web)       | https://app-50047090067.development.catalystappsail.in                     |
| Owner desk (दुकान डेस्क) | https://admin-50047090067.development.catalystappsail.in                   |
| API health               | https://api-50047090067.development.catalystappsail.in/api/v1/health/ready |

## Sign-in

- **Customer:** any 10-digit number starting 6–9 that is not the owner's (for example 98765 43210).
  The six-digit code appears on screen ("No SMS sent"). Type it in.
- **Owner:** +91 90000 00001 (Demo Owner). No code is shown for this number: use the staff code
  kept in `.local/demo/secrets.env` (`DEMO_STAFF_CODE`). Never write it in this file; the
  repository is public. Backup owner: +91 90000 00002 (Demo Owner 2), same staff code. Use it if
  someone has used up the first number's 5 codes for the hour.

## 5 minutes before

1. Open all four links once and wait for each to load. Catalyst stops idle services after about
   5 minutes; the first visit after that takes 7–10 seconds.
2. Optional full check (about 1 minute, all rows must say PASS):

   ```bash
   set -a && . .local/demo/secrets.env && set +a && Z=50047090067.development.catalystappsail.in && VIA_FRONTEND=1 API_ORIGIN=https://api-$Z ADMIN_ORIGIN=https://admin-$Z SHOP_ORIGIN=https://shop-$Z APP_ORIGIN=https://app-$Z node scripts/catalyst-demo/live-test.mjs
   ```

   It signs in twice. Run it at most a few times an hour (sign-in limits below). It leaves test
   customers and orders behind, so afterwards reset the database to the clean sample data
   (drops and recreates only `shiv_demo`, about 30 seconds):

   ```bash
   bash scripts/catalyst-demo/reset-db.sh
   ```

3. Sign in to the owner desk on the laptop or phone you will hand over, and leave it on **आज**
   (Today).

## The 10 minutes

| Time | Screen       | Do                                                                                                                                        | Say                                      |
| ---- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 0–1  | Website      | Home page: today's rates. Switch to हिन्दी.                                                                                               | "ग्राहक यहाँ आज का भाव देखता है।"        |
| 1–3  | Customer app | Choose हिन्दी. Sign in as a customer. Add 2 bags UltraTech. Pincode 800001 shows the ₹500 delivery fee. Place a cash-on-delivery order.   | "पैसा डिलीवरी पर। ऑनलाइन पेमेंट बंद है।" |
| 3–6  | Owner desk   | The order appears under आज/ऑर्डर (refresh if not yet). Open it: confirm → preparing → out for delivery → record cash → delivered.         | "आप एक-एक बटन से ऑर्डर आगे बढ़ाते हैं।"  |
| 6–7  | Owner desk   | स्टॉक: UltraTech is 2 bags lower.                                                                                                         | "स्टॉक अपने-आप घटता है।"                 |
| 7–8  | Website      | Bulk quotes: ask for 100 bags ACC and 50 Dalmia. It appears in the desk for a reply.                                                      | "ठेकेदार थोक भाव माँग सकते हैं।"         |
| 8–10 | Owner desk   | स्टॉक: change one price (भाव बदलें), then "आज का भाव WhatsApp पर भेजें" to make the rate-card image. Reload the app to see the new price. | "भाव बदलिए, सबको एक साथ दिखेगा।"         |

## If something breaks

| Problem                                          | Do this                                                                                                                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page blank, slow or "Service unavailable"        | Wait 10 seconds and reload. It was asleep.                                                                                                                                                           |
| A new order is not on the owner screen           | Reload. Catalyst may cut the live-update connection after 30 seconds.                                                                                                                                |
| "Wait before requesting another code" / too many | Use a different customer number. Limits: 5 codes per number per hour, 30 s apart; about 10 codes per 10 minutes for everyone using the customer app.                                                 |
| Owner sign-in refused                            | Check the number and the code from `secrets.env`. After 5 wrong tries, request a new code (30 s later) and type the same staff code. Still refused: use the backup owner +91 90000 00002.            |
| A whole site is down                             | Show the other one (website and app place the same orders). Last resort: the screenshots in `docs/screenshots/` or the local demo kit (`npm run local:start`, [TESTING_GUIDE.md](TESTING_GUIDE.md)). |

## Known limits of this demo

- **Live updates:** Catalyst documents a 30-second limit per request, so the owner desk's live feed
  may drop and reconnect instead of staying open (not measured).
- **Rate Studio** passes its backend test, but its screen stays hidden in the owner desk
  (`NEXT_PUBLIC_FEATURE_RATE_STUDIO` is off, as the master plan decided).
- **Idle sleep:** services sleep after about 5 minutes idle. The background job (reminders, expiry
  of unpaid online orders) only runs while the API is awake. It is harmless with cash-only orders.
- **Same-origin API:** each site serves the API at its own `/api/v1`, because the Catalyst gateway
  answers browser CORS checks itself. Visitors through the customer app share one rate-limit
  bucket; website and owner desk visitors are limited one by one.
- **Contact number:** the store's contact number is the real shop number (9297513707) from the
  sample data.
- Sign-in codes appear on screen to anyone (DEMO_MODE). Do not put real customer data here.

## Cost

AppSail bills only while instances run (they stop when idle): about $0.078 an hour for the 1 GB
API and $0.039 an hour for each 512 MB frontend. Worst case, all four always awake: about $0.20
an hour, $4.70 a day, $66 for two weeks, inside the $250 trial credit. The real figure is lower
because of idle sleep. Check **Catalyst console → Billing** after a day. The Neon database
(`shiv_demo` in the Singapore project) is on Neon's free plan.

## Teardown and rollback

Nothing here touches `main` or production. To remove the demo:

1. **Catalyst:** console → project **cement-order** → AppSail → delete the services `api`,
   `admin`, `shop`, `app` (or delete the whole project if it holds nothing else).
2. **Neon:** project **neon-cinnabar-anchor** → drop the demo database and role:
   `DROP DATABASE shiv_demo;` then `DROP ROLE shiv_demo_runtime;` (run as `neondb_owner` against
   the `neondb` database). Nothing else in that project was changed.
3. **Local:** delete `.local/demo/` (secrets, build bundles, Catalyst link). It is gitignored.
4. **Code:** the work is on branch `demo/catalyst`. DEMO_MODE stays off unless `DEMO_MODE=true`;
   to drop it entirely, do not merge the branch.
5. **Credentials:** see "After the demo" below.

## After the demo

- The Catalyst CLI is logged in on this Mac (`catalyst logout` to end it), and the Neon CLI too
  (`neon auth` profile in `~/.config/neon`).
- On 22 Oct 2026 a debugging route briefly echoed the Zoho credentials that Catalyst attaches to
  every request (project secret key and an account access token). The route was removed within
  about two minutes. Revoke the CLI/session tokens (Zoho Accounts → Security → Connected apps /
  active sessions) and, if Catalyst offers it, regenerate the project's secret key.
