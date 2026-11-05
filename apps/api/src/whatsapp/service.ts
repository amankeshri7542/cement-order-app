import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type WaSettings } from '@prisma/client';
import { istToday, waGate } from '@shiv/shared';
import { loadCatalog, normalizeAlias, type Catalog } from '../catalog-match';
import { getConfig } from '../config';
import { Db } from '../db';
import { errorCause, hash, MAIN_LOCATION } from '../http';
import {
  alertNewDraft,
  alertOff,
  applyAnswer,
  applyReading,
  linesOf,
  planReplies,
  type ReadingOutcome,
} from './draft-core';
import type { WaEvent } from './provider';
import { WaReader, promptVersion, type ReaderAnswer } from './reader';
import { finishReading, type ReaderOutput, type Reading } from './reading';
import { decideReplies, isOwnWords, type AiReplyKind } from './replies';
import {
  hasTradeWord,
  isHumanAsk,
  isOnlyChat,
  isStop,
  languageOf,
  readByRules,
  readDraftAnswer,
} from './rules';

const textLimit = 2000;
const rateFreshMs = 3 * 86400000;
const log = (event: string, details: Record<string, unknown> = {}) =>
  console.warn(JSON.stringify({ event, ...details, timestamp: new Date().toISOString() }));

export const maskedContact = (phone: string | null) =>
  phone ? `…${phone.slice(-4)}` : 'Number nahi mila';
const cleanName = (name: string) => cleanWords(cleanWords(name).trim().slice(0, 60));
// Control and direction characters go, and any half of an emoji left by cutting. The joiners stay,
// as Hindi needs them.
export const cleanWords = (text: string) => text.replace(/[^\P{C}\n\t\u200C\u200D]/gu, ' ');
const messagesPerRead = 50;
const retryAfterMs = 300_000;
const wordsNotKept = ['PERSONAL_OR_SUPPLIER', 'CHAT', 'OFF_TOPIC'];
// The partner retries for up to 7 days. Older than that is someone replaying an old delivery.
const oldestMessageMs = 8 * 86400000;

export type WholeReading = {
  answer: Pick<
    ReaderAnswer,
    'reader' | 'inputTokens' | 'outputTokens' | 'costMicroUsd' | 'latencyMs'
  >;
  errorCode: string | null;
  reading: Reading | null;
  replies: AiReplyKind[];
  /** The shop's list rate for the item asked about, if fresh enough to say. */
  ratePaise: number | null;
};

/**
 * Reads the shop's WhatsApp. Nothing in this module can send anything: it has no sender. It only
 * writes rows, and sender.ts decides at the last moment whether a queued reply may go.
 */
