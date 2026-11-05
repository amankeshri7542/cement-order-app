import type { Prisma, WaDraft, WaSettings, WaThread } from '@prisma/client';
import { istToday } from '@shiv/shared';
import { normalizeAlias, type Catalog } from '../catalog-match';
import { getConfig } from '../config';
import { dayToDate, type Reading } from './reading';
import {
  decideReplies,
  noNoticeNeeded,
  renderReply,
  replyButtons,
  replyParams,
  type AiReplyKind,
  type CardFacts,
  type DraftMoment,
  type ReplyLanguage,
} from './replies';
import type { DraftAnswer } from './rules';

type Tx = Prisma.TransactionClient;
export type DraftLine = {
  rawText: string;
  productId: string | null;
  productName: string | null;
  quantity: number | null;
  unitWord: string | null;
  candidates: number;
  // Set when a person picked a size from the family's list.
  loadSizeId?: string | null;
  loadCount?: number | null;
};
const textLimit = 2000;
const repeatWindowMs = 2 * 3600000;
const afterTapWindowMs = 24 * 3600000;
const expiredWindowMs = 24 * 3600000;
const toldWindowMs = 30 * 60000;
// The first question is left time to be answered before anyone's phone buzzes (plan 07 section 5.1).
const questionWaitMs = 10 * 60000;
const handoffMs = 7 * 86400000;

export const linesOf = (draft: Pick<WaDraft, 'lines'>) => draft.lines as unknown as DraftLine[];
const lineKey = (line: DraftLine) => line.productId ?? `raw:${normalizeAlias(line.rawText)}`;
const linePrint = (line: DraftLine) => `${lineKey(line)}|${line.quantity}|${line.unitWord ?? ''}`;
export const sameLines = (a: DraftLine[], b: DraftLine[]) =>
  JSON.stringify(a.map(linePrint).sort()) === JSON.stringify(b.map(linePrint).sort());
/** "60 kar do" changes a line, "ACC bhi 10" adds one. Nothing here removes one. */
export function mergeLines(current: DraftLine[], incoming: DraftLine[]) {
  const merged = [...current];
  for (const line of incoming) {
    const at = merged.findIndex((row) => lineKey(row) === lineKey(line));
    if (at >= 0) merged[at] = line;
    else merged.push(line);
  }
  return merged.slice(0, 20);
}
const linesFrom = (reading: Reading): DraftLine[] =>
  reading.lines.map((line) => ({
    rawText: line.rawText,
    productId: line.productId,
    productName: line.productName,
    quantity: line.quantity,
    unitWord: line.unitWord,
    candidates: line.candidates,
  }));
const addWords = (before: string | null, text: string) =>
  (before ? `${before}\n${text}` : text).slice(0, textLimit);
/** Product ids and quantities only. The event log holds no customer's words. */
const eventLines = (lines: DraftLine[]) =>
  lines.map((line) => ({ productId: line.productId, quantity: line.quantity }));

export const draftJson = (lines: DraftLine[]) => lines as unknown as Prisma.InputJsonValue;
export async function draftEvent(
  tx: Tx,
  draft: { id: string; version: number },
  actorId: string,
  kind: string,
  lines?: DraftLine[],
) {
  await tx.waDraftEvent.create({
    data: {
      draftId: draft.id,
      version: draft.version,
      actorId,
      change: { kind, ...(lines ? { lines: eventLines(lines) } : {}) },
    },
  });
}

