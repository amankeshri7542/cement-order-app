import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { money } from '@shiv/shared';
import { test, expect } from './fixtures';

// Phase 3 customer-experience regressions: rate board, feedback, persistence and layout safety.
const site = 'http://localhost:3004';
const api = 'http://localhost:4010/api/v1';
const cement = 'test-ux-cement';
const steel = 'test-ux-steel';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (error) => list.push(error.message));
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

test.beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    !new URL(url).pathname.endsWith('_test') ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  )
    throw new Error('Disposable loopback database required');
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await db.category.upsert({
      where: { id: 'steel' },
      create: { id: 'steel', name: 'Steel', slug: 'steel' },
      update: {},
    });
    for (const [id, name, categoryId, unit, pricePaise] of [
      [cement, 'TEST UX Cement', 'cement', 'bag', 39500],
      [steel, 'TEST UX Steel', 'steel', 'kg', 6600],
    ] as const) {
      const data = {
        name,
        categoryId,
        brand: 'TEST UX',
        type: categoryId === 'cement' ? 'Cement' : 'TMT bar',
        grade: 'TEST grade',
        unit,
        packSize: '',
        minQuantity: 1,
        quantityStep: 1,
        pricePaise,
        stock: 500,
        description: 'Disposable test fixture; not product advice.',
        recommendedUse: 'Test only.',
        images: [],
        active: true,
      };
      await db.product.upsert({ where: { id }, create: { id, ...data }, update: data });
    }
  } finally {
    await db.$disconnect();
  }
});

test('home rate board shows the cheapest in-stock catalogue price per material with its unit', async ({
  page,
  request,
}) => {
  const response = await request.get(`${api}/products?sort=price_asc&availability=in&limit=100`);
  expect(response.ok()).toBe(true);
  const items: { category: { slug: string }; pricePaise: number; stock: number; unit: string }[] = (
    await response.json()
  ).items;
  const cheapest = items
    .filter((item) => item.category.slug === 'cement' && item.stock > 0)
    .sort((a, b) => a.pricePaise - b.pricePaise)[0]!;
  await page.goto(site);
  const board = page.getByRole('complementary', { name: /Current rates/ });
  const row = board.getByRole('link').filter({ hasText: 'Cement' }).first();
  await expect(row).toHaveAttribute('href', '/products?category=cement');
  await expect(row).toContainText(money(cheapest.pricePaise));
  await expect(row).toContainText(`/ ${cheapest.unit}`);
  await expect(board).toContainText(/checked \d{2}:\d{2}/);
  await row.click();
  await expect(page).toHaveURL(`${site}/products?category=cement`);
  await expect(page.getByRole('link', { name: 'Cement', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
});

test('a failed sign-in check explains guest browsing without covering navigation', async ({
  page,
}) => {
  await page.route(`${api}/auth/session`, (route) => route.abort('failed'));
  await page.route(`${api}/auth/refresh`, (route) => route.abort('failed'));
  await page.goto(site);
  const alert = page.getByRole('alert').filter({ hasText: 'You can keep browsing' });
  await expect(alert).toBeVisible();
  const header = await page.locator('.site-header').boundingBox();
  const box = await alert.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Materials', exact: true })
    .click();
  await expect(page).toHaveURL(`${site}/products`);
});

test('basket feedback names the material; comparison survives reload; basket page has one summary', async ({
  page,
}) => {
  await page.goto(`${site}/products/${cement}`);
  const main = page.getByRole('main');
  await expect(main.getByLabel('Quantity for TEST UX Cement')).toBeEnabled();
  await expect(main.getByText('1 × bag', { exact: true }).first()).toBeVisible();
  await expect(main.getByText(/Confirm the final price/)).toHaveCount(0);
  await main.getByLabel('Quantity for TEST UX Cement').fill('12');
  await main.getByLabel('Quantity for TEST UX Cement').press('Tab');
  await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'TEST UX Cement: 12 × bag in your basket.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /^Basket · 1 material ₹/ })).toBeVisible();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await page.goto(`${site}/products/${steel}`);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Comparing ✓', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto(`${site}/compare`);
  await expect(page.locator('.comparison')).toContainText('TEST UX Cement');
  await expect(page.locator('.comparison')).toContainText('TEST UX Steel');
  await expect(page.locator('.comparison')).toContainText('/ kg');
  await page.goto(`${site}/cart`);
  await expect(main.getByLabel('Quantity for TEST UX Cement')).toHaveValue('12');
  await expect(page.getByRole('link', { name: /^Basket · 1 material/ })).toHaveCount(0);
});

test('phone catalogue keeps products near the top with an explicit filter toggle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${site}/products`);
  const toggle = page.getByRole('button', { name: 'Filter & sort' });
  const brand = page.getByRole('combobox', { name: 'Brand', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(brand).toBeHidden();
  await expect(page.getByRole('main').locator('.product-card').first()).toBeInViewport();
  const chips = page.getByRole('navigation', { name: 'Browse categories' });
  // Categories scroll sideways in one row instead of wrapping above the products.
  const rows = await chips.evaluate(
    (element) => new Set([...element.children].map((chip) => (chip as HTMLElement).offsetTop)).size,
  );
  expect(rows).toBe(1);
  expect(await chips.evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await brand.selectOption('TEST UX');
  await expect(page).toHaveURL(/brand=TEST\+UX/);
  await expect(page.getByRole('main').locator('.product-card')).toHaveCount(2);
  await expect(toggle).toContainText('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('unapproved shop content is marked for review and never shown as a business fact', async ({
  page,
}) => {
  await page.goto(site);
  await expect(page.getByText(/awaiting (family )?approval/i)).toHaveCount(0);
  const notes = page.getByRole('complementary', { name: 'Internal content review note' });
  await expect(notes.first()).toContainText('not shown to customers');
  await expect(notes).toHaveCount(2);
  await expect(
    page.locator('a[href^="tel:"], a[href*="wa.me"], a[href*="google.com/maps"]'),
  ).toHaveCount(0);
  await page.goto(`${site}/quotes`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});
