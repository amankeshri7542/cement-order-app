/* global structuredClone */
// Pure parts of the family-review demo tooling (scripts/demo.mjs): the database guard and the
// sample data. Nothing here touches a database or the network, so tests can check them directly.

// Every row prepare creates is tagged: ids start with this prefix and customer phones sit in the
// +91 99000 901xx block. Reset deletes only these (and what demo customers did during the demo).
export const DEMO_PREFIX = 'demo-';
export const DEMO_PHONE_PREFIX = '+9199000901';
export const DEMO_ACTOR = 'demo-script';
export const PRACTICE_PINCODE = '800099';
export const DEMO_NOTE = 'Sample product for the family review — not a real price.';
export const DEMO_NOTE_HI = 'परिवार की समीक्षा के लिए सैंपल सामान — यह असली दाम नहीं है।';

/**
 * Which database the demo script may write to. A local throwaway database must end in _test; the
 * shared staging database needs DEMO_TARGET=staging and "staging" in its name. NODE_ENV=production
 * is refused unless DEMO_TARGET=staging says the operator meant staging. Messages name only the
 * database and host, never the user or password.
 */
export function demoTarget(env = process.env) {
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('Set DATABASE_URL to the demo database (postgresql://…).');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('DATABASE_URL must be a postgresql:// address.');
  const database = decodeURIComponent(url.pathname.slice(1));
  const label = `database "${database}" on ${url.hostname || 'unknown host'}`;
  const staging = env.DEMO_TARGET === 'staging';
  if (env.DEMO_TARGET && !staging)
    throw new Error(`DEMO_TARGET may only be "staging" (refusing ${label}).`);
  if (env.NODE_ENV === 'production' && !staging)
    throw new Error(`Refusing ${label}: NODE_ENV=production needs DEMO_TARGET=staging.`);
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(database))
    throw new Error(`Refusing ${label}: unexpected database name.`);
  if (/(^|[_-])prod(uction)?([_-]|$)/i.test(database))
    throw new Error(`Refusing ${label}: it looks like a production database.`);
  if (!(database.endsWith('_test') || (staging && database.toLowerCase().includes('staging'))))
    throw new Error(
      `Refusing ${label}: use a database ending in _test, or set DEMO_TARGET=staging for a database named for staging.`,
    );
  return {
    url: env.DATABASE_URL,
    database,
    host: url.hostname,
    port: url.port || '5432',
    label,
    // For pg_dump/pg_restore: credentials travel in the child environment, never in argv or logs.
    pgEnv: {
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      ...(url.searchParams.get('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') } : {}),
    },
  };
}

/** A calendar date in India, `days` from now (negative for the past). */
export function istDate(days = 0, now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now + days * 86400000));
}

// Category names and slugs match prisma/seed.ts so the rate board orders them the usual way. An
// existing category with the same slug is reused and never deleted.
const categories = [
  { slug: 'cement', name: 'Cement' },
  { slug: 'steel', name: 'Steel' },
  { slug: 'sand', name: 'Sand' },
  { slug: 'aggregates', name: 'Aggregates' },
  { slug: 'bricks', name: 'Bricks & blocks' },
];