@Injectable()
export class WaService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(WaReader) private reader: WaReader,
  ) {}

  /** Read on every delivery, so it takes no lock unless the row is really missing. */
  async settings() {
    const found = await this.db.waSettings.findUnique({ where: { id: 'wa' } });
    if (found) return found;
    // A burst can arrive with the row missing, and only one of them can make it.
    await this.db.waSettings.createMany({ data: { id: 'wa' }, skipDuplicates: true });
    return this.db.waSettings.findUniqueOrThrow({ where: { id: 'wa' } });
  }

  /** Stores what arrived. Quick and with no outside calls, as the partner waits on the answer. */
  async ingest(events: WaEvent[]) {
    let stored = 0;
    const settings = await this.settings();
    for (const event of events) {
      // WhatsApp sends these for every message, so they stay out of a serializable transaction.
      if (event.kind === 'status') await applyStatus(this.db, event);
      else if (await this.db.atomic((tx) => this.ingestOne(tx, event, settings))) stored++;
    }
    // Delivery reports come in bursts. A minute is close enough for "last heard from".
    await this.db.waSettings.updateMany({
      where: {
        id: 'wa',
        OR: [{ lastWebhookAt: null }, { lastWebhookAt: { lt: new Date(Date.now() - 60_000) } }],
      },
      data: { lastWebhookAt: new Date() },
    });
    return stored;
  }

  private async ingestOne(
    tx: Prisma.TransactionClient,
    event: Exclude<WaEvent, { kind: 'status' }>,
    settings: WaSettings,
  ) {
    const c = getConfig();
    const { aiPaused } = settings;
    if (event.kind === 'account') {
      await tx.waSettings.update({ where: { id: 'wa' }, data: { lastAccount: event.event } });
      await tx.auditLog.create({
        data: {
          actorId: 'whatsapp',
          event: 'WA_ACCOUNT_EVENT',
          entityId: 'wa',
          details: { event: event.event },
        },
      });
      return false;
    }
    // WhatsApp's message ids can carry the sender's number, so only their hash is kept.
    const key = hash(event.wamid);
    if (event.kind === 'revoke') {
      const message = await tx.waMessage.findUnique({ where: { wamid: key } });
      if (!message) return false;
      await forgetDraftWords(tx, message.id);
      await tx.waMessage.update({
        where: { id: message.id },
        data: { text: null, truncated: false, revokedAt: new Date(), state: 'GATED' },
      });
      await forgetReadings(tx, message.id);
      return true;
    }
    if (event.kind === 'edit') {
      const message = await tx.waMessage.findUnique({
        where: { wamid: key },
        include: { thread: { select: { aiMode: true } } },
      });
      // Words that were never to be kept do not come back through an edit.
      if (!message || message.direction !== 'IN' || message.state === 'GATED') return false;
      const raw = event.text ? cleanWords(event.text).trim() : '';
      const text = cleanWords(raw.slice(0, textLimit));
      if (text && text === message.text) return false;
      await forgetReadings(tx, message.id);
      const keep = !aiPaused && message.thread.aiMode === 'AUTO' && text;
      await tx.waMessage.update({
        where: { id: message.id },
        data: {
          text: keep ? text : null,
          truncated: keep ? raw.length > textLimit : false,
          state: keep ? 'RECEIVED' : 'GATED',
          editedAt: new Date(),
        },
      });
      if (keep)
        await tx.waThread.update({
          where: { id: message.threadId },
          data: { nextRunAt: new Date(Date.now() + c.WA_BURST_WAIT_SECONDS * 1000) },
        });
      return true;
    }
    // The shop's own number is not a contact, and a message with nobody on it has nowhere to go.
    if ((!event.phone && !event.bsuid) || event.phone === c.WA_BUSINESS_PHONE) return false;
    const now = new Date();
    if (now.getTime() - event.sentAt.getTime() > oldestMessageMs) return false;
    // A clock ahead of ours must not hold a chat quiet, or an answer open, for longer than it should.
    const sentAt = event.sentAt > now ? now : event.sentAt;
    if (await tx.waMessage.findUnique({ where: { wamid: key }, select: { id: true } }))
      return false;
    const person = event.phone
      ? await tx.user.findUnique({
          where: { phone: event.phone },
          select: { id: true, role: true, name: true },
        })
      : null;
    // A family test phone may belong to staff. It is on the list to be read and answered.
    const staff = person?.role === 'ADMIN' && !settings.testNumbers.includes(event.phone ?? '');
    const thread = await threadFor(tx, event.phone, event.bsuid, {
      userId: !staff ? (person?.id ?? null) : null,
      savedName: person?.name ?? '',
      profileName: event.kind === 'inbound' ? cleanName(event.profileName) : '',
    });
    if (event.kind === 'echo') {
      // Only a signed echo says Papa typed. Our own reply coming back through the partner does not.
      if (await tx.waReply.findFirst({ where: { providerId: key }, select: { id: true } }))
        return false;
      await tx.waMessage.create({
        data: {
          wamid: key,
          threadId: thread.id,
          direction: 'ECHO',
          type: event.type,
          state: 'READ',
          sentAt,
        },
      });
      // Echoes can arrive out of order. An old one must never shorten the quiet of a newer one.
      const until = new Date(sentAt.getTime() + settings.quietMinutes * 60000);
      // What was queued for a message he has now answered stays unsaid.
      await tx.waReply.updateMany({
        where: {
          threadId: thread.id,
          class: 'AI_REPLY',
          status: 'QUEUED',
          OR: [{ triggerAt: null }, { triggerAt: { lte: sentAt } }],
        },
        data: { status: 'SKIPPED', skipReason: 'PAPA_TYPED', body: null },
      });
      const introduced = await tx.waReply.count({
        where: {
          threadId: thread.id,
          kind: 'NOTICE',
          status: { in: ['QUEUED', 'SENDING', 'SENT'] },
        },
      });
      await tx.waThread.update({
        where: { id: thread.id },
        data: {
          lastEchoAt: thread.lastEchoAt && thread.lastEchoAt > sentAt ? thread.lastEchoAt : sentAt,
          humanUntil: thread.humanUntil && thread.humanUntil > until ? thread.humanUntil : until,
          ...(introduced ? {} : { noticeAt: null }),
        },
      });
      // He answered this draft himself: it now waits on the daily list, and never expires.
      await tx.waDraft.updateMany({
        where: {
          threadId: thread.id,
          status: 'OPEN',
          papaRepliedAt: null,
          // Echo times have only whole seconds, so the same second counts as after.
          createdAt: { lte: new Date(sentAt.getTime() + 999) },
        },
        data: { papaRepliedAt: sentAt },
      });
      return true;
    }
    const raw = event.text ? cleanWords(event.text).trim() : '';
    const flooded =
      (await tx.waMessage.count({
        where: {
          threadId: thread.id,
          direction: 'IN',
          receivedAt: { gte: new Date(now.getTime() - 3600000) },
        },
      })) >= c.WA_THREAD_MESSAGES_PER_HOUR;
    // Voice and photos are not read yet, so nothing of them is kept.
    const readable = event.type === 'text' || event.type === 'button';
    const keep = !aiPaused && !staff && thread.aiMode === 'AUTO' && readable && raw && !flooded;
    await tx.waMessage.create({
      data: {
        wamid: key,
        threadId: thread.id,
        direction: 'IN',
        // A flood is not evidence the reader stays silent on personal chats, so it counts apart.
        type: flooded ? 'flood' : event.type,
        text: keep ? cleanWords(raw.slice(0, textLimit)) : null,
        truncated: keep ? raw.length > textLimit : false,
        state: keep ? 'RECEIVED' : 'GATED',
        sentAt,
      },
    });
    await tx.waThread.update({
      where: { id: thread.id },
      data: {
        lastInboundAt:
          thread.lastInboundAt && thread.lastInboundAt > sentAt ? thread.lastInboundAt : sentAt,
        ...(keep ? { nextRunAt: new Date(Date.now() + c.WA_BURST_WAIT_SECONDS * 1000) } : {}),
      },
    });
    return true;
  }

  /** Reads the threads whose messages have stopped arriving. Called by the worker. */
  async runDue(limit = 8) {
    if (getConfig().WA_MODE === 'off') return 0;
    const now = new Date();
    // Times are stored as UTC with no zone, so they go in the same way, whatever the server's zone.
    const at = now.toISOString();
    const lease = new Date(now.getTime() + 120_000).toISOString();
    const claimed = await this.db.$queryRaw<{ id: string }[]>`
      UPDATE "WaThread" SET "leaseUntil" = ${lease}::timestamp
      WHERE "id" IN (
        SELECT "id" FROM "WaThread"
        WHERE "nextRunAt" <= ${at}::timestamp
          AND ("leaseUntil" IS NULL OR "leaseUntil" < ${at}::timestamp)
        ORDER BY "nextRunAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"`;
    for (const { id } of claimed) {
      try {
        await this.readThread(id, now);
      } catch (error) {
        log('WA_READ_FAILED', { thread: id, ...errorCause(error) });
        // Not at once: whatever went wrong must not turn into a paid call every few seconds.
        await this.db.waThread.update({
          where: { id },
          data: { leaseUntil: null, nextRunAt: new Date(Date.now() + retryAfterMs) },
        });
      }
    }
    return claimed.length;
  }

  private async readThread(id: string, startedAt: Date) {
    // Each read gets its own full lease, however long the ones before it took.
    await this.db.waThread.update({
      where: { id },
      data: { leaseUntil: new Date(Date.now() + 120_000) },
    });
    const thread = await this.db.waThread.findUniqueOrThrow({
      where: { id },
      include: {
        messages: {
          where: { direction: 'IN', state: 'RECEIVED' },
          orderBy: { sentAt: 'asc' },
          take: messagesPerRead,
        },
      },
    });
    const { messages } = thread;
    // A message that arrived during this read keeps its turn, and so do any past this batch.
    const finish = async (retryAt?: Date) => {
      await this.db.waThread.updateMany({
        where: { id, nextRunAt: { lte: startedAt } },
        data: {
          nextRunAt: retryAt ?? (messages.length === messagesPerRead ? new Date() : null),
        },
      });
      await this.db.waThread.update({ where: { id }, data: { leaseUntil: null } });
    };
    if (!messages.length) return finish();
    const ids = messages.map((message) => message.id);
    const gate = (tx: Prisma.TransactionClient) =>
      tx.waMessage.updateMany({
        where: { id: { in: ids } },
        data: { text: null, truncated: false, state: 'GATED' },
      });
    const { aiPaused } = await this.settings();
    if (aiPaused || thread.aiMode !== 'AUTO') {
      await this.db.atomic(gate);
      return finish();
    }
    const joined = messages.map((message) => message.text ?? '').join('\n');
    const text = cleanWords(joined.slice(0, textLimit));
    const truncated = joined.length > textLimit || messages.some((message) => message.truncated);
    const known = Boolean(thread.userId);
    const catalog = await loadCatalog(this.db);
    const sentAt = messages.at(-1)!.sentAt;
    const language = languageOf(text, normalizeAlias(text).split(' '));
    // These stop here, with no model and no words kept. STOP counts anywhere in a burst.
    if (messages.some((message) => isStop(message.text ?? ''))) {
      await this.db.atomic(async (tx) => {
        await gate(tx);
        const settings = await tx.waSettings.findUniqueOrThrow({ where: { id: 'wa' } });
        await tx.waThread.update({ where: { id }, data: { aiMode: 'OPTED_OUT' } });
        const run = await tx.waReaderRun.create({
          data: {
            threadId: id,
            messageIds: ids,
            reader: 'rules',
            promptVersion,
            wouldReply: 'STOP_OK',
          },
        });
        await tx.waReply.updateMany({
          where: { threadId: id, status: 'QUEUED', class: 'AI_REPLY' },
          data: { status: 'SKIPPED', skipReason: 'OPTED_OUT', body: null },
        });
        await planReplies(tx, {
          thread,
          settings,
          kinds: ['STOP_OK'],
          runId: run.id,
          triggerAt: sentAt,
          draft: null,
          language,
          catalog,
          reading: null,
          quietReceipt: true,
        });
      });
      return finish();
    }
    // Our own sentences coming back are another bot, or a copy. Nothing to read, nothing to say.
    if (isOwnWords(text)) {
      await this.db.atomic(gate);
      return finish();
    }
    // A tapped button or a short answer on an open draft needs no model, and a stranger can give one.
    const open = await this.db.waDraft.findFirst({ where: { threadId: id, status: 'OPEN' } });
    const repeatNo = open?.flags.includes('MAYBE_REPEAT') && normalizeAlias(text) === 'nahi';
    const answer = repeatNo ? ({ kind: 'NEW_NO' } as const) : readDraftAnswer(text, catalog);
    // "Cancel" after a person's tap changes nothing, and neither does editing the message that
    // order came from. They hear only that the shop will answer.
    const cancelAfterTap =
      !open &&
      (answer?.kind === 'CANCEL' || answer?.kind === 'CHANGE') &&
      Boolean(
        await this.db.waDraft.findFirst({
          where: {
            threadId: id,
            status: 'CONFIRMED',
            decidedAt: { gte: new Date(startedAt.getTime() - 86400000) },
          },
          select: { id: true },
        }),
      );
    const editedAfterTap =
      messages.some((message) => message.editedAt) &&
      Boolean(
        await this.db.waDraft.findFirst({
          where: { threadId: id, status: 'CONFIRMED', messageIds: { hasSome: ids } },
          select: { id: true },
        }),
      );
    const afterTap = cancelAfterTap || editedAfterTap;
    if (afterTap || (answer && open)) {
      let again = false;
      await this.db.atomic(async (tx) => {
        const current = await tx.waThread.findUnique({ where: { id } });
        const settings = await tx.waSettings.findUniqueOrThrow({ where: { id: 'wa' } });
        if (!current || current.aiMode !== 'AUTO' || settings.aiPaused) return gate(tx);
        const rows = await tx.waMessage.findMany({
          where: { id: { in: ids } },
          select: { id: true, state: true, text: true },
        });
        const unchanged = messages.every((message) => {
          const row = rows.find((other) => other.id === message.id);
          return row?.state === 'RECEIVED' && row.text === message.text;
        });
        const stillOpen = await tx.waDraft.findFirst({ where: { threadId: id, status: 'OPEN' } });
        if (!unchanged || (!afterTap && !stillOpen)) {
          again = rows.some((row) => row.state === 'RECEIVED');
          return;
        }
        await tx.waMessage.updateMany({ where: { id: { in: ids } }, data: { state: 'READ' } });
        const humanQuiet = Boolean(current.humanUntil && current.humanUntil > startedAt);
        const handedOff = Boolean(current.handoffUntil && current.handoffUntil > startedAt);
        const outcome =
          !afterTap && stillOpen && answer
            ? await applyAnswer(tx, stillOpen, answer, { text, ids, sentAt, humanQuiet })
            : { draft: null, kinds: humanQuiet ? [] : (['AFTER_TAP'] as AiReplyKind[]) };
        const kinds = handedOff ? [] : outcome.kinds;
        const run = await tx.waReaderRun.create({
          data: {
            threadId: id,
            messageIds: ids,
            reader: 'rules',
            promptVersion,
            intent: 'ORDER_CHANGE',
            wouldReply: kinds.join('+') || null,
          },
        });
        await planReplies(tx, {
          thread: current,
          settings,
          kinds,
          runId: run.id,
          triggerAt: sentAt,
          draft: outcome.draft,
          language: current.language as typeof language,
          catalog,
          reading: null,
          quietReceipt: false,
        });
      });
      return finish(again ? new Date() : undefined);
    }
    // Someone already talking to the shop about an order need not name the trade every time.
    const talking = Boolean(open) || Boolean(thread.noticeAt);
    const asksForShop = talking && isHumanAsk(text);
    if (isOnlyChat(text) || (!known && !talking && !hasTradeWord(text, catalog) && !asksForShop)) {
      await this.db.atomic(gate);
      return finish();
    }
    const whole = await this.readText(text, {
      catalog,
      sentAt,
      truncated,
      known,
      humanQuiet: Boolean(thread.humanUntil && thread.humanUntil > startedAt),
      subject: id,
    });
    // Busy is not a verdict on the message: it simply waits its turn.
    if (whole.errorCode === 'READER_BUSY') return finish(new Date(Date.now() + 15_000));
    let again = false;
    await this.db.atomic(async (tx) => {
      // The read took a while. Anything said since then about this number wins over it.
      const now = await tx.waThread.findUnique({ where: { id } });
      const settings = await tx.waSettings.findUnique({ where: { id: 'wa' } });
      if (!now || now.aiMode !== 'AUTO' || !settings || settings.aiPaused) {
        await gate(tx);
        return;
      }
      const current = await tx.waMessage.findMany({
        where: { id: { in: ids } },
        select: { id: true, state: true, text: true },
      });
      const unchanged = messages.every((message) => {
        const row = current.find((other) => other.id === message.id);
        return row?.state === 'RECEIVED' && row.text === message.text;
      });
      if (!unchanged) {
        again = current.some((row) => row.state === 'RECEIVED');
        return;
      }
      // Family and chat are not the shop's business: the count stays, the words do not.
      const notOurs = whole.reading && wordsNotKept.includes(whole.reading.intent);
      await tx.waMessage.updateMany({
        where: { id: { in: ids } },
        data: notOurs ? { text: null, truncated: false, state: 'GATED' } : { state: 'READ' },
      });
      // Papa may have typed while the model was thinking, so this is read again here.
      const humanQuiet = Boolean(now.humanUntil && now.humanUntil > startedAt);
      const outcome: ReadingOutcome = notOurs
        ? { moment: 'NONE', papa: false, draft: null }
        : await applyReading(tx, {
            thread: now,
            reading: whole.reading,
            errorCode: whole.errorCode,
            reader: whole.answer.reader,
            text,
            truncated,
            ids,
            sentAt,
            locationId: MAIN_LOCATION,
          });
      const kinds = decideReplies(whole.reading, {
        known,
        humanQuiet,
        freshRatePaise: whole.ratePaise,
        failed: Boolean(whole.errorCode),
        draft: outcome.moment,
        papa: outcome.papa,
        handedOff: Boolean(now.handoffUntil && now.handoffUntil > startedAt),
        asked: outcome.draft?.asked ?? [],
        ...(outcome.card ? { card: outcome.card } : {}),
      });
      const run = await tx.waReaderRun.create({
        data: {
          threadId: id,
          messageIds: ids,
          reader: whole.answer.reader,
          promptVersion,
          inputTokens: whole.answer.inputTokens,
          outputTokens: whole.answer.outputTokens,
          costMicroUsd: whole.answer.costMicroUsd,
          latencyMs: whole.answer.latencyMs,
          ...(whole.reading && !notOurs
            ? { output: whole.reading as unknown as Prisma.InputJsonValue }
            : {}),
          intent: whole.reading?.intent ?? null,
          band: notOurs ? null : (whole.reading?.band ?? 'RED'),
          wouldReply: kinds.join('+') || null,
          errorCode: whole.errorCode,
        },
      });
      const replyLanguage = whole.reading?.language ?? language;
      await tx.waThread.update({ where: { id }, data: { language: replyLanguage } });
      await planReplies(tx, {
        thread: now,
        settings,
        kinds,
        runId: run.id,
        triggerAt: sentAt,
        draft: outcome.draft,
        language: replyLanguage,
        catalog,
        reading: whole.reading,
        // Decision 8: while the chat is quiet, only the receipt for a new order may go.
        quietReceipt: humanQuiet && outcome.moment === 'NEW' && kinds.includes('DRAFT'),
      });
      if (outcome.moment === 'NEW' && outcome.draft) await alertNewDraft(tx, outcome.draft, kinds);
    });
    return finish(again ? new Date() : undefined);
  }

  /** The whole decision for some words: plain rules first, then the model within its limits. */
  async readText(
    text: string,
    options: {
      catalog: Catalog;
      sentAt: Date;
      truncated: boolean;
      known: boolean;
      humanQuiet: boolean;
      subject: string;
    },
  ): Promise<WholeReading> {
    const c = getConfig();
    const { catalog, sentAt, truncated, known, humanQuiet, subject } = options;
    const byRules = readByRules(text, catalog);
    let output: ReaderOutput | null = byRules;
    let answer: WholeReading['answer'] = {
      reader: 'rules',
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
      latencyMs: 0,
    };
    let errorCode: string | null = null;
    if (!output) {
      const read = await this.reader.read(text, catalog, subject);
      output = read.output;
      errorCode = read.errorCode;
      answer = read;
      if (errorCode) log('WA_READER_NO_ANSWER', { code: errorCode });
    }
    const reading = output
      ? finishReading(output, {
          catalog,
          text,
          sentAt,
          truncated,
          bigOrderPaise: c.WA_BIG_ORDER_PAISE,
        })
      : null;
    const first = reading?.lines[0];
    const asked =
      first?.productId && first.method ? catalog.products.get(first.productId) : undefined;
    const fresh =
      asked && sentAt.getTime() - asked.priceUpdatedAt.getTime() < rateFreshMs
        ? asked.pricePaise
        : null;
    return {
      answer,
      errorCode,
      reading,
      ratePaise: fresh,
      replies: decideReplies(reading, {
        known,
        humanQuiet,
        freshRatePaise: fresh,
        failed: Boolean(errorCode),
      }),
    };
  }

  /** Clears everything past its time. Only the counts the gate needs are left. */
  async purge() {
    const c = getConfig();
    const cutoff = new Date(Date.now() - c.WA_TEXT_RETENTION_DAYS * 86400000);
    // Switched off with messages waiting: nothing will ever read them.
    if (c.WA_MODE === 'off')
      await this.db.waMessage.updateMany({
        where: { state: 'RECEIVED' },
        data: { text: null, truncated: false, state: 'GATED' },
      });
    const old = await this.db.waMessage.findMany({
      where: { receivedAt: { lt: cutoff } },
      select: { id: true },
      take: 500,
    });
    if (old.length)
      await this.db.waMessage.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
    const runs = await this.db.waReaderRun.findMany({
      where: { output: { not: Prisma.AnyNull }, createdAt: { lt: cutoff } },
      select: { id: true },
      take: 500,
    });
    if (runs.length)
      await this.db.waReaderRun.updateMany({
        where: { id: { in: runs.map((row) => row.id) } },
        data: { output: Prisma.DbNull },
      });
    await this.db.waReply.deleteMany({ where: { createdAt: { lt: cutoff } } });
    await this.db.waDraft.deleteMany({
      where: { status: { not: 'OPEN' }, createdAt: { lt: cutoff } },
    });
    // A draft Papa answered never expires, but the customer's words still have their time.
    const stale = await this.db.waDraft.findMany({
      where: { status: 'OPEN', createdAt: { lt: cutoff }, originalText: { not: null } },
      take: 200,
    });
    for (const draft of stale)
      await this.db.waDraft.update({
        where: { id: draft.id },
        data: {
          originalText: null,
          payerWords: '',
          paymentWords: '',
          lines: linesOf(draft).map((line) => ({
            ...line,
            rawText: '',
          })) as unknown as Prisma.InputJsonValue,
        },
      });
    // A number nobody chose to keep leaves with its last message. Numbers marked off stay listed.
    const quiet = await this.db.waThread.findMany({
      where: {
        aiMode: 'AUTO',
        contactKey: { not: { startsWith: 'gone:' } },
        updatedAt: { lt: cutoff },
        messages: { none: {} },
        replies: { none: {} },
        drafts: { none: {} },
      },
      select: { id: true, _count: { select: { runs: true } } },
      take: 200,
    });
    for (const thread of quiet) {
      if (thread._count.runs)
        await this.db.waThread.update({
          where: { id: thread.id },
          data: goneThread(thread.id),
        });
      else await this.db.waThread.delete({ where: { id: thread.id } });
    }
  }

  /** How the reading is doing against the gate for going live. Counts only, no words. */
  async gate() {
    const rows = await this.db.waReaderRun.groupBy({
      by: ['review', 'band', 'intent'],
      // A practice reader's marks say nothing about real messages.
      where: { review: { not: null }, reader: { not: 'fake' } },
      _count: { _all: true },
    });
    const count = (test: (row: (typeof rows)[number]) => boolean) =>
      rows.filter(test).reduce((sum, row) => sum + row._count._all, 0);
    const read = (row: (typeof rows)[number]) => row.review !== 'MISSED_ORDER';
    const percent = (part: number, whole: number) =>
      whole ? Math.floor((part * 1000) / whole) / 10 : null;
    const reviewed = count(read);
    const green = count((row) => read(row) && row.band === 'GREEN');
    const orders = count((row) => read(row) && row.intent === 'ORDER');
    const ordersSeen = count(
      (row) => row.intent === 'ORDER' && (row.review === 'RIGHT' || row.review === 'WRONG_LINES'),
    );
    const missed = count((row) => row.review === 'MISSED_ORDER');
    const personal = await this.db.waReaderRun.findMany({
      where: {
        reader: { not: 'fake' },
        OR: [{ review: 'SHOULD_BE_SILENT' }, { intent: { in: wordsNotKept } }],
      },
      select: { wouldReply: true },
      orderBy: { createdAt: 'desc' },
      take: waGate.personalWindow,
    });
    // A message dropped unread got no answer, by construction, so it counts as checked too.
    const dropped = await this.db.waMessage.count({
      where: { direction: 'IN', state: 'GATED', type: 'text' },
    });
    const numbers = {
      reviewed,
      intentPercent: percent(
        count((row) => read(row) && !['WRONG_INTENT', 'SHOULD_BE_SILENT'].includes(row.review!)),
        reviewed,
      ),
      greenPercent: percent(
        count((row) => row.band === 'GREEN' && row.review === 'RIGHT'),
        green,
      ),
      allBandsPercent: percent(
        count((row) => row.intent === 'ORDER' && row.review === 'RIGHT'),
        orders,
      ),
      repliesToPersonal: personal.filter((row) => row.wouldReply).length,
      personalChecked: Math.min(personal.length + dropped, waGate.personalWindow),
      silentMissPercent: percent(ordersSeen, ordersSeen + missed),
      missed,
    };
    return {
      ...numbers,
      target: waGate,
      passed:
        reviewed >= waGate.reviewed &&
        (numbers.intentPercent ?? 0) >= waGate.intentPercent &&
        (numbers.greenPercent ?? 0) >= waGate.greenPercent &&
        (numbers.allBandsPercent ?? 0) >= waGate.allBandsPercent &&
        numbers.repliesToPersonal === 0 &&
        numbers.personalChecked >= waGate.personalWindow &&
        (numbers.silentMissPercent ?? 0) >= waGate.silentMissPercent,
    };
  }

  /** The connection and the counts. Holds no message, name or number. */
  async health() {
    const c = getConfig();
    const since = new Date(`${istToday()}T00:00:00+05:30`);
    const settings = await this.settings();
    const [inbound, gated, runs, off, spent, replies, drafts] = await Promise.all([
      this.db.waMessage.count({ where: { direction: 'IN', receivedAt: { gte: since } } }),
      this.db.waMessage.count({
        where: { direction: 'IN', state: 'GATED', receivedAt: { gte: since } },
      }),
      this.db.waReaderRun.groupBy({
        by: ['reader', 'errorCode'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.db.waThread.count({ where: { aiMode: { not: 'AUTO' } } }),
      this.reader.spentThisMonth(),
      this.db.waReply.groupBy({
        by: ['status', 'skipReason'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.db.waDraft.count({ where: { status: 'OPEN' } }),
    ]);
    const replied = (status: string) =>
      replies.filter((row) => row.status === status).reduce((sum, row) => sum + row._count._all, 0);
    return {
      mode: c.WA_MODE,
      partner: c.WA_PARTNER_NAME ?? null,
      readerProvider: c.WA_READER_PROVIDER,
      paused: settings.aiPaused,
      lastWebhookAt: settings.lastWebhookAt,
      lastAccount: settings.lastAccount,
      today: {
        inbound,
        gated,
        byRules: runs
          .filter((row) => row.reader === 'rules')
          .reduce((sum, row) => sum + row._count._all, 0),
        byModel: runs
          .filter((row) => row.reader !== 'rules' && !row.errorCode)
          .reduce((sum, row) => sum + row._count._all, 0),
        noAnswer: runs
          .filter((row) => row.errorCode)
          .reduce((sum, row) => sum + row._count._all, 0),
      },
      numbersOff: off,
      stage: settings.replyStage,
      openDrafts: drafts,
      repliesToday: {
        sent: replied('SENT'),
        failed: replied('FAILED'),
        skipped: replied('SKIPPED'),
        whySkipped: Object.fromEntries(
          replies
            .filter((row) => row.status === 'SKIPPED' && row.skipReason)
            .map((row) => [row.skipReason, row._count._all]),
        ),
      },
      monthSpentMicroUsd: spent,
      monthCapMicroUsd: c.WA_READER_MONTHLY_BUDGET_MICRO_USD,
    };
  }
}

const goneThread = (id: string) => ({
  contactKey: `gone:${id}`,
  phone: null,
  bsuid: null,
  userId: null,
  profileName: '',
  savedName: '',
  nextRunAt: null,
});

/** Removes everything a person said, and who they are, when their account is erased. */
export async function eraseWhatsApp(tx: Prisma.TransactionClient, phone: string, userId: string) {
  const threads = await tx.waThread.findMany({
    where: { OR: [{ phone }, { userId }] },
    select: { id: true },
  });
  // Pasted cards may name them too, with no chat behind them.
  await tx.waDraft.deleteMany({
    where: { OR: [{ orderedByPhone: phone }, { payerUserId: userId }] },
  });
  for (const { id } of threads) {
    await tx.waReply.deleteMany({ where: { threadId: id } });
    await tx.waDraft.deleteMany({ where: { threadId: id } });
    await tx.waMessage.deleteMany({ where: { threadId: id } });
    await tx.waReaderRun.updateMany({ where: { threadId: id }, data: { output: Prisma.DbNull } });
    await tx.waThread.update({ where: { id }, data: { ...goneThread(id), aiMode: 'OFF' } });
  }
}

/** WhatsApp says what became of a reply we sent. Any repeat of this changes nothing further. */
async function applyStatus(
  tx: Pick<Prisma.TransactionClient, 'waReply'>,
  event: Extract<WaEvent, { kind: 'status' }>,
) {
  const { status, code } = event;
  const reply = await tx.waReply.findFirst({ where: { providerId: hash(event.wamid) } });
  if (!reply) return;
  if (status === 'delivered' && !reply.deliveredAt)
    await tx.waReply.update({ where: { id: reply.id }, data: { deliveredAt: new Date() } });
  if (status === 'read' && !reply.readAt)
    await tx.waReply.update({ where: { id: reply.id }, data: { readAt: new Date() } });
  if (status !== 'failed' || reply.status !== 'SENT') return;
  // A window WhatsApp says has closed: a person's decision goes again as its template.
  if (code === 131047 && reply.template && !reply.forceTemplate) {
    await tx.waReply.update({
      where: { id: reply.id },
      data: { status: 'QUEUED', forceTemplate: true, nextAttemptAt: new Date(), providerId: null },
    });
    return;
  }
  await tx.waReply.update({
    where: { id: reply.id },
    data: { status: 'FAILED', failedCode: code === null ? 'UNKNOWN' : String(code) },
  });
}

/** They deleted a message: the card loses its words, keeps what a person may have worked out. */
async function forgetDraftWords(tx: Prisma.TransactionClient, messageId: string) {
  const drafts = await tx.waDraft.findMany({ where: { messageIds: { has: messageId } } });
  for (const draft of drafts)
    await tx.waDraft.update({
      where: { id: draft.id },
      data: {
        originalText: null,
        flags: [...new Set([...draft.flags, 'REVOKED'])],
        lines: linesOf(draft).map((line) => ({
          ...line,
          rawText: '',
        })) as unknown as Prisma.InputJsonValue,
        // Whoever is looking at the card must look again.
        ...(draft.status === 'OPEN' ? { version: { increment: 1 } } : {}),
      },
    });
}

/** Drops what was understood from a message that has changed or gone. */
async function forgetReadings(tx: Prisma.TransactionClient, messageId: string) {
  await tx.waReaderRun.updateMany({
    where: { messageIds: { has: messageId } },
    data: { output: Prisma.DbNull },
  });
}

/**
 * The one thread for this person, however they arrive. A number and WhatsApp's id for it may come
 * separately at first, and the stricter setting wins when they turn out to be the same person.
 */
async function threadFor(
  tx: Prisma.TransactionClient,
  phone: string | null,
  bsuid: string | null,
  fresh: { userId: string | null; savedName: string; profileName: string },
) {
  const found = await tx.waThread.findMany({
    where: { OR: [...(phone ? [{ phone }] : []), ...(bsuid ? [{ bsuid }] : [])] },
    orderBy: { createdAt: 'asc' },
  });
  if (!found.length)
    return tx.waThread.create({
      data: { contactKey: (phone ?? bsuid)!, phone, bsuid, ...fresh },
    });
  const [main, other] = found as [(typeof found)[number], (typeof found)[number] | undefined];
  if (other) {
    await tx.waMessage.updateMany({ where: { threadId: other.id }, data: { threadId: main.id } });
    await tx.waReaderRun.updateMany({ where: { threadId: other.id }, data: { threadId: main.id } });
    // One open draft per chat, so the newer of two goes when they turn out to be one person.
    if (await tx.waDraft.findFirst({ where: { threadId: main.id, status: 'OPEN' } }))
      await tx.waDraft.updateMany({
        where: { threadId: other.id, status: 'OPEN' },
        data: { status: 'CANCELLED' },
      });
    await tx.waDraft.updateMany({ where: { threadId: other.id }, data: { threadId: main.id } });
    await tx.waReply.updateMany({ where: { threadId: other.id }, data: { threadId: main.id } });
    await tx.waThread.update({ where: { id: other.id }, data: goneThread(other.id) });
  }
  const stricter = [main.aiMode, other?.aiMode].find((mode) => mode && mode !== 'AUTO');
  return tx.waThread.update({
    where: { id: main.id },
    data: {
      ...(phone && !main.phone ? { phone } : {}),
      ...(bsuid && !main.bsuid ? { bsuid } : {}),
      ...(stricter ? { aiMode: stricter } : {}),
      ...(!main.userId && fresh.userId ? { userId: fresh.userId } : {}),
      ...(fresh.profileName ? { profileName: fresh.profileName } : {}),
    },
  });
}

/** A number marked off keeps no words at all, including any kept before it was marked. */
export async function clearWords(tx: Prisma.TransactionClient, threadId: string) {
  await tx.waMessage.updateMany({
    where: { threadId, text: { not: null } },
    data: { text: null, truncated: false, state: 'GATED' },
  });
  await tx.waMessage.updateMany({
    where: { threadId, state: 'RECEIVED' },
    data: { state: 'GATED' },
  });
  await tx.waReaderRun.updateMany({ where: { threadId }, data: { output: Prisma.DbNull } });
  // The cards made from those words go with them, and nothing queued for this number leaves.
  const open = await tx.waDraft.findMany({
    where: { threadId, source: 'WHATSAPP', status: 'OPEN' },
    select: { id: true },
  });
  for (const { id } of open) await alertOff(tx, id);
  await tx.waDraft.updateMany({
    where: { threadId, source: 'WHATSAPP', status: 'OPEN' },
    data: { status: 'CANCELLED' },
  });
  await tx.waDraft.updateMany({
    where: { threadId, source: 'WHATSAPP' },
    data: { originalText: null, payerWords: '', paymentWords: '', lines: [] },
  });
  await tx.waReply.updateMany({
    where: { threadId, status: 'QUEUED' },
    data: { status: 'SKIPPED', skipReason: 'NUMBER_OFF', body: null },
  });
}
