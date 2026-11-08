import type { SearchProduct } from './search-normalise';

/*
 * Plan v4, 09 section 5: real-world queries with the product that must come first, run against
 * both the phone's search and the server's (`GET admin/search`). The catalogue copies the demo
 * seed's naming (`${line} ${size or grade}`), so the queries read like the shop's own goods.
 * Test data only: nothing in an app imports this file.
 */
type Case = SearchProduct & { category: string };
const p = (
  id: string,
  name: string,
  brand: string,
  category: string,
  type: string,
  grade: string,
  extra: Partial<SearchProduct> = {},
): Case => ({ id, name, brand, category, type, grade, ...extra });

export const searchCatalogue: readonly Case[] = [
  p('sq-ult-ppc', 'UltraTech Cement PPC', 'UltraTech', 'cement', 'Cement', 'PPC', {
    nameHi: 'अल्ट्राटेक सीमेंट पीपीसी',
  }),
  p('sq-ult-53', 'UltraTech Cement OPC 53', 'UltraTech', 'cement', 'Cement', 'OPC 53'),
  p('sq-ult-43', 'UltraTech Cement OPC 43', 'UltraTech', 'cement', 'Cement', 'OPC 43'),
  p('sq-acc-ppc', 'ACC Cement PPC', 'ACC', 'cement', 'Cement', 'PPC'),
  p('sq-amb-ppc', 'Ambuja Cement PPC', 'Ambuja', 'cement', 'Cement', 'PPC', {
    words: ['ambuja plus'],
  }),
  p('sq-dal-psc', 'Dalmia Cement PSC', 'Dalmia', 'cement', 'Cement', 'PSC'),
  p('sq-shree-53', 'Shree Cement OPC 53', 'Shree', 'cement', 'Cement', 'OPC 53'),
  p('sq-birla-ppc', 'Birla Gold Cement PPC', 'Birla Gold', 'cement', 'Cement', 'PPC'),
  p('sq-jkl-ppc', 'JK Lakshmi Cement PPC', 'JK Lakshmi', 'cement', 'Cement', 'PPC'),
  p('sq-konark-ppc', 'Konark Cement PPC', 'Konark', 'cement', 'Cement', 'PPC'),
  p('sq-jkw', 'JK White cement 1 kg', 'JK White', 'cement', 'White cement', '1 kg'),
  p('sq-tata-8', 'Tata Tiscon TMT 8 mm', 'Tata Tiscon', 'steel', 'TMT bar', '8 mm'),
  p('sq-tata-12', 'Tata Tiscon TMT 12 mm', 'Tata Tiscon', 'steel', 'TMT bar', '12 mm'),
  p('sq-tata-16', 'Tata Tiscon TMT 16 mm', 'Tata Tiscon', 'steel', 'TMT bar', '16 mm'),
  p('sq-sail-12', 'SAIL TMT 12 mm', 'SAIL', 'steel', 'TMT bar', '12 mm'),
  p('sq-kam-10', 'Kamdhenu TMT 10 mm', 'Kamdhenu', 'steel', 'TMT bar', '10 mm'),
  p('sq-jin-12', 'Jindal Panther TMT 12 mm', 'Jindal Panther', 'steel', 'TMT bar', '12 mm'),
  p('sq-wire-18', 'Binding wire 18 gauge', 'Local', 'steel', 'Steel accessory', '18 gauge', {
    words: ['tar', 'bandhai'],
  }),
  p('sq-ring-6', 'Ring (stirrup) 6 mm', 'Local', 'steel', 'Steel accessory', '6 mm'),
  p('sq-sone-fine', 'Sone balu Fine', 'Local supply', 'sand', 'Sand', 'Fine'),
  p('sq-sone-coarse', 'Sone balu Coarse', 'Local supply', 'sand', 'Sand', 'Coarse'),
  p('sq-gitti-20', 'Gitti (stone chips) 20 mm', 'Local supply', 'aggregates', 'Aggregate', '20 mm'),
  p('sq-gitti-10', 'Gitti (stone chips) 10 mm', 'Local supply', 'aggregates', 'Aggregate', '10 mm'),
  p('sq-dust', 'Stone dust Fine', 'Local supply', 'aggregates', 'Aggregate', 'Fine'),
  p('sq-brick-1', 'Red brick First class', 'Local kiln', 'bricks', 'Masonry unit', 'First class', {
    words: ['laal eent'],
  }),
  p('sq-brick-2', 'Red brick Second class', 'Local kiln', 'bricks', 'Masonry unit', 'Second class'),
  p('sq-flyash', 'Fly ash brick Standard', 'Local plant', 'bricks', 'Masonry unit', 'Standard'),
  p('sq-aac-100', 'AAC block 100 mm', 'Magicrete', 'bricks', 'Masonry unit', '100 mm'),
  p('sq-sup-pvc-1', 'Supreme PVC pipe 1 inch', 'Supreme', 'pipes', 'PVC pipe', '1 inch'),
  p('sq-fin-pvc-2', 'Finolex PVC pipe 2 inch', 'Finolex', 'pipes', 'PVC pipe', '2 inch'),
  p('sq-ast-cpvc-1', 'Astral CPVC pipe 1 inch', 'Astral', 'pipes', 'CPVC pipe', '1 inch'),
  p('sq-sup-elbow', 'PVC elbow 1 inch', 'Supreme', 'pipes', 'Pipe fitting', '1 inch'),
  p('sq-nails-3', 'Wire nails 3 inch', 'Local', 'hardware', 'Hardware', '3 inch'),
  p(
    'sq-fixit',
    'Dr. Fixit waterproofing 1 litre',
    'Dr. Fixit',
    'hardware',
    'Waterproofing',
    '1 litre',
  ),
  p('sq-tasla', 'Tools Tasla', 'Local', 'hardware', 'Hardware', 'Tasla', { words: ['tagari'] }),
  p('sq-belcha', 'Tools Belcha', 'Local', 'hardware', 'Hardware', 'Belcha', { words: ['phawda'] }),
  p('sq-putty', 'Birla White wall putty 20 kg', 'Birla White', 'hardware', 'Putty', '20 kg'),
];

