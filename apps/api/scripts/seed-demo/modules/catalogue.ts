import type { Rng } from '../rng';
import { addDays, dayRange, istInstant } from '../calendar';
import type { Bulk } from '../bulk';
import type { SeedContext } from '../context';

/**
 * Products in families: one brand line in several sizes or grades. The ProductFamily table arrives
 * in phase C2; until then a family is a shared name prefix, and C2's seed module links them.
 * Rates are sample rates only, in paise for one selling unit.
 */
type Family = {
  category: string;
  brand: string;
  line: string;
  type: string;
  unit: string;
  pack: string;
  /** Variant label and price in rupees. */
  variants: readonly (readonly [string, number])[];
  /** How the rate moves: cement drifts monthly, steel weekly, the rest rarely. */
  drift: 'cement' | 'steel' | 'slow';
  /** Typical quantity in one order line, and the low-stock mark. */
  qty: readonly [number, number];
  lowAt: number;
  stockMode?: 'AVAILABILITY';
};

const cementGrades = [
  ['PPC', 395],
  ['OPC 43', 415],
  ['OPC 53', 430],
  ['PSC', 385],
] as const;
const tmt = [
  ['8 mm', 66],
  ['10 mm', 65],
  ['12 mm', 64],
  ['16 mm', 64],
  ['20 mm', 64],
  ['25 mm', 65],
  ['6 mm', 68],
  ['32 mm', 66],
] as const;
const pvc = [
  ['½ inch', 95],
  ['¾ inch', 130],
  ['1 inch', 185],
  ['1¼ inch', 260],
  ['1½ inch', 320],
  ['2 inch', 450],
  ['3 inch', 720],
  ['4 inch', 980],
] as const;

type V = readonly (readonly [string, number])[];
const fam = (
  category: string,
  brand: string,
  line: string,
  type: string,
  unit: string,
  pack: string,
  variants: V,
  drift: Family['drift'],
  qty: readonly [number, number],
  lowAt: number,
  stockMode?: 'AVAILABILITY',
): Family => ({ category, brand, line, type, unit, pack, variants, drift, qty, lowAt, stockMode });
const scale = (variants: V, factor: number, add = 0): V =>
  variants.map(([label, p]) => [label, Math.round(p * factor + add)] as const);

const cement = [
  'UltraTech',
  'ACC',
  'Ambuja',
  'Dalmia',
  'Shree',
  'Birla Gold',
  'JK Lakshmi',
  'Konark',
  'Nuvoco',
  'Star',
  'Bangur',
  'Mycem',
].map((brand, i) =>
  fam(
    'cement',
    brand,
    `${brand} Cement`,
    'Cement',
    'bag',
    '50 kg bag',
    scale(cementGrades, 1, (i % 4) * 8 - 10),
    'cement',
    [5, 60],
    40,
  ),
);
const steel = [
  ...[
    'Tata Tiscon',
    'SAIL',
    'Kamdhenu',
    'Jindal Panther',
    'Shyam Steel',
    'Electrosteel',
    'SRMB',
    'Maithan',
    'Rathi',
    'Vizag',
  ].map((brand, i) =>
    fam(
      'steel',
      brand,
      `${brand} TMT`,
      'TMT bar',
      'kg',
      'Sold by weight',
      scale(tmt, 1, (i % 3) * 2 - 2),
      'steel',
      [50, 450],
      200,
    ),
  ),
  fam(
    'steel',
    'Local',
    'Binding wire',
    'Steel accessory',
    'kg',
    'Sold by weight',
    [
      ['18 gauge', 85],
      ['20 gauge', 88],
    ],
    'slow',
    [5, 60],
    50,
  ),
  fam(
    'steel',
    'Local',
    'Ring (stirrup)',
    'Steel accessory',
    'kg',
    'Sold by weight',
    [
      ['6 mm', 72],
      ['8 mm', 70],
    ],
    'slow',
    [5, 60],
    50,
  ),
];
const loose = (category: string, line: string, type: string, variants: V) =>
  fam(
    category,
    'Local supply',
    line,
    type,
    'trolley',
    '100 cft trolley',
    variants,
    'slow',
    [1, 3],
    0,
    'AVAILABILITY',
  );
