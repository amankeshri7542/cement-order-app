import { istToday } from '@shiv/shared';
import { z } from 'zod';
import {
  candidatesIn,
  normalizeAlias,
  productNamedIn,
  type Catalog,
  type MatchMethod,
} from '../catalog-match';

export const readerIntents = [
  'ORDER',
  'ORDER_CHANGE',
  'RATE_QUESTION',
  'STATUS_QUESTION',
  'HUMAN_REQUEST',
  'COMPLAINT',
  'PRICE_OR_CREDIT_TALK',
  'STOCK_OR_TIME_QUESTION',
  'STRUCTURAL',
  'OFF_TOPIC',
  'CHAT',
  'PERSONAL_OR_SUPPLIER',
  'NOT_UNDERSTOOD',
] as const;
const dayKinds = ['TODAY', 'TOMORROW', 'DAY_AFTER', 'WEEKDAY', 'DATE', 'UNSPECIFIED'] as const;
// A model's answer goes into the database and onto the desk, so it holds no control characters.
const short = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !/[^\P{C}\n\t\u200C\u200D]/u.test(value));

/**
 * All a reader may answer with, from plain rules or from the model. It holds no sentence for a
 * customer, so nothing it says can reach one.
 */
export const readerOutputSchema = z.object({
  intent: z.enum(readerIntents),
  language: z.enum(['hinglish', 'hindi', 'english']),
  injectionSuspected: z.boolean(),
  lines: z
    .array(
      z.object({
        rawText: short(200),
        productId: short(100).nullable(),
        quantity: z.number().int().min(1).max(1000000).nullable(),
        unitWord: short(30).nullable(),
        evidence: short(200),
        modelConfidence: z.number().min(0).max(1).nullable(),
      }),
    )
    .max(20),
  place: z.object({ text: short(120), evidence: short(120) }).nullable(),
  fulfilment: z.enum(['PICKUP', 'DELIVERY', 'UNKNOWN']),
  day: z.object({
    kind: z.enum(dayKinds),
    weekday: z.number().int().min(0).max(6).nullable(),
    date: z.iso.date().nullable(),
  }),
  timeWish: short(60).nullable(),
  paymentWords: short(120).nullable(),
  forWhom: short(120).nullable(),
});
export type ReaderOutput = z.infer<typeof readerOutputSchema>;
export type Intent = (typeof readerIntents)[number];
export type Band = 'GREEN' | 'AMBER' | 'RED';

export type ReadLine = {
  rawText: string;
  productId: string | null;
  productName: string | null;
  quantity: number | null;
  unitWord: string | null;
  evidence: string;
  method: MatchMethod | null;
  candidates: number;
};
export type Reading = {
  intent: Intent;
  language: ReaderOutput['language'];
  lines: ReadLine[];
  placeText: string;
  fulfilment: ReaderOutput['fulfilment'];
  dayKind: ReaderOutput['day']['kind'];
  deliveryDate: string | null;
  timeWish: string;
  paymentWords: string;
  forWhom: string;
  flags: string[];
  band: Band | null;
};

/** Words that change a quantity without being one, so the number itself cannot be checked. */
export const fractionWords = new Set([
  'dhai',
  'sawa',
  'dedh',
  'paune',
  'ढाई',
  'सवा',
  'डेढ़',
  'पौने',
]);
// Sizes for these come only from the family's list. Nothing here guesses what a trolley holds.
export const loadWords = new Set([
  'trolley',
  'trali',
  'tralee',
  'ट्राली',
  'ट्रॉली',
  'truck',
  'ट्रक',
  'gadi',
  'gaadi',
  'गाड़ी',
  'tractor',
]);
const numberWords: Record<string, number> = {
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
  bees: 20,
  tees: 30,
  chalis: 40,
  chaalis: 40,
  pachas: 50,
  pachaas: 50,
  saath: 60,
  sattar: 70,
  assi: 80,
  nabbe: 90,
  sau: 100,
  एक: 1,
  दो: 2,
  दू: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  पाँच: 5,
  छह: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
  बीस: 20,
  तीस: 30,
  चालीस: 40,
  पचास: 50,
  साठ: 60,
  सत्तर: 70,
  अस्सी: 80,
  नब्बे: 90,
  सौ: 100,
  hazaar: 1000,
  hazar: 1000,
  हज़ार: 1000,
  हजार: 1000,
};
export const numberWord = (word: string) => numberWords[word];
export const hundredWord = (word: string) =>
  numberWords[word] === 100 || numberWords[word] === 1000;

