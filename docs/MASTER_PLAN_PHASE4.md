# Master Plan v2 — Phase 4: public website

This report uses the 20 October 2026 master plan numbering (§8). The website is `apps/storefront`, extended rather than replaced (decided before Phase 3). Phase 4 was finished, attacked and reviewed on 31 October 2026, on `demo/catalyst`. Nothing is deployed, and search engines stay out until the owner switches indexing on (`docs/MANUAL_TASKS.md`, Phase 4).

## What changed

**Pages.** The site gained About, Delivery, Contact, Privacy, Terms and Delete-account pages (`components/pages.tsx`, one route folder each). They describe only what the system does today: no founding year, no awards, no delivery-time promise, and no phone number, address or hours until the family approves them (`apps/api/src/public-content.ts`, `contactApproved`). The header gained a Contact link. On a phone the English header says "Quotes" (the footer keeps "Bulk quotes"), so five links fit one row at 360 px in both languages. Every header link is at least 44 px wide.

**Enquiries ("Ask the shop").** A visitor with no account leaves a name, mobile number, optional pincode and material, and a question. The owner sees it on the desk's Today screen, with Call and WhatsApp buttons and a "Done" button. Material pages link to the form with the material filled in (`/contact?interest=…`).

- The website form and the desk screen existed before this session. **The backend half was missing** (the form would have failed), so it was built here:
  - `apps/api/src/web-enquiries.ts`;
  - the `WebEnquiry` table, with database checks that repeat the API's limits;
  - the shared `webEnquirySchema`;
  - an hourly purge that keeps the privacy page's promise: handled enquiries go after 180 days, unanswered ones after a year.
- A hidden field catches robots. They get the same answer as a person, nothing is stored, and they still spend their address's budget.
- Limits: 20 an hour per network address (mobile carriers put many phones behind one address), 5 a day per phone number, and 300 a day for the whole shop. The store-wide limit raises a security warning when it fills.
- The audit trail records that an enquiry arrived or was handled, never the name, number or message.

**Language.** The first page is written in the visitor's language: an address with `?lang=hi` or `?lang=en` first, then their saved choice, then Hindi for a browser that asks for Hindi first. `<html lang>` is right from the first byte. Every page names its English and Hindi addresses for search engines (hreflang `en`, `hi`, `x-default`), with a matching canonical link and a title and description in that language. Opening a `?lang=hi` link counts as choosing Hindi; the language switch removes `?lang` from the address.

**Search engines and sharing.**

- **Sitemap:** lists every page and material with its Hindi alternate. It is rebuilt hourly, so a material added after a deploy appears without a new deploy.
- **robots:** keeps personal pages out, and the whole site out until `SITE_INDEXING=on` on an https address.
- **Structured data:** the shop (`HardwareStore`, contact only once approved), each material (`Product` with its `Offer` and unit price; no brand for "Local supply" or "Local kiln"), and breadcrumbs.
- **Share card:** a share picture (1200×630) on every page, including material pages, where a page-level setting had dropped it.
- **Old addresses:** a redirect list (`lib/redirects.ts`) is ready for the old website's addresses once they are known.
- **Site address:** on Vercel the production address stands in until `SITE_URL` is set, so links never point at localhost.

## Attacked and reviewed

Three reviewers who had not seen the work attacked or reviewed it independently:

- **Web and API pen-test:** the running site and API on this Mac.
- **Android app security review:** the app's code, its configuration, the APK built on 21 October, and calls to the API as two customers.
- **Website review from six angles:** a first-time customer on a 360 px phone in both languages and at 200% text, owner honesty, privacy and legal, SEO, accessibility (axe on nine pages), and engineering.

### What held up

- **Phase 4 surface:** the new enquiry routes held against every attack tried: stored XSS into the owner desk, WhatsApp and phone-link injection, CSRF, forged `X-Forwarded-For`, mass assignment, unicode tricks, content-type confusion and oversized bodies.
- **Web pages:** the website's security headers (CSP with nonce, no framing), JSON-LD escaping, and the `?interest=` prefill.
- **App:**
  - Token storage: SecureStore, with the access token in memory only.
  - Offline cache: wiped on sign-out, session end and account deletion.
  - Backups are off and there is no cleartext traffic in release.
  - Deep links and push payloads are inert.
  - Order, address, quote and session ownership checks held with two customers.

### What was found and fixed

