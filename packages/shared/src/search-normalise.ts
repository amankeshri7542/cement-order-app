import { buildingTerms } from './glossary';
import { wholeNumberWord } from './quantity';

/**
 * One way to make words comparable, for the desk's search, the phone's search and the reader of
 * WhatsApp orders (plan v4, 09 section 5). Before this the API and the phone disagreed: the phone
 * dropped Devanagari vowel signs, so "सीमेंट" fell apart into single letters there.
 */

/** Devanagari digits as Latin ones: "५०" is "50". */
export const latinDigits = (text: string) =>
  text.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));

/**
 * The stored form of a name or alias. Marks stay, because without them Hindi words fall apart.
 * Saved aliases were made with exactly this, so it must not change; search adds its own steps in
 * `searchKey`.
 */
export function normaliseText(value: string) {
  return latinDigits(value.normalize('NFKC').toLowerCase())
    .replace(/neo\s*steel/g, 'neosteel')
    .replace(/(\d)\s*(mm|kg)\b/g, '$1$2')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

/** Spellings people type for a brand or a material, and the word the catalogue uses. */
const spellings: Record<string, string> = {
  altratek: 'ultratech',
  altratech: 'ultratech',
  altratec: 'ultratech',
  ultratek: 'ultratech',
  ultratec: 'ultratech',
  altratach: 'ultratech',
  siment: 'cement',
  sement: 'cement',
  semant: 'cement',
  cemant: 'cement',
  seement: 'cement',
  simant: 'cement',
  dalmiya: 'dalmia',
  ambuza: 'ambuja',
  tiskon: 'tiscon',
  jindel: 'jindal',
  kamdhenoo: 'kamdhenu',
  birala: 'birla',
  supriem: 'supreme',
  finolax: 'finolex',
};
/** Two words people run together or split. Applied before splitting into words. */
const joined: [RegExp, string][] = [
  [/\bultra\s+tech\b/g, 'ultratech'],
  [/\balt?ra\s+tek\b/g, 'ultratech'],
  [/\bfly\s*ash\b/g, 'flyash'],
];
const units = new Set(['mm', 'kg', 'inch', 'inches', 'mtr', 'ft', 'feet']);

/**
 * A search query or a searchable text as words to compare. On top of `normaliseText`: common
 * misspellings become the catalogue's word, and a size said in words becomes digits
 * ("barah mm" is "12mm"). At most 100 characters are read.
 */
export function searchKey(value: string) {
  let text = normaliseText(value.slice(0, 100));
  for (const [pattern, word] of joined) text = text.replace(pattern, word);
  const words = text.split(' ').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = spellings[words[i]!] ?? words[i]!;
    const size = wholeNumberWord(word);
    const next = words[i + 1];
    if (size !== undefined && next && units.has(next)) {
      out.push(`${size}${next === 'inches' ? 'inch' : next}`);
      i++;
    } else out.push(word);
  }
  return out;
}

/**
 * The words people use for a kind of goods, by category slug. From the glossary (plan 01 section
 * 8.5), the phone's old list and the WhatsApp reader's list, with the Hindi spellings.
 */
const glossaryCategory: Record<string, string> = {
  bori: 'cement',
  cement: 'cement',
  sariya: 'steel',
  gitti: 'aggregates',
  balu: 'sand',
  eent: 'bricks',
};
const extraWords: Record<string, readonly string[]> = {
  cement: ['सीमेंट', 'सिमेंट', 'बोरी'],
  steel: ['loha', 'सरिया', 'लोहा'],
  sand: ['बालू', 'रेत'],
  aggregates: ['gitty', 'गिट्टी'],
  bricks: ['block', 'ईंट', 'ईट'],
  pipes: ['pipe', 'pipes', 'पाइप'],
};
export const materialWords: Readonly<Record<string, readonly string[]>> = (() => {
  const result: Record<string, Set<string>> = {};
  const add = (slug: string, word: string) => (result[slug] ??= new Set()).add(normaliseText(word));
  for (const term of buildingTerms) {
    const slug = glossaryCategory[term.word];
    if (slug) for (const word of term.also) for (const part of searchKey(word)) add(slug, part);
  }
  for (const [slug, words] of Object.entries(extraWords)) for (const word of words) add(slug, word);
  return Object.fromEntries(Object.entries(result).map(([slug, words]) => [slug, [...words]]));
})();

