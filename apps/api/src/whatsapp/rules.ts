import { normalizeAlias, termAt, type Catalog } from '../catalog-match';
import {
  fractionWords,
  hundredWord,
  loadWords,
  numberWord,
  type Intent,
  type ReaderOutput,
} from './reading';

const phrase = (words: string, list: string[]) => {
  const padded = ` ${words} `;
  return list.some((item) => padded.includes(` ${normalizeAlias(item)} `));
};
const unitWords = new Set([
  'bori',
  'bora',
  'boriya',
  'bag',
  'bags',
  'बोरी',
  'बोरा',
  'बैग',
  'ton',
  'tan',
  'tonne',
  'टन',
  'kg',
  'kilo',
  'किलो',
  'pcs',
  'piece',
  'pieces',
]);
const stopWords = ['stop', 'ai mat', 'ai band', 'band karo', 'रोको', 'बंद करो', 'एआई बंद'];
const humanWords = [
  'dukaan se baat',
  'dukan se baat',
  'insaan se baat',
  'papa se baat',
  'दुकान से बात',
];
const injectionWords = [
  'ignore all previous',
  'ignore previous',
  'previous instructions',
  'reply with the word',
  'system prompt',
  'mark paid',
  'confirm my order',
  'निर्देश भूल',
  'लिखो आपका ऑर्डर पक्का',
];
const complaintWords = [
  'chor',
  'dhokha',
  'complaint',
  'shikayat',
  'maal kharab',
  'शिकायत',
  'धोखा',
  'चोर',
];
const structuralWords = ['chhat', 'lintel', 'beam', 'column', 'masala', 'नींव', 'छत', 'foundation'];
const howMuchWords = ['kitna', 'kitni', 'kitne', 'lagega', 'lagegi', 'ratio', 'कितना', 'कितनी'];
const creditWords = [
  'kitna baaki',
  'baaki hai',
  'udhaar',
  'udhar',
  'discount',
  'free dena',
  'कितना बाकी',
  'उधार',
];
const stockWords = [
  'stock hai',
  'kitne baje',
  'kab tak',
  'kab aayega',
  'kab ayega',
  'स्टॉक है',
  'कब तक',
];
const statusWords = ['pakka hua', 'confirm hua', 'order pakka', 'order status', 'पक्का हुआ'];
const rateWords = ['rate', 'bhav', 'bhaw', 'daam', 'price', 'sabse sasta', 'भाव', 'रेट', 'दाम'];
const chatWords = new Set([
  'namaste',
  'namaskar',
  'pranam',
  'hello',
  'hi',
  'hii',
  'ok',
  'okay',
  'theek',
  'thik',
  'hai',
  'thanks',
  'thank',
  'you',
  'dhanyawad',
  'bhaiya',
  'bhai',
  'kaise',
  'ho',
  'sir',
  'ji',
  'नमस्ते',
  'नमस्कार',
  'प्रणाम',
  'ठीक',
  'है',
  'धन्यवाद',
  'भैया',
]);
const fillers = new Set([
  'chahiye',
  'chahie',
  'chahi',
  'hamra',
  'hamko',
  'mujhe',
  'हमरा',
  'हमको',
  'मुझे',
  'chaiye',
  'bhej',
  'bhejo',
  'bhejna',
  'bhejiye',
  'dena',
  'de',
  'do',
  'dijiye',
  'dijiyega',
  'gira',
  'girana',
  'par',
  'pe',
  'me',
  'mein',
  'ke',
  'ka',
  'ki',
  'hi',
  'bhaiya',
  'bhai',
  'please',
  'plz',
  'order',
  'sir',
  'ji',
  'ko',
  'se',
  'aur',
  'aa',
  'and',
  'at',
  'need',
  'want',
  'send',
  'to',
  'चाहिए',
  'चाहीं',
  'भेज',
  'भेजो',
  'दीं',
  'में',
  'पर',
  'के',
  'का',
  'की',
  'और',
  'भैया',
]);
// These change what the numbers mean, so the rules leave such messages to the reader.
const unsureWords = new Set([
  'nahi',
  'nahin',
  'mat',
  'cancel',
  'badal',
  'aayegi',
  'aayega',
  'ayegi',
  'ayega',
  'wala',
  'pichhli',
  'kharab',
  'tha',
  'thi',
  'bheja',
  'kar',
  'khate',
  'kya',
  'kaunsa',
  'kaisa',
  'kyu',
  'kyon',
  'confirm',
  'pakka',
  'karo',
  'karna',
  'karni',
  'rupaye',
  'rupees',
  'rs',
  'free',
  'paid',
  'क्या',
  'पक्का',
  'करो',
  'नहीं',
  'मत',
  'रद्द',
  'आएगी',
  'आएगा',
]);
const wantWords = new Set([
  'chahiye',
  'chahie',
  'chaiye',
  'chahi',
  'bhejo',
  'चाहिए',
  'चाहीं',
  'भेजो',
]);
const dayWords: Record<string, ReaderOutput['day']['kind']> = {
  aaj: 'TODAY',
  today: 'TODAY',
  आज: 'TODAY',
  kal: 'TOMORROW',
  kaal: 'TOMORROW',
  tomorrow: 'TOMORROW',
  कल: 'TOMORROW',
  काल्ह: 'TOMORROW',
  parso: 'DAY_AFTER',
  parson: 'DAY_AFTER',
  परसों: 'DAY_AFTER',
};
const pickupWords = ['utha lenge', 'utha lunga', 'le jayenge', 'le jaunga', 'khud le', 'pickup'];
const englishHints = new Set(['need', 'want', 'please', 'send', 'tomorrow', 'today', 'bags', 'at']);