const product = (p) => ({
  ...p,
  id: `${DEMO_PREFIX}${p.id}`,
  brand: p.brand || 'Sample brand',
  active: true,
  images: [],
  description: `${DEMO_NOTE} ${p.description}`,
  descriptionHi: `${DEMO_NOTE_HI} ${p.descriptionHi}`,
});
// Prices are in paise for one selling unit (₹395 a bag is 39500).
const products = [
  product({
    id: 'ppc-cement',
    name: 'Sample PPC Cement',
    nameHi: 'सैंपल पीपीसी सीमेंट',
    brand: 'Sample Cement Co.',
    category: 'cement',
    type: 'PPC Cement',
    grade: 'PPC',
    unit: 'bag',
    packSize: '50 kg bag',
    minQuantity: 1,
    quantityStep: 1,
    pricePaise: 39500,
    stock: 800,
    lowStockAt: 100,
    description: 'Price per 50 kg bag.',
    descriptionHi: 'दाम 50 किलो की एक बोरी का।',
    recommendedUse: 'Brickwork, plaster and everyday house construction.',
  }),
  product({
    id: 'opc-cement',
    name: 'Sample OPC 53 Grade Cement',
    nameHi: 'सैंपल ओपीसी 53 ग्रेड सीमेंट',
    brand: 'Sample Cement Co.',
    category: 'cement',
    type: 'OPC Cement',
    grade: '53 grade',
    unit: 'bag',
    packSize: '50 kg bag',
    minQuantity: 10,
    quantityStep: 5,
    pricePaise: 43000,
    stock: 400,
    lowStockAt: 50,
    description: 'Sold from 10 bags, in steps of 5 bags.',
    descriptionHi: 'कम से कम 10 बोरी, 5-5 बोरी के हिसाब से।',
    recommendedUse: 'Slabs, beams and columns (RCC work).',
  }),
  product({
    id: 'tmt-8mm',
    name: 'Sample TMT Bar 8 mm',
    nameHi: 'सैंपल टीएमटी सरिया 8 मिमी',
    brand: 'Sample Steel',
    category: 'steel',
    type: 'TMT bar',
    grade: 'Fe 500D',
    unit: 'kg',
    packSize: '12 m bar, about 4.7 kg',
    minQuantity: 50,
    quantityStep: 10,
    pricePaise: 6400,
    stock: 6000,
    lowStockAt: 500,
    description: 'Price per kg; sold from 50 kg in steps of 10 kg.',
    descriptionHi: 'दाम प्रति किलो; कम से कम 50 किलो, 10-10 किलो के हिसाब से।',
    recommendedUse: 'Rings, stirrups and light reinforcement.',
  }),
  product({
    id: 'tmt-12mm',
    name: 'Sample TMT Bar 12 mm',
    nameHi: 'सैंपल टीएमटी सरिया 12 मिमी',
    brand: 'Sample Steel',
    category: 'steel',
    type: 'TMT bar',
    grade: 'Fe 500D',
    unit: 'tonne',
    packSize: '1 tonne bundle',
    minQuantity: 1,
    quantityStep: 1,
    pricePaise: 6150000,
    stock: 15,
    lowStockAt: 3,
    description: 'Price per tonne bundle.',
    descriptionHi: 'दाम प्रति टन बंडल।',
    recommendedUse: 'Main bars for columns, beams and slabs.',
  }),
  product({
    id: 'coarse-sand',
    name: 'Sample Coarse Sand',
    nameHi: 'सैंपल मोटा बालू',
    category: 'sand',
    type: 'River sand',
    grade: 'Coarse',
    unit: 'cft',
    packSize: 'Loose, per cubic foot',
    minQuantity: 100,
    quantityStep: 50,
    pricePaise: 5500,
    stock: 4000,
    lowStockAt: 500,
    description: 'Price per cubic foot (cft); from 100 cft in steps of 50.',
    descriptionHi: 'दाम प्रति घन फुट (cft); कम से कम 100 cft, 50-50 के हिसाब से।',
    recommendedUse: 'Concrete and masonry mortar.',
  }),
  product({
    id: 'gitti-20mm',
    name: 'Sample Stone Gitti 20 mm',
    nameHi: 'सैंपल पत्थर गिट्टी 20 मिमी',
    category: 'aggregates',
    type: 'Stone aggregate',
    grade: '20 mm',
    unit: 'cft',
    packSize: 'Loose, per cubic foot',
    minQuantity: 100,
    quantityStep: 50,
    pricePaise: 7200,
    stock: 3000,
    lowStockAt: 400,
    description: 'Price per cubic foot (cft); from 100 cft in steps of 50.',
    descriptionHi: 'दाम प्रति घन फुट (cft); कम से कम 100 cft, 50-50 के हिसाब से।',
    recommendedUse: 'Concrete for slabs, beams and foundations.',
  }),
  product({
    id: 'red-bricks',
    name: 'Sample Red Clay Bricks',
    nameHi: 'सैंपल लाल ईंट',
    category: 'bricks',
    type: 'Clay brick',
    grade: 'First class',
    unit: 'piece',
    packSize: '9 × 4 × 3 in',
    minQuantity: 1000,
    quantityStep: 500,
    pricePaise: 950,
    stock: 25000,
    lowStockAt: 3000,
    description: 'Price per brick; from 1,000 bricks in steps of 500.',
    descriptionHi: 'दाम प्रति ईंट; कम से कम 1,000 ईंट, 500-500 के हिसाब से।',
    recommendedUse: 'Load-bearing and partition walls.',
  }),
  product({
    id: 'flyash-bricks',
    name: 'Sample Fly Ash Bricks',
    nameHi: 'सैंपल फ्लाई ऐश ईंट',
    category: 'bricks',
    type: 'Fly ash brick',
    grade: 'Machine made',
    unit: 'piece',
    packSize: '9 × 4 × 3 in',
    minQuantity: 500,
    quantityStep: 500,
    pricePaise: 800,
    stock: 12000,
    lowStockAt: 2000,
    description: 'Price per brick; from 500 bricks in steps of 500.',
    descriptionHi: 'दाम प्रति ईंट; कम से कम 500 ईंट, 500-500 के हिसाब से।',
    recommendedUse: 'Partition and boundary walls.',
  }),
];

