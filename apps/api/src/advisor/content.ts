import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { numbersIn, wordCount } from './gate';
import { hasDevanagari } from './understand-hindi';

/**
 * The guide lives as files in content/advisor/ (decision 24). An article reaches a customer only
 * when signoff.json names its exact text: the sign-off binds to a hash, so editing one word takes
 * the article down at the next sync, and the reviewer has to read it again. Every article written
 * so far is a draft waiting for an engineer. A real name never goes in the repo, only a key.
 */
export const MAX_ARTICLE_WORDS = 500;
export const MIN_SECTION_WORDS = 80;
export const MAX_SECTION_WORDS = 200;
/** Months a sign-off lasts, unless the entry's own due date is sooner. */
export const REVIEW_MONTHS = 12;

const question = z.strictObject({
  en: z.string().min(3).max(160),
  hinglish: z.string().min(3).max(160),
});
const frontmatter = z.strictObject({
  id: z.number().int().min(1).max(999),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  /** DRAFT until an engineer has signed. SIGNED needs a matching entry in signoff.json. */
  status: z.enum(['DRAFT', 'SIGNED']),
  /** Who must sign: E an engineer, F the family. */
  sign: z.enum(['E', 'F', 'E+F']),
  title: z.string().min(3).max(120),
  title_hinglish: z.string().min(3).max(120),
  summary: z.string().min(10).max(200),
  aliases: z.array(z.string().min(2).max(80)).max(40),
  stages: z.array(z.string().min(2).max(40)).max(10),
  materials: z.array(z.string().min(2).max(40)).max(10),
  related_questions: z.array(question).max(6),
  references: z.array(z.string().min(3).max(200)).max(12),
  standards_mentioned: z.array(z.string().min(3).max(60)).max(12),
  numbers_ok: z.array(z.number()).max(40),
});
export type ArticleMeta = z.infer<typeof frontmatter>;

export type ArticleSection = { anchor: string; heading: string; blocks: string[] };
export type Article = ArticleMeta & {
  file: string;
  sections: ArticleSection[];
  bodyEn: string;
  sha256: string;
};

const signoffEntry = z.strictObject({
  slug: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** A key such as ENG-1 or FAM-1. Never a name. */
  reviewer: z.string().regex(/^(ENG|FAM)-\d{1,3}$/),
  on: z.iso.date(),
  due: z.iso.date(),
});
const signoffFile = z.strictObject({ signoffs: z.array(signoffEntry) });
export type Signoff = z.infer<typeof signoffEntry>;

/**
 * The hash covers everything the reviewer read. Only the status line is left out, so that marking
 * an article SIGNED after the signature does not itself change what was signed.
 */
export function articleHash(raw: string) {
  const text = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^status:\s/.test(line))
    .join('\n');
  return createHash('sha256').update(text).digest('hex');
}

const anchorOf = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'section';

export function parseArticle(file: string, raw: string): Article {
  const text = raw.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${file}: no frontmatter`);
  const meta: Record<string, unknown> = {};
  for (const line of match[1]!.split('\n')) {
    const field = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!field) throw new Error(`${file}: cannot read the line "${line}"`);
    // Values are JSON, which is also valid YAML, so nothing new has to be installed to read them.
    try {
      meta[field[1]!] = JSON.parse(field[2]!);
    } catch {
      meta[field[1]!] = field[2]!;
    }
  }
  const parsed = frontmatter.safeParse(meta);
  if (!parsed.success)
    throw new Error(
      `${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    );
  const sections: ArticleSection[] = [];
  const used = new Map<string, number>();
  let current: ArticleSection | null = null;
  let paragraph: string[] = [];
  const close = () => {
    if (paragraph.length && current) current.blocks.push(paragraph.join(' '));
    paragraph = [];
  };
  for (const line of match[2]!.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      close();
      const heading = trimmed.slice(3).trim();
      const base = anchorOf(heading);
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      current = { anchor: seen ? `${base}-${seen + 1}` : base, heading, blocks: [] };
      sections.push(current);
    } else if (!trimmed) {
      close();
    } else if (trimmed.startsWith('- ')) {
      close();
      if (current) current.blocks.push(trimmed.slice(2).trim());
    } else if (current) {
      paragraph.push(trimmed);
    } else {
      throw new Error(`${file}: text before the first ## heading`);
    }
  }
  close();
  return {
    ...parsed.data,
    file,
    sections,
    bodyEn: sections.map((s) => `## ${s.heading}\n${s.blocks.join('\n')}`).join('\n\n'),
    sha256: articleHash(raw),
  };
}

// Plan 01's banned words in Simple English, and the claims nobody may make (brief rule 5).
const bannedWords =
  /\b(revision|conversion|acknowledge|exception|retry|request|review|session|device|ledger|adjust|override|queue|reserved|serviceable|proceed|kindly|best|lowest|cheapest|guaranteed?|most people|everyone uses)\b/i;
