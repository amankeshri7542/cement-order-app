/**
 * Site words as customers say them, for search and for reading questions. From plan 01 section 8.5.
 * Words marked there as "family must confirm" are not here until the family has confirmed them.
 * Tiles, putty and finishing materials are left out on purpose (decision 51).
 */
export type BuildingTerm = {
  word: string;
  means: string;
  /** How a customer may spell or say it. Lower case. */
  also: readonly string[];
  /** English words that find it in the catalogue and the guide. */
  search: readonly string[];
};

export const buildingTerms: readonly BuildingTerm[] = [
  {
    word: 'bori',
    means: 'bag of cement',
    also: ['bori', 'bora', 'boriya', 'bag', 'bags'],
    search: ['bag', 'cement'],
  },
  {
    word: 'sariya',
    means: 'TMT steel rod',
    also: ['sariya', 'saria', 'sarya', 'sariyaa', 'chhad', 'rod', 'rods', 'tmt', 'steel'],
    search: ['steel', 'tmt', 'sariya'],
  },
  {
    word: 'gitti',
    means: 'crushed stone',
    also: ['gitti', 'giti', 'aggregate', 'stone chips', 'chips'],
    search: ['aggregate', 'gitti', 'stone'],
  },
  {
    word: 'balu',
    means: 'sand',
    also: ['balu', 'baalu', 'sand', 'ret', 'reti'],
    search: ['sand', 'balu'],
  },
  {
    word: 'eent',
    means: 'brick',
    also: ['eent', 'eet', 'int', 'itta', 'brick', 'bricks'],
    search: ['brick', 'bricks'],
  },
  { word: 'cement', means: 'cement', also: ['cement', 'siment', 'semant'], search: ['cement'] },
  {
    word: 'trolley',
    means: 'one tractor-trolley load, size varies',
    also: ['trolley', 'tractor'],
    search: ['trolley', 'load'],
  },
  {
    word: 'truck',
    means: 'larger load',
    also: ['truck', 'hyva', 'hiva', 'tipper'],
    search: ['truck', 'load'],
  },
  {
    word: 'cft',
    means: 'cubic feet',
    also: ['cft', 'cu ft', 'ghan foot'],
    search: ['cft', 'cubic'],
  },
  {
    word: 'kanta',
    means: 'weighing scale',
    also: ['kanta', 'kaanta', 'weighbridge'],
    search: ['weight', 'weigh'],
  },
  {
    word: 'bhada',
    means: 'delivery cost',
    also: ['bhada', 'freight', 'gaadi bhada'],
    search: ['delivery'],
  },
  {
    word: 'neev',
    means: 'foundation',
    also: ['neev', 'nio', 'foundation'],
    search: ['foundation'],
  },
  {
    word: 'dhalai',
    means: 'slab casting',
    also: ['dhalai', 'dhalaai', 'lenter', 'lintal'],
    search: ['slab', 'casting'],
  },
  {
    word: 'jodai',
    means: 'brickwork',
    also: ['jodai', 'chinai', 'brickwork'],
    search: ['brickwork', 'wall'],
  },
  {
    word: 'thekedar',
    means: 'contractor',
    also: ['thekedar', 'contractor'],
    search: ['contractor'],
  },
  { word: 'mistri', means: 'mason', also: ['mistri', 'mason', 'raj mistri'], search: ['mason'] },
  {
    word: 'rate',
    means: "today's price",
    also: ['rate', 'bhav', 'bhaav', 'daam', 'price'],
    search: ['rate', 'price'],
  },
  {
    word: 'seelan',
    means: 'damp',
    also: ['seelan', 'seepage', 'nami', 'damp', 'seep'],
    search: ['damp', 'seepage'],
  },
  {
    word: 'daraar',
    means: 'crack',
    also: ['daraar', 'darar', 'crack', 'cracks'],
    search: ['crack', 'cracks'],
  },
  {
    word: 'rakhna',
    means: 'to store',
    also: ['rakhna', 'rakhein', 'rakhen', 'rakhun', 'rakhe', 'store', 'storage'],
    search: ['store', 'storing'],
  },
  {
    word: 'jaanch',
    means: 'to check',
    also: ['jaanch', 'janch', 'jaanchein', 'parakh', 'check'],
    search: ['check'],
  },
] as const;

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** The glossary entries a question mentions. Whole words only, so "rate" does not match "pirate". */
export function termsIn(text: string): BuildingTerm[] {
  const lower = ` ${wordsOf(text).join(' ')} `;
  return buildingTerms.filter((term) => term.also.some((word) => lower.includes(` ${word} `)));
}

/** The question with the English words that find its meaning, for literal search. */
export function expandTerms(text: string): string {
  const extra = termsIn(text).flatMap((term) => term.search);
  return [...new Set([...wordsOf(text), ...extra])].join(' ');
}
