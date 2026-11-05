import { Controller, Get, Inject, Injectable, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import {
  waLoadSizeChangeSchema,
  waLoadSizeSchema,
  waReplySettingsSchema,
  waStageMoveSchema,
  waStages,
  waTallyPeriods,
  waTallySchema,
  type WaStage,
} from '@shiv/shared';
import { z } from 'zod';
import { getConfig } from '../config';
import { Db } from '../db';
import { AuthRequest, Can, Contract, fail, Input, scoped } from '../http';
import { WaService } from './service';

const knownCustomersFor = 7 * 86400000;
const levelOf = (stage: string) => waStages.indexOf(stage as WaStage);

/** Who may hear from the AI. Nothing here can make a reply go: only sender.ts sends. */
@Injectable()
export class WaStages {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(WaService) private wa: WaService,
  ) {}

  /** Everything that has to be true before more people may hear from the AI. */
  async readiness(to: WaStage) {
    const c = getConfig();
    const settings = await this.wa.settings();
    const gate = await this.wa.gate();
    const checks: { key: string; ok: boolean }[] = [
      // The reader's numbers on 200+ real messages that a person marked (plan 07 section 9).
      { key: 'GATE', ok: gate.passed },
      { key: 'REPLY_MODE', ok: c.WA_MODE === 'reply' && c.WA_REPLY_PROVIDER !== 'off' },
      { key: 'REAL_READER', ok: c.WA_READER_PROVIDER !== 'fake' },
      { key: 'NOT_STOPPED', ok: !settings.aiPaused },
      { key: 'SECOND_NUMBER', ok: Boolean(c.WA_SECOND_NUMBER) },
      { key: 'APPEAL_ROUTE', ok: Boolean(c.WA_APPEAL_ROUTE) },
      { key: 'TEMPLATES', ok: c.WA_TEMPLATES_APPROVED },
    ];
    if (to === 'TEST_NUMBERS')
      checks.push({ key: 'TEST_NUMBERS', ok: settings.testNumbers.length > 0 });
    // Plan 07: known customers for a week, then everyone.
    if (to === 'EVERYONE')
      checks.push({
        key: 'KNOWN_WEEK',
        ok: Boolean(
          settings.stageMovedAt &&
          Date.now() - settings.stageMovedAt.getTime() >= knownCustomersFor,
        ),
      });
    return { ready: checks.every((check) => check.ok), checks, gate };
  }

  async view() {
    const settings = await this.wa.settings();
    const next = waStages[levelOf(settings.replyStage) + 1] ?? null;
    return {
      stage: settings.replyStage,
      stageMovedAt: settings.stageMovedAt,
      next,
      readiness: next ? await this.readiness(next) : null,
      testNumbers: settings.testNumbers,
      quietMinutes: settings.quietMinutes,
      nightFromHour: settings.nightFromHour,
      nightToHour: settings.nightToHour,
      mode: getConfig().WA_MODE,
    };
  }

  /** One step up past the check, or any distance down with no check at all. Audited either way. */
  async move(body: z.infer<typeof waStageMoveSchema>, actorId: string) {
    const up = levelOf(body.to) > levelOf(body.from);
    if (levelOf(body.to) > levelOf(body.from) + 1)
      fail('WA_STAGE_JUMP', 'Stages go up one step at a time.');
    if (body.to === body.from) fail('WA_STAGE_CHANGED', 'It is already at that stage.', 409);
    const readiness = up ? await this.readiness(body.to) : null;
    if (readiness && !readiness.ready)
      fail('WA_STAGE_NOT_READY', 'The readiness check has not passed.', 409, {
        failing: readiness.checks.filter((check) => !check.ok).map((check) => check.key),
      });
    await this.wa.settings();
    await this.db.atomic(async (tx) => {
      const moved = await tx.waSettings.updateMany({
        where: { id: 'wa', replyStage: body.from },
        data: { replyStage: body.to, stageMovedAt: new Date(), stageMovedById: actorId },
      });
      if (!moved.count) fail('WA_STAGE_CHANGED', 'Someone else moved it. Look again.', 409);
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'WA_STAGE_MOVED',
          entityId: 'wa',
          details: {
            from: body.from,
            to: body.to,
            ...(readiness
              ? {
                  reviewed: readiness.gate.reviewed,
                  intentPercent: readiness.gate.intentPercent,
                  greenPercent: readiness.gate.greenPercent,
                }
              : {}),
          },
        },
      });
    });
    return this.view();
  }

  async changeSettings(body: z.infer<typeof waReplySettingsSchema>, actorId: string) {
    const c = getConfig();
    // WhatsApp refuses a message from a number to itself, and it would be meaningless anyway.
    if (body.testNumbers?.includes(c.WA_BUSINESS_PHONE ?? ''))
      fail('INVALID_BODY', 'The shop’s own number cannot be a test number.');
    await this.wa.settings();
    await this.db.atomic(async (tx) => {
      await tx.waSettings.update({ where: { id: 'wa' }, data: body });
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'WA_REPLY_SETTINGS_CHANGED',
          entityId: 'wa',
          // How many, never which: a number in the log could not be taken back out of it.
          details: {
            ...(body.testNumbers ? { testNumbers: body.testNumbers.length } : {}),
            ...(body.quietMinutes !== undefined ? { quietMinutes: body.quietMinutes } : {}),
            ...(body.nightFromHour !== undefined ? { nightFromHour: body.nightFromHour } : {}),
            ...(body.nightToHour !== undefined ? { nightToHour: body.nightToHour } : {}),
          },
        },
      });
    });
    return this.view();
  }
}

