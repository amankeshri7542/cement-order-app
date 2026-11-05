import { z } from 'zod';
import type { Availability } from './index';
import type { EstimateResult } from './estimates';

/**
 * The contract for Ask, the AI home-building advisor, shared by the API, website and app. Every
 * word here is fixed, reviewed text. Hindi fixed text is not built (decision 12): a customer who
 * writes Devanagari is understood and answered in Roman script.
 */
export const advisorSpeaker = 'Shiv Cement AI';
export const advisorDeviceHeader = 'x-advisor-device';

export const advisorRoutes = [
  'DANGER_NOW',
  'STRUCTURAL',
  'EXPLAIN_TERM',
  'GENERAL_ADVICE',
  'CATALOG',
  'ESTIMATE',
  'SHOP_FACT',
  'ORDER_INTENT',
  'MY_ACCOUNT',
  'OTHER_PROFESSIONAL',
  'PRIVATE_OR_ATTACK',
  'OUT_OF_SCOPE',
  'SMALL_TALK',
] as const;
export type AdvisorRoute = (typeof advisorRoutes)[number];

export const advisorLevels = ['CHECKED', 'GENERAL', 'FIXED', 'FALLBACK'] as const;
export type AdvisorLevel = (typeof advisorLevels)[number];

export const advisorLanguages = ['en', 'hinglish'] as const;
export type AdvisorLanguage = (typeof advisorLanguages)[number];

/** What the answer is tagged with. Fixed text carries no tag. */
export type AdvisorLabel = 'CHECKED' | 'GENERAL' | 'AI_BUSY' | 'FROM_GUIDE';

export type AdvisorTurnStatus = 'PENDING' | 'DONE' | 'CANCELLED';

/** Which limit stopped the AI this turn. The customer still gets articles and a way to the shop. */
export type AdvisorLimit = 'DEVICE' | 'ACCOUNT' | 'NETWORK' | 'SHOP' | 'CONVERSATION';

// ---- What a client sends ----------------------------------------------------------------------
export const advisorTurnInput = z.strictObject({
  /** Made by the client for each question, and reused if the network drops, so nothing runs twice. */
  clientTurnId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  text: z.string().trim().min(1).max(600),
  channel: z.enum(['WEB', 'APP']),
  /** The screen's language. Used only when the question is too short to tell. */
  languageHint: z.enum(advisorLanguages).optional(),
  productId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .optional(),
});
export type AdvisorTurnInput = z.infer<typeof advisorTurnInput>;

export const advisorFeedbackReasons = [
  'WRONG',
  'DID_NOT_ANSWER',
  'HARD_TO_UNDERSTAND',
  'OFFENSIVE',
] as const;
export const advisorFeedbackInput = z
  .strictObject({
    value: z.enum(['HELPED', 'NOT_RIGHT']),
    reason: z.enum(advisorFeedbackReasons).optional(),
  })
  .refine((body) => body.value === 'NOT_RIGHT' || body.reason === undefined, {
    message: 'Only "Not right" takes a reason.',
    path: ['reason'],
  });
export type AdvisorFeedbackInput = z.infer<typeof advisorFeedbackInput>;

// ---- What a client receives -------------------------------------------------------------------
export type AdvisorProduct = {
  id: string;
  name: string;
  brand: string;
  grade: string;
  unit: string;
  packSize: string;
  minQuantity: number;
  quantityStep: number;
  /** Null for an item the shop only gets to order: it has no list price. */
  pricePaise: number | null;
  priceVersion: number;
  priceUpdatedAt: string;
  /** True until someone at the shop has said this rate stands. */
  isSample: boolean;
  /** In stock or not, never how much. */
  availability: Availability;
};

export type AdvisorDelivery = {
  pincode: string;
  serviceable: boolean;
  zone: string | null;
  deliveryFeePaise: number | null;
  minimumOrderPaise: number | null;
  freeDeliveryAbovePaise: number | null;
};

