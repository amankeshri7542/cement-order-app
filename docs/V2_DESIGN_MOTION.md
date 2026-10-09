# Shiv customer experience — design and motion

## Direction, 9 October 2026

Subject: a family building-material shop in Patna. The site helps homeowners buy clearly and contractors assemble a serious multi-material request. The shop's exact family history, gallery, address, telephone and credentials still require approval.

Palette: mineral ivory `#F5F3ED`, paper `#FFFFFF`, blueprint ink `#173345`, clay `#B45438`, pale limestone `#E5E8E2`, slate `#55646C`. Ink carries navigation, quantities and headings; clay is reserved for customer actions. No invented live/best-seller badges.

Type: Trebuchet MS display, Avenir Next/Segoe UI body; Kohinoor Devanagari/Noto Sans Devanagari system fallbacks. Prices use tabular numerals. Functional copy starts at 15–16px. Hindi can wrap without clipping.

## Reference observations

- https://normcph.com/ — project-first composition and material focus. Adapt the breathing room, not the full-screen carousel; shopping must begin sooner. Initial screenshot caught its loading state; no claim of completed visual review of that frame.
- https://www.ultratechcement.com/ — separate homeowner guidance, products and tools; translate that into clear retail and bulk routes. Avoid advertising carousels and unsupported manufacturer claims.
- https://www.ikea.com/in/en/ — prominent search, category discovery, postal-code context and familiar basket access. Keep those utilities near the buying task without copying the brand.

Sources were opened live and text/screenshots retained in `.local/v2-customer/reference-*`. No source imagery is copied into the shop.

## Two explorations

A — Material sample board: a compact bilingual shop sign, strong blue typography, a stepped board of category-specific material illustrations and a clear retail/bulk split. Quiet white product rows keep actual prices and units readable.

```text
SHIV / शिव      Materials   Quotes   Account   Basket
BUILD STARTS HERE.        [cement] [steel]
Small repair or full site [aggregate sample board]
[Shop materials] [Bulk quote]
categories / product counter / delivery / shop story
```

B — Contractor's order sheet: terracotta masthead, quantities-led ruled list, narrow title, generous catalogue below. Efficient for repeat buyers but less welcoming to a homeowner.

```text
SHIV CEMENT / SITE SUPPLY
YOUR NEXT BUILD     MATERIAL / UNIT / QUANTITY
[Shop] [Quote]      cement / bag / + −
Wide order-sheet rows with compact material samples
```

Critique before implementation: another cream hero plus generic bag drawing would repeat the rejected foundation. Exploration A changes the silhouette to a stepped sample composition and keeps two distinct buying paths; product identity gets category-specific illustrations instead of one shared image. Keep real product images when approved by the existing asset gate. Do not add decorative statistics, fake seals or numbered sections.

Rendered A and B at 1440px and 390px; inspected A desktop/mobile and B mobile. Selected A for its material recognition and clear retail/bulk choice. B is less welcoming to a homeowner. The mobile prototype route strip is too cramped; production uses concise stacked routes and a shorter board. Product rows keep controls below their text. Evidence: docs/design-explorations/{a,b}-{1440,390}.png and runnable HTML. Prototype prices are labelled and never copied to production.

Skill discovery: skills.sh lists Anthropic frontend-design at 966.8K installs and Vercel React guidance at 782.5K; official repositories had 180,093 and 32,112 stars. Existing installed guidance suffices; no installation.

## Motion contract

One 220ms hero entrance with a restrained stagger. Buttons, product images, basket acknowledgement and assistant/dialog opening use 180–220ms transitions. No continuous movement, moving prices, scroll interception or delayed controls. Reduced motion disables transforms/animations and smooth scrolling. Native dialog handles focus trapping and Escape; the opener regains focus. Assistant loads on first use; no animation runtime.

Core production initial JavaScript budget remains 450KiB gzip. Assistant cost is measured separately. Local browser measurements do not constitute phone or network performance acceptance.

## Delivery checkpoints

1. Preserve foundation; inventory legacy features, choose rendered visual direction.
2. Customer/session/cart/address/checkout/history/quotation flows through existing API.
3. Public bounded assistant, optional voice, approved content/contact capability.
4. Foundation recovery fixes, API/browser/security/production checks and rendered review.
5. Evidence, Hindi review tasks, real-device plan, draft feature PR and exact-SHA CI.
