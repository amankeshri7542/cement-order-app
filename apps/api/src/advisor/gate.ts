import { romanizeHindi, hasDevanagari, plainDigits } from './understand-hindi';

/**
 * The sentence gate. A pure function, with no network and no database, run on every sentence the
 * model writes before the customer sees it. Harmful output is stopped here by construction, not by
 * asking the model nicely: a number with no source, a price, a promise, a verdict on safety, a link.
 * Plan 08 section 7.2. A sentence that fails stops the answer and replaces it with safe text.
 */
export type GateFlag =
  | 'NUMBER'
  | 'RUPEES'
  | 'RATIO'
  | 'COMMITMENT'
  | 'VERDICT'
  | 'PRESCRIPTION'
  | 'NOT_STOCKED'
  | 'URL'
  | 'MARKDOWN'
  | 'HTML'
  | 'PHONE'
  | 'DEVANAGARI'
  | 'NOT_LATIN'
  | 'HIDDEN_TEXT'
  | 'TOO_LONG'
  | 'NO_SOURCE'
  | 'STOP_REASON'
  | 'NO_TEXT';

export type GateContext = {
  /** CHECKED may use the numbers in the articles sent. GENERAL may use only the customer's. */
  level: 'CHECKED' | 'GENERAL';
  /** The customer's last two messages, scrubbed. */
  customer: readonly string[];
  /** The text of every section sent to the model this turn. */
  chunks: readonly string[];
  /** Everything the server read for this turn: names, units and figures. */
  tools: readonly string[];
  /** Exact amounts in paise from this turn's tool data. Any rupee figure must be one of these. */
  moneyPaise: readonly number[];
  /** True when articles were sent, so the answer must cite one. */
  needsSource: boolean;
};

export type GateProgress = {
  /** Sentences already released. */
  released: number;
  words: number;
  citations: number;
};

export type GateVerdict = { pass: true } | { pass: false; flag: GateFlag };

const refuse = (flag: GateFlag): GateVerdict => ({ pass: false, flag });

export const MAX_ANSWER_WORDS = 140;

const units =
  'din|dino|dinon|day|days|hafta|hafte|hafton|week|weeks|mahina|mahine|mahino|month|months|saal|sal|year|years|ghanta|ghante|hour|hours|minute|minutes|mint|bori|boriyan|bag|bags|kg|kilo|kilogram|kilograms|quintal|ton|tons|tonne|tonnes|foot|feet|ft|inch|inches|mm|cm|meter|meters|metre|metres|cft|trolley|truck|percent|rod|rods|bar|bars|chhad|eent|brick|bricks|layer|layers|coat|coats|parat|tasla|sq|square|litre|litres|liter|liters';

const wordValues: Record<string, number> = {
  // English.
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  half: 0.5,
  quarter: 0.25,
  // Hinglish.
  ek: 1,
  do: 2,
  dui: 2,
  teen: 3,
  tin: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  chhah: 6,
  che: 6,
  saat: 7,
  sat: 7,
  aath: 8,
  ath: 8,
  nau: 9,
  das: 10,
  gyarah: 11,
  barah: 12,
  baarah: 12,
  terah: 13,
  chaudah: 14,
  pandrah: 15,
  solah: 16,
  satrah: 17,
  atharah: 18,
  unnis: 19,
  bees: 20,
  pachees: 25,
  tees: 30,
  chalis: 40,
  chaalis: 40,
  pachas: 50,
  sau: 100,
  hazaar: 1000,
  hazar: 1000,
  aadha: 0.5,
  aadhi: 0.5,
  paav: 0.25,
  dedh: 1.5,
  dhai: 2.5,
  dhaai: 2.5,
  sawa: 1.25,
  paune: 0.75,
};
const numberWord = Object.keys(wordValues)
  .sort((a, b) => b.length - a.length)
  .join('|');
