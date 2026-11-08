import { createHash, randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import type { BrowserContext, Page, Request } from '@playwright/test';
import { allShopRoles, type StaffRole } from '@shiv/shared';
import { hinglish, type MessageKey } from '@shiv/i18n';
import { routeMoves } from '../apps/admin/lib/shell-nav';
import { test, expect, deskLanguage } from './fixtures';

// Plan v4 B4a: the desk shell. The grouped rail and top bar on a laptop, five tabs on a phone,
// the Menu, the shop or firm scope, the look and language toggles, the shortcuts, and every old
// address reaching its home.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const MAIN = 'loc_main';
const SECOND = 'b4a_second_shop';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const say = (key: MessageKey) => hinglish[key];
const tokens = new Map<StaffRole, string>();
test.use({ actionTimeout: 15000 });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const main = await db.location.findUniqueOrThrow({ where: { id: MAIN } });
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true },
    create: {
      id: SECOND,
      name: 'B4a doosri dukaan',
      slug: 'b4a-doosri-dukaan',
      firmId: main.firmId,
      kind: 'SHOP',
    },
  });
  for (const role of ['OWNER', 'MANAGER', 'STOCK_KEEPER', 'ACCOUNTANT', 'TECH_OPERATOR'] as const) {
    const id = `b4a-${role.toLowerCase()}`;
    await db.user.upsert({
      where: { id },
      update: { preferences: {}, language: 'hinglish' },
      create: {
        id,
        phone: `+9191000008${String(tokens.size).padStart(2, '0')}`,
        name: `Shell ${role}`,
        role: 'ADMIN',
        language: 'hinglish',
      },
    });
    await db.staffMembership.deleteMany({ where: { userId: id } });
    await db.staffMembership.create({
      data: {
        userId: id,
        role,
        locationId: allShopRoles.includes(role) ? null : MAIN,
        grantedById: 'fixture',
      },
    });
    await db.session.deleteMany({ where: { userId: id } });
    const token = randomBytes(32).toString('base64url').slice(0, 43);
    await db.session.create({
      data: {
        userId: id,
        surface: 'DESK',
        accessHash: hash(token),
        refreshHash: hash(`${token}-refresh`),
        expiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 86400000),
      },
    });
    tokens.set(role, token);
  }
});
test.afterAll(async () => {
  await db.location.updateMany({ where: { id: SECOND }, data: { active: false } });
  await db.$disconnect();
});

async function as(context: BrowserContext, role: StaffRole) {
  await deskLanguage(context, 'hinglish');
  await context.addCookies([
    { name: 'shiv_access', value: tokens.get(role)!, domain: 'localhost', path: '/api/v1' },
  ]);
}
const rail = (page: Page) => page.locator('nav[data-owner-rail]');
const tabs = (page: Page) => page.locator('nav[data-owner-tabs]');

test('each role sees its own groups on the rail, and nothing it may not open', async ({
  browser,
}) => {
  const expect_ = {
    OWNER: {
      has: ['Aaj', 'Pakka karo', 'Galla', 'Stock', 'Salary', 'System'],
      groups: ['Bikri', 'Paisa', 'Maal', 'Log', 'Setup'],
    },
    STOCK_KEEPER: { has: ['Stock'], not: ['Galla', 'Report', 'Salary', 'Udhaar'] },
    TECH_OPERATOR: { has: ['System'], not: ['Galla', 'Report', 'Udhaar', 'Salary'] },
  } as const;
  for (const [role, want] of Object.entries(expect_) as [
    StaffRole,
    (typeof expect_)[keyof typeof expect_],
  ][]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await as(context, role);
    const page = await context.newPage();
    await page.goto(`${desk}/today`);
    await expect(rail(page)).toBeVisible();
    for (const name of want.has)
      await expect(
        rail(page).getByRole('link', { name: new RegExp(`^${name}( \\d+)?$`) }),
      ).toBeVisible();
    for (const name of 'not' in want ? want.not : [])
      await expect(rail(page).getByRole('link', { name, exact: true })).toHaveCount(0);
    if ('groups' in want)
      for (const label of want.groups)
        await expect(
          rail(page).getByRole('group', { name: label.toUpperCase() === label ? label : label }),
        ).toBeVisible();
    // Only one navigation is shown at a time: the rail here, the tabs on a phone.
    await expect(tabs(page)).toBeHidden();
    await context.close();
  }
});

test('every old address reaches its home', async ({ context, page }) => {
  await as(context, 'OWNER');
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const move of routeMoves) {
    if (move.from.includes('…')) continue;
    await page.goto(`${desk}${move.from}`);
    if (move.now) {
      const [path, query] = move.to.split('?');
      await expect(page, move.from).toHaveURL(
        new RegExp(`${path}${query ? `\\?${query.replace('?', '\\?')}` : ''}$`),
      );
    } else {
      // Its new home comes in a later phase; until then it opens inside the shell, not as an error.
      await expect(page, move.from).toHaveURL(new RegExp(`${move.from.split('?')[0]}`));
      await expect(rail(page)).toBeVisible();
      await expect(page.getByRole('heading', { name: say('owner.notYourPage') })).toHaveCount(0);
    }
  }
});

