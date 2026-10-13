import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { test, expect, observePage } from './fixtures';

const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const productId = 'qa-stock-cement';
const name = 'QA Stock Cement';
test.use({ actionTimeout: 15000 });
test.beforeAll(async () => {
  await db.product.upsert({
    where: { id: productId },
    update: {},
    create: {
      id: productId,
      name,
      categoryId: 'cement',
      brand: 'QA',
      type: 'PPC',
      grade: 'PPC',
      unit: '50 kg bag',
      pricePaise: 39000,
      stock: 20,
      images: [],
      description: 'QA fixture only',
      recommendedUse: 'QA only',
    },
  });
});
test.afterAll(() => db.$disconnect());

async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'en'));
  await page.goto('http://localhost:3001');
  await page.getByRole('textbox', { name: 'Staff mobile number' }).fill('9297513707');
  const sent = page.waitForResponse((r) => r.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get verification code' }).click();
  await page
    .getByRole('textbox', { name: 'Verification code', exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}
async function products(page: Page) {
  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('button', { name: 'Prices & stock', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Search products', exact: true }).fill(name);
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
}

test('stock receipt, counter sale, damage, return and adjustment preserve the ledger and balance', async ({
  page,
}) => {
  await login(page);
  await products(page);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: `Stock ledger ${name}`, exact: true }).click();
  for (const [kind, quantity, balance] of [
    ['PURCHASE_IN', 10, 30],
    ['WALK_IN_SALE', 5, 25],
    ['DAMAGE', 2, 23],
    ['RETURN', 1, 24],
    ['MANUAL_ADJUSTMENT', -3, 21],
  ] as const) {
    await page.getByRole('combobox', { name: 'Movement', exact: true }).selectOption(kind);
    await page.getByLabel('Quantity', { exact: true }).fill(String(quantity));
    await page.getByLabel('Receipt / reference', { exact: true }).fill(`QA-${kind}`);
    await page
      .getByLabel('Reason', { exact: true })
      .fill('QA counted fixture stock; no actual goods or money');
    await page.getByRole('button', { name: 'Record stock movement', exact: true }).click();
    await expect(
      page.getByRole('dialog').getByRole('cell', {
        name: `QA-${kind} QA counted fixture stock; no actual goods or money`,
        exact: true,
      }),
    ).toBeVisible();
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(balance);
  }
  expect(await db.inventoryMovement.count({ where: { productId } })).toBe(5);
  const sale = await db.inventoryMovement.findFirstOrThrow({
    where: { productId, kind: 'WALK_IN_SALE' },
  });
  const collection = await db.financialMovement.findUniqueOrThrow({
    where: { inventoryMovementId: sale.id },
  });
  expect(collection).toMatchObject({ kind: 'COUNTER_SALE', amountPaise: 195000 });
  await page.screenshot({
    path: test.info().outputPath('five-stock-movements.png'),
    fullPage: true,
  });
});

test('photo URL persists, stale product edit cannot overwrite it, and unavailable upload explains recovery', async ({
  page,
  context,
}) => {
  await login(page);
  await products(page);
  const other = await context.newPage();
  observePage(other, test.info());
  try {
    await other.goto('http://localhost:3001');
    await expect(other.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await products(other);
    const photo =
      'https://assets.example.invalid/products/00000000-0000-4000-8000-000000000001.webp';
    // Simulated validated storage asset; real publication/version checks remain enforced.
    await db.productAsset.upsert({
      where: { url: photo },
      update: {},
      create: { id: 'products/00000000-0000-4000-8000-000000000001.webp', url: photo },
    });
    // Only image pixels are a fixture; product persistence/version checks use the real backend.
    await context.route(photo, (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
    await other.getByLabel('Product image URL', { exact: true }).fill(photo);
    await other.getByLabel('Selling price (₹)', { exact: true }).fill('400');
    await other.getByRole('button', { name: 'Save product', exact: true }).click();
    await expect(other.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('Selling price (₹)', { exact: true }).fill('350');
    await page.getByRole('button', { name: 'Save product', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/changed|refresh/i);
    const stored = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(stored.pricePaise).toBe(40000);
    expect(stored.images).toEqual([photo]);
    await page
      .getByRole('dialog')
      .locator('input[type=file]')
      .setInputFiles({
        name: 'qa.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII=',
          'base64',
        ),
      });
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      'Configure object storage before uploading images.',
    );
    await expect(page.getByLabel('Selling price (₹)', { exact: true })).toHaveValue('350');
    await page.screenshot({
      path: test.info().outputPath('unavailable-photo-storage.png'),
      fullPage: true,
    });
  } finally {
    await other.close();
  }
});
