---
name: Naksha 2
description: The design system of Shiv Cement Store's desk, customer app and staff app — paper, ink and one amber, built like a shop ledger.
colors:
  paper-ground: '#F6F4EE'
  paper-surface: '#FBFAF6'
  paper-card: '#FFFFFF'
  ink: '#1F2322'
  ink-secondary: '#4A4F4C'
  ink-muted: '#5B605D'
  rule: '#D9D5C8'
  rule-strong: '#8C877A'
  rail: '#243331'
  rail-ink: '#E9E6DC'
  rail-muted: '#AEB8B4'
  amber: '#E0A42B'
  amber-press: '#C98C14'
  amber-ink: '#7A4E00'
  ok: '#1F7A4D'
  ok-soft: '#E8F4EC'
  warn: '#8A5A00'
  warn-soft: '#FBF1DC'
  danger: '#B23A2F'
  danger-soft: '#F8E6E3'
  info: '#2F6DB5'
  night-ground: '#141512'
  night-surface: '#1A1C18'
  night-card: '#20221E'
  night-ink: '#ECE8DE'
  night-ink-secondary: '#C9C4B8'
  night-ink-muted: '#A39E92'
  night-rule: '#33352F'
  night-rule-strong: '#73766C'
  night-rail: '#0E0F0D'
  night-rail-ink: '#E6E2D8'
  night-rail-muted: '#9C978C'
  night-amber: '#E8B04A'
  night-amber-press: '#D49A2E'
  night-amber-ink: '#F0C26A'
  night-ok: '#6CC596'
  night-ok-soft: '#1D2B22'
  night-warn: '#E9B85C'
  night-warn-soft: '#2E2615'
  night-danger: '#EE8A7C'
  night-danger-soft: '#331D1A'
  night-info: '#8DB3EA'
typography:
  figure:
    fontFamily: 'Hanken Grotesk, Noto Sans Devanagari, system-ui, sans-serif'
    fontSize: '1.75rem'
    fontWeight: 500
    lineHeight: 1.2
    fontFeature: 'tnum'
  headline:
    fontFamily: 'Hanken Grotesk, Noto Sans Devanagari, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: 'Hanken Grotesk, Noto Sans Devanagari, system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 600
    lineHeight: 1.3
  lead:
    fontFamily: 'Hanken Grotesk, Noto Sans Devanagari, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: 'Hanken Grotesk, Noto Sans Devanagari, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.35
  meta:
    fontFamily: 'Hanken Grotesk, Noto Sans Devanagari, system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: 'tnum'
  label:
    fontFamily: 'Hanken Grotesk, Noto Sans Devanagari, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: '0.04em'
rounded:
  none: '0px'
  control: '4px'
  sheet-top: '12px'
  pill: '999px'
spacing:
  '2': '2px'
  '4': '4px'
  '8': '8px'
  '12': '12px'
  '16': '16px'
  '20': '20px'
  '24': '24px'
  '32': '32px'
  '40': '40px'
  '48': '48px'
  '64': '64px'
components:
  button-primary:
    backgroundColor: '{colors.amber}'
    textColor: '{colors.ink}'
    typography: '{typography.lead}'
    rounded: '{rounded.control}'
    height: '44px'
    padding: '0 16px'
  button-secondary:
    backgroundColor: '{colors.paper-card}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    height: '44px'
    padding: '0 16px'
  input:
    backgroundColor: '{colors.paper-card}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    height: '44px'
    padding: '0 12px'
  filter-chip:
    backgroundColor: '{colors.paper-surface}'
    textColor: '{colors.ink-secondary}'
    typography: '{typography.meta}'
    rounded: '{rounded.pill}'
    height: '32px'
    padding: '0 12px'
  filter-chip-selected:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper-card}'
    rounded: '{rounded.pill}'
  status-stamp-ok:
    backgroundColor: '{colors.ok-soft}'
    textColor: '{colors.ok}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '2px 8px'
  status-stamp-warn:
    backgroundColor: '{colors.warn-soft}'
    textColor: '{colors.warn}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '2px 8px'
  status-stamp-danger:
    backgroundColor: '{colors.danger-soft}'
    textColor: '{colors.danger}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '2px 8px'
  table-row:
    backgroundColor: '{colors.paper-card}'
    textColor: '{colors.ink}'
    typography: '{typography.meta}'
    height: '36px'
    padding: '0 12px'
  kpi-tile:
    backgroundColor: '{colors.paper-card}'
    textColor: '{colors.ink}'
    typography: '{typography.figure}'
    rounded: '{rounded.none}'
    padding: '12px 16px'
