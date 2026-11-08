import type { Language } from './i18n';

// One copy of the selling rules the API enforces (apps/api/src/inventory.ts validateQuantity):
// a whole number, at least the minimum, a multiple of the step, and no more than allowed.
export type QuantityRules = { minQuantity: number; quantityStep: number };
export type QuantityProblem = 'whole' | 'minimum' | 'step' | 'maximum';
export const MAX_LINE_QUANTITY = 10000;

export function quantityProblem(
  product: QuantityRules,
  quantity: number,
  max: number = MAX_LINE_QUANTITY,
): QuantityProblem | null {
  if (!Number.isInteger(quantity)) return 'whole';
  if (quantity < product.minQuantity) return 'minimum';
  if (quantity % product.quantityStep !== 0) return 'step';
  if (quantity > max) return 'maximum';
  return null;
}
export const isValidQuantity = (product: QuantityRules, quantity: number, max?: number) =>
  quantityProblem(product, quantity, max) === null;

/** The largest valid quantity not above `limit` (stock or line cap), or 0 when none fits. */
export function maxOrderable(product: QuantityRules, limit: number) {
  const top =
    Math.floor(Math.min(limit, MAX_LINE_QUANTITY) / product.quantityStep) * product.quantityStep;
  return top >= product.minQuantity ? top : 0;
}
/** The first valid quantity at or above `value` (used to round a typed amount up). */
export function roundUpQuantity(product: QuantityRules, value: number) {
  const atLeastMinimum = Math.max(value, product.minQuantity);
  return Math.ceil(atLeastMinimum / product.quantityStep) * product.quantityStep;
}
export function stepUp(product: QuantityRules, value: number) {
  return roundUpQuantity(product, value + product.quantityStep);
}
/** One step down; 0 means "remove" once the minimum would be crossed. */
export function stepDown(product: QuantityRules, value: number) {
  const next = value - product.quantityStep;
  return next < product.minQuantity ? 0 : next;
}

export function quantityHint(product: QuantityRules, max: number, language: Language) {
  return language === 'hi'
    ? `न्यूनतम ${product.minQuantity}; ${product.quantityStep} के गुणक; अधिकतम ${max}।`
    : `Minimum ${product.minQuantity}; multiples of ${product.quantityStep}; maximum ${max}.`;
}

/*
 * Numbers said in words (plan v4, 09 section 5): Hinglish and Hindi, with sau, hazaar, lakh and
 * crore, and the fractions people say ("dedh", "dhai", "sawa", "paune"). Saathi, the bill parser,
 * voice and search all read numbers with these, so "dhai sau" means 250 everywhere.
 */
