/**
 * What a customer can do, on the Android app and on the website alike. Each feature names the
 * tests that prove it on each side: "file › test title" for a browser test, or a Maestro flow
 * file. The app's browser tests drive its web build (tests/app.ts); Maestro drives the native
 * build. features.test.ts fails when a feature lacks a test on either side, so a feature added
 * to one product without the other shows up in review.
 */
export type CustomerFeature = {
  id: string;
  en: string;
  hi: string;
  app: readonly string[];
  web: readonly string[];
};

export const customerFeatures: readonly CustomerFeature[] = [
  {
    id: 'rates',
    en: "Today's rates with their units",
    hi: 'आज के भाव, इकाई के साथ',
    app: ['apps/mobile/.maestro/01-browse.yaml'],
    web: [
      'tests/storefront-experience.spec.ts › home rate board shows the cheapest in-stock catalogue price per material with its unit',
    ],
  },
  {
    id: 'catalogue',
    en: 'Browse, search and filter materials',
    hi: 'सामग्री देखें, खोजें और छाँटें',
    app: [
      'tests/journeys.spec.ts › catalogue keeps a product press intact across an unchanged search debounce',
      'tests/customer-recovery.spec.ts › catalog refresh retains loaded pages and search selection',
    ],
    web: [
      'tests/storefront.spec.ts › storefront filters, sorts and paginates without duplicates and restores browser Back',
    ],
  },
  {
    id: 'hindi',
    en: 'Hindi and English, remembered',
    hi: 'हिन्दी और अंग्रेज़ी, याद रहती है',
    app: [
      'apps/mobile/.maestro/02-language.yaml',
      'tests/customer-recovery.spec.ts › a guest basket survives sign-in and refresh; the chosen language persists immediately',
    ],
    web: [
      'tests/storefront.spec.ts › storefront persists Hindi, supports keyboard navigation and fits narrow enlarged text',
    ],
  },
  {
    id: 'live-prices',
    en: 'Price changes show without reloading',
    hi: 'भाव बदलते ही दिखता है',
    app: [
      'tests/journeys.spec.ts › live price updates refresh the catalogue and invalidate an accepted checkout total',
    ],
    web: [
      'tests/storefront.spec.ts › owner price publication reaches storefront and existing customer app',
    ],
  },
  {
    id: 'basket',
    en: 'Basket with minimum, step and stock rules',
    hi: 'टोकरी: न्यूनतम, बढ़त और स्टॉक के नियम',
    app: [
      'tests/cart-feedback.spec.ts › product row quantity respects minimum, step and stock and explains rejected typing',
    ],
    web: [
      'tests/storefront-experience.spec.ts › basket feedback names the material; comparison survives reload; basket page has one summary',
    ],
  },
  {
    id: 'guest-basket',
    en: 'A guest basket joins the account at sign-in',
    hi: 'बिना साइन इन की टोकरी साइन इन पर जुड़ जाती है',
    app: [
      'tests/cart-feedback.spec.ts › a guest basket merges once at sign-in and a second add waits for it',
    ],
    web: [
      'tests/storefront-commerce.spec.ts › guest basket survives reload; a lost merge response replays once against an existing cart',
    ],
  },
  {
    id: 'addresses',
    en: 'Saved delivery addresses',
    hi: 'सहेजे गए डिलीवरी पते',
    app: [
      'tests/customer-recovery.spec.ts › basket delivery draft survives address edit, creation, back, reload and failed catalog refresh',
    ],
    web: [
      'tests/storefront-commerce.spec.ts › saved address editing works; account switches and revocation clear private forms',
    ],
  },
  {
    id: 'cod-order',
    en: 'Place a cash-on-delivery order exactly once',
    hi: 'डिलीवरी पर भुगतान वाला ऑर्डर, सिर्फ़ एक बार',
    app: [
      'tests/journeys.spec.ts › customer places a COD order, tracks it, reorders and requests a bulk quote',
      'tests/customer-recovery.spec.ts › lost creation response survives reload and retries the original request exactly once',
    ],
    web: [
      'tests/storefront-commerce.spec.ts › double-tapping Place COD order creates one order; removing the last basket line empties the shared cart',
      'tests/storefront-commerce.spec.ts › COD lost success recovers exactly one owner task and inventory movement after reload',
    ],
  },
  {
    id: 'orders',
    en: 'Track, cancel and reorder past orders',
    hi: 'ऑर्डर देखें, रद्द करें, फिर से मँगाएँ',
    app: [
      'tests/journeys.spec.ts › customer places a COD order, tracks it, reorders and requests a bulk quote',
    ],
    web: ['tests/storefront-orders.spec.ts › order history tracks, cancels and reorders'],
  },
  {
    id: 'share-order',
    en: 'Share an order summary on WhatsApp',
    hi: 'ऑर्डर का सारांश WhatsApp पर भेजें',
    app: ['tests/app-account.spec.ts › an order summary can be shared'],
    web: ['tests/storefront-account.spec.ts'],
  },
  {
    id: 'bulk-quote',
    en: 'Ask for a bulk quote, accept it, get one order',
    hi: 'थोक भाव माँगें, मंज़ूर करें, एक ऑर्डर बने',
    app: [
      'tests/journeys.spec.ts › customer places a COD order, tracks it, reorders and requests a bulk quote',
      'tests/customer-recovery.spec.ts › guest quotation intent resumes and saved quote fields survive address navigation',
    ],
    web: [
      'tests/storefront-commerce.spec.ts › multi-material quotation recovers persisted reference, reviews revisions and converts once',
    ],
  },
  {
    id: 'compare',
    en: 'Compare materials by their selling units',
    hi: 'बिक्री की इकाई से सामग्री की तुलना',
    app: ['apps/mobile/.maestro/06-compare-assistant.yaml'],
    web: [
      'tests/storefront-commerce.spec.ts › comparison distinguishes selling units; Hindi and enlarged reduced-motion layouts fit phone/tablet/desktop',
    ],
  },
  {
    id: 'assistant',
    en: 'Assistant that answers from the live catalogue',
    hi: 'सहायक जो चालू सूची से जवाब दे',
    app: ['apps/mobile/.maestro/06-compare-assistant.yaml'],
    web: [
      'tests/storefront-commerce.spec.ts › assistant answers with current public catalogue, preserves navigation, cancels and retries without private tools',
    ],
  },
  {
    id: 'outage',
    en: 'A lost connection asks to retry, not to sign in again',
    hi: 'नेटवर्क जाने पर दोबारा कोशिश, दोबारा साइन इन नहीं',
    app: [
      'tests/cart-feedback.spec.ts › Enter commits a whole quantity; offline recovery preserves it and another account sees no basket',
    ],
    web: [
      'tests/storefront-experience.spec.ts › an outage during checkout asks to retry, not to sign in again, and recovers',
    ],
  },
  {
    id: 'profile',
    en: 'Edit name and profile',
    hi: 'नाम और प्रोफ़ाइल बदलें',
    app: ['tests/app-account.spec.ts › the profile name can be changed'],
    web: ['tests/storefront-account.spec.ts'],
  },
  {
    id: 'devices',
    en: 'See signed-in devices and sign one out',
    hi: 'साइन इन वाले फ़ोन देखें और किसी से साइन आउट करें',
    app: ['tests/app-account.spec.ts › another signed-in phone can be signed out'],
    web: ['tests/storefront-account.spec.ts'],
  },
  {
    id: 'delete-account',
    en: 'Delete the account (after open orders finish)',
    hi: 'खाता हटाएँ (खुले ऑर्डर पूरे होने के बाद)',
    app: ['tests/app-account.spec.ts › the account can be deleted once no order is open'],
    web: ['tests/storefront-account.spec.ts'],
  },
];