---

# Design System: Naksha 2

Read [PRODUCT.md](PRODUCT.md) first for who uses these screens and the rules they must respect. This file is the visual law for the owner desk (`apps/admin`), the customer app (`apps/mobile`) and the staff app (`apps/staff`). The customer website (`apps/storefront`) keeps its own look for now.

**Status, November 2026.** The tokens below live in `packages/tokens`, in light and dark. `npm run theme:css` writes the desk's `packages/design/src/tokens.css` from them, and both Expo apps import them. The desk follows dark, and is on Hanken Grotesk. The old `--shiv-*` names are aliases of the new ones; new CSS uses the new names. The apps' screens stay light until they move to `useStyles` (phases B5 and G1). `scripts/design-guards.test.mjs` refuses any raw colour or px font size outside the tokens.

## Overview

**Creative North Star: "The Shop Ledger"**

The screens should feel like the shop's own bound ledger: warm paper, dark ink, ruled columns and a double rule above every total. They should not look like a generic SaaS dashboard. The ink is calm, the amber marks the one thing to do next, and the hierarchy comes from type weight, alignment and rules, not from boxes, shadows or colour.

This is a working tool for people standing at a counter, often on a phone in sunlight, with customers waiting. Density is high on a laptop and generous on a phone. The answer to "how is today?" sits in the first 200 px of every page. Explanations live in a "?" popover or an empty state, never above the work. The dark theme, "night ledger", is the same paper at night: warm near-black and cream ink, never blue-black.

**Key Characteristics:**

- Paper and ink, one amber, natural status colours.
- One family, Hanken Grotesk, with Noto Sans Devanagari for Hindi.
- Tables are ruled ledgers: tabular figures, right-aligned money, a double rule before money columns and above totals.
- Flat at rest; one shadow level, only for overlays.
- Square paper objects, 4 px controls, round chips and stamps.
- One main action per screen.

## Colors

A warm paper ground, near-black green-grey ink, one amber for action, and muted status colours that read as ink stamps rather than traffic lights. Every colour exists in both themes; the `night-*` keys are the dark values of the same roles.

### Primary

- **Counter Amber** (`amber`; night `night-amber`): the one main action on a screen, and the current selection in the rail and segmented controls. Text on amber is always `ink` (7.2:1). Pressed state is `amber-press`.
- **Amber Ink** (`amber-ink`; night `night-amber-ink`): amber used as text or an icon (6.5:1 on paper). This is the only way amber appears as text.

### Neutral

- **Paper Ground** (`paper-ground`): the page behind everything.
- **Paper Surface** (`paper-surface`): toolbars, table headers, the second layer.
- **Paper Card** (`paper-card`): the paper itself: cards, sheets, the ledger, drawers.
- **Ledger Ink** (`ink`): main text and every number (14.5:1).
- **Secondary Ink** (`ink-secondary`): secondary text, labels (7.6:1).
- **Faded Ink** (`ink-muted`): muted text and placeholders (5.8:1). Still readable; there is no lighter text colour.
- **Ruling** (`rule`): hairlines and column rules. Decorative only.
- **Strong Ruling** (`rule-strong`): input borders and the ledger double rule (3.6:1, enough for a non-text boundary).
- **Rail Green** (`rail`, with `rail-ink` and `rail-muted`): the desk's side rail, the only large dark area in the light theme.

### Status

- **Paid Green** (`ok`, `ok-soft`): paid, in stock, done, delivered.
- **Waiting Ochre** (`warn`, `warn-soft`): low or old stock, waiting, needs a look.
- **Due Red** (`danger`, `danger-soft`): due, short, failed, and destructive actions.
- **Link Blue** (`info`): links and the focus ring.

### Named Rules

**The One Amber Rule.** Amber marks one thing per screen: the main action or the current selection. Never a decoration, a header band or a second button.