export const languageOf = (text: string, tokens: string[]): ReaderOutput['language'] => {
  if (/[ऀ-ॿ]/.test(text)) return 'hindi';
  return tokens.some((token) => englishHints.has(token)) ? 'english' : 'hinglish';
};
/** What the reader says when the message holds no order, only something plain to recognise. */
const plainReading = (
  intent: Intent,
  text: string,
  tokens: string[],
  injection = false,
): ReaderOutput => ({
  intent,
  language: languageOf(text, tokens),
  injectionSuspected: injection,
  lines: [],
  place: null,
  fulfilment: 'UNKNOWN',
  day: { kind: 'UNSPECIFIED', weekday: null, date: null },
  timeWish: null,
  paymentWords: null,
  forWhom: null,
});

/** Whether the words are about the shop's trade at all. Without any, a stranger's message is dropped. */
export function hasTradeWord(text: string, catalog: Catalog) {
  const words = normalizeAlias(text);
  const tokens = words.split(' ');
  if (tokens.some((token) => unitWords.has(token) || loadWords.has(token))) return true;
  if (phrase(words, rateWords)) return true;
  return tokens.some((_, index) => termAt(catalog, tokens, index));
}
export function isStop(text: string) {
  const words = normalizeAlias(text);
  return stopWords.some((item) => words === normalizeAlias(item));
}
/** Nothing here for anyone to read: a hello, a thanks, an emoji. */
export function isOnlyChat(text: string) {
  const tokens = normalizeAlias(text).split(' ').filter(Boolean);
  return tokens.every((token) => chatWords.has(token));
}

/** The notice tells them to write this. A stranger who has not been told is not asking for it. */
export function isHumanAsk(text: string) {
  const words = normalizeAlias(text);
  return justShop.includes(words) || phrase(words, humanWords);
}
const justShop = ['dukaan', 'dukan', 'shop', 'दुकान'];
const cancelWords = [
  'cancel',
  'cancel kar do',
  'cancel kardo',
  'cancel karo',
  'cancel karna hai',
  'cancel it',
  'rehne do',
  'nahi chahiye',
  'mat bhejo',
  'रद्द',
  'रद्द करो',
  'कैंसिल',
  'मत भेजो',
  'नहीं चाहिए',
];
const unsureDayWords = ['abhi pata nahi', 'pata nahi', 'not sure yet', 'अभी पता नहीं', 'पता नहीं'];
const collectWords = [
  'khud utha lenge',
  'utha lenge',
  'khud le jayenge',
  'le jayenge',
  'will collect',
  'pickup',
  'ख़ुद उठा लेंगे',
  'उठा लेंगे',
];
const changeWords = ['badlav karna hai', 'change something', 'बदलाव करना है'];
const newWords = ['haan naya', 'yes new', 'हाँ नया'];
export type DraftAnswer =
  | { kind: 'DAY'; day: 'TODAY' | 'TOMORROW' | 'DAY_AFTER' | 'UNSPECIFIED' }
  | { kind: 'PICKUP' }
  | { kind: 'PLACE'; text: string }
  | { kind: 'CANCEL' }
  | { kind: 'CHANGE' }
  | { kind: 'NEW_YES' }
  | { kind: 'NEW_NO' };