/** Every quantity some words state, reading "ek hazaar" as one thousand. */
export function numbersIn(words: string) {
  const found: number[] = [];
  const tokens = normalizeAlias(words).split(' ');
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const digits = token.match(/^(\d+)(kg)?$/);
    const value = digits ? Number(digits[1]) : numberWord(token);
    if (value === undefined) continue;
    const next = tokens[i + 1];
    if (next && hundredWord(next)) {
      found.push(value * numberWord(next)!);
      i++;
    } else found.push(value);
  }
  return found;
}
const hasFraction = (words: string) =>
  normalizeAlias(words)
    .split(' ')
    .some((word) => fractionWords.has(word));

const unitKind = (unit: string) =>
  /^(ton|tan|tonne|टन)$/.test(unit)
    ? 'ton'
    : /^(kg|kilo|किलो)$/.test(unit) || /^\d+kg$/.test(unit)
      ? 'kg'
      : /^(bori|bora|boriya|bag|bags|बोरी|बोरा|बैग)$/.test(unit)
        ? 'bag'
        : null;
/** How a product is sold, from its unit such as "kg · 12 mm" or "50 kg bag". */
const soldBy = (unit: string) => {
  const words = normalizeAlias(unit).split(' ');
  return words.includes('bag') ? 'bag' : words[0] === 'kg' ? 'kg' : null;
};

