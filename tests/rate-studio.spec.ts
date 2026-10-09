import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import sharp from 'sharp';

async function login(page: Page, phone: string) {
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'en'));
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
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  if (await page.getByRole('button', { name: 'Open menu', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'More', exact: true }).last().click();
  await page.getByRole('button', { name: /Rate Studio$/ }).click();
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
  await page.getByLabel(/I checked.*product, unit and customer selling price/).check();
  const warnings = page.getByLabel(/I verified.*warnings above/);
  if (await warnings.isVisible()) await warnings.check();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish prices', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish prices', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'These must be the prices customers will pay, not supplier purchase costs.',
  );
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
  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('button', { name: 'Prices & stock', exact: true })
    .click();
  await expect(page.getByLabel('New price row 1')).toHaveValue('490');
  const sidebar = await page.locator('.sidebar').boundingBox();
  // Use the exposed scrim's middle; WebKit drops clicks at the viewport's right edge.
  await page.getByRole('button', { name: 'Close menu', exact: true }).click({
    position: { x: (sidebar!.x + sidebar!.width + page.viewportSize()!.width) / 2, y: 100 },
  });
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
  await expect(page.getByLabel('New price row 1')).toHaveValue('490');
  await expect(
    page.getByLabel(/I checked.*product, unit and customer selling price/),
  ).not.toBeChecked();
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

async function openQuotation(page: Page, validUntil?: string) {
  await login(page, '9297513712');
  const headers = { Origin: 'http://localhost:3001' };
  const addressResponse = await page.request.post('http://localhost:4010/api/v1/me/addresses', {
    headers,
    data: {
      label: 'Quotation dialog test',
      name: 'Quotation reviewer',
      phone: '+919297513712',
      line1: 'Test plot 12',
      area: 'Kankarbagh',
      city: 'Patna',
      state: 'Bihar',
      pincode: '800020',
    },
  });
  expect(addressResponse.ok(), await addressResponse.text()).toBe(true);
  const address = await addressResponse.json();
  const quoteResponse = await page.request.post('http://localhost:4010/api/v1/quotes', {
    headers,
    data: {
      addressId: address.id,
      deliveryDate: new Date(Date.now() + 86400000).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Kolkata',
      }),
      items: [{ productId: 'test-ultratech', quantity: 10 }],
    },
  });
  expect(quoteResponse.ok(), await quoteResponse.text()).toBe(true);
  const quote = await quoteResponse.json();
  if (validUntil) {
    const offerResponse = await page.request.post(
      `http://localhost:4010/api/v1/admin/quotes/${quote.id}/offer`,
      {
        headers,
        data: {
          expectedRevision: quote.revision,
          deliveryConfirmed: true,
          deliveryDate: quote.deliveryDate,
          items: [{ productId: 'test-ultratech', unitPricePaise: 39000 }],
          deliveryFeePaise: 50000,
          validUntil,
          note: 'Existing offer with an agreed expiry',
        },
      },
    );
    expect(offerResponse.ok(), await offerResponse.text()).toBe(true);
  }
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'More', exact: true })
    .click();
  await page.getByRole('button', { name: /Bulk quotes$/ }).click();
  await page.getByRole('button', { name: 'Refresh data', exact: true }).click();
  await page.getByRole('button', { name: `Open quote ${quote.number}`, exact: true }).click();
  return quote;
}

test('Escape preserves quotation edits when discard is cancelled', async ({ page }) => {
  await openQuotation(page);
  const dialog = page.getByRole('dialog');
  const price = dialog.getByLabel(/UltraTech Super.*price per unit/);
  await price.fill('499');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(price).toHaveValue('499');

  page.once('dialog', (confirmation) => confirmation.accept());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('reopening and revising a quotation preserves its agreed expiry', async ({ page }) => {
  const validUntil = new Date(
    Math.floor((Date.now() + 36 * 3600000) / 60000) * 60000,
  ).toISOString();
  const quote = await openQuotation(page, validUntil);
  const expectedInput = await page.evaluate((value) => {
    const expiry = new Date(value);
    return new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }, validUntil);
  await expect(page.getByLabel('Valid until', { exact: true })).toHaveValue(expectedInput);
  await page.getByLabel('Note to customer').fill('Confirmed the delivery landmark');
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/admin/quotes/${quote.id}/offer`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send revised quote', exact: true }).click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBe(true);
  expect((await response.json()).validUntil).toBe(validUntil);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('browser Back preserves quotation edits when discard is cancelled', async ({ page }) => {
  await openQuotation(page);
  const price = page.getByRole('dialog').getByLabel(/UltraTech Super.*price per unit/);
  await price.fill('499');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(/#quotes$/);
  await expect(price).toHaveValue('499');

  page.once('dialog', (confirmation) => confirmation.accept());
  await page.goBack();
  await expect(page).not.toHaveURL(/#quotes$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
