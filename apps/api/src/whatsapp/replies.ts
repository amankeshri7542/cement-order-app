import { money } from '@shiv/shared';
import type { Reading } from './reading';

/**
 * Every sentence the reader could ever cause, and only in shadow for now: nothing sends these yet.
 * The confirmations ("Pakka...") are left out of this type on purpose. Only a person's tap may ever
 * produce those, and they will not live here.
 */
export type AiReplyKind =
  | 'NOTICE'
  | 'DRAFT'
  | 'ASK_PLACE'
  | 'ASK_DAY'
  | 'ASK_WHICH'
  | 'AFTER_TAP'
  | 'RATE'
  | 'RATE_UNKNOWN'
  | 'NO_PROMISE'
  | 'UNKNOWN_ITEM'
  | 'OFF_TOPIC'
  | 'ENGINEER'
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

/** A customer's words can reach these only through here, with anything that sounds like a promise out. */
const safeWords = (value: string | undefined) =>
  value
    ?.replace(
      /pakk[a-z]*|पक्क\S*|confirm\S*|paid|free|मुफ़्त|रुपय\S*|रुपए|₹|\brs\b\.?|\b\d[\d,]*\s*(rupees?|rupaye)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
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

export type ReplyContext = {
  /** A number that belongs to a customer the shop already knows. */
  known: boolean;
  /** Papa typed in this chat a short while ago. */
  humanQuiet: boolean;
  /** The list rate of the item asked about, if it is fresh enough to say. */
  freshRatePaise: number | null;
  failed: boolean;
};

/**
 * What the shop's number would have answered. Worked out here from the checked reading, never by
 * the model, so a clever message can at worst pick the wrong sentence from this short list.
 */
export function decideReplies(reading: Reading | null, context: ReplyContext): AiReplyKind[] {
  // With no reading, a stranger may be family, so only a known customer hears anything.
  if (!reading || context.failed) return context.known ? ['FORWARD'] : [];
  if (reading.flags.includes('INJECTION')) return [];
  const ordering = reading.intent === 'ORDER' || reading.intent === 'ORDER_CHANGE';
  // After Papa types, a new order still gets its receipt. Everything else waits for him.
  if (context.humanQuiet && !ordering) return [];
  switch (reading.intent) {
    case 'ORDER':
    case 'ORDER_CHANGE': {
      if (reading.band === 'RED') return ['FORWARD'];
      const replies: AiReplyKind[] = ['DRAFT'];
      if (reading.lines.some((line) => !line.productId && !line.candidates))
        replies.push('UNKNOWN_ITEM');
      // A trolley has no quantity until the family gives its size, and that is not the customer's to answer.
      if (
        reading.lines.some(
          (line) => line.candidates > 1 || (line.quantity === null && !line.unitWord),
        )
      )
        replies.push('ASK_WHICH');
      else if (!reading.placeText && reading.fulfilment !== 'PICKUP') replies.push('ASK_PLACE');
      else if (reading.dayKind === 'UNSPECIFIED') replies.push('ASK_DAY');
      return replies;
    }
    case 'RATE_QUESTION':
      return [context.freshRatePaise === null ? 'RATE_UNKNOWN' : 'RATE'];
    case 'STATUS_QUESTION':
      return ['AFTER_TAP'];
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
