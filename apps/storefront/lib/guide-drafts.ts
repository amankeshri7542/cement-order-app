import 'server-only';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuideListItem, GuidePage } from './public-data';
import { contentReview, draftsVisible } from './review';
import { indexingOn } from './site';

/**
 * Review builds only: articles waiting for an engineer's signature, read straight from
 * content/advisor/, each marked as a draft. Customers never get these: their guide comes from
 * GET /guide, which holds signed articles alone. What keeps it that way:
 * - server-only, so none of this can enter a browser bundle, and nothing is compiled in: the words
 *   are read from disk here, at request time, past the check below.
 * - contentReview is fixed at build time and false unless NEXT_PUBLIC_CONTENT_REVIEW=on was set for
 *   that build. Setting it later on a running server changes nothing.
 * - draftsVisible says no on any site with SITE_INDEXING=on, and next.config.ts refuses to build
 *   with both set.
 * - next.config.ts leaves content/advisor out of a customer build's files, so they are not there.
 * - scripts/check-web-budgets.mjs fails if a production /guide shows a draft or a draft's address
 *   opens.
 */
function folder() {
  const candidates = [
    join(process.cwd(), 'content/advisor'),
    join(process.cwd(), '../../content/advisor'),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}
function parse(text: string) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) return null;
  const meta: Record<string, unknown> = {};
  for (const line of match[1]!.split('\n')) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    try {
      meta[line.slice(0, at).trim()] = JSON.parse(line.slice(at + 1).trim());
    } catch {
      meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  const sections = match[2]!
    .split(/^## /m)
    .slice(1)
    .map((chunk) => {
      const [heading = '', ...rest] = chunk.split('\n');
      return {
        id: heading
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        heading: heading.trim(),
        blocks: rest
          .join('\n')
          .split(/\n\s*\n/)
          .map((block) => block.trim())
          .filter(Boolean),
      };
    });
  return { meta, sections };
}
function drafts(): GuidePage[] {
  if (!draftsVisible(contentReview, indexingOn)) return [];
  const dir = folder();
  if (!dir) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .flatMap((file) => {
      const parsed = parse(readFileSync(join(dir, file), 'utf8'));
      if (!parsed || typeof parsed.meta.slug !== 'string') return [];
      const { meta, sections } = parsed;
      return [
        {
          slug: meta.slug as string,
          title: String(meta.title ?? meta.slug),
          summary: String(meta.summary ?? ''),
          stages: (meta.stages as string[]) ?? [],
          materials: (meta.materials as string[]) ?? [],
          checkedOn: null,
          sections,
          relatedQuestions: ((meta.related_questions as { en: string }[]) ?? []).map(
            (item) => item.en,
          ),
          standardsMentioned: (meta.standards_mentioned as string[]) ?? [],
          draft: true,
        },
      ];
    });
}
export const draftList = (): GuideListItem[] => drafts();
export const draftPage = (slug: string) => drafts().find((item) => item.slug === slug) ?? null;