const wordWithUnit = new RegExp(
  `(?<![\\p{L}\\p{N}])(${numberWord})\\s+(?:(${numberWord})\\s+)?(\\p{L}+\\s+)?(?:${units})(?![\\p{L}\\p{N}])`,
  'giu',
);

// "Keep it wet for a week": a number in everything but its digits.
const oneOfAUnit =
  /(?<![\p{L}\p{N}])(?:for|after|within|in|about|around|over|till|until)\s+(?:a|an)\s+(?:day|week|fortnight|month|year)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:hafta|mahina|saal|din)\s+bhar(?![\p{L}\p{N}])/giu;

/** Every number in a text, as a number. Words count only beside a unit, so "do not" is not two. */
export function numbersIn(text: string): number[] {
  const plain = romanizeHindi(plainDigits(text.normalize('NFKC'))).toLowerCase();
  const found: number[] = [];
  for (const _match of plain.matchAll(oneOfAUnit)) found.push(1);
  for (const match of plain.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/,/g, ''));
    if (Number.isFinite(value)) found.push(value);
  }
  for (const match of plain.matchAll(wordWithUnit)) {
    // "Do check the bricks" is not two bricks.
    if (match[1] === 'do' && match[3]) continue;
    const first = wordValues[match[1]!]!;
    const second = match[2] ? wordValues[match[2]] : undefined;
    // "paune do din" is one and three quarters; "do sau bori" is two hundred.
    const value =
      second === undefined
        ? first
        : match[1] === 'paune'
          ? second - 0.25
          : second >= 100
            ? first * second
            : first + second;
    found.push(value);
  }
  return found;
}

const moneyWord = /(₹|\brs\b\.?|\binr\b|\brupee|\brupay|\brupaiy|\brupaye|\brupye\b)/i;
const moneyAmounts = [
  /(?:₹|\brs\b\.?|\binr\b|\brupees?\b|\brupaye\b|\brupaiye\b|\brupay\b)\s*(\d[\d,]*(?:\.\d+)?)/gi,
  /(\d[\d,]*(?:\.\d+)?)\s*(?:₹|\brs\b\.?|\/-|\brupees?\b|\brupaye\b|\brupaiye\b|\brupay\b)/gi,
];

// "After a few days" is a dose too, with the number left out.
const vagueTime =
  /\b(a few|few|a couple of|couple of|several|kuch|kai|thode|chand)\s+(days?|din|weeks?|hafte|haftoon|months?|mahine|hours?|ghante)\b/i;

