import type { Language } from './i18n';

// Product text in the reader's language. English always shows exactly what the shop typed, so
// English screens (and the tests that read them) never change; Hindi swaps in the Hindi name,
// description and unit words where the shop has them.

type Named = { name: string; nameHi?: string | null };
type Described = { description: string; descriptionHi?: string | null };

export const productName = (product: Named, language: Language) =>
  (language === 'hi' && product.nameHi) || product.name;
export const productDescription = (product: Described, language: Language) =>
  (language === 'hi' && product.descriptionHi) || product.description;

// Hindi for the selling-unit words the shop uses, as spoken at the counter. Longer spellings
// come first so "tonne" is not read as "ton" + "ne".
const unitWords: [spellings: string[], hindi: string][] = [
  [['cubic feet', 'cubic foot', 'cu ft', 'cft'], 'घन फ़ुट'],
  [['square feet', 'square foot', 'sq ft', 'sqft'], 'वर्ग फ़ुट'],
  [['quintal', 'qtl'], 'क्विंटल'],
  [['tonne', 'ton'], 'टन'],
  [['kilogram', 'kilo', 'kg'], 'किलो'],
  [['bag'], 'बोरी'],
  [['piece', 'pcs', 'pc'], 'पीस'],
  [['bundle'], 'बंडल'],
  [['trolley'], 'ट्रॉली'],
  [['metre', 'meter', 'm'], 'मीटर'],
  [['litre', 'liter', 'ltr'], 'लीटर'],
  [['brick'], 'ईंट'],
];
const hindiFor = new Map(
  unitWords.flatMap(([spellings, hindi]) => spellings.map((s) => [s, hindi] as const)),
);
const spelling = (s: string) => s.replace(/ /g, '\\.?\\s*');
// A known unit word on its own (not inside another word), in any case, singular or plural:
// "bag", "Bags", "50 kg bag", "100 cu ft", "12 m pieces".
const unitPattern = new RegExp(
  `\\b(${unitWords.flatMap(([spellings]) => spellings.map(spelling)).join('|')})(?:e?s)?\\b`,
  'gi',
);

/**
 * The selling unit for display. English returns the unit exactly as stored; Hindi translates
 * the unit words it knows and keeps numbers and anything else as typed ("50 kg bag" →
 * "50 किलो बोरी"). Unknown units are shown as stored.
 */
export function unitLabel(unit: string, language: Language): string {
  if (language !== 'hi') return unit;
  return unit.replace(
    unitPattern,
    // "Sq. Ft", "cu.ft" and "cu  ft" all look up as "sq ft" / "cu ft".
    (match, word: string) => hindiFor.get(word.toLowerCase().replace(/[.\s]+/g, ' ')) ?? match,
  );
}
