import type { Page } from '@playwright/test';
import { test, expect, deskLanguage } from './fixtures';
import { productSchema, type DeliveryZone, type Order } from '@shiv/shared';
import { en } from '@shiv/i18n';
import {
  addSite,
  addToList,
  appLogin,
  openList,
  placeButton,
  placeOrder,
  tab,
  waiting,
} from './app';

async function mobileLogin(page: Page, phone: string) {
  await appLogin(page, phone);
}
async function adminLogin(page: Page, phone = '9999997007') {
  await deskLanguage(page.context(), 'en');
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
// The desk journey below works on this customer's order and list.
test('customer places an order, tracks it, orders again and asks for a rate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const runtimeErrors: string[] = [];
  page.on('pageerror', (e) => runtimeErrors.push(e.message));
  await mobileLogin(page, '9888888881');
  await addSite(page, {
    name: 'Ravi Kumar',
    line1: 'Plot 24',
    area: 'Kankarbagh',
    pincode: '800020',
  });
  await addToList(page, 'UltraTech Super', 10);
  await openList(page);
  await placeOrder(page);
  await page.getByRole('button', { name: 'Order again', exact: true }).click();
  await expect(placeButton(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await addToList(page, 'UltraTech Super', 20);
  await openList(page);
  const asked = page.waitForResponse(
    (r) => r.url().endsWith('/quotes') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ask for a rate', exact: true }).click();
  expect((await asked).status()).toBe(201);
  await expect(page.getByRole('button', { name: /We got your list/ })).toBeVisible();
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
    page
      .getByRole('navigation', { name: en['owner.desk'], exact: true })
      .getByRole('link', { name: en['owner.newOrder'], exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-overview.png', fullPage: true });
  await page.goto('http://localhost:3001/stock?tab=maal');
  await page
    .getByRole('searchbox', { name: 'Find goods or brand', exact: true })
    .fill('UltraTech Super');
  await page.getByRole('button', { name: /^Change goods UltraTech Super/ }).click();
  await page.getByLabel('Selling rate (₹)').fill('425');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('₹425.00', { exact: true })).toBeVisible();
  await page.goto('http://localhost:3001/more?view=zones');
  const patna = page.getByRole('listitem').filter({ hasText: /Patna test/ });
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
  // A customer's order waits for a person, so it is confirmed first.
  await page
    .getByRole('main')
    .getByRole('link', { name: new RegExp(en['owner.pakka.confirm']) })
    .click();
  await page.getByRole('button', { name: en['owner.pakka.confirm'], exact: true }).click();
  await expect(page.getByRole('button', { name: /^Take back \d+$/ })).toBeVisible();
  await page.goto(`http://localhost:3001/orders/${orderId}`);
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
  await page.goto('http://localhost:3001/lists');
  await page.getByRole('button', { name: /QT-/ }).first().click();
  await page.getByLabel(/UltraTech Super.*rate for one/).fill('400');
  await page.getByRole('checkbox', { name: /I checked the site/ }).check();
  await page.getByRole('button', { name: en['owner.lists.send'], exact: true }).click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: en['owner.lists.send'], exact: true })
    .click();
  await expect(page.getByText(en['owner.lists.state.SENT'], { exact: true }).first()).toBeVisible();
});
test('live price updates refresh the catalogue and invalidate an accepted checkout total', async ({
  page,
  request,
}) => {
  await mobileLogin(page, '9888888883');
  await addSite(page, { name: 'Price review customer', line1: 'Plot 25', pincode: '800020' });
  await tab(page, 'Home').click();
  const otp = await request.post('http://localhost:4010/api/v1/auth/otp/request', {
    data: { phone: '+919999997008' },
  });
  const login = await request.post('http://localhost:4010/api/v1/auth/otp/verify', {
    data: { phone: '+919999997008', code: (await otp.json()).devCode },
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
  await expect(page.getByText('₹450', { exact: true }).first()).toBeVisible();
  await addToList(page, 'UltraTech Super', 10);
  await openList(page);
  await expect(placeButton(page)).toBeEnabled();
  await updatePrice(47500);
  await placeButton(page).click();
  // The refused order is reviewed again at once and shows exactly what changed; the new total on the
  // button is the customer's consent.
  await expect(placeButton(page)).toHaveText(/₹5,350/);
  await expect(page.getByText(/Rate changed, was ₹450/)).toBeVisible();
  await placeButton(page).click();
  await expect(waiting(page)).toBeVisible();
});

test('admin UI denies a customer account and a lost network produces a recoverable error', async ({
  page,
}) => {
  await adminLogin(page, '9888888882');
  await expect(page.getByRole('alert').filter({ hasText: en['error.forbidden'] })).toBeVisible();
  // A first open with no network: nothing is saved on the phone yet, so it says so and can retry.
  await page.route('**/api/v1/public/catalog', (route) => route.abort());
  await page.goto('http://localhost:8082');
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByText(/Check your connection/)).toBeVisible();
  await page.unroute('**/api/v1/public/catalog');
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(page.getByRole('button', { name: /^UltraTech Super, / })).toBeVisible();
});

test('store records stock and delivery rules; customers browse server pages on mobile', async ({
  page,
}) => {
  await adminLogin(page, '9999997009');
  await page.goto('http://localhost:3001/stock');
  const goods = page.getByRole('row').filter({ hasText: 'UltraTech Super' }).first();
  await goods.getByRole('button', { name: en['owner.stockReceived'], exact: true }).click();
  const received = page.getByRole('dialog');
  await received.getByLabel(en['owner.purchaseQuantity'], { exact: true }).fill('5');
  await received.getByLabel(en['owner.stockNote'], { exact: true }).fill('WALK-IN-5 Truck bill');
  await received.getByRole('button', { name: en['owner.save'], exact: true }).click();
  await expect(received).toBeHidden();
  await page.screenshot({ path: 'test-results/pilot-stock-ledger.png' });
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
  await expect(page.getByText('Outstation check', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole('navigation', { name: en['owner.desk'], exact: true });
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: new RegExp(`^${en['owner.shell.menu']}`) }).click();
  await page.getByRole('link', { name: en['owner.settings.title'], exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
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
  // As a guest: on this host the desk's session cookie would sign the app in too.
  await page.context().clearCookies();
  await page.goto('http://localhost:8082');
  // Six digits are a complete pincode: the check runs without another tap.
  await page.getByRole('button', { name: 'Check delivery', exact: true }).click();
  await page.getByRole('textbox', { name: 'Pincode', exact: true }).fill('801111');
  await expect(page.getByText(/We deliver here/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  // Every material is on the phone, so search finds beyond what fits on one screen.
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('Pilot material');
  await expect(page.getByRole('button', { name: /^Pilot material 00, / })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('Pilot material 26');
  await expect(page.getByRole('button', { name: /^Pilot material 26, / })).toBeVisible();
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