export type AdvisorCitation = {
  slug: string;
  /** The article and section, for "From our guide". */
  title: string;
  href: string;
  citedText: string;
  /** "2027-03": when an engineer checked it. Null only for a shop's own answer. */
  checkedOn: string | null;
};

export type AdvisorArticleLink = {
  slug: string;
  title: string;
  titleHinglish: string;
  summary: string;
  href: string;
};

export type AdvisorTurnView = {
  id: string;
  clientTurnId: string;
  status: AdvisorTurnStatus;
  speaker: typeof advisorSpeaker;
  route: AdvisorRoute;
  level: AdvisorLevel;
  label: AdvisorLabel | null;
  language: AdvisorLanguage;
  text: string;
  products: AdvisorProduct[];
  /** "We sell these. You can buy them anywhere." when this answer shows materials. */
  nudge: string | null;
  delivery: AdvisorDelivery | null;
  estimate: EstimateResult | null;
  citations: AdvisorCitation[];
  /** Guide articles that match. Shown at a limit, and when the AI is off. */
  articles: AdvisorArticleLink[];
  followups: string[];
  limit: AdvisorLimit | null;
  /** A wa.me link once the family has approved a number. Null means hide the button. */
  whatsappUrl: string | null;
  feedback: 'HELPED' | 'NOT_RIGHT' | null;
  createdAt: string;
};

/**
 * Sent as `text/event-stream` when the client asks for it with `Accept: text/event-stream`. Each
 * block is `event: <type>` and `data: <json>`. A comment line goes out every 10 seconds to keep the
 * connection open. `done` always comes last and holds the whole answer.
 */
export type AdvisorEvent =
  | { type: 'status'; turnId: string; clientTurnId: string; text: string }
  | { type: 'route'; route: AdvisorRoute; level: AdvisorLevel; language: AdvisorLanguage }
  | { type: 'products'; products: AdvisorProduct[]; nudge: string | null }
  | { type: 'delivery'; delivery: AdvisorDelivery }
  | { type: 'estimate'; estimate: EstimateResult }
  /** One whole sentence. Sentences appear whole, with no typing effect. */
  | { type: 'text'; text: string }
  | { type: 'cite'; citation: AdvisorCitation }
  | { type: 'followups'; followups: string[] }
  /** Take away what was shown and show this. A blocked or failed answer ends this way. */
  | { type: 'replace'; text: string; level: AdvisorLevel; label: AdvisorLabel | null }
  | { type: 'done'; turn: AdvisorTurnView };

export type GuideListItem = {
  slug: string;
  title: string;
  titleHinglish: string;
  summary: string;
  stages: string[];
  materials: string[];
  checkedOn: string | null;
};
export type GuideArticle = GuideListItem & {
  version: number;
  sections: { id: string; heading: string; blocks: string[] }[];
  relatedQuestions: string[];
  standardsMentioned: string[];
  reviewDueOn: string | null;
};

// ---- Fixed text -------------------------------------------------------------------------------
type Words = { en: string; hinglish: string };

