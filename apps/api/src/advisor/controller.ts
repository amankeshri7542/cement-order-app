import { Controller, Delete, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  advisorFeedbackInput,
  advisorTurnInput,
  type AdvisorEvent,
  type AdvisorFeedbackInput,
  type AdvisorTurnInput,
  type GuideArticle,
  type GuideListItem,
} from '@shiv/shared';
import { clientIp } from '../abuse';
import { Db } from '../db';
import { AuthRequest, Contract, fail, Input, Public } from '../http';
import { Lifecycle } from '../lifecycle';
import { AdvisorBudgets } from './budgets';
import { AdvisorCore } from './core';
import { mintDeviceToken, requireDevice, signedInUser } from './device';

const HEARTBEAT_MS = 10_000;

const guideWhere = () => ({
  kind: 'GUIDE',
  status: 'PUBLISHED',
  reviewerKey: { not: null },
  reviewDueAt: { gt: new Date() },
});
const checkedOn = (date: Date | null) => (date ? date.toISOString().slice(0, 7) : null);

/**
 * Ask's public routes. A guest needs only a device token, which holds no identity. A session, if one
 * is sent, is used for the higher daily limit and nothing else.
 */
@ApiTags('Ask')
@Controller()
export class AdvisorController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(AdvisorCore) private core: AdvisorCore,
    @Inject(AdvisorBudgets) private budgets: AdvisorBudgets,
    @Inject(Lifecycle) private lifecycle: Lifecycle,
  ) {}

  @Public()
  @Post('advisor/device')
  async device(@Req() req: AuthRequest) {
    await this.budgets.mint(clientIp(req));
    return { deviceToken: mintDeviceToken() };
  }

  @Public()
  @Post('advisor/turns')
  @Contract(advisorTurnInput)
  async turn(
    @Input(advisorTurnInput) input: AdvisorTurnInput,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const tokenHash = requireDevice(req);
    const ip = clientIp(req);
    const userId = await signedInUser(this.db, req);
    const { turn, replay } = await this.core.begin(input, tokenHash, ip);
    const streaming = /\btext\/event-stream\b/.test(req.headers.accept ?? '');
    if (!streaming) {
      // A dropped connection does not stop the answer: it is ready at GET /advisor/turns/:id.
      const view = replay
        ? await this.core.read(turn.id, tokenHash)
        : await this.core.run(turn, { input, ip, userId });
      if (!res.writableEnded) res.status(replay ? 200 : 201).json(view);
      return;
    }
    res.status(replay ? 200 : 201);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    let open = true;
    const write = (text: string) => {
      if (open && !res.writableEnded) res.write(text);
    };
    const emit = (event: AdvisorEvent) =>
      write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    const heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS);
    heartbeat.unref();
    const stop = () => {
      open = false;
      clearInterval(heartbeat);
      closing.unsubscribe();
    };
    res.on('close', stop);
    const closing = this.lifecycle.closing.subscribe(() => {
      stop();
      res.end();
    });
    try {
      if (replay) {
        const view = await this.core.read(turn.id, tokenHash);
        emit({ type: 'status', turnId: view.id, clientTurnId: view.clientTurnId, text: '' });
        emit({ type: 'done', turn: view });
      } else {
        await this.core.run(turn, { input, ip, userId }, emit);
      }
    } finally {
      stop();
      if (!res.writableEnded) res.end();
    }
  }

  @Public()
  @Get('advisor/turns/:id')
  read(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.core.read(id, requireDevice(req));
  }

  @Public()
  @Post('advisor/turns/:id/cancel')
  cancel(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.core.cancel(id, requireDevice(req));
  }

  @Public()
  @Post('advisor/turns/:id/feedback')
  @Contract(advisorFeedbackInput)
  feedback(
    @Param('id') id: string,
    @Input(advisorFeedbackInput) input: AdvisorFeedbackInput,
    @Req() req: AuthRequest,
  ) {
    return this.core.feedback(id, requireDevice(req), input);
  }

  @Public()
  @Delete('advisor/conversations/current')
  clear(@Req() req: AuthRequest) {
    return this.core.clear(requireDevice(req));
  }

  /** Signed articles only. Until an engineer has signed, this list is empty, on purpose. */
  @Public()
  @Get('guide')
  async guide(): Promise<{ items: GuideListItem[] }> {
    const rows = await this.db.knowledgeArticle.findMany({
      where: guideWhere(),
      orderBy: [{ number: 'asc' }, { slug: 'asc' }],
      select: {
        slug: true,
        titleEn: true,
        titleHinglish: true,
        summary: true,
        stages: true,
        materials: true,
        reviewedAt: true,
      },
    });
    return {
      items: rows.map((row) => ({
        slug: row.slug,
        title: row.titleEn,
        titleHinglish: row.titleHinglish,
        summary: row.summary,
        stages: row.stages,
        materials: row.materials,
        checkedOn: checkedOn(row.reviewedAt),
      })),
    };
  }

  @Public()
  @Get('guide/:slug')
  async article(@Param('slug') slug: string): Promise<GuideArticle> {
    if (!/^[a-z0-9-]{1,120}$/.test(slug))
      fail('NOT_FOUND', 'This guide page could not be found.', 404);
    const row = await this.db.knowledgeArticle.findFirst({
      where: { slug, ...guideWhere() },
      include: { chunks: { orderBy: { ordinal: 'asc' } } },
    });
    if (!row) fail('NOT_FOUND', 'This guide page could not be found.', 404);
    return {
      slug: row.slug,
      title: row.titleEn,
      titleHinglish: row.titleHinglish,
      summary: row.summary,
      stages: row.stages,
      materials: row.materials,
      checkedOn: checkedOn(row.reviewedAt),
      version: row.version,
      sections: row.chunks
        .filter((chunk) => chunk.articleVersion === row.version)
        .map((chunk) => ({
          id: chunk.anchor,
          heading: chunk.heading,
          blocks: chunk.blocks as string[],
        })),
      relatedQuestions: (row.relatedQuestions as { en: string }[]).map((item) => item.en),
      standardsMentioned: row.standardsMentioned,
      reviewDueOn: row.reviewDueAt ? row.reviewDueAt.toISOString().slice(0, 10) : null,
    };
  }
}
