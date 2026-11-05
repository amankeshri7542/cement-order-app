import type { AdvisorLanguage, AdvisorRoute, AdvisorTextKey, WallSize } from '@shiv/shared';
import { floorText } from './floor';
import { hasDevanagari } from './understand-hindi';

/**
 * What plain rules can tell about a question that passed the floor. A confident answer needs no
 * model at all, which keeps the shop inside its ₹10 a day. Anything unsure goes on to triage when
 * the AI is on, and to a search of the guide when it is off.
 */
export type GapKind = 'NO_ARTICLE' | 'DISLIKED' | 'NOT_LISTED' | 'SHOP_FACT';
export type LocalRoute = {
  route: AdvisorRoute;
  confident: boolean;
  /** Fixed text to answer with, when that is the whole answer. */
  text?: AdvisorTextKey;
  gap?: GapKind;
  wants?: 'RATES' | 'AVAILABILITY' | 'DELIVERY' | 'SHOP';
  pincode?: string;
  estimate?: EstimateAsk;
};
export type EstimateAsk =
  | { kind: 'BRICKS'; wall: WallSize | null }
  | {
      kind: 'SARIYA_WEIGHT';
      diameterMm: number | null;
      lengthM: number | null;
      rods: number | null;
    }
  | { kind: 'LATER' };

const has = (text: string, pattern: RegExp) => pattern.test(text);

const toFeet = (value: number, unit: string) =>
  /^(m|meter|metre)/.test(unit) ? value * 3.28084 : value;