const plainWords: [number, string[]][] = [
  [0, ['shunya', 'zero', 'शून्य']],
  [1, ['ek', 'ik', 'one', 'एक']],
  [2, ['do', 'doh', 'two', 'दो']],
  [3, ['teen', 'tin', 'three', 'तीन']],
  [4, ['char', 'chaar', 'four', 'चार']],
  [5, ['paanch', 'panch', 'paach', 'five', 'पांच', 'पाँच']],
  [6, ['chhe', 'chhah', 'chah', 'che', 'chhai', 'six', 'छह', 'छः', 'छे']],
  [7, ['saat', 'sat', 'seven', 'सात']],
  [8, ['aath', 'ath', 'eight', 'आठ']],
  [9, ['nau', 'nine', 'नौ']],
  [10, ['das', 'dus', 'ten', 'दस']],
  [11, ['gyarah', 'gyara', 'eleven', 'ग्यारह']],
  [12, ['barah', 'baarah', 'bara', 'twelve', 'बारह']],
  [13, ['terah', 'tera', 'thirteen', 'तेरह']],
  [14, ['chaudah', 'chauda', 'fourteen', 'चौदह']],
  [15, ['pandrah', 'pandra', 'fifteen', 'पंद्रह', 'पन्द्रह']],
  [16, ['solah', 'sola', 'sixteen', 'सोलह']],
  [17, ['satrah', 'satra', 'seventeen', 'सत्रह']],
  [18, ['atharah', 'athara', 'eighteen', 'अठारह']],
  [19, ['unnis', 'unees', 'nineteen', 'उन्नीस']],
  [20, ['bees', 'bis', 'twenty', 'बीस']],
  [21, ['ikkis', 'ikkees', 'इक्कीस']],
  [22, ['bais', 'baees', 'बाईस']],
  [24, ['chaubis', 'chaubees', 'चौबीस']],
  [25, ['pachchis', 'pachees', 'pachis', 'pachchees', 'पच्चीस']],
  [30, ['tees', 'tis', 'thirty', 'तीस']],
  [35, ['paintees', 'paitis', 'पैंतीस']],
  [40, ['chalis', 'chaalis', 'chalees', 'forty', 'चालीस']],
  [45, ['paintalis', 'paintalees', 'पैंतालीस']],
  [50, ['pachas', 'pachaas', 'pachaass', 'fifty', 'पचास']],
  [60, ['saath', 'sixty', 'साठ']],
  [70, ['sattar', 'seventy', 'सत्तर']],
  [75, ['pachattar', 'pachhattar', 'पचहत्तर']],
  [80, ['assi', 'assee', 'eighty', 'अस्सी']],
  [90, ['nabbe', 'nabbey', 'ninety', 'नब्बे']],
];
const scaleWords: [number, string[]][] = [
  [100, ['sau', 'so', 'hundred', 'सौ']],
  [1000, ['hazaar', 'hazar', 'hajar', 'hajaar', 'thousand', 'हज़ार', 'हजार']],
  [100000, ['lakh', 'lac', 'lakhs', 'lacs', 'लाख']],
  [10000000, ['crore', 'karod', 'karor', 'cr', 'crores', 'करोड़', 'करोड']],
];
const fractionWords: [number, string[]][] = [
  [0.5, ['aadha', 'aadhi', 'adha', 'aadhe', 'आधा', 'आधी']],
  [0.25, ['paav', 'pao', 'पाव']],
  [1.5, ['dedh', 'derh', 'डेढ़', 'डेढ']],
  [2.5, ['dhai', 'dhaai', 'adhai', 'ढाई']],
];
/** "sawa do" is 2¼ and "paune do" is 1¾: a quarter on or off the number that follows. */
const quarterWords: [number, string[]][] = [
  [0.25, ['sawa', 'sava', 'सवा']],
  [-0.25, ['paune', 'pone', 'पौने']],
];
const fillers = new Set([
  'aur',
  'and',
  'और',
  'rs',
  'inr',
  'rupaye',
  'rupaiye',
  'rupay',
  'rupees',
  'rupee',
  'rupiya',
  'रुपये',
  'रुपए',
  'रुपया',
]);
// Keys pass through NFKC and lower case, as typed text does, so "हज़ार" and "हजार" both match.
const keyOf = (word: string) => word.normalize('NFKC').toLowerCase();
const tableOf = (rows: [number, string[]][]) =>
  new Map(rows.flatMap(([value, words]) => words.map((word) => [keyOf(word), value] as const)));
const plainTable = tableOf(plainWords);
const scaleTable = tableOf(scaleWords);
const fractionTable = tableOf(fractionWords);
const quarterTable = tableOf(quarterWords);

/** A whole number from 0 to 99 said as one word, such as "barah" or "बारह". For sizes in search. */
export const wholeNumberWord = (word: string) => plainTable.get(keyOf(word));

const devanagariDigits = (text: string) =>
  text.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));
/** "1,20,000" (Indian) or "120,000" (western) as plain digits; other commas are not a number. */
const groupedDigits = /^\d{1,3}(?:(?:,\d{2})*,\d{3}|(?:,\d{3})+)(?:\.\d+)?$/;

