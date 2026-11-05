import type { Prisma } from '@prisma/client';
import { money, type RefusalReason } from '@shiv/shared';
import type { ReplyLanguage } from './replies';

/**
 * The only sentences that say an order is confirmed or refused. They are kept away from the AI
 * side on purpose: reading and replying never import this file, and the database refuses one of
 * these without a person's name on it.
 */
export type DecisionKind = 'CONFIRMED' | 'CONFIRMED_CHANGED' | 'REFUSED';

type ConfirmedFacts = { number: string; lines: string; totalPaise: number; day: string };
type RefusedFacts = { reason: RefusalReason; note?: string | undefined };
export type DecisionFacts =
  | ({ kind: 'CONFIRMED' | 'CONFIRMED_CHANGED' } & ConfirmedFacts)
  | ({ kind: 'REFUSED' } & RefusedFacts);

const reasonWords: Record<Exclude<RefusalReason, 'OTHER'>, Record<ReplyLanguage, string>> = {
  OUT_OF_STOCK: {
    hinglish: 'maal abhi nahi hai',
    hindi: 'माल अभी नहीं है',
    english: 'the goods are not here right now',
  },
  NO_DELIVERY: {
    hinglish: 'is jagah delivery abhi nahi hai',
    hindi: 'इस जगह डिलीवरी अभी नहीं है',
    english: 'we cannot deliver there right now',
  },
  RATE_DIFFERENT: {
    hinglish: 'rate alag hai, dukaan se baat karein',
    hindi: 'रेट अलग है, दुकान से बात करें',
    english: 'the rate is different, please talk to the shop',
  },
  NO_CREDIT: {
    hinglish: 'udhaar abhi nahi ho payega',
    hindi: 'उधार अभी नहीं हो पाएगा',
    english: 'credit is not possible right now',
  },
};
// One plain line, as it also goes into a template value.
const oneLine = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/[^\P{C}\u200C\u200D]/gu, '')
    .trim()
    .slice(0, 120);
const reasonIn = (facts: RefusedFacts, language: ReplyLanguage) =>
  facts.reason === 'OTHER'
    ? oneLine(facts.note ?? '') || '-'
    : [reasonWords[facts.reason][language], oneLine(facts.note ?? '')].filter(Boolean).join('. ');

export function renderDecision(facts: DecisionFacts, language: ReplyLanguage) {
  if (facts.kind === 'REFUSED') {
    const reason = reasonIn(facts, language);
    return {
      hinglish: `Maaf kijiye, yeh order abhi nahi ho payega: ${reason}. Kuch poochhna ho to yahin likhein.`,
      hindi: `माफ़ कीजिए, यह ऑर्डर अभी नहीं हो पाएगा: ${reason}। कुछ पूछना हो तो यहीं लिखें।`,
      english: `Sorry, this order cannot be done right now: ${reason}. If you have a question, write here.`,
    }[language];
  }
  const { number, lines, day } = facts;
  const total = money(facts.totalPaise);
  if (facts.kind === 'CONFIRMED')
    return {
      hinglish: `Pakka. Dukaan ne aapka order ${number} pakka kiya. ${lines}. Total ${total}. Din: ${day}.`,
      hindi: `पक्का। दुकान ने आपका ऑर्डर ${number} पक्का किया। ${lines}। कुल ${total}। दिन: ${day}।`,
      english: `Confirmed. The shop confirmed your order ${number}. ${lines}. Total ${total}. Day: ${day}.`,
    }[language];
  return {
    hinglish: `Dukaan ne badlav ke saath pakka kiya: ${lines}. Order ${number}. Total ${total}. Din: ${day}.`,
    hindi: `दुकान ने बदलाव के साथ पक्का किया: ${lines}। ऑर्डर ${number}। कुल ${total}। दिन: ${day}।`,
    english: `The shop confirmed with changes: ${lines}. Order ${number}. Total ${total}. Day: ${day}.`,
  }[language];
}

/** Outside the 24-hour window only an approved template can go. Values hold one plain line each. */
export function decisionTemplate(facts: DecisionFacts, language: ReplyLanguage) {
  if (facts.kind === 'REFUSED')
    return { name: 'shiv_order_refused_v1', params: [reasonIn(facts, language)] };
  return {
    name: 'shiv_order_confirmed_v1',
    params: [facts.number, oneLine(facts.lines), money(facts.totalPaise), oneLine(facts.day)],
  };
}

/**
 * Queues what a person decided. Called only from the card's own confirm and refuse, inside the
 * same transaction as the decision. It refuses to run without a person, and so does the database.
 */
export async function enqueueDecision(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    threadId: string;
    draftId: string;
    language: ReplyLanguage;
    facts: DecisionFacts;
  },
) {
  if (!input.actorId) throw new Error('A decision needs the person who took it.');
  const template = decisionTemplate(input.facts, input.language);
  await tx.waReply.create({
    data: {
      threadId: input.threadId,
      draftId: input.draftId,
      dedupeKey: `decision:${input.draftId}`,
      class: 'HUMAN_DECISION',
      actorId: input.actorId,
      kind: input.facts.kind,
      language: input.language,
      body: renderDecision(input.facts, input.language).slice(0, 1024),
      template: template.name,
      templateParams: template.params,
    },
  });
}