**The Amber Is Not Text Rule.** Amber on paper is 1.7:1. Use `amber-ink` for amber words and icons.

**The Black-On-White Print Rule.** Receipts, printed bills, salary slips and QR codes are black on white in both themes, always on a white plate.

The material colours used in the engraved product drawings (kraft, steel, brick, sand, stone) are for drawings only, never for UI.

## Typography

**Body Font:** Hanken Grotesk (400, 500, 600), with system-ui as the fallback.
**Hindi:** Noto Sans Devanagari (400, 500, 600), loaded only when Devanagari text appears. On Android the apps use the system's copy.

**Character:** One sturdy, plain grotesk for everything, like a well-set printed register. There is no display face; hierarchy comes from size, weight and alignment.

### Hierarchy

| Role         | Desk                            | Phone | Use                                    |
| ------------ | ------------------------------- | ----- | -------------------------------------- |
| **Figure**   | 500, 28 px                      | 30 dp | KPI numbers and totals                 |
| **Headline** | 600, 24 px                      | 26 dp | App large titles                       |
| **Title**    | 600, 20 px                      | 20 dp | Desk page titles, app screen titles    |
| **Lead**     | 500, 16 px                      | 17 dp | Desk section titles; app body text     |
| **Body**     | 400, 14 px                      | 15 dp | Desk body text; app secondary text     |
| **Meta**     | 400, 13 px                      | 13 dp | Table cells, timestamps, chips         |
| **Label**    | 600, 12 px, +0.04em, small caps | 12 dp | Rail group labels, table group headers |

On a phone the desk switches to its own minimums: body text at least 16 px and figures at least 24 px. The "Bada akshar" switch scales the whole root by ×1.125 or ×1.25. Sizes are fixed rem steps; no fluid `clamp()` type.

### Named Rules

**The Tabular Rule.** Every number uses tabular figures (`font-variant-numeric: tabular-nums`). Money is right-aligned, with ₹ and Indian grouping (₹1,23,456). Paise appear only where money must be exact (galla, bills, khata); elsewhere show whole rupees.

**The No Light Prices Rule.** Prices and money are never set below weight 400 or in a muted colour.

**The Devanagari Breathing Rule.** When Hindi is active, line height goes from 1.35 to 1.5 (`--leading`), and short labels such as tabs and chips from 1.2 to 1.45 (`--leading-tight`), so vowel marks do not clip. `<html lang="hi">` switches both. Check it at Android's largest font size.

## Layout

- **Spacing:** 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Nothing else.
- **Desk shell:** a grouped side rail (collapsible to icons) and a top bar holding global search (`/`), the firm and shop switcher, Saathi, the theme toggle, the language toggle and the person menu. On a phone, bottom tabs: Aaj · Pakka karo · [+] · Saathi · Menu.
- **Density by device:** desk tables use 36 px rows and 13–14 px text, and desk forms use 44 px controls. On a phone, rows and touch targets are at least 48 px. App lists use 56 dp rows, or 64 dp for rich rows.
- **Every size works, 320 px to 2560 px.**
  - **Breakpoints:** phone up to 599, tablet 600 to 1023, laptop 1024 to 1439, wide from 1440.
  - **Phone:** the rail becomes bottom tabs and Menu; DataTable becomes two-line rows; the drawer becomes a full screen; the KPI strip scrolls sideways.
  - **Tablet and wide:** on a tablet the rail collapses to icons and the drawer lays over the list. On a wide screen content stops at 1600 px. Extra width goes to tables, never to stretched forms, which stay at most 720 px wide.
  - **Also counted:** landscape phones, split screen, and Android font scale up to 2.0. The apps cover phones from 320 dp and tablets, in both orientations.

**The No Sideways Page Rule.** The page never scrolls sideways at any width. Only a DataTable may scroll sideways, inside itself, with its first column sticky.

### Page templates

