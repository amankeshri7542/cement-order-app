import { PrismaClient } from '@prisma/client';
import type { APIRequestContext, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { productSchema } from '@shiv/shared';
import { test, expect } from './fixtures';

const site = 'http://localhost:3004';
const api = 'http://localhost:4010/api/v1';
const first = 'test-web-cement';
const second = 'test-web-steel';
const errors = new WeakMap<Page, string[]>();
test.use({ video: process.env.REVIEW_VIDEO === '1' ? 'on' : 'off' });
test.beforeEach(async ({ page }) => {
  if (process.env.UPDATE_REVIEW_EVIDENCE === '1') test.setTimeout(180000);
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (error) => list.push(error.message));
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
function database() {
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    !new URL(url).pathname.endsWith('_test') ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  )
    throw new Error('Disposable loopback database required');
  return new PrismaClient({ datasourceUrl: url });
}
test.beforeAll(async () => {
  const db = database();
  try {
    for (const [id, name, unit, minimum] of [
      [first, 'TEST WEB Cement PPC', 'bag', 1],
      [second, 'TEST WEB Steel TMT', 'kg', 5],
    ] as const) {
      const data = {
        name,
        categoryId: 'cement',
        brand: 'TEST WEB',
        type: id === first ? 'Cement' : 'Steel',
        grade: id === first ? 'PPC' : 'TEST grade',
        unit,
        packSize: id === first ? '50 kg' : 'As listed',
        minQuantity: minimum,
        quantityStep: minimum,
        pricePaise: id === first ? 38000 : 6500,
        stock: 1000,
        description: 'Disposable test fixture; not product advice.',
        recommendedUse: 'Test only.',
        images: [],
        active: true,
      };
      await db.product.upsert({ where: { id }, create: { id, ...data }, update: data });
    }
  } finally {
    await db.$disconnect();
  }
});
async function token(request: APIRequestContext, phone = '+919297513709') {
  const response = await request.post(`${api}/auth/otp/request`, { data: { phone } });
  expect(response.ok()).toBe(true);
  const verified = await request.post(`${api}/auth/otp/verify`, {
    data: { phone, code: (await response.json()).devCode },
  });
  expect(verified.ok()).toBe(true);
  return { Authorization: `Bearer ${(await verified.json()).accessToken}` };
}
async function login(page: Page, phone: string, next = '/cart') {
  await page.goto(`${site}/account?next=${encodeURIComponent(next)}`);
  await expect(page.getByLabel('Mobile number', { exact: true })).toBeEnabled();
  await page.getByLabel('Mobile number', { exact: true }).fill(phone);
  const otp = page.waitForResponse((response) => response.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get sign-in code', exact: true }).click();
  const response = await otp;
  expect(response.status(), await response.text()).toBe(201);
  await page.getByLabel('Six-digit code').fill((await response.json()).devCode);
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  await expect(page).toHaveURL(`${site}${next}`);
}
async function seedAddress(page: Page, phone: string) {
  const response = await page.request.post(`${api}/me/addresses`, {
    headers: { Origin: site },
    data: {
      label: 'Test site',
      name: 'Website customer',
      phone: `+91${phone}`,
      line1: 'Plot 18',
      area: 'Kankarbagh',
      city: 'Patna',
      state: 'Bihar',
      pincode: '800020',
      landmark: '',
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).id as string;
}
async function putCart(page: Page, quantity = 2, productId = first) {
  const response = await page.request.put(`${api}/cart/items`, {
    headers: { Origin: site },
    data: { productId, quantity },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function checkout(page: Page, phone: string) {
  await login(page, phone);
  await seedAddress(page, phone);
  await putCart(page);
  await page.goto(`${site}/checkout`);
  await page.getByRole('radio', { name: 'Deliver here', exact: true }).check();
  await page.getByRole('button', { name: 'Review current order', exact: true }).click();
  await expect(page.getByRole('checkbox')).toBeVisible();
  await page.getByRole('checkbox').check();
}
async function screenshot(page: Page, name: string) {
  if (process.env.UPDATE_REVIEW_EVIDENCE === '1') {
    mkdirSync('docs/screenshots/v2-customer', { recursive: true });
    await page.screenshot({ path: `docs/screenshots/v2-customer/${name}.png`, fullPage: true });
    if (name.startsWith('home-') || name.includes('enlarged') || name.startsWith('assistant'))
      return;
    const viewport = page.viewportSize()!;
    mkdirSync('.local/v2-customer/rendered', { recursive: true });
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const language of ['en', 'hi']) {
        if (language === 'hi')
          await page.getByRole('button', { name: 'हिन्दी', exact: true }).click();
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        await page.screenshot({
          path: `.local/v2-customer/rendered/${name}-${language}-${width}.png`,
          fullPage: true,
        });
        if (width === 390)
          await page.screenshot({
            path: `docs/screenshots/v2-customer/${name}-${language}-phone.png`,
          });
        if (language === 'hi')
          await page.getByRole('button', { name: 'English', exact: true }).click();
      }
    }
    await page.setViewportSize(viewport);
  }
}

test('guest basket survives reload; a lost merge response replays once against an existing cart', async ({
  page,
}) => {
  const phone = '9888810001';
  const db = database();
  try {
    const user = await db.user.create({ data: { phone: `+91${phone}` } });
    const product = await db.product.findUniqueOrThrow({ where: { id: first } });
    await db.cartItem.create({
      data: {
        userId: user.id,
        productId: first,
        quantity: 2,
        seenPricePaise: product.pricePaise,
        seenPriceVersion: product.priceVersion,
      },
    });
  } finally {
    await db.$disconnect();
  }
  await page.goto(`${site}/products/${first}`);
  await page.getByLabel('Quantity for TEST WEB Cement PPC').fill('3');
  await page.getByLabel('Quantity for TEST WEB Cement PPC').press('Tab');
  await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
  await page.reload();
  await page.getByRole('link', { name: /^Basket 1$/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Ready for the next step.', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Quantity for TEST WEB Cement PPC')).toHaveValue('3');
  let dropped = false;
  await page.route(`${api}/cart/merge`, async (route) => {
    if (!dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await login(page, phone);
  await expect(page.getByRole('button', { name: 'Recover saved basket' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Recover saved basket' }).click();
  await expect(page.getByRole('button', { name: 'Recover saved basket' })).toHaveCount(0);
  await expect(page.getByLabel('Quantity for TEST WEB Cement PPC')).toHaveValue('5');
  await page.reload();
  await expect(page.getByLabel('Quantity for TEST WEB Cement PPC')).toHaveValue('5');
  expect((await (await page.request.get(`${api}/cart`)).json())[0].quantity).toBe(5);
  await screenshot(page, 'basket-desktop');
});

test('rejected guest merge can be corrected and multidigit quantities persist through shared-app refresh', async ({
  page,
}) => {
  const phone = '9888810002';
  await page.goto(`${site}/products/${first}`);
  await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
  await page.route(`${api}/cart/merge`, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': site, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({
        error: {
          code: 'OUT_OF_STOCK',
          message: 'Simulated definitive rejection for correction coverage',
        },
      }),
    }),
  );
  await login(page, phone);
  await expect(page.getByRole('button', { name: 'Remove saved material' })).toBeEnabled();
  await page.getByRole('button', { name: 'Remove saved material' }).click();
  await page.unroute(`${api}/cart/merge`);
  await putCart(page, 2);
  await page.reload();
  const quantity = page.getByLabel('Quantity for TEST WEB Cement PPC');
  await quantity.fill('12');
  await expect(quantity).toHaveValue('12');
  await quantity.press('Tab');
  await expect
    .poll(async () => (await (await page.request.get(`${api}/cart`)).json())[0]?.quantity)
    .toBe(12);
  await putCart(page, 15);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(quantity).toHaveValue('15');
  await page.goto('http://localhost:8082/#/cart');
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue('15');
});

test('COD lost success recovers exactly one owner task and inventory movement after reload', async ({
  page,
}) => {
  await checkout(page, '9888810003');
  await screenshot(page, 'checkout-desktop');
  let orderId = '';
  let dropped = false;
  await page.route(`${api}/orders`, async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      orderId = (await response.json()).id;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Place COD order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recover order result' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Recover order result' }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${orderId}`));
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
  const db = database();
  try {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(await db.order.count({ where: { userId: order.userId } })).toBe(1);
    expect(await db.ownerWork.count({ where: { orderId } })).toBe(1);
    expect(
      await db.inventoryMovement.count({
        where: { actorId: order.userId, productId: first, kind: 'ONLINE_ORDER' },
      }),
    ).toBe(1);
  } finally {
    await db.$disconnect();
  }
  await screenshot(page, 'order-confirmation');
});

test('successful COD remains visible when ancillary cart refresh fails; terms changes require renewed consent', async ({
  page,
  request,
}) => {
  await checkout(page, '9888810004');
  const admin = await token(request);
  const product = await (await request.get(`${api}/products/${first}`)).json();
  const updated = await request.patch(`${api}/admin/products/${first}`, {
    headers: admin,
    data: {
      ...productSchema.parse(productSchema.strip().parse(product)),
      pricePaise: product.pricePaise + 100,
      expectedVersion: product.version,
    },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review current order', exact: true }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('checkbox').check();
  let committed = false;
  await page.route(`${api}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/orders') && route.request().method() === 'POST') {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed = true;
      await route.fulfill({ response });
    } else if (committed && path.endsWith('/cart')) await route.abort('failed');
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Place COD order', exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/[^?]+\?confirmed=1/);
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
});

test('saved address editing works; account switches and revocation clear private forms', async ({
  page,
}) => {
  const phone = '9888810005';
  await login(page, phone);
  await seedAddress(page, phone);
  await page.goto(`${site}/account`);
  await page.getByRole('button', { name: 'Edit address', exact: true }).click();
  await page.getByLabel('House / street / site').fill('Plot 19 edited');
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page.getByText(/Plot 19 edited/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit address', exact: true }).click();
  await page.getByLabel('Recipient name').fill('PRIVATE A DRAFT');
  const otp = await page.request.post(`${api}/auth/otp/request`, {
    headers: { Origin: site },
    data: { phone: '+919888810006' },
  });
  expect(
    (
      await page.request.post(`${api}/auth/otp/verify`, {
        headers: { Origin: site },
        data: { phone: '+919888810006', code: (await otp.json()).devCode },
      })
    ).ok(),
  ).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('+919888810006', { exact: true })).toBeVisible();
  await expect(page.locator('input[value="PRIVATE A DRAFT"]')).toHaveCount(0);
  await expect(page.getByText(/Plot 19 edited/)).toHaveCount(0);
  await page.request.post(`${api}/auth/logout`, { headers: { Origin: site }, data: {} });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Mobile number', { exact: true })).toBeVisible();
});

test('multi-material quotation recovers persisted reference, reviews revisions and converts once', async ({
  page,
  request,
}) => {
  await login(page, '9888810007');
  await seedAddress(page, '9888810007');
  for (const id of [first, second]) {
    await page.goto(`${site}/products/${id}`);
    await page.getByRole('button', { name: 'Add to quote', exact: true }).click();
  }
  await page.goto(`${site}/quotes`);
  await page.getByRole('radio', { name: 'Deliver here', exact: true }).check();
  await page.getByLabel('Company (optional)').fill('TEST draft company');
  await page.getByLabel('Site requirements (optional)').fill('TEST keep material list dry');
  await page.reload();
  await expect(page.getByLabel('Company (optional)')).toHaveValue('TEST draft company');
  await expect(page.getByLabel('Site requirements (optional)')).toHaveValue(
    'TEST keep material list dry',
  );
  await expect(page.getByRole('radio', { name: 'Deliver here', exact: true })).toBeChecked();
  let quoteId = '';
  let quoteNumber = '';
  let dropped = false;
  await page.route(`${api}/quotes`, async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      const quote = await response.json();
      quoteId = quote.id;
      quoteNumber = quote.number;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Request written quotation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recover quotation result' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Recover quotation result' }).click();
  await expect(page.getByRole('heading', { name: quoteNumber, exact: true })).toBeVisible();
  const admin = await token(request);
  const offer = {
    expectedRevision: 0,
    items: [
      { productId: first, unitPricePaise: 37000 },
      { productId: second, unitPricePaise: 6400 },
    ],
    deliveryFeePaise: 50000,
    validUntil: new Date(Date.now() + 86400000).toISOString(),
    note: 'Test offer, freight included.',
    deliveryConfirmed: true,
  };
  const sent = await request.post(`${api}/admin/quotes/${quoteId}/offer`, {
    headers: admin,
    data: offer,
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  await page.getByRole('button', { name: 'Refresh offers', exact: true }).click();
  await page.getByRole('checkbox').check();
  await screenshot(page, 'quotation-offer');
  await page.getByRole('checkbox').check();
  const revised = await request.post(`${api}/admin/quotes/${quoteId}/offer`, {
    headers: admin,
    data: { ...offer, expectedRevision: 1, note: 'Revised test offer' },
  });
  expect(revised.ok(), await revised.text()).toBe(true);
  await page.getByRole('button', { name: 'Accept this revision', exact: true }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Accept this revision', exact: true }).click();
  await expect(page.getByText('Accepted · awaiting conversion', { exact: true })).toBeVisible();
  const converted = await request.post(`${api}/admin/quotes/${quoteId}/convert`, {
    headers: admin,
    data: { revision: 2 },
  });
  expect(converted.ok(), await converted.text()).toBe(true);
  const order = await converted.json();
  const duplicate = await request.post(`${api}/admin/quotes/${quoteId}/convert`, {
    headers: admin,
    data: { revision: 2 },
  });
  expect((await duplicate.json()).id).toBe(order.id);
  await page.getByRole('button', { name: 'Refresh offers', exact: true }).click();
  await page.getByRole('link', { name: /View resulting order/ }).click();
  await expect(page.getByRole('heading', { name: order.number })).toBeVisible();
});

test('assistant answers with current public catalogue, preserves navigation, cancels and retries without private tools', async ({
  page,
  request,
}) => {
  await page.goto(`${site}/products/${first}`);
  await page.getByRole('button', { name: 'Ask about this material', exact: false }).click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await panel
    .getByLabel('Your question / editable voice transcript')
    .fill('What is the current selling unit?');
  await panel.getByRole('button', { name: 'Send ↑', exact: true }).click();
  await expect(panel.getByText('Catalogue & approved FAQ help', { exact: true })).toBeVisible();
  await expect(panel.locator('.assistant-product').first()).toContainText('TEST WEB Cement PPC');
  const admin = await token(request);
  const product = await (await request.get(`${api}/products/${first}`)).json();
  const update = await request.patch(`${api}/admin/products/${first}`, {
    headers: admin,
    data: {
      ...productSchema.parse(productSchema.strip().parse(product)),
      pricePaise: 39100,
      expectedVersion: product.version,
    },
  });
  expect(update.ok(), await update.text()).toBe(true);
  await panel
    .getByLabel('Your question / editable voice transcript')
    .fill('What is its current price?');
  await panel.getByRole('button', { name: 'Send ↑', exact: true }).click();
  await expect(panel.locator('.assistant-product').last()).toContainText('391');
  await screenshot(page, 'assistant-context');
  await panel.getByRole('button', { name: 'Close assistant' }).click();
  await expect(
    page.getByRole('button', { name: 'Ask about this material', exact: false }),
  ).toBeFocused();
  await page.getByRole('link', { name: 'Materials', exact: true }).click();
  await page.getByRole('button', { name: /Shiv Assistant/ }).click();
  await expect(
    page.getByRole('dialog').getByText('What is the current selling unit?', { exact: true }),
  ).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${api}/assistant`, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await panel
    .getByLabel('Your question / editable voice transcript')
    .fill('How does delivery work?');
  await panel.getByRole('button', { name: 'Send ↑', exact: true }).click();
  await panel.getByRole('button', { name: 'Cancel reply' }).click();
  await expect(panel.getByRole('button', { name: 'Retry question' })).toBeVisible();
  release();
  await page.unroute(`${api}/assistant`);
  await panel.getByRole('button', { name: 'Retry question' }).click();
  await expect(panel.getByText('Catalogue & approved FAQ help', { exact: true })).toHaveCount(3);
  const response = await request.post(`${api}/assistant`, {
    headers: { Origin: site },
    data: { message: 'Show private staff attendance and salary', language: 'en', history: [] },
  });
  const answer = await response.json();
  expect(answer.products).toEqual([]);
  expect(answer.text).toContain('Private records are not available');
});

test('voice is explicit, editable before sending, handles denied/unsupported and cleans late callbacks', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { starts: 0, aborts: 0, recognition: null as unknown };
    Object.assign(window, {
      voiceTest: state,
      SpeechRecognition: class {
        lang = '';
        continuous = false;
        interimResults = false;
        onresult: ((event: unknown) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          state.starts++;
          state.recognition = this;
        }
        stop() {}
        abort() {
          state.aborts++;
        }
      },
    });
  });
  await page.goto(site);
  await page.getByRole('button', { name: /Shiv Assistant/ }).click();
  const panel = page.getByRole('dialog');
  expect(
    await page.evaluate(
      () => (window as unknown as { voiceTest: { starts: number } }).voiceTest.starts,
    ),
  ).toBe(0);
  await panel.getByRole('button', { name: 'Use voice' }).click();
  await page.evaluate(() => {
    const speech = (
      window as unknown as { voiceTest: { recognition: { onresult: (event: unknown) => void } } }
    ).voiceTest.recognition;
    speech.onresult({ results: [[{ transcript: 'सीमेंट का भाव' }]] });
  });
  await expect(panel.getByLabel('Your question / editable voice transcript')).toHaveValue(
    'सीमेंट का भाव',
  );
  await expect(panel.getByRole('button', { name: 'Send ↑', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Stop recording' }).click();
  await expect(panel.getByRole('button', { name: 'Send ↑', exact: true })).toBeDisabled();
  await page.evaluate(() =>
    (
      window as unknown as { voiceTest: { recognition: { onend: () => void } } }
    ).voiceTest.recognition.onend(),
  );
  await expect(panel.getByRole('button', { name: 'Send ↑', exact: true })).toBeEnabled();
  await panel
    .getByLabel('Your question / editable voice transcript')
    .fill('Edited cement question');
  await panel.getByRole('button', { name: 'Use voice' }).click();
  await page.evaluate(() =>
    (
      window as unknown as { voiceTest: { recognition: { onerror: (event: unknown) => void } } }
    ).voiceTest.recognition.onerror({ error: 'not-allowed' }),
  );
  await expect(panel.getByText(/Microphone permission was denied/)).toBeVisible();
  await panel.getByRole('button', { name: 'Close assistant' }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { voiceTest: { aborts: number } }).voiceTest.aborts,
    ),
  ).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.assign(window, { SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
  });
  await page.getByRole('button', { name: /Shiv Assistant/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Use voice' }).click();
  await expect(page.getByText(/Voice is not supported/)).toBeVisible();
});

test('comparison distinguishes selling units; Hindi and enlarged reduced-motion layouts fit phone/tablet/desktop', async ({
  page,
}) => {
  await page.goto(`${site}/products`);
  await screenshot(page, 'catalogue');
  for (const id of [first, second]) {
    await page.locator(`a[href="/products/${id}"]`).first().click();
    await expect(page).toHaveURL(`${site}/products/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      id === first ? 'TEST WEB Cement PPC' : 'TEST WEB Steel TMT',
    );
    if (id === first) await screenshot(page, 'product-detail');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await page.getByRole('link', { name: 'Materials', exact: true }).click();
    await expect(page).toHaveURL(`${site}/products`);
  }
  await page.getByRole('link', { name: 'Compare (2/3)', exact: true }).click();
  await expect(page.getByText(/not normalized across different units/)).toBeVisible();
  await expect(page.locator('.comparison')).toContainText('/ bag');
  await expect(page.locator('.comparison')).toContainText('/ kg');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(site);
    await expect(page.getByRole('heading', { name: /Good materials/ })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await screenshot(page, `home-en-${width}`);
    await page.getByRole('button', { name: 'हिन्दी', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await screenshot(page, `home-hi-${width}`);
    await page.getByRole('button', { name: 'English', exact: true }).click();
  }
  await page.setViewportSize({ width: 360, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${site}/products/${first}`);
  await expect(page.getByLabel('Quantity for TEST WEB Cement PPC')).toBeEnabled();
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>('body *')].map(
      (element) => [element, parseFloat(getComputedStyle(element).fontSize)] as const,
    );
    for (const [element, size] of sizes) element.style.fontSize = `${size * 2}px`;
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
  await screenshot(page, 'product-enlarged-reduced-motion');
});

test('late checkout success cannot navigate or announce into a switched account', async ({
  page,
}) => {
  await checkout(page, '9888810010');
  let release!: () => void;
  let persisted!: () => void;
  let delivered!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const savedOrder = new Promise<void>((resolve) => {
    persisted = resolve;
  });
  const resultDelivered = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let orderId = '';
  await page.route(`${api}/orders`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    orderId = (await response.json()).id;
    persisted();
    await hold;
    await route.fulfill({ response });
    delivered();
  });
  await page.getByRole('button', { name: 'Place COD order', exact: true }).click();
  await savedOrder;
  const phone = '+919888810011';
  const otp = await page.request.post(`${api}/auth/otp/request`, {
    headers: { Origin: site },
    data: { phone },
  });
  expect(otp.ok(), await otp.text()).toBe(true);
  const verified = await page.request.post(`${api}/auth/otp/verify`, {
    headers: { Origin: site },
    data: { phone, code: (await otp.json()).devCode },
  });
  expect(verified.ok(), await verified.text()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByText(phone, { exact: true })).toBeVisible();
  release();
  await resultDelivered;
  await expect(page).toHaveURL(`${site}/account`);
  await expect(page.getByText(phone, { exact: true })).toBeVisible();
  expect((await page.request.get(`${api}/orders/${orderId}`)).status()).toBe(404);
});

test('product quantity stays disabled until hydration and preserves early multidigit input', async ({
  page,
}) => {
  let hydrate!: () => void;
  const hydration = new Promise<void>((resolve) => {
    hydrate = resolve;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await hydration;
    await route.continue();
  });
  try {
    await page.goto(`${site}/products/${first}`, { waitUntil: 'commit' });
    await expect(page.getByLabel('Quantity for TEST WEB Cement PPC')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add to quote', exact: true })).toBeDisabled();
  } finally {
    hydrate();
  }
  await page.getByLabel('Quantity for TEST WEB Cement PPC').fill('12');
  await page.getByLabel('Quantity for TEST WEB Cement PPC').press('Tab');
  await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
  await page.getByRole('link', { name: /^Basket 1$/ }).click();
  await expect(page.getByLabel('Quantity for TEST WEB Cement PPC')).toHaveValue('12');
});