const bulkGoods = [
  loose('sand', 'Sone balu', 'Sand', [
    ['Fine', 5200],
    ['Coarse', 5800],
    ['Filling', 3600],
  ]),
  loose('aggregates', 'Gitti (stone chips)', 'Aggregate', [
    ['10 mm', 6200],
    ['20 mm', 6000],
    ['40 mm', 5600],
  ]),
  loose('sand', 'Local balu', 'Sand', [
    ['Fine', 4400],
    ['Filling', 3000],
  ]),
  loose('aggregates', 'Stone dust', 'Aggregate', [['Fine', 2800]]),
];
const bricks = [
  fam(
    'bricks',
    'Local kiln',
    'Red brick',
    'Masonry unit',
    '1,000 pieces',
    'Lot of 1,000',
    [
      ['First class', 9800],
      ['Second class', 8200],
      ['Third class', 6500],
    ],
    'slow',
    [1, 8],
    5,
  ),
  fam(
    'bricks',
    'Local plant',
    'Fly ash brick',
    'Masonry unit',
    '1,000 pieces',
    'Lot of 1,000',
    [
      ['Standard', 7200],
      ['Large', 8800],
    ],
    'slow',
    [1, 8],
    5,
  ),
  fam(
    'bricks',
    'Magicrete',
    'AAC block',
    'Masonry unit',
    'cubic metre',
    'Sold by volume',
    [
      ['100 mm', 5400],
      ['150 mm', 5400],
      ['200 mm', 5400],
    ],
    'slow',
    [1, 12],
    10,
  ),
];
const pipe = (brand: string, kind: string, variants: V) =>
  fam(
    'pipes',
    brand,
    `${brand} ${kind} pipe`,
    `${kind} pipe`,
    'length',
    '3 m length',
    variants,
    'slow',
    [2, 40],
    20,
  );
const pipes = [
  ...['Supreme', 'Finolex', 'Prince', 'Ashirvad'].map((b, i) =>
    pipe(b, 'PVC', scale(pvc, 1 + i * 0.03)),
  ),
  ...['Astral', 'Supreme', 'Ashirvad'].map((b, i) => pipe(b, 'CPVC', scale(pvc, 1.6 + i * 0.04))),
  ...['Supreme', 'Prince'].map((b) =>
    pipe(b, 'SWR', [
      ['75 mm', 480],
      ['110 mm', 760],
      ['160 mm', 1450],
    ]),
  ),
  pipe('Tata', 'GI', scale(pvc, 3.1)),
];
const fittings = ['Elbow', 'Tee', 'Socket', 'Coupler', 'End cap', 'Reducer'].map((part, i) =>
  fam(
    'pipes',
    'Supreme',
    `PVC ${part.toLowerCase()}`,
    'Pipe fitting',
    'piece',
    '',
    scale(pvc, 0.12 + i * 0.01),
    'slow',
    [2, 30],
    30,
  ),
);
const hardware = [
  fam(
    'hardware',
    'Local',
    'Wire nails',
    'Hardware',
    'kg',
    'Sold by weight',
    [
      ['1 inch', 95],
      ['2 inch', 90],
      ['3 inch', 88],
      ['4 inch', 88],
    ],
    'slow',
    [1, 20],
    10,
  ),
  fam(
    'hardware',
    'Dr. Fixit',
    'Dr. Fixit waterproofing',
    'Waterproofing',
    'can',
    '',
    [
      ['1 litre', 260],
      ['5 litre', 1150],
      ['20 litre', 4200],
    ],
    'slow',
    [1, 6],
    6,
  ),
  fam(
    'hardware',
    'Birla White',
    'Birla White wall putty',
    'Putty',
    'bag',
    '',
    [
      ['5 kg', 290],
      ['20 kg', 880],
      ['40 kg', 1650],
    ],
    'slow',
    [1, 20],
    10,
  ),
  fam(
    'hardware',
    'Local',
    'Chicken mesh',
    'Hardware',
    'roll',
    '',
    [
      ['2 ft', 950],
      ['3 ft', 1350],
      ['4 ft', 1750],
    ],
    'slow',
    [1, 4],
    4,
  ),
  fam(
    'hardware',
    'JK White',
    'JK White cement',
    'White cement',
    'bag',
    '',
    [
      ['1 kg', 65],
      ['5 kg', 290],
      ['25 kg', 1250],
    ],
    'slow',
    [1, 10],
    10,
  ),
  fam(
    'hardware',
    'Local',
    'Shuttering ply',
    'Hardware',
    'sheet',
    '',
    [
      ['12 mm', 1450],
      ['18 mm', 1950],
    ],
    'slow',
    [2, 30],
    10,
  ),
  fam(
    'hardware',
    'Local',
    'Tools',
    'Hardware',
    'piece',
    '',
    [
      ['Tasla', 180],
      ['Karni', 120],
      ['Belcha', 420],
      ['Sabbal', 650],
    ],
    'slow',
    [1, 6],
    6,
  ),
  fam(
    'hardware',
    'Roff',
    'Roff tile adhesive',
    'Adhesive',
    'bag',
    '20 kg bag',
    [['20 kg', 520]],
    'slow',
    [2, 20],
    10,
  ),
  fam(
    'hardware',
    'Local',
    'Ball valve',
    'Plumbing',
    'piece',
    '',
    [
      ['½ inch', 210],
      ['¾ inch', 290],
      ['1 inch', 420],
      ['1½ inch', 780],
      ['2 inch', 1150],
    ],
    'slow',
    [1, 8],
    6,
  ),
  fam(
    'hardware',
    'Local',
    'Gate valve',
    'Plumbing',
    'piece',
    '',
    [
      ['½ inch', 340],
      ['¾ inch', 460],
      ['1 inch', 640],
      ['1½ inch', 1120],
      ['2 inch', 1680],
    ],
    'slow',
    [1, 6],
    4,
  ),
  fam(
    'hardware',
    'Local',
    'Cover block',
    'Hardware',
    '100 pieces',
    '',
    [
      ['20 mm', 180],
      ['25 mm', 200],
      ['40 mm', 240],
    ],
    'slow',
    [1, 10],
    5,
  ),
  fam(
    'hardware',
    'Fosroc',
    'Fosroc curing compound',
    'Chemical',
    'can',
    '',
    [
      ['5 litre', 1450],
      ['20 litre', 5200],
    ],
    'slow',
    [1, 4],
    3,
  ),
  fam(
    'hardware',
    'Asian Paints',
    'SmartCare waterproofing',
    'Waterproofing',
    'can',
    '',
    [
      ['1 litre', 290],
      ['4 litre', 1050],
      ['20 litre', 4800],
    ],
    'slow',
    [1, 6],
    5,
  ),
];

