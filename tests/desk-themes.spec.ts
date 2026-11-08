import { createHash, randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Plan v4 B1: light, dark and "Bada akshar" on the desk. The theme is drawn by the server from a
// cookie, so no page flashes the wrong one; the choice is saved per person and follows them to
// another browser; and five everyday pages pass axe in both themes.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const owner = 'b1-theme-owner';
const token = randomBytes(32).toString('base64url').slice(0, 43);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const pages = ['/today', '/udhaar', '/customers', '/galla', '/settings'];
test.use({ actionTimeout: 15000 });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await db.user.upsert({
    where: { id: owner },
    update: { preferences: {} },
    create: { id: owner, phone: '+919100000777', name: 'Theme Owner', role: 'ADMIN' },
  });
  if (!(await db.staffMembership.count({ where: { userId: owner, endedAt: null } })))
    await db.staffMembership.create({
      data: { userId: owner, locationId: null, role: 'OWNER', grantedById: 'fixture' },
    });
  await db.session.deleteMany({ where: { userId: owner } });
  await db.session.create({
    data: {
      userId: owner,
      surface: 'DESK',
      accessHash: hash(token),
      refreshHash: hash(`${token}-refresh`),
      expiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 86400000),
    },
  });
});
test.afterAll(() => db.$disconnect());

async function signedIn(context: BrowserContext, theme?: 'light' | 'dark') {
  await context.addCookies([
    { name: 'shiv_access', value: token, domain: 'localhost', path: '/api/v1' },
    ...(theme ? [{ name: 'shiv_theme', value: theme, domain: 'localhost', path: '/' }] : []),
  ]);
}

async function seriousIssues(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return result.violations
    .filter((row) => row.impact === 'serious' || row.impact === 'critical')
    .map(({ id, nodes }) => ({ id, targets: nodes.slice(0, 3).map((node) => node.target) }));
}

for (const theme of ['light', 'dark'] as const)
  test(`five desk pages pass axe in ${theme}`, async ({ context, page }) => {
    await signedIn(context, theme);
    for (const path of pages) {
      await page.goto(`${desk}${path}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await seriousIssues(page), `${path} in ${theme}`).toEqual([]);
    }
  });

test('the server draws the chosen theme, so nothing flashes', async ({ request }) => {
  const html = await (
    await request.get(`${desk}/today`, { headers: { cookie: 'shiv_theme=dark; shiv_text=large' } })
  ).text();
  expect(html).toMatch(/<html[^>]*data-theme="dark"/);
  expect(html).toMatch(/<html[^>]*data-text="large"/);
  const plain = await (await request.get(`${desk}/today`)).text();
  expect(plain).not.toMatch(/<html[^>]*data-theme=/);
});

test('a choice is saved for the person and follows them to another browser', async ({
  context,
  page,
  browser,
}) => {
  await signedIn(context);
  await page.goto(`${desk}/settings`);
  await page.getByRole('radio', { name: /^(Dark|Andhera)$/ }).check();
  await page.getByRole('radio', { name: /^(Larger|Aur bada)$/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-text', 'larger');
  await expect
    .poll(async () => (await db.user.findUniqueOrThrow({ where: { id: owner } })).preferences)
    .toEqual({ theme: 'dark', textSize: 'larger' });
  // A fresh browser with no theme cookie takes the saved choice once the session loads.
  const other = await browser.newContext();
  await signedIn(other);
  const second = await other.newPage();
  await second.goto(`${desk}/today`);
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(second.locator('html')).toHaveAttribute('data-text', 'larger');
  // Larger text really is larger.
  const size = await second.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(parseFloat(size)).toBeGreaterThan(16);
  await other.close();
  // Back to the device's own choice.
  await page.getByRole('radio', { name: /^(Like this phone|Phone jaisa)$/ }).check();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
});
