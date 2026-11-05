import { money } from '@shiv/shared';
import type { Catalog } from '../catalog-match';
import type { Reading } from './reading';

/**
 * Every sentence the AI side can ever cause: the whole of plan 07 section 5.3 but the last three.
 * The confirmations ("Pakka...") are left out of this type on purpose. Only a person's tap may ever
 * produce those, and they live in decisions.ts.
 *
 * ASK_NUMBER, UNCLEAR and PHOTO_UNCLEAR are worded and tested, but nothing chooses them yet: voice
 * and photos are not read until the private file store exists, and a hidden number cannot be sent to.
 */
export type AiReplyKind =
  | 'NOTICE'
  | 'DRAFT'
  | 'ASK_PLACE'
  | 'ASK_DAY'
  | 'ASK_WHICH'
  | 'ASK_NEW'
  | 'ASK_NUMBER'
  | 'UPDATED'
  | 'WAITING'
  | 'AFTER_TAP'
  | 'EXPIRED'
  | 'RATE'
  | 'RATE_UNKNOWN'
  | 'NO_PROMISE'
  | 'UNKNOWN_ITEM'
  | 'OFF_TOPIC'
  | 'ENGINEER'
  | 'UNCLEAR'
  | 'PHOTO_UNCLEAR'
  | 'HANDOFF'
  | 'FORWARD'
  | 'STOP_OK';
export type ReplyLanguage = Reading['language'];
type Params = {
  lines?: string;
  place?: string;
  day?: string;
  item?: string;
  rate?: number;
  unit?: string;
  words?: string;
  privacyUrl?: string;
};
const none = (value: string | undefined) => value || '-';

