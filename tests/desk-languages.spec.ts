import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { BrowserContext, Page } from '@playwright/test';
import { en, hi, hinglish, type MessageKey } from '@shiv/i18n';
import { test, expect, deskLanguage } from './fixtures';

// Plan v4 B2: the desk in Hinglish, English and Hindi. The server draws the page in the chosen
// language from a cookie, so nothing flashes; the choice is saved per person and follows them to
// another browser; an old choice from this browser is carried over once; and a page with no Hindi
// yet shows Hinglish, never English.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const owner = 'b2-language-owner';
const token = randomBytes(32).toString('base64url').slice(0, 43);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const catalogue = { hinglish, en, hi: { ...hinglish, ...hi } } as const;
const say = (language: keyof typeof catalogue, key: MessageKey) => catalogue[language][key];
const lang = { hinglish: 'hi-Latn', en: 'en', hi: 'hi' } as const;
test.use({ actionTimeout: 15000 });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await db.user.upsert({
    where: { id: owner },
    update: { preferences: {}, language: 'hinglish' },
    create: {
      id: owner,
      phone: '+919100000778',
      name: 'Language Owner',
      role: 'ADMIN',
      language: 'hinglish',
    },
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

async function signedIn(context: BrowserContext) {
  await context.addCookies([
    { name: 'shiv_access', value: token, domain: 'localhost', path: '/api/v1' },
  ]);
}
const saved = async () =>
  (await db.user.findUniqueOrThrow({ where: { id: owner } })) as {
    preferences: unknown;
    language: string;
  };

async function shellIn(page: Page, language: keyof typeof catalogue) {
  await expect(page.locator('html')).toHaveAttribute('lang', lang[language]);
  // The rail on a laptop, the tabs on a phone: whichever is shown carries Aaj and Pakka karo.
  const nav = page.getByRole('navigation', { name: say(language, 'owner.desk'), exact: true });
  await expect(nav.getByText(say(language, 'owner.today'), { exact: true })).toBeVisible();
  await expect(nav.getByText(say(language, 'owner.pakka.title'), { exact: true })).toBeVisible();
}

test('the shell renders in all three languages, and the choice is saved', async ({
  context,
  page,
}) => {
  await signedIn(context);
  await deskLanguage(context, 'hinglish');
  await page.goto(`${desk}/settings`);
  await shellIn(page, 'hinglish');
  for (const language of ['en', 'hi', 'hinglish'] as const) {
    // Each language is named in its own script, whichever language the page is in.
    await page.getByRole('radio', { name: en[`language.${language}`], exact: true }).check();
    await shellIn(page, language);
    await expect.poll(async () => (await saved()).language).toBe(language);
    expect((await saved()).preferences).toEqual({ language });
    // The next page is drawn in it from the start.
    await page.goto(`${desk}/today`);
    await shellIn(page, language);
    await page.goto(`${desk}/settings`);
  }
});

test('the server draws the chosen language, so nothing flashes', async ({ request }) => {
  for (const [cookie, expected] of [
    ['hi', 'hi'],
    ['en', 'en'],
    ['hinglish', 'hi-Latn'],
    ['fr', 'hi-Latn'],
  ] as const) {
    const html = await (
      await request.get(`${desk}/today`, { headers: { cookie: `shiv_lang=${cookie}` } })
    ).text();
    expect(html).toMatch(new RegExp(`<html[^>]*lang="${expected}"`));
  }
  const plain = await (await request.get(`${desk}/today`)).text();
  expect(plain).toMatch(/<html[^>]*lang="hi-Latn"/);
});

test('a saved choice follows the person to a fresh browser', async ({ browser }) => {
  await db.user.update({
    where: { id: owner },
    data: { preferences: { language: 'hi' }, language: 'hi' },
  });
  const other = await browser.newContext();
  await signedIn(other);
  await deskLanguage(other, 'en');
  const page = await other.newPage();
  await page.goto(`${desk}/today`);
  await shellIn(page, 'hi');
  await other.close();
});

test('a page with no Hindi yet shows Hinglish, never English', async ({ context, page }) => {
  await signedIn(context);
  await deskLanguage(context, 'hi');
  await page.goto(`${desk}/settings`);
  await shellIn(page, 'hi');
  // The appearance section has no Hindi yet (B2 translates the shell and the top 300 strings).
  expect(hi['owner.appearance.title']).toBeUndefined();
  await expect(
    page.getByRole('heading', { name: hinglish['owner.appearance.title'], exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: en['owner.appearance.title'], exact: true }),
  ).toHaveCount(0);
});

test('Hindi at a narrow phone with the largest text never pushes the page sideways', async ({
  context,
  page,
}) => {
  await signedIn(context);
  await deskLanguage(context, 'hi');
  await context.addCookies([{ name: 'shiv_text', value: 'larger', url: desk }]);
  await page.setViewportSize({ width: 320, height: 720 });
  for (const path of ['/today', '/orders', '/udhaar', '/settings', '/more']) {
    await page.goto(`${desk}${path}`);
    await shellIn(page, 'hi');
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wide, path).toBeLessThanOrEqual(0);
  }
});

test('an old choice in this browser is carried over once, for someone who never chose', async ({
  browser,
}) => {
  await db.user.update({ where: { id: owner }, data: { preferences: {}, language: 'hinglish' } });
  const other = await browser.newContext();
  await signedIn(other);
  // Before plan v4 the desk kept its language only here, and 'en' meant English.
  await other.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('shiv-owner-language', 'en');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await other.clearCookies({ name: 'shiv_lang' });
  const page = await other.newPage();
  await page.goto(`${desk}/today`);
  await shellIn(page, 'en');
  await expect.poll(async () => (await saved()).language).toBe('en');
  expect((await saved()).preferences).toEqual({ language: 'en' });
  expect(await page.evaluate(() => localStorage.getItem('shiv-owner-language'))).toBeNull();
  // From now on the cookie decides; the old key is not read again.
  await page.reload();
  await shellIn(page, 'en');
  await other.close();
});

test('a saved choice wins over an old one left in this browser', async ({ browser }) => {
  await db.user.update({
    where: { id: owner },
    data: { preferences: { language: 'hi' }, language: 'hi' },
  });
  const other = await browser.newContext();
  await signedIn(other);
  await other.addInitScript(() => localStorage.setItem('shiv-owner-language', 'en'));
  await other.clearCookies({ name: 'shiv_lang' });
  const page = await other.newPage();
  await page.goto(`${desk}/today`);
  await shellIn(page, 'hi');
  expect((await saved()).language).toBe('hi');
  await other.close();
  await db.user.update({ where: { id: owner }, data: { preferences: {}, language: 'hinglish' } });
});
