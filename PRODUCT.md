# Product

<!-- impeccable:product-schema 1 -->

The product truth for Shiv Cement Store's software. Read it before building any screen, together with [DESIGN.md](DESIGN.md) for the look and [AGENTS.md](AGENTS.md) for the working rules. It is public: it names roles and rules, never family members, phone numbers, staff details or money figures.

## Platform

web

The owner desk is a Next.js web app, used in a laptop browser and installed on Android phones. The customer app and the staff app are Expo apps for Android, built on the same design system (one token source, a native kit). The customer website is a separate Next.js app and is not being redesigned now.

## Users

| Who                                  | Where and how                                                                                                                                                    | Their job                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Owners** (two partners)            | One mostly on a phone, standing at the counter, often in sunlight, with large text on; the other on a laptop and a phone. Hinglish by default                    | See the day in one look, confirm orders, watch udhaar and cash, approve stock and money, ask questions |
| **Counter staff** (cashier, manager) | The shop PC, keyboard and mouse, constant interruptions, customers waiting                                                                                       | Take phone and walk-in orders, make bills, receive cash, print receipts                                |
| **Accountant**                       | A laptop, a few times a week; also works in Tally                                                                                                                | Match the app with Tally, read reports, export CSV                                                     |
| **Stock keeper, driver, helper**     | The staff app on budget Android phones, outdoors, dust and gloves, patchy network                                                                                | Mark attendance, receive goods, load and deliver, collect money in the field with proof                |
| **Customers**                        | The customer app or the website; contractors (thekedar), masons, people building their own house, and a contractor's site clerk (munshi) who orders for the site | Check today's rate, order again quickly, track delivery, see what they owe                             |

Every staff member sees only what their role and shop allow. The AI assistant (Saathi) is for owners only.

## Product Purpose

A building-materials shop in Patna, Bihar (cement, sariya, bricks, sand and more) runs every part of its day here: orders from every door, stock across shops and a godown, credit (udhaar), the cash drawer (galla), bills, staff, purchases and the link to Tally.

Success means the owners trust the numbers without asking anyone, nothing is typed twice, a waiting order is confirmed in one tap, a two-item cash bill is made and printed in five steps, and a customer can reorder in two taps.

## Positioning

It is the shop's own system, shaped around how this trade works: Hinglish words, bori and trolley units, credit to known contractors, WhatsApp as the main channel, and cash at the counter. Every door (app, website, phone call, WhatsApp) lands in one confirm queue, and every number on screen can be traced to the entry that made it.

## Operating Context

- **Locations:** two shops and a godown. The business has **two legal firms**; every money entry belongs to one firm explicitly, and udhaar is kept per firm.
- **Doors for orders:** the customer app, the website, phone calls entered at the counter, and WhatsApp. All of them wait in **Pakka karo** until a named person confirms.
- **Money:** cash in the galla, UPI, and udhaar on the khata. Online card payments are off.
- **Tally** stays the accountant's book. The app compares with Tally; Tally never moves the app's stock.
- **Printing:** an 80 mm receipt printer at the counter PC and a 58 mm Bluetooth printer for a phone. Receipts and QR codes are always black on white.
- **Conditions:** interruptions, power and internet cuts, cheap phones, slow networks. Work must survive a lost connection without losing or doubling an entry.

## Capabilities and Constraints

**Money and stock rules the design must respect**

- Ledgers and stock movements are append-only. A mistake is fixed by a reversing entry, never by editing a balance. Screens show both entries.
- A confirm always names the person who confirmed. Nothing says "confirmed", "paid" or "delivered" without a named person and a time.
- Prices, delivery charges and totals come from the server. The screen never computes a price the server has not given.
- Money-moving actions keep their safeguards: a hold before confirming, and a step-up passphrase where the desk already asks for one.
- AI never acts on its own. Anything Saathi proposes is a draft an owner taps to confirm, and every number it shows comes from the database, not from the model.
- Outgoing messages (WhatsApp, SMS, push) are locked while demo data is loaded.

**Languages**

- Three choices: **Hinglish** (Hindi in Latin letters; the desk default), **English**, and **हिंदी** (Devanagari). The choice is saved per person on the server.
- In every language, digits are Latin with Indian grouping (₹1,23,456); product, brand and customer names stay as stored; units keep their trade words (bori, kg, cft, trolley).
- No user-facing text is written into code; it comes from the translation catalogues.

**Words** (use these exact words in every language and screen)

| Word            | Means                                              |
| --------------- | -------------------------------------------------- |
| Aaj             | The owner's home page: today at a glance           |
| Pakka karo      | The confirm queue for orders from every door       |
| Udhaar, khata   | Credit owed by a customer; the customer's ledger   |
| Galla           | The cash drawer and its day sheet                  |
| Vasooli         | Collecting money owed, at the shop or in the field |
| Grahak          | Customer                                           |
| Maal, Kharid    | Goods and stock; purchases from suppliers          |
| Turant bill     | A quick counter bill                               |
| Hazri, Manzoori | Attendance; approvals waiting for an owner         |
| Daam aur offer  | Rates and offers                                   |
| Saathi          | The owners' AI assistant                           |

**Open product decisions** (do not design as if settled)

- Which document a counter bill is (a sale receipt or a GST invoice) and which firm issues it is the accountant's decision.
- Which languages the customer app offers.
- When the redesigned customer app launches.

## Brand Commitments

- The name is **Shiv Cement Store**; the owner desk is "Shiv Cement Desk".
- **Voice:** plain, short and respectful (aap, never tu), like a good munshi talking: no marketing, no exclamation marks, no hype, no emoji.
- **Honesty:** never claim what the system has not checked. No invented delivery times, stock or customer counts, reviews or awards.

## Evidence on Hand

- A real product catalogue with rates (seed data in `apps/api/prisma/seed.ts`; the demo seed builds realistic fake business data).
- Building-advice articles in `content/advisor/`.
- There are **no** customer testimonials, shop photos or published reviews yet. Do not fabricate them; leave a clearly marked gap.

## Product Principles

1. **The answer first.** Each screen opens with what the person came for, at eye level, before any explanation.
2. **Least clicks, least scrolling.** Search, filters and keyboard beat scrolling; hundreds of items must fit in one working screen.
3. **Every number traceable.** A total equals the rows under it, and every row can be opened to its source.
4. **People confirm, software proposes.** Money and stock change only through a named person's action.
5. **Same words, same patterns, everywhere.** One glossary, one component kit, three languages.

## Accessibility & Inclusion

- **Large text:** the desk has a "Bada akshar" switch (×1.125 or ×1.25), and every phone check runs with it on and with Android's font size at its largest.
- **Phones:** body text at least 16 px, figures at least 24 px, rows and touch targets at least 48 px; readable in sunlight.
- **Contrast:** WCAG 2.2 AA in both light and dark themes, checked with axe.
- **Hindi:** Devanagari lines get 1.5 line height and are checked for clipped vowel marks.
- **Motion:** `prefers-reduced-motion` is respected; nothing moves for decoration.
- **Low-end devices:** budget Android phones and slow networks are the baseline, not the edge case.