// Decision 51: not stocked, so not in the guide.
const notStocked =
  /\b(tiles?|tiling|putty|paint|paints|distemper|primer|marble|granite|finishing)\b/i;
// Text aimed at a model, not at a homeowner. Article text is sent to the model, so this is a door.
const aimedAtModel =
  /\b(ignore|disregard)\b.{0,40}\b(instructions?|rules?|prompt)\b|\bsystem prompt\b|\b(system|assistant|developer)\s*:|<\/?\s*\w+[^>]*>|\byou are (now )?(an? )?(ai|model|assistant)\b/i;
const linkLike = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|org|net|io|co)\b)/i;
const ratioLike = /(?<!\d)\d+(?:\.\d+)?\s*:\s*\d(?!\d)|\bm\s?-?\s?(10|15|20|25|30|35|40)\b/i;
const structureWord =
  /\b(slab|chhat|lenter|lintel|beam|column|pillar|footing|foundation|neev|plinth|staircase)\b/i;
const sizeLike =
  /\d+(?:\.\d+)?\s*(mm|cm|inch|inches|ft|feet|foot|kg|quintal|ton|tonne|bags?|bori|cft)\b/i;

/** Everything that keeps an article out, whatever its signature says. */
export function articleProblems(article: Article): string[] {
  const problems: string[] = [];
  const all = [article.title, ...article.sections.flatMap((s) => [s.heading, ...s.blocks])].join(
    '\n',
  );
  const total = wordCount(all);
  if (total > MAX_ARTICLE_WORDS) problems.push(`has ${total} words, over ${MAX_ARTICLE_WORDS}`);
  if (!article.sections.length) problems.push('has no ## sections');
  for (const section of article.sections) {
    const words = wordCount(section.blocks.join(' '));
    if (words < MIN_SECTION_WORDS || words > MAX_SECTION_WORDS)
      problems.push(
        `section "${section.heading}" has ${words} words, not ${MIN_SECTION_WORDS} to ${MAX_SECTION_WORDS}`,
      );
  }
  if (hasDevanagari(all)) problems.push('has Devanagari in its body');
  const pattern = (name: string, regex: RegExp) => {
    const found = regex.exec(all);
    if (found) problems.push(`has ${name}: "${found[0]}"`);
  };
  pattern('a banned word', bannedWords);
  pattern('a material the shop does not stock', notStocked);
  pattern('text aimed at a model', aimedAtModel);
  pattern('a link in its body', linkLike);
  pattern('a mix ratio', ratioLike);
  // Never a size or a quantity for a part of the structure, in the same sentence as that part.
  for (const sentence of all.split(/(?<=[.!?])\s+|\n/)) {
    if (structureWord.test(sentence) && sizeLike.test(sentence))
      problems.push(`gives a size for a part of the structure: "${sentence.slice(0, 80)}"`);
  }
  const allowed = new Set(article.numbers_ok);
  for (const value of new Set(numbersIn(all)))
    if (!allowed.has(value)) problems.push(`has the number ${value}, which is not in numbers_ok`);
  return problems;
}

export type SignState = 'SIGNED' | 'UNSIGNED' | 'STALE' | 'EXPIRED';

/** Whether an article's exact text carries a live signature. */
export function signState(article: Article, signoffs: readonly Signoff[], now: Date): SignState {
  const entry = signoffs.find((item) => item.slug === article.slug);
  if (!entry) return 'UNSIGNED';
  if (entry.sha256 !== article.sha256) return 'STALE';
  if (new Date(`${entry.due}T23:59:59+05:30`) <= now) return 'EXPIRED';
  return 'SIGNED';
}

/** Where the content folder is, from the repo root, the API's folder or the Docker image. */
export function contentDir() {
  const candidates = [
    process.env.ADVISOR_CONTENT_DIR,
    resolve(process.cwd(), 'content/advisor'),
    resolve(process.cwd(), '../../content/advisor'),
  ].filter((path): path is string => Boolean(path));
  return candidates.find((path) => existsSync(path)) ?? candidates[candidates.length - 1]!;
}

export type LoadedContent = { articles: Article[]; signoffs: Signoff[]; errors: string[] };