const addDays = (day: string, count: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
/** The date, worked out here in IST. A model never decides what day "kal" is. */
export function dayToDate(day: ReaderOutput['day'], sentAt: Date) {
  const today = istToday(sentAt);
  if (day.kind === 'TODAY') return today;
  if (day.kind === 'TOMORROW') return addDays(today, 1);
  if (day.kind === 'DAY_AFTER') return addDays(today, 2);
  if (day.kind === 'WEEKDAY' && day.weekday !== null) {
    const now = new Date(`${today}T00:00:00Z`).getUTCDay();
    return addDays(today, (day.weekday - now + 7) % 7 || 7);
  }
  if (day.kind === 'DATE' && day.date && day.date >= today && day.date <= addDays(today, 60))
    return day.date;
  return null;
}
const istHour = (at: Date) => new Date(at.getTime() + 19800000).getUTCHours();

export type ReadingContext = {
  catalog: Catalog;
  text: string;
  sentAt: Date;
  truncated: boolean;
  bigOrderPaise: number;
};

/**
 * Checks a reader's answer against the customer's own words and the catalogue, and sets the band
 * in code. The model's confidence only ever lowers it. A band changes how a card looks; no band
 * ever confirms an order.
 */
export function finishReading(output: ReaderOutput, context: ReadingContext): Reading {
  const { catalog, text, sentAt, truncated, bigOrderPaise } = context;
  const words = ` ${normalizeAlias(text)} `;
  const found = (quote: string) => {
    const clean = normalizeAlias(quote);
    return clean.length > 0 && words.includes(` ${clean} `);
  };
  const flags = new Set<string>();
  if (truncated) flags.add('TRUNCATED');
  if (output.injectionSuspected) flags.add('INJECTION');
  let valuePaise = 0;
  let allSure = output.lines.length > 0;
  const lines = output.lines.map((line): ReadLine => {
    const product = line.productId ? catalog.products.get(line.productId) : undefined;
    if (line.productId && !product) flags.add('UNKNOWN_PRODUCT');
    const quoted = found(line.evidence);
    if (!quoted) flags.add('NO_EVIDENCE');
    let quantity = quoted ? line.quantity : null;
    const stated = normalizeAlias(line.unitWord ?? '');
    // A unit the customer did not write is the model's guess.
    const unit = normalizeAlias(line.evidence)
      .split(' ')
      .some((word) => word === stated || (/^\d/.test(word) && word.endsWith(stated)))
      ? stated
      : '';
    if (stated && !unit) flags.add('NO_EVIDENCE');
    if (loadWords.has(unit)) {
      quantity = null;
      flags.add('UNIT_WORD');
    }
    if (quantity !== null) {
      const numbers = numbersIn(line.evidence);
      if (hasFraction(line.evidence)) flags.add('FRACTION');
      // One number in the quote, and it is this one. Two would not say which goes with what.
      else if (numbers.length !== 1 || numbers[0] !== quantity) {
        quantity = null;
        flags.add('NO_EVIDENCE');
      }
    }
    // A weight or bag word on goods not sold that way needs a person: "50 kg ultratech" is one bag.
    const sold = soldBy(product?.unit ?? '');
    const asked = unitKind(unit);
    if (quantity !== null && sold && asked && sold !== asked) {
      if (asked === 'ton' && sold === 'kg') quantity *= 1000;
      else {
        quantity = null;
        flags.add('UNIT_WORD');
      }
    }
    const method = product ? productNamedIn(catalog, line.evidence, product.id) : null;
    // A word the family confirmed already says what it comes in.
    if (quantity !== null && !unit && method !== 'ALIAS') flags.add('NO_UNIT');
    const candidates = product ? 1 : candidatesIn(catalog, line.evidence);
    if (!product) flags.add('UNKNOWN_ITEM');
    if (product && quantity !== null) {
      if (quantity < product.minQuantity || quantity % product.quantityStep !== 0)
        flags.add('BAD_QUANTITY');
      valuePaise += product.pricePaise * quantity;
    }
    // The model's own doubt can only lower the band, never raise it.
    if (!method || quantity === null || (line.modelConfidence ?? 1) < 0.6) allSure = false;
    return {
      rawText: line.rawText,
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      quantity,
      // Only a unit found in the customer's own words, so a model cannot put one in their mouth.
      unitWord: unit || null,
      evidence: line.evidence,
      method,
      candidates,
    };
  });
  const placeQuoted = output.place && found(output.place.evidence);
  if (output.place && !placeQuoted) flags.add('NO_EVIDENCE');
  const deliveryDate = dayToDate(output.day, sentAt);
  if (output.day.kind === 'TOMORROW' && istHour(sentAt) < 5) flags.add('MIDNIGHT');
  if (valuePaise >= bigOrderPaise) flags.add('BIG_ORDER');
  const ordering = output.intent === 'ORDER' || output.intent === 'ORDER_CHANGE';
  const redIntent = output.intent === 'COMPLAINT' || output.intent === 'NOT_UNDERSTOOD';
  const nothingMatched =
    ordering &&
    lines.every((line) => !line.productId && !line.candidates && line.quantity === null);
  let band: Band | null = null;
  if (redIntent || flags.has('INJECTION') || flags.has('TRUNCATED') || nothingMatched) band = 'RED';
  else if (ordering)
    band = output.intent === 'ORDER' && allSure && flags.size === 0 ? 'GREEN' : 'AMBER';
  return {
    intent: output.intent,
    language: output.language,
    lines,
    // The customer's own words for the place, never the model's.
    placeText: placeQuoted ? output.place!.evidence : '',
    fulfilment: output.fulfilment,
    dayKind: output.day.kind,
    deliveryDate,
    timeWish: output.timeWish ?? '',
    paymentWords: output.paymentWords ?? '',
    forWhom: output.forWhom ?? '',
    flags: [...flags].sort(),
    band,
  };
}