export const replyWords: Record<AiReplyKind, Record<ReplyLanguage, (p: Params) => string>> = {
  NOTICE: {
    hinglish: (p) =>
      `Shiv Cement Store ka AI sahayak (computer program) aapka message padh kar order ka draft banata hai. Dukaan se baat ke liye "dukaan" likhein, AI band karne ke liye STOP.\nJaankari: ${none(p.privacyUrl)}`,
    hindi: (p) =>
      `शिव सीमेंट स्टोर का एआई सहायक (कंप्यूटर प्रोग्राम) आपका संदेश पढ़कर ऑर्डर का ड्राफ़्ट बनाता है। दुकान से बात के लिए "दुकान" लिखें, एआई बंद करने के लिए STOP।\nजानकारी: ${none(p.privacyUrl)}`,
    english: (p) =>
      `Shiv Cement Store's AI helper (a computer program) reads your message and makes a draft order. Write "shop" to talk to the shop, or STOP to turn the AI off.\nMore: ${none(p.privacyUrl)}`,
  },
  DRAFT: {
    hinglish: (p) =>
      `AI sahayak: Aapka message dukaan tak pahunch gaya. Draft: ${none(p.lines)}. Jagah: ${none(p.place)}. Din: ${none(p.day)}. Yeh abhi pakka nahi hai. Dukaan dekh kar yahin message karegi. Call ki zaroorat nahi.`,
    hindi: (p) =>
      `एआई सहायक: आपका संदेश दुकान तक पहुँच गया। ड्राफ़्ट: ${none(p.lines)}। जगह: ${none(p.place)}। दिन: ${none(p.day)}। यह अभी पक्का नहीं है। दुकान देखकर यहीं संदेश करेगी। कॉल की ज़रूरत नहीं।`,
    english: (p) =>
      `AI helper: Your message reached the shop. Draft: ${none(p.lines)}. Place: ${none(p.place)}. Day: ${none(p.day)}. This is not confirmed yet. The shop will check and message you here. No need to call.`,
  },
  ASK_PLACE: {
    hinglish: () => 'AI sahayak: Maal kahan chahiye, ya khud utha lenge?',
    hindi: () => 'एआई सहायक: माल कहाँ चाहिए, या ख़ुद उठा लेंगे?',
    english: () => 'AI helper: Where should the goods go, or will you collect them?',
  },
  ASK_DAY: {
    hinglish: () => 'AI sahayak: Kis din chahiye?',
    hindi: () => 'एआई सहायक: किस दिन चाहिए?',
    english: () => 'AI helper: Which day do you need it?',
  },
  ASK_WHICH: {
    hinglish: (p) => `AI sahayak: ${none(p.words)} mein kaun sa, aur kitna?`,
    hindi: (p) => `एआई सहायक: ${none(p.words)} में कौन सा, और कितना?`,
    english: (p) => `AI helper: Which ${none(p.words)}, and how much?`,
  },
  ASK_NEW: {
    hinglish: () => 'AI sahayak: Yeh order pehle hi pakka hua hai. Naya order hai?',
    hindi: () => 'एआई सहायक: यह ऑर्डर पहले ही पक्का हुआ है। नया ऑर्डर है?',
    english: () => 'AI helper: This order was already confirmed. Is this a new order?',
  },
  ASK_NUMBER: {
    hinglish: () => 'AI sahayak: Dukaan ko aapka number chahiye.',
    hindi: () => 'एआई सहायक: दुकान को आपका नंबर चाहिए।',
    english: () => 'AI helper: The shop needs your number.',
  },
  UPDATED: {
    hinglish: (p) =>
      `AI sahayak: Badlav likh liya. Naya draft: ${none(p.lines)}. Yeh abhi pakka nahi hai.`,
    hindi: (p) =>
      `एआई सहायक: बदलाव लिख लिया। नया ड्राफ़्ट: ${none(p.lines)}। यह अभी पक्का नहीं है।`,
    english: (p) =>
      `AI helper: Change noted. New draft: ${none(p.lines)}. This is not confirmed yet.`,
  },
  WAITING: {
    hinglish: () =>
      'AI sahayak: Dukaan dekh rahi hai. Yeh abhi pakka nahi hai. Pakka hote hi yahin message aayega.',
    hindi: () =>
      'एआई सहायक: दुकान देख रही है। यह अभी पक्का नहीं है। पक्का होते ही यहीं संदेश आएगा।',
    english: () =>
      'AI helper: The shop is looking at it. This is not confirmed yet. You will get a message here.',
  },
  EXPIRED: {
    hinglish: () =>
      'AI sahayak: Yeh order pakka nahi hua. Dobara bhejein ya dukaan se baat karein.',
    hindi: () => 'एआई सहायक: यह ऑर्डर पक्का नहीं हुआ। दोबारा भेजें या दुकान से बात करें।',
    english: () => 'AI helper: This order was not confirmed. Send it again or talk to the shop.',
  },
  UNCLEAR: {
    hinglish: () => 'AI sahayak: Awaaz saaf nahi aayi. Dobara bhejein ya likh dein.',
    hindi: () => 'एआई सहायक: आवाज़ साफ़ नहीं आई। दोबारा भेजें या लिख दें।',
    english: () => 'AI helper: The voice note was not clear. Please send it again or type it.',
  },
  PHOTO_UNCLEAR: {
    hinglish: () => 'AI sahayak: Photo mein order nahi mila. Likh kar bhej dein.',
    hindi: () => 'एआई सहायक: फ़ोटो में ऑर्डर नहीं मिला। लिखकर भेज दें।',
    english: () => 'AI helper: No order found in the photo. Please type it.',
  },
  AFTER_TAP: {
    hinglish: () => 'AI sahayak: Aapki baat dukaan tak pahunch gayi. Dukaan yahin jawab degi.',
    hindi: () => 'एआई सहायक: आपकी बात दुकान तक पहुँच गई। दुकान यहीं जवाब देगी।',
    english: () => 'AI helper: Your message reached the shop. The shop will answer here.',
  },
  RATE: {
    hinglish: (p) =>
      `AI sahayak: Aaj ka list rate: ${none(p.item)} ${money(p.rate ?? 0)} / ${none(p.unit)}. Aapke order ka final rate dukaan batayegi.`,
    hindi: (p) =>
      `एआई सहायक: आज का लिस्ट रेट: ${none(p.item)} ${money(p.rate ?? 0)} / ${none(p.unit)}। आपके ऑर्डर का अंतिम रेट दुकान बताएगी।`,
    english: (p) =>
      `AI helper: Today's list rate: ${none(p.item)} ${money(p.rate ?? 0)} / ${none(p.unit)}. The shop will tell you the final rate for your order.`,
  },
  RATE_UNKNOWN: {
    hinglish: () => 'AI sahayak: Is item ka rate dukaan se pata karke batayenge.',
    hindi: () => 'एआई सहायक: इस सामान का रेट दुकान से पता करके बताएँगे।',
    english: () => "AI helper: We'll check this item's rate with the shop.",
  },
  NO_PROMISE: {
    hinglish: () =>
      'AI sahayak: Stock, samay, udhaar aur daam ki baat dukaan hi batayegi. Aapka sawal dukaan tak pahunch gaya.',
    hindi: () =>
      'एआई सहायक: स्टॉक, समय, उधार और दाम की बात दुकान ही बताएगी। आपका सवाल दुकान तक पहुँच गया।',
    english: () =>
      'AI helper: Only the shop can speak to stock, timing, credit and price. Your question reached the shop.',
  },
  UNKNOWN_ITEM: {
    hinglish: (p) => `AI sahayak: ${none(p.words)} list mein nahi mila. Dukaan dekh kar batayegi.`,
    hindi: (p) => `एआई सहायक: ${none(p.words)} सूची में नहीं मिला। दुकान देखकर बताएगी।`,
    english: (p) => `AI helper: ${none(p.words)} is not on our list. The shop will check.`,
  },
  OFF_TOPIC: {
    hinglish: () =>
      'AI sahayak: Main sirf order aur rate mein madad karta hoon. Baaki baat dukaan se yahin karein.',
    hindi: () =>
      'एआई सहायक: मैं सिर्फ़ ऑर्डर और रेट में मदद करता हूँ। बाकी बात दुकान से यहीं करें।',
    english: () =>
      'AI helper: I only help with orders and rates. For anything else, ask the shop here.',
  },
  ENGINEER: {
    hinglish: () =>
      'AI sahayak: Beam, column, chhat aur masale ke liye engineer se poochhein. Hum maal dete hain, design nahi dekhte.',
    hindi: () =>
      'एआई सहायक: बीम, कॉलम, छत और मसाले के लिए इंजीनियर से पूछें। हम माल देते हैं, डिज़ाइन नहीं देखते।',
    english: () =>
      'AI helper: Please ask an engineer about beams, columns, roofs and mixes. We supply goods, not design.',
  },
  HANDOFF: {
    hinglish: () => 'AI sahayak: Theek hai. Ab dukaan se koi aapko yahin jawab dega.',
    hindi: () => 'एआई सहायक: ठीक है। अब दुकान से कोई आपको यहीं जवाब देगा।',
    english: () => 'AI helper: All right. Someone from the shop will answer you here.',
  },
  FORWARD: {
    hinglish: () => 'Aapka message dukaan tak pahunch gaya. Dukaan yahin jawab degi.',
    hindi: () => 'आपका संदेश दुकान तक पहुँच गया। दुकान यहीं जवाब देगी।',
    english: () => 'Your message reached the shop. The shop will answer here.',
  },
  STOP_OK: {
    hinglish: () => 'Theek hai. AI ab aapke messages nahi padhega. Dukaan yahin jawab degi.',
    hindi: () => 'ठीक है। एआई अब आपके संदेश नहीं पढ़ेगा। दुकान यहीं जवाब देगी।',
    english: () =>
      'All right. The AI will no longer read your messages. The shop will answer here.',
  },
};