@ApiTags('WhatsApp')
@Controller('admin/wa')
export class WaStagesController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(WaStages) private stages: WaStages,
  ) {}

  @Can('wa.stage') @Get('reply') view() {
    return this.stages.view();
  }

  @Can('wa.stage')
  @Post('reply/stage')
  @Contract(waStageMoveSchema)
  move(@Input(waStageMoveSchema) body: z.infer<typeof waStageMoveSchema>, @Req() req: AuthRequest) {
    return this.stages.move(body, req.user.id);
  }

  @Can('wa.stage')
  @Patch('reply/settings')
  @Contract(waReplySettingsSchema)
  settings(
    @Input(waReplySettingsSchema) body: z.infer<typeof waReplySettingsSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.stages.changeSettings(body, req.user.id);
  }

  /** The family's list. Anyone working cards picks from it, and only owners keep it. */
  @Can('wa.cards', scoped) @Get('load-sizes') async sizes() {
    const rows = await this.db.waLoadSize.findMany({
      where: { active: true },
      orderBy: [{ productId: 'asc' }, { quantity: 'asc' }],
      select: { id: true, productId: true, label: true, quantity: true },
    });
    return { items: rows };
  }

  @Can('wa.learn')
  @Post('load-sizes')
  @Contract(waLoadSizeSchema)
  async addSize(
    @Input(waLoadSizeSchema) body: z.infer<typeof waLoadSizeSchema>,
    @Req() req: AuthRequest,
  ) {
    try {
      return await this.db.atomic(async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: body.productId, active: true },
          select: { id: true },
        });
        if (!product) fail('NOT_FOUND', 'That product is not on the list.', 404);
        const row = await tx.waLoadSize.create({
          data: { ...body, createdById: req.user.id },
          select: { id: true, productId: true, label: true, quantity: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            event: 'WA_LOAD_SIZE_CHANGED',
            entityId: row.id,
            details: { productId: body.productId, quantity: body.quantity },
          },
        });
        return row;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        fail('WA_LOAD_SIZE_TAKEN', 'That size is already on the list.', 409);
      throw error;
    }
  }

  @Can('wa.learn')
  @Patch('load-sizes/:id')
  @Contract(waLoadSizeChangeSchema)
  async changeSize(
    @Param('id') id: string,
    @Input(waLoadSizeChangeSchema) body: z.infer<typeof waLoadSizeChangeSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const moved = await tx.waLoadSize.updateMany({ where: { id }, data: body });
      if (!moved.count) fail('WA_LOAD_SIZE_NOT_FOUND', 'That size is not on the list.', 404);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'WA_LOAD_SIZE_CHANGED',
          entityId: id,
          details: {
            ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
          },
        },
      });
      return tx.waLoadSize.findUniqueOrThrow({
        where: { id },
        select: { id: true, productId: true, label: true, quantity: true, active: true },
      });
    });
  }

  /** The paper tally, copied in. Calls per 10 WhatsApp orders is what the plan is judged on. */
  @Can('wa.read') @Get('tally') async tally() {
    const rows = await this.db.waCallTally.findMany();
    return {
      items: waTallyPeriods.map((period) => {
        const row = rows.find((item) => item.period === period);
        return {
          period,
          days: row?.days ?? 3,
          calls: row?.calls ?? null,
          orders: row?.orders ?? null,
          perTen: row?.orders ? Math.round((row.calls * 100) / row.orders) / 10 : null,
          updatedAt: row?.updatedAt ?? null,
        };
      }),
    };
  }

  @Can('wa.read')
  @Put('tally/:period')
  @Contract(waTallySchema)
  async saveTally(
    @Param('period') period: string,
    @Input(waTallySchema) body: z.infer<typeof waTallySchema>,
    @Req() req: AuthRequest,
  ) {
    const parsed = z.enum(waTallyPeriods).safeParse(period);
    if (!parsed.success) fail('INVALID_FILTER', 'Check the week.');
    await this.db.atomic(async (tx) => {
      await tx.waCallTally.upsert({
        where: { period: parsed.data },
        create: { period: parsed.data, ...body, recordedById: req.user.id },
        update: { ...body, recordedById: req.user.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'WA_TALLY_RECORDED',
          entityId: parsed.data,
          details: { calls: body.calls, orders: body.orders, days: body.days },
        },
      });
    });
    return this.tally();
  }
}