/** Edit distance, stopping once it passes `limit`. Insert, delete, change and swap each cost 1. */
export function editDistance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let before = Array.from({ length: b.length + 1 }, (_, i) => i);
  let previous: number[] = [];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(before[j]! + 1, row[j - 1]! + 1, before[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        value = Math.min(value, previous[j - 2]! + 1);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    previous = before;
    before = row;
  }
  return before[b.length]!;
}

/** What the search needs of a product. The phone and the server fill it from their own data. */
export type SearchProduct = {
  id: string;
  name: string;
  brand?: string;
  grade?: string;
  type?: string;
  nameHi?: string | null;
  /** Category slug, which brings in the everyday words for the material. */
  category?: string;
  /** Saved aliases and the shop's own search words. Matched, never shown. */
  words?: readonly string[];
};
export type SearchIndex<T extends SearchProduct = SearchProduct> = {
  item: T;
  /** Words of the name, brand and Hindi name: a hit here ranks first. */
  own: string[];
  /** Grade, type, aliases and the material's words. */
  other: string[];
  /** Whole names and aliases, for an exact match of everything typed. */
  phrases: Set<string>;
  sortName: string;
}[];

export function indexProducts<T extends SearchProduct>(items: readonly T[]): SearchIndex<T> {
  return items.map((item) => {
    const own = [item.name, item.brand ?? '', item.nameHi ?? ''].flatMap((text) => searchKey(text));
    const other = [
      item.grade ?? '',
      item.type ?? '',
      ...(item.words ?? []),
      ...(materialWords[item.category ?? ''] ?? (item.category ? [item.category] : [])),
    ].flatMap((text) => searchKey(text));
    const phrases = new Set(
      [item.name, `${item.brand ?? ''} ${item.name}`, item.nameHi ?? '', ...(item.words ?? [])]
        .map((text) => searchKey(text).join(' '))
        .filter(Boolean),
    );
    return { item, own, other, phrases, sortName: item.name.toLowerCase() };
  });
}

/** How well one typed word hits a list of words: 0 exact, 1 start of a word, 3 near miss. */
function hit(word: string, words: readonly string[]) {
  let best = Infinity;
  const fuzzy = word.length >= 4 && !/\d/.test(word);
  const limit = word.length >= 7 ? 2 : 1;
  for (const candidate of words) {
    if (candidate === word) return 0;
    if (candidate.startsWith(word)) best = Math.min(best, 1);
    else if (fuzzy && best > 3 && candidate.length >= 3 && !/\d/.test(candidate)) {
      const whole = editDistance(word, candidate, limit);
      const start = editDistance(word, candidate.slice(0, word.length), limit);
      if (Math.min(whole, start) <= limit) best = 3;
    }
  }
  return best;
}

/**
 * Products in the order a person most likely meant. Every word typed must hit the name, brand,
 * grade, type, an alias or the material's words; a near miss (one or two letters out) counts, but
 * after real hits. Ties go by name.
 */
export function rankProducts<T extends SearchProduct>(
  index: SearchIndex<T>,
  query: string,
  limit = Infinity,
): T[] {
  const words = searchKey(query);
  if (!words.length) return [];
  const phrase = words.join(' ');
  const scored: { entry: SearchIndex<T>[number]; score: number }[] = [];
  for (const entry of index) {
    let score = 0;
    for (const word of words) {
      const own = hit(word, entry.own);
      const other = own === 0 ? Infinity : hit(word, entry.other) + 1;
      const best = Math.min(own, other);
      if (best === Infinity) {
        score = Infinity;
        break;
      }
      score += best;
    }
    if (score === Infinity) continue;
    if (entry.phrases.has(phrase)) score -= 10;
    else if (entry.own[0]?.startsWith(words[0]!)) score -= 1;
    scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.entry.sortName.localeCompare(b.entry.sortName))
    .slice(0, limit)
    .map(({ entry }) => entry.item);
}
