import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

async function login(page: Page, phone: string) {
  await page.goto('http://localhost:3001');
  await page.getByLabel('Staff mobile number').fill(phone);
  const otp = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code' }).click();
  await page
    .getByLabel('Verification code', { exact: true })
    .fill((await (await otp).json()).devCode);
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your materials counter.', exact: true }),
  ).toBeVisible();
  if (await page.getByRole('button', { name: 'Open menu', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Rate Studio', exact: true }).click();
}

async function create(page: Page, action: string, title: string) {
  await page.getByRole('button', { name: new RegExp(action) }).click();
  await page.getByLabel('Price sheet title').fill(title);
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
}
async function choose(page: Page) {
  await page.getByLabel('Search rate products').fill('UltraTech Super');
  await page
    .locator('.rs-picker-product')
    .filter({ hasText: 'UltraTech Super' })
    .getByRole('checkbox')
    .check();
  await page.getByRole('button', { name: 'Add 1 products' }).click();
}
async function approve(page: Page) {
  await page.getByLabel(/I checked.*product, unit and price/).check();
  const warnings = page.getByLabel(/I verified.*warnings above/);
  if (await warnings.isVisible()) await warnings.check();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish prices', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish prices', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm & publish prices', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Published price record' })).toBeVisible();
  await expect(page.getByText(/This product changed after review/)).toHaveCount(0);
}
async function upload(page: Page, width: number) {
  await page.locator('input[type=file]').setInputFiles({
    name: 'supplier.png',
    mimeType: 'image/png',
    buffer: await sharp({ create: { width, height: 1, channels: 3, background: '#eeeeee' } })
      .png()
      .toBuffer(),
  });
  await expect(page.getByRole('button', { name: 'Extract prices', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Extract prices', exact: true }).click();
}

test('scanned sheet requires low-confidence review, publishes and produces exact downloadable artwork', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await login(page, '9297513710');
  await create(page, 'Scan a rate sheet', 'Browser scanned rates');
  await upload(page, 1);
  await expect(page.getByText(/45% extraction confidence/)).toBeVisible();
  await page.getByLabel('New price row 1').fill('485');
  await page.screenshot({ path: 'test-results/rate-studio-review.png', fullPage: true });
  await approve(page);
  await page.screenshot({ path: 'test-results/rate-studio-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /Create.*rate card/i }).click();
  await page.getByLabel(/I checked.*claims/).check();
  await page.getByRole('button', { name: 'Generate rate card', exact: true }).click();
  await expect(page.locator('.rs-card-preview')).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.rs-card-preview').evaluate((el: HTMLImageElement) => el.naturalWidth),
    )
    .toBe(1080);
  const svgLink = await page.getByRole('link', { name: 'Open printable SVG' }).getAttribute('href');
  const svg = await (await page.request.get(svgLink!)).text();
  expect(svg).toContain('485.00');
  expect(svg).toContain('UltraTech Super');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).click();
  const artifact = await downloaded;
  expect(artifact.suggestedFilename()).toMatch(/shiv-rates-.*\.png/);
  await artifact.saveAs('test-results/rate-card.png');
  await page.screenshot({ path: 'test-results/rate-card-preview.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('phone staff can recover failed AI with a manual reviewed sheet and protect unsaved edits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, '9297513711');
  await create(page, 'Scan a rate sheet', 'Browser failed source');
  await upload(page, 2);
  await expect(page.getByText(/interpretation unavailable/)).toBeVisible();
  await expect(page.locator('.rs-source-image')).toBeVisible();
  await page.getByRole('button', { name: 'Choose products', exact: true }).click();
  await choose(page);
  await page.getByLabel('New price row 1').fill('490');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Products', exact: true }).click();
  await expect(page.getByLabel('New price row 1')).toHaveValue('490');
  await page.getByRole('button', { name: 'Rate Studio', exact: true }).click();
  await approve(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/rate-studio-mobile.png', fullPage: true });
});

test('manual entry and percentage adjustment remain available without extraction', async ({
  page,
}) => {
  await login(page, '9297513712');
  await create(page, 'Enter prices manually', 'Browser manual rates');
  await page.getByRole('button', { name: 'Choose products', exact: true }).click();
  await choose(page);
  await page.getByLabel('New price row 1').fill('500');
  await approve(page);
  await page.getByRole('button', { name: 'All price sheets', exact: true }).click();
  await create(page, 'Increase / decrease', 'Browser five percent preview');
  await page.getByLabel('Search rate products').fill('UltraTech Super');
  await page
    .locator('.rs-picker-product')
    .filter({ hasText: 'UltraTech Super' })
    .getByRole('checkbox')
    .check();
  await page.getByLabel('Adjustment type').selectOption('PERCENT');
  await page.getByLabel('Percentage (%)', { exact: true }).fill('5');
  await page.getByRole('button', { name: /Preview.*1/ }).click();
  await expect(page.getByLabel('New price row 1')).toHaveValue('525');
  const product = await (
    await page.request.get('http://localhost:4010/api/v1/products/test-ultratech')
  ).json();
  expect(product.pricePaise).toBe(50000);
  await approve(page);
});
