# Phase 3 — UI/UX excellence and acceptance readiness

Review snapshot: 11 October 2026. Branch `codex/v3-ux-excellence`, stacked on
`codex/v2-customer-experience` (starting commit `8ccfe2c61cbad01440ccf212aceae290ed5a6f08`,
draft PR #3). Nothing here authorizes merge, deployment, a domain change, production
migrations, payment activation or real messages.

## Checkpoint A — starting state and audit

| Item                        | Observed on 11 October 2026                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local branch / HEAD         | `codex/v2-customer-experience` at `8ccfe2c`, clean, equal to `origin`                                                                                   |
| PR #2 (foundation)          | Open draft, `codex/v2-storefront-foundation` → `codex/pilot-readiness`, head `8816dd9`, `verify` passed, mergeable, no reviews                          |
| PR #3 (customer experience) | Open draft, `codex/v2-customer-experience` → `codex/v2-storefront-foundation`, head `8ccfe2c`, `verify` passed (run 37943221288), mergeable, no reviews |

The audit rendered the API-backed storefront at 360, 390, 768, 1024 and 1440 px in English
and Hindi (90 full-page captures, no horizontal overflow, no page errors), then drove guest
basket, comparison and the signed-in journeys through the existing Playwright suites. Issues,
by customer impact:

| #   | Problem found in the rendered site                                                                                                                                                      | Impact                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | Hero board label "BUILDING MATERIALS" and caption were overlapped by the steel and brick illustrations at every width.                                                                  | First impression looked broken.                 |
| 2   | Any failed background sign-in check (offline, rate limit) put a fixed alert over the header, hiding brand and navigation, with an engineering message for a guest who had done nothing. | Navigation blocked on poor networks.            |
| 3   | The product page told customers to "confirm the final price, availability and delivery with the store before purchase", contradicting server-priced COD checkout.                       | Misleading purchase terms.                      |
| 4   | Customers saw internal review copy: "awaiting family approval in this local review", "No map loads in the background".                                                                  | Placeholders presented to the public.           |
| 5   | Headings relied on Trebuchet MS / Avenir Next, which Android phones do not have. Most Patna customers would see a generic fallback.                                                     | Brand identity absent on the main device class. |
| 6   | On phones the catalogue opened with three wrapped rows of category pills and a four-field filter form; the first product began below the fold.                                          | Slow product discovery.                         |
| 7   | Every card said "Pack: Not specified"; specs read "1 50 kg bag". Basket confirmation said only "Basket updated." and "1 materials".                                                     | Noise and weak feedback.                        |
| 8   | Comparison selections were lost on reload; the basket page also showed the floating basket bar over its own estimate.                                                                   | Lost work, obstructed totals.                   |
| 9   | Checkout review put the total at the top but never as a final total beside consent; dates were raw ISO strings.                                                                         | Harder to verify before paying.                 |
| 10  | Uppercase letter-spaced labels on almost every section, 9–11 px captions, a thin footer over 150 px of empty navy.                                                                      | Templated feel, poor legibility.                |
| 11  | Signed-out quotes page rendered two `h1` headings; eyebrows on dark panels lost contrast after recolouring (caught and fixed in Checkpoint D).                                          | Screen-reader structure, contrast.              |

## Checkpoint B — what changed and why

**Type.** Anek Latin (Ek Type, OFL) is self-hosted through `next/font` with its width axis,
so Latin headings keep one condensed, signboard-like voice on Android, iOS and desktop. It is a
single 103.6 KB preloaded file; no request leaves the site (`font-src 'self'` unchanged).
Devanagari headings use the phone's own Devanagari face. The first build used Anek Devanagari
and measured **840 KB** of fonts per page (726 KB Devanagari variable file); even a single
static Devanagari instance is 283 KB, so it was withdrawn. Body copy stays on system fonts.
Labels are sentence case at 14–15 px; prices keep tabular numerals.

**Homepage.** The hero states what the shop sells and how it prices: "Building materials,
every rate in plain sight." Its signature is a **current-rates board** (मौजूदा भाव), modelled
on the painted rate boards of local material shops: for each material it lists the cheapest
in-stock catalogue item with its own selling unit, links to that category, and shows when it
was checked. Prices come from the public API at request time; nothing is cached or invented,
and units are never converted across categories. Below it, "Two ways to buy" sets out retail
COD and bulk quotation side by side in three concrete facts each. Catalogue preview, delivery
check, family story, questions and buying guidance follow, each with a distinct layout. On a
390 px phone the rates board starts within the first screen.

**Honest business content.** Unapproved family, gallery, credentials and contact details are
not rendered as facts. In development and opt-in review builds a dashed
"Review note · not shown to customers" marks each slot and points to
[the family checklist](FAMILY_CONTENT_CHECKLIST.md). Customers instead get a useful
"Talk it through first" section with **Ask a question** (opens Shiv Assistant) and
**Request bulk quote**.

**Journeys.** Errors render below the header, never over it; guests get a plain explanation
that browsing still works. Basket confirmations name the material and quantity and clear after
five seconds. Comparisons persist for the tab. The basket and checkout pages no longer show a
second floating summary. Phone catalogue: one scrolling row of categories and a
**Filter & sort** toggle with an active-filter count. Product copy now describes COD checkout
accurately; empty pack sizes are omitted on cards and shown as "Not listed — ask the shop" on
the detail page. Checkout review ends with Materials / Delivery / **Pay on delivery** rows;
delivery and offer dates are formatted in the reader's language. Empty basket and compare
states direct the next action. The footer gains shop/account navigation and payment terms.

**Motion.** One easing curve and three durations (`--quick` 160 ms, `--base` 220 ms,
`--enter` 420 ms). The hero headline lines, description and rate rows rise in a short stagger;
the basket count re-keys to a 220 ms acknowledgement; dialogs and their backdrop fade in at
220 ms. Nothing delays input. `prefers-reduced-motion` removes all animation and smooth
scrolling. No animation library was added.

**Accessibility.** Category chips expose `aria-current`; the filter toggle uses
`aria-expanded`/`aria-controls`; the rate board is a named complementary region; the phone
assistant launcher is a 56 px icon button with a hidden text label; nested sign-in prompts
use `h2`.

## Checkpoint C — verification

All runs below are local, on 11 October 2026, against the branch contents committed here.
The exact-SHA GitHub Actions result for the pushed head is recorded on the draft PR.

| Check                                                                       | Result                                                                                                    |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Lint, Prettier (changed files), 5 workspace typechecks                      | Pass                                                                                                      |
| Storefront unit tests                                                       | 8/8 (adds rate-board selection test)                                                                      |
| API unit / integration / workflows / bootstrap / launcher                   | 85/85 · 73/73 · 20/20 · pass · 10/10 (backend unchanged)                                                  |
| Full Playwright suite, Chrome                                               | **75/75**, none skipped or flaky (70 existing + 5 new)                                                    |
| Full Playwright suite, WebKit                                               | **75/75**, none skipped or flaky                                                                          |
| Production headers/CSP/nonce checker (Chrome + WebKit, all three frontends) | Pass, including self-test                                                                                 |
| All workspace production builds                                             | Pass                                                                                                      |
| Credential-pattern scan / production dependency audit                       | 0 findings / 0 vulnerabilities                                                                            |
| Development data                                                            | Unchanged: 6 users, 8 products, 0 orders, 0 quotations, online payments off; no migration added or edited |

New regression tests in [`tests/storefront-experience.spec.ts`](../tests/storefront-experience.spec.ts),
each of which fails on the starting commit:

1. The rates board shows the cheapest in-stock cement price and unit from the API, links to
   the category, and the category chip reports `aria-current`.
2. A failed sign-in check shows a guest explanation **below** the header and navigation still
   works.
3. Basket confirmation names material and quantity; comparison survives reload; the basket page
   shows no duplicate floating summary; detail copy no longer asks customers to confirm prices.
4. Phone catalogue keeps the first product in view, chips stay on one row, the filter toggle
   expands, filters and counts active filters, with no horizontal overflow.
5. No "awaiting approval" text, two labelled review notes, no call/WhatsApp/map links while
   contact is unapproved, and a single `h1` on the signed-out quotes page.

Two existing assertions changed because the copy changed, not to weaken them: the homepage
heading check now asserts the new English **and** Hindi `h1` text and that the rates board lists
at least one material. The commerce suite's evidence folder is now configurable
(`REVIEW_EVIDENCE_DIR`) so V2 evidence is not overwritten.

**Performance.** Measured, not estimated:

| Measurement (production build)                             | Start `8ccfe2c`           | Now                                                      |
| ---------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| Storefront core initial JS, repository checker (local TLS) | 294,987 B gzip (recorded) | **297,368 B gzip (290.4 KiB)**, budget 450 KiB unchanged |
| Same, side-by-side local build of both commits, homepage   | 295,852 B gzip            | 297,393 B gzip (+1.5 KB)                                 |
| Lazy assistant JS after opening                            | 5,036 B gzip (recorded)   | 5,019 B gzip                                             |
| Web fonts downloaded per page                              | 0                         | 103,608 B (one preloaded woff2, cached across pages)     |

The first-pass Devanagari webfont measured 840,380 B of fonts per page and was withdrawn before
commit. Layout shift was 0 in the local captures, but those builds could not reach an API, so
this is **not** a Core Web Vitals result. Lighthouse and field CWV were not run.

## Checkpoint D — rendered review

Before: [`docs/screenshots/v2-customer/`](screenshots/v2-customer/) (V2 evidence captured by the
same journeys). After: [`docs/screenshots/v3-customer/`](screenshots/v3-customer/), produced by
`UPDATE_REVIEW_EVIDENCE=1 REVIEW_EVIDENCE_DIR=v3-customer` on the commerce suite, plus local
API-backed captures named `home-local-*`.

Defects found during this review and fixed: 2 px horizontal overflow from the rates board and
category scroller at 390 px; rates board truncating names at 768 px (hero now stacks below
900 px); dark-panel eyebrow contrast; duplicate "Account" link names; duplicate `h1`.

## Checkpoint E — acceptance gates still open

| Gate                                                                    | Owner                      | State                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Family content (story, photos, brands, awards, contact, delivery terms) | Family                     | Pending — see [checklist](FAMILY_CONTENT_CHECKLIST.md)                                                 |
| Physical Android/iOS acceptance                                         | Family + developer         | Pending — no device, simulator or remote-device service was available on this machine; checklist below |
| Live OTP, assistant provider, payment provider                          | Owner + technical operator | Not configured; online payment stays disabled                                                          |
| Lighthouse / Core Web Vitals on real networks                           | Developer                  | Not measured; only the local bundle/headers checker was run                                            |

### Physical-device checklist (pending)

Run on the family's own Android phone (Chrome) and one iPhone (Safari) against an approved
public-only preview. Do not expose the local mock-auth stack through a tunnel or LAN.

1. Open the homepage in Hindi. The rates board must appear in the first or second screen; tap
   a row and confirm it opens that material's list.
2. Products: horizontally scroll the categories, open **Filter & sort**, choose a brand, close
   the keyboard, and check nothing is hidden behind the basket bar or assistant button.
3. Add a material, change the quantity to a two-digit number with the phone keyboard, and
   check the confirmation names the material. On checkout, tap **Place COD order** twice
   quickly; exactly one order number must result.
4. Rotate the phone and set system text size to the largest setting; long Hindi labels must
   wrap, not clip.
5. Open Shiv Assistant, choose voice, allow the microphone, speak, edit the transcript, send.
   Repeat after denying permission; typed chat must still work. Close the assistant and confirm
   focus and scroll position return to where you were.
6. Switch to aeroplane mode on the products page, tap **Refresh**, then reconnect. The page
   must explain the problem without covering navigation and recover on reconnect.
7. Safari only: use the back gesture from a product page and from checkout; overlays must not
   remain open.

Record device, browser version, language, text size, network and a screenshot for each defect.

## Local review

With the local stack running (`npm run local:start`, see [LOCAL_TESTING.md](LOCAL_TESTING.md)):

| Surface           | URL                                   |
| ----------------- | ------------------------------------- |
| Storefront        | <http://localhost:3003>               |
| Owner desk        | <http://localhost:3002>               |
| Expo customer app | <http://localhost:8081>               |
| API health        | <http://localhost:4000/api/v1/health> |

Follow "Phase 3 review additions" in [LOCAL_TESTING.md](LOCAL_TESTING.md), then the existing V2
review sequence. Review notes are expected in development.
