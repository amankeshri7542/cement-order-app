// A printable pack for the engineer who checks the articles. Written outside git, as the checks and
// the name stay private. Usage: npm run advisor:pack -w @shiv/api
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkedMonth } from '@shiv/shared';
import { contentDir, loadContent } from '../src/advisor/content';

const out = resolve(process.cwd(), '../../.local/advisor-pack');
mkdirSync(out, { recursive: true });
const { articles } = loadContent(contentDir());
const today = new Date().toISOString().slice(0, 10);
const lines = [
  '# Articles to check',
  '',
  `Prepared ${checkedMonth(today.slice(0, 7))}. ${articles.length} articles.`,
  '',
  'For each article, please mark anything unsafe, wrong or misleading. Standard numbers and every figure in these articles are drafts until you confirm them. Then sign this line for each one you accept:',
  '',
  '> I read this. As general information for homeowners it has no unsafe or misleading statement. It is not a design for any house.',
  '',
];
for (const article of articles) {
  lines.push(
    `---`,
    '',
    `## ${article.id}. ${article.title}`,
    '',
    `Must be signed by: ${article.sign === 'F' ? 'the family' : article.sign === 'E' ? 'the engineer' : 'the engineer and the family'}`,
    `Text fingerprint: ${article.sha256}`,
    '',
  );
  if (article.standards_mentioned.length)
    lines.push(`Standards it names, to confirm: ${article.standards_mentioned.join(', ')}`, '');
  if (article.numbers_ok.length)
    lines.push(`Figures it uses, to confirm: ${article.numbers_ok.join(', ')}`, '');
  for (const section of article.sections) {
    lines.push(`### ${section.heading}`, '');
    for (const block of section.blocks) lines.push(block, '');
  }
  lines.push('Signed: ____________________  Date: ____________  Changes needed: yes / no', '');
}
const path = resolve(out, 'engineer-pack.md');
writeFileSync(path, lines.join('\n'));
console.log(`Written: ${path}`);
