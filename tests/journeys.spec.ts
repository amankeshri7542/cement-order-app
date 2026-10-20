import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { productSchema, type DeliveryZone, type Order } from '@shiv/shared';
import { en } from '@shiv/i18n';
import { appLogin, fillAddress, openBasket, openMaterial, searchMaterials, tab } from './app';

test('catalogue keeps a product press intact across an unchanged search debounce', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('http://localhost:8082');
  await expect(page.getByRole('tab', { name: 'Materials' })).toBeVisible();
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.getByRole('tab', { name: 'Materials' }).click();
  const product = page.getByRole('button', { name: 'View UltraTech Super' });
  await expect(product).toBeVisible();
  await product.hover();
  await page.mouse.down();
  await page.clock.runFor(350);
  await page.mouse.up();
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toBeVisible();
});

async function mobileLogin(page: Page, phone: string) {
  await appLogin(page, phone);
}
async function adminLogin(page: Page, phone = '9297513707') {
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'en'));
  await page.goto('http://localhost:3001/today');
  await page.getByRole('textbox', { name: en['owner.loginPhone'] }).fill(phone);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: en['owner.sendCode'] }).click();
  const code = (await (await response).json()).devCode;
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code);
  // Navigating before the session exists cancels the verify request in WebKit. A customer number
  // is refused after this call, so wait for the response and not for the desk to open.
  const verified = page.waitForResponse((r) => r.url().endsWith('/auth/otp/verify'));
  await page.getByRole('button', { name: en['owner.signIn'] }).click();
  await verified;
}
test('customer places a COD order, tracks it, reorders and requests a bulk quote', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const runtimeErrors: string[] = [];
  page.on('pageerror', (e) => runtimeErrors.push(e.message));
  await mobileLogin(page, '9888888881');
  await page.getByRole('button', { name: 'Saved addresses', exact: true }).click();
  await fillAddress(page, {
    name: 'Ravi Kumar',
    line1: 'Plot 24',
    area: 'Kankarbagh',
    pincode: '800020',
  });
  await expect(page.getByText('Address saved', { exact: true })).toBeVisible();
  await openMaterial(page, 'UltraTech Super');
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('10');
  await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
  await openBasket(page);
  await expect(page.getByRole('tab', { name: 'Basket, 10' })).toBeVisible();
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await expect(page.getByText('₹4,600.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Place order · ₹4,600.00', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Order again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review order', exact: true })).toBeVisible();
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Bulk quote', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Find a material to add', exact: true })
    .fill('UltraTech Super');
  await page.getByRole('button', { name: 'Add to quote: UltraTech Super', exact: true }).click();
  await page.getByRole('button', { name: 'Send bulk request' }).click();
  await expect(page.getByText(/^Requested · awaiting shop$/)).toBeVisible();
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Switch language to Hindi' }).click();
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
  await expect(page.getByRole('region', { name: en['owner.nextWork'], exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: en['owner.newOrderAction'], exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-overview.png', fullPage: true });
  await page.goto('http://localhost:3001/more?view=products');
  await page.getByRole('textbox', { name: 'Search products', exact: true }).fill('UltraTech Super');
  await page.getByRole('button', { name: 'Edit UltraTech Super' }).click();
  await page.getByLabel('Selling price (₹)').fill('425');
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByText('₹425.00', { exact: true })).toBeVisible();
  await page.goto('http://localhost:3001/more?view=zones');
  const patna = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: /Patna test/ }) });
  await patna.getByRole('button', { name: en['owner.edit'], exact: true }).click();
  const zone = page.getByRole('dialog');
  await zone.getByLabel(en['owner.deliveryFee'], { exact: true }).fill('600');
  await zone.getByRole('button', { name: en['owner.save'], exact: true }).click();
  await expect(zone).toBeHidden();
  await page.goto('http://localhost:3001/more?view=store');
  const savedSettings = page.waitForResponse(
    (r) => r.url().endsWith('/admin/store') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: en['owner.save'], exact: true }).click();
  expect((await savedSettings).ok()).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: en['owner.saved'] })).toBeVisible();
  await page.goto('http://localhost:3001/orders');
  const searched = page.waitForResponse(
    (response) =>
      response.url().includes('/admin/orders?') && response.url().includes('q=9888888881'),
  );
  await page
    .getByRole('searchbox', { name: en['owner.searchOrders'], exact: true })
    .fill('9888888881');
  await searched;
  const orderLink = page
    .locator('a[href^="/orders/"]')
    .filter({ has: page.getByText(/SC-/) })
    .first();
  await expect(orderLink).toBeVisible();
  const orderPath = await orderLink.getAttribute('href');
  const orderId = orderPath!.split('/').at(-1)!;
  await orderLink.click();
  await page.getByRole('button', { name: en['owner.startPreparing'], exact: true }).click();
  await page.getByRole('button', { name: en['owner.dispatch'], exact: true }).click();
  await page.getByRole('button', { name: en['owner.deliver'], exact: true }).click();
  const receipt = page.getByRole('dialog');
  await receipt.getByLabel(en['owner.paymentMethod']).selectOption('CASH');
  await receipt.getByRole('button', { name: en['owner.receiptThenDeliver'], exact: true }).click();
  await expect(receipt).toBeHidden();
  await expect(page.getByText('Delivered', { exact: true }).first()).toBeVisible();
  const supplied = (await (
    await page.request.get(`http://localhost:4010/api/v1/admin/orders/${orderId}`)
  ).json()) as Order;
  expect(supplied).toMatchObject({ status: 'DELIVERED', payment: { status: 'CAPTURED' } });
  await page.goto('http://localhost:3001/more?view=quotes');
  const openQuote = page.getByRole('button', { name: /^Open quote/ }).first();
  const quoteNumber = (await openQuote.getAttribute('aria-label'))!.replace('Open quote ', '');
  await openQuote.click();
  await page.getByLabel(/UltraTech Super.*price per unit/).fill('400');
  await page.getByRole('checkbox', { name: /I checked the site/ }).check();
  await page.getByRole('button', { name: 'Send quotation', exact: true }).click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Send quotation', exact: true })
    .click();
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
  await fillAddress(page, {
    name: 'Price review customer',
    line1: 'Plot 25',
    area: 'Patna',
    pincode: '800020',
  });
  await expect(page.getByText('Address saved', { exact: true })).toBeVisible();
  await searchMaterials(page, 'UltraTech Super');
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
  await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
  await openBasket(page);
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Place order/ })).toBeEnabled();
  await updatePrice(47500);
  await page.getByRole('button', { name: /^Place order/ }).click();
  // The refused order is re-reviewed at once and shows exactly what changed.
  await expect(page.getByRole('alert')).toContainText('UltraTech Super: ₹450.00 → ₹475.00');
  await expect(page.getByText('₹5,350.00', { exact: true })).toBeVisible();
  // The new price must be accepted explicitly before the order can be placed.
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: /^Place order/ })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
});