test('on a phone at 360 × 640 with the largest text: five tabs, all readable and easy to tap', async ({
  context,
  page,
}) => {
  await as(context, 'OWNER');
  await context.addCookies([{ name: 'shiv_text', value: 'larger', url: desk }]);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`${desk}/today`);
  const bar = tabs(page);
  await expect(bar).toBeVisible();
  await expect(rail(page)).toBeHidden();
  const items = bar.locator(':scope > a, :scope > button');
  await expect(items).toHaveCount(5);
  await expect(items).toHaveText([/^Aaj/, /^Pakka karo/, /^Naya/, /^Saathi/, /^Menu/]);
  const sizes = await items.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      const label = node.querySelector('span');
      return {
        height: box.height,
        width: box.width,
        clipped: label ? label.scrollWidth > label.clientWidth + 1 : false,
      };
    }),
  );
  for (const size of sizes) {
    expect(size.height).toBeGreaterThanOrEqual(48);
    expect(size.width).toBeGreaterThanOrEqual(48);
    expect(size.clipped).toBe(false);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  // [+] opens the day's starting actions.
  await bar.getByRole('button', { name: /^Naya/ }).click();
  const sheet = page.getByRole('dialog', { name: say('owner.shell.plusTitle') });
  await expect(sheet.getByRole('link')).toHaveText([say('owner.phoneOrder'), say('owner.walkIn')]);
  await sheet.getByRole('link', { name: say('owner.walkIn') }).click();
  await expect(page).toHaveURL(/\/orders\/new\?source=WALK_IN$/);
  // Saathi opens its panel, full screen with a back button.
  await bar.getByRole('button', { name: /^Saathi/ }).click();
  const saathi = page.getByRole('dialog', { name: say('owner.shell.saathi') });
  await expect(saathi).toBeVisible();
  await saathi.getByRole('button', { name: new RegExp(say('owner.back')) }).click();
  await expect(saathi).toHaveCount(0);
  // Menu: the groups with a search box, the scope, the look, and sign out.
  await bar.getByRole('link', { name: /^Menu/ }).click();
  await expect(page).toHaveURL(/\/more$/);
  await expect(page.getByRole('heading', { name: 'Paisa' })).toBeVisible();
  await page.getByRole('searchbox', { name: say('owner.shell.menuSearch') }).fill('gal');
  await expect(page.getByRole('main').getByRole('link')).toHaveText([/Galla/]);
  await expect(page.getByRole('button', { name: say('owner.logout') })).toBeVisible();
});

test('on a laptop /more goes to Aaj, and the rail can be made narrow and stays so', async ({
  context,
  page,
}) => {
  await as(context, 'OWNER');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${desk}/more`);
  await expect(page).toHaveURL(/\/today$/);
  const flip = rail(page).getByRole('button', { name: say('owner.shell.collapse') });
  await flip.click();
  await expect(rail(page)).toHaveAttribute('data-narrow', 'true');
  const main = await page.locator('#owner-main').boundingBox();
  expect(main!.x).toBeLessThan(120);
  await page.reload();
  await expect(rail(page)).toHaveAttribute('data-narrow', 'true');
  // Narrow, every link keeps its name for screen readers.
  await expect(rail(page).getByRole('link', { name: 'Galla', exact: true })).toBeVisible();
  await rail(page)
    .getByRole('button', { name: say('owner.shell.expand') })
    .click();
  await expect(rail(page)).not.toHaveAttribute('data-narrow', /./);
});

test('shortcuts: / searches, M opens Saathi, N starts an order, Escape closes; never while typing', async ({
  context,
  page,
}) => {
  await as(context, 'OWNER');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${desk}/today`);
  await expect(rail(page)).toBeVisible();
  await page.locator('body').click({ position: { x: 700, y: 400 } });
  await page.keyboard.press('m');
  const saathi = page.getByRole('dialog', { name: say('owner.shell.saathi') });
  await expect(saathi).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(saathi).toHaveCount(0);
  await page.keyboard.press('/');
  const search = page.getByRole('combobox', { name: say('owner.shell.searchLabel') });
  await expect(search).toBeFocused();
  // Typing m and n in the search is just typing.
  await page.keyboard.type('mn');
  await expect(saathi).toHaveCount(0);
  await expect(page).toHaveURL(/\/today$/);
  await search.fill('gal');
  await expect(page.getByRole('option', { name: /Galla/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/galla$/);
  await page.locator('body').click({ position: { x: 700, y: 400 } });
  await page.keyboard.press('n');
  await expect(page).toHaveURL(/\/orders\/new$/);
});

test('the scope: a shop or every shop, remembered, and sent with Aaj and Report', async ({
  context,
  page,
}) => {
  await as(context, 'OWNER');
  await page.setViewportSize({ width: 1440, height: 900 });
  const asked: string[] = [];
  page.on('request', (request: Request) => {
    if (/\/admin\/(dashboard|reports\/money)/.test(request.url())) asked.push(request.url());
  });
  await page.goto(`${desk}/today`);
  const scope = page.getByRole('combobox', { name: say('owner.shell.shop') });
  await expect(scope).toBeVisible();
  await scope.selectOption({ label: 'B4a doosri dukaan' });
  await expect
    .poll(() => asked.some((url) => url.includes(`dashboard?locationId=${SECOND}`)))
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('combobox', { name: say('owner.shell.shop') })).toHaveValue(
    `shop:${SECOND}`,
  );
  await page.goto(`${desk}/reports`);
  await expect
    .poll(() =>
      asked.some((url) => url.includes('reports/money') && url.includes(`locationId=${SECOND}`)),
    )
    .toBe(true);
  const firms = await db.firm.count({ where: { active: true } });
  if (firms > 1) {
    const firm = (
      await db.firm.findFirstOrThrow({ where: { active: true }, orderBy: { createdAt: 'asc' } })
    ).id;
    await page
      .getByRole('combobox', { name: say('owner.shell.shop') })
      .selectOption(`firm:${firm}`);
    await expect.poll(() => asked.some((url) => url.includes(`firmId=${firm}`))).toBe(true);
  }
  await page
    .getByRole('combobox', { name: say('owner.shell.shop') })
    .selectOption({ label: say('owner.shell.allShops') });
  asked.length = 0;
  await page.goto(`${desk}/today`);
  await expect.poll(() => asked.some((url) => url.endsWith('/admin/dashboard'))).toBe(true);
  // A shop stored by an older desk, or a tampered one, never reaches the server.
  await page.evaluate(() => localStorage.setItem('shiv-desk-scope', 'shop:not_mine'));
  asked.length = 0;
  await page.reload();
  await expect.poll(() => asked.some((url) => url.endsWith('/admin/dashboard'))).toBe(true);
  expect(asked.some((url) => url.includes('not_mine'))).toBe(false);
});