/**
 * Families in round-robin over the groups, so a small catalogue still has every category, and the
 * most-sold lines (cement, TMT) come first within each group.
 */
const groups = [cement, steel, bulkGoods, bricks, pipes, fittings, hardware];
const families: readonly Family[] = (() => {
  const out: Family[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++)
    for (const g of groups) if (i < g.length) out.push(g[i]!);
  return out;
})();

export const categories = [
  { id: 'cement', name: 'Cement', slug: 'cement' },
  { id: 'steel', name: 'Steel', slug: 'steel' },
  { id: 'sand', name: 'Sand', slug: 'sand' },
  { id: 'bricks', name: 'Bricks & blocks', slug: 'bricks' },
  { id: 'aggregates', name: 'Aggregates', slug: 'aggregates' },
  { id: 'pipes', name: 'Pipes', slug: 'pipes' },
  { id: 'hardware', name: 'Hardware', slug: 'hardware' },
];

export type SeedProduct = {
  id: string;
  name: string;
  family: string;
  category: string;
  unit: string;
  packSize: string;
  counted: boolean;
  lowStockAt: number;
  qty: readonly [number, number];
  /** Rate per day, in paise, with the price version in force that day. */
  rateOn: (day: string) => { paise: number; version: number };
  finalPaise: number;
  finalVersion: number;
  /** How popular it is within its category, for picking order lines. */
  weight: number;
};

/** Spreads `total` products over `familyCount` families, each family taking at most its variants. */
export function planCatalogue(familyCount: number, total: number) {
  const chosen = families.slice(0, Math.min(familyCount, families.length));
  if (chosen.length < familyCount)
    throw new Error(`Only ${families.length} families are defined; asked for ${familyCount}.`);
  const capacity = chosen.reduce((n, f) => n + f.variants.length, 0);
  if (capacity < total) throw new Error(`The chosen families hold only ${capacity} products.`);
  const counts = chosen.map(() => 1);
  let left = total - chosen.length;
  for (let round = 1; left > 0; round++)
    for (let i = 0; i < chosen.length && left > 0; i++)
      if (counts[i]! <= round && counts[i]! < chosen[i]!.variants.length) {
        counts[i]!++;
        left--;
      }
  return chosen.map((family, i) => ({ family, count: counts[i]! }));
}