/** Sizes from a question like "30 ft lambi, 10 ft oonchi, 9 inch deewar". Null if any is missing. */
export function wallFrom(text: string): WallSize | null {
  const number = '(\\d+(?:\\.\\d+)?)';
  const unit = '(ft|feet|foot|fut|fit|m|meter|metre)';
  const length = new RegExp(`${number}\\s*${unit}\\s*(?:lambi|lamba|long|length|lambai)`).exec(
    text,
  );
  const height = new RegExp(
    `${number}\\s*${unit}\\s*(?:oonchi|unchi|ooncha|uncha|high|height|tall|oonchai|unchai)`,
  ).exec(text);
  const thickness = /(4\.5|4 1\/2|saade char|saade chaar|9)\s*(?:inch|inches|in|")/.exec(text);
  if (!length || !height || !thickness) return null;
  return {
    lengthFt: toFeet(Number(length[1]), length[2]!),
    heightFt: toFeet(Number(height[1]), height[2]!),
    thicknessInch: thickness[1] === '9' ? 9 : 4.5,
  };
}

function sariyaFrom(text: string): Extract<EstimateAsk, { kind: 'SARIYA_WEIGHT' }> {
  const diameter = /(\d+(?:\.\d+)?)\s*(?:mm|soot|sut)\b/.exec(text);
  const length = /(\d+(?:\.\d+)?)\s*(?:m|meter|metre|metres|meters)\b/.exec(text);
  const rods = /(\d+)\s*(?:rod|rods|chhad|bar|bars|piece|pieces)\b/.exec(text);
  return {
    kind: 'SARIYA_WEIGHT',
    diameterMm: diameter ? Number(diameter[1]) : null,
    lengthM: length ? Number(length[1]) : null,
    rods: rods ? Number(rods[1]) : null,
  };
}

export function localRoute(question: string): LocalRoute {
  const text = floorText(question);
  const fixed = (route: AdvisorRoute, key: AdvisorTextKey, gap?: GapKind): LocalRoute => ({
    route,
    confident: true,
    text: key,
    ...(gap ? { gap } : {}),
  });

  // Sums that will come later, one at a time, using the mix the customer's mason gives.
  if (
    has(text, /\b(plaster|palaster|mortar|paint)\b/) &&
    has(text, /\b(kitna|kitni|kitne|how much|how many)\b/) &&
    has(text, /\d/)
  )
    return { route: 'ESTIMATE', confident: true, estimate: { kind: 'LATER' } };

  if (
    has(text, /\b(trolley|tractor|truck|hyva|hiva)\b/) &&
    has(text, /\b(kitna|kitni|kitne|how much|how many|cft|size|holds?|aata|aati)\b/) &&
    !has(text, /\b(rate|price|bhav|daam|kitne ka|kitne ki)\b/)
  )
    return fixed('SHOP_FACT', 'TROLLEY', 'NO_ARTICLE');

  if (
    (has(text, /\b(per sq|per square|sq ?ft|sqft|square f)/) &&
      has(text, /\b(kharcha|kharch|cost|budget|lagat|rate|paisa)\b/)) ||
    (has(text, /\b(ghar|house|makaan|building)\b/) &&
      has(text, /\b(banane|banana|build|building|construct|construction)\b/) &&
      has(text, /\b(kharcha|kharch|cost|budget|lagat)\b/))
  )
    return fixed('GENERAL_ADVICE', 'COST_PER_SQFT', 'NO_ARTICLE');

  if (
    has(
      text,
      /\b(discount|chhoot|chhut|sasta|sasti|kam rate|kam karo|kam kar|offer|free delivery|muft|percent off|% off)\b/,
    ) ||
    has(text, /\d+\s*%/)
  )
    return fixed('ORDER_INTENT', 'DISCOUNT');

  const pincode = /(?<!\d)[1-9]\d{5}(?!\d)/.exec(text)?.[0];
  const deliveryWord =
    /\b(deliver|delivery|delivered|deliveries|bhada|bhijwa|pahunch|pahuncha|pahunchega|pahunchegi|pahunchayenge|ghar tak|site tak)\b/;
  if (has(text, deliveryWord) || (pincode && has(text, /\b(pincode|pin code|pin|area|tak)\b/))) {
    if (pincode) return { route: 'CATALOG', confident: true, wants: 'DELIVERY', pincode };
    return fixed('CATALOG', 'DELIVERY_PROMISE');
  }

  // Decision 51: materials the shop does not stock are not talked about, only noted.
  if (
    has(
      text,
      /\b(tile|tiles|tiling|putty|paint|paints|distemper|primer|pop|marble|granite|wallpaper|laminate|plywood)\b/,
    )
  )
    return fixed('CATALOG', 'NOT_LISTED', 'NOT_LISTED');

  if (
    has(
      text,
      /\b(best|sabse accha|sabse acha|sabse achha|sabse badhiya|sabse sasta|top brand|konsa brand|kaunsa brand|kaun sa brand|kon sa brand|which brand|number one)\b/,
    )
  )
    return fixed('GENERAL_ADVICE', 'NO_BEST_BRAND');

  if (
    has(
      text,
      /\b(mera|meri|mere|my|hamara|hamari)\b.{0,20}\b(order|orders|baaki|udhaar|khata|bill|payment|balance|account|parchi)\b/,
    ) ||
    has(text, /\b(order|maal)\b.{0,12}\b(kahan|kab aayega|kab aayegi|status|track)\b/) ||
    has(text, /\b(kitna baaki|kitna udhaar|how much do i owe|where is my)\b/)
  )
    return fixed('MY_ACCOUNT', 'MY_ACCOUNT');

  if (
    has(
      text,
      /\b\d+\s*(bori|bags?|ton|tonne|quintal|trolley|truck|piece|pieces|kg|kilo|hazaar|cft)\b.{0,40}\b(chahiye|lunga|lenge|lena hai|bhej|bhejo|bhejna|send|de do|dedo|order|book|utha)\b/,
    ) ||
    has(
      text,
      /\b(order (karna|karni|dena|place|kar do|kardo)|place (an |my )?order|i want to (order|buy)|want to order|book (kar|karna))\b/,
    )
  )
    return fixed('ORDER_INTENT', 'ORDER_INTENT');

  if (
    has(
      text,
      /\b(kab khul|kab band|khulti|khulta|khulegi|timing|timings|opening|hours|open|close|closed|address|location|kahan hai|kaha hai|phone number|contact|whatsapp|number do|number dijiye|apka number|aapka number|owner|malik|purani|how old|since when|kab se|dealer|dealership|distributor|authorised|authorized|gst number|gstin)\b/,
    )
  )
    return { route: 'SHOP_FACT', confident: true, wants: 'SHOP', gap: 'SHOP_FACT' };

  const estimateOfBricks =
    has(text, /\b(kitni|kitne|how many)\b.{0,20}\b(eent|eet|int|brick|bricks)\b/) ||
    has(
      text,
      /\b(eent|eet|brick|bricks)\b.{0,30}\b(kitni|kitne|how many)\b.{0,20}\b(lage|lagegi|lagenge|chahiye|need)\b/,
    );
  if (estimateOfBricks)
    return {
      route: 'ESTIMATE',
      confident: true,
      estimate: { kind: 'BRICKS', wall: wallFrom(text) },
    };
  if (
    has(text, /\b(weight|wajan|wazan|vajan|vajn|kitna bhaari|kanta)\b/) &&
    has(text, /\b(sariya|saria|sarya|steel|rod|rods|tmt)\b/)
  )
    return { route: 'ESTIMATE', confident: true, estimate: sariyaFrom(text) };

  if (
    has(
      text,
      /\b(loan|emi|mortgage|sell my land|zameen bech|zamin bech|vastu|court|lawyer|vakeel|legal|registry|income tax|tax adviser|insurance|dawai|medicine|bank)\b/,
    )
  )
    return fixed('OTHER_PROFESSIONAL', 'OTHER_PROFESSIONAL');

  if (
    has(
      text,
      /\b(stock|kitni bori hai|kitna bacha|available|availability|milta|milti|milte|milega|milegi|milenge|rakhte|bechte|sell|do you have)\b/,
    )
  )
    return { route: 'CATALOG', confident: true, wants: 'AVAILABILITY' };

  if (
    has(
      text,
      /\b(rate|rates|price|prices|pricing|bhav|bhaav|daam|keemat|kimat|kitne ka|kitne ki|kitne ke|kitne mein|kitne me|per kilo|per kg|per bag|per bori|mrp)\b/,
    )
  )
    return { route: 'CATALOG', confident: true, wants: 'RATES' };

  if (
    has(
      text,
      /\b(poem|kavita|shayari|joke|chutkula|cricket|ipl|movie|film|song|gaana|recipe|weather|mausam|homework|python|javascript|code|essay|translate|politics|election)\b/,
    )
  )
    return fixed('OUT_OF_SCOPE', 'OUT_OF_SCOPE');

  if (
    /^(hi|hii|hello|helo|hey|namaste|namaskar|pranam|thanks|thank you|thankyou|dhanyavaad|dhanyawad|shukriya|ok|okay|good morning|good evening|bye)[\s.!?]*$/.test(
      text,
    )
  )
    return fixed('SMALL_TALK', 'SMALL_TALK');

  if (
    has(
      text,
      /^(what is|what's|what are|define|meaning of)\b|\b(kya hota|kya hoti|kya hote|kya hai|kya hain|matlab|kise kehte|kisko kehte|fark|difference between)\b/,
    )
  )
    return { route: 'EXPLAIN_TERM', confident: false };

  return { route: 'GENERAL_ADVICE', confident: false };
}

const hinglishMarkers =
  /\b(kya|kitna|kitni|kitne|hai|hain|kaise|kaisa|mein|ka|ki|ke|ko|nahi|nhi|karun|karna|karein|batao|bataiye|chahiye|kahan|dukaan|kab|aur|bhai|ji|hota|hoti|lagega|milega|sabse|kaunsa|konsa|yeh|ye|aap|mera|mere|meri|se|par|tak|aaj|kal)\b/;
const englishMarkers =
  /\b(what|how|is|the|can|i|my|which|do|does|should|when|where|why|will|are|you|for|of|a|an|to|much|many)\b/;

/**
 * Mirror the customer. Devanagari is answered in Hinglish in Roman script, because the brief bars
 * Devanagari from these screens. A question too short to tell takes the screen's language.
 */
export function detectLanguage(question: string, fallback: AdvisorLanguage): AdvisorLanguage {
  if (hasDevanagari(question)) return 'hinglish';
  const text = question.toLowerCase();
  const hinglish = (text.match(new RegExp(hinglishMarkers.source, 'g')) ?? []).length;
  const english = (text.match(new RegExp(englishMarkers.source, 'g')) ?? []).length;
  if (!hinglish && !english) return fallback;
  return hinglish >= english ? 'hinglish' : 'en';
}

/** "English mein batao": the customer choosing a language for this conversation. */
export function languageRequest(
  question: string,
): { language: AdvisorLanguage; only: boolean } | null {
  const text = question.toLowerCase().trim();
  const asks = (pattern: RegExp) => pattern.test(text);
  const language: AdvisorLanguage | null = asks(
    /\b(english (mein|me|main|men)|in english|speak english|english please|english bolo)\b/,
  )
    ? 'en'
    : asks(/\b(hinglish|hindi (mein|me|main|men)|in hindi|hindi please|hindi bolo)\b/)
      ? 'hinglish'
      : null;
  if (!language) return null;
  // Nothing else in the message: the customer wants the last answer again in that language.
  const only = text.split(/\s+/).length <= 5;
  return { language, only };
}