/** Lets the card's first alert go. Catalogue names only: a message cannot talk anyone into a tap. */
async function alertShop(tx: Tx, draft: WaDraft, asking: boolean) {
  if (getConfig().WA_MODE !== 'reply') return;
  const people = await tx.staffMembership.findMany({
    where: {
      endedAt: null,
      OR: [{ role: 'OWNER' }, { role: 'MANAGER', locationId: draft.locationId }],
    },
    select: { userId: true },
    distinct: ['userId'],
  });
  const lines = linesOf(draft).filter((line) => line.productId);
  await tx.notification.createMany({
    data: people.map(({ userId }) => ({
      userId,
      title: 'WhatsApp order',
      // Quantity and catalogue name only: a unit word comes from the message.
      body: lines.length
        ? lines
            .map((line) => [line.quantity, line.productName].filter(Boolean).join(' '))
            .join(', ')
            .slice(0, 120)
        : 'Khud padho',
      dedupeKey: `wa-draft:${draft.id}:${userId}`,
      sendAfter: asking ? new Date(Date.now() + questionWaitMs) : null,
    })),
    skipDuplicates: true,
  });
}
/** They answered, so nobody need wait for the timer. */
async function alertNow(tx: Tx, draftId: string) {
  await tx.notification.updateMany({
    where: { dedupeKey: { startsWith: `wa-draft:${draftId}:` }, pushedAt: null },
    data: { sendAfter: new Date() },
  });
}
/** Decided or gone: a buzz about it now would only confuse. */
export async function alertOff(tx: Tx, draftId: string) {
  await tx.notification.updateMany({
    where: { dedupeKey: { startsWith: `wa-draft:${draftId}:` }, pushedAt: null },
    data: { pushedAt: new Date() },
  });
}

export type ReadingOutcome = {
  moment: DraftMoment;
  papa: boolean;
  draft: WaDraft | null;
  card?: CardFacts;
};
/**
 * Puts what was read on the shop's card. A band only changes how the card looks: nothing here can
 * confirm, and the only statuses it writes are OPEN and CANCELLED.
 */