test('admin UI denies a customer account and a lost network produces a recoverable error', async ({
  page,
}) => {
  await adminLogin(page, '9888888882');
  await expect(page.getByRole('alert').filter({ hasText: en['error.forbidden'] })).toBeVisible();
  await page.goto('http://localhost:8082');
  await page.route('**/api/v1/products*', (route) => route.abort());
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Check your connection');
  await page.unroute('**/api/v1/products*');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByRole('button', { name: /^Cement: / })).toBeVisible();
});

test('store records stock and delivery rules; customers browse server pages on mobile', async ({
  page,
}) => {
  await adminLogin(page, '9297513709');
  await page.goto('http://localhost:3001/more?view=products');
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
  await page.goto('http://localhost:3001/more?view=zones');
  await page.getByRole('button', { name: en['owner.addZone'], exact: true }).click();
  const area = page.getByRole('dialog');
  await area.getByLabel(en['owner.zoneName'], { exact: true }).fill('Outstation check');
  await area.getByLabel(en['owner.zonePincodes'], { exact: true }).fill('801111');
  await area.getByLabel(en['owner.deliveryFee'], { exact: true }).fill('900');
  await area
    .getByLabel(en['owner.zoneEstimate'], { exact: true })
    .fill('2–3 days after confirmation');
  await area.getByRole('button', { name: en['owner.save'], exact: true }).click();
  await expect(area).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Outstation check', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole('navigation', { name: en['owner.desk'], exact: true });
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: en['owner.more'], exact: true }).click();
  await page.getByRole('link', { name: en['owner.zones'], exact: true }).click();
  await expect(page).toHaveURL(/\/more\?view=zones$/);
  await expect(page.locator('.sidebar')).toHaveCount(0);
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
  // Six digits are a complete pincode: the check runs without another tap.
  await page.getByRole('textbox', { name: 'Delivery pincode' }).fill('801111');
  await expect(page.getByText('2–3 days after confirmation', { exact: false })).toBeVisible();
  await tab(page, 'Materials').click();
  // Wait for the initial list commit before WebKit pastes into its controlled header.
  await expect(page.getByText('24 materials · more below', { exact: true })).toBeVisible();
  const pilotProducts = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith('/products') &&
      url.searchParams.get('q') === 'Pilot material' &&
      response.ok()
    );
  });
  await page.getByRole('textbox', { name: 'Search materials', exact: true }).fill('Pilot material');
  await pilotProducts;
  await expect(page.getByRole('button', { name: 'View Pilot material 00' })).toBeVisible();
  await page.getByRole('button', { name: 'Filters and sort', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Brand', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show materials', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Brand', exact: true })).toBeHidden();
  // The list is virtualised: count what loaded, not what is drawn.
  await expect(page.getByText('24 materials · more below', { exact: true })).toBeVisible();
  // Reaching the end of the list loads the next page.
  await page
    .getByRole('button', { name: /^View / })
    .last()
    .scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 4000);
  await expect(
    page.getByRole('button', { name: 'View Pilot material 26', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('27 materials', { exact: true })).toBeAttached();
  await page.getByRole('textbox', { name: 'Search materials' }).scrollIntoViewIfNeeded();
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