/**
 * A short answer to a draft that is already open, or a tapped button, read with no model. Anything
 * longer or less plain than this goes on to the reader.
 */
export function readDraftAnswer(text: string, catalog: Catalog): DraftAnswer | null {
  const words = normalizeAlias(text);
  const tokens = words.split(' ').filter(Boolean);
  if (!tokens.length || tokens.length > 4) return null;
  const isOneOf = (list: string[]) => list.some((item) => normalizeAlias(item) === words);
  if (isOneOf(cancelWords)) return { kind: 'CANCEL' };
  if (isOneOf(unsureDayWords)) return { kind: 'DAY', day: 'UNSPECIFIED' };
  if (isOneOf(collectWords)) return { kind: 'PICKUP' };
  if (isOneOf(changeWords)) return { kind: 'CHANGE' };
  if (isOneOf(newWords)) return { kind: 'NEW_YES' };
  if (words === 'nahi naya') return { kind: 'NEW_NO' };
  if (tokens.length === 1 && dayWords[tokens[0]!]) {
    const day = dayWords[tokens[0]!]!;
    if (day === 'TODAY' || day === 'TOMORROW' || day === 'DAY_AFTER') return { kind: 'DAY', day };
  }
  if (tokens.every((token) => catalog.places.has(token))) return { kind: 'PLACE', text: words };
  return null;
}

type Parsed = { value: number; size: number; fraction: boolean };
function numberAt(tokens: string[], at: number): Parsed | null {
  const token = tokens[at];
  if (!token) return null;
  const digits = token.match(/^\d{1,6}$/);
  if (digits) {
    const next = tokens[at + 1];
    return next && hundredWord(next)
      ? { value: Number(token) * numberWord(next)!, size: 2, fraction: false }
      : { value: Number(token), size: 1, fraction: false };
  }
  const value = numberWord(token);
  if (value === undefined) return null;
  const next = tokens[at + 1];
  if (next && hundredWord(next) && !hundredWord(token))
    return { value: value * numberWord(next)!, size: 2, fraction: false };
  return { value, size: 1, fraction: false };
}

/**
 * Plain typed orders and plain questions, read with no model and no cost. Returns null whenever it
 * is not sure, so the model (or a person) reads it instead. It only answers when every word is
 * accounted for.
 */
export function readByRules(text: string, catalog: Catalog): ReaderOutput | null {
  const words = normalizeAlias(text);
  const tokens = words.split(' ').filter(Boolean);
  if (!tokens.length) return null;
  const plain = (intent: Intent, injection = false) =>
    plainReading(intent, text, tokens, injection);
  if (phrase(words, injectionWords)) return plain('NOT_UNDERSTOOD', true);
  if (isHumanAsk(text)) return plain('HUMAN_REQUEST');
  if (phrase(words, complaintWords)) return plain('COMPLAINT');
  if (phrase(words, structuralWords) && phrase(words, howMuchWords)) return plain('STRUCTURAL');
  if (phrase(words, creditWords)) return plain('PRICE_OR_CREDIT_TALK');
  if (phrase(words, stockWords)) return plain('STOCK_OR_TIME_QUESTION');
  if (phrase(words, statusWords)) return plain('STATUS_QUESTION');
  if (phrase(words, rateWords)) {
    const reading = plain('RATE_QUESTION');
    for (let i = 0; i < tokens.length; i++) {
      const named = termAt(catalog, tokens, i);
      if (named?.term.ids.size === 1) {
        const quote = tokens.slice(i, i + named.size).join(' ');
        reading.lines.push({
          rawText: quote,
          productId: [...named.term.ids][0]!,
          quantity: null,
          unitWord: null,
          evidence: quote,
          modelConfidence: null,
        });
        break;
      }
    }
    return reading;
  }
  // A question is not an order, whatever else it says.
  if (/[?？।]\s*$/.test(text.trim()) && text.trim().endsWith('?')) return null;
  if (tokens.some((token) => unsureWords.has(token) || fractionWords.has(token))) return null;
  return readPlainOrder(text, tokens, words, catalog);
}

