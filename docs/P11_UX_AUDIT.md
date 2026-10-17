# Phase 11 UX audit: first run and look-and-feel

Date: 18 Oct 2026 · Branch `codex/p11-first-run` (from `codex/p10-p2-fixes` at `a40512e`)

What a brand-new customer and a brand-new shop owner meet, and where the website, the app and
the desk still look unfinished. Ranked P0 (blocks a first order or shows something false), P1
(costs a first-time user real effort or trust), P2 (polish).

## How this was checked

- **Screenshots**: `docs/screenshots/p11/before/` (153 JPEGs). Demo catalogue
  (`npm run demo -- prepare` on the throwaway `shiv_shots_test`) and an empty new store
  (`shiv_empty_test`, migrations plus one desk owner, file names start `empty-`). Website at 360,
  390, 768 and 1440 px in English and Hindi (360 and 768 first screen only), Expo web app at 390
  px, desk at 390 and 1440 px. Taken with `scripts/shots/` (`prepare.mjs`, `run.mjs`).
- **Measured checks**: `scripts/shots/audit.shots.ts` → `before/audit-demo.json`. Tap targets
  under 44 px, unnamed controls, `h1` count, page height, visible placeholder text, text contrast
  against the nearest solid background, first keyboard stops. Website `/`, `/products`, `/cart`,
  `/account` at 390 and 1440 px; app home and Materials in both languages.
- **Lighthouse 12.8.2**: production website build, mobile defaults (simulated slow 4G, 4× CPU),
  median of 3 runs, home page with the demo catalogue → `before/lighthouse-home.json`
  (`scripts/shots/lighthouse.mjs`).
- **Production builds**: `apps/storefront/lib/review.ts:3-4`. `ReviewNote` boxes show only when
  `NEXT_PUBLIC_CONTENT_REVIEW=on` or outside production. The dev screenshots show them; a
  production build does not. The app's TEST mark shows only when `appEnv !== 'production'`
  (`apps/mobile/src/App.tsx:43`).

## Baseline numbers (before any Phase 11 change)

| Check                              | Result                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Lighthouse performance / a11y / BP | 87 / 100 / 93                                                                 |
| LCP · FCP · TBT · Speed Index      | 2.46 s · 0.76 s · 29 ms · 5.98 s                                              |
| CLS                                | **0.141** (over the 0.1 "good" line), attributed to `<main>`                  |
| Transfer (home)                    | 369 KiB                                                                       |
| Tap targets < 44 px                | 0 on the website pages above; 0 in the app screens above                      |
| Unnamed controls                   | 0                                                                             |
| Text under WCAG AA contrast        | 0 found (method: computed colours; text over images or gradients not covered) |
| `h1` per page                      | 1 on every website page                                                       |
| Home page height                   | **7,375 px at 390 px** (≈ 9 phone screens), 4,517 px at 1440 px               |
| Lighthouse failed a11y audit       | `label-content-name-mismatch` on the header brand link                        |

## P0: fix before anyone outside the family uses it

### P0-1 · A placeholder is visible in production: "The shop's own photograph goes here"

`apps/storefront/components/shop-content.tsx:72-90`. With no approved photo (C5 pending), the home
page shows an empty grey slot labelled "The shop's own photograph goes here / यहाँ दुकान की
असली तस्वीर आएगी". It is not behind `ReviewNote`, so a production build shows it to customers.
It reads as an unfinished site. Screenshot: `before/storefront/home-390-en.jpg` (the grey panel
above "For the work that makes a home"). The audit script finds it on `/` at both widths.
**Fix**: show nothing in production until a photo is approved; keep the labelled slot only in
review mode.

### P0-2 · After placing an order, nobody says what happens next

- Website: checkout sends the customer to `/orders/<id>?confirmed=1`
  (`apps/storefront/components/checkout.tsx:123`), but `confirmed` is never read. The page
  heading is "Your order, in progress." with a status log. Screenshot:
  `before/storefront/order-detail-390-en.jpg`.
- App: goes to the order screen (`apps/mobile/src/checkout.tsx:463`), which shows a four-step
  status tracker. "The store has seen your order" appears only after the desk acknowledges it.
  Screenshot: `before/app/order-detail-en.jpg`.
- Neither says the shop will call to confirm, or what to keep ready. For a first COD order
  (cash in hand, someone at the site) this is the moment of most doubt.

### P0-3 · A new store's desk gives the owner no path to the first order

The production migrations create no delivery zones and no products. On the empty store, Today
shows rows of zero counters, an empty table and one side card. Screenshots:
`before/desk/empty-today-1440-hi.jpg`, `before/desk/empty-today-390-en.jpg`. The only setup hint
is a one-line note inside Finance & settings (`apps/admin/components/operations.tsx:381-388`).
Meanwhile customers on the website see an empty rate board, "no materials" and a pincode check
that fails for every pincode (`before/storefront/empty-home-390-hi.jpg`). Papa and Chacha need a
checklist that says what to do, in what order, and ticks itself.

## P1: costs a first-time customer effort or trust

### P1-1 · Home page length: the catalogue and the pincode check come late

`apps/storefront/components/home.tsx:25-190`. The order is: hero, "Two ways to buy" (two full
cards with three bullets each), catalogue preview, brands, delivery check, shop story,
FAQ/assistant, "Before you buy". At 390 px the page is 7,375 px. The catalogue starts about 3
screens down (≈ 2,400 px) and the pincode check about 6 screens down (≈ 4,700 px) (`before/storefront/home-390-en.jpg`).
The "Two ways to buy" cards repeat what the hero buttons already offer.

### P1-2 · The blank gap beside the home hero (≥ 900 px)

