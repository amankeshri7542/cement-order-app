import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Phase 4: the owner desk in Hindi by default, counter sales with agreed price and cash/UPI,
// the money report and its Excel download, per-product low-stock levels, staff and alerts.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const productId = 'p4-counter-cement';
const productName = 'P4 Counter Cement';
test.use({ actionTimeout: 15000 });
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  await db.product.upsert({
    where: { id: productId },
    update: { stock: 50, lowStockAt: 25, active: true },
    create: {
      id: productId,
      name: productName,
      categoryId: 'cement',
      brand: 'QA',
      type: 'PPC',
      grade: 'PPC',
      unit: '50 kg bag',
      pricePaise: 40000,
      stock: 50,
      images: [],
      description: 'Phase 4 desk fixture only',
      recommendedUse: 'QA only',
    },
  });
});
test.afterAll(() => db.$disconnect());

async function signIn(
  page: Page,
  words = { send: 'Get verification code', open: 'Open store desk' },
) {
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: words.send }).click();
  await page
    .locator('input[autocomplete="one-time-code"]')
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: words.open }).click();
}

test('the desk opens in Hindi with no pre-filled number and switches to English', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'hi'));
  await page.goto(desk);
  await expect(page.getByRole('heading', { name: 'नमस्ते।' })).toBeVisible();
  const phone = page.getByRole('textbox', { name: 'स्टाफ़ का मोबाइल नंबर' });
  await expect(phone).toHaveValue('');
  await phone.fill('9297513713');
  await signIn(page, { send: 'कोड भेजें', open: 'दुकान डेस्क खोलें' });
  await expect(page.getByRole('heading', { name: 'आज', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^नया काम/ })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(desk);
    await page.getByRole('textbox', { name: 'Staff mobile number' }).fill('9297513713');
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  });

  test('counter sale at an agreed price paid by UPI reaches stock and the money report', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Counter sale' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Material').selectOption(productId);
    await dialog.getByLabel('Quantity', { exact: true }).fill('2');
    await dialog.getByLabel('Price per unit (₹)').fill('380');
    await dialog.getByLabel('Paid by').selectOption('UPI');
    await dialog.getByLabel('Buyer name / phone (optional)').fill('Ramesh mistri');
    await dialog.getByRole('button', { name: 'Record sale' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Counter sale recorded' }),
    ).toBeVisible();
    await expect(dialog).toBeHidden();
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.stock).toBe(48);
    const sale = await db.financialMovement.findFirstOrThrow({
      where: { counterParty: 'Ramesh mistri' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(sale).toMatchObject({ channel: 'UPI', amountPaise: 76000 });

    await page.getByRole('button', { name: 'Today’s money' }).click();
    await expect(page.getByRole('heading', { name: 'Money', exact: true })).toBeVisible();
    const upi = page.getByRole('region', { name: 'Money summary' }).locator('article', {
      hasText: 'UPI',
    });
    await expect(upi).toContainText('counter');
    const report = await page.evaluate(async () => {
      const day = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
      const r = await fetch(
        `http://localhost:4010/api/v1/admin/reports/money?from=${day}&to=${day}`,
        {
          credentials: 'include',
        },
      );
      return r.json();
    });
    expect(report.counter.upiPaise).toBeGreaterThanOrEqual(76000);
    await page.getByRole('button', { name: 'Last 7 days' }).click();
    await expect(page.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download for Excel (CSV)' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(
      /^shiv-money-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const csv = readFileSync((await file.path())!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('UPI');
  });

  test('a per-product low-stock level drives the warning', async ({ page }) => {
    await page
      .getByRole('navigation', { name: 'Main navigation', exact: true })
      .getByRole('button', { name: 'Prices & stock', exact: true })
      .click();
    await page.getByRole('textbox', { name: 'Search products' }).fill(productName);
    await page.getByRole('button', { name: `Edit ${productName}` }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Low-stock alert at').fill('60');
    await dialog.getByRole('button', { name: 'Save product' }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByRole('row').filter({ hasText: productName });
    await expect(row).toContainText('Alert at 60');
    await expect(row.locator('.low-stock')).toBeVisible();
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).lowStockAt).toBe(60);
  });

  test('staff screen edits roles, queues a WhatsApp test alert and logs it in plain language', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'More', exact: true }).last().click();
    await page.getByRole('button', { name: 'Staff & alerts', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Phase 4 desk admin' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Role at the shop').fill('Retail counter');
    await dialog.getByRole('checkbox', { name: /WhatsApp alerts/ }).check();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText('Retail counter · +919297513713 · WhatsApp alerts on'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Send a test alert' }).click();
    await expect(page.getByText(/Test alert sent/)).toBeVisible();
    const log = page.locator('.activity-list li').filter({ hasText: 'Test alert' }).first();
    await expect(log).toContainText('Sent');
    await expect(log).toContainText('…3713');
    expect(
      await db.outboundMessage.count({
        where: { template: 'shiv_test_alert', recipient: '919297513713', status: 'SENT' },
      }),
    ).toBeGreaterThan(0);

    // No server keys in tests: the desk explains instead of failing silently.
    await page.getByRole('button', { name: 'Turn on alerts here' }).click();
    await expect(page.locator('.error[role="alert"]')).toContainText(
      /not set up on the server|cannot show alerts/,
    );

    await page.getByRole('button', { name: 'More', exact: true }).last().click();
    await page.getByRole('button', { name: 'Store activity', exact: true }).click();
    const entry = page
      .locator('.activity-list li')
      .filter({ hasText: 'Staff details changed' })
      .first();
    await expect(entry).toContainText('Phase 4 desk admin');
    await expect(page.locator('.activity-list')).not.toContainText('{');
  });
});