| Severity | Finding                                                                                                                                                                                  | Fix                                                                                                                                                                                                    | Test                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Blocker  | The enquiry form had no backend                                                                                                                                                          | Built (above)                                                                                                                                                                                          | 25 database tests; a browser journey from the Contact page to the owner's Today screen |
| High     | zod 4.6.5 (GHSA-mrhx-c7xc-m3w5): a crafted body can exhaust the API's memory                                                                                                             | zod 4.6.7 in the API, shared package and website. The API also returns at most 20 field errors (one 87 kB request had produced a 663 kB answer)                                                        | existing suites                                                                        |
| Medium   | Every sign-in and `/me` answer sent customers the owner's private notes about them: tags, area, credit limit, khata balance and the number of private notes                              | One account view (`accountView`, `apps/api/src/http.ts`) for sign-in, refresh, session and profile answers                                                                                             | `khata.test.ts`: none of those fields, or the tag's text, reaches the customer         |
| Medium   | 200 accepted SMS codes to made-up numbers could switch off sign-in for everyone, the owners included, for a day                                                                          | Separate daily budgets for new numbers and for existing customers; owners' numbers are never counted (each is still held to five codes an hour)                                                        | `integration.test.ts`: with the budget used up, a customer and an owner still sign in  |
| Medium   | On Android 7–12 another app can fake the sign-in SMS broadcast, and the app submitted every code it was given, so five fakes used up every check for a code                              | Only the first code read for each request is submitted; a fake costs one check at most and the customer can type the real code                                                                         | code review (needs a device to show)                                                   |
| Medium   | Hindi half-letters (क्‍या uses an invisible joiner) were refused as "special characters", with an unrelated error message                                                                | The joiner and non-joiner are allowed; other invisible and direction-changing characters are still refused. The form names the field the shop refused, marks it invalid and moves focus to the message | database tests both ways; shared tests; a browser test for the field error and focus   |
| Medium   | Five enquiries an hour per network address blocks customers behind a mobile carrier's shared address, and the limit message said "contact the shop" with no number shown                 | 20 an hour per address (the per-number limit does the work); the message asks to try later                                                                                                             | database test                                                                          |
| Medium   | No Hindi addresses or hreflang: search engines (which send no language) only ever saw English                                                                                            | `?lang=hi` addresses, hreflang and canonical on every page, Hindi titles and descriptions, sitemap alternates                                                                                          | browser tests                                                                          |
| Medium   | The sitemap was made once at build time; a build that could not reach the API shipped with no materials                                                                                  | Rebuilt hourly; a failed read is logged                                                                                                                                                                | production build shows the hourly revalidation                                         |
| Medium   | Material pages lost the share picture (WhatsApp previews had none); `/` and `/products` had no canonical, and `/products` no description                                                 | Full share card per page; descriptions and canonicals everywhere                                                                                                                                       | browser tests                                                                          |
| Medium   | Keyboard focus fell to the page after each step of the enquiry and deletion forms                                                                                                        | Focus moves to the error, the code field, the confirmation field or the result                                                                                                                         | browser test (enquiry)                                                                 |
| Medium   | The privacy page did not mention that Shiv Assistant's questions go to OpenAI when the shop turns the AI service on; the deletion page did not say a khata balance must be settled first | Both stated, in Hindi and English                                                                                                                                                                      | —                                                                                      |
| Medium   | The home page asked the API for the shop's details on every view, from one server address that shares the API's per-address limit                                                        | Cached for ten minutes                                                                                                                                                                                 | —                                                                                      |
| Low      | Malformed JSON was answered with the parser's own message                                                                                                                                | Answered with the generic "could not be read" message (`INVALID_BODY`)                                                                                                                                 | `hardening-infra.test.ts`                                                              |
| Low      | A customer could put new lines and a fake instruction into an address, which goes into the owner's WhatsApp new-order alert                                                              | Addresses are held to plain text; alert values are flattened to one line                                                                                                                               | shared test; unit test of the alert value                                              |
| Low      | After an offline sign-out on a shared phone, the previous customer's session stayed alive (with its notifications) for up to 30 days                                                     | The sign-out is kept and sent at the next sign-in on that phone; the app's notifications are cleared from the shade on sign-out                                                                        | typecheck (needs a device to show)                                                     |
| Low      | The unused Razorpay native library adds the `READ_PHONE_STATE` permission                                                                                                                | Blocked in `app.json`                                                                                                                                                                                  | —                                                                                      |
| Low      | At 200% text the privacy and terms pages could widen past the screen in the family review build; the footer had two "दुकान" headings                                                     | Fixed                                                                                                                                                                                                  | —                                                                                      |

### Left as it is, with the reason

- The SMS-reading library still registers its receiver without Google's permission check on Android 7–12. The app-side change above limits the damage; the real fix is a patch to the library (`patch-package` is not set up in this repository).
- The Razorpay native library stays bundled (its exported `DeeplinkActivity` remains) until online payments are decided; its phone-state permission is blocked.
- Customer order and quote answers still carry staff record ids, the customer's own request hash and idempotency keys. None is personal data, and the app may rely on the keys for retries.
- `htmlLimitedBots: /.*/` stays. Material pages already wait for the material before rendering, so it holds nothing back extra. On a very slow API the loading skeleton does not show.
- Deleting an account still asks for the Latin word `DELETE`. The app sends the same word, so changing it needs both.
- `components/pages.tsx` is one client module (10.7 kB gzipped for all six pages).
- Category and product names in Hindi are catalogue data (`nameHi`), filled by the owner.
- The `npm audit` advisories left are under Expo's build tools (`@expo/cli`, metro, babel, jest, node-forge, glob). None is in the app the phone runs; clearing them needs the next Expo major version.
- The local `android/` folder is from 21 October, and its release build still logs SMS text. EAS builds regenerate it. The manual list says to run `npx expo prebuild --clean -p android` before any local release build.