/**
 * The fixed sentences that may hold the word. All are negative but one: "already confirmed" goes
 * only when the database holds an order a person confirmed.
 */
export const allowedPakka =
  /abhi pakka nahi hai|अभी पक्का नहीं है|not confirmed yet|pakka hote hi yahin message aayega|पक्का होते ही यहीं संदेश आएगा|pehle hi pakka hua hai|पहले ही पक्का हुआ है|already confirmed|pakka nahi hua|पक्का नहीं हुआ|was not confirmed/gi;

// Letters from other alphabets that look like Latin ones, so "pаkka" with a Cyrillic a is still caught.
const lookAlikes: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  к: 'k',
  м: 'm',
  т: 't',
  н: 'h',
  в: 'b',
  ο: 'o',
  α: 'a',
  ρ: 'p',
  κ: 'k',
  ι: 'i',
  ν: 'v',
  τ: 't',
  ε: 'e',
};
const skeleton = (value: string) =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]|\p{Cf}/gu, '')
    .replace(/./gu, (letter) => lookAlikes[letter] ?? letter);
const unsafeRoots = [
  'pakk',
  'confirm',
  'cnfrm',
  'paid',
  'free',
  'muft',
  'mufat',
  'guarant',
  'gurant',
  'approve',
  'rupee',
  'rupay',
  'rupya',
  'rupai',
  'discount',
  '₹',
  'पक्क',
  'कन्फर्म',
  'मुफ्त',
  'मुफ़्त',
  'फ्री',
  'रुपय',
  'रुपए',
  'रुपये',
  'गारंटी',
  'http',
  'www.',
  '.com',
  '.in/',
  '@',
].map(skeleton);
const unsafeToken = (token: string) => {
  const plain = skeleton(token);
  return (
    unsafeRoots.some((root) => plain.includes(root)) ||
    /[a-z0-9-]+\.[a-z]{2,}/.test(plain) ||
    /^(rs|inr)\.?[\d,]*$/.test(plain) ||
    /^[\d,]+(rs|inr|\/-)$/.test(plain)
  );
};
/**
 * A customer's words can reach a reply only through here. Anything that sounds like a promise, a
 * price or a link goes, and a promise spelt out with spaces takes the whole value with it.
 */
