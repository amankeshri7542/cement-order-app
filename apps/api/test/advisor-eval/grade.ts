import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { advisorText, type AdvisorTextKey, type AdvisorTurnView } from '@shiv/shared';
import { z } from 'zod';

/**
 * The eval's questions and the code checks on each answer. Shared by the free test, which runs with
 * a fake model on every push, and the live script, which spends money and is run by hand. None of
 * these came from a real customer yet: `source` is "drafted" until the family has marked one.
 */
export const caseSchema = z.strictObject({
  id: z.string(),
  group: z.string(),
  lang: z.string(),
  question: z.string(),
  /** drafted, or family once Papa or Chacha have heard it from a customer. */
  source: z.enum(['drafted', 'family']),
  /** free: answered with no model. model: needs one. api, fixture, photo: checked another way. */
  mode: z.enum(['free', 'model', 'api', 'fixture', 'photo']),
  route: z.string().optional(),
  level: z.string().optional(),
  expectLevels: z.array(z.string()).optional(),
  textKey: z.string().optional(),
  language: z.string().optional(),
  mustMatch: z.array(z.string()).optional(),
  mustNever: z.array(z.string()).optional(),
  noProducts: z.boolean().optional(),
  noCounts: z.boolean().optional(),
  noArticles: z.boolean().optional(),
  wantsProducts: z.array(z.string()).optional(),
  estimate: z.record(z.string(), z.unknown()).optional(),
  expectArticle: z.string().optional(),
  gap: z.string().optional(),
  before: z.string().optional(),
  photo: z.boolean().optional(),
  must: z.string().optional(),
  note: z.string().optional(),
});
export type EvalCase = z.infer<typeof caseSchema>;

export const loadCases = (): EvalCase[] =>
  readFileSync(join(__dirname, 'cases.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => caseSchema.parse(JSON.parse(line)));

/** Every way the answer breaks a row's code checks. An empty list passes. */
export function gradeCase(row: EvalCase, turn: AdvisorTurnView): string[] {
  const problems: string[] = [];
  const body = turn.text;
  if (row.route && turn.route !== row.route)
    problems.push(`route is ${turn.route}, not ${row.route}`);
  if (row.level && turn.level !== row.level)
    problems.push(`level is ${turn.level}, not ${row.level}`);
  if (row.expectLevels && !row.expectLevels.includes(turn.level))
    problems.push(`level is ${turn.level}`);
  if (row.language && turn.language !== row.language) problems.push(`language is ${turn.language}`);
  if (row.textKey) {
    const words = advisorText[row.textKey as AdvisorTextKey];
    if (!words) problems.push(`no fixed text called ${row.textKey}`);
    else if (body !== words.en && body !== words.hinglish)
      problems.push(`is not the ${row.textKey} text`);
  }
  for (const pattern of row.mustMatch ?? [])
    if (!new RegExp(pattern, 'iu').test(body)) problems.push(`does not say /${pattern}/`);
  for (const pattern of row.mustNever ?? [])
    if (new RegExp(pattern, 'iu').test(body)) problems.push(`says /${pattern}/`);
  if (row.noProducts && turn.products.length) problems.push('shows products');
  if (row.noCounts && /"stock"|\b137\b|\b912\b/.test(JSON.stringify(turn)))
    problems.push('shows a stock count');
  for (const id of row.wantsProducts ?? [])
    if (!turn.products.some((product) => product.id === id)) problems.push(`no card for ${id}`);
  if (row.estimate) {
    if (!turn.estimate) problems.push('no estimate');
    else if (turn.estimate.status !== row.estimate.status)
      problems.push(`estimate is ${turn.estimate.status}`);
  }
  if (row.noArticles && turn.citations.length) problems.push('cites an article');
  return problems;
}

/** Whether the row's expected article was found, for the recall figure. Null if it has none. */
export const recalled = (row: EvalCase, turn: AdvisorTurnView) =>
  row.expectArticle ? turn.citations.some((citation) => citation.slug === row.expectArticle) : null;
