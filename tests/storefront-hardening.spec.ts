import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { test, expect, verifyAndSkipName } from './fixtures';

// Audit F14/F36 regressions: checkout review survival, guest taps, compare, dates and layout.
const site = 'http://localhost:3004';
const api = 'http://localhost:4010/api/v1';
const cement = 'test-hard-cement';
const steel = 'test-hard-steel';
const gone = 'test-hard-gone';
const empty = 'test-hard-empty';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (error) => list.push(error.message));
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
function database() {
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    !new URL(url).pathname.endsWith('_test') ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  )
    throw new Error('Disposable loopback database required');
  return new PrismaClient({ datasourceUrl: url });
}
test.beforeAll(async () => {
  const db = database();
  try {
    for (const [id, name, stock] of [
      [cement, 'TEST HARD Cement', 500],
      [steel, 'TEST HARD Steel', 500],
      [gone, 'TEST HARD Retired', 500],
      [empty, 'TEST HARD Empty', 0],
    ] as const) {
      const data = {
        name,
        categoryId: 'cement',
        brand: 'TEST HARD',
        type: 'Cement',
        grade: 'TEST grade',
        unit: 'bag',
        packSize: '50 kg',
        minQuantity: 1,
        quantityStep: 1,
        pricePaise: 38000,
        stock,
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
async function login(page: Page, phone: string, next = '/cart') {
  await page.goto(`${site}/account?next=${encodeURIComponent(next)}`);
  const field = page.getByRole('main').getByLabel('Mobile number', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill(phone);
  const otp = page.waitForResponse((response) => response.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get sign-in code', exact: true }).click();
  const response = await otp;
  expect(response.status(), await response.text()).toBe(201);
  await page
    .getByRole('main')
    .getByLabel('Six-digit code')
    .fill((await response.json()).devCode);
  await verifyAndSkipName(page, () =>
    page.getByRole('button', { name: 'Verify and continue', exact: true }).click(),
  );
  await expect(page).toHaveURL(`${site}${next}`);
}
async function seedAddress(page: Page, phone: string) {
  const response = await page.request.post(`${api}/me/addresses`, {
    headers: { Origin: site },
    data: {
      label: 'Test site',
      name: 'Website customer',
      phone: `+91${phone}`,
      line1: 'Plot 18',
      area: 'Kankarbagh',
      city: 'Patna',
      state: 'Bihar',
      pincode: '800020',
      landmark: '',
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function putCart(page: Page, quantity = 2) {
  const response = await page.request.put(`${api}/cart/items`, {
    headers: { Origin: site },
    data: { productId: cement, quantity },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function review(page: Page, phone: string) {
  await login(page, phone);
  await seedAddress(page, phone);
  await putCart(page);
  await page.goto(`${site}/checkout`);
  await page.getByRole('radio', { name: 'Deliver here', exact: true }).check();
  await page.getByRole('button', { name: 'Review current order', exact: true }).click();
  await expect(page.getByRole('checkbox')).toBeVisible();
  await page.getByRole('checkbox').check();
}

test('checkout review and consent survive focus, visibility and stream reconnects; a price change still clears them', async ({
  page,
}) => {
  // A stream that closes at once makes the browser reopen it every 200 ms, like a flaky network.
  let notice = '';
  await page.route(`${api}/events`, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
      body: `retry: 200\n\n${notice}`,
    }),
  );
  await review(page, '9888830001');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // Several stream reopens happen in this window.
  await page.waitForTimeout(1500);
  await expect(page.getByRole('checkbox')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Place COD order', exact: true })).toBeEnabled();
  notice = `data: ${JSON.stringify({ type: 'PRODUCT_PRICE_UPDATED', productId: cement })}\n\n`;
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Place COD order', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Review current order', exact: true }),
  ).toBeVisible();
});

test('placing an order replaces checkout in history, so Back does not reopen an empty checkout', async ({
  page,
}) => {
  await review(page, '9888830002');
  await page.getByRole('button', { name: 'Place COD order', exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/[^?]+\?confirmed=1/);
  await page.goBack();
  await expect(page).toHaveURL(`${site}/cart`);
});

test('a guest double tap on Add adds one pack; a later tap adds another', async ({ page }) => {
  await page.goto(`${site}/products/${cement}`);
  const main = page.getByRole('main');
  await expect(main.getByLabel('Quantity for TEST HARD Cement')).toBeEnabled();
  const add = page.getByRole('button', { name: 'Add to basket', exact: true });
  await add.dblclick();
  await expect(
    page.getByRole('status').filter({ hasText: 'TEST HARD Cement: 1 × bag in your basket.' }),
  ).toBeVisible();
  await page.waitForTimeout(800);
  await add.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'TEST HARD Cement: 2 × bag in your basket.' }),
  ).toBeVisible();
  await page.goto(`${site}/cart`);
  await expect(main.getByLabel('Quantity for TEST HARD Cement')).toHaveValue('2');
});

test('comparison drops a material that left the catalogue and shows the rest', async ({ page }) => {
  for (const id of [cement, steel, gone]) {
    await page.goto(`${site}/products/${id}`);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Comparing ✓', exact: true })).toBeVisible();
  }
  const db = database();
  try {
    await db.product.update({ where: { id: gone }, data: { active: false } });
    await page.goto(`${site}/compare`);
    await expect(page.getByRole('status').filter({ hasText: 'no longer available' })).toBeVisible();
    await expect(page.locator('.comparison')).toContainText('TEST HARD Cement');
    await expect(page.locator('.comparison')).toContainText('TEST HARD Steel');
    await expect(page.locator('.comparison')).not.toContainText('TEST HARD Retired');
    await expect(page.getByRole('link', { name: 'Compare (2/3)', exact: true })).toBeVisible();
    await expect(page.getByText('Loading the selected materials…')).toHaveCount(0);
  } finally {
    await db.product.update({ where: { id: gone }, data: { active: true } });
    await db.$disconnect();
  }
});

test('checkout defaults to tomorrow in Patna even just after midnight IST', async ({ page }) => {
  await login(page, '9888830003');
  await seedAddress(page, '9888830003');
  // 01:30 IST on 17 Oct is 20:00 UTC on 16 Oct; a UTC "tomorrow" would be the 17th.
  await page.clock.setFixedTime(new Date('2026-10-16T20:00:00Z'));
  await page.goto(`${site}/checkout`);
  await expect(page.getByLabel('Requested delivery date')).toHaveValue('2026-10-18');
});

test('the phone assistant button sits in the header and never covers the rate board', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(site);
  const launcher = page.getByRole('banner').getByRole('button', { name: 'Ask Shiv Assistant' });
  await expect(launcher).toBeVisible();
  const board = page.getByRole('complementary', { name: /Current rates/ });
  await board.scrollIntoViewIfNeeded();
  const a = (await launcher.boundingBox())!;
  const b = (await board.boundingBox())!;
  const overlaps =
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await launcher.click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('an out-of-stock material says so on its button in English and Hindi', async ({ page }) => {
  await page.goto(`${site}/products/${empty}`);
  await expect(page.getByRole('button', { name: 'Out of stock', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add to basket', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'हिन्दी', exact: true }).click();
  await expect(page.getByRole('button', { name: 'स्टॉक नहीं', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'English', exact: true }).click();
});

test('sign-in accepts an autofilled +91 number with spaces', async ({ page }) => {
  await page.goto(`${site}/account`);
  const field = page.getByRole('main').getByLabel('Mobile number', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill('+91 98888 30004');
  await expect(field).toHaveValue('9888830004');
  const request = page.waitForRequest((r) => r.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get sign-in code', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ phone: '+919888830004' });
  await expect(page.getByRole('main').getByLabel('Six-digit code')).toBeVisible();
});

test('basket checkout cannot be followed while saved guest materials are still merging', async ({
  page,
}) => {
  const phone = '9888830005';
  const db = database();
  try {
    const user = await db.user.create({ data: { phone: `+91${phone}` } });
    const product = await db.product.findUniqueOrThrow({ where: { id: steel } });
    await db.cartItem.create({
      data: {
        userId: user.id,
        productId: steel,
        quantity: 1,
        seenPricePaise: product.pricePaise,
        seenPriceVersion: product.priceVersion,
      },
    });
  } finally {
    await db.$disconnect();
  }
  await page.goto(`${site}/products/${cement}`);
  await expect(page.getByRole('main').getByLabel('Quantity for TEST HARD Cement')).toBeEnabled();
  await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
  await page.route(`${api}/cart/merge`, (route) => route.abort('failed'));
  await login(page, phone);
  await expect(page.getByRole('button', { name: 'Recover saved basket' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review delivery & checkout', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('link', { name: 'Review delivery & checkout', exact: true }),
  ).toHaveCount(0);
  await page.unroute(`${api}/cart/merge`);
  await page.getByRole('button', { name: 'Recover saved basket' }).click();
  await expect(page.getByRole('button', { name: 'Recover saved basket' })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Review delivery & checkout', exact: true }),
  ).toHaveAttribute('href', '/checkout');
});