## Plan coverage (§8)

| Plan item                                                                        | Status                                                                                                                                                         |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` with call/WhatsApp, pincode checker, today's rates, app badge                | Rates board and pincode checker as before; call/WhatsApp appear once the family approves the number; the Play badge appears once `NEXT_PUBLIC_PLAY_URL` is set |
| `/products`, `/products/[id]` with Product JSON-LD, Hindi and English            | Done (server-rendered on every request, not ISR: prices must be current)                                                                                       |
| Bulk enquiry form → public endpoint with rate limit and honeypot → owner's Today | Done, as a separate enquiry rather than a `Quote` (a visitor has no account or material list); appears on Today within seconds through the live stream         |
| `/delivery`, `/about`, `/contact`, `/privacy`, `/terms`, `/delete-account`       | Done; founding year, photos, map and hours wait for the family (manual list)                                                                                   |
| Sitemap, robots, OG images, hreflang                                             | Done                                                                                                                                                           |
| Redirects from the old site                                                      | Ready; the list of old addresses is needed (manual list)                                                                                                       |
| Lighthouse ≥ 90 performance, SEO and accessibility on mobile                     | Met: 96 / 100 / 100 on the home and Contact pages (below)                                                                                                      |
| LCP < 2.5 s on 4G                                                                | 2.7 s under Lighthouse's simulated slow 4G (1.6 Mbit/s, 150 ms); to be checked on the hosted site with PageSpeed Insights (manual list)                        |
| Enquiry in Today within 15 s                                                     | Done (live stream; browser test)                                                                                                                               |

## Measured (production build, demo catalogue)

Lighthouse 12.8.2, mobile emulation with simulated slow 4G, median of three runs (`scripts/shots/lighthouse.mjs`):

| Page       | Performance | Accessibility | Best practices | SEO | FCP    | LCP    | TBT    | CLS   | Transfer |
| ---------- | ----------- | ------------- | -------------- | --- | ------ | ------ | ------ | ----- | -------- |
| `/`        | 96          | 100           | 93             | 100 | 0.76 s | 2.72 s | 105 ms | 0.001 | 491 KiB  |
| `/contact` | 96          | 100           | 93             | 100 | 0.76 s | 2.71 s | 35 ms  | 0     | 449 KiB  |

## Configuration and migrations

- **Migration** `20261031090000_web_enquiries`: a new `WebEnquiry` table and `EnquiryStatus` enum. It is additive and needs no backfill.
- **Runtime grants:** `scripts/runtime-grants.sql` now lets the API delete from `WebEnquiry` (the retention purge). Reapply the script after migrating, as `docs/STAGING_RUNBOOK.md` says for any new table the API deletes from.
- **No new environment variables.** On Vercel, `VERCEL_PROJECT_PRODUCTION_URL` (set by Vercel) is used until `SITE_URL` is set.
- **SMS budget:** `OTP_SENDS_PER_DAY` and `OTP_CHECKS_PER_DAY` now apply twice, once to new numbers and once to existing customers. Owners are not counted. The worst-case SMS spend is therefore about twice the figure (`docs/SECURITY.md`, `docs/MANUAL_SETUP.md` D1).
- **Dependency:** zod `^4.6.7` in `@shiv/api`, `@shiv/shared` and `@shiv/storefront`.

## Verification

Run on 31 October 2026 on the tree that was committed (Node 24.19, PostgreSQL 16 on loopback). Database and browser suites ran one after another, because Playwright's setup resets the shared test database.

- `npm run lint`, `npm run typecheck`: clean across all workspaces.
- Unit: 127 API, 33 shared, 21 storefront, 33 mobile; `npm run test:local`: 21.
- `npm run test:integration`: 182 real PostgreSQL tests, 25 of them the new enquiry tests. `test:workflows`: 20.
- Production builds: API, owner desk and website.
- Browser, Chrome (`playwright.qa.config.ts --project=chrome`): 146 passed, including the 14 website-page tests. The structured-data test had looked for a seed material by name, which other specs rename, so it failed only in the full run; it now uses whichever material is listed first.
- **WebKit was not run:** Playwright's WebKit is not installed on this Mac. CI runs it on every pull request.
- The three reviews' own probes are described above. Nothing was built with EAS, run on a real phone, or sent through a real SMS, WhatsApp or OpenAI account.

## Questions for the family

1. Who answers privacy questions (a name or role, and how to reach them)? How long are de-identified order records and backups kept? The privacy page and the Play data-deletion form need both.
2. Does the shop sell only cement, steel, bricks, sand and stone chips, as the website says, or also hardware, pipes or tiles?
3. The enquiry confirmation says "The shop will contact you on <number>". Is that a promise the shop keeps for every enquiry?