export async function applyReading(
  tx: Tx,
  input: {
    thread: Pick<WaThread, 'id' | 'phone' | 'savedName'>;
    reading: Reading | null;
    errorCode: string | null;
    reader: string;
    text: string;
    truncated: boolean;
    ids: string[];
    sentAt: Date;
    locationId: string;
  },
): Promise<ReadingOutcome> {
  const { thread, reading, errorCode, reader, text, truncated, ids, locationId } = input;
  const open = await tx.waDraft.findFirst({ where: { threadId: thread.id, status: 'OPEN' } });
  const papa = Boolean(open?.papaRepliedAt);
  const ordering =
    reading?.band !== 'RED' && (reading?.intent === 'ORDER' || reading?.intent === 'ORDER_CHANGE');
  const unclear = !reading || reading.band === 'RED';
  // After a person's tap the AI changes nothing, however clearly or unclearly it is asked.
  if (!open && reading?.intent === 'ORDER_CHANGE') {
    const decided = await tx.waDraft.findFirst({
      where: {
        threadId: thread.id,
        status: 'CONFIRMED',
        decidedAt: { gte: new Date(Date.now() - afterTapWindowMs) },
      },
      select: { id: true },
    });
    if (decided) return { moment: 'AFTER_TAP', papa: false, draft: null };
  }
  // A person reads this. The card holds the original words and nothing else needs doing.
  if (unclear) {
    const flags = [...new Set([...(reading?.flags ?? []), ...(errorCode ? ['NO_READING'] : [])])];
    if (open) {
      const draft = await tx.waDraft.update({
        where: { id: open.id },
        data: {
          originalText: addWords(open.originalText, text),
          truncated: open.truncated || truncated,
          flags: [...new Set([...open.flags, ...flags])],
          band: 'RED',
          messageIds: [...open.messageIds, ...ids],
          version: { increment: 1 },
        },
      });
      await draftEvent(tx, draft, 'whatsapp-ai', 'UNCLEAR');
      return { moment: 'OPEN', papa, draft };
    }
    const draft = await tx.waDraft.create({
      data: {
        threadId: thread.id,
        source: 'WHATSAPP',
        locationId,
        orderedByName: thread.savedName,
        orderedByPhone: thread.phone,
        originalText: text.slice(0, textLimit),
        truncated,
        lines: [],
        band: 'RED',
        flags,
        reader,
        readerError: errorCode,
        messageIds: ids,
      },
    });
    await draftEvent(tx, draft, 'whatsapp-ai', 'CREATED', []);
    return { moment: 'NEW', papa: false, draft };
  }
  if (!ordering) {
    if (open) return { moment: 'OPEN', papa, draft: open };
    const gone = await tx.waDraft.findFirst({
      where: {
        threadId: thread.id,
        status: 'EXPIRED',
        updatedAt: { gte: new Date(Date.now() - expiredWindowMs) },
      },
      select: { id: true },
    });
    return { moment: gone ? 'EXPIRED' : 'NONE', papa: false, draft: null };
  }
  const incoming = linesFrom(reading);
  if (open) {
    const current = linesOf(open);
    // Nothing new in the words at all: not a change, just the same message again.
    const lines = mergeLines(current, incoming);
    const same =
      sameLines(current, lines) &&
      (!reading.placeText || reading.placeText === open.placeText) &&
      (!reading.deliveryDate || reading.deliveryDate === open.deliveryDate) &&
      (reading.fulfilment === 'UNKNOWN' || reading.fulfilment === open.fulfilment);
    if (same) {
      const told = open.lastWaitingAt && Date.now() - open.lastWaitingAt.getTime() < toldWindowMs;
      if (told) return { moment: 'SAME_TOLD', papa, draft: open };
      const draft = await tx.waDraft.update({
        where: { id: open.id },
        data: { lastWaitingAt: new Date(), messageIds: [...open.messageIds, ...ids] },
      });
      return { moment: 'SAME', papa, draft };
    }
    const draft = await tx.waDraft.update({
      where: { id: open.id },
      data: {
        lines: draftJson(lines),
        originalText: addWords(open.originalText, text),
        truncated: open.truncated || truncated,
        placeText: reading.placeText || open.placeText,
        fulfilment: reading.fulfilment !== 'UNKNOWN' ? reading.fulfilment : open.fulfilment,
        dayKind: reading.dayKind !== 'UNSPECIFIED' ? reading.dayKind : open.dayKind,
        deliveryDate: reading.deliveryDate ?? open.deliveryDate,
        timeWish: reading.timeWish || open.timeWish,
        payerWords: reading.forWhom || open.payerWords,
        paymentWords: reading.paymentWords || open.paymentWords,
        // A customer's change is never green: a person looks again.
        band: 'AMBER',
        flags: [...new Set([...open.flags, ...reading.flags, 'CUSTOMER_CHANGED'])],
        messageIds: [...open.messageIds, ...ids],
        version: { increment: 1 },
      },
    });
    await draftEvent(tx, draft, 'whatsapp-ai', 'CUSTOMER_CHANGED', lines);
    await alertNow(tx, draft.id);
    return { moment: 'CHANGED', papa, draft, card: cardFacts(draft) };
  }
  const recent = await tx.waDraft.findFirst({
    where: {
      threadId: thread.id,
      status: 'CONFIRMED',
      decidedAt: { gte: new Date(Date.now() - afterTapWindowMs) },
    },
    orderBy: { decidedAt: 'desc' },
  });
  const repeat = Boolean(
    recent &&
    recent.decidedAt!.getTime() > Date.now() - repeatWindowMs &&
    sameLines(linesOf(recent), incoming),
  );
  const draft = await tx.waDraft.create({
    data: {
      threadId: thread.id,
      source: 'WHATSAPP',
      locationId,
      orderedByName: thread.savedName,
      orderedByPhone: thread.phone,
      payerWords: reading.forWhom,
      paymentWords: reading.paymentWords,
      originalText: text.slice(0, textLimit),
      truncated,
      lines: draftJson(incoming),
      placeText: reading.placeText,
      fulfilment: reading.fulfilment,
      dayKind: reading.dayKind,
      deliveryDate: reading.deliveryDate,
      timeWish: reading.timeWish,
      band: reading.band,
      flags: repeat ? [...reading.flags, 'MAYBE_REPEAT'] : reading.flags,
      reader,
      readerError: errorCode,
      messageIds: ids,
    },
  });
  await draftEvent(tx, draft, 'whatsapp-ai', 'CREATED', incoming);
  return { moment: repeat ? 'REPEAT' : 'NEW', papa: false, draft };
}
const cardFacts = (draft: WaDraft): CardFacts => ({
  lines: linesOf(draft).map((line) => ({ ...line, evidence: '', method: null })),
  placeText: draft.placeText,
  fulfilment: draft.fulfilment as CardFacts['fulfilment'],
  dayKind: draft.dayKind as CardFacts['dayKind'],
});

