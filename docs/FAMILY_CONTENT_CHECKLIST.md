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

## 1. Shop and family story — दुकान और परिवार की कहानी

| Item | What we need | Approved by / date | Status |
| --- | --- | --- | --- |
| Story (English) | 2–4 sentences in the family's words. No years, rankings or "No. 1" claims unless proven. | | Pending |
| Story (Hindi) | Same meaning in Hindi, written or checked by the family. | | Pending |
| Founding year | Only if documented (licence, registration, signboard photo). Legacy site says both "2000" and "24+/25+ years"; these conflict. | | Pending |
| Family members shown | Name, role at the shop, and each person's own consent to appear. | | Pending |

Fields: `story.en`, `story.hi`, `family[]` (`name`, `role`, `image`).

## 2. Photographs and permission — तस्वीरें और अनुमति

| Item | What we need | Permission confirmed | Status |
| --- | --- | --- | --- |
| Shop front | A genuine current photo of the shop. The legacy `store-front.png` is a marked placeholder and must not be used. | ☐ | Pending |
| Inside the shop / stock | Real photos; no customer faces or vehicle numbers without consent. | ☐ | Pending |
| Family photo | Legacy `group.jpeg` needs each pictured person's consent and a caption they approve. | ☐ | Pending |
| Alt text | One plain sentence per photo describing what it shows (English and Hindi). | — | Pending |

Fields: `gallery[]` (`title`, `image`, `alt`). Illustrations on the site are labelled as
illustrations and must never be described as shop photographs.

## 3. Brands, logos and product images — ब्रांड, लोगो और सामान की तस्वीरें

| Item | What we need | Status |
| --- | --- | --- |
| Brands sold | Which brands the shop actually stocks today. The site lists brands from the live catalogue only. | Pending |
| Dealership status | Written authorisation from each manufacturer before any "authorised dealer" wording. None is shown now. | Pending |
| Logos | Permission to display each manufacturer logo. Logos are not shown now. | Pending |
| Product photos | For each product: the exact SKU, grade, pack size and selling unit the photo shows, and the right to use it. Legacy `product/*.jpeg` files are unverified. | Pending |

## 4. Awards and credentials — पुरस्कार और प्रमाण

| Item | What we need | Status |
| --- | --- | --- |
| Award title | Exact title as printed on the certificate. | Pending |
| Recipient | The person or shop named on it. | Pending |
| Issuer and date | Who issued it and when. Legacy files suggest "Navratna 2022" and "Swarna 2023"; both are unverified. | Pending |
| Display right | Confirmation the certificate image may be shown publicly. | Pending |

Fields: `credentials[]` (`title`, `issuer`, `image`).

## 5. Address, hours and who answers — पता, समय और संपर्क

| Item | What we need | Status |
| --- | --- | --- |
| Exact address | Full visiting address with landmark and pincode, as it should appear to customers. | Pending |
| Visiting hours | Days and times, including weekly closure and festival exceptions. | Pending |
| Phone number | Which number customers should call, and who answers it. Legacy site lists two numbers that conflict with seed data. | Pending |
| WhatsApp number | Which number receives WhatsApp, and who reads it. Messages are never sent automatically. | Pending |
| Directions link | A `https://www.google.com/maps/…` link the family has opened and checked. Staff geofence coordinates are not a public map pin. | Pending |

Fields: `address`, `hours`, `phone` and `whatsapp` (format `+91XXXXXXXXXX`), `directionsUrl`.
After all five are confirmed, set `contactApproved: true`. Until then call, WhatsApp and
directions buttons stay hidden.

## 6. Delivery coverage and commercial terms — डिलीवरी क्षेत्र और व्यापार की शर्तें

These live in the owner desk (delivery zones and store settings), not in `public-content.ts`.

| Item | What we need | Status |
| --- | --- | --- |
| Delivery pincodes | Each pincode actually served, with fee, minimum order, free-delivery threshold and estimate. Practice pincode `800099` is test data. | Pending |
| Unloading and access | What the shop does and does not cover (stairs, narrow lanes, unloading point). | Pending |
| Cancellation | When a customer can cancel a COD order, in plain words. | Pending |
| Quotation terms | Default validity period and what "freight included" covers. | Pending |
| Payment | Confirm cash on delivery only. Online payment stays disabled. | Pending |

## Sign-off

| Section | Reviewed by | Date | Notes |
| --- | --- | --- | --- |
| 1. Story | | | |
| 2. Photographs | | | |
| 3. Brands and products | | | |
| 4. Awards | | | |
| 5. Contact | | | |
| 6. Delivery and terms | | | |
