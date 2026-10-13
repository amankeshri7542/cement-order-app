import { type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';

const web = 'http://localhost:8082';
const api = 'http://localhost:4010/api/v1';

test('a guest add replay cannot overlap a second signed-in cart addition', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(web);
  await material(page).getByRole('button', { name: 'Add to cart', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mobile number (+91)' }).fill('9888888825');
  const otp = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.ok(),
  );
  await page.getByRole('button', { name: 'Get verification code' }).click();
  await page
    .getByRole('textbox', { name: 'Verification code', exact: true })
    .fill((await (await otp).json()).devCode);

  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let first = true;
  await page.route('**/api/v1/cart/items', async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Verify & continue' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await saved;
  // A second real click must wait for the pending guest mutation's confirmed cart.
  const secondAdd = material(page)
    .getByRole('button', { name: /^(Add to cart|Increase UltraTech Super quantity)$/ })
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
  await expect(
    material(page).getByRole('textbox', { name: 'UltraTech Super quantity' }),
  ).toHaveValue('2');
});

async function login(page: Page, phone: string) {
  await page.goto(web);
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Mobile number (+91)' }).fill(phone);
  const otp = page.waitForResponse((r) => r.url().endsWith('/auth/otp/request') && r.ok());
  await page.getByRole('button', { name: 'Get verification code' }).click();
  await page
    .getByRole('textbox', { name: 'Verification code', exact: true })
    .fill((await (await otp).json()).devCode);
  await page.getByRole('button', { name: 'Verify & continue' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
}

function material(page: Page) {
  return page.getByRole('button', { name: 'View UltraTech Super', exact: true }).locator('..');
}

async function addOne(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/cart/items') && r.request().method() === 'PUT' && r.ok(),
  );
  await material(page)
    .getByRole('button', {
      name: /^(Add to cart|Increase UltraTech Super quantity)$/,
    })
    .click();
  await response;
}

test('Enter commits a whole quantity; offline recovery preserves it and another account sees no cart', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, '9888888861');
  await addOne(page);
  await page.getByRole('button', { name: 'Your cart, 1 item, 1 product' }).click();
  await page.route('**/cart/items', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ response });
  });
  const quantity = page.getByRole('textbox', { name: 'Quantity', exact: true });
  await quantity.fill('');
  await quantity.pressSequentially('12', { delay: 100 });
  await expect(quantity).toHaveValue('12');
  await quantity.press('Enter');
  await expect
    .poll(async () => (await (await page.request.get(`${api}/cart`)).json())[0]?.quantity)
    .toBe(12);
  await expect(page.getByRole('button', { name: 'Your cart, 12 items, 1 product' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Your cart, 12 items, 1 product' }).click();
  await expect(quantity).toHaveValue('12');
  await page.screenshot({
    path: test.info().outputPath('customer-cart-360-reconnected.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login(page, '9888888862');
  expect(await (await page.request.get(`${api}/cart`)).json()).toEqual([]);
  await expect(
    material(page).getByRole('button', { name: 'Add to cart', exact: true }),
  ).toBeVisible();
});

test('cart badge and product card show quantities after repeated adds, edits, reload and removal', async ({
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
  await expect(
    page.getByRole('button', { name: /^Your cart,/ }).getByText('2', { exact: true }),
  ).toBeVisible();
  await expect(
    material(page).getByRole('textbox', { name: 'UltraTech Super quantity' }),
  ).toHaveValue('2');
  await page.reload();
  await expect(
    page.getByRole('button', { name: /^Your cart,/ }).getByText('2', { exact: true }),
  ).toBeVisible();
  await material(page).getByRole('button', { name: 'Decrease UltraTech Super quantity' }).click();
  await expect(
    material(page).getByRole('textbox', { name: 'UltraTech Super quantity' }),
  ).toHaveValue('1');
  await material(page).getByRole('button', { name: 'Decrease UltraTech Super quantity' }).click();
  await expect(
    material(page).getByRole('button', { name: 'Add to cart', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Your cart,/ }).getByText(/^\d+$/)).toHaveCount(0);
  expect(await (await page.request.get(`${api}/cart`)).json()).toEqual([]);
});

test('typing a multi-digit cart quantity commits the whole value on a slow connection', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, '9888888821');
  await addOne(page);
  await page.getByRole('button', { name: /^Your cart,/ }).click();
  await page.route('**/cart/items', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ response });
  });
  const quantity = page.getByRole('textbox', { name: 'Quantity', exact: true });
  await quantity.fill('');
  await quantity.pressSequentially('12', { delay: 100 });
  await expect(quantity).toHaveValue('12');
  await page.getByText('Your cart', { exact: true }).click();
  await expect(quantity).toHaveValue('12');
  await expect
    .poll(async () => (await (await page.request.get(`${api}/cart`)).json())[0]?.quantity)
    .toBe(12);
  await expect(
    page.getByRole('button', { name: /^Your cart,/ }).getByText('12', { exact: true }),
  ).toBeVisible();
});

test('a delayed account refresh cannot replace a newer cart mutation', async ({ page }) => {
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
  await page.getByRole('button', { name: /^Your cart,/ }).click();
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue('2');
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
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue('2');
  expect((await (await page.request.get(`${api}/cart`)).json())[0].quantity).toBe(2);
});

test('a cart response finishing after sign-out cannot restore the previous customer cart', async ({
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
  await material(page).getByRole('button', { name: 'Add to cart', exact: true }).click();
  await committed;
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
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
  await expect(page.getByRole('button', { name: /^Your cart,/ })).toHaveAttribute(
    'aria-label',
    'Your cart, 0 items, 0 products',
  );
  await expect(page.getByText('UltraTech Super added to cart', { exact: true })).toBeHidden();
});

test('product card quantity respects minimum, step and stock and explains rejected typing', async ({
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
  await login(page, '9888888824');
  const card = page
    .getByRole('button', { name: 'View Cart rule cement', exact: true })
    .locator('..');
  await card.getByRole('button', { name: 'Add to cart', exact: true }).click();
  const quantity = card.getByRole('textbox', { name: 'Cart rule cement quantity' });
  await expect(quantity).toHaveValue('10');
  await card.getByRole('button', { name: 'Increase Cart rule cement quantity' }).click();
  await expect(quantity).toHaveValue('15');
  await quantity.fill('13');
  await page.getByRole('button', { name: 'Shiv Cement Store home' }).click();
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