export async function seedCatalogue(ctx: SeedContext, bulk: Bulk, rng: Rng) {
  const { familyCount, productCount } = ctx.plan;
  const days = dayRange(ctx.firstDay, ctx.today);
  const products: SeedProduct[] = [];
  const productRows: Record<string, unknown>[] = [];
  const historyRows: Record<string, unknown>[] = [];

  planCatalogue(familyCount, productCount).forEach(({ family, count }, f) => {
    family.variants.slice(0, count).forEach(([label, rupees], v) => {
      const id = `demo-p${String(f + 1).padStart(2, '0')}-${v + 1}`;
      const name = `${family.line} ${label}`;
      // Walk the rate from the first day to today. Changes are price history rows.
      // Rates are whole rupees, as on a shop's board.
      let paise = Math.round(rupees * (1 - rng.next() * 0.04)) * 100;
      let version = 1;
      const changes: { day: string; paise: number; version: number }[] = [
        { day: days[0]!, paise, version },
      ];
      for (const day of days) {
        const weekly = family.drift === 'steel' && new Date(`${day}T00:00:00Z`).getUTCDay() === 1;
        const monthly = family.drift === 'cement' && day.endsWith('-01');
        const rare = family.drift === 'slow' && day.endsWith('-01') && rng.chance(0.15);
        if (!weekly && !monthly && !rare) continue;
        const step =
          family.drift === 'cement'
            ? rng.int(5, 15) * 100 * (rng.chance(0.65) ? 1 : -1)
            : family.drift === 'steel'
              ? Math.round(paise * rng.normal(0.002, 0.015))
              : Math.round(paise * rng.int(2, 6) * 0.01);
        if (!step) continue;
        const old = paise;
        paise = Math.max(Math.round(rupees * 0.6) * 100, Math.round((old + step) / 100) * 100);
        if (paise === old) continue;
        version++;
        changes.push({ day, paise, version });
        historyRows.push({
          id: `${id}-h${version}`,
          productId: id,
          kind: 'PRICE',
          oldPricePaise: old,
          newPricePaise: paise,
          version,
          actorId: ctx.actors.owner,
          createdAt: istInstant(day, 9, 15),
        });
      }
      const rateOn = (day: string) => {
        let lo = 0;
        let hi = changes.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (changes[mid]!.day <= day) lo = mid;
          else hi = mid - 1;
        }
        return { paise: changes[lo]!.paise, version: changes[lo]!.version };
      };
      const counted = family.stockMode !== 'AVAILABILITY';
      products.push({
        id,
        name,
        family: family.line,
        category: family.category,
        unit: family.unit,
        packSize: family.pack,
        counted,
        lowStockAt: family.lowAt,
        qty: family.qty,
        rateOn,
        finalPaise: paise,
        finalVersion: version,
        weight: (count - v) * (f < 4 ? 3 : 1) * (0.5 + rng.next()),
      });
      productRows.push({
        id,
        name,
        brand: family.brand,
        categoryId: family.category,
        type: family.type,
        grade: label,
        unit: family.unit,
        packSize: family.pack,
        minQuantity: 1,
        quantityStep: 1,
        pricePaise: paise,
        priceVersion: version,
        priceUpdatedAt: istInstant(changes[changes.length - 1]!.day, 9, 15),
        priceCheckedAt: istInstant(addDays(ctx.today, -rng.int(0, 6)), 9, 30),
        stock: 0,
        lowStockAt: family.lowAt,
        stockMode: counted ? 'COUNTED' : 'AVAILABILITY',
        active: true,
        images: [],
        description: `Sample product for the demo. ${family.pack ? `${family.pack}. ` : ''}Not a real rate.`,
        recommendedUse: 'Demo data only.',
        createdAt: istInstant(days[0]!, 8, 0),
        updatedAt: istInstant(ctx.today, 8, 0),
      });
    });
  });

  await bulk.addAll(
    'Category',
    categories.filter((c) => !ctx.existingCategories.has(c.slug)),
  );
  await bulk.addAll('Product', productRows);
  await bulk.addAll('ProductPriceHistory', historyRows);
  return products;
}
