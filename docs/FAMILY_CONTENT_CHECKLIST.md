# Family content checklist — परिवार की जानकारी की जाँच-सूची

Prepared 11 October 2026 for Phase 3. Nothing in this list is approved yet. The storefront
shows none of these items to customers until a family member confirms them and a developer
records them in the structured source below. In development (and in builds started with
`NEXT_PUBLIC_CONTENT_REVIEW=on`) dashed **Review note · not shown to customers** boxes mark
where each item will appear. A normal production build hides those notes.

**Where approved content goes:** [`apps/api/src/public-content.ts`](../apps/api/src/public-content.ts)
(served by `GET /api/v1/shop-content`). Approved photos go in
`apps/storefront/public/shop-assets/` as `name.webp`, `name.jpg` or `name.png` (letters,
digits, `_` or `-` only). Product photos use the separate approved product-image pipeline.

How to use: for each row, the family writes the exact wording or attaches the file, names who
approved it and the date, and ticks the permission box. Leave anything uncertain blank. Do not
copy wording from the old website without checking it; that site contains unverified claims.

## Approval workflow (Phase 4)

1. **Request.** A developer adds a row to the register below with the item, where it would be
   shown and its source (who supplied it, or which legacy file it came from).
2. **Decide.** The named owner (usually the father for the shop counter, the uncle for bulk
   and transport terms) approves, rejects or edits the exact wording or file. A spoken "looks
   fine" is not approval: write the decision, the name and the date in the row.
3. **Record.** Only after approval does a developer copy the value into its source of truth
   (`public-content.ts`, `shop-assets/`, owner-desk settings) in a reviewable commit that
   links the row.
4. **Restrict.** Note any limit (for example "family photo: website only, not social media",
   "number shown for calls only, no WhatsApp"). Withdrawal is handled the same way and is
   removed in the next release.

Status values: **Pending** (not decided), **Approved** (exact value recorded), **Rejected**
(must not be shown), **Live-unconfirmed** (already visible somewhere, needs confirmation or
removal).

### Approval register

| #   | Content item                                                                              | Source                                                                             | Decision owner              | Status               | Where it may appear                                                                                           | Restrictions / notes                                                                                                   |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| C1  | Short shop story (EN/HI): "A family shop for the materials your next project needs."      | Written for V2; already in `public-content.ts`                                     | Family                      | Live-unconfirmed     | Storefront story section, assistant `shop` answers                                                            | Generic wording, no factual claims; confirm or replace.                                                                |
| C2  | Support phone `+91 9297513707`                                                            | Original project brief (ARCHITECTURE.md); schema default for `StoreSettings.phone` | Father                      | **Live-unconfirmed** | Already shown: Expo customer app call/WhatsApp buttons, owner-desk privacy page. Not shown on the storefront. | Confirm it is the right public number and whether WhatsApp is read on it. Every new database starts with this default. |
| C3  | Business identity, retention periods, support contact on `/privacy` and `/delete-account` | DEPLOYMENT.md requirement                                                          | Father + technical operator | Pending              | Owner-desk public privacy pages                                                                               | Page currently says "the current setup contact is 9297513707"; legal identity and retention still blank.               |
| C4  | Family history, names, roles, founding year                                               | Legacy site (conflicting years)                                                    | Family                      | Pending              | Storefront story/gallery                                                                                      | Each person's own consent.                                                                                             |
| C5  | Shop and family photographs                                                               | Legacy `group.jpeg`; `store-front.png` is a marked placeholder                     | Family                      | Pending              | Storefront gallery                                                                                            | Consent from everyone pictured; no customer faces/vehicle numbers.                                                     |
| C6  | Brand names, logos, dealership wording                                                    | Legacy `brands-we-sell/*`                                                          | Family + manufacturers      | Pending              | Catalogue brand list (from live products only), product photos                                                | Written authorisation before "authorised dealer".                                                                      |
| C7  | Awards / credentials                                                                      | Legacy award images                                                                | Family                      | Pending              | Storefront credentials                                                                                        | Recipient, issuer, date, display right.                                                                                |
| C8  | Visiting address, hours, directions link                                                  | Not supplied                                                                       | Father                      | Pending              | Storefront visit section (`contactApproved`)                                                                  | Exact Google Maps link checked by the family.                                                                          |
| C9  | Delivery pincodes, fees, minimums, estimates                                              | Owner desk settings (practice pincode `800099` is test data)                       | Uncle                       | Pending              | Checkout, delivery checker, assistant                                                                         | Configure in staging/production separately; never copy test zones.                                                     |
| C10 | Cancellation and quotation terms (validity, what freight covers)                          | Not supplied                                                                       | Uncle                       | Pending              | Checkout and quotation screens, footer                                                                        | Plain-language wording in Hindi and English.                                                                           |

### Decisions needed from the family now

1. Is `+91 9297513707` the number customers should call, and is WhatsApp read on it (C2)?
2. Approve or replace the one-sentence shop story in both languages (C1).
3. Who answers customer calls and WhatsApp during and after shop hours (C2, C8)?
4. The exact visiting address, hours and a Google Maps link you have opened yourselves (C8).
5. Which pincodes you will actually deliver to in staging, with fee, minimum and estimate (C9).
6. Business name/identity and data-retention period for the privacy page (C3).
7. Photos, family introductions, brands and awards can wait; nothing is shown until approved.