export const advisorText = {
  DANGER_NOW: {
    en: 'Please keep everyone away from this part of the building now. Show it to a civil engineer today, or an electrician if wires are near. A message or a photo cannot tell if it is safe. If someone is in danger, call 112.',
    hinglish:
      'Abhi sabko is jagah se door rakhein. Aaj hi civil engineer ko dikhayein, aur taar paas ho to electrician ko. Message ya photo se pata nahi chalta ki yeh theek hai ya nahi. Kisi ki jaan ko khatra ho to 112 par call karein.',
  },
  INJURY: {
    en: 'Go to a doctor now. If cement went in the eye or on the skin, wash it with plenty of clean running water on the way. Do not use any home remedy. If someone is in danger, call 112.',
    hinglish:
      'Abhi doctor ke paas jayein. Cement aankh ya skin par laga ho to saaf behte paani se khoob dhoyein. Koi gharelu nuskha na lagayein. Kisi ki jaan ko khatra ho to 112 par call karein.',
  },
  STRUCTURAL: {
    en: "This is an engineer's decision, so I will not guess. Steel and size depend on your drawing, soil and floors. Ask a civil engineer for a steel list. Send us that list and the shop will reply with rates.",
    hinglish:
      'Yeh engineer ka faisla hai, isliye main andaza nahi lagaunga. Sariya aur size aapke naksha, mitti aur manzil par depend karte hain. Civil engineer se sariya ki list banwayein. Woh list hamein bhejein, dukaan rate bata degi.',
  },
  STRUCTURAL_WORK: {
    en: "This is an engineer's decision, so I will not guess. The mix, the timing and the safety depend on your drawing and your site. Ask your civil engineer before this work.",
    hinglish:
      'Yeh engineer ka faisla hai, isliye main andaza nahi lagaunga. Masala, samay aur safety aapke naksha aur site par depend karte hain. Yeh kaam karne se pehle apne civil engineer se poochhein.',
  },
  STRUCTURAL_CHANGE: {
    en: "This is an engineer's decision, so I will not guess. An engineer must see your house first. Do not break a wall or add a floor before that.",
    hinglish:
      'Yeh engineer ka faisla hai, isliye main andaza nahi lagaunga. Pehle engineer ko ghar dikhana zaroori hai. Usse pehle deewar na todein aur manzil na badhayein.',
  },
  STRUCTURAL_NO_MONEY: {
    en: 'I understand money is tight. Even so, I will not guess this, because a wrong guess can hurt people. Even one visit from a civil engineer can give you a steel list. Send us that list and the shop will reply with rates.',
    hinglish:
      'Samajh sakta hoon ki paisa tang hai. Phir bhi main andaza nahi lagaunga, kyunki galat andaze se kisi ko nuksan ho sakta hai. Civil engineer ki ek visit se bhi sariya ki list mil sakti hai. Woh list hamein bhejein, dukaan rate bata degi.',
  },
  OTHER_PROFESSIONAL: {
    en: 'I cannot advise on this. Please ask the right person, such as a lawyer, a doctor, a bank or a tax adviser.',
    hinglish:
      'Is par main salah nahi de sakta. Sahi aadmi se poochhein, jaise vakeel, doctor, bank ya tax salahkar.',
  },
  PRIVATE: {
    en: "I cannot share anyone's private details. I only know public materials, rates and the guide.",
    hinglish:
      'Main kisi ki private jaankari nahi de sakta. Mujhe sirf maal, rate aur guide ki jaankari hai.',
  },
  ATTACK: {
    en: 'I cannot do that. I can help with materials, rates and building doubts.',
    hinglish:
      'Yeh main nahi kar sakta. Main maal, rate aur ghar banane ke sawaalon mein madad kar sakta hoon.',
  },
  OUT_OF_SCOPE: {
    en: 'I only help with materials and building your home. Try one of the questions below.',
    hinglish:
      'Main sirf maal aur ghar banane mein madad karta hoon. Neeche diya koi sawaal poochhein.',
  },
  SMALL_TALK: {
    en: 'Namaste. I am an AI. I explain materials and building. For structure and safety, I send you to an engineer.',
    hinglish:
      'Namaste. Main AI hoon. Main maal aur ghar banane ke baare mein batata hoon. Structure aur safety ke liye engineer ke paas bhejta hoon.',
  },
  ORDER_INTENT: {
    en: 'I cannot take orders here. Add the items to your list, or send your list. The shop will reply.',
    hinglish:
      'Main yahan order nahi le sakta. Saaman apni list mein daalein, ya list bhejein. Dukaan jawab degi.',
  },
  MY_ACCOUNT: {
    en: 'I cannot see orders or accounts. Open Orders or Account to see yours.',
    hinglish: 'Main order ya khata nahi dekh sakta. Apna dekhne ke liye Orders ya Account kholein.',
  },
  CATALOG_LINE: {
    en: "These are the rates on the shop's list now.",
    hinglish: 'Yeh dukaan ki list ke abhi ke rate hain.',
  },
  AVAILABILITY_LINE: {
    en: 'I can only tell you if an item is available, not how many are left.',
    hinglish: 'Main sirf bata sakta hoon ki maal hai ya nahi, kitna bacha hai yeh nahi.',
  },
  NOT_LISTED: {
    en: 'The shop does not list this. I have told the shop you asked.',
    hinglish: 'Dukaan ki list mein yeh nahi hai. Maine dukaan ko bata diya hai ki aapne poochha.',
  },
  DISCOUNT: {
    en: 'I cannot offer a discount. Only the shop decides rates for a big order. Send your list and the shop will reply.',
    hinglish:
      'Main discount nahi de sakta. Bade order ka rate dukaan hi tay karti hai. List bhejein, dukaan jawab degi.',
  },
  DELIVERY_PROMISE: {
    en: 'I cannot promise a day. Check your pincode to see the delivery cost. The shop tells you the day.',
    hinglish:
      'Main din ka vaada nahi kar sakta. Apna pincode daal kar bhada dekhein. Din dukaan batayegi.',
  },
  DELIVERY_YES: {
    en: 'The shop lists this pincode. The delivery cost is shown here. The shop tells you the day.',
    hinglish:
      'Yeh pincode dukaan ki list mein hai. Bhada yahan dikh raha hai. Din dukaan batayegi.',
  },
  DELIVERY_NO: {
    en: 'The shop does not list this pincode yet. You can ask the shop.',
    hinglish: 'Yeh pincode abhi dukaan ki list mein nahi hai. Aap dukaan se poochh sakte hain.',
  },
  SHOP_NOT_ADDED: {
    en: 'The shop has not added this yet. You can ask the shop.',
    hinglish: 'Dukaan ne yeh abhi nahi joda hai. Aap dukaan se poochh sakte hain.',
  },
  COST_PER_SQFT: {
    en: 'I do not give a rate per sq ft. The cost depends on your drawing, floors, soil and the rates that day. An engineer or contractor can work it out from your drawing.',
    hinglish:
      'Main per sq ft rate nahi deta. Kharcha aapke naksha, manzil, mitti aur us din ke rate par depend karta hai. Engineer ya thekedar aapke naksha se hisaab laga sakte hain.',
  },
  TROLLEY: {
    en: 'Trolley sizes vary. Please ask the shop what a trolley holds. I have told the shop you asked.',
    hinglish:
      'Trolley ka size alag alag hota hai. Dukaan se poochhein ki ek trolley mein kitna aata hai. Maine dukaan ko bata diya hai.',
  },
  NO_BEST_BRAND: {
    en: 'There is no one best brand. Compare the type, the grade and the date on the bag. Ask your engineer what your work needs.',
    hinglish:
      'Koi ek best brand nahi hota. Bori par type, grade aur tareekh dekhein. Aapke kaam ke liye kya chahiye, yeh engineer se poochhein.',
  },
  ASK_PERSON: {
    en: 'I do not have a checked answer for this yet. I have told the shop. You can ask the shop or your engineer.',
    hinglish:
      'Is sawaal ka checked jawab abhi mere paas nahi hai. Maine dukaan ko bata diya hai. Aap dukaan ya apne engineer se poochh sakte hain.',
  },
  LIMIT: {
    en: 'You have asked a lot today. The guide is still here, or ask the shop.',
    hinglish: 'Aaj aapne kaafi sawaal pooch liye hain. Guide yahin hai, ya dukaan se poochhein.',
  },
  SHOP_LIMIT: {
    en: 'AI is busy. Try again soon, or read the guide, or ask the shop.',
    hinglish: 'AI abhi busy hai. Thodi der baad poochhein, guide padhein, ya dukaan se poochhein.',
  },
  START_NEW: {
    en: 'This chat has become long. Please start a new question.',
    hinglish: 'Yeh baat lambi ho gayi hai. Naya sawaal shuru karein.',
  },
  ESTIMATE_NOT_AVAILABLE: {
    en: 'This estimate is not available yet. Ask your mason.',
    hinglish: 'Yeh hisaab abhi nahi mil sakta. Apne mistri se poochhein.',
  },
  ESTIMATE_NEEDS_INPUT: {
    en: 'Please tell me the sizes, and I will show the sum.',
    hinglish: 'Size batayein, main hisaab dikha dunga.',
  },
  ESTIMATE_DONE: {
    en: 'Here is the sum from the sizes you gave. Estimate. Check with your mason before buying.',
    hinglish:
      'Aapke diye size se yeh hisaab hai. Yeh andaza hai. Kharidne se pehle mistri se poochh lein.',
  },
} as const satisfies Record<string, Words>;
export type AdvisorTextKey = keyof typeof advisorText;

