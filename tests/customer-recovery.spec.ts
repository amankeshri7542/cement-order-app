import { type Page, type APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { dayLabel, deliveryDateOptions, productSchema } from '@shiv/shared';
import {
  apiUrl as api,
  appLogin,
  appUrl as web,
  basketTab,
  fillAddress,
  openBasket,
  openMaterial,
  searchMaterials,
  verifyCode,
} from './app';

async function login(page: Page, phone: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await appLogin(page, phone);
}

async function address(page: Page, phone: string) {
  const result = await page.request.post(`${api}/me/addresses`, {
    headers: { Origin: web },
    data: {
      label: 'Site',
      name: 'Recovery customer',
      phone: `+91${phone}`,
      line1: 'Plot 40',
      area: 'Kankarbagh',
      city: 'Patna',
      state: 'Bihar',
      pincode: '800020',
      landmark: '',
    },
  });
  expect(result.ok(), await result.text()).toBe(true);
  await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
}

/** Puts `quantity` UltraTech Super in the basket from its product page and opens the basket. */
async function basket(page: Page, quantity = '10') {
  await openMaterial(page, 'UltraTech Super');
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill(quantity);
  await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
  await openBasket(page);
}

async function review(page: Page) {
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Place order/ })).toBeEnabled();
}

const confirmed = (page: Page) => page.getByRole('heading', { name: 'Confirmed', exact: true });

async function staffHeaders(request: APIRequestContext) {
  const otp = await request.post(`${api}/auth/otp/request`, { data: { phone: '+919297513709' } });
  expect(otp.ok()).toBe(true);
  const result = await request.post(`${api}/auth/otp/verify`, {
    data: { phone: '+919297513709', code: (await otp.json()).devCode },
  });
  expect(result.ok()).toBe(true);
  return { Authorization: `Bearer ${(await result.json()).accessToken}` };
}

test('created COD order remains confirmed when optional refresh and detail reads fail', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, '9887700101');
  await address(page, '9887700101');
  await basket(page);
  await review(page);
  let created: { id: string; number: string } | undefined;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === '/api/v1/orders') {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      created = await response.json();
      await route.fulfill({ response });
    } else if (
      created &&
      request.method() === 'GET' &&
      (path === '/api/v1/cart' ||
        path === '/api/v1/me/addresses' ||
        path === `/api/v1/orders/${created.id}`)
    ) {
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(confirmed(page)).toBeVisible();
  await expect.poll(() => created?.number).toBeTruthy();
  await expect(page.getByText(new RegExp(`^${created!.number} · placed`))).toBeVisible();
  await expect(page.getByRole('button', { name: /^Place order/ })).toBeHidden();
  await expect(page.getByRole('alert').filter({ hasText: 'last confirmed details' })).toBeVisible();
  const saved = await page.request.get(`${api}/orders/${created!.id}`);
  expect(saved.ok()).toBe(true);
  expect((await saved.json()).status).toBe('CONFIRMED');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/recovery-confirmed-offline.png', fullPage: true });
});

