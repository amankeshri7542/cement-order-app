import { Inject, Injectable } from '@nestjs/common';
import type { WaReply, WaSettings, WaThread } from '@prisma/client';
import { getConfig } from '../config';
import { Db } from '../db';
import { errorCause, hash } from '../http';
import { knownCustomer, stageAllows } from './draft-core';
import { promisesTooMuch, type AiReplyKind } from './replies';

/** Why a reply stayed unsaid. Written on the row, so a person can see the rule that stopped it. */
export type SkipReason =
  | 'MODE_OFF'
  | 'STOP_ALL'
  | 'STAGE_OFF'
  | 'NOT_THIS_STAGE'
  | 'NO_PHONE'
  | 'OWN_NUMBER'
  | 'NUMBER_OFF'
  | 'OPTED_OUT'
  | 'HANDED_OFF'
  | 'PAPA_TYPED'
  | 'DRAFT_CLOSED'
  | 'QUIET_AFTER_ECHO'
  | 'NIGHT'
  | 'TOO_OLD'
  | 'WINDOW_CLOSED'
  | 'FORBIDDEN_WORDS'
  | 'LOST_SEND';

export const windowMs = 24 * 3600000;
const istHour = (at: Date) => new Date(at.getTime() + 19800000).getUTCHours();
/** Whether the night's quiet hours hold at this moment. Equal hours mean there are none. */
export function isNight(at: Date, from: number, to: number) {
  if (from === to) return false;
  const hour = istHour(at);
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

export type GuardInput = {
  now: Date;
  mode: string;
  provider: string;
  businessPhone: string | undefined;
  maxAgeMinutes: number;
  settings: Pick<
    WaSettings,
    'aiPaused' | 'replyStage' | 'testNumbers' | 'nightFromHour' | 'nightToHour'
  >;
  thread: Pick<
    WaThread,
    'phone' | 'aiMode' | 'humanUntil' | 'lastEchoAt' | 'lastInboundAt' | 'handoffUntil'
  >;
  known: boolean;
  draft: { status: string; papaRepliedAt: Date | null } | null;
  row: Pick<WaReply, 'class' | 'kind' | 'triggerAt' | 'quietOk' | 'body'>;
};
/**
 * The last look before anything leaves. Everything here is checked at the moment of sending, as a
 * reply can wait in the queue while the owner stops the AI or Papa picks up his phone.
 */
export function replyBlock(input: GuardInput): SkipReason | null {
  const { now, settings, thread, draft, row } = input;
  const person = row.class === 'HUMAN_DECISION';
  if (input.mode !== 'reply' || input.provider === 'off') return 'MODE_OFF';
  if (settings.aiPaused) return 'STOP_ALL';
  if (settings.replyStage === 'OFF') return 'STAGE_OFF';
  if (!thread.phone) return 'NO_PHONE';
  if (thread.phone === input.businessPhone) return 'OWN_NUMBER';
  if (!stageAllows(settings, thread.phone, input.known)) return 'NOT_THIS_STAGE';
  if (thread.aiMode === 'OFF') return 'NUMBER_OFF';
  // STOP gets its one acknowledgement. After that this number hears nothing.
  if (thread.aiMode === 'OPTED_OUT') return row.kind === 'STOP_OK' ? null : 'OPTED_OUT';
  // A person decided, so the AI's quiet rules do not apply to what they said.
  if (person) return null;
  if (thread.handoffUntil && thread.handoffUntil > now && row.kind !== 'HANDOFF')
    return 'HANDED_OFF';
  if (draft?.papaRepliedAt && row.kind !== 'AFTER_TAP') return 'PAPA_TYPED';
  if (draft && draft.status !== 'OPEN' && row.kind !== 'AFTER_TAP') return 'DRAFT_CLOSED';
  // Papa spoke after the message this answers, however late his words reached us.
  if (row.triggerAt && thread.lastEchoAt && thread.lastEchoAt >= row.triggerAt) return 'PAPA_TYPED';
  if (thread.humanUntil && thread.humanUntil > now && !row.quietOk) return 'QUIET_AFTER_ECHO';
  if (isNight(now, settings.nightFromHour, settings.nightToHour)) return 'NIGHT';
  if (row.triggerAt && now.getTime() - row.triggerAt.getTime() > input.maxAgeMinutes * 60000)
    return 'TOO_OLD';
  if (!thread.lastInboundAt || now.getTime() - thread.lastInboundAt.getTime() >= windowMs)
    return 'WINDOW_CLOSED';
  if (promisesTooMuch(row.kind as AiReplyKind, row.body ?? '')) return 'FORBIDDEN_WORDS';
  return null;
}

export type Outgoing = {
  to: string;
  kind: string;
  body?: string;
  buttons?: { id: string; title: string }[];
  template?: { name: string; language: string; params: string[] };
};
/** The partner said no. Holds WhatsApp's code, so the sender can tell a closed window from an outage. */
export class SendRefused extends Error {
  constructor(
    readonly code: number | null,
    message: string,
  ) {
    super(message);
  }
}
/** Stands in for the partner in tests and on a laptop. Nothing leaves this process. */
export const fakeWhatsApp = {
  sent: [] as Outgoing[],
  refuseNext: [] as (number | null)[],
  clear() {
    this.sent.length = 0;
    this.refuseNext.length = 0;
  },
};
const messageWindowClosed = 131047;
// These will not get better by trying again.
const hopeless = new Set([131021, 131026, 131030, 131050, 132000, 132001]);
const attemptsAllowed = { AI_REPLY: 2, HUMAN_DECISION: 5 } as Record<string, number>;
// Longer than a whole pass can take, so only a worker that really died loses its rows.
const leaseMs = 300_000;

function cloudMessage(out: Outgoing) {
  if (out.template)
    return {
      type: 'template',
      template: {
        name: out.template.name,
        language: { code: out.template.language },
        components: [
          { type: 'body', parameters: out.template.params.map((text) => ({ type: 'text', text })) },
        ],
      },
    };
  if (out.buttons?.length)
    return {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: out.body },
        action: {
          buttons: out.buttons.map((button) => ({
            type: 'reply',
            reply: { id: button.id, title: button.title },
          })),
        },
      },
    };
  return { type: 'text', text: { body: out.body, preview_url: false } };
}
async function postTo(url: string, headers: Record<string, string>, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const answer = (await response.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    wamid?: string;
    id?: string;
    error?: { code?: unknown; message?: unknown; whatsappApiError?: { code?: unknown } };
  };
  const providerId = answer.messages?.[0]?.id ?? answer.wamid ?? answer.id;
  if (response.ok && providerId) return providerId;
  const code = Number(answer.error?.whatsappApiError?.code ?? answer.error?.code);
  throw new SendRefused(Number.isFinite(code) ? code : null, `HTTP ${response.status}`);
}
/**
 * The one place anything leaves for WhatsApp. The partners' formats are from their published
 * documents and have never carried a real message: check on the spare number first.
 */
