import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { expandTerms, type AdvisorArticleLink } from '@shiv/shared';
import { Db } from '../db';
import { romanizeHindi } from './understand-hindi';

/** One section of a signed article, ready to send to the model or show word for word. */
export type RetrievedChunk = {
  articleId: string;
  slug: string;
  title: string;
  titleHinglish: string;
  summary: string;
  anchor: string;
  heading: string;
  blocks: string[];
  materials: string[];
  relatedQuestions: { en: string; hinglish: string }[];
  /** "2027-03". Null only for a shop's own answer. */
  checkedOn: string | null;
  kind: 'GUIDE' | 'SHOP';
  /** How many of the question's words this section holds. */
  matches: number;
};

const MAX_SECTIONS = 5;
const RRF_K = 60;

type Row = {
  articleId: string;
  slug: string;
  titleEn: string;
  titleHinglish: string;
  summary: string;
  anchor: string;
  heading: string;
  blocks: unknown;
  materials: string[];
  relatedQuestions: unknown;
  reviewedAt: Date | null;
  kind: string;
  matches: number;
  rank: number;
};

// A published guide must have a reviewer and a future date, and the migration's check holds the
// first of those in the database too. A draft or expired article cannot come out of here.
const live = Prisma.sql`a."status" = 'PUBLISHED'
  AND (a."kind" = 'SHOP' OR (a."reviewerKey" IS NOT NULL AND a."reviewDueAt" > (now() AT TIME ZONE 'UTC')))`;

const toChunk = (row: Row): RetrievedChunk => ({
  articleId: row.articleId,
  slug: row.slug,
  title: row.titleEn,
  titleHinglish: row.titleHinglish,
  summary: row.summary,
  anchor: row.anchor,
  heading: row.heading,
  blocks: Array.isArray(row.blocks) ? (row.blocks as string[]) : [],
  materials: row.materials,
  relatedQuestions: Array.isArray(row.relatedQuestions)
    ? (row.relatedQuestions as { en: string; hinglish: string }[])
    : [],
  checkedOn: row.reviewedAt ? row.reviewedAt.toISOString().slice(0, 7) : null,
  kind: row.kind === 'SHOP' ? 'SHOP' : 'GUIDE',
  matches: Number(row.matches),
});

/**
 * Finds the sections for a question: the articles triage picked, then literal search on the words
 * and on article aliases, merged by reciprocal rank. All of this runs in Postgres, so a search costs
 * nothing, and with no AI at all it still finds the guide's answer.
 */
@Injectable()
export class AdvisorRetrieve {
  constructor(@Inject(Db) private db: Db) {}

