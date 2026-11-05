import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getConfig } from '../config';
import { Db } from '../db';
import { contentDir } from './content';
import { ADVISOR_PROMPT_VERSION } from './prompts';

/**
 * Whether Ask may use a model right now, and why not if it may not. A plain answer to one question,
 * asked on every turn, so stopping the AI takes effect at once.
 *
 * With a real provider, Ask stays off until a current safety test exists (plan 11 section 3.8): the
 * eval writes a small report holding no question text, and the API compares it with the prompt,
 * models and signed articles it is running. A quiet change to any of them closes the lock.
 */
export type NotReady =
  | 'ASK_NOT_ENABLED'
  | 'NO_PROVIDER'
  | 'NO_KEY'
  | 'PAUSED'
  | 'NO_SIGNED_ARTICLES'
  | 'EVAL_NEVER_RUN'
  | 'EVAL_FAILED'
  | 'EVAL_OUT_OF_DATE';

const reportSchema = z.object({
  promptVersion: z.string(),
  modelTriage: z.string(),
  modelAnswer: z.string(),
  articleSetHash: z.string(),
  date: z.string(),
  pass: z.boolean(),
});
export type EvalReport = z.infer<typeof reportSchema>;

export const evalReportPath = () => join(contentDir(), 'eval-report.json');

export function readEvalReport(path = evalReportPath()): EvalReport | null {
  if (!existsSync(path)) return null;
  try {
    return reportSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

/** The fingerprint of what customers may be told: which articles, in exactly which words. */
export const articleSetHash = (rows: readonly { slug: string; sha256: string }[]) =>
  createHash('sha256')
    .update(
      rows
        .map((row) => `${row.slug}:${row.sha256}`)
        .sort()
        .join('\n'),
    )
    .digest('hex');

export type Readiness = {
  ok: boolean;
  reasons: NotReady[];
  articleSetHash: string;
  signedArticles: number;
};

@Injectable()
export class AdvisorReadiness {
  constructor(@Inject(Db) private db: Db) {}

  /** The one settings row, or the defaults before anyone has changed them. Reading writes nothing. */
  async settings() {
    const row = await this.db.advisorSettings.findUnique({ where: { id: 'advisor' } });
    return row ?? { aiPaused: false, generalEnabled: true };
  }

  private liveArticles() {
    return this.db.$queryRaw<{ slug: string; sha256: string }[]>(Prisma.sql`
      SELECT "slug", "sha256" FROM "KnowledgeArticle"
      WHERE "kind" = 'GUIDE' AND "status" = 'PUBLISHED' AND "reviewerKey" IS NOT NULL
        AND "reviewDueAt" > (now() AT TIME ZONE 'UTC')`);
  }

  /** Every reason the AI cannot run now. An empty list means it can. */
  async check(): Promise<Readiness> {
    const c = getConfig();
    const reasons: NotReady[] = [];
    if (!c.ASK_ENABLED) reasons.push('ASK_NOT_ENABLED');
    if (c.ADVISOR_PROVIDER === 'fallback') reasons.push('NO_PROVIDER');
    if (c.ADVISOR_PROVIDER === 'anthropic' && !c.ADVISOR_ANTHROPIC_API_KEY) reasons.push('NO_KEY');
    const settings = await this.settings();
    if (settings.aiPaused) reasons.push('PAUSED');
    const live = await this.liveArticles();
    const hash = articleSetHash(live);
    if (c.ADVISOR_PROVIDER === 'anthropic') {
      // A guide with nothing signed gives the model nothing to answer from.
      if (!live.length) reasons.push('NO_SIGNED_ARTICLES');
      const report = readEvalReport();
      if (!report) reasons.push('EVAL_NEVER_RUN');
      else if (!report.pass) reasons.push('EVAL_FAILED');
      else if (
        report.promptVersion !== ADVISOR_PROMPT_VERSION ||
        report.modelTriage !== c.ADVISOR_MODEL_TRIAGE ||
        report.modelAnswer !== c.ADVISOR_MODEL_ANSWER ||
        report.articleSetHash !== hash
      )
        reasons.push('EVAL_OUT_OF_DATE');
    }
    return { ok: reasons.length === 0, reasons, articleSetHash: hash, signedArticles: live.length };
  }

  /** What the app and website read: whether to show Ask at all. Needs no database when off. */
  async askEnabled(): Promise<boolean> {
    if (!getConfig().ASK_ENABLED) return false;
    return (await this.check()).ok;
  }
}
