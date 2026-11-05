import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { SkipThrottle } from '@nestjs/throttler';
import {
  istToday,
  waAliasSchema,
  waPauseSchema,
  waReviewSchema,
  waThreadCreateSchema,
  waThreadModeSchema,
  waTrySchema,
} from '@shiv/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { loadCatalog, normalizeAlias, type Catalog } from '../catalog-match';
import { getConfig } from '../config';
import { Db } from '../db';
import { AuthRequest, Can, Contract, fail, Input, Public, safeEqual } from '../http';
import { paginate } from '../pagination';
import { parseWebhook, verifyWebhook } from './provider';
import { renderReply, replyParams, type AiReplyKind, type ReplyLanguage } from './replies';
import type { Reading } from './reading';
import { clearWords, maskedContact, WaService } from './service';

const notOn = () => fail('WA_OFF', 'WhatsApp reading is not switched on.', 404);

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WaWebhookController {
  constructor(@Inject(WaService) private wa: WaService) {}

  /** The partner's one-time check that this address is ours. */
  @Public()
  @SkipThrottle()
  @Get('webhook')
  verify(@Query() query: Record<string, string>, @Res() res: Response) {
    const c = getConfig();
    if (c.WA_MODE === 'off' || !c.WHATSAPP_VERIFY_TOKEN) notOn();
    const challenge = String(query['hub.challenge'] ?? '');
    if (
      query['hub.mode'] !== 'subscribe' ||
      !safeEqual(String(query['hub.verify_token'] ?? ''), c.WHATSAPP_VERIFY_TOKEN!) ||
      !/^[A-Za-z0-9_.-]{1,200}$/.test(challenge)
    )
      fail('FORBIDDEN', 'This webhook check failed.', 403);
    res.type('text/plain').send(challenge);
  }

  /** Stores and answers at once. All the reading happens later, in the worker. */
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('webhook')
  async receive(@Req() req: AuthRequest) {
    if (getConfig().WA_MODE === 'off') notOn();
    const raw = Buffer.isBuffer(req.body) ? (req.body as Buffer) : req.rawBody;
    if (!raw) fail('INVALID_BODY', 'Raw request body required.');
    if (!verifyWebhook(raw, req.headers))
      fail('INVALID_SIGNATURE', 'Webhook signature is invalid.', 401);
    return { ok: true, stored: await this.wa.ingest(parseWebhook(raw)) };
  }
}

const words = (kinds: string[], reading: Reading | null, catalog: Catalog) => {
  const language: ReplyLanguage = reading?.language ?? 'hinglish';
  const params = replyParams(reading, catalog);
  return kinds.map((kind) => renderReply(kind as AiReplyKind, language, params));
};
const pageFilter = z.enum(['unreviewed', 'all']).default('unreviewed');

