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
  /** Why a feature is deliberately not on the app. */
  notOnApp?: string;
  web: readonly string[];
};

export const customerFeatures: readonly CustomerFeature[] = [
  {
    id: 'rates',
    en: "Today's rates with their units",
    hi: 'आज के भाव, इकाई के साथ',
    app: ['apps/mobile/.maestro/01-browse.yaml'],
    web: [
      'tests/storefront.spec.ts › the rate board shows each rate with its unit, and the sample tag',
    ],
  },
  {
    id: 'catalogue',
    en: 'Browse, search and filter materials',
    hi: 'सामग्री देखें, खोजें और छाँटें',
    app: [
      'tests/customer-app.spec.ts › a product page shows the rate beside its unit, and Add turns into the way to the list',
      'tests/customer-app.spec.ts › the rate the shop keeps stays on screen with its age when the shop cannot be reached',
    ],
    web: [
      'tests/storefront.spec.ts › a category shows its lowest rate, “from”, brand filters and how to buy',
    ],
  },
  {
    id: 'hindi',
    en: 'Hindi and English, remembered',
    hi: 'हिन्दी और अंग्रेज़ी, याद रहती है',
    app: [],
    notOnApp: 'Aman asked that Hindi be removed from the app entirely.',
    web: ['tests/storefront.spec.ts › there is no language switch'],
  },
  {
    id: 'live-prices',
    en: 'Price changes show without reloading',
    hi: 'भाव बदलते ही दिखता है',
    app: [
      'tests/journeys.spec.ts › live price updates refresh the catalogue and invalidate an accepted checkout total',
    ],
    web: ['tests/storefront.spec.ts › a price published by the owner reaches the next page load'],
  },
  {
    id: 'basket',
    en: 'Basket with minimum, step and stock rules',
    hi: 'टोकरी: न्यूनतम, बढ़त और स्टॉक के नियम',
    app: [
      'tests/customer-app.spec.ts › typing 200 is one entry, and stepping to nothing takes it off',
    ],
    web: [
      'tests/storefront-commerce.spec.ts › Add builds the list on a public page: count, stepper, slip, and it survives a reload',
    ],
  },
  {
    id: 'guest-basket',
    en: 'A guest basket joins the account at sign-in',
    hi: 'बिना साइन इन की टोकरी साइन इन पर जुड़ जाती है',
    app: [
      'tests/customer-app.spec.ts › first order: sign in only at Place, add a site, and the status is honest',
    ],
    web: [
      'tests/storefront-commerce.spec.ts › Place order signs in, returns to the list and carries on to checkout, with the list intact',
    ],
  },
  {
    id: 'addresses',
    en: 'Saved delivery addresses',
    hi: 'सहेजे गए डिलीवरी पते',
    app: [
      'tests/customer-app.spec.ts › first order: sign in only at Place, add a site, and the status is honest',
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
      'tests/customer-app.spec.ts › Order again takes two taps and never touches a half-built list',
      'tests/customer-app.spec.ts › a connection lost as Place is tapped makes no duplicate',
    ],
    web: [
      'tests/storefront-commerce.spec.ts › double-tapping Place COD order creates one order',
      'tests/storefront-commerce.spec.ts › COD lost success recovers exactly one order after reload',
    ],
  },
  {
    id: 'orders',
    en: 'Track, cancel and reorder past orders',
    hi: 'ऑर्डर देखें, रद्द करें, फिर से मँगाएँ',
    app: [
      'tests/customer-app.spec.ts › Order again takes two taps and never touches a half-built list',
    ],
    web: ['tests/storefront-orders.spec.ts › order history tracks, cancels and reorders'],
  },
  {
    id: 'share-order',
    en: 'Share an order summary on WhatsApp',
    hi: 'ऑर्डर का सारांश WhatsApp पर भेजें',
    app: ['tests/customer-account.spec.ts › an order summary can be shared'],
    web: [
      'tests/storefront-account.spec.ts › each order can be shared on WhatsApp without the delivery address',
    ],
  },
  {
    id: 'bulk-quote',
    en: 'Ask for a bulk quote, accept it, get one order',
    hi: 'थोक भाव माँगें, मंज़ूर करें, एक ऑर्डर बने',
    app: [
      'tests/customer-app.spec.ts › Order again takes two taps and never touches a half-built list',
      'tests/customer-app.spec.ts › Ask a person: a typed list goes to the shop, and the reply lives at the top of Orders',
    ],
    web: [
      'tests/storefront-commerce.spec.ts › Ask for a rate sends the list as one request, recovers a lost answer, and converts once',
    ],
  },
  {
    id: 'compare',
    en: 'Compare materials by their selling units',
    hi: 'बिक्री की इकाई से सामग्री की तुलना',
    app: [],
    notOnApp: 'Plan 04: the rate sheet already lines up every brand in one unit. Website only.',
    web: [
      'tests/storefront-commerce.spec.ts › compare shows two materials side by side at their own units',
    ],
  },
  {
    id: 'assistant',
    en: 'Assistant that answers from the live catalogue',
    hi: 'सहायक जो चालू सूची से जवाब दे',
    app: [
      'tests/customer-ask.spec.ts › Ask is a tab that keeps its conversation, its box and its speaker',
    ],
    web: [
      'tests/storefront-outage.spec.ts › Ask: opens in a sheet, loads only when asked for, and answers from the guide',
    ],
  },
  {
    id: 'outage',
    en: 'A lost connection asks to retry, not to sign in again',
    hi: 'नेटवर्क जाने पर दोबारा कोशिश, दोबारा साइन इन नहीं',
    app: [
      'tests/customer-app.spec.ts › typing 200 is one entry, and stepping to nothing takes it off',
    ],
    web: [
      'tests/storefront-hardening.spec.ts › an outage during checkout asks to retry, not to sign in again, and recovers',
    ],
  },
  {
    id: 'profile',
    en: 'Edit name and profile',
    hi: 'नाम और प्रोफ़ाइल बदलें',
    app: ['tests/customer-account.spec.ts › the name can be changed'],
    web: [
      'tests/storefront-account.spec.ts › a customer edits their name on the website and it stays after reload',
    ],
  },
  {
    id: 'devices',
    en: 'See signed-in devices and sign one out',
    hi: 'साइन इन वाले फ़ोन देखें और किसी से साइन आउट करें',
    app: ['tests/customer-account.spec.ts › other phones can be signed out, in one row'],
    web: [
      'tests/storefront-account.spec.ts › signed-in devices mark this browser and sign out another phone',
    ],
  },
  {
    id: 'delete-account',
    en: 'Delete the account (after open orders finish)',
    hi: 'खाता हटाएँ (खुले ऑर्डर पूरे होने के बाद)',
    app: [
      'tests/customer-account.spec.ts › the account can be deleted once no order is open, and nothing stays on the phone',
    ],
    web: [
      'tests/storefront-account.spec.ts › deleting the account is refused while an order is open',
      'tests/storefront-account.spec.ts › deleting an account with no open orders signs out and says so',
    ],
  },
  {
    id: 'hindi-catalogue',
    en: 'Hindi product names and units',
    hi: 'सामग्री के हिन्दी नाम और इकाई',
    app: [],
    notOnApp: 'Aman asked that Hindi be removed from the app entirely.',
    web: [
      'tests/catalogue-hindi.spec.ts › a Hindi name saved on the desk stays off the website, and still finds the product',
    ],
  },
  {
    id: 'first-run',
    en: 'First order guide, remembered pincode, name asked once',
    hi: 'पहले ऑर्डर की राह, याद रहा पिनकोड, नाम एक बार',
    app: [
      'tests/customer-app.spec.ts › first order: sign in only at Place, add a site, and the status is honest',
    ],
    web: [
      'tests/first-run.spec.ts › website first run: pincode, list, sign-in with name, order, what happens next',
    ],
  },
  {
    id: 'next-steps',
    en: 'What happens next after an order',
    hi: 'ऑर्डर के बाद आगे क्या होगा',
    app: [
      'tests/customer-app.spec.ts › first order: sign in only at Place, add a site, and the status is honest',
    ],
    web: [
      'tests/first-run.spec.ts › website first run: pincode, list, sign-in with name, order, what happens next',
    ],
  },
];
