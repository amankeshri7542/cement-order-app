import type { AdvisorEvent, AdvisorProduct, AdvisorTurnView } from '@shiv/shared';

// The conversation on Ask, as plain data. It lives in memory while the app runs and goes on sign-out;
// nothing saves it on the phone. Plain logic, unit-tested under Node.

export type AskTurn = {
  clientTurnId: string;
  question: string;
  /** Sentences so far. They appear whole, with no typing effect. */
  sentences: string[];
  status: 'asking' | 'streaming' | 'done' | 'lost' | 'failed';
  turnId?: string;
  products: AdvisorProduct[];
  view?: AdvisorTurnView;
  replaced?: boolean;
  feedback?: 'HELPED' | 'NOT_RIGHT';
};

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** A new id for each question, reused if the network drops, so nothing runs or charges twice. */
export function newTurnId(random: () => number = Math.random) {
  let id = '';
  for (let i = 0; i < 24; i++) id += alphabet[Math.floor(random() * alphabet.length)];
  return id;
}

export const startTurn = (clientTurnId: string, question: string): AskTurn => ({
  clientTurnId,
  question,
  sentences: [],
  status: 'asking',
  products: [],
});

/** One event from the stream, applied. `done` carries the whole answer and is the last word. */
export function applyEvent(turn: AskTurn, event: AdvisorEvent): AskTurn {
  switch (event.type) {
    case 'status':
      return { ...turn, turnId: event.turnId, status: 'streaming' };
    case 'products':
      return { ...turn, products: event.products, status: 'streaming' };
    case 'text':
      return { ...turn, sentences: [...turn.sentences, event.text], status: 'streaming' };
    case 'replace':
      return { ...turn, sentences: [event.text], replaced: true, status: 'streaming' };
    case 'done':
      return finishTurn(turn, event.turn);
    default:
      return turn;
  }
}

export const finishTurn = (turn: AskTurn, view: AdvisorTurnView): AskTurn => ({
  ...turn,
  view,
  turnId: view.id,
  status: 'done',
  sentences: view.text ? [view.text] : turn.sentences,
  products: view.products,
});

/** Parses one block of the stream. Anything that is not a known event is left out. */
export function parseEvent(type: string, data: string | null | undefined): AdvisorEvent | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    return { ...parsed, type: parsed.type ?? type } as AdvisorEvent;
  } catch {
    return null;
  }
}

/** A limit stops the AI, and nothing breaks: articles and a way to the shop are shown instead. */
export const reachedLimit = (turn: AskTurn) => Boolean(turn.view?.limit);
/** The WhatsApp button shows only when the server gives a link, once a number is approved. */
export const askWhatsApp = (turn: AskTurn) => {
  const url = turn.view?.whatsappUrl;
  return url && url.startsWith('https://wa.me/') ? url : null;
};
