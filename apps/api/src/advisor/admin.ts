import { Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { istToday, microUsdToPaise } from '@shiv/shared';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getConfig } from '../config';
import { Db } from '../db';
import { AuthRequest, Can, Contract, fail, Input } from '../http';
import { paginate } from '../pagination';
import { AdvisorBudgets } from './budgets';
import { floorCheck } from './floor';
import { numbersIn, wordCount } from './gate';
import { AdvisorReadiness, readEvalReport } from './readiness';
import { cleanInput, scrub } from './scrub';
import { hasDevanagari } from './understand-hindi';

const gapStatuses = ['NEW', 'ASKED_ENGINEER', 'ANSWERED', 'IGNORED'] as const;
const gapList = z.object({ status: z.enum(gapStatuses).default('NEW') });
const gapPatch = z.strictObject({
  // Only a shop answer marks a gap answered. An owner can only pass it on or drop it here.
  status: z.enum(['ASKED_ENGINEER', 'IGNORED']),
});
const shopAnswerInput = z.strictObject({
  gapId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .optional(),
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(3).max(800),
});
const settingsPatch = z
  .strictObject({ aiPaused: z.boolean().optional(), generalEnabled: z.boolean().optional() })
  .refine((body) => body.aiPaused !== undefined || body.generalEnabled !== undefined, {
    message: 'Nothing to change.',
  });

const shopAnswerProblem = (text: string) => {
  if (wordCount(text) > 120) return 'Keep it under 120 words.';
  if (hasDevanagari(text)) return 'Write it in Roman script, as customers will read it.';
  if (/(https?:\/\/|www\.|<\/?[a-z])/i.test(text)) return 'Take out any link or code.';
  if (
    /\b(best|lowest|cheapest|guarantee|guaranteed|pakka|sabse sasta|tile|tiles|putty|paint)\b/i.test(
      text,
    )
  )
    return 'Take out words that promise or rank, and materials the shop does not stock.';
  return null;
};