const safeWords = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const kept = value.split(/\s+/).filter((token) => token && !unsafeToken(token));
  const joined = skeleton(kept.join(''));
  if (unsafeRoots.some((root) => joined.includes(root))) return '';
  return kept.join(' ').slice(0, 120);
};
/** Our own sentences coming back: another bot, or someone forwarding them. */
export const isOwnWords = (text: string) =>
  /\bai sahayak\b|एआई सहायक|\bai helper\b/i.test(text.normalize('NFKC'));
/** The last look before anything leaves: a reply from the AI that says too much does not go. */
export function promisesTooMuch(kind: AiReplyKind, body: string) {
  const rest = skeleton(body.replace(allowedPakka, ' '));
  if (['pakk', 'पक्क', 'confirm'].map(skeleton).some((word) => rest.includes(word))) return true;
  return kind !== 'RATE' && (rest.includes('₹') || /\b\d[\d,]*\s*(rs|rupees?)\b/.test(rest));
}
export function renderReply(kind: AiReplyKind, language: ReplyLanguage, params: Params = {}) {
  const { rate, unit, privacyUrl, ...rest } = params;
  const clean = Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [key, safeWords(value) ?? '']),
  ) as Params;
  return replyWords[kind][language]({
    ...clean,
    ...(rate === undefined ? {} : { rate }),
    ...(unit === undefined ? {} : { unit }),
    ...(privacyUrl === undefined ? {} : { privacyUrl }),
  });
}

