// What CI runs on the guide. `npm run advisor:check -w @shiv/api`, and with --launch it also fails
// on anything not yet signed, which is what must pass before Ask opens to customers.
import { checkContent, contentDir, loadContent, signState } from '../src/advisor/content';

const launch = process.argv.includes('--launch');
const now = new Date();
const content = loadContent(contentDir());
const problems = checkContent(content, now, { launch });
const states = content.articles.map((article) => signState(article, content.signoffs, now));
console.log(
  `${content.articles.length} articles: ${states.filter((state) => state === 'SIGNED').length} signed, ${states.filter((state) => state === 'UNSIGNED').length} unsigned, ${states.filter((state) => state === 'STALE').length} changed since signing, ${states.filter((state) => state === 'EXPIRED').length} past their date.`,
);
for (const problem of problems) console.error(`- ${problem}`);
process.exit(problems.length ? 1 : 0);