test('a manager at one shop sees that shop named, not a switcher', async ({ context, page }) => {
  await as(context, 'MANAGER');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${desk}/today`);
  await expect(page.getByText(/Aapki dukaan: /)).toBeVisible();
  await expect(page.getByRole('combobox', { name: say('owner.shell.shop') })).toHaveCount(0);
});

test('theme, text size and language from the top bar, saved for the person', async ({
  context,
  page,
}) => {
  await as(context, 'ACCOUNTANT');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${desk}/today`);
  await page.getByRole('button', { name: /^Ujala ya andhera/ }).click();
  await page.getByRole('menuitem', { name: /Andhera/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /^Akshar/ }).click();
  await page.getByRole('menuitem', { name: /Aur bada/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-text', 'larger');
  await page.getByRole('button', { name: /^Bhasha/ }).click();
  await page.getByRole('menuitem', { name: /English/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect
    .poll(
      async () =>
        (await db.user.findUniqueOrThrow({ where: { id: 'b4a-accountant' } })).preferences,
    )
    .toEqual({
      theme: 'dark',
      textSize: 'larger',
      language: 'en',
    });
});

for (const theme of ['light', 'dark'] as const)
  test(`the shell passes axe in ${theme}, on a laptop and a phone`, async ({ context, page }) => {
    await as(context, 'OWNER');
    await context.addCookies([{ name: 'shiv_theme', value: theme, url: desk }]);
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`${desk}/today`);
      await page.waitForLoadState('networkidle');
      const result = await new AxeBuilder({ page })
        .include('nav, header')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const serious = result.violations
        .filter((row) => row.impact === 'serious' || row.impact === 'critical')
        .map(({ id, nodes }) => ({ id, targets: nodes.slice(0, 3).map((node) => node.target) }));
      expect(serious, `${width}`).toEqual([]);
    }
  });

test('the shell fits every size from 320 to 2560 px, and at 200% text', async ({
  context,
  page,
}) => {
  await as(context, 'OWNER');
  for (const [width, height] of [
    [320, 640],
    [360, 640],
    [390, 844],
    [600, 900],
    [768, 1024],
    [1024, 768],
    [1280, 800],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
    [844, 390],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`${desk}/today`);
    await expect(page.locator('#owner-main')).toBeVisible();
    const problems = await page.evaluate((wide) => {
      const found: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth + 1)
        found.push(`sideways ${document.documentElement.scrollWidth}`);
      if (wide < 1024)
        for (const node of document.querySelectorAll<HTMLElement>(
          'header button, header select, header a, nav[data-owner-tabs] a, nav[data-owner-tabs] button',
        )) {
          const box = node.getBoundingClientRect();
          if (box.width && box.height < 47.5)
            found.push(`small ${node.textContent?.trim()} ${Math.round(box.height)}`);
        }
      return found;
    }, width);
    expect(problems, `${width}×${height}`).toEqual([]);
  }
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${desk}/today`);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      `${width} at 200%`,
    ).toBeLessThanOrEqual(1);
  }
});