export type AnswerOutcome = { draft: WaDraft; kinds: AiReplyKind[] };
/** A tapped button or a short answer on an open draft. No model is involved. */
export async function applyAnswer(
  tx: Tx,
  open: WaDraft,
  answer: DraftAnswer,
  input: { text: string; ids: string[]; sentAt: Date; humanQuiet: boolean },
): Promise<AnswerOutcome> {
  const { text, ids, sentAt, humanQuiet } = input;
  const data: Prisma.WaDraftUpdateInput = {
    originalText: addWords(open.originalText, text),
    messageIds: [...open.messageIds, ...ids],
    version: { increment: 1 },
  };
  let reply: AiReplyKind[] = ['UPDATED'];
  switch (answer.kind) {
    case 'DAY':
      data.dayKind = answer.day;
      data.deliveryDate =
        answer.day === 'UNSPECIFIED'
          ? null
          : dayToDate({ kind: answer.day, weekday: null, date: null }, sentAt);
      data.asked = [...new Set([...open.asked, 'ASK_DAY'])];
      break;
    case 'PICKUP':
      data.fulfilment = 'PICKUP';
      data.asked = [...new Set([...open.asked, 'ASK_PLACE'])];
      break;
    case 'PLACE':
      data.placeText = answer.text;
      data.fulfilment = 'DELIVERY';
      data.asked = [...new Set([...open.asked, 'ASK_PLACE'])];
      break;
    case 'CHANGE':
      data.flags = [...new Set([...open.flags, 'CHANGE_ASKED'])];
      reply = ['AFTER_TAP'];
      break;
    case 'NEW_YES':
      data.flags = open.flags.filter((flag) => flag !== 'MAYBE_REPEAT');
      break;
    case 'NEW_NO':
    case 'CANCEL':
      // Papa may have told them something by hand. Only he closes what he answered.
      if (open.papaRepliedAt) data.flags = [...new Set([...open.flags, 'CANCEL_ASKED'])];
      else data.status = 'CANCELLED';
      reply = ['AFTER_TAP'];
      break;
  }
  const draft = await tx.waDraft.update({ where: { id: open.id }, data });
  await draftEvent(tx, draft, 'whatsapp-ai', `ANSWER_${answer.kind}`);
  if (draft.status === 'OPEN') await alertNow(tx, draft.id);
  else await alertOff(tx, draft.id);
  // Papa spoke here or is speaking: the card moved, and that is all.
  if (open.papaRepliedAt || humanQuiet) return { draft, kinds: [] };
  if (reply[0] === 'UPDATED' && draft.status === 'OPEN') {
    const next = decideReplies(
      {
        intent: 'ORDER_CHANGE',
        band: 'AMBER',
        flags: [],
        ...cardFacts(draft),
      } as unknown as Reading,
      {
        known: true,
        humanQuiet: false,
        freshRatePaise: null,
        failed: false,
        draft: 'CHANGED',
        asked: draft.asked,
        card: cardFacts(draft),
      },
    );
    return { draft, kinds: next.filter((kind) => kind !== 'UNKNOWN_ITEM') };
  }
  return { draft, kinds: reply };
}

/** Whether the shop has really sold to this person. An app sign-up alone does not make a customer. */
export async function knownCustomer(tx: Pick<Tx, 'order'>, userId: string | null) {
  if (!userId) return false;
  return (await tx.order.count({ where: { userId }, take: 1 })) > 0;
}
export function stageAllows(
  settings: Pick<WaSettings, 'replyStage' | 'testNumbers'>,
  phone: string | null,
  known: boolean,
) {
  if (!phone) return false;
  if (settings.replyStage === 'EVERYONE') return true;
  if (settings.testNumbers.includes(phone)) return settings.replyStage !== 'OFF';
  return settings.replyStage === 'KNOWN_CUSTOMERS' && known;
}

type Turn = { kinds: AiReplyKind[]; runId: string | null; triggerAt: Date | null };
const onceADay: readonly AiReplyKind[] = ['OFF_TOPIC', 'FORWARD'];
/**
 * Queues the fixed sentences for what was just decided. Writes nothing unless replies are on and
 * this person's stage has come. The sender looks at every rule again just before anything leaves.
 */