```
LIST PAGE (Stock, Orders, Grahak, Udhaar, Purchases, Vasooli)
┌ PageHeader: Title · context line ······················ [quiet] [quiet] [MAIN] ┐
├ KPI strip: [tile][tile][tile][tile][tile]   (each tile is a filter)            ┤
├ FilterBar: [/ search……] (chips with counts) [location ▾] [more ▾] [⤓]          ┤  sticky
├ DataTable: sticky header, groups, ══ before money, totals ══                    ┤
└ Pager: 1–50 of 1,240                                      Drawer → (row opens)  ┘

DAY SHEET (Galla, Hazri)        QUEUE (Pakka karo, WhatsApp)      FORM (Turant bill, Naya order)
date stepper + shop + stamp     list left · card right            keyboard first, live preview right
summary band, ══ totals         one-tap actions in the card       one main action, totals ══
ledger columns + side counter   undo toast                        draft saved automatically

REPORT: KPI strip → chart (with a "table" toggle) → DataTable → export
SETTINGS: section list on the left → forms in cards → each save says what changed
```

### Named Rules

**The Eye-Level Rule.** The title, one context line ("Sab dukaan · 7 Nov, 4:30 pm") and 3 to 5 KPI tiles or one status line sit inside the first 200 px. No intro paragraphs.

**The Filter-Not-Scroll Rule.** Lists get search, filter chips with live counts ("Kam 12") and a location control in a sticky bar. Filters live in the URL, so a link or a Saathi card opens the same view.

**The Drawer Rule.** A row opens a right-side drawer with its own URL (`?open=<id>`), and the list stays visible. On a phone the drawer becomes a full screen with a back button.

## Elevation & Depth

The system is flat. Depth comes from the three paper tones (ground, surface, card) and hairline rules, not from shadows. There is exactly one shadow level, used only for overlays: drawer, popover, sheet and dialog. Stacking order, from bottom to top: base, sticky, drawer, popover, toast, modal.

**The Hairline Rule.** Separate with a 1 px `rule` line, never with a shadow or a gap filled with a different background.

## Shapes

- **Paper objects are square** (0 px): the ledger, receipts, bills, KPI tiles, cards that represent a sheet of paper.
- **Controls** (buttons, inputs, selects, segmented controls) use a 4 px radius.
- **Only chips and status stamps are fully round** (999 px).
- **Phone bottom sheets** round their top corners at 12 px, to feel native.
- **The ledger double rule:** two `rule-strong` lines, 2 px apart, before money columns and above every total.

## Components

The kits are the only source of UI parts. If a page needs something the kit lacks, add it to the kit first, then use it.

- **Web kit:** `packages/design`, used by the desk.
- **Native kit:** a shared package used by both Expo apps.

### Buttons

Plain and firm.

- **Primary:** amber with ink text, 44 px tall, 4 px radius. One per screen. On a phone's bottom bar it may be full width; nowhere else.
- **Secondary:** paper card with a `rule-strong` border and ink text.
- **Quiet:** no fill, `ink-secondary` text, for other actions.
- **Danger:** `danger` text with no fill. Asks once before acting.
- **Names in code:** `primary`, `secondary`, `quiet`, `danger`, and `sm` for dense laptop toolbars (below 1024 px every button stays 48 px). `ghost` is the old name of `quiet`; new code uses `quiet`.
- **Motion:** 120 ms on hover and press. The focus ring is a 2 px `info` outline with an offset.

### Inputs

`paper-card` fill, `rule-strong` border, 4 px radius, 44 px tall. On focus, the border turns `info` and a ring appears. An error shows a `danger` border and a message under the field that says what to fix.

The input set: MoneyInput and QtyStepper for amounts; Combobox for searching customers, products and suppliers; DateInput with quick chips (Aaj, Kal, pick a date).

### Filter chips and status stamps

- **Filter chips:** round, `paper-surface` with `ink-secondary` text and a live count. When selected, they invert to ink with paper text.
- **StatusStamp:** a single component with one fixed vocabulary (Baaki, Pakka, Raaste mein, Pahuncha, Band, Khula, Farq…). Each meaning has one colour: `ok`, `warn`, `danger` or neutral, always in the soft-background style.

### DataTable (signature component)

The most important part: a ruled ledger, built on TanStack Table and TanStack Virtual.

