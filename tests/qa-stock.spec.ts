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
  await page.getByRole('textbox', { name: 'Staff mobile number' }).fill('9999997007');
  const sent = page.waitForResponse((r) => r.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get verification code' }).click();
  await page
    .getByRole('textbox', { name: 'Verification code', exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}
async function products(page: Page) {
  await page.goto('http://localhost:3001/stock?tab=maal');
  await page.getByRole('searchbox', { name: 'Find goods or brand', exact: true }).fill(name);
  await page.getByRole('button', { name: `Change goods ${name}`, exact: true }).click();
}

test('goods in, goods back and an owner correcting the count preserve the ledger and balance', async ({
  page,
}) => {
  await login(page);
  await page.goto('http://localhost:3001/stock');
  const row = page.getByRole('row').filter({ hasText: name }).first();
  for (const [button, kind, field, quantity, balance] of [
    ['New stock came', 'PURCHASE_IN', 'Quantity received', '10', 30],
    ['Goods came back', 'RETURN', 'How many came back', '1', 31],
    [
      'Correct the stock',
      'MANUAL_ADJUSTMENT',
      'How many to add or take away (a minus sign takes away)',
      '-3',
      28,
    ],
  ] as const) {
    await row.getByRole('button', { name: button, exact: true }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel(field, { exact: true }).fill(quantity);
    await sheet
      .getByLabel('Purchase or stock note', { exact: true })
      .fill(`QA-${kind} counted fixture stock; no actual goods or money`);
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect
      .poll(async () => (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock)
      .toBe(balance);
  }
  const moves = await db.inventoryMovement.findMany({
    where: { productId },
    orderBy: { createdAt: 'asc' },
  });
  expect(moves.map((row) => [row.kind, row.quantity])).toEqual([
    ['PURCHASE_IN', 10],
    ['RETURN', 1],
    ['MANUAL_ADJUSTMENT', -3],
  ]);
  await page.screenshot({
    path: test.info().outputPath('stock-movements.png'),
    fullPage: true,
  });
});

test('a stale product edit cannot overwrite a newer one, and an unavailable upload explains recovery', async ({
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
    await other.getByLabel('Selling rate (₹)', { exact: true }).fill('400');
    await other.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(other.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('Selling rate (₹)', { exact: true }).fill('350');
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/changed/i);
    const stored = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(stored.pricePaise).toBe(40000);
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
    await expect(
      page
        .getByRole('dialog')
        .getByRole('alert')
        .filter({ hasText: 'Configure object storage before uploading images.' }),
    ).toBeVisible();
    await expect(page.getByLabel('Selling rate (₹)', { exact: true })).toHaveValue('350');
    await page.screenshot({
      path: test.info().outputPath('unavailable-photo-storage.png'),
      fullPage: true,
    });
  } finally {
    await other.close();
  }
});