const negation = [
  /\bno (one |single )?best\b/i,
  /\b(there is|there's) no\b/i,
  /\bkoi (ek )?(best|sabse)\b.{0,30}\bnahi\b/i,
  /\bpakka nahi\b/i,
  /\bnot (yet )?confirmed\b/i,
  /\bcannot (guarantee|promise)\b/i,
  /\bcan't (guarantee|promise)\b/i,
  /\bno guarantee\b/i,
];
const claims = [
  /\bpakka\b/i,
  /\bconfirm(ed|s)?\b/i,
  /\border (ho gaya|ho gya|placed|confirmed)\b/i,
  /\bguarantee(d|s)?\b/i,
  /\bkal tak\b/i,
  /\baaj hi\b.{0,20}\b(deliver|pahunch|mil)/i,
  /\b(by|before) (tomorrow|today|tonight|evening)\b/i,
  /\bdeliver(y|ed)?\b.{0,30}\b(tomorrow|today|tonight|within|in \d|hours?|ghante|din)\b/i,
  /\bdiscounts?\b/i,
  /\bchhoot\b/i,
  /\bfree delivery\b/i,
  /\bmuft\b/i,
  /\boffers?\b/i,
  /\bbest\b/i,
  /\bsabse (sasta|sasti|accha|acha|achha|badhiya)\b/i,
  /\blowest\b/i,
  /\bcheapest\b/i,
  /\bmost people\b/i,
  /\bzyadatar log\b/i,
  /\beveryone uses\b/i,
  /\brates? will (rise|go up|increase)\b/i,
  /\brate badh(ne)? (jayega|wala)\b/i,
];

const verdicts = [
  /\bsafe\b/i,
  /\bsurakshit\b/i,
  /\bkoi khatra nahi\b/i,
  /\bkhatra nahi\b/i,
  /\bchinta ki baat nahi\b/i,
  /\bchinta (mat|na) karein\b/i,
  /\bsirf hairline\b/i,
  /\bjust (a )?hairline\b/i,
  /\bnothing to worry\b/i,
  /\bno need to worry\b/i,
  /\bnot dangerous\b/i,
];
const structureWord =
  /\b(slab|chhat|lenter|lintel|lintal|beam|column|pillar|khamba|footing|foundation|neev|plinth|deewar|wall|crack|daraar|floor|manzil|sariya|steel|concrete)\b/i;
const prescribing = [
  /\bfe\s?\d+\b.{0,30}\b(use|lagayein|lagao|lagana|choose|lein|lijiye|better|sahi|theek|enough)\b/i,
  /\b(use|lagayein|lagao|choose|lijiye)\b.{0,30}\bfe\s?\d+\b/i,
  /\b(use|lagayein|lagao|choose|lijiye)\b.{0,30}\b\d+\s?(mm|soot)\b/i,
  /\bm\s?-?\s?(10|15|20|25|30|35|40)\b/i,
  /@\s*\d/,
  /\bc\/c\b/i,
  // "Yes, you can add a floor" or "deewar tod sakte hain".
  /\b(floor|manzil|wall|deewar)\b.{0,40}\b(you can|can be|kar sakte|tod sakte|bana sakte|hata sakte|ho jayega|possible)\b/i,
  /\b(you can|kar sakte|tod sakte|bana sakte|hata sakte)\b.{0,40}\b(floor|manzil|wall|deewar)\b/i,
];
const notStocked = /\b(tile|tiles|putty|paint|paints|distemper|primer|marble|granite|finishing)\b/i;

const urlLike =
  /(https?:\/\/|ftp:\/\/|www\.|mailto:|javascript:|data:|[\p{L}\p{N}-]+\.(com|in|org|net|io|co|ly|me|app|gov|info|biz|link|xyz|site|online|shop|store)\b)/iu;
const htmlLike = /<\/?[a-z!][^>]*>|&lt;|&#\d+;|&#x[0-9a-f]+;/i;
const markdownLike =
  /(\*\*|__|```|`[^`]+`|^\s*#{1,6}\s|\[[^\]]*\]\([^)]*\)|^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*>\s)/;
const phoneLike = /(?<!\d)(?:\+?\d[\s().-]?){7,}(?!\d)/;
const emailLike = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+/u;

/** The word count of a text, in the sense of the 140-word limit. */
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** One sentence against all the rules. Returns the first rule it breaks. */
export function gateSentence(
  raw: string,
  context: GateContext,
  progress: GateProgress,
): GateVerdict {
  // Hidden characters can smuggle anything past the words below, so none are allowed at all.
  if (/\p{Cf}/u.test(raw)) return refuse('HIDDEN_TEXT');
  if (hasDevanagari(raw)) return refuse('DEVANAGARI');
  // Full-width letters and digits read the same to a person, so they are read the same here.
  const sentence = raw.normalize('NFKC');
  // A Cyrillic "a" in "pakka" or a digit from another script would walk past every rule below.
  if (/[^\p{Script=Latin}\P{L}]/u.test(sentence) || /(?![0-9])\p{Nd}/u.test(sentence))
    return refuse('NOT_LATIN');
  if (htmlLike.test(sentence)) return refuse('HTML');
  if (urlLike.test(sentence)) return refuse('URL');
  if (emailLike.test(sentence)) return refuse('PHONE');
  if (markdownLike.test(sentence)) return refuse('MARKDOWN');
  if (phoneLike.test(sentence)) return refuse('PHONE');
  if (progress.words + wordCount(sentence) > MAX_ANSWER_WORDS) return refuse('TOO_LONG');
  if (notStocked.test(sentence)) return refuse('NOT_STOCKED');

  // A ratio is never ours to give, whoever said it first.
  if (/(?<!\d)\d+(?:\.\d+)?\s*:\s*\d(?!\d)/.test(sentence)) return refuse('RATIO');

  if (moneyWord.test(sentence)) {
    const allowed = new Set(context.moneyPaise);
    const amounts = moneyAmounts.flatMap((pattern) =>
      [...sentence.matchAll(pattern)].map((match) =>
        Math.round(Number(match[1]!.replace(/,/g, '')) * 100),
      ),
    );
    // "Chaar sau rupaye": money with no digits cannot be checked, so it does not pass.
    if (!amounts.length || amounts.some((paise) => !allowed.has(paise))) return refuse('RUPEES');
  }

  if (vagueTime.test(sentence) && !context.chunks.some((chunk) => vagueTime.test(chunk)))
    return refuse('NUMBER');

  const fromChunks = new Set(context.level === 'CHECKED' ? context.chunks.flatMap(numbersIn) : []);
  const fromTools = new Set(
    context.level === 'CHECKED'
      ? [...context.tools.flatMap(numbersIn), ...context.moneyPaise.map((paise) => paise / 100)]
      : [],
  );
  const fromCustomer = new Set(context.customer.flatMap(numbersIn));
  const inStructure = structureWord.test(sentence);
  for (const value of numbersIn(sentence)) {
    if (fromChunks.has(value) || fromTools.has(value)) continue;
    // The customer's own number may be repeated back, unless it is about the structure: echoing
    // "8 mm in a slab" reads as agreeing with it.
    if (fromCustomer.has(value) && !inStructure) continue;
    return refuse('NUMBER');
  }

  const negated = negation.some((pattern) => pattern.test(sentence));
  if (!negated && claims.some((pattern) => pattern.test(sentence))) return refuse('COMMITMENT');
  if (inStructure && verdicts.some((pattern) => pattern.test(sentence))) return refuse('VERDICT');
  if (prescribing.some((pattern) => pattern.test(sentence))) return refuse('PRESCRIPTION');

  // An answer from the guide must show where it came from by its second sentence.
  if (context.needsSource && progress.released >= 1 && progress.citations === 0)
    return refuse('NO_SOURCE');
  return { pass: true };
}

/** What the model said about why it stopped. Anything but a natural end is a block. */
export const stoppedCleanly = (stopReason: string | null | undefined) => stopReason === 'end_turn';

const notAnEnd = /(?:\b(?:rs|mr|mrs|dr|no|vs|e\.g|i\.e|st|ft|sq|approx)\.|\d\.)$/i;

/**
 * Splits a stream of text into whole sentences. A decimal, "Rs." and the like do not end one. A
 * sentence is held back until the character after its full stop arrives.
 */
export class SentenceBuffer {
  private pending = '';
  push(delta: string): string[] {
    this.pending += delta;
    const done: string[] = [];
    let from = 0;
    for (let at = 0; at < this.pending.length - 1; at++) {
      const char = this.pending[at]!;
      const next = this.pending[at + 1]!;
      const ends = char === '\n' || (/[.!?।]/.test(char) && /\s/.test(next));
      if (!ends) continue;
      const candidate = this.pending.slice(from, at + 1);
      if (char !== '\n' && notAnEnd.test(candidate.trimEnd())) continue;
      const sentence = candidate.trim();
      if (sentence) done.push(sentence);
      from = at + 1;
    }
    this.pending = this.pending.slice(from);
    return done;
  }
  /** The last sentence, once the stream is over. */
  flush(): string | null {
    const last = this.pending.trim();
    this.pending = '';
    return last || null;
  }
}
