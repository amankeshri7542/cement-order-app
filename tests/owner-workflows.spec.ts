import { type Page, type Response } from '@playwright/test';
import { test, expect, observePage } from './fixtures';
import { PrismaClient } from '@prisma/client';
import { mkdir } from 'node:fs/promises';
import type { Order, Quote } from '@shiv/shared';

// These journeys use real HTTP and PostgreSQL. OTP is the explicitly isolated mock provider.
test.use({ actionTimeout: 15000 });
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const api = 'http://localhost:4010/api/v1';
const products = [
  { id: 'family-cod-cement', name: 'Family COD Cement' },
  { id: 'family-return-cement', name: 'Family Return Cement' },
  { id: 'family-bulk-cement', name: 'Family Bulk Cement' },
  { id: 'qa-fallback-cement', name: 'QA Fallback Cement' },
  { id: 'qa-refund-cement', name: 'QA Refund Cement' },
];
const tomorrow = () =>
  new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

test.beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Owner journeys require the disposable _test database.');
  await db.user.createMany({
    skipDuplicates: true,
    data: [31, 32, 33, 34, 35, 36].map((suffix) => ({
      phone: `+9192975137${suffix}`,
      name: `Family workflow owner ${suffix}`,
      role: 'ADMIN' as const,
    })),
  });
  await db.deliveryZone.upsert({
    where: { id: 'family-workflow-zone' },
    update: {},
    create: {
      id: 'family-workflow-zone',
      name: 'Family workflow fixture — test only',
      deliveryFeePaise: 50000,
      minimumOrderPaise: 0,
      estimate: 'Test delivery',
      pincodes: { create: [{ pincode: '800027' }] },
    },
  });
  for (const product of products)
    await db.product.upsert({
      where: { id: product.id },
      update: {},
      create: {
        ...product,
        categoryId: 'cement',
        brand: 'Family test',
        type: 'PPC Cement',
        grade: 'PPC',
        unit: '50 kg bag',
        pricePaise: 39000,
        stock: 500,
        images: [],
        description: 'Isolated owner workflow browser fixture.',
        recommendedUse: 'Test only.',
      },
    });
  await mkdir('docs/screenshots', { recursive: true });
});
test.afterAll(() => db.$disconnect());

test('SSE outage: polling finds new work and competing owners keep one durable assignee', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const fatherContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const uncleContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const father = await fatherContext.newPage();
  const uncle = await uncleContext.newPage();
  try {
    // Transport fault injection only: polling, orders and acknowledgment use the real API.
    await father.route('**/admin/events', (route) => route.abort('connectionfailed'));
    await uncle.route('**/admin/events', (route) => route.abort('connectionfailed'));
    await ownerLogin(father, 34);
    await ownerLogin(uncle, 35);
    await expect(
      father.getByText('Live connection interrupted · checking every 15 seconds', { exact: true }),
    ).toBeVisible();
    await customerLogin(page, 34);
    const { order } = await submitOrder(page, products[3]!, 5);
    // No owner reload, navigation, focus or manual refresh after order submission.
    await openOrder(father, order);
    await openOrder(uncle, order);
    const responses = [father, uncle].map((owner) =>
      owner.waitForResponse((r) => r.url().endsWith(`/orders/${order.id}/acknowledge`)),
    );
    await Promise.all(
      [father, uncle].map((owner) =>
        owner.getByRole('button', { name: 'ज़िम्मेदारी लें / Acknowledge', exact: true }).click(),
      ),
    );
    for (const response of await Promise.all(responses)) expect(response.status()).toBe(201);
    const work = await db.ownerWork.findUniqueOrThrow({
      where: { orderId: order.id },
      include: { assignedTo: true },
    });
    expect(work.acknowledgedAt).not.toBeNull();
    expect(['+919297513734', '+919297513735']).toContain(work.assignedTo?.phone);
    expect(
      await db.auditLog.count({ where: { entityId: order.id, event: 'ORDER_ACKNOWLEDGED' } }),
    ).toBe(1);
    await father.reload();
    await expect(
      father.getByRole('dialog').getByRole('heading', { name: order.number, exact: true }),
    ).toBeVisible();
    await expect(
      father.getByRole('dialog').locator('strong').filter({ hasText: work.assignedTo!.name }),
    ).toBeVisible();
    await expect(
      father.getByRole('dialog').getByRole('link', { name: /फ़ोन \/ Call/ }),
    ).toHaveAttribute('href', /^tel:\+91/);
    await expect(
      father.getByRole('dialog').getByRole('link', { name: /WhatsApp/ }),
    ).toHaveAttribute('href', /^https:\/\/wa\.me\/91/);
    // Restore the real SSE transport and require automatic reconnection without a reload.
    await father.unroute('**/admin/events');
    const reopened = father.waitForResponse(
      (r) => r.url().endsWith('/admin/events') && r.status() === 200,
    );
    await reopened;
    await father.screenshot({
      path: test.info().outputPath('polling-assignment-reconnected.png'),
      fullPage: true,
    });
  } finally {
    await fatherContext.close();
    await uncleContext.close();
  }
});