- **Columns:** typed (text, money, qty, date, status, actions), which sets alignment, number format and the phone role (primary, secondary or hidden). Sticky header and first column; a double rule before money columns and above totals.
- **Data:** sorting, filtering and cursor paging on the server, with a total count; grouping with subtotals; CSV export of the current filter, built on the server.
- **Interaction:** row hover actions and a row menu; multi-select with a bulk action bar; arrow keys move, Enter opens, `x` selects.
- **States:** skeleton rows while loading; an empty state that says what will appear and offers one action; an error state.
- **Phone:** the same component renders two-line rows: primary text on the left, the figure on the right, secondary text below.
- **Safety:** a bulk action only ever gets the chosen rows that are on screen; a row a filter or refetch took away is never acted on. Groups stay open or folded as the person left them.
- **Size:** above 200 rows the table draws only what is on screen (10,000 rows scroll at under 50 ms a frame). On a laptop the table scrolls in its own area under a sticky header; on a phone the rows scroll with the page.

### KPI tiles and page header

- **KPI tile:** square paper. A label, the figure in the Figure style, the change since the comparison period, and an optional sparkline. Clicking a tile applies its filter. Every tile equals the sum of its table.
- **PageHeader:** the title, a context line, then quiet actions and the one main action on the right.

### Navigation

- **Desk rail:** `rail` background with `rail-ink` items, and small-caps group labels in `rail-muted`. The current item has an amber marker. Badges show counts only where action is needed.
- **Phone:** bottom tabs with a centre [+] that opens an action sheet. Menu lists the same groups as the rail, with a search box at the top.

### Saathi cards

Saathi (the owners' AI) answers with kit parts, not chat bubbles full of prose: an AskBar, a message stream, and KpiCard, TableCard, DraftCard and ChoiceCard.

- A DraftCard shows exactly what will change, and it needs a tap.
- No sparkle icons or gradient "AI" styling: Saathi looks like the rest of the ledger.

### Feedback and charts

- **Feedback:** a toast is short and carries an undo for inline edits. A banner (info, warn or error) sits at the top of the area it concerns. Errors say what was saved and what was not.
- **Charts:** small themed SVG bar, stacked bar, line and sparkline charts, in colour-blind-safe ink-to-kraft steps, each with a "see as table" toggle.

### Icons and motion

Icons are Lucide only, 1.5 px stroke, at 16, 20 or 24 px, always next to a word except in well-known icon buttons labelled for screen readers. Motion is 120 ms for hover and press, 180 ms for drawers and sheets, ease-out, never decorative; `prefers-reduced-motion` turns it off.

## Do's and Don'ts

### Do:

- **Do** put the answer (title, context line, KPI tiles) inside the first 200 px of every page.
- **Do** use DataTable for every list on the desk: one column definition gives a table on a laptop and rows on a phone.
- **Do** open details in a URL-synced drawer, and keep the list visible.
- **Do** use inline edits with an undo toast for common changes (quantity, rate within its limit, status). Money-moving actions keep their hold and step-up checks.
- **Do** make every KPI tile equal the sum of its table, and let every row open to its source entry.
- **Do** show "—" or a designed empty state when there is nothing.
- **Do** take every word from the translation catalogues and the glossary in PRODUCT.md, and check each page in Hinglish, English and हिंदी.
- **Do** check each rebuilt page at 1440 light, 390 light and 1440 dark, with axe in both themes, and on a budget Android phone at its largest font size.

### Don't:

- **Don't** use gradients, glass or blur, purple, emoji as icons, sparkle "AI" icons, or giant rounded cards with drop shadows.
- **Don't** put marketing heroes or intro paragraphs inside the app.
- **Don't** use more than one amber button on a screen. Full-width amber appears only in a phone screen's bottom bar.
- **Don't** repeat the same text on every row; say it once in the header or a tooltip. For example, the old Stock page repeated "Rate badla … 25 par chetawani" on every card.
- **Don't** show walls of "₹0.00".
- **Don't** open a modal when an inline edit or a drawer works.
- **Don't** lay out lists as one card per row or a grid of cards. The old Stock page used a five-column card grid, and the redesign replaces it with a grouped DataTable.
- **Don't** add a colour, spacing step or font size outside the tokens. Lint rules will reject hex, rgb and hsl values and px font sizes in page styles.
- **Don't** copy a component into a page when the kit has one.
- **Don't** use Inter, Mukta or any second Latin font.