export function loadContent(dir = contentDir()): LoadedContent {
  const errors: string[] = [];
  const articles: Article[] = [];
  let signoffs: Signoff[] = [];
  const signoffPath = join(dir, 'signoff.json');
  try {
    signoffs = signoffFile.parse(JSON.parse(readFileSync(signoffPath, 'utf8'))).signoffs;
  } catch (error) {
    errors.push(
      `signoff.json cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()) {
    try {
      articles.push(parseArticle(name, readFileSync(join(dir, name), 'utf8')));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { articles, signoffs, errors };
}

/**
 * What CI runs. Every article must pass the rules below. Unsigned drafts are fine day to day, as
 * they cannot reach a customer. With `launch` set, every article must also carry a live signature,
 * which is what has to be true before Ask opens.
 */
export function checkContent(
  content: LoadedContent,
  now: Date,
  options: { launch?: boolean } = {},
) {
  const problems = [...content.errors];
  const slugs = new Set<string>();
  const ids = new Set<number>();
  for (const article of content.articles) {
    const name = article.file;
    if (slugs.has(article.slug)) problems.push(`${name}: slug ${article.slug} is used twice`);
    if (ids.has(article.id)) problems.push(`${name}: id ${article.id} is used twice`);
    slugs.add(article.slug);
    ids.add(article.id);
    for (const problem of articleProblems(article)) problems.push(`${name}: ${problem}`);
    const state = signState(article, content.signoffs, now);
    if (article.status === 'SIGNED' && state !== 'SIGNED')
      problems.push(`${name}: says SIGNED, but its signature is ${state.toLowerCase()}`);
    if (article.status === 'DRAFT' && state === 'SIGNED')
      problems.push(`${name}: has a live signature but still says DRAFT`);
    if (state === 'STALE') problems.push(`${name}: the text changed after it was signed`);
    if (options.launch && state !== 'SIGNED')
      problems.push(`${name}: needs a signature before launch (${state.toLowerCase()})`);
  }
  for (const entry of content.signoffs)
    if (!slugs.has(entry.slug)) problems.push(`signoff.json: ${entry.slug} has no article`);
  return problems;
}

export type SyncResult = {
  published: string[];
  drafts: string[];
  retired: string[];
  refused: string[];
};

/**
 * Makes the database match the folder. An article is PUBLISHED only with a live signature and no
 * problems; any other state clears its reviewer and hides it. A file that has gone is retired. Runs
 * in one transaction, so a failure leaves the guide as it was.
 */
export async function syncContent(
  db: { atomic<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> },
  content: LoadedContent,
  now = new Date(),
): Promise<SyncResult> {
  const result: SyncResult = {
    published: [],
    drafts: [],
    retired: [],
    refused: [...content.errors],
  };
  await db.atomic(async (tx) => {
    const known = new Set<string>();
    for (const article of content.articles) {
      known.add(article.slug);
      const problems = articleProblems(article);
      const state = signState(article, content.signoffs, now);
      const entry = content.signoffs.find((item) => item.slug === article.slug);
      const live = !problems.length && state === 'SIGNED' && article.status === 'SIGNED' && entry;
      if (problems.length) result.refused.push(`${article.file}: ${problems[0]}`);
      const existing = await tx.knowledgeArticle.findUnique({ where: { slug: article.slug } });
      const version = existing
        ? existing.sha256 === article.sha256
          ? existing.version
          : existing.version + 1
        : 1;
      const fields = {
        kind: 'GUIDE',
        number: article.id,
        version,
        status: live ? 'PUBLISHED' : 'DRAFT',
        titleEn: article.title,
        titleHinglish: article.title_hinglish,
        summary: article.summary,
        aliases: article.aliases,
        aliasText: article.aliases.join(' | ').toLowerCase(),
        stages: article.stages,
        materials: article.materials,
        relatedQuestions: article.related_questions,
        standardsMentioned: article.standards_mentioned,
        bodyEn: article.bodyEn,
        sha256: article.sha256,
        reviewerKey: live ? entry.reviewer : null,
        reviewedAt: live ? new Date(`${entry.on}T00:00:00+05:30`) : null,
        reviewDueAt: live ? new Date(`${entry.due}T23:59:59+05:30`) : null,
      };
      const row = await tx.knowledgeArticle.upsert({
        where: { slug: article.slug },
        create: { slug: article.slug, ...fields },
        update: fields,
        select: { id: true },
      });
      await tx.knowledgeChunk.deleteMany({ where: { articleId: row.id } });
      await tx.knowledgeChunk.createMany({
        data: article.sections.map((section, ordinal) => ({
          articleId: row.id,
          articleVersion: version,
          ordinal,
          anchor: section.anchor,
          heading: section.heading,
          blocks: section.blocks,
          body: section.blocks.join('\n'),
        })),
      });
      (live ? result.published : result.drafts).push(article.slug);
    }
    const gone = await tx.knowledgeArticle.findMany({
      where: { kind: 'GUIDE', status: { not: 'RETIRED' }, slug: { notIn: [...known] } },
      select: { id: true, slug: true },
    });
    for (const row of gone) {
      await tx.knowledgeArticle.update({
        where: { id: row.id },
        data: { status: 'RETIRED', reviewerKey: null, reviewedAt: null, reviewDueAt: null },
      });
      result.retired.push(row.slug);
    }
    if (result.published.length || result.drafts.length || result.retired.length)
      await tx.auditLog.create({
        data: {
          actorId: 'system',
          event: 'ADVISOR_CONTENT_SYNCED',
          entityId: 'guide',
          details: {
            published: result.published.length,
            drafts: result.drafts.length,
            retired: result.retired.length,
          },
        },
      });
  });
  return result;
}