test('collected COD cancellation records one cash refund and restores stock once', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner = await context.newPage();
  try {
    await ownerLogin(owner, 36);
    await customerLogin(page, 36);
    const { order } = await submitOrder(page, products[4]!, 5);
    await openOrder(owner, order);
    await owner.getByRole('button', { name: /Record cash payment received/ }).click();
    await expect(owner.getByRole('dialog').getByText('Captured', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await expect(owner.getByRole('button', { name: /Record cash refund returned/ })).toBeVisible();
    const refunded = owner.waitForResponse((r) =>
      r.url().endsWith(`/orders/${order.id}/cash-refunded`),
    );
    await owner.getByRole('button', { name: /Record cash refund returned/ }).click();
    await replay(owner, await refunded);
    const payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe('REFUNDED');
    const movements = await db.financialMovement.findMany({ where: { paymentId: payment.id } });
    expect(movements.filter((m) => m.kind === 'COLLECTION')).toHaveLength(1);
    expect(movements.filter((m) => m.kind === 'REFUND')).toHaveLength(1);
    expect(movements.map((m) => m.amountPaise)).toEqual([order.totalPaise, order.totalPaise]);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[4]!.id } })).stock).toBe(
      500,
    );
    const customerView = await page.request.get(`${api}/orders/${order.id}`);
    expect(customerView.status()).toBe(200);
    expect(await customerView.json()).toMatchObject({
      status: 'REFUNDED',
      payment: { status: 'REFUNDED' },
    });
    await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
    await expect(
      page.getByText('Your payment has been refunded. This order will not be delivered.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('customer-refunded-order.png'),
      fullPage: true,
    });
    await owner.getByRole('button', { name: 'Print summary', exact: true }).evaluate((button) => {
      // Intercept the OS print dialog only; keep the real summary content/rendering.
      window.print = () => document.body.setAttribute('data-qa-print', 'called');
      (button as HTMLButtonElement).click();
    });
    await expect(owner.locator('body')).toHaveAttribute('data-qa-print', 'called');
    await expect(
      owner.getByText('Order summary · not a GST tax invoice', { exact: true }),
    ).toBeVisible();
    await owner.screenshot({
      path: test.info().outputPath('owner-refunded-summary.png'),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

async function customerLogin(page: Page, suffix: number) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:8082');
  await page.getByRole('tab', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Mobile number (+91)' }).fill(`98888888${suffix}`);
  const sent = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code' }).click();
  await page
    .getByRole('textbox', { name: 'Verification code', exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: 'Verify & continue' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Saved addresses', exact: true }).click();
  for (const [name, value] of [
    ['Recipient name', `Family review customer ${suffix}`],
    ['Building, plot or street', 'Plot 50'],
    ['Area / locality', 'Kankarbagh'],
    ['Pincode', '800027'],
  ])
    await page.getByRole('textbox', { name, exact: true }).fill(value!);
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page.getByText('Address saved', { exact: true })).toBeVisible();
}
async function ownerLogin(page: Page, suffix: number) {
  observePage(page, test.info());
  await page.goto('http://localhost:3001');
  await page.getByRole('textbox', { name: 'Staff mobile number' }).fill(`92975137${suffix}`);
  const sent = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code' }).click();
  await page
    .getByRole('textbox', { name: 'Verification code', exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.getByRole('heading', { name: 'आज / Today', exact: true })).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
}
async function submitOrder(page: Page, product: (typeof products)[number], quantity: number) {
  await page.getByRole('tab', { name: 'Products' }).click();
  await page
    .getByRole('textbox', { name: 'Search cement, steel, sand…', exact: true })
    .fill(product.name);
  await page.getByRole('button', { name: `View ${product.name}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill(String(quantity));
  await page.getByRole('button', { name: /Add.*to cart/ }).click();
  await page.getByRole('button', { name: /^Your cart,.*1 products?$/ }).click();
  await page.getByRole('button', { name: 'Continue to checkout', exact: true }).click();
  await page.getByRole('button', { name: 'Review your order', exact: true }).click();
  const total = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    quantity * 390 + 500,
  );
  await expect(page.getByText(total, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order', exact: true })).toBeDisabled();
  await page.getByRole('checkbox').check();
  const created = page.waitForResponse(
    (response) => response.url() === `${api}/orders` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  await expect(page.getByText('Order received.', { exact: true })).toBeVisible();
  return { order: (await response.json()) as Order, response };
}
async function replay(page: Page, response: Response) {
  const original = response.request();
  const headers = await original.allHeaders();
  const result = await page.request.post(original.url(), {
    ...(original.postData() === null ? {} : { data: original.postDataJSON() }),
    headers: {
      Origin: new URL(page.url()).origin,
      ...(headers.authorization ? { Authorization: headers.authorization } : {}),
    },
  });
  expect(result.ok(), `Replay ${result.status()}: ${await result.text()}`).toBe(true);
  return result.json();
}
async function openOrder(owner: Page, order: Order) {
  await owner
    .locator('.owner-order-cards')
    .getByRole('button', { name: `Open ${order.number}`, exact: true })
    .click();
  await expect(owner.getByRole('dialog')).toBeVisible();
}
async function acknowledgeAndDispatch(owner: Page) {
  const dialog = owner.getByRole('dialog');
  await dialog.getByRole('button', { name: 'ज़िम्मेदारी लें / Acknowledge', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'ज़िम्मेदारी लें / Acknowledge', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Mark preparing', exact: true }).click();
  await dialog.getByRole('button', { name: 'Mark out for delivery', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Mark delivered', exact: true })).toBeVisible();
}

// Separate customers, owners, products and delivery coverage avoid coupling to older journeys.
test('phone COD: automatic owner queue, acknowledgment, actual collection, delivery and one stock reservation', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner = await context.newPage();
  const errors: string[] = [];
  owner.on('pageerror', (error) => errors.push(error.message));
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await ownerLogin(owner, 31);
    await owner.getByRole('button', { name: 'Switch owner language' }).click();
    await owner.reload();
    await expect(owner.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'Switch owner language' }).click();
    await owner.getByRole('button', { name: /^नया काम \/ New work/ }).click();
    await customerLogin(page, 31);
    const { order, response } = await submitOrder(page, products[0]!, 50);
    expect(order.totalPaise).toBe(2000000);
    expect(order.items[0]!.quantity).toBe(50);
    expect((await replay(page, response)).id).toBe(order.id);
    await openOrder(owner, order); // No owner refresh or navigation after customer submission.
    await expect.poll(() => db.ownerWork.count({ where: { orderId: order.id } })).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0]!.id } })).stock).toBe(
      450,
    );
    await acknowledgeAndDispatch(owner);
    await expect
      .poll(async () =>
        Boolean((await db.ownerWork.findUnique({ where: { orderId: order.id } }))?.acknowledgedAt),
      )
      .toBe(true);
    const collected = owner.waitForResponse(
      (r) =>
        r.url().endsWith(`/orders/${order.id}/cod-received`) && r.request().method() === 'POST',
    );
    await owner.getByRole('button', { name: /Record cash payment received/ }).click();
    await replay(owner, await collected);
    await owner.getByRole('button', { name: 'Mark delivered', exact: true }).click();
    await expect
      .poll(async () => (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status)
      .toBe('DELIVERED');
    const payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe('CAPTURED');
    expect(
      await db.financialMovement.count({ where: { paymentId: payment.id, kind: 'COLLECTION' } }),
    ).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0]!.id } })).stock).toBe(
      450,
    );
    await owner.screenshot({ path: 'docs/screenshots/owner-cod-hindi-phone.png', fullPage: true });
    await owner.goBack();
    await expect(owner.getByRole('dialog')).toHaveCount(0);
    expect(
      await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('phone refused delivery: retry and physical return without fake collection, stock restored once', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner = await context.newPage();
  try {
    await ownerLogin(owner, 32);
    await owner.getByRole('button', { name: /^नया काम \/ New work/ }).click();
    await customerLogin(page, 32);
    const { order } = await submitOrder(page, products[1]!, 10);
    await openOrder(owner, order);
    await acknowledgeAndDispatch(owner);
    const dialog = owner.getByRole('dialog');
    async function refuse(note: string) {
      await dialog.getByText('डिलीवरी में समस्या / Delivery problem', { exact: true }).click();
      await dialog.getByLabel(/कारण \/ Reason/).selectOption('REFUSED');
      await dialog.getByLabel('क्या हुआ / What happened', { exact: true }).fill(note);
      await dialog
        .getByRole('button', { name: 'समस्या दर्ज करें / Record exception', exact: true })
        .click();
      await expect(
        dialog.getByRole('button', { name: 'फिर भेजें / Schedule retry', exact: true }),
      ).toBeVisible();
      expect((await db.product.findUniqueOrThrow({ where: { id: products[1]!.id } })).stock).toBe(
        490,
      );
      expect((await db.payment.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe(
        'PENDING',
      );
    }
    await refuse('Customer refused today; requested another delivery attempt.');
    await dialog.getByLabel('दोबारा भेजने की तारीख / Retry date', { exact: true }).fill(tomorrow());
    await dialog
      .getByLabel('ग्राहक से तय बात / Retry arrangement', { exact: true })
      .fill('Customer confirmed tomorrow by phone.');
    await dialog.getByRole('button', { name: 'फिर भेजें / Schedule retry', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Mark delivered', exact: true })).toBeVisible();
    await refuse('Second visit refused; vehicle returned all ten bags.');
    await dialog
      .getByText('दुकान में माल वापस मिला / Confirm physical return', { exact: true })
      .click();
    await dialog.getByLabel('सही माल / Sellable returned', { exact: true }).fill('8');
    await dialog.getByLabel('खराब माल / Damaged returned', { exact: true }).fill('2');
    await dialog
      .getByLabel('वापसी का विवरण / Return evidence', { exact: true })
      .fill('Owner counted eight dry bags and two water-damaged bags at the shop.');
    const returned = owner.waitForResponse(
      (r) =>
        r.url().endsWith(`/orders/${order.id}/delivery`) &&
        r.request().postDataJSON()?.action === 'RETURN',
    );
    await dialog
      .getByRole('button', { name: 'वापसी की पुष्टि / Confirm returned stock', exact: true })
      .click();
    await replay(owner, await returned);
    await expect
      .poll(async () => (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status)
      .toBe('CANCELLED');
    expect((await db.product.findUniqueOrThrow({ where: { id: products[1]!.id } })).stock).toBe(
      498,
    );
    const payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe('PENDING');
    expect(await db.financialMovement.count({ where: { paymentId: payment.id } })).toBe(0);
    expect(await db.deliveryAttempt.count({ where: { orderId: order.id } })).toBe(4);
    await owner.screenshot({
      path: 'docs/screenshots/owner-return-hindi-phone.png',
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test('wholesale UI: freight confirmation, renewed consent and one order at the negotiated revision', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner = await context.newPage();
  try {
    await ownerLogin(owner, 33);
    await owner.getByRole('button', { name: /थोक अनुरोध \/ New quotations/ }).click();
    await customerLogin(page, 33);
    await page.getByRole('tab', { name: 'Home' }).click();
    await page.getByRole('button', { name: 'Bulk quotation', exact: true }).click();
    await page.getByRole('textbox', { name: /^Find.*material$/ }).fill(products[2]!.name);
    await page.getByRole('button', { name: products[2]!.name, exact: true }).click();
    const requested = page.waitForResponse(
      (r) => r.url() === `${api}/quotes` && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Send bulk request', exact: true }).click();
    const quote = (await (await requested).json()) as Quote;
    expect(quote.items[0]!.quantity).toBe(100);
    await owner
      .locator('.owner-order-cards')
      .getByRole('button', { name: `Open quote ${quote.number}`, exact: true })
      .click();
    await owner
      .getByRole('button', { name: 'ज़िम्मेदारी लें / Acknowledge quotation', exact: true })
      .click();
    await owner
      .locator('.owner-order-cards')
      .getByRole('button', { name: `Open quote ${quote.number}`, exact: true })
      .click();
    await owner.getByLabel(/Family Bulk Cement.*price per unit/).fill('380');
    await owner.getByLabel('Delivery charge (₹)', { exact: true }).fill('750');
    await owner.getByRole('checkbox', { name: /I checked the site/ }).check();
    await owner.getByRole('button', { name: 'Send quotation', exact: true }).click();
    await expect(owner.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
    await page.getByRole('button', { name: 'Accept quote · ₹38,750.00', exact: true }).click();
    await expect
      .poll(async () => (await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status)
      .toBe('ACCEPTED');
    await owner.getByRole('button', { name: 'Show all quotes', exact: true }).click();
    await owner
      .locator('.owner-order-cards')
      .getByRole('button', { name: `Open quote ${quote.number}`, exact: true })
      .click();
    await owner
      .getByRole('button', { name: 'बात बदली है / Revise terms for fresh consent', exact: true })
      .click();
    await owner.getByLabel(/Family Bulk Cement.*price per unit/).fill('381');
    await owner.getByLabel('Delivery charge (₹)', { exact: true }).fill('760');
    await owner.getByRole('button', { name: 'Send revised quote', exact: true }).click();
    await expect
      .poll(async () => (await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status)
      .toBe('SENT');
    expect(await db.order.count({ where: { quoteId: quote.id } })).toBe(0);
    await page.getByRole('button', { name: 'Refresh current screen', exact: true }).click();
    await page.getByRole('button', { name: 'Accept quote · ₹38,860.00', exact: true }).click();
    await expect
      .poll(async () => (await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status)
      .toBe('ACCEPTED');
    await owner.getByRole('button', { name: 'Refresh data', exact: true }).click();
    await owner
      .locator('.owner-order-cards')
      .getByRole('button', { name: `Open quote ${quote.number}`, exact: true })
      .click();
    const converted = owner.waitForResponse(
      (r) => r.url().endsWith(`/quotes/${quote.id}/convert`) && r.request().method() === 'POST',
    );
    await owner
      .getByRole('button', { name: 'ऑर्डर बनाएँ / Create supply order', exact: true })
      .click();
    const response = await converted;
    expect(response.status()).toBe(201);
    const order = (await response.json()) as Order;
    expect((await replay(owner, response)).id).toBe(order.id);
    await expect(
      owner.getByRole('dialog').getByRole('heading', { name: order.number, exact: true }),
    ).toBeVisible();
    const persisted = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    expect(persisted.quoteId).toBe(quote.id);
    expect(persisted.quoteRevision).toBe(2);
    expect(persisted.totalPaise).toBe(3886000);
    expect(persisted.deliveryFeePaise).toBe(76000);
    expect(persisted.items[0]!.quantity).toBe(100);
    expect(persisted.items[0]!.pricePaise).toBe(38100);
    expect(await db.order.count({ where: { quoteId: quote.id } })).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[2]!.id } })).stock).toBe(
      400,
    );
    await owner.screenshot({
      path: 'docs/screenshots/owner-quote-hindi-phone.png',
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