/** Fixed answers a customer can tap. The ids come back on the webhook and mean these words only. */
export const buttonWords = {
  CHANGE: {
    hinglish: 'Badlav karna hai',
    hindi: 'बदलाव करना है',
    english: 'Change something',
    means: 'badlav karna hai',
  },
  HUMAN: {
    hinglish: 'Dukaan se baat',
    hindi: 'दुकान से बात',
    english: 'Talk to the shop',
    means: 'dukaan se baat',
  },
  PICKUP: {
    hinglish: 'Khud utha lenge',
    hindi: 'ख़ुद उठा लेंगे',
    english: 'Will collect',
    means: 'khud utha lenge',
  },
  TODAY: { hinglish: 'Aaj', hindi: 'आज', english: 'Today', means: 'aaj' },
  TOMORROW: { hinglish: 'Kal', hindi: 'कल', english: 'Tomorrow', means: 'kal' },
  NOT_SURE: {
    hinglish: 'Abhi pata nahi',
    hindi: 'अभी पता नहीं',
    english: 'Not sure yet',
    means: 'abhi pata nahi',
  },
  NEW_YES: { hinglish: 'Haan naya', hindi: 'हाँ नया', english: 'Yes, new', means: 'haan naya' },
  NEW_NO: { hinglish: 'Nahi', hindi: 'नहीं', english: 'No', means: 'nahi naya' },
} as const;
export type ButtonId = keyof typeof buttonWords;
const replyButtonIds: Partial<Record<AiReplyKind, ButtonId[]>> = {
  DRAFT: ['CHANGE', 'HUMAN'],
  ASK_PLACE: ['PICKUP'],
  ASK_DAY: ['TODAY', 'TOMORROW', 'NOT_SURE'],
  ASK_NEW: ['NEW_YES', 'NEW_NO'],
};
export function replyButtons(kind: AiReplyKind, language: ReplyLanguage) {
  return (replyButtonIds[kind] ?? []).map((id) => ({ id, title: buttonWords[id][language] }));
}
/** What a tapped button means. An id we never sent means nothing. */
export const buttonMeaning = (id: string) =>
  Object.hasOwn(buttonWords, id) ? buttonWords[id as ButtonId].means : null;

const shortDay = (date: string | null | undefined) => {
  if (!date) return '';
  const when = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(when.getTime())
    ? `${when.getUTCDate()} ${when.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}`
    : '';
};
type CardWords = {
  lines: {
    quantity: number | null;
    unitWord: string | null;
    productName: string | null;
    rawText: string;
    productId: string | null;
  }[];
  placeText: string;
  deliveryDate: string | null;
};
export function lineWords(lines: CardWords['lines']) {
  return lines
    .map((line) =>
      [line.quantity, line.unitWord, line.productName ?? line.rawText].filter(Boolean).join(' '),
    )
    .join(', ');
}
/** The values a reply may carry. Rates come from the shop's own list, never from a message. */
export function replyParams(card: CardWords | null, catalog: Catalog, privacyUrl?: string) {
  const first = card?.lines[0]?.productId
    ? catalog.products.get(card.lines[0].productId)
    : undefined;
  const params: Params = {
    lines: card ? lineWords(card.lines) : '',
    place: card?.placeText ?? '',
    day: shortDay(card?.deliveryDate),
    words: card?.lines.find((line) => !line.productId)?.rawText ?? '',
  };
  if (first) Object.assign(params, { item: first.name, rate: first.pricePaise, unit: first.unit });
  if (privacyUrl) params.privacyUrl = privacyUrl;
  return params;
}

/** What this message did to the card, which decides what can honestly be said about it. */
export type DraftMoment =
  // The first message of a new draft.
  | 'NEW'
  // It changed the open draft.
  | 'CHANGED'
  // The same again while it is open.
  | 'SAME'
  // The same again, and they were told a short while ago.
  | 'SAME_TOLD'
  // The same lines soon after a person confirmed them.
  | 'REPEAT'
  // Asking to change what a person already confirmed.
  | 'AFTER_TAP'
  // A draft is open, and this message did not touch it.
  | 'OPEN'
  // A draft ran out of time.
  | 'EXPIRED'
  | 'NONE';
