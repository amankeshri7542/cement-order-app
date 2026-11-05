// Every word about a material that is not a rate. No prices, stock, delivery terms or shop facts
// here: those come live from the catalogue. No engineering values either: quantities, mix ratios
// and grades for structural work are for the customer's engineer to decide (brief rule 7).

export type Material = {
  /** The address on this site. */
  slug: string;
  /** Category.slug in the database. Renamed only here until plan 10's M03 renames the rows. */
  apiSlug: string;
  /** The word used on signs and in speech. */
  name: string;
  /** Plain words after the trade word: "Sariya: TMT steel rod". */
  plain: string;
  also: string;
  /** Search terms typed by people. Latin only: Hindi-script terms live in ProductAlias. */
  terms: string[];
  specimen: 'cement' | 'sariya' | 'bricks' | 'balu' | 'gitti' | null;
  /** Short unit name for a rate bar, when every product shares it. */
  sold: string[];
  choose: string[];
  arrival: string[];
  storage?: string[];
  stages: string[];
};

export const materials: Material[] = [
  {
    slug: 'cement',
    apiSlug: 'cement',
    name: 'Cement',
    plain: 'bags of cement',
    also: 'Cement is sold by the bori, the 50 kg bag.',
    terms: ['cement', 'simant', 'bori', 'bag', 'ppc', 'opc', 'psc'],
    specimen: 'cement',
    sold: [
      'By the bori, a 50 kg bag. The rate on this page is for one bag of that brand and type.',
      'Compare the same type and the same pack. A rate for a different pack is a different rate.',
    ],
    choose: [
      'PPC, OPC and PSC are types of cement, and the letters are printed on the bag.',
      'Which type and grade goes into your slab and columns is your engineer’s decision. Ask before you buy.',
    ],
    arrival: [
      'Look at the printed week and year of packing on the bag.',
      'Check the bag is sealed and dry, with no hard lumps you can feel through it.',
    ],
    storage: ['Keep bags dry and off the floor, stacked away from damp walls.'],
    stages: ['foundation', 'columns', 'brickwork', 'slab', 'plaster'],
  },
  {
    slug: 'sariya',
    apiSlug: 'steel',
    name: 'Sariya',
    plain: 'TMT steel rod',
    also: 'Sariya is TMT steel rod, also called saria or chhad. Binding wire is sold with it.',
    terms: ['sariya', 'saria', 'chhad', 'rod', 'tmt', 'steel', 'bar', 'binding wire', 'wire'],
    specimen: 'sariya',
    sold: [
      'By weight, usually by the kg. The size and grade are written beside the rate.',
      'A cut length or a bundle is still priced by weight, so ask for the weighed amount on your bill.',
    ],
    choose: [
      'Bar sizes and the steel list for your house come from your engineer’s structural drawing. Bring that list and we price it.',
      'The grade, such as Fe 500 or Fe 550, is rolled or marked on the bar.',
    ],
    arrival: [
      'Match the size and grade against your engineer’s list.',
      'Look for the maker’s mark on the bar, and check the weight on the bill.',
    ],
    storage: ['Keep bars off wet ground, and cover them if work will not start soon.'],
    stages: ['foundation', 'columns', 'slab', 'home'],
  },
  {
    slug: 'bricks',
    apiSlug: 'bricks',
    name: 'Bricks and blocks',
    plain: 'eent',
    also: 'Bricks are also called eent.',
    terms: ['brick', 'bricks', 'eent', 'int', 'block', 'blocks'],
    specimen: 'bricks',
    sold: ['By the thousand, or as written beside the rate.'],
    choose: [
      'Compare the class and size of the brick, not only the rate.',
      'Which block suits a load-bearing wall is a question for your engineer.',
    ],
    arrival: [
      'Count a stack before unloading the rest, and look for even colour and sharp edges.',
      'Set aside broken bricks and agree on them before paying.',
    ],
    stages: ['brickwork'],
  },
  {
    slug: 'balu',
    apiSlug: 'sand',
    name: 'Balu',
    plain: 'sand',
    also: 'Balu is sand, sold for building and plaster work.',
    terms: ['balu', 'baalu', 'sand', 'reti', 'trolley'],
    specimen: 'balu',
    sold: [
      'By volume, as written beside the rate.',
      'Trolley sizes vary, so ask how much a load holds before you compare rates.',
    ],
    choose: ['Coarse or fine depends on the work. Your mason or engineer can say which you need.'],
    arrival: [
      'Look at the load before it is tipped, and feel for clay or silt in a handful.',
      'Check the load matches the measure on your bill.',
    ],
    stages: ['foundation', 'brickwork', 'plaster'],
  },
  {
    slug: 'gitti',
    apiSlug: 'aggregates',
    name: 'Gitti',
    plain: 'stone chips',
    also: 'Gitti is stone chips, also called aggregate.',
    terms: ['gitti', 'giti', 'stone', 'chips', 'aggregate', 'aggregates', 'chhari'],
    specimen: 'gitti',
    sold: ['By volume, as written beside the rate. The size in mm is part of the name.'],
    choose: ['Your engineer’s drawing says which size the concrete needs.'],
    arrival: ['Check the size matches what you asked for, and that the load is clean of soil.'],
    stages: ['foundation', 'slab'],
  },
];

/** The site's address for a database category: steel becomes sariya. Others keep their slug. */
export const siteSlug = (apiSlug: string) =>
  materials.find((item) => item.apiSlug === apiSlug)?.slug ?? apiSlug;
export const apiSlugFor = (slug: string) =>
  materials.find((item) => item.slug === slug)?.apiSlug ?? slug;
export const materialFor = (slug: string) => materials.find((item) => item.slug === slug) ?? null;
