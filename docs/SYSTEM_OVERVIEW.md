# Shiv Cement Store: how the pieces fit together

One shop, four things people use, one source of truth.

```
 Customers                          Shop family (Papa, Chacha)
 ┌────────────────────┐ ┌──────────────────────┐   ┌────────────────────────────┐
 │ Android app        │ │ Website              │   │ Owner desk                 │
 │ apps/mobile (Expo) │ │ apps/storefront      │   │ apps/admin (Next.js)       │
 │ token sign-in      │ │ (Next.js) cookies    │   │ cookies + staff passphrase │
 └─────────┬──────────┘ └──────────┬───────────┘   └─────────────┬──────────────┘
           │ HTTPS JSON /api/v1     │ HTTPS JSON                   │ HTTPS JSON + live stream
           └───────────────┬────────┴──────────────┬───────────────┘
                           ▼                       ▼
                ┌──────────────────────────────────────────┐
                │ API: apps/api (NestJS)                   │
                │ rules, prices, stock, orders, quotes,    │
                │ sign-in, assistant, Rate Studio, audit   │
                └───────┬───────────────────────┬──────────┘
                        ▼                       ▼
            ┌─────────────────────┐   ┌──────────────────────────────────────────┐
            │ PostgreSQL (Prisma) │   │ Outside services (switched on per env):  │
            │ the only database   │   │ Twilio SMS codes · Razorpay (off) ·      │
            └─────────────────────┘   │ Firebase push · R2 photos · OpenAI for   │
                                      │ the assistant and Rate Studio · Sentry   │
                                      └──────────────────────────────────────────┘
 packages/shared: one copy of the rules every client uses (schemas, Hindi labels and errors,
 quantity rules, dates, rates, theme, guest basket, app-version policy).
```

**Clients never talk to each other or to the database.** Everything goes through the API, so a
price Papa changes on the owner desk is what the app and website show seconds later. The API
announces changes over a live stream (`GET /events` for customers, `GET /admin/events` for the
desk); clients then re-read what they need.

## What each product does

| Feature                                                                       |   Android app   |     Website      |                   Owner desk                   |
| ----------------------------------------------------------------------------- | :-------------: | :--------------: | :--------------------------------------------: |
| Today's rates (cheapest in-stock per material)                                |     ✓ Home      |      ✓ Home      |           Rate Studio publishes them           |
| Browse, search, filter, compare                                               |        ✓        |        ✓         |               Products and stock               |
| Basket as a guest, merged at sign-in                                          |        ✓        |        ✓         |                       —                        |
| Cash-on-delivery order with review and consent                                |        ✓        |        ✓         |        Receives, acknowledges, fulfils         |
| Order tracking, reorder, cancel, share summary                                |        ✓        |        ✓         |     Status, collection, delivery, refunds      |
| Bulk quote request, per-revision acceptance                                   |        ✓        |        ✓         | Price, freight, send, revise, convert to order |
| Shiv Sahayak assistant (voice in the app)                                     |        ✓        |        ✓         |                       —                        |
| Delivery pincode check                                                        |        ✓        |        ✓         |           Delivery zones and charges           |
| Hindi and English                                                             | ✓ (Hindi first) |        ✓         |      ✓ Hindi first (delivered in Phase 4)      |
| Account, addresses, signed-in devices, delete account                         |        ✓        | ✓ (W1–W3 wave 2) |                 Customers list                 |
| Stock ledger, counter sale, damage, returns                                   |        —        |        —         |                       ✓                        |
| Rate Studio: photo of a supplier sheet → reviewed prices → WhatsApp rate card |        —        |        —         |                       ✓                        |
| Audit trail, staff sessions, demand pause switches                            |        —        |        —         |                       ✓                        |
| Forced app update (`/client-config`)                                          |        ✓        |        —         |          Set by the server's settings          |

## How the API is organised

| Area                | Main routes                                                                                                                                                                              | Who calls it           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Sign-in             | `POST /auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `/auth/session`, `/auth/sessions`                                                                                         | All three              |
| Catalogue           | `GET /products`, `/products/:id`, `/categories`, `/brands`, `/store`, `/delivery/:pincode`, `/client-config`, `/events`                                                                  | App, website (public)  |
| Basket and checkout | `GET /cart`, `PUT /cart/items`, `POST /cart/merge`, `POST /checkout/review`, `POST /orders`                                                                                              | App, website           |
| Orders              | `GET /orders`, `/orders/:id`, `POST /orders/:id/reorder`, `/orders/:id/cancel`                                                                                                           | App, website           |
| Quotes              | `POST /quotes`, `GET /quotes`, `POST /quotes/:id/respond`                                                                                                                                | App, website           |
| Account             | `GET/PATCH /me`, `/me/addresses`, `POST /me/devices`, `POST /me/delete`                                                                                                                  | App, website           |
| Assistant           | `POST /assistant`, `GET /shop-content`                                                                                                                                                   | App, website           |
| Owner work          | `/admin/work`, `/admin/events`, `/admin/orders`, `/admin/quotes`, `/admin/products` (incl. stock movements), `/admin/delivery-zones`, `/admin/store`, `/admin/customers`, `/admin/audit` | Owner desk             |
| Rate Studio         | `/admin/rate-studio/batches`, `/cards`, `/providers`                                                                                                                                     | Owner desk             |
| Payments (off)      | `/payments/orders`, `/payments/verify`, `/payments/webhook`                                                                                                                              | App, website, Razorpay |
| Health              | `/health`, `/health/live`, `/health/ready`                                                                                                                                               | Hosting platform       |

### Sign-in and trust

- A customer proves their phone with a 6-digit SMS code. The **app** keeps a refresh token in the
  phone's secure storage and sends a short-lived bearer token. The **website** and **owner desk**
  use HTTP-only cookies on the shop's own domain; that is why hosting needs one domain with
  `shop.`, `admin.` and `api.` subdomains.
- Staff also need a passphrase, and every owner action is written to the audit log.
- In local development the code is shown on screen (mock mode). Mock mode refuses anything that
  is not a direct loopback request, so it can never be used through a public link.

### Money safety (why orders never double)

- **Review then order:** `POST /checkout/review` freezes prices, delivery fee and total for 5
  minutes. `POST /orders` needs that review and a one-time request key. If the reply is lost, the
  app re-sends the same key and gets the same order back.
- The same idempotency covers the guest-basket merge, reorder and quote requests.
- Stock is reserved by the order and returned by cancellations or refused deliveries; every
  movement is in the stock ledger.

## Where the code lives

| Path              | What                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `apps/api`        | NestJS API, Prisma schema and migrations, integration and workflow tests |
| `apps/mobile`     | Android app (Expo SDK 55), Maestro journeys and drills in `.maestro/`    |
| `apps/storefront` | Customer website (Next.js 16)                                            |
| `apps/admin`      | Owner desk (Next.js)                                                     |
| `packages/shared` | Rules and words shared by all of the above                               |
| `tests`           | Browser journeys across the website, owner desk and the app's web build  |
| `scripts`         | Local services, Android build/QA tools, security scan, icon generator    |
| `docs`            | Plans, phase reports, runbooks, checklists                               |