const ultratech = ['sq-ult-43', 'sq-ult-53', 'sq-ult-ppc'];
const twelve = ['sq-tata-12', 'sq-sail-12', 'sq-jin-12'];
const sone = ['sq-sone-fine', 'sq-sone-coarse'];
const bricks = ['sq-brick-1', 'sq-brick-2', 'sq-flyash', 'sq-aac-100'];
const ppc = [
  'sq-ult-ppc',
  'sq-acc-ppc',
  'sq-amb-ppc',
  'sq-birla-ppc',
  'sq-jkl-ppc',
  'sq-konark-ppc',
];

/** A query and what must come first: one product, any of a few equals, or nothing at all. */
export const searchQueries: readonly (readonly [string, string | readonly string[] | null])[] = [
  // Cement: brands in four letters, grades, spellings and Hindi.
  ['ultr', ultratech],
  ['ULTRA', ultratech],
  ['ultratech ppc', 'sq-ult-ppc'],
  ['ultratech 53', 'sq-ult-53'],
  ['altratek', ultratech],
  ['altratek ppc', 'sq-ult-ppc'],
  ['ultra tech 43', 'sq-ult-43'],
  ['ultrtech 53', 'sq-ult-53'],
  ['acc', 'sq-acc-ppc'],
  ['ambu', 'sq-amb-ppc'],
  ['ambuza', 'sq-amb-ppc'],
  ['ambuja plus', 'sq-amb-ppc'],
  ['dalmiya', 'sq-dal-psc'],
  ['dalm', 'sq-dal-psc'],
  ['psc', 'sq-dal-psc'],
  ['shree 53', 'sq-shree-53'],
  ['birla gold', 'sq-birla-ppc'],
  ['birla', 'sq-birla-ppc'],
  ['jk lak', 'sq-jkl-ppc'],
  ['kona', 'sq-konark-ppc'],
  ['white cement', 'sq-jkw'],
  ['siment ppc', ppc],
  ['सीमेंट', 'sq-ult-ppc'],
  ['अल्ट्राटेक', 'sq-ult-ppc'],
  ['cement 53', ['sq-shree-53', 'sq-ult-53']],
  // Steel: sizes in digits and in words, sariya in its spellings.
  ['tata 12', 'sq-tata-12'],
  ['tisc 16', 'sq-tata-16'],
  ['tiskon 8', 'sq-tata-8'],
  ['tata 12mm', 'sq-tata-12'],
  ['tata 12 mm', 'sq-tata-12'],
  ['barah mm sariya', twelve],
  ['sariya 16', 'sq-tata-16'],
  ['saria 10', 'sq-kam-10'],
  ['सरिया 12', twelve],
  ['tmt 8', 'sq-tata-8'],
  ['sail', 'sq-sail-12'],
  ['kamd', 'sq-kam-10'],
  ['jindal', 'sq-jin-12'],
  ['panther', 'sq-jin-12'],
  ['binding', 'sq-wire-18'],
  ['bandhai', 'sq-wire-18'],
  ['ring', 'sq-ring-6'],
  // Sand, gitti and bricks by their everyday names.
  ['balu', sone],
  ['sand fine', 'sq-sone-fine'],
  ['बालू', sone],
  ['gitti 20', 'sq-gitti-20'],
  ['giti 10', 'sq-gitti-10'],
  ['stone dust', 'sq-dust'],
  ['chips 20', 'sq-gitti-20'],
  ['eent', bricks],
  ['laal eent', 'sq-brick-1'],
  ['red brick second', 'sq-brick-2'],
  ['fly ash', 'sq-flyash'],
  ['aac 100', 'sq-aac-100'],
  ['magicrete', 'sq-aac-100'],
  // Pipes and hardware.
  ['supreme pvc 1', 'sq-sup-pvc-1'],
  ['finolax', 'sq-fin-pvc-2'],
  ['cpvc', 'sq-ast-cpvc-1'],
  ['elbow', 'sq-sup-elbow'],
  ['nails 3', 'sq-nails-3'],
  ['dr fixit', 'sq-fixit'],
  ['tasla', 'sq-tasla'],
  ['phawda', 'sq-belcha'],
  ['putty', 'sq-putty'],
  // Nothing should come back for these.
  ['tata cement', null],
  ['zzzz', null],
];