export type CardFacts = Pick<Reading, 'lines' | 'placeText' | 'fulfilment' | 'dayKind'>;
export type ReplyContext = {
  /** A number that belongs to a customer the shop already knows. */
  known: boolean;
  /** Papa typed in this chat a short while ago. */
  humanQuiet: boolean;
  /** The list rate of the item asked about, if it is fresh enough to say. */
  freshRatePaise: number | null;
  failed: boolean;
  /** Left out only when trying words on the reader, with no chat behind them. */
  draft?: DraftMoment;
  /** Papa typed on the open draft, so the AI never reports on it (decision 7). */
  papa?: boolean;
  /** They asked for a person, and the AI stays out until that passes. */
  handedOff?: boolean;
  /** Questions already put to them. Each goes once, and at most two go on one draft. */
  asked?: string[];
  /** The card as it now stands, when a change merged into it. */
  card?: CardFacts;
};
const roundsAllowed = 2;
function nextQuestion(facts: CardFacts, asked: string[]): AiReplyKind[] {
  if (asked.length >= roundsAllowed) return [];
  const once = (kind: AiReplyKind): AiReplyKind[] => (asked.includes(kind) ? [] : [kind]);
  // A trolley has no quantity until the family gives its size, and that is not the customer's to answer.
  if (facts.lines.some((line) => line.candidates > 1 || (line.quantity === null && !line.unitWord)))
    return once('ASK_WHICH');
  if (!facts.placeText && facts.fulfilment !== 'PICKUP') return once('ASK_PLACE');
  if (facts.dayKind === 'UNSPECIFIED') return once('ASK_DAY');
  return [];
}

/**
 * What the shop's number answers. Worked out here from the checked reading, never by the model, so
 * a clever message can at worst pick the wrong sentence from this short list.
 */
export function decideReplies(reading: Reading | null, context: ReplyContext): AiReplyKind[] {
  if (context.handedOff) return [];
  // Papa spoke here, and the AI must not contradict him. A status question gets only "the shop will
  // answer", and everything else only updates his card.
  if (context.papa) {
    const asking = reading?.intent === 'STATUS_QUESTION' && !context.failed;
    return asking && !context.humanQuiet && !reading.flags.includes('INJECTION')
      ? ['AFTER_TAP']
      : [];
  }
  // With no reading, a stranger may be family, so only a known customer hears anything.
  if (!reading || context.failed) return context.known ? ['FORWARD'] : [];
  if (reading.flags.includes('INJECTION')) return [];
  const ordering = reading.intent === 'ORDER' || reading.intent === 'ORDER_CHANGE';
  // After Papa types, a new order still gets its receipt. Everything else waits for him.
  if (context.humanQuiet && (!ordering || context.draft !== 'NEW')) return [];
  switch (reading.intent) {
    case 'ORDER':
    case 'ORDER_CHANGE': {
      const moment = context.draft ?? 'NEW';
      if (moment === 'AFTER_TAP') return ['AFTER_TAP'];
      // A stranger may be family, so only a known customer hears that it reached the shop.
      if (reading.band === 'RED') return context.known ? ['FORWARD'] : [];
      if (moment === 'SAME') return ['WAITING'];
      if (moment === 'SAME_TOLD') return [];
      if (moment === 'REPEAT') return ['ASK_NEW'];
      if (context.humanQuiet) return ['DRAFT'];
      const replies: AiReplyKind[] = [moment === 'CHANGED' ? 'UPDATED' : 'DRAFT'];
      if (reading.lines.some((line) => !line.productId && !line.candidates))
        replies.push('UNKNOWN_ITEM');
      replies.push(...nextQuestion(context.card ?? reading, context.asked ?? []));
      return replies;
    }
    case 'RATE_QUESTION':
      return [context.freshRatePaise === null ? 'RATE_UNKNOWN' : 'RATE'];
    case 'STATUS_QUESTION':
      if (context.draft === 'OPEN') return ['WAITING'];
      return [context.draft === 'EXPIRED' ? 'EXPIRED' : 'AFTER_TAP'];
    case 'HUMAN_REQUEST':
    case 'COMPLAINT':
      return ['HANDOFF'];
    case 'PRICE_OR_CREDIT_TALK':
    case 'STOCK_OR_TIME_QUESTION':
      return ['NO_PROMISE'];
    case 'STRUCTURAL':
      return ['ENGINEER'];
    case 'OFF_TOPIC':
      return ['OFF_TOPIC'];
    default:
      return [];
  }
}
/** These kinds go on the first answer only when the customer has been told who is writing. */
export const noNoticeNeeded: readonly AiReplyKind[] = ['NOTICE', 'STOP_OK', 'FORWARD', 'HANDOFF'];