export async function planReplies(
  tx: Tx,
  input: Turn & {
    thread: Pick<WaThread, 'id' | 'phone' | 'userId' | 'noticeAt'> & { language: string };
    settings: WaSettings;
    draft: WaDraft | null;
    language: ReplyLanguage;
    catalog: Catalog;
    reading: Reading | null;
    quietReceipt: boolean;
  },
) {
  const c = getConfig();
  const { thread, settings, kinds, runId, triggerAt, draft, language, catalog, reading } = input;
  if (c.WA_MODE !== 'reply' || settings.replyStage === 'OFF' || !kinds.length) return;
  const known = await knownCustomer(tx, thread.userId);
  if (!stageAllows(settings, thread.phone, known)) return;
  const now = Date.now();
  if (runId && !kinds.includes('STOP_OK')) {
    const turns = await tx.waReply.findMany({
      where: {
        threadId: thread.id,
        class: 'AI_REPLY',
        runId: { not: null },
        status: { in: ['QUEUED', 'SENDING', 'SENT'] },
        createdAt: { gte: new Date(now - 86400000) },
      },
      select: { runId: true, createdAt: true },
      distinct: ['runId'],
    });
    const lastHour = turns.filter((turn) => turn.createdAt.getTime() > now - 3600000).length;
    // Also what ends a loop with another bot: past these the AI simply stops talking here.
    if (lastHour >= c.WA_REPLIES_PER_THREAD_HOUR || turns.length >= c.WA_REPLIES_PER_THREAD_DAY) {
      await tx.waReply.create({
        data: {
          threadId: thread.id,
          draftId: draft?.id ?? null,
          runId: null,
          dedupeKey: `cap:${runId}`,
          class: 'AI_REPLY',
          kind: kinds[0]!,
          language,
          status: 'SKIPPED',
          skipReason: 'REPLY_CAP',
        },
      });
      return;
    }
  }
  const out: AiReplyKind[] = [...kinds];
  const needsNotice = !thread.noticeAt && kinds.some((kind) => !noNoticeNeeded.includes(kind));
  if (needsNotice) out.unshift('NOTICE');
  const card = draft
    ? {
        lines: linesOf(draft),
        placeText: draft.placeText,
        deliveryDate: draft.deliveryDate,
      }
    : reading;
  const params = replyParams(card, catalog, c.WA_PRIVACY_URL);
  const day = istToday();
  for (const [index, kind] of out.entries()) {
    const body = renderReply(kind, language, params);
    const buttons = replyButtons(kind, language);
    const dedupeKey = onceADay.includes(kind)
      ? `${kind.toLowerCase()}:${thread.id}:${day}`
      : kind === 'NOTICE'
        ? `notice:${thread.id}:${runId ?? now}`
        : `ai:${runId ?? `${draft?.id}:${now}`}:${kind}`;
    await tx.waReply.createMany({
      data: {
        threadId: thread.id,
        draftId: draft?.id ?? null,
        runId,
        dedupeKey,
        class: 'AI_REPLY',
        kind,
        language,
        body: body.slice(0, 1024),
        ...(buttons.length ? { buttons } : {}),
        triggerAt,
        quietOk: input.quietReceipt,
        // The order they were decided in is the order they arrive in.
        createdAt: new Date(now + index),
      },
      skipDuplicates: true,
    });
  }
  if (needsNotice)
    await tx.waThread.update({ where: { id: thread.id }, data: { noticeAt: new Date() } });
  if (kinds.includes('HANDOFF'))
    await tx.waThread.update({
      where: { id: thread.id },
      data: { handoffUntil: new Date(now + handoffMs) },
    });
  if (draft?.status === 'OPEN') {
    const asked = kinds.filter((kind) => kind.startsWith('ASK_'));
    if (asked.length)
      await tx.waDraft.update({
        where: { id: draft.id },
        data: { asked: [...new Set([...draft.asked, ...asked])] },
      });
  }
}
/** The card's first alert. Waits a little when a question has just been put to the customer. */
export async function alertNewDraft(tx: Tx, draft: WaDraft, kinds: AiReplyKind[]) {
  await alertShop(
    tx,
    draft,
    kinds.some((kind) => kind.startsWith('ASK_')),
  );
}
