// Bilingual text shared by the Android app, the website and the owner desk.
// Screen wording stays in each app (inline t(en, hi)); words that must read the same
// everywhere live in the glossary so customers learn one vocabulary.
export type Language = 'en' | 'hi';
export type Bilingual = readonly [english: string, hindi: string];

export const pick = (language: Language, text: Bilingual): string =>
  text[language === 'hi' ? 1 : 0];

export const glossary = {
  basket: ['Basket', 'टोकरी'],
  order: ['Order', 'ऑर्डर'],
  orders: ['Orders', 'ऑर्डर'],
  bulkQuote: ['Bulk quote', 'थोक भाव'],
  currentRates: ['Current rates', 'मौजूदा भाव'],
  materials: ['Materials', 'सामग्री'],
  account: ['Account', 'खाता'],
  signIn: ['Sign in', 'साइन इन'],
  signOut: ['Sign out', 'साइन आउट'],
  cashOnDelivery: ['Cash on delivery', 'डिलीवरी पर भुगतान'],
  deliveryPincode: ['Delivery pincode', 'डिलीवरी पिनकोड'],
  addToBasket: ['Add to basket', 'टोकरी में जोड़ें'],
  addToQuote: ['Add to quote', 'भाव सूची में जोड़ें'],
  compare: ['Compare', 'तुलना करें'],
  inStock: ['In stock', 'स्टॉक में'],
  outOfStock: ['Out of stock', 'स्टॉक नहीं'],
  tryAgain: ['Try again', 'फिर कोशिश करें'],
  call: ['Call', 'फ़ोन करें'],
  whatsapp: ['WhatsApp', 'WhatsApp'],
  shopName: ['Shiv Cement Store', 'शिव सीमेंट स्टोर'],
} as const satisfies Record<string, Bilingual>;

export type GlossaryKey = keyof typeof glossary;
export const word = (language: Language, key: GlossaryKey) => pick(language, glossary[key]);

/** True when a string contains Devanagari, used by completeness tests for Hindi text. */
export const hasDevanagari = (value: string) => /[ऀ-ॿ]/.test(value);