  async search(
    question: string,
    options: { picks?: readonly string[]; kind?: 'GUIDE' | 'SHOP'; limit?: number } = {},
  ): Promise<RetrievedChunk[]> {
    const kind = options.kind ?? 'GUIDE';
    const limit = Math.min(options.limit ?? MAX_SECTIONS, MAX_SECTIONS);
    const words = expandTerms(romanizeHindi(question)).slice(0, 800);
    const picks = [...(options.picks ?? [])].slice(0, 3);
    const literal = await this.db.$queryRaw<Row[]>`
      WITH q AS (
        SELECT array(SELECT unnest(tsvector_to_array(to_tsvector('english', ${words})))) AS lexemes
      )
      SELECT a."id" AS "articleId", a."slug", a."titleEn", a."titleHinglish", a."summary",
             c."anchor", c."heading", c."blocks", a."materials", a."relatedQuestions", a."reviewedAt", a."kind",
             (SELECT count(*)::int FROM unnest(tsvector_to_array(c."tsv")) AS lex, q WHERE lex = ANY(q.lexemes)) AS "matches",
             ts_rank_cd(c."tsv", to_tsquery('simple', array_to_string(
               (SELECT array_agg(quote_literal(l)) FROM unnest((SELECT lexemes FROM q)) AS l), ' | '))) AS "rank"
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeArticle" a ON a."id" = c."articleId" AND c."articleVersion" = a."version"
      CROSS JOIN q
      WHERE ${live} AND a."kind" = ${kind} AND cardinality(q.lexemes) > 0
        AND c."tsv" @@ to_tsquery('simple', array_to_string(
               (SELECT array_agg(quote_literal(l)) FROM unnest(q.lexemes) AS l), ' | '))
      ORDER BY "rank" DESC, a."number" ASC NULLS LAST, c."ordinal" ASC
      LIMIT 12`;
    // An alias is a phrase a customer might say, in any script. It counts when it is in the question.
    const asked = romanizeHindi(question).toLowerCase();
    const raw = question.toLowerCase();
    const aliased = await this.db.$queryRaw<Row[]>`
      SELECT a."id" AS "articleId", a."slug", a."titleEn", a."titleHinglish", a."summary",
             c."anchor", c."heading", c."blocks", a."materials", a."relatedQuestions", a."reviewedAt", a."kind",
             2 AS "matches",
             (SELECT max(greatest(word_similarity(lower(al), ${asked}), word_similarity(lower(al), ${raw})))
                FROM unnest(a."aliases") AS al)::float AS "rank"
      FROM "KnowledgeArticle" a
      JOIN "KnowledgeChunk" c ON c."articleId" = a."id" AND c."articleVersion" = a."version" AND c."ordinal" = 0
      WHERE ${live} AND a."kind" = ${kind} AND EXISTS (
        SELECT 1 FROM unnest(a."aliases") AS al
        WHERE strpos(${asked}, lower(al)) > 0 OR strpos(${raw}, lower(al)) > 0
          OR word_similarity(lower(al), ${asked}) >= 0.8
      )
      ORDER BY "rank" DESC NULLS LAST, a."number" ASC NULLS LAST
      LIMIT 3`;
    const picked = picks.length
      ? await this.db.$queryRaw<Row[]>`
      SELECT a."id" AS "articleId", a."slug", a."titleEn", a."titleHinglish", a."summary",
             c."anchor", c."heading", c."blocks", a."materials", a."relatedQuestions", a."reviewedAt", a."kind",
             2 AS "matches", 1.0::float AS "rank"
      FROM "KnowledgeArticle" a
      JOIN "KnowledgeChunk" c ON c."articleId" = a."id" AND c."articleVersion" = a."version"
      WHERE ${live} AND a."kind" = ${kind} AND a."slug" IN (${Prisma.join(picks)})
      ORDER BY array_position(${picks}::text[], a."slug"), c."ordinal" ASC
      LIMIT 6`
      : [];
    // A literal hit on a single common word is not an answer, so it needs two of the question's words.
    const strong = literal.filter((row) => Number(row.matches) >= 2);
    const score = new Map<string, { row: Row; score: number }>();
    const add = (rows: Row[], weight = 1) =>
      rows.forEach((row, index) => {
        const key = `${row.articleId}#${row.anchor}`;
        const entry = score.get(key) ?? { row, score: 0 };
        entry.score += weight / (RRF_K + index + 1);
        score.set(key, entry);
      });
    // Picks first: triage read the question in the customer's own language.
    add(picked, 3);
    add(aliased, 2);
    add(strong);
    return [...score.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row }) => toChunk(row));
  }

  /** The articles that match, for showing as links at a limit. Never a draft. */
  async articleLinks(question: string): Promise<AdvisorArticleLink[]> {
    const chunks = await this.search(question);
    const seen = new Set<string>();
    const links: AdvisorArticleLink[] = [];
    for (const chunk of chunks) {
      if (seen.has(chunk.slug)) continue;
      seen.add(chunk.slug);
      links.push({
        slug: chunk.slug,
        title: chunk.title,
        titleHinglish: chunk.titleHinglish,
        summary: chunk.summary,
        href: `/guide/${chunk.slug}`,
      });
    }
    return links.slice(0, 3);
  }

  /** Titles and summaries of everything live, for triage to pick from. Built fresh each call. */
  async index() {
    const rows = await this.db.$queryRaw<
      { slug: string; titleEn: string; summary: string; aliases: string[]; sha256: string }[]
    >`
      SELECT a."slug", a."titleEn", a."summary", a."aliases", a."sha256"
      FROM "KnowledgeArticle" a
      WHERE ${live} AND a."kind" = 'GUIDE'
      ORDER BY a."number" ASC NULLS LAST, a."slug" ASC`;
    return rows;
  }
}
