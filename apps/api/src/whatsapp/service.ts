import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { istToday, waGate } from '@shiv/shared';
import { loadCatalog, type Catalog } from '../catalog-match';
import { getConfig } from '../config';
import { Db } from '../db';
import { errorCause, hash } from '../http';
import type { WaEvent } from './provider';
import { WaReader, promptVersion, type ReaderAnswer } from './reader';
import { finishReading, type ReaderOutput, type Reading } from './reading';
import { decideReplies, type AiReplyKind } from './replies';
import { hasTradeWord, isOnlyChat, isStop, readByRules } from './rules';

const textLimit = 2000;
const rateFreshMs = 3 * 86400000;
const log = (event: string, details: Record<string, unknown> = {}) =>
  console.warn(JSON.stringify({ event, ...details, timestamp: new Date().toISOString() }));

export const maskedContact = (phone: string | null) =>
  phone ? `…${phone.slice(-4)}` : 'Number nahi mila';
const cleanName = (name: string) => cleanWords(cleanWords(name).trim().slice(0, 60));
// Control and direction characters go, and any half of an emoji left by cutting. The joiners stay,
// as Hindi needs them.
const cleanWords = (text: string) => text.replace(/[^\P{C}\n\t\u200C\u200D]/gu, ' ');
const messagesPerRead = 50;
const retryAfterMs = 300_000;
const wordsNotKept = ['PERSONAL_OR_SUPPLIER', 'CHAT', 'OFF_TOPIC'];

export type WholeReading = {
  answer: Pick<
    ReaderAnswer,
    'reader' | 'inputTokens' | 'outputTokens' | 'costMicroUsd' | 'latencyMs'
  >;
  errorCode: string | null;
  reading: Reading | null;
  replies: AiReplyKind[];
};

/**
 * Reads the shop's WhatsApp silently. Nothing in this module can send anything: it has no sender,
 * and only writes rows that a person with the right to see them can read on the desk.
 */
@Injectable()
export class WaService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(WaReader) private reader: WaReader,
  ) {}

  settings() {
    return this.db.waSettings.upsert({ where: { id: 'wa' }, create: { id: 'wa' }, update: {} });
  }

  /** Stores what arrived. Quick and with no outside calls, as the partner waits on the answer. */
  async ingest(events: WaEvent[]) {
    let stored = 0;
    const { aiPaused } = await this.settings();
    for (const event of events) {
      if (await this.db.atomic((tx) => this.ingestOne(tx, event, aiPaused))) stored++;
    }
    await this.db.waSettings.update({
      where: { id: 'wa' },
      data: { lastWebhookAt: new Date() },
    });
    return stored;
  }

  private async ingestOne(tx: Prisma.TransactionClient, event: WaEvent, aiPaused: boolean) {
    const c = getConfig();
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
    if (await tx.waMessage.findUnique({ where: { wamid: key }, select: { id: true } }))
      return false;
    const person = event.phone
      ? await tx.user.findUnique({
          where: { phone: event.phone },
          select: { id: true, role: true, name: true },
        })
      : null;
    const staff = person?.role === 'ADMIN';
    const thread = await threadFor(tx, event.phone, event.bsuid, {
      userId: !staff ? (person?.id ?? null) : null,
      savedName: person?.name ?? '',
      profileName: event.kind === 'inbound' ? cleanName(event.profileName) : '',
    });
    if (event.kind === 'echo') {
      await tx.waMessage.create({
        data: {
          wamid: key,
          threadId: thread.id,
          direction: 'ECHO',
          type: event.type,
          state: 'READ',
          sentAt: event.sentAt,
        },
      });
      await tx.waThread.update({
        where: { id: thread.id },
        data: {
          lastEchoAt: event.sentAt,
          humanUntil: new Date(event.sentAt.getTime() + c.WA_HUMAN_QUIET_MINUTES * 60000),
        },
      });
      return true;
    }
    const raw = event.text ? cleanWords(event.text).trim() : '';
    // Voice and photos are not read yet, so nothing of them is kept.
    const keep = !aiPaused && !staff && thread.aiMode === 'AUTO' && event.type === 'text' && raw;
    await tx.waMessage.create({
      data: {
        wamid: key,
        threadId: thread.id,
        direction: 'IN',
        type: event.type,
        text: keep ? cleanWords(raw.slice(0, textLimit)) : null,
        truncated: keep ? raw.length > textLimit : false,
        state: keep ? 'RECEIVED' : 'GATED',
        sentAt: event.sentAt,
      },
    });
    await tx.waThread.update({
      where: { id: thread.id },
      data: {
        lastInboundAt: event.sentAt,
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
    // These stop here, with no model and no words kept. STOP counts anywhere in a burst.
    if (messages.some((message) => isStop(message.text ?? ''))) {
      await this.db.atomic(async (tx) => {
        await gate(tx);
        await tx.waThread.update({ where: { id }, data: { aiMode: 'OPTED_OUT' } });
        await tx.waReaderRun.create({
          data: {
            threadId: id,
            messageIds: ids,
            reader: 'rules',
            promptVersion,
            wouldReply: 'STOP_OK',
          },
        });
      });
      return finish();
    }
    if (isOnlyChat(text) || (!known && !hasTradeWord(text, catalog))) {
      await this.db.atomic(gate);
      return finish();
    }
    const whole = await this.readText(text, {
      catalog,
      sentAt: messages.at(-1)!.sentAt,
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
      const now = await tx.waThread.findUnique({ where: { id }, select: { aiMode: true } });
      const settings = await tx.waSettings.findUnique({ where: { id: 'wa' } });
      if (!now || now.aiMode !== 'AUTO' || settings?.aiPaused) {
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
      await tx.waReaderRun.create({
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
          wouldReply: whole.replies.join('+') || null,
          errorCode: whole.errorCode,
        },
      });
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
    // A number nobody chose to keep leaves with its last message. Numbers marked off stay listed.
    const quiet = await this.db.waThread.findMany({
      where: {
        aiMode: 'AUTO',
        contactKey: { not: { startsWith: 'gone:' } },
        updatedAt: { lt: cutoff },
        messages: { none: {} },
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
      where: { review: { not: null } },
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
    const [inbound, gated, runs, off, spent] = await Promise.all([
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
    ]);
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
  for (const { id } of threads) {
    await tx.waMessage.deleteMany({ where: { threadId: id } });
    await tx.waReaderRun.updateMany({ where: { threadId: id }, data: { output: Prisma.DbNull } });
    await tx.waThread.update({ where: { id }, data: { ...goneThread(id), aiMode: 'OFF' } });
  }
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
}