@ApiTags('WhatsApp')
@Controller('admin/wa')
export class WaDeskController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(WaService) private wa: WaService,
  ) {}

  @Can('wa.admin') @Get('health') health() {
    return this.wa.health();
  }

  @Can('wa.read') @Get('gate') gate() {
    return this.wa.gate();
  }

  /** Each reading beside the customer's own words, for a person to mark right or wrong. */
  @Can('wa.read') @Get('readings') async readings(@Query() query: Record<string, string>) {
    const parsed = pageFilter.safeParse(query.filter);
    if (!parsed.success) fail('INVALID_FILTER', 'Check the filter.');
    const filter = parsed.data;
    const page = paginate(query, `wa-readings:${filter}`);
    const rows = await this.db.waReaderRun.findMany({
      where: {
        reader: { not: 'manual' },
        // Only what a person can check: words dropped on purpose leave nothing to look at.
        OR: [{ output: { not: Prisma.AnyNull } }, { errorCode: { not: null } }],
        ...(filter === 'unreviewed' ? { review: null } : {}),
        ...page.after,
      },
      include: {
        thread: { select: { phone: true, savedName: true, profileName: true, aiMode: true } },
      },
      orderBy: page.orderBy,
      take: page.take,
    });
    const messages = await this.db.waMessage.findMany({
      where: { id: { in: rows.flatMap((row) => row.messageIds) } },
      select: { id: true, text: true },
    });
    const catalog = await loadCatalog(this.db);
    return page.finish(
      rows.map((row) => {
        const reading = row.output as unknown as Reading | null;
        const kinds = row.wouldReply ? row.wouldReply.split('+') : [];
        return {
          id: row.id,
          createdAt: row.createdAt,
          threadId: row.threadId,
          contact: {
            masked: maskedContact(row.thread.phone),
            savedName: row.thread.savedName,
            profileName: row.thread.profileName,
          },
          words: row.messageIds
            .map((id) => messages.find((message) => message.id === id)?.text)
            .filter(Boolean)
            .join('\n'),
          reader: row.reader,
          intent: row.intent,
          band: row.band,
          errorCode: row.errorCode,
          reading,
          wouldReply: kinds,
          wouldReplyWords: words(kinds, reading, catalog),
          review: row.review,
        };
      }),
    );
  }

  @Can('wa.read')
  @Post('runs/:id/review')
  @Contract(waReviewSchema)
  async review(
    @Param('id') id: string,
    @Input(waReviewSchema) body: z.infer<typeof waReviewSchema>,
    @Req() req: AuthRequest,
  ) {
    const moved = await this.db.waReaderRun.updateMany({
      where: { id, reader: { not: 'manual' } },
      data: { review: body.review, reviewedById: req.user.id, reviewedAt: new Date() },
    });
    if (!moved.count) fail('WA_RUN_NOT_FOUND', 'That reading is not here.', 404);
    return { ok: true };
  }

  /** Numbers the reader stays away from, and chats where the owner answered and it read no order. */
  @Can('wa.ai.control') @Get('threads') async threads(@Query() query: Record<string, string>) {
    const parsed = z.enum(['off', 'replied']).default('off').safeParse(query.filter);
    if (!parsed.success) fail('INVALID_FILTER', 'Check the filter.');
    const filter = parsed.data;
    const since = new Date(Date.now() - 14 * 86400000);
    const rows = await this.db.waThread.findMany({
      where:
        filter === 'off'
          ? { aiMode: { not: 'AUTO' } }
          : {
              aiMode: 'AUTO',
              lastEchoAt: { gte: since },
              runs: { none: { intent: 'ORDER', createdAt: { gte: since } } },
            },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        masked: maskedContact(row.phone),
        savedName: row.savedName,
        profileName: row.profileName,
        aiMode: row.aiMode,
        lastEchoAt: row.lastEchoAt,
      })),
    };
  }

  /** Marks a number before it ever writes, such as family. */
  @Can('wa.ai.control')
  @Post('threads')
  @Contract(waThreadCreateSchema)
  async markNumber(
    @Input(waThreadCreateSchema) body: z.infer<typeof waThreadCreateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const thread = await tx.waThread.upsert({
        where: { contactKey: body.phone },
        create: {
          contactKey: body.phone,
          phone: body.phone,
          aiMode: 'OFF',
          ...(body.savedName ? { savedName: body.savedName } : {}),
        },
        update: { aiMode: 'OFF', ...(body.savedName ? { savedName: body.savedName } : {}) },
      });
      await clearWords(tx, thread.id);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'WA_THREAD_AI_CHANGED',
          entityId: thread.id,
          details: { aiMode: 'OFF' },
        },
      });
      return { id: thread.id, aiMode: thread.aiMode };
    });
  }

  @Can('wa.ai.control')
  @Patch('threads/:id')
  @Contract(waThreadModeSchema)
  async setMode(
    @Param('id') id: string,
    @Input(waThreadModeSchema) body: z.infer<typeof waThreadModeSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const thread = await tx.waThread.findUnique({ where: { id } });
      if (!thread) fail('WA_THREAD_NOT_FOUND', 'That number is not here.', 404);
      await tx.waThread.update({
        where: { id },
        data: {
          aiMode: body.aiMode,
          // Staff turning a number back on also ends "they asked for a person".
          ...(body.aiMode === 'AUTO' ? { handoffUntil: null } : {}),
        },
      });
      if (body.aiMode === 'OFF') await clearWords(tx, id);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'WA_THREAD_AI_CHANGED',
          entityId: id,
          details: { aiMode: body.aiMode },
        },
      });
      return { id, aiMode: body.aiMode };
    });
  }

  /** The silent miss: the owner handled an order here by hand, and the reader saw none. */
  @Can('wa.read') @Post('threads/:id/missed') async missed(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    const thread = await this.db.waThread.findUnique({ where: { id }, select: { id: true } });
    if (!thread) fail('WA_THREAD_NOT_FOUND', 'That number is not here.', 404);
    await this.db.waReaderRun.create({
      data: {
        threadId: id,
        messageIds: [],
        reader: 'manual',
        review: 'MISSED_ORDER',
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
    });
    return { ok: true };
  }

  /** Stops all reading at once, from the next message. */
  @Can('wa.ai.control')
  @Post('pause')
  @Contract(waPauseSchema)
  async pause(@Input(waPauseSchema) body: z.infer<typeof waPauseSchema>, @Req() req: AuthRequest) {
    await this.wa.settings();
    await this.db.atomic(async (tx) => {
      await tx.waSettings.update({
        where: { id: 'wa' },
        data: {
          aiPaused: body.paused,
          pausedById: body.paused ? req.user.id : null,
          pausedAt: body.paused ? new Date() : null,
        },
      });
      // Nothing waiting goes either, even if the switch comes straight back on.
      if (body.paused)
        await tx.waReply.updateMany({
          where: { status: 'QUEUED', class: 'AI_REPLY' },
          data: { status: 'SKIPPED', skipReason: 'STOP_ALL', body: null },
        });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'WA_AI_PAUSED',
          entityId: 'wa',
          details: { paused: body.paused },
        },
      });
    });
    return { paused: body.paused };
  }

  /** Tries the reader on pasted words. Nothing is kept, and it counts against the monthly cap. */
  @Can('wa.read')
  @Post('try')
  @Contract(waTrySchema)
  async tryIt(@Input(waTrySchema) body: z.infer<typeof waTrySchema>, @Req() req: AuthRequest) {
    const catalog = await loadCatalog(this.db);
    const whole = await this.wa.readText(body.text, {
      catalog,
      sentAt: new Date(),
      truncated: false,
      known: true,
      humanQuiet: false,
      subject: `try:${req.user.id}`,
    });
    return {
      reader: whole.answer.reader,
      errorCode: whole.errorCode,
      reading: whole.reading,
      wouldReply: whole.replies,
      wouldReplyWords: words(whole.replies, whole.reading, catalog),
      today: istToday(),
    };
  }

  /** A person's word for a product. Never from the model alone. */
  @Can('wa.learn')
  @Post('aliases')
  @Contract(waAliasSchema)
  async alias(@Input(waAliasSchema) body: z.infer<typeof waAliasSchema>, @Req() req: AuthRequest) {
    const normalizedAlias = normalizeAlias(body.alias);
    return this.db.atomic(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: body.productId, active: true },
        select: { id: true },
      });
      if (!product) fail('NOT_FOUND', 'That product is not on the list.', 404);
      if (await tx.productAlias.findUnique({ where: { normalizedAlias } }))
        fail('ALIAS_TAKEN', 'That word already means a product.', 409);
      const row = await tx.productAlias.create({
        data: {
          productId: body.productId,
          alias: body.alias,
          normalizedAlias,
          source: 'WHATSAPP',
          confirmedBy: req.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'WA_ALIAS_ADDED',
          entityId: row.id,
          details: { productId: body.productId },
        },
      });
      return { id: row.id, alias: row.alias };
    });
  }
}