test('lost creation response survives reload and retries the original request exactly once', async ({
  page,
}) => {
  await login(page, '9887700102');
  await address(page, '9887700102');
  await basket(page);
  await review(page);
  const before = await (await page.request.get(`${api}/products/test-ultratech`)).json();
  const bodies: unknown[] = [];
  let created: { id: string; number: string } | undefined;
  await page.route('**/api/v1/orders', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    created = await response.json();
    if (bodies.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(page.getByRole('button', { name: 'Check order result', exact: true })).toBeEnabled();
  await expect(
    page.getByRole('alert').filter({ hasText: 'could not confirm the result' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check order result', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check order result', exact: true }).click();
  await expect(confirmed(page)).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  await expect(page.getByText(new RegExp(`^${created!.number} · placed`))).toBeVisible();
  const list = await (await page.request.get(`${api}/orders`)).json();
  expect(list.items.map((order: { id: string }) => order.id)).toEqual([created!.id]);
  const after = await (await page.request.get(`${api}/products/test-ultratech`)).json();
  expect(after.stock).toBe(before.stock - 10);
});

test('basket delivery draft survives address edit, creation, back, reload and failed catalog refresh', async ({
  page,
}) => {
  await login(page, '9887700103');
  await address(page, '9887700103');
  await basket(page);
  const date = deliveryDateOptions(new Date(), 0, 14)[3]!;
  await page.getByRole('button', { name: 'Add a delivery note', exact: true }).click();
  const note = page.getByRole('textbox', { name: 'Delivery note (optional)', exact: true });
  await note.fill('Keep draft: call before unloading.');
  const chip = page.getByRole('radio', { name: dayLabel(date, 'en'), exact: true });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Site', exact: true }).click();
  const line1 = page.getByRole('textbox', { name: 'House, plot or street', exact: true });
  await line1.fill('Plot 41, corrected');
  await expect(page.getByRole('textbox', { name: 'Person receiving', exact: true })).toHaveValue(
    'Recovery customer',
  );
  await expect(page.getByRole('textbox', { name: 'Area / locality', exact: true })).toHaveValue(
    'Kankarbagh',
  );
  await expect(page.getByRole('textbox', { name: 'Pincode', exact: true })).toHaveValue('800020');
  const addressRefresh = page.waitForResponse(
    (response) => response.url().endsWith('/me/addresses') && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
  await addressRefresh;
  await expect(line1).toHaveValue('Plot 41, corrected');
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page).toHaveURL(/#\/cart$/);
  await expect(note).toHaveValue('Keep draft: call before unloading.');
  await expect(page.getByText(/Plot 41, corrected/)).toBeVisible();
  await page.getByRole('button', { name: 'Add another address', exact: true }).click();
  await fillAddress(page, {
    label: 'Second site',
    name: 'Recovery customer',
    line1: 'Plot 42',
    area: 'Kankarbagh',
    pincode: '800020',
  });
  await expect(page).toHaveURL(/#\/cart$/);
  await expect(page.getByRole('radio').filter({ hasText: 'Second site' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('button', { name: 'Edit Second site', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/cart$/);
  await page.reload();
  await expect(note).toHaveValue('Keep draft: call before unloading.');
  await expect(chip).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/Second site/)).toBeVisible();
  await page.route('**/api/v1/products*', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Check your connection' })).toBeVisible();
  await expect(note).toHaveValue('Keep draft: call before unloading.');
  await expect(page.getByText(/Second site/)).toBeVisible();
  await page.goto(`${web}/#/addresses/missing-address`);
  await expect(
    page.getByRole('alert').filter({ hasText: 'This saved address is not available' }),
  ).toBeVisible();
  await expect(line1).toBeHidden();
  await expect(page.getByRole('button', { name: 'Refresh addresses', exact: true })).toBeVisible();
});

test('a guest basket survives sign-in and refresh; the chosen language persists immediately', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(web);
  await openMaterial(page, 'UltraTech Super');
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('20');
  await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
  await openBasket(page);
  await page.getByRole('button', { name: 'Sign in to order', exact: true }).click();
  await verifyCode(page, '9887700104');
  // Signed in without an address: checkout asks for one; the basket came along.
  await expect(page.getByText('Add your site address to continue.', { exact: true })).toBeVisible();
  await expect(basketTab(page)).toHaveAccessibleName('Basket, 20');
  await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
  await expect(basketTab(page)).toHaveAccessibleName('Basket, 20');
  const cart = await (await page.request.get(`${api}/cart`)).json();
  expect(cart[0].quantity).toBe(20);
  const language = page.waitForResponse(
    (response) => response.url().endsWith('/me') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Switch language to Hindi', exact: true }).click();
  expect((await language).ok()).toBe(true);
  await expect(page.getByRole('tab', { name: 'होम', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'होम', exact: true })).toBeVisible();
  expect((await (await page.request.get(`${api}/auth/session`)).json()).user.language).toBe('hi');
});

test('guest quotation intent resumes and saved quote fields survive address navigation', async ({
  page,
}) => {
  await page.goto(web);
  await page.getByRole('button', { name: 'Bulk quote', exact: true }).click();
  await verifyCode(page, '9887700105');
  await expect(page).toHaveURL(/#\/quoterequest$/);
  await page
    .getByRole('textbox', { name: 'Find a material to add', exact: true })
    .fill('UltraTech Super');
  await page.getByRole('button', { name: 'Add to quote: UltraTech Super', exact: true }).click();
  const quantity = page.getByRole('textbox', { name: 'Quantity', exact: true });
  await quantity.fill('150');
  await page.getByRole('button', { name: 'Add company, GSTIN or notes', exact: true }).click();
  const company = page.getByRole('textbox', { name: 'Company (optional)', exact: true });
  await company.fill('Family project');
  await page.getByRole('button', { name: 'Add address', exact: true }).click();
  await fillAddress(page, {
    name: 'Quote customer',
    line1: 'Plot 43',
    area: 'Kankarbagh',
    pincode: '800020',
  });
  await expect(page).toHaveURL(/#\/quoterequest$/);
  await expect(quantity).toHaveValue('150');
  await expect(company).toHaveValue('Family project');
  await page.reload();
  await expect(quantity).toHaveValue('150');
  await expect(company).toHaveValue('Family project');
  await page.getByRole('button', { name: 'Send bulk request', exact: true }).click();
  await expect(page.getByText(/^Requested · awaiting shop$/)).toBeVisible();
  const quotes = await (await page.request.get(`${api}/quotes`)).json();
  expect(quotes.items).toHaveLength(1);
  expect(quotes.items[0].items[0].quantity).toBe(150);
});

test('the review shows and places the payment method chosen in the basket', async ({ page }) => {
  // UI capability fixture only: review, order and database use the real COD API; no payment provider is called.
  await page.route('**/api/v1/store', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), onlinePaymentsAvailable: true },
    });
  });
  await login(page, '9887700106');
  await address(page, '9887700106');
  await basket(page);
  // Payment is chosen in the basket before review, so a review in flight cannot be changed.
  await expect(page.getByRole('radio', { name: /^Pay online/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Cash on delivery/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const held = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route('**/api/v1/checkout/review', async (route) => {
    expect(route.request().postDataJSON().paymentMethod).toBe('COD');
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    received();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await held;
  await expect(page.getByRole('radio', { name: /^Pay online/ })).toBeHidden();
  release();
  await expect(page.getByRole('button', { name: /^Place order/ })).toBeVisible();
  await expect(page.getByText(/Cash on delivery \(cash or UPI\)/)).toBeVisible();
  const created = page.waitForResponse(
    (response) => response.url().endsWith('/orders') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /^Place order/ }).click();
  const order = await (await created).json();
  expect(order.payment.method).toBe('COD');
  await expect(confirmed(page)).toBeVisible();
});

test('successful reorder shows the returned basket despite unavailable optional account reads', async ({
  page,
}) => {
  await login(page, '9887700107');
  await address(page, '9887700107');
  await basket(page);
  await review(page);
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(confirmed(page)).toBeVisible();
  let reordered = false;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/reorder')) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      reordered = true;
      await route.fulfill({ response });
    } else if (
      reordered &&
      request.method() === 'GET' &&
      ['/api/v1/cart', '/api/v1/me/addresses'].includes(path)
    ) {
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Order again', exact: true }).click();
  await expect(page).toHaveURL(/#\/cart$/);
  await expect(
    page.getByRole('textbox', { name: 'UltraTech Super quantity', exact: true }),
  ).toHaveValue('10');
  expect((await (await page.request.get(`${api}/cart`)).json())[0].quantity).toBe(10);
});

test('lost reorder response survives reload and replays one persisted request without adding twice', async ({
  page,
}) => {
  await login(page, '9887700108');
  await address(page, '9887700108');
  await basket(page);
  await review(page);
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(confirmed(page)).toBeVisible();
  const requests: { idempotencyKey?: string }[] = [];
  await page.route('**/api/v1/orders/*/reorder', async (route) => {
    requests.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (requests.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Order again', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Check reorder result', exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: 'Check reorder result', exact: true }).click();
  await expect(page).toHaveURL(/#\/cart$/);
  await expect(
    page.getByRole('textbox', { name: 'UltraTech Super quantity', exact: true }),
  ).toHaveValue('10');
  expect(requests).toHaveLength(2);
  expect(requests[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(requests[1]).toEqual(requests[0]);
  expect((await (await page.request.get(`${api}/cart`)).json())[0].quantity).toBe(10);
});

test('catalog refresh retains loaded pages and search selection', async ({ page, request }) => {
  const headers = await staffHeaders(request);
  const product = await (await request.get(`${api}/products/test-ultratech`)).json();
  const data = Object.fromEntries(
    Object.keys(productSchema.shape).map((key) => [key, product[key]]),
  );
  const createdProducts: { id: string; name: string; version: number }[] = [];
  try {
    for (let i = 0; i < 25; i++) {
      const result = await request.post(`${api}/admin/products`, {
        headers,
        data: { ...data, name: `Recovery material ${String(i).padStart(2, '0')}`, stock: 20 },
      });
      expect(result.ok(), await result.text()).toBe(true);
      createdProducts.push(await result.json());
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(web);
    await searchMaterials(page, 'Recovery material');
    const rows = page.getByRole('button', { name: /^View Recovery material/ });
    await expect(rows).toHaveCount(24);
    // Reaching the end of the list loads the next page.
    await rows.last().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 4000);
    await expect(rows).toHaveCount(25);
    const refreshed = page.waitForResponse(
      (response) => response.url().includes('/products?') && response.url().includes('cursor='),
    );
    await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
    await refreshed;
    await expect(rows).toHaveCount(25);
    await expect(page.getByRole('textbox', { name: 'Search materials', exact: true })).toHaveValue(
      'Recovery material',
    );
    await page.route('**/api/v1/products*', (route) => route.abort('failed'));
    await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Check your connection' }).first(),
    ).toBeVisible();
    await expect(rows).toHaveCount(25);
    await page.screenshot({ path: 'test-results/recovery-catalogue-pages.png', fullPage: true });
  } finally {
    for (const created of createdProducts) {
      const response = await request.patch(`${api}/admin/products/${created.id}`, {
        headers,
        data: {
          ...data,
          name: created.name,
          stock: 20,
          active: false,
          expectedVersion: created.version,
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
    }
  }
});