/** Owners answer what customers ask about the shop. Anything technical goes to the engineer. */
@ApiTags('Owner Ask')
@Controller('admin/advisor')
export class AdvisorAdminController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(AdvisorBudgets) private budgets: AdvisorBudgets,
    @Inject(AdvisorReadiness) private readiness: AdvisorReadiness,
  ) {}

  @Can('advisor.review')
  @Get('gaps')
  async gaps(@Query() query: Record<string, string>) {
    const parsed = gapList.safeParse({ status: query.status });
    if (!parsed.success) fail('INVALID_INPUT', 'Choose a status from the list.');
    const page = paginate(
      { limit: query.limit, cursor: query.cursor },
      `advisor-gaps:${parsed.data.status}`,
      'lastSeen',
      'desc',
    );
    const rows = await this.db.advisorGap.findMany({
      where: { AND: [{ status: parsed.data.status }, page.after] },
      orderBy: page.orderBy,
      take: page.take,
      select: {
        id: true,
        canonical: true,
        samples: true,
        count: true,
        kind: true,
        status: true,
        firstSeen: true,
        lastSeen: true,
      },
    });
    return page.finish(rows);
  }

  @Can('advisor.review')
  @Patch('gaps/:id')
  @Contract(gapPatch)
  async decide(
    @Param('id') id: string,
    @Input(gapPatch) input: z.infer<typeof gapPatch>,
    @Req() req: AuthRequest,
  ) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id))
      fail('NOT_FOUND', 'This question could not be found.', 404);
    return this.db.atomic(async (tx) => {
      const gap = await tx.advisorGap.findUnique({ where: { id } });
      if (!gap) fail('NOT_FOUND', 'This question could not be found.', 404);
      const updated = await tx.advisorGap.update({
        where: { id },
        data: { status: input.status, decidedById: req.user.id, decidedAt: new Date() },
        select: { id: true, status: true, count: true, kind: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'ADVISOR_GAP_DECIDED',
          entityId: id,
          details: { status: input.status },
        },
      });
      return updated;
    });
  }

  /**
   * Jawab likho, for shop facts only. Published as the shop's own answer under the owner's name. It
   * can never answer a structural or safety question, however sure the person typing feels.
   */
  @Can('advisor.review')
  @Post('shop-answers')
  @Contract(shopAnswerInput)
  async shopAnswer(
    @Input(shopAnswerInput) input: z.infer<typeof shopAnswerInput>,
    @Req() req: AuthRequest,
  ) {
    const question = scrub(cleanInput(input.question, 300));
    const answer = scrub(cleanInput(input.answer, 800));
    const floorQuestion = floorCheck(question);
    const floorAnswer = floorCheck(answer);
    if (floorQuestion || floorAnswer || numbersIn(answer).length > 8)
      fail(
        'ADVISOR_NOT_SHOP_FACT',
        'This needs an engineer. Choose "Engineer se poochho" for it.',
        400,
      );
    const problem = shopAnswerProblem(answer);
    if (problem) fail('INVALID_INPUT', problem);
    return this.db.atomic(async (tx) => {
      if (input.gapId) {
        const gap = await tx.advisorGap.findUnique({ where: { id: input.gapId } });
        if (!gap) fail('NOT_FOUND', 'This question could not be found.', 404);
        if (!['SHOP_FACT', 'NOT_LISTED'].includes(gap.kind))
          fail(
            'ADVISOR_NOT_SHOP_FACT',
            'This needs an engineer. Choose "Engineer se poochho" for it.',
            400,
          );
      }
      const slug = `shop-${randomBytes(6).toString('hex')}`;
      const article = await tx.knowledgeArticle.create({
        data: {
          slug,
          kind: 'SHOP',
          status: 'PUBLISHED',
          titleEn: question.slice(0, 120),
          titleHinglish: question.slice(0, 120),
          summary: question.slice(0, 200),
          aliases: [question.toLowerCase()],
          aliasText: question.toLowerCase(),
          stages: [],
          materials: [],
          standardsMentioned: [],
          bodyEn: answer,
          sha256: createHash('sha256').update(`${question}\n${answer}`).digest('hex'),
          approvedById: req.user.id,
          chunks: {
            create: {
              articleVersion: 1,
              ordinal: 0,
              anchor: 'answer',
              heading: question,
              blocks: [answer],
              body: answer,
            },
          },
        },
        select: { id: true, slug: true, titleEn: true, bodyEn: true, status: true },
      });
      if (input.gapId)
        await tx.advisorGap.update({
          where: { id: input.gapId },
          data: {
            status: 'ANSWERED',
            articleId: article.id,
            decidedById: req.user.id,
            decidedAt: new Date(),
          },
        });
      // Which article and who approved it. The words themselves stay on the article.
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'ADVISOR_SHOP_ANSWER_APPROVED',
          entityId: article.id,
          details: { slug: article.slug, gapId: input.gapId ?? null },
        },
      });
      return article;
    });
  }

  @Can('advisor.review')
  @Get('shop-answers')
  async shopAnswers() {
    const items = await this.db.knowledgeArticle.findMany({
      where: { kind: 'SHOP', status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        slug: true,
        titleEn: true,
        bodyEn: true,
        approvedById: true,
        createdAt: true,
      },
    });
    return { items };
  }

  @Can('advisor.review')
  @Post('shop-answers/:id/retire')
  async retire(@Param('id') id: string, @Req() req: AuthRequest) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id))
      fail('NOT_FOUND', 'This answer could not be found.', 404);
    return this.db.atomic(async (tx) => {
      const article = await tx.knowledgeArticle.findUnique({ where: { id } });
      if (!article || article.kind !== 'SHOP')
        fail('NOT_FOUND', 'This answer could not be found.', 404);
      const updated = await tx.knowledgeArticle.update({
        where: { id },
        data: { status: 'RETIRED' },
        select: { id: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'ADVISOR_SHOP_ANSWER_RETIRED',
          entityId: id,
          details: {},
        },
      });
      return updated;
    });
  }

  /** Numbers only, for the operator. Never a customer's words. */
  @Can('advisor.health')
  @Get('health')
  async health() {
    const c = getConfig();
    const since = new Date(`${istToday()}T00:00:00+05:30`);
    const levels = await this.db.advisorTurn.groupBy({
      by: ['level'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const count = (where: object) =>
      this.db.advisorTurn.count({ where: { createdAt: { gte: since }, ...where } });
    const [blocked, limited, cacheAnswers, notRight, tokens, ready, settings, spent] =
      await Promise.all([
        count({ gateFlags: { hasSome: gateBlocks } }),
        count({ limitReached: { not: null } }),
        count({ modelAnswer: 'cache' }),
        count({ feedback: 'NOT_RIGHT' }),
        this.db.advisorTurn.aggregate({
          where: { createdAt: { gte: since } },
          _sum: { inputTokens: true, cachedTokens: true, outputTokens: true },
        }),
        this.readiness.check(),
        this.readiness.settings(),
        this.budgets.spent(),
      ]);
    const articles = await this.db.knowledgeArticle.groupBy({
      by: ['kind', 'status'],
      _count: { _all: true },
    });
    const openGaps = await this.db.advisorGap.count({ where: { status: 'NEW' } });
    const report = readEvalReport();
    const input = tokens._sum.inputTokens ?? 0;
    const cached = tokens._sum.cachedTokens ?? 0;
    const paise = (microUsd: number) => microUsdToPaise(microUsd);
    return {
      askEnabled: c.ASK_ENABLED && ready.ok,
      provider: c.ADVISOR_PROVIDER,
      notReady: ready.reasons,
      aiPaused: settings.aiPaused,
      generalEnabled: settings.generalEnabled,
      models: { triage: c.ADVISOR_MODEL_TRIAGE, answer: c.ADVISOR_MODEL_ANSWER },
      today: {
        turns: Object.fromEntries(levels.map((row) => [row.level, row._count._all])),
        gateBlocks: blocked,
        limitsReached: limited,
        answeredFromCache: cacheAnswers,
        notRight,
        promptCacheShare: input + cached ? Number((cached / (input + cached)).toFixed(3)) : 0,
        outputTokens: tokens._sum.outputTokens ?? 0,
      },
      money: {
        todayPaise: paise(spent.todayMicroUsd),
        todayCapPaise: paise(c.ADVISOR_DAILY_BUDGET_MICRO_USD),
        monthPaise: paise(spent.monthMicroUsd),
        monthCapPaise: paise(c.ADVISOR_MONTHLY_BUDGET_MICRO_USD),
      },
      articles: articles.map((row) => ({
        kind: row.kind,
        status: row.status,
        count: row._count._all,
      })),
      signedArticlesLive: ready.signedArticles,
      openGaps,
      lastEval: report
        ? { date: report.date, pass: report.pass, promptVersion: report.promptVersion }
        : null,
    };
  }

  /** Stop the AI, or just its unchecked level, at once. Fixed text and the guide keep working. */
  @Can('advisor.control')
  @Patch('settings')
  @Contract(settingsPatch)
  async settings(
    @Input(settingsPatch) input: z.infer<typeof settingsPatch>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const data = {
        ...(input.aiPaused === undefined ? {} : { aiPaused: input.aiPaused }),
        ...(input.generalEnabled === undefined ? {} : { generalEnabled: input.generalEnabled }),
        updatedById: req.user.id,
      };
      const settings = await tx.advisorSettings.upsert({
        where: { id: 'advisor' },
        create: { id: 'advisor', ...data },
        update: data,
        select: { aiPaused: true, generalEnabled: true, updatedAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'ADVISOR_SETTINGS_CHANGED',
          entityId: 'advisor',
          details: { aiPaused: settings.aiPaused, generalEnabled: settings.generalEnabled },
        },
      });
      return settings;
    });
  }
}

// Every way the gate can stop an answer, as they appear in AdvisorTurn.gateFlags.
const gateBlocks = [
  'NUMBER',
  'RUPEES',
  'RATIO',
  'COMMITMENT',
  'VERDICT',
  'PRESCRIPTION',
  'NOT_STOCKED',
  'URL',
  'MARKDOWN',
  'HTML',
  'PHONE',
  'DEVANAGARI',
  'NOT_LATIN',
  'HIDDEN_TEXT',
  'TOO_LONG',
  'NO_SOURCE',
  'STOP_REASON',
  'NO_TEXT',
].map((flag) => `GATE:${flag}`);