export const advisorLabelText: Record<AdvisorLabel, Words> = {
  CHECKED: { en: 'Checked', hinglish: 'Checked' },
  GENERAL: { en: 'General, not checked', hinglish: 'General, checked nahi' },
  AI_BUSY: {
    en: 'AI is busy. This is from our checked guide.',
    hinglish: 'AI abhi busy hai. Yeh hamari checked guide se hai.',
  },
  FROM_GUIDE: {
    en: 'This is from our checked guide.',
    hinglish: 'Yeh hamari checked guide se hai.',
  },
};

export const advisorChrome = {
  statusChecking: { en: 'Checking the guide…', hinglish: 'Guide dekh raha hoon…' },
  firstOpenTitle: {
    en: 'Ask about building your home.',
    hinglish: 'Ghar banane ke baare mein poochhein.',
  },
  firstOpen: {
    en: 'I am an AI. I explain materials and building. For structure and safety, I send you to an engineer.',
    hinglish:
      'Main AI hoon. Main maal aur ghar banane ke baare mein batata hoon. Structure aur safety ke liye engineer ke paas bhejta hoon.',
  },
  underBox: {
    en: 'AI answers. Do not share your phone number or address here.',
    hinglish: 'AI jawab deta hai. Yahan apna phone number ya pata na likhein.',
  },
  nudge: {
    en: 'We sell these. You can buy them anywhere.',
    hinglish: 'Yeh maal hum bechte hain. Aap kahin se bhi le sakte hain.',
  },
  sourceLine: {
    en: 'From our guide: {title}. Checked by a civil engineer, {month}. General guide, not advice on your house.',
    hinglish:
      'Hamari guide se: {title}. Civil engineer ne check kiya, {month}. Yeh general guide hai, aapke ghar ki salah nahi.',
  },
  askShopWhatsApp: { en: 'Ask the shop on WhatsApp', hinglish: 'WhatsApp par dukaan se poochhein' },
} as const satisfies Record<string, Words>;

/** Reviewed starters, never generated. They exist to help, so they never invite a guess. */
export const advisorStarters = {
  home: [
    { en: 'What do I buy first?', hinglish: 'Pehle kya kharidun?' },
    {
      en: 'How do I check bricks before I pay?',
      hinglish: 'Paisa dene se pehle eent kaise check karun?',
    },
    { en: 'How do I store cement at site?', hinglish: 'Site par cement kaise rakhun?' },
  ],
  // Shows the honest answer to the commonest question, using the real fixed text.
  website: [
    {
      en: 'How much sariya do I need for a 1,000 sq ft slab?',
      hinglish: '1000 sq ft chhat mein kitna sariya lagega?',
    },
  ],
  product: [
    { en: 'How is this sold?', hinglish: 'Yeh kaise bikta hai?' },
    { en: 'How do I check this when it arrives?', hinglish: 'Aane par ise kaise check karun?' },
  ],
} as const satisfies Record<string, readonly Words[]>;

export const advisorWords = (key: AdvisorTextKey, language: AdvisorLanguage) =>
  advisorText[key][language];

/** "2027-03" as "March 2027", for "Checked by a civil engineer, March 2027". */
export function checkedMonth(checkedOn: string) {
  const [year, month] = checkedOn.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return '';
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}