`apps/storefront/app/globals.css:2385-2405`. Above 900 px the headline spans the width; under it,
the copy sits in column 1 (7fr) and the rate board in column 2 (5fr). The copy column ends about
560 px from the top, while the board runs to about 890 px with five materials. That leaves an
empty block about 330 px tall to the left of the board. Screenshot:
`before/storefront/home-fold-1440-en.jpg`.

### P1-3 · The pincode is forgotten, and the basket cannot say what delivery costs

`apps/mobile/src/catalog.tsx:256` and `apps/storefront/components/delivery.tsx:12` keep the
pincode in component state only. Leave the screen and it is gone. The basket then says "Delivery
is calculated after you choose an address" (`apps/storefront/components/basket.tsx:136`). A guest
cannot see the fee or minimum for their site until after sign-in, address entry and review.
New addresses do not start from the pincode the customer already typed.

### P1-4 · No name is asked after first sign-in

App (`apps/mobile/src/store.tsx:538-560`) and website (`apps/storefront/components/account.tsx:124`)
go straight on after the code. The name is only editable from Account. Effects: no greeting, and
on the website the new-address form starts with an empty "Recipient name" and phone
(`apps/storefront/components/account.tsx:596-606`), while the app pre-fills both.

### P1-5 · Checkout does not pick the saved address, and the disabled button gives no reason

`apps/storefront/components/checkout.tsx:200-210` and `AddressBook`. A customer with one saved
address lands on checkout with its radio button unticked, and "Review current order" is greyed
out with no explanation. Screenshot: `before/storefront/checkout-390-en.jpg`.

### P1-6 · Cumulative layout shift 0.141 on the mobile home page

Lighthouse attributes it to `<main id="main">` and lists no cause. I could **not** reproduce it
with the browser's layout-shift API in a throttled Chrome at Lighthouse's device settings
(412×823, 1.75×, Android UA): the largest shift there was 0.001 (the rate-board stamp moving
11 px). It needs a performance-trace review. Phase 11 changes to the hero and home order may
move it; the AFTER run reports what happened.

### P1-7 · Large text: the website header breaks up at 200 %

With the root font at 200 % (`before/storefront/home-390-hi-large-text.jpg`), the Hindi brand
name wraps to three lines and the nav wraps to two rows. The headline then fills the first
screen. Customers who set phone text to "huge" are common on budget phones. The app is better
behaved: Teko headings are already capped at 1.5×.

### P1-8 · The app's header calls an unconfirmed number

`apps/mobile/src/App.tsx:168,218-233` show Call and WhatsApp in the header from
`StoreSettings.phone`, which defaults to +91 9297513707 (`schema.prisma:380`). The website hides
contact until `contactApproved` (C2). Aman chose "hide until confirmed" for the new
"what happens next" panel. **Decision needed** on whether the existing header buttons should
follow the same rule (not changed in this phase).

## P2: polish

| #    | Where                                                  | Problem                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 | `apps/storefront/components/order-history.tsx:175-182` | Empty orders: "Your first project starts here." and a button, with no sentence on what will appear.                                                                                                                                                                                |
| P2-2 | `apps/storefront/components/account.tsx:722-729`       | No saved addresses: a sentence only. The "Add address +" link is above it, small, and the form does not open by itself.                                                                                                                                                            |
| P2-3 | `apps/storefront/components/delivery.tsx:131-155`      | Unserved pincode: "Please confirm delivery arrangements with the store", with no next step. A served pincode ends with "Confirm timing and charges with the store before purchase.", although checkout already shows the current terms. V3 asked for no "confirm with store" copy. |
| P2-4 | `apps/storefront/components/shell.tsx:20`              | Brand link `aria-label="Shiv Cement Store — home"` leaves out its visible place line (Lighthouse `label-content-name-mismatch`) and stays English in Hindi.                                                                                                                        |
| P2-5 | Category names (data)                                  | Category tabs stay English in Hindi ("Aggregates", "Bricks & blocks"; `before/storefront/products-390-hi.jpg`). Categories have no Hindi field. Fixing it needs a schema change, so it is **not done**: noted for a later phase.                                                   |
| P2-6 | Desk Today on an empty store                           | Four zero stat cards and five zero queue buttons take the first screen before anything useful (`before/desk/empty-today-390-en.jpg`).                                                                                                                                              |
| P2-7 | Website empty store                                    | "Two ways to buy", an empty rate board and "No materials found" all show at once (`before/storefront/empty-home-390-hi.jpg`). Acceptable once the owner checklist (P0-3) is done before launch.                                                                                    |
| P2-8 | Focus order                                            | Fine: skip link, brand, nav, assistant, language, then the hero actions. No change needed.                                                                                                                                                                                         |

## What is already good (keep it)

- Every tap target measured is at least 44 px; the app uses 48 dp.
- No text under AA contrast on the measured screens. Direction A's muted and accent tokens
  pass on the ground and paper tones.
- One `h1` per website page, a skip link, labelled form fields, live regions for basket
  feedback.
- The app's language chooser, empty basket ("Browse materials") and empty orders ("Your orders
  and delivery updates will appear here.") already say what to do next.
- The offline bar in the app ("Cannot reach the store… Retry") and the website's
  sign-in-check message explain what still works.

## Fix order for Phase 11

1. P0-1, P0-2, P0-3 (placeholder, what happens next, owner checklist).
2. P1-3, P1-4, P1-5 (remember the pincode, ask the name once, pick the address).
3. P1-1, P1-2 (shorter home, no hero gap), then P1-7 (large-text header) and P2-1 to P2-4.
4. P1-6 re-measured after the home changes; P1-8 and P2-5 are left for Aman to decide.