## 1. Shop and family story — दुकान और परिवार की कहानी

| Item                 | What we need                                                                                                                   | Approved by / date | Status  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ------- |
| Story (English)      | 2–4 sentences in the family's words. No years, rankings or "No. 1" claims unless proven.                                       |                    | Pending |
| Story (Hindi)        | Same meaning in Hindi, written or checked by the family.                                                                       |                    | Pending |
| Founding year        | Only if documented (licence, registration, signboard photo). Legacy site says both "2000" and "24+/25+ years"; these conflict. |                    | Pending |
| Family members shown | Name, role at the shop, and each person's own consent to appear.                                                               |                    | Pending |

Fields: `story.en`, `story.hi`, `family[]` (`name`, `role`, `image`).

## 2. Photographs and permission — तस्वीरें और अनुमति

| Item                    | What we need                                                                                                    | Permission confirmed | Status  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------- | ------- |
| Shop front              | A genuine current photo of the shop. The legacy `store-front.png` is a marked placeholder and must not be used. | ☐                    | Pending |
| Inside the shop / stock | Real photos; no customer faces or vehicle numbers without consent.                                              | ☐                    | Pending |
| Family photo            | Legacy `group.jpeg` needs each pictured person's consent and a caption they approve.                            | ☐                    | Pending |
| Alt text                | One plain sentence per photo describing what it shows (English and Hindi).                                      | —                    | Pending |

Fields: `gallery[]` (`title`, `image`, `alt`). Illustrations on the site are labelled as
illustrations and must never be described as shop photographs.

## 3. Brands, logos and product images — ब्रांड, लोगो और सामान की तस्वीरें

| Item              | What we need                                                                                                                                               | Status  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Brands sold       | Which brands the shop actually stocks today. The site lists brands from the live catalogue only.                                                           | Pending |
| Dealership status | Written authorisation from each manufacturer before any "authorised dealer" wording. None is shown now.                                                    | Pending |
| Logos             | Permission to display each manufacturer logo. Logos are not shown now.                                                                                     | Pending |
| Product photos    | For each product: the exact SKU, grade, pack size and selling unit the photo shows, and the right to use it. Legacy `product/*.jpeg` files are unverified. | Pending |

## 4. Awards and credentials — पुरस्कार और प्रमाण

| Item            | What we need                                                                                         | Status  |
| --------------- | ---------------------------------------------------------------------------------------------------- | ------- |
| Award title     | Exact title as printed on the certificate.                                                           | Pending |
| Recipient       | The person or shop named on it.                                                                      | Pending |
| Issuer and date | Who issued it and when. Legacy files suggest "Navratna 2022" and "Swarna 2023"; both are unverified. | Pending |
| Display right   | Confirmation the certificate image may be shown publicly.                                            | Pending |

Fields: `credentials[]` (`title`, `issuer`, `image`).

## 5. Address, hours and who answers — पता, समय और संपर्क

| Item            | What we need                                                                                                                   | Status  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Exact address   | Full visiting address with landmark and pincode, as it should appear to customers.                                             | Pending |
| Visiting hours  | Days and times, including weekly closure and festival exceptions.                                                              | Pending |
| Phone number    | Which number customers should call, and who answers it. Legacy site lists two numbers that conflict with seed data.            | Pending |
| WhatsApp number | Which number receives WhatsApp, and who reads it. Messages are never sent automatically.                                       | Pending |
| Directions link | A `https://www.google.com/maps/…` link the family has opened and checked. Staff geofence coordinates are not a public map pin. | Pending |

Fields: `address`, `hours`, `phone` and `whatsapp` (format `+91XXXXXXXXXX`), `directionsUrl`.
After all five are confirmed, set `contactApproved: true`. Until then call, WhatsApp and
directions buttons stay hidden.

## 6. Delivery coverage and commercial terms — डिलीवरी क्षेत्र और व्यापार की शर्तें

These live in the owner desk (delivery zones and store settings), not in `public-content.ts`.

| Item                 | What we need                                                                                                                         | Status  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Delivery pincodes    | Each pincode actually served, with fee, minimum order, free-delivery threshold and estimate. Practice pincode `800099` is test data. | Pending |
| Unloading and access | What the shop does and does not cover (stairs, narrow lanes, unloading point).                                                       | Pending |
| Cancellation         | When a customer can cancel a COD order, in plain words.                                                                              | Pending |
| Quotation terms      | Default validity period and what "freight included" covers.                                                                          | Pending |
| Payment              | Confirm cash on delivery only. Online payment stays disabled.                                                                        | Pending |

## Sign-off

| Section                | Reviewed by | Date | Notes |
| ---------------------- | ----------- | ---- | ----- |
| 1. Story               |             |      |       |
| 2. Photographs         |             |      |       |
| 3. Brands and products |             |      |       |
| 4. Awards              |             |      |       |
| 5. Contact             |             |      |       |
| 6. Delivery and terms  |             |      |       |
