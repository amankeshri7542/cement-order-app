import { type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import {
  apiUrl as api,
  appLogin,
  appUrl as web,
  basketTab,
  openBasket,
  productRow,
  searchMaterials,
  tab,
  verifyCode,
} from './app';

const row = (page: Page) => productRow(page, 'test-ultratech');

async function login(page: Page, phone: string) {
  await appLogin(page, phone);
  await searchMaterials(page, 'UltraTech Super');
}

async function addOne(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/cart/items') && r.request().method() === 'PUT' && r.ok(),
  );
  await row(page)
    .getByRole('button', { name: /^(Add to basket|Increase UltraTech Super quantity)$/ })
    .click();
  await response;
}

test('a guest basket merges once at sign-in and a second add waits for it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(web);
  await searchMaterials(page, 'UltraTech Super');
  await row(page).getByRole('button', { name: 'Add to basket', exact: true }).click();
  await expect(basketTab(page)).toHaveAccessibleName('Basket, 1');
  // Guests keep their basket on the device: nothing is sent until sign-in.
  expect(await page.evaluate(() => localStorage.getItem('shiv_guest_basket'))).toContain(
    'test-ultratech',
  );

  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const merges: unknown[] = [];
  await page.route('**/api/v1/cart/merge', async (route) => {
    merges.push(route.request().postDataJSON());
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response });
  });
  await tab(page, 'Account').click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await verifyCode(page, '9888888825');
  await sent;
  // A second add while the merge is unconfirmed must wait for the merged basket.
  await searchMaterials(page, 'UltraTech Super');
  const secondAdd = row(page)
    .getByRole('button', { name: /^(Add to basket|Increase UltraTech Super quantity)$/ })
    .click();
  try {
    await page.waitForTimeout(300);
  } finally {
    release();
  }
  await secondAdd;
  await expect
    .poll(async () => {
      const lines = await (await page.request.get(`${api}/cart`)).json();
      return lines.find((line: { productId: string }) => line.productId === 'test-ultratech')
        ?.quantity;
    })
    .toBe(2);
  expect(merges).toHaveLength(1);
  await expect(
    row(page).getByRole('textbox', { name: 'UltraTech Super quantity', exact: true }),
  ).toHaveValue('2');
  expect(await page.evaluate(() => localStorage.getItem('shiv_guest_basket'))).toBeNull();
});

test('Enter commits a whole quantity; offline recovery preserves it and another account sees no basket', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, '9888888861');
  await addOne(page);
  await openBasket(page);
  await page.route('**/cart/items', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ response });
  });
  const quantity = page.getByRole('textbox', { name: 'UltraTech Super quantity', exact: true });
  await quantity.fill('');
  await quantity.pressSequentially('12', { delay: 100 });
  await expect(quantity).toHaveValue('12');
  await quantity.press('Enter');
  await expect
    .poll(async () => (await (await page.request.get(`${api}/cart`)).json())[0]?.quantity)
    .toBe(12);
  await expect(basketTab(page)).toHaveAccessibleName('Basket, 12');
  await page.unroute('**/cart/items');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /connection|offline|network|Cannot reach/i })
      .first(),
  ).toBeVisible();
  await expect(quantity).toHaveValue('12');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
  await expect(quantity).toHaveValue('12');
  await page.reload();
  await openBasket(page);
  await expect(quantity).toHaveValue('12');
  await page.screenshot({
    path: test.info().outputPath('customer-basket-360-reconnected.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await tab(page, 'Account').click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Current rates', { exact: true })).toBeVisible();
  await login(page, '9888888862');
  expect(await (await page.request.get(`${api}/cart`)).json()).toEqual([]);
  await expect(row(page).getByRole('button', { name: 'Add to basket', exact: true })).toBeVisible();
});

test('basket badge and product row show quantities after repeated adds, edits, reload and removal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, '9888888820');
  await addOne(page);
  await addOne(page);
  const stored = await (await page.request.get(`${api}/cart`)).json();
  expect(
    stored.find((line: { productId: string }) => line.productId === 'test-ultratech').quantity,
  ).toBe(2);
  await expect(basketTab(page)).toHaveAccessibleName('Basket, 2');
  await expect(
    row(page).getByRole('textbox', { name: 'UltraTech Super quantity', exact: true }),
  ).toHaveValue('2');
  await page.reload();
  await expect(basketTab(page)).toHaveAccessibleName('Basket, 2');
  await searchMaterials(page, 'UltraTech Super');
  await row(page).getByRole('button', { name: 'Decrease UltraTech Super quantity' }).click();
  await expect(
    row(page).getByRole('textbox', { name: 'UltraTech Super quantity', exact: true }),
  ).toHaveValue('1');
  await row(page).getByRole('button', { name: 'Decrease UltraTech Super quantity' }).click();
  await expect(row(page).getByRole('button', { name: 'Add to basket', exact: true })).toBeVisible();
  await expect(basketTab(page)).toHaveAccessibleName('Basket');
  expect(await (await page.request.get(`${api}/cart`)).json()).toEqual([]);
});