export async function carry(out: Outgoing): Promise<string> {
  const c = getConfig();
  const digits = out.to.replace(/\D/g, '');
  switch (c.WA_REPLY_PROVIDER) {
    case 'fake': {
      const refuse = fakeWhatsApp.refuseNext.shift();
      if (refuse !== undefined) throw new SendRefused(refuse, 'Refused by the fake partner');
      fakeWhatsApp.sent.push(out);
      return `fake-${fakeWhatsApp.sent.length}-${Date.now()}`;
    }
    case 'meta':
      return postTo(
        `https://graph.facebook.com/${c.WHATSAPP_API_VERSION}/${c.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        { authorization: `Bearer ${c.WHATSAPP_ACCESS_TOKEN}` },
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: digits,
          ...cloudMessage(out),
        },
      );
    case 'd360':
      return postTo(
        'https://waba-v2.360dialog.io/messages',
        { 'D360-API-KEY': c.WA_REPLY_API_KEY! },
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: digits,
          ...cloudMessage(out),
        },
      );
    case 'ycloud':
      return postTo(
        'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly',
        { 'X-API-Key': c.WA_REPLY_API_KEY! },
        { from: c.WA_BUSINESS_PHONE, to: out.to, ...cloudMessage(out) },
      );
    default:
      throw new SendRefused(null, 'No sender is set');
  }
}
const log = (event: string, details: Record<string, unknown>) =>
  console.warn(JSON.stringify({ event, ...details, timestamp: new Date().toISOString() }));

/** Sends what is queued. It is the only caller of carry(). */
@Injectable()
export class WaSender {
  constructor(@Inject(Db) private db: Db) {}

  /** One worker pass. Rows are claimed first, so a second worker can never send the same one. */
  async sendDue(limit = 10) {
    await this.recoverLost();
    const now = new Date();
    const at = now.toISOString();
    const lease = new Date(now.getTime() + leaseMs).toISOString();
    // Oldest first, so the notice arrives before the draft it introduces.
    const claimed = await this.db.$queryRaw<{ id: string }[]>`
      UPDATE "WaReply" SET "status" = 'SENDING', "leaseUntil" = ${lease}::timestamp
      WHERE "id" IN (
        SELECT "id" FROM "WaReply"
        WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= ${at}::timestamp
        ORDER BY "createdAt" ASC, "id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"`;
    const rows = await this.db.waReply.findMany({
      where: { id: { in: claimed.map((row) => row.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) {
      try {
        await this.sendOne(row);
      } catch (error) {
        log('WA_REPLY_WORKER_FAILED', { reply: row.id, ...errorCause(error) });
      }
    }
    return rows.length;
  }

  /**
   * A worker that died mid-send leaves a row behind, and nobody knows if it left. A lost "pakka"
   * brings the phone call back and a repeat is harmless, so a decision goes again. An AI reply that
   * may already have gone stays unsaid.
   */
  private async recoverLost() {
    const now = new Date();
    await this.db.waReply.updateMany({
      where: { status: 'SENDING', leaseUntil: { lt: now }, class: 'HUMAN_DECISION' },
      data: { status: 'QUEUED', leaseUntil: null },
    });
    await this.db.waReply.updateMany({
      where: { status: 'SENDING', leaseUntil: { lt: now }, class: 'AI_REPLY' },
      data: { status: 'SKIPPED', skipReason: 'LOST_SEND', leaseUntil: null },
    });
  }

  private async sendOne(row: WaReply) {
    const c = getConfig();
    const now = new Date();
    const settings = await this.db.waSettings.findUniqueOrThrow({ where: { id: 'wa' } });
    const thread = await this.db.waThread.findUniqueOrThrow({ where: { id: row.threadId } });
    const draft = row.draftId
      ? await this.db.waDraft.findUnique({
          where: { id: row.draftId },
          select: { status: true, papaRepliedAt: true },
        })
      : null;
    const block = replyBlock({
      now,
      mode: c.WA_MODE,
      provider: c.WA_REPLY_PROVIDER,
      businessPhone: c.WA_BUSINESS_PHONE,
      maxAgeMinutes: c.WA_REPLY_MAX_AGE_MINUTES,
      settings,
      thread,
      known: await knownCustomer(this.db, thread.userId),
      draft,
      row,
    });
    if (block) return this.skip(row, block);
    const windowOpen = Boolean(
      thread.lastInboundAt && now.getTime() - thread.lastInboundAt.getTime() < windowMs,
    );
    const viaTemplate = row.forceTemplate || !windowOpen;
    // A person's decision outside the window needs its template, and a template has to be approved.
    if (viaTemplate && !row.template) return this.skip(row, 'WINDOW_CLOSED');
    const out: Outgoing = viaTemplate
      ? {
          to: thread.phone!,
          kind: row.kind,
          template: {
            name: row.template!,
            language: c.WA_REPLY_TEMPLATE_LANGUAGE,
            params: row.templateParams as string[],
          },
        }
      : {
          to: thread.phone!,
          kind: row.kind,
          body: row.body ?? '',
          ...(row.buttons ? { buttons: row.buttons as { id: string; title: string }[] } : {}),
        };
    try {
      const providerId = await carry(out);
      await this.db.waReply.update({
        where: { id: row.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerId: hash(providerId),
          viaTemplate,
          attempts: { increment: 1 },
          leaseUntil: null,
          failedCode: null,
        },
      });
      // Numbers masked, and no words: this line goes to the server's logs.
      log('WA_REPLY_SENT', { kind: row.kind, viaTemplate, to: `…${thread.phone!.slice(-4)}` });
    } catch (error) {
      await this.failed(row, error);
    }
  }

  private async skip(row: WaReply, reason: SkipReason) {
    await this.db.waReply.update({
      where: { id: row.id },
      data: {
        status: 'SKIPPED',
        skipReason: reason,
        leaseUntil: null,
        // Unsaid words need not be kept. A person's decision stays, for the card's own link.
        ...(row.class === 'AI_REPLY' ? { body: null } : {}),
      },
    });
    // It did not reach them, so the next answer introduces itself instead.
    if (row.kind === 'NOTICE')
      await this.db.waThread.update({ where: { id: row.threadId }, data: { noticeAt: null } });
  }

  private async failed(row: WaReply, error: unknown) {
    const code = error instanceof SendRefused ? error.code : null;
    const attempts = row.attempts + 1;
    if (code === messageWindowClosed && !row.forceTemplate) {
      // WhatsApp counts the window its own way. A person's decision has a template for this.
      if (row.template)
        return this.db.waReply.update({
          where: { id: row.id },
          data: { status: 'QUEUED', forceTemplate: true, attempts, leaseUntil: null },
        });
      return this.skip(row, 'WINDOW_CLOSED');
    }
    // No answer at all may mean it arrived. A person's decision risks a repeat, as a repeat is
    // harmless and a lost one brings the phone call back. The AI stays quiet instead.
    const unknown = !(error instanceof SendRefused) && row.class === 'AI_REPLY';
    const finished =
      unknown ||
      attempts >= (attemptsAllowed[row.class] ?? 2) ||
      (code !== null && hopeless.has(code));
    log('WA_REPLY_NOT_SENT', { kind: row.kind, code, attempts, finished });
    // It never reached them, so the next answer introduces itself instead.
    if (finished && row.kind === 'NOTICE')
      await this.db.waThread.update({ where: { id: row.threadId }, data: { noticeAt: null } });
    return this.db.waReply.update({
      where: { id: row.id },
      data: {
        status: finished ? 'FAILED' : 'QUEUED',
        attempts,
        failedCode: code === null ? 'UNKNOWN' : String(code),
        leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + 30_000 * 2 ** attempts),
      },
    });
  }
}