function readPlainOrder(
  text: string,
  tokens: string[],
  words: string,
  catalog: Catalog,
): ReaderOutput | null {
  const lines: ReaderOutput['lines'] = [];
  const left: string[] = [];
  let dayKind: ReaderOutput['day']['kind'] = 'UNSPECIFIED';
  let timeWish: string | null = null;
  const fulfilment = phrase(words, pickupWords) ? 'PICKUP' : 'UNKNOWN';
  const unitAt = (at: number) => {
    const token = tokens[at];
    return token && (unitWords.has(token) || loadWords.has(token)) ? token : null;
  };
  const quote = (from: number, to: number) => tokens.slice(from, to).join(' ');
  const push = (
    from: number,
    to: number,
    ids: Set<string>,
    quantity: number | null,
    unit: string | null,
  ) => {
    if (lines.length >= 20) return;
    lines.push({
      rawText: quote(from, to),
      productId: ids.size === 1 ? [...ids][0]! : null,
      quantity,
      unitWord: unit,
      evidence: quote(from, to),
      modelConfidence: null,
    });
  };
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i]!;
    if (dayWords[token]) {
      dayKind = dayWords[token]!;
      i++;
      continue;
    }
    // A long number is a phone number or an account, never a quantity.
    if (/^\d{7,}$/.test(token)) return null;
    // "2 baje" is a time the customer wishes for, and stays their wish.
    if (tokens[i + 1] === 'baje' || tokens[i + 1] === 'बजे') {
      timeWish = quote(i, i + 2);
      i += 2;
      continue;
    }
    // "12mm" says which bar, not how many.
    if (/^\d+mm$/.test(token)) {
      left.push(`#${token}`);
      i++;
      continue;
    }
    const weight = token.match(/^(\d{1,6})kg$/);
    const number = weight
      ? { value: Number(weight[1]), size: 1, fraction: false }
      : numberAt(tokens, i);
    if (number) {
      const unit = weight ? 'kg' : unitAt(i + number.size);
      const named = termAt(catalog, tokens, i + number.size + (unit && !weight ? 1 : 0));
      if (named) {
        const end = i + number.size + (unit && !weight ? 1 : 0) + named.size;
        push(i, end, named.term.ids, number.value, unit);
        i = end;
        continue;
      }
      // "do" and "saath" are ordinary words too.
      if (numberWord(token) !== undefined && !unit) {
        left.push(token);
        i++;
        continue;
      }
      return null;
    }
    const named = termAt(catalog, tokens, i);
    if (named) {
      const after = i + named.size;
      const size = tokens[after]?.match(/^\d+mm$/) ? 1 : 0;
      const follow = numberAt(tokens, after + size);
      // "acc gold 5 baje" says when, not how many.
      const isTime = follow && ['baje', 'बजे'].includes(tokens[after + size + follow.size] ?? '');
      const unit = follow && !isTime ? unitAt(after + size + follow.size) : null;
      if (follow && !isTime && (unit || /^\d/.test(tokens[after + size]!))) {
        const end = after + size + follow.size + (unit ? 1 : 0);
        push(i, end, named.term.ids, follow.value, unit);
        i = end;
      } else {
        push(i, after, named.term.ids, null, null);
        i = after;
      }
      continue;
    }
    left.push(token);
    i++;
  }
  if (!lines.length) return null;
  // Naming a product is not ordering it, unless they say they want it.
  const wants = tokens.some((token) => wantWords.has(token));
  if (lines.some((line) => line.quantity === null && !line.unitWord) && !wants) return null;
  const pickupTokens = new Set(pickupWords.flatMap((item) => item.split(' ')));
  const place = left.filter(
    (token) =>
      !fillers.has(token) &&
      !token.startsWith('#') &&
      !(fulfilment === 'PICKUP' && pickupTokens.has(token)),
  );
  // A word that is not a known place may change everything ("nhi chahiye", "bheje hain"), so such
  // a message needs reading, not matching.
  if (place.length > 3 || place.some((token) => !catalog.places.has(token))) return null;
  const placeText = place.join(' ');
  return {
    intent: 'ORDER',
    language: languageOf(text, tokens),
    injectionSuspected: false,
    lines,
    place: placeText ? { text: placeText, evidence: placeText } : null,
    fulfilment: placeText && fulfilment === 'UNKNOWN' ? 'DELIVERY' : fulfilment,
    day: { kind: dayKind, weekday: null, date: null },
    timeWish,
    paymentWords: null,
    forWhom: null,
  };
}
