import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { productSchema, type DeliveryZone } from '@shiv/shared';

test('catalogue keeps a product press intact across an unchanged search debounce', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('http://localhost:8082');
  await expect(page.getByRole('tab', { name: 'Products' })).toBeVisible();
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.getByRole('tab', { name: 'Products' }).click();
  const product = page.getByRole('button', { name: 'View UltraTech Super' });
  await expect(product).toBeVisible();
  await product.hover();
  await page.mouse.down();
  await page.clock.runFor(350);
  await page.mouse.up();
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toBeVisible();
});

async function mobileLogin(page: Page, phone: string) {
  await page.goto('http://localhost:8082');
  await page.getByRole('tab', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Mobile number (+91)' }).fill(phone);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code' }).click();
  const code = (await (await response).json()).devCode;
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code);
  await page.getByRole('button', { name: 'Verify & continue' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}
async function adminLogin(page: Page, phone = '9297513707') {
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'en'));
  await page.goto('http://localhost:3001');
  await page.getByRole('textbox', { name: 'Staff mobile number' }).fill(phone);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code' }).click();
  const code = (await (await response).json()).devCode;
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code);
  await page.getByRole('button', { name: 'Open store desk' }).click();
}
test('customer places a COD order, tracks it, reorders and requests a bulk quote', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const runtimeErrors: string[] = [];
  page.on('pageerror', (e) => runtimeErrors.push(e.message));
  await mobileLogin(page, '9888888881');
  await page.getByRole('button', { name: 'Saved addresses', exact: true }).click();
  for (const [name, value] of [
    ['Recipient name', 'Ravi Kumar'],
    ['Building, plot or street', 'Plot 24'],
    ['Area / locality', 'Kankarbagh'],
    ['Pincode', '800020'],
  ])
    await page.getByRole('textbox', { name, exact: true }).fill(value!);
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page.getByText('Address saved', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Products' }).click();
  await page.getByRole('button', { name: 'View UltraTech Super' }).click();
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('10');
  await page.getByRole('button', { name: /Add.*to cart/ }).click();
  await page.getByRole('button', { name: 'Your cart, 10 items, 1 product' }).click();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await page.getByRole('button', { name: 'Review your order' }).click();
  await expect(page.getByText('₹4,600.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText('Order received.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Order again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeVisible();
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Bulk quotation', exact: true }).click();
  await page.getByRole('button', { name: 'UltraTech Super', exact: true }).click();
  await page.getByRole('button', { name: 'Send bulk request' }).click();
  await expect(page.getByText('Requested', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.getByRole('tab', { name: 'होम' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: 'test-results/customer-mobile.png' });
});
test('admin changes price and finance policy, fulfils an order and replies to a quotation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await adminLogin(page);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('region', { name: "Today's work", exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^नया काम \/ New work/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-overview.png', fullPage: true });
  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('button', { name: 'Prices & stock', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Search products', exact: true }).fill('UltraTech Super');
  await page.getByRole('button', { name: 'Edit UltraTech Super' }).click();
  await page.getByLabel('Selling price (₹)').fill('425');
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByText('₹425.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /Finance & settings$/ }).click();
  await page.getByRole('button', { name: /Patna test/ }).click();
  await page.getByLabel('Delivery charge (₹)', { exact: true }).fill('600');
  await page.getByRole('button', { name: 'Save delivery zone' }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Store and finance settings saved')).toBeVisible();
  await page
    .getByRole('button', { name: /^Orders/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: /^Open SC-/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Mark preparing' }).click();
  await page.getByRole('button', { name: 'Mark out for delivery' }).click();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Record cash payment received' }).click();
  await page.getByRole('button', { name: 'Mark delivered' }).click();
  await expect(
    page.getByRole('dialog').getByText('Delivered', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /Bulk quotes$/ }).click();
  const openQuote = page.getByRole('button', { name: /^Open quote/ }).first();
  const quoteNumber = (await openQuote.getAttribute('aria-label'))!.replace('Open quote ', '');
  await openQuote.click();
  await page.getByLabel(/UltraTech Super.*price per unit/).fill('400');
  await page.getByRole('checkbox', { name: /I checked the site/ }).check();
  await page.getByRole('button', { name: 'Send quotation' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: quoteNumber }).getByText('Sent', { exact: true }),
  ).toBeVisible();
});
test('live price updates refresh the catalogue and invalidate an accepted checkout total', async ({
  page,
  request,
}) => {
  await mobileLogin(page, '9888888883');
  await page.getByRole('button', { name: 'Saved addresses', exact: true }).click();
  for (const [name, value] of [
    ['Recipient name', 'Price review customer'],
    ['Building, plot or street', 'Plot 25'],
    ['Area / locality', 'Patna'],
    ['Pincode', '800020'],
  ])
    await page.getByRole('textbox', { name, exact: true }).fill(value!);
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page.getByText('Address saved', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Products' }).click();
  const otp = await request.post('http://localhost:4010/api/v1/auth/otp/request', {
    data: { phone: '+919297513708' },
  });
  const login = await request.post('http://localhost:4010/api/v1/auth/otp/verify', {
    data: { phone: '+919297513708', code: (await otp.json()).devCode },
  });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  // This price-change journey owns its freight fixture; it does not depend on an earlier test.
  const zones = (await (
    await request.get('http://localhost:4010/api/v1/admin/delivery-zones', { headers })
  ).json()) as DeliveryZone[];
  const zone = zones.find((entry) => entry.id === 'test-zone')!;
  expect(zone).toBeDefined();
  const freight = await request.patch(
    `http://localhost:4010/api/v1/admin/delivery-zones/${zone.id}`,
    {
      headers,
      data: {
        name: zone.name,
        active: true,
        deliveryFeePaise: 60000,
        minimumOrderPaise: 0,
        freeDeliveryAbovePaise: null,
        estimate: zone.estimate,
        pincodes: zone.pincodes.map((entry) => entry.pincode),
        expectedVersion: zone.version,
      },
    },
  );
  expect(freight.ok(), await freight.text()).toBe(true);
  async function updatePrice(pricePaise: number) {
    const result = await request.get('http://localhost:4010/api/v1/products/test-ultratech');
    const product = await result.json();
    const batch = await (
      await request.post('http://localhost:4010/api/v1/admin/rate-studio/batches', {
        headers,
        data: {
          title: 'Live checkout rates',
          sourceType: 'MANUAL',
          idempotencyKey: crypto.randomUUID(),
        },
      })
    ).json();
    const saved = await (
      await request.patch(`http://localhost:4010/api/v1/admin/rate-studio/batches/${batch.id}`, {
        headers,
        data: {
          expectedVersion: batch.version,
          title: batch.title,
          items: [
            {
              productId: product.id,
              label: product.name,
              brand: product.brand,
              specification: '',
              unit: product.unit,
              weight: '',
              proposedPricePaise: pricePaise,
              expectedProductVersion: product.version,
              included: true,
              reviewed: true,
              acknowledged: true,
              note: 'Browser reviewed',
              rememberAlias: false,
              refreshBaseline: false,
            },
          ],
        },
      })
    ).json();
    const response = await request.post(
      `http://localhost:4010/api/v1/admin/rate-studio/batches/${batch.id}/publish`,
      {
        headers,
        data: { expectedVersion: saved.version, confirmation: 'PUBLISH' },
      },
    );
    expect(response.ok()).toBe(true);
  }
  await updatePrice(45000);
  await expect(page.getByText('₹450.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View UltraTech Super' }).click();
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('10');
  await page.getByRole('button', { name: /Add.*to cart/ }).click();
  await page.getByRole('button', { name: /^Your cart,.*1 product$/ }).click();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await page.getByRole('button', { name: 'Review your order' }).click();
  await page.getByRole('checkbox').check();
  await updatePrice(47500);
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByRole('alert')).toContainText('Review the updated total');
  await page.getByRole('button', { name: 'Review your order' }).click();
  await expect(page.getByText('₹5,350.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText('Order received.', { exact: true })).toBeVisible();
});

test('admin UI denies a customer account and a lost network produces a recoverable error', async ({
  page,
}) => {
  await adminLogin(page, '9888888882');
  await expect(
    page.getByRole('alert').filter({ hasText: 'does not have store staff access' }),
  ).toBeVisible();
  await page.goto('http://localhost:8082');
  await page.route('**/api/v1/products*', (route) => route.abort());
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Check your connection');
  await page.unroute('**/api/v1/products*');
  await page.getByRole('button', { name: 'Try again', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'View UltraTech Super' })).toBeVisible();
});

test('store records stock and delivery rules; customers browse server pages on mobile', async ({
  page,
}) => {
  await adminLogin(page, '9297513709');
  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('button', { name: 'Prices & stock', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Search products', exact: true }).fill('UltraTech Super');
  await page.getByRole('button', { name: 'Stock ledger UltraTech Super' }).click();
  await page.getByRole('combobox', { name: 'Movement', exact: true }).selectOption('WALK_IN_SALE');
  await page.getByLabel('Quantity', { exact: true }).fill('5');
  await page.getByLabel('Receipt / reference').fill('WALK-IN-5');
  await page.getByLabel('Reason', { exact: true }).fill('Counter collection');
  await page.getByRole('button', { name: 'Record stock movement' }).click();
  await expect(
    page.getByRole('dialog').getByRole('cell', { name: 'WALK-IN-5 Counter collection' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/pilot-stock-ledger.png' });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /Finance & settings$/ }).click();
  await page.getByRole('button', { name: 'Add delivery zone' }).click();
  await page.getByLabel('Zone name').fill('Outstation check');
  await page.getByLabel('Pincodes, separated by commas').fill('801111');
  await page.getByLabel('Delivery charge (₹)', { exact: true }).fill('900');
  await page.getByLabel('Delivery estimate', { exact: true }).fill('2–3 days after confirmation');
  await page.getByRole('button', { name: 'Save delivery zone' }).click();
  await expect(page.getByRole('button', { name: /Outstation check/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /Finance & settings$/ }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/pilot-admin-mobile.png' });
  const sample = await (
    await page.request.get('http://localhost:4010/api/v1/products/test-ultratech')
  ).json();
  const data = Object.fromEntries(
    Object.keys(productSchema.shape).map((key) => [key, sample[key]]),
  );
  for (let i = 0; i < 27; i++) {
    const r = await page.request.post('http://localhost:4010/api/v1/admin/products', {
      headers: { Origin: 'http://localhost:3001' },
      data: { ...data, name: `Pilot material ${String(i).padStart(2, '0')}`, stock: 20 },
    });
    expect(r.ok()).toBe(true);
  }
  await page.goto('http://localhost:8082');
  await page.getByRole('textbox', { name: 'Delivery pincode' }).fill('801111');
  await page.getByRole('button', { name: 'Check delivery', exact: true }).click();
  await expect(page.getByText('2–3 days after confirmation', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'Products', exact: true }).click();
  const pilotProducts = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith('/products') &&
      url.searchParams.get('q') === 'Pilot material' &&
      response.ok()
    );
  });
  await page
    .getByRole('textbox', { name: 'Search cement, steel, sand…', exact: true })
    .fill('Pilot material');
  await pilotProducts;
  await expect(page.getByRole('button', { name: 'View Pilot material 00' })).toBeVisible();
  await page.getByRole('button', { name: 'Filters and sort', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Filter by brand' })).toBeVisible();
  await page.getByRole('button', { name: 'Show materials', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Filter by brand' })).toBeHidden();
  const firstCount = await page.getByRole('button', { name: /^View / }).count();
  expect(firstCount).toBe(24);
  await page.getByRole('button', { name: 'Load more materials' }).click();
  await expect(
    page.getByRole('button', { name: 'View Pilot material 26', exact: true }),
  ).toBeVisible();
  expect(await page.getByRole('button', { name: /^View / }).count()).toBe(27);
  await page.getByRole('textbox', { name: 'Search cement, steel, sand…' }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/pilot-catalogue-mobile.png' });
});

test('public privacy and verified account deletion work without installing the app', async ({
  page,
}) => {
  await page.goto('http://localhost:3001/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy, in plain language.' })).toBeVisible();
  let hydrate!: () => void;
  const hydration = new Promise<void>((resolve) => {
    hydrate = resolve;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await hydration;
    await route.continue();
  });
  const navigation = page.getByRole('link', { name: 'Request account deletion' }).click();
  try {
    await expect(page.getByLabel('Mobile number', { exact: true })).toBeDisabled();
  } finally {
    hydrate();
  }
  await navigation;
  await page.getByLabel('Mobile number', { exact: true }).fill('9888888884');
  const otp = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code' }).click();
  const code = (await (await otp).json()).devCode;
  await page.getByLabel('Verification code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Verify account', exact: true }).click();
  await page.getByLabel('Deletion confirmation').fill('DELETE');
  await page.getByRole('button', { name: 'Delete my account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('account has been deleted');
});
