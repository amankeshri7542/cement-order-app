import { type Page, type APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { productSchema } from '@shiv/shared';

const web = 'http://localhost:8082';
const api = 'http://localhost:4010/api/v1';

async function verifyLogin(page: Page, phone: string) {
  await page.getByRole('textbox', { name: 'Mobile number (+91)', exact: true }).fill(phone);
  const requested = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code', exact: true }).click();
  const code = (await (await requested).json()).devCode;
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code);
  await page.getByRole('button', { name: 'Verify & continue', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Verify & continue', exact: true })).toBeHidden();
}

async function login(page: Page, phone: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(web);
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await verifyLogin(page, phone);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
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

async function openProduct(page: Page) {
  await page.getByRole('tab', { name: 'Products', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search cement, steel, sand…', exact: true })
    .fill('UltraTech Super');
  await page.getByRole('button', { name: 'View UltraTech Super', exact: true }).click();
}

async function checkout(page: Page, quantity = '10') {
  await openProduct(page);
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill(quantity);
  await page.getByRole('button', { name: /Add.*to cart/ }).click();
  await page.getByRole('button', { name: /^Your cart,.*1 products?$/ }).click();
  await page.getByRole('button', { name: 'Continue to checkout', exact: true }).click();
}

async function review(page: Page) {
  await page.getByRole('button', { name: 'Review your order', exact: true }).click();
  await page.getByRole('checkbox').check();
}

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
  await checkout(page);
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
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByText('Order received.', { exact: true })).toBeVisible();
  await expect.poll(() => created?.number).toBeTruthy();
  await expect(page.getByText(created!.number, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order', exact: true })).toBeHidden();
  await expect(
    page.getByRole('alert').filter({ hasText: 'last confirmed order details' }),
  ).toBeVisible();
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
  await checkout(page);
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
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check order result', exact: true })).toBeEnabled();
  await expect(
    page.getByRole('alert').filter({ hasText: 'could not confirm the result' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check order result', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check order result', exact: true }).click();
  await expect(page.getByText('Order received.', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  await expect(page.getByText(created!.number, { exact: true })).toBeVisible();
  const list = await (await page.request.get(`${api}/orders`)).json();
  expect(list.items.map((order: { id: string }) => order.id)).toEqual([created!.id]);
  const after = await (await page.request.get(`${api}/products/test-ultratech`)).json();
  expect(after.stock).toBe(before.stock - 10);
});

test('checkout keeps its draft through address edit, creation, back, reload and failed catalog refresh', async ({
  page,
}) => {
  await login(page, '9887700103');
  await address(page, '9887700103');
  await checkout(page);
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await page
    .getByRole('textbox', { name: 'Delivery notes', exact: true })
    .fill('Keep draft: call before unloading.');
  await page
    .getByRole('textbox', { name: 'Preferred delivery date (YYYY-MM-DD)', exact: true })
    .fill(date);
  await page.getByRole('button', { name: 'Edit Site address', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Building, plot or street', exact: true })
    .fill('Plot 41, corrected');
  await expect(page.getByRole('textbox', { name: 'Recipient name', exact: true })).toHaveValue(
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
  await expect(
    page.getByRole('textbox', { name: 'Building, plot or street', exact: true }),
  ).toHaveValue('Plot 41, corrected');
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page).toHaveURL(/#\/checkout$/);
  await expect(page.getByRole('textbox', { name: 'Delivery notes', exact: true })).toHaveValue(
    'Keep draft: call before unloading.',
  );
  await expect(page.getByText(/Plot 41, corrected/)).toBeVisible();
  await page.getByRole('button', { name: '+ Add new', exact: true }).click();
  await page.getByRole('button', { name: '+ Add new', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Address label (Home / Site)', exact: true })
    .fill('Second site');
  await page
    .getByRole('textbox', { name: 'Recipient name', exact: true })
    .fill('Recovery customer');
  await page
    .getByRole('textbox', { name: 'Building, plot or street', exact: true })
    .fill('Plot 42');
  await page.getByRole('textbox', { name: 'Area / locality', exact: true }).fill('Kankarbagh');
  await page.getByRole('textbox', { name: 'Pincode', exact: true }).fill('800020');
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page).toHaveURL(/#\/checkout$/);
  await expect(page.getByRole('radio').filter({ hasText: 'Second site' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('button', { name: 'Edit Second site address', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/checkout$/);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Delivery notes', exact: true })).toHaveValue(
    'Keep draft: call before unloading.',
  );
  await expect(
    page.getByRole('textbox', { name: 'Preferred delivery date (YYYY-MM-DD)', exact: true }),
  ).toHaveValue(date);
  await page.route('**/api/v1/products*', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Check your connection' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Delivery notes', exact: true })).toHaveValue(
    'Keep draft: call before unloading.',
  );
  await expect(page.getByRole('radio').filter({ hasText: 'Second site' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.goto(`${web}/#/addresses/missing-address`);
  await expect(
    page.getByRole('alert').filter({ hasText: 'This saved address is not available' }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Building, plot or street', exact: true }),
  ).toBeHidden();
  await expect(page.getByRole('button', { name: 'Refresh addresses', exact: true })).toBeVisible();
});

test('guest add intent and quantity survive login and refresh; chosen language persists immediately', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(web);
  await openProduct(page);
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('20');
  await page.getByRole('button', { name: /Add.*to cart/ }).click();
  await verifyLogin(page, '9887700104');
  await expect(page.getByRole('button', { name: /^Your cart,.*1 products?$/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue('20');
  await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue('20');
  const cart = await (await page.request.get(`${api}/cart`)).json();
  expect(cart[0].quantity).toBe(20);
  const language = page.waitForResponse(
    (response) => response.url().endsWith('/me') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Switch language', exact: true }).click();
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
  await page.getByRole('button', { name: 'Bulk quotation', exact: true }).click();
  await verifyLogin(page, '9887700105');
  await expect(page).toHaveURL(/#\/quoterequest$/);
  await page.getByRole('textbox', { name: 'Find a material', exact: true }).fill('UltraTech Super');
  await page.getByRole('button', { name: 'UltraTech Super', exact: true }).click();
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('150');
  await page
    .getByRole('textbox', { name: 'Company (optional)', exact: true })
    .fill('Family project');
  await page.getByRole('button', { name: '+ Add address', exact: true }).click();
  await page.getByRole('textbox', { name: 'Recipient name', exact: true }).fill('Quote customer');
  await page
    .getByRole('textbox', { name: 'Building, plot or street', exact: true })
    .fill('Plot 43');
  await page.getByRole('textbox', { name: 'Area / locality', exact: true }).fill('Kankarbagh');
  await page.getByRole('textbox', { name: 'Pincode', exact: true }).fill('800020');
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page).toHaveURL(/#\/quoterequest$/);
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue('150');
  await expect(page.getByRole('textbox', { name: 'Company (optional)', exact: true })).toHaveValue(
    'Family project',
  );
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue('150');
  await expect(page.getByRole('textbox', { name: 'Company (optional)', exact: true })).toHaveValue(
    'Family project',
  );
  await page.getByRole('button', { name: 'Send bulk request', exact: true }).click();
  await expect(page.getByText('Requested', { exact: true })).toBeVisible();
  const quotes = await (await page.request.get(`${api}/quotes`)).json();
  expect(quotes.items).toHaveLength(1);
  expect(quotes.items[0].items[0].quantity).toBe(150);
});

test('slow checkout review keeps the reviewed payment method despite an attempted draft change', async ({
  page,
}) => {
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
  await checkout(page);
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
  await page.getByRole('button', { name: 'Review your order', exact: true }).click();
  await held;
  const online = page.getByRole('radio').filter({ hasText: 'UPI, cards & netbanking' });
  try {
    await online.click({ force: true });
  } finally {
    release();
  }
  await expect(page.getByRole('button', { name: 'Place order', exact: true })).toBeVisible();
  await expect(page.getByText('Razorpay online payment', { exact: true })).toBeHidden();
  await page.getByRole('checkbox').check();
  const created = page.waitForResponse(
    (response) => response.url().endsWith('/orders') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  const order = await (await created).json();
  expect(order.payment.method).toBe('COD');
  await expect(page.getByText('Order received.', { exact: true })).toBeVisible();
});

test('successful reorder shows the returned cart despite unavailable optional account reads', async ({
  page,
}) => {
  await login(page, '9887700107');
  await address(page, '9887700107');
  await checkout(page);
  await review(page);
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByText('Order received.', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue('10');
  expect((await (await page.request.get(`${api}/cart`)).json())[0].quantity).toBe(10);
});

test('lost reorder response survives reload and replays one persisted request without adding twice', async ({
  page,
}) => {
  await login(page, '9887700108');
  await address(page, '9887700108');
  await checkout(page);
  await review(page);
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByText('Order received.', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue('10');
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
    await page.getByRole('tab', { name: 'Products', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Search cement, steel, sand…', exact: true })
      .fill('Recovery material');
    await expect(page.getByRole('button', { name: /^View Recovery material/ })).toHaveCount(24);
    await page.getByRole('button', { name: 'Load more materials', exact: true }).click();
    await expect(page.getByRole('button', { name: /^View Recovery material/ })).toHaveCount(25);
    const refreshed = page.waitForResponse(
      (response) => response.url().includes('/products?') && response.url().includes('cursor='),
    );
    await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
    await refreshed;
    await expect(page.getByRole('button', { name: /^View Recovery material/ })).toHaveCount(25);
    await expect(
      page.getByRole('textbox', { name: 'Search cement, steel, sand…', exact: true }),
    ).toHaveValue('Recovery material');
    await page.route('**/api/v1/products*', (route) => route.abort('failed'));
    await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Check your connection' }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^View Recovery material/ })).toHaveCount(25);
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