test('typing a multi-digit basket quantity commits the whole value on a slow connection', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, '9888888821');
  await addOne(page);
  await openBasket(page);
  await page.route('**/cart/items', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ response });
  });
  const quantity = page.getByRole('textbox', { name: 'UltraTech Super quantity', exact: true });
  await quantity.fill('');
  await quantity.pressSequentially('12', { delay: 100 });
  await expect(quantity).toHaveValue('12');
  await page.getByText('Your basket', { exact: true }).click();
  await expect(quantity).toHaveValue('12');
  await expect
    .poll(async () => (await (await page.request.get(`${api}/cart`)).json())[0]?.quantity)
    .toBe(12);
  await expect(basketTab(page)).toHaveAccessibleName('Basket, 12');
});

test('a delayed account refresh cannot replace a newer basket change', async ({ page }) => {
  await login(page, '9888888822');
  await addOne(page);
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const snapshot = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route('**/api/v1/cart', async (route) => {
    const response = await route.fetch();
    if ((await response.json())[0]?.quantity !== 1) return route.fulfill({ response });
    captured();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Refresh current screen' }).click();
  await snapshot;
  await addOne(page);
  await openBasket(page);
  const quantity = page.getByRole('textbox', { name: 'UltraTech Super quantity', exact: true });
  await expect(quantity).toHaveValue('2');
  const received = page.waitForResponse(
    (r) => r.url() === `${api}/cart` && r.request().method() === 'GET',
  );
  release();
  await (await received).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole('button', { name: 'Refresh current screen' })).toBeEnabled();
  await expect(quantity).toHaveValue('2');
  expect((await (await page.request.get(`${api}/cart`)).json())[0].quantity).toBe(2);
});

test('a basket response finishing after sign-out cannot restore the previous customer basket', async ({
  page,
}) => {
  await login(page, '9888888823');
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route('**/cart/items', async (route) => {
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response });
  });
  await row(page).getByRole('button', { name: 'Add to basket', exact: true }).click();
  await committed;
  await tab(page, 'Account').click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await tab(page, 'Account').click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  const received = page.waitForResponse(
    (r) => r.url().endsWith('/cart/items') && r.request().method() === 'PUT',
  );
  release();
  await (await received).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(basketTab(page)).toHaveAccessibleName('Basket');
  await expect(page.getByText('UltraTech Super added to basket', { exact: true })).toBeHidden();
});

test('product row quantity respects minimum, step and stock and explains rejected typing', async ({
  page,
}) => {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  try {
    await db.product.create({
      data: {
        id: 'cart-quantity-rules',
        name: 'Cart rule cement',
        brand: 'Test',
        categoryId: 'cement',
        type: 'PPC',
        grade: 'PPC',
        unit: 'bag',
        pricePaise: 39000,
        stock: 20,
        minQuantity: 10,
        quantityStep: 5,
        images: [],
        description: 'Test fixture',
        recommendedUse: '',
      },
    });
  } finally {
    await db.$disconnect();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await appLogin(page, '9888888824');
  await searchMaterials(page, 'Cart rule cement');
  const card = productRow(page, 'cart-quantity-rules');
  await card.getByRole('button', { name: 'Add to basket', exact: true }).click();
  const quantity = card.getByRole('textbox', { name: 'Cart rule cement quantity' });
  await expect(quantity).toHaveValue('10');
  await card.getByRole('button', { name: 'Increase Cart rule cement quantity' }).click();
  await expect(quantity).toHaveValue('15');
  await quantity.fill('13');
  await quantity.blur();
  await expect(quantity).toHaveValue('15');
  await expect(
    page.getByText('Enter a quantity from 10 to 20, in steps of 5.', { exact: true }),
  ).toBeVisible();
  await card.getByRole('button', { name: 'Increase Cart rule cement quantity' }).click();
  await expect(quantity).toHaveValue('20');
  await expect(
    card.getByRole('button', { name: 'Increase Cart rule cement quantity' }),
  ).toBeDisabled();
  expect((await (await page.request.get(`${api}/cart`)).json())[0].quantity).toBe(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