// Used only when no zone serves the practice pincode yet; an existing zone is left as it is.
const zone = {
  id: `${DEMO_PREFIX}zone-patna`,
  name: 'SAMPLE — Patna practice zone',
  active: true,
  deliveryFeePaise: 50000,
  minimumOrderPaise: 200000,
  freeDeliveryAbovePaise: 5000000,
  estimate: 'Sample zone: same or next day. The shop will call to confirm.',
  terms: 'Sample delivery rules for the family review: ₹500 delivery, free above ₹50,000.',
  pincode: PRACTICE_PINCODE,
};

const customer = (n, name, language, label, area) => ({
  id: `${DEMO_PREFIX}customer-${n}`,
  phone: `${DEMO_PHONE_PREFIX}0${n}`,
  name,
  language,
  address: {
    id: `${DEMO_PREFIX}address-${n}`,
    label,
    name,
    phone: `${DEMO_PHONE_PREFIX}0${n}`,
    line1: `Sample house ${n * 12}, Road ${n}`,
    area,
    city: 'Patna',
    state: 'Bihar',
    pincode: PRACTICE_PINCODE,
    landmark: 'Sample address for the family review',
  },
});
const customers = [
  customer(1, 'Ravi Kumar (sample)', 'hi', 'Home', 'Kankarbagh (sample)'),
  customer(2, 'Sunita Devi (sample)', 'hi', 'Home', 'Boring Road (sample)'),
  customer(3, 'Mohan Builders (sample)', 'en', 'Site', 'Danapur (sample)'),
];

// Fixed idempotency keys keep a re-run from creating a second copy of an order.
const orders = [
  {
    id: `${DEMO_PREFIX}order-1`,
    number: 'SC-DEMO-0001',
    idempotencyKey: '7d0c6a43-1f4e-4c4a-9d55-0a5d0e000001',
    customer: `${DEMO_PREFIX}customer-1`,
    status: 'CONFIRMED',
    hoursAgo: 1,
    deliveryInDays: 1,
    lines: [{ productId: `${DEMO_PREFIX}ppc-cement`, quantity: 50 }],
  },
  {
    id: `${DEMO_PREFIX}order-2`,
    number: 'SC-DEMO-0002',
    idempotencyKey: '7d0c6a43-1f4e-4c4a-9d55-0a5d0e000002',
    customer: `${DEMO_PREFIX}customer-2`,
    status: 'OUT_FOR_DELIVERY',
    hoursAgo: 26,
    deliveryInDays: 0,
    lines: [
      { productId: `${DEMO_PREFIX}ppc-cement`, quantity: 20 },
      { productId: `${DEMO_PREFIX}tmt-8mm`, quantity: 200 },
    ],
  },
  {
    id: `${DEMO_PREFIX}order-3`,
    number: 'SC-DEMO-0003',
    idempotencyKey: '7d0c6a43-1f4e-4c4a-9d55-0a5d0e000003',
    customer: `${DEMO_PREFIX}customer-3`,
    status: 'DELIVERED',
    hoursAgo: 72,
    deliveryInDays: -2,
    lines: [
      { productId: `${DEMO_PREFIX}red-bricks`, quantity: 3000 },
      { productId: `${DEMO_PREFIX}coarse-sand`, quantity: 300 },
      { productId: `${DEMO_PREFIX}gitti-20mm`, quantity: 200 },
    ],
  },
];

const quote = {
  id: `${DEMO_PREFIX}quote-1`,
  number: 'QT-DEMO-0001',
  customer: `${DEMO_PREFIX}customer-3`,
  hoursAgo: 3,
  deliveryInDays: 4,
  company: 'Mohan Builders (sample)',
  gstin: '',
  notes: 'Sample request: rate needed for slab work next week, delivery to site.',
  lines: [
    { productId: `${DEMO_PREFIX}opc-cement`, quantity: 100 },
    { productId: `${DEMO_PREFIX}tmt-12mm`, quantity: 2 },
  ],
};

/** The whole sample set, as plain data; demo.mjs writes it and the tests check its invariants. */
export function sampleData() {
  return structuredClone({ categories, products, zone, customers, orders, quote });
}