/**
 * The number some words say, or null when they say something else. Reads digits ("₹1,20,000",
 * "1.2 lakh"), words ("dhai sau", "ek lakh bees hazaar", "पचास") and both mixed. Rupee signs and
 * the word "rupaye" are allowed; anything else that is not part of a number makes it null.
 */
export function readNumber(text: string): number | null {
  const plain = devanagariDigits(text.normalize('NFKC').toLowerCase())
    .replace(/₹|\/-/g, ' ')
    .replace(/\brs\./g, ' ')
    // "1.2lakh" and "50hazaar" are two words.
    .replace(/(\d)(?=\p{L})/gu, '$1 ');
  const tokens = plain.split(/[\s-]+/).filter(Boolean);
  if (!tokens.length || tokens.length > 12) return null;
  // Big groups so far (lakh, hazaar…), the group being built below a thousand, and the last big
  // scale used: "ek crore do lakh" goes down, "do lakh ek crore" is not a number.
  let total = 0;
  let current = 0;
  let lastScale = Infinity;
  let quarter = 0;
  let seen = false;
  // Two plain numbers in a row ("bees paanch") is not how anyone says 25, so it is not read.
  let last: 'number' | 'scale' | 'none' = 'none';
  for (const token of tokens) {
    if (fillers.has(token)) continue;
    let value: number | undefined;
    if (/^\d+(?:\.\d+)?$/.test(token)) value = Number(token);
    else if (groupedDigits.test(token)) value = Number(token.replace(/,/g, ''));
    else value = plainTable.get(token) ?? fractionTable.get(token);
    if (value !== undefined) {
      if (last === 'number') return null;
      current += value + quarter;
      quarter = 0;
      last = 'number';
      seen = true;
      continue;
    }
    const step = quarterTable.get(token);
    if (step !== undefined) {
      if (quarter || last === 'number') return null;
      quarter = step;
      continue;
    }
    const scale = scaleTable.get(token);
    if (scale === undefined) return null;
    // "sau" alone is a hundred, and "paune sau" is seventy-five.
    const base = last === 'number' ? current : 1 + quarter;
    quarter = 0;
    if (scale === 100) {
      if (last !== 'number' && current) return null;
      if (base >= 100) return null;
      current = base * 100;
    } else {
      if (scale >= lastScale) return null;
      total += (last === 'number' || last === 'none' ? base : current || base) * scale;
      current = 0;
      lastScale = scale;
    }
    last = 'scale';
    seen = true;
  }
  if (quarter) {
    // "sawa" or "paune" with nothing after it: a quarter more or less than one.
    if (last === 'number' || current) return null;
    current = 1 + quarter;
    seen = true;
  }
  if (!seen) return null;
  const result = Math.round((total + current) * 100) / 100;
  return Number.isFinite(result) && result <= 1e12 ? result : null;
}

/** Every number a text states, each run of number words read as one ("do sau pachaas bori"). */
export function numbersIn(text: string): number[] {
  const found: number[] = [];
  let run: string[] = [];
  const flush = () => {
    if (!run.length) return;
    const value = readNumber(run.join(' '));
    if (value !== null) found.push(value);
    else
      for (const word of run) {
        const single = readNumber(word);
        if (single !== null) found.push(single);
      }
    run = [];
  };
  const words = devanagariDigits(text.normalize('NFKC').toLowerCase())
    .replace(/₹/g, ' ')
    .split(/[^\p{L}\p{M}\p{N}.,]+/u)
    .map((word) => word.replace(/^[.,]+|[.,]+$/g, ''))
    .filter(Boolean);
  for (const word of words) {
    const part =
      /^\d/.test(word) ||
      plainTable.has(word) ||
      scaleTable.has(word) ||
      fractionTable.has(word) ||
      quarterTable.has(word);
    if (part) run.push(word);
    else flush();
  }
  flush();
  return found;
}
