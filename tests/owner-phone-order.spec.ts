import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { hi } from '@shiv/i18n';
import type { Order } from '@shiv/shared';

const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const productId = 'p2-phone-order-cement';
const productName = 'Phase Two Phone Cement';
const productNameHi = 'फ़ोन ऑर्डर सीमेंट';
const customerPhone = '+919100000701';
const customerName = 'रमेश फ़ोन परीक्षण';
const pricePaise = 44000;
const deliveryFeePaise = 5000;
const quantity = 2;
const totalPaise = pricePaise * quantity + deliveryFeePaise;

// A registered service worker makes WebKit route requests around page.route(), which this spec uses.
test.use({ viewport: { width: 360, height: 800 }, actionTimeout: 15000, serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Owner phone journeys require a disposable _test database.');
  await db.product.upsert({
    where: { id: productId },
    update: { stock: 50, pricePaise, active: true },
    create: {
      id: productId,
      categoryId: 'cement',
      name: productName,
      nameHi: productNameHi,
      brand: 'शिव',
      type: 'सीमेंट',
      grade: 'पीपीसी',
      unit: 'बोरी',
      packSize: '५० किलो',
      pricePaise,
      stock: 50,
      images: [],
      description: 'Browser fixture only.',
      descriptionHi: 'फ़ोन ऑर्डर का अभ्यास',
      recommendedUse: 'Test only.',
    },
  });
  await db.deliveryZone.upsert({
    where: { id: 'p2-phone-order-zone' },
    update: { deliveryFeePaise, minimumOrderPaise: 0, freeDeliveryAbovePaise: null, active: true },
    create: {
      id: 'p2-phone-order-zone',
      name: 'फ़ोन परीक्षण इलाका',
      deliveryFeePaise,
      minimumOrderPaise: 0,
      estimate: 'आज',
      pincodes: { create: [{ pincode: '800071' }] },
    },
  });
});
test.afterAll(() => db.$disconnect());

async function signInHindi(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('shiv-owner-language', 'hi');
    } catch {
      /* Storage may be disabled. */
    }
  });
  await page.goto(desk + '/today');
  await expect(page.getByRole('heading', { name: 'नमस्ते।' })).toBeVisible();
  await page.getByRole('textbox', { name: 'मालिक का मोबाइल नंबर', exact: true }).fill('9297513707');
  const sent = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.status() === 201,
  );
  await page.getByRole('button', { name: 'कोड भेजें', exact: true }).click();
  const challenge = (await (await sent).json()) as { devCode: string };
  await page.getByRole('textbox', { name: 'साइन इन कोड', exact: true }).fill(challenge.devCode);
  await page.getByRole('button', { name: 'दुकान डेस्क खोलें', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'आज', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
}

async function accessibleAtLargeText(page: Page, screen: string) {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const widths = await page.evaluate(() => ({
    content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewport: window.innerWidth,
  }));
  expect(
    widths.content,
    `${screen} must not scroll horizontally at 360px and 200% text`,
  ).toBeLessThanOrEqual(widths.viewport);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target),
    })),
    screen,
  ).toEqual([]);
}

test('Hindi phone order survives a lost receipt and completes cash delivery once', async ({
  page,
}) => {
  test.setTimeout(120000);
  await signInHindi(page);
  await expect(page.getByText('आज की वसूली', { exact: true })).toBeVisible();
  await accessibleAtLargeText(page, 'आज');
  await page.getByRole('link', { name: '+ नया ऑर्डर', exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/new$/);
  await expect(page.getByRole('heading', { name: 'नया ऑर्डर', exact: true })).toBeVisible();
  await accessibleAtLargeText(page, 'नया ऑर्डर');

  await page
    .getByRole('textbox', { name: 'मोबाइल नंबर', exact: true })
    .fill(customerPhone.slice(3));
  await page.getByRole('textbox', { name: 'ग्राहक का नाम', exact: true }).fill(customerName);
  await page.getByRole('button', { name: 'आगे बढ़ें', exact: true }).click();
  await page.getByRole('searchbox', { name: 'सामग्री खोजें', exact: true }).fill(productName);
  await expect(page.getByRole('heading', { name: productNameHi, exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: `मात्रा ${productNameHi}`, exact: true })
    .fill(String(quantity));
  await page.getByRole('button', { name: 'आगे बढ़ें', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'घर, प्लॉट या साइट का पता', exact: true })
    .fill('प्लॉट ७१, मुख्य सड़क');
  await page.getByRole('textbox', { name: 'इलाका', exact: true }).fill('फ़ोन अभ्यास इलाका');
  await page.getByRole('textbox', { name: 'पिनकोड', exact: true }).fill('800071');
  await expect(page.getByRole('button', { name: 'उधार', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'ऑर्डर जाँचें', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'ऑर्डर जाँचें', exact: true });
  await expect(review.getByRole('heading', { name: customerName, exact: true })).toBeVisible();

  const attempts: Record<string, unknown>[] = [];
  let committed: { id: string; number: string } | undefined;
  await page.route('**/api/v1/admin/orders/phone', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    attempts.push(route.request().postDataJSON() as Record<string, unknown>);
    if (attempts.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      committed = (await response.json()) as { id: string; number: string };
      // Commit the real transaction, then hide only its response from the browser.
      await route.abort('failed');
    } else await route.continue();
  });
  await review.getByRole('button', { name: 'ऑर्डर पक्का करें', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('दुकान से संपर्क नहीं हुआ');
  await expect(
    page.getByRole('textbox', { name: 'घर, प्लॉट या साइट का पता', exact: true }),
  ).toBeDisabled();
  await review.getByRole('button', { name: 'ऑर्डर पक्का करें', exact: true }).click();
  const success = page.getByRole('dialog', { name: 'ऑर्डर दर्ज हो गया', exact: true });
  await expect(success).toBeVisible();
  expect(committed).toBeDefined();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0].items).toEqual([{ productId, quantity }]);
  await expect(success.locator('a[href^="https://wa.me/"]')).toHaveAttribute(
    'href',
    new RegExp(customerPhone.slice(1)),
  );
  await expect(success.locator('a[href^="tel:"]')).toHaveAttribute('href', `tel:${customerPhone}`);
  await success.getByRole('button', { name: 'ऑर्डर देखें', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${committed!.id}(?:\\?.*)?$`));
  await expect(
    page.getByRole('heading', { name: `ऑर्डर ${committed!.number}`, exact: true }),
  ).toBeVisible();
  await accessibleAtLargeText(page, 'ऑर्डर की जानकारी');

  await page.getByRole('button', { name: 'माल तैयार करें', exact: true }).click();
  await expect(page.getByText('तैयार हो रहा है', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'माल भेजें', exact: true }).click();
  await expect(page.getByText('माल भेज दिया', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'डिलीवरी पूरी करें', exact: true }).click();
  const receipt = page.getByRole('dialog', { name: 'पैसा मिला', exact: true });
  await receipt.getByLabel('भुगतान का तरीका', { exact: true }).selectOption('CASH');
  await receipt
    .getByRole('button', { name: 'पैसा दर्ज करके डिलीवरी पूरी करें', exact: true })
    .click();
  await expect(page.getByText('डिलीवरी पूरी', { exact: true }).first()).toBeVisible();

  const order = await db.order.findUniqueOrThrow({
    where: { id: committed!.id },
    include: { items: true, payment: true },
  });
  const owner = await db.user.findUniqueOrThrow({ where: { phone: '+919297513707' } });
  expect(order).toMatchObject({
    source: 'PHONE',
    status: 'DELIVERED',
    createdById: owner.id,
    reviewId: null,
    subtotalPaise: pricePaise * quantity,
    deliveryFeePaise,
    totalPaise,
    payment: { method: 'COD', status: 'CAPTURED' },
  });
  expect(order.items).toMatchObject([
    { productId, quantity, pricePaise, lineTotalPaise: pricePaise * quantity },
  ]);
  expect(
    await db.order.count({
      where: { idempotencyKey: String(attempts[0].idempotencyKey), userId: order.userId },
    }),
  ).toBe(1);
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(48);
  const movements = await db.inventoryMovement.findMany({
    where: { productId, reference: order.number },
  });
  expect(movements).toMatchObject([
    { kind: 'ONLINE_ORDER', quantity: -quantity, balanceAfter: 48 },
  ]);
  const collections = await db.financialMovement.findMany({
    where: { paymentId: order.payment!.id, kind: 'COLLECTION' },
  });
  expect(collections).toMatchObject([{ amountPaise: totalPaise, channel: 'CASH' }]);
  expect(await db.customerLedgerEntry.count({ where: { orderId: order.id } })).toBe(0);
});

async function draftPhoneOrder(page: Page, phone: string, name: string) {
  await signInHindi(page);
  await page.getByRole('link', { name: hi['owner.newOrderAction'], exact: true }).click();
  await page.getByRole('textbox', { name: hi['owner.phone'], exact: true }).fill(phone.slice(3));
  await page.getByRole('textbox', { name: hi['owner.name'], exact: true }).fill(name);
  await page.getByRole('button', { name: hi['owner.continue'], exact: true }).click();
  await page
    .getByRole('searchbox', { name: hi['owner.searchProducts'], exact: true })
    .fill(productName);
  await page
    .getByRole('textbox', { name: `${hi['owner.quantity']} ${productNameHi}`, exact: true })
    .fill(String(quantity));
  await page.getByRole('button', { name: hi['owner.continue'], exact: true }).click();
  await page
    .getByRole('textbox', { name: hi['owner.addressLine'], exact: true })
    .fill('प्लॉट ७२, मुख्य सड़क');
  await page
    .getByRole('textbox', { name: hi['owner.area'], exact: true })
    .fill('फ़ोन अभ्यास इलाका');
  await page.getByRole('textbox', { name: hi['owner.pincode'], exact: true }).fill('800071');
  await expect(page.getByText(hi['owner.serviceable'], { exact: false })).toBeVisible();
  const checked = await page.request.get('http://localhost:4010/api/v1/delivery/800071');
  expect(checked.ok()).toBe(true);
  return checked.json();
}

test('switching a credit limit override back to COD sends no override or khata charge', async ({
  page,
}) => {
  const phone = '+919100000703';
  const name = 'उधार से नकद परीक्षण';
  const customer = await db.user.upsert({
    where: { phone },
    create: { phone, name, creditAllowed: true, creditLimitPaise: 50000 },
    update: { name, creditAllowed: true, creditLimitPaise: 50000 },
  });
  await db.address.create({
    data: {
      userId: customer.id,
      label: 'Old site',
      name,
      phone,
      line1: 'Old saved site',
      area: 'Old area',
      city: 'Patna',
      state: 'Bihar',
      pincode: '800099',
    },
  });
  let releaseProfile!: () => void;
  const profileGate = new Promise<void>((resolve) => {
    releaseProfile = resolve;
  });
  await page.route(`**/api/v1/admin/customers/${customer.id}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await profileGate;
    // The desk may drop this request while it is held (a newer one replaces it). Playwright then
    // disposes the held response, which is not what this test is about.
    await route.fulfill({ response }).catch(() => {});
  });
  const before = await db.product.findUniqueOrThrow({ where: { id: productId } });
  await draftPhoneOrder(page, phone, name);
  const profileReturned = page.waitForResponse((r) =>
    r.url().endsWith(`/admin/customers/${customer.id}`),
  );
  releaseProfile();
  await profileReturned;
  await expect(page.getByRole('textbox', { name: hi['owner.pincode'], exact: true })).toHaveValue(
    '800071',
  );

  const credit = page.getByRole('button', { name: hi['owner.credit'], exact: true });
  await expect(credit).toBeEnabled();
  await credit.click();
  await page.getByRole('checkbox', { name: hi['owner.override'], exact: true }).check();
  await page.getByRole('button', { name: hi['owner.cash'], exact: true }).click();
  await expect(page.getByRole('checkbox', { name: hi['owner.override'], exact: true })).toHaveCount(
    0,
  );
  await credit.click();
  await expect(
    page.getByRole('checkbox', { name: hi['owner.override'], exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: hi['owner.cash'], exact: true }).click();
  await page.getByRole('button', { name: hi['owner.reviewOrder'], exact: true }).click();
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/admin/orders/phone') && r.request().method() === 'POST',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: hi['owner.placeOrder'], exact: true })
    .click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({
    paymentMethod: 'COD',
    overrideLimit: false,
    address: { pincode: '800071', line1: 'प्लॉट ७२, मुख्य सड़क' },
  });
  const order = (await response.json()) as Order;
  expect(order).toMatchObject({
    userId: customer.id,
    source: 'PHONE',
    totalPaise,
    payment: { method: 'COD', status: 'PENDING' },
  });
  expect(await db.customerLedgerEntry.count({ where: { orderId: order.id } })).toBe(0);
  expect(
    await db.auditLog.count({ where: { entityId: order.id, event: 'CREDIT_LIMIT_OVERRIDE' } }),
  ).toBe(0);
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
    before.stock - quantity,
  );
});

test('a loaded delivery minimum does not block switching a phone draft to counter pickup', async ({
  page,
}) => {
  const before = await db.product.findUniqueOrThrow({ where: { id: productId } });
  await db.deliveryZone.update({
    where: { id: 'p2-phone-order-zone' },
    data: { minimumOrderPaise: 1000000 },
  });
  try {
    const check = await draftPhoneOrder(page, '+919100000703', 'काउंटर न्यूनतम परीक्षण');
    expect(check.zone.minimumOrderPaise).toBe(1000000);
    await expect(
      page.getByRole('button', { name: hi['owner.reviewOrder'], exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: hi['owner.back'], exact: true }).click();
    await page.getByRole('button', { name: hi['owner.back'], exact: true }).click();
    await page.getByRole('button', { name: hi['owner.walkIn'], exact: true }).click();
    await page.getByRole('button', { name: hi['owner.continue'], exact: true }).click();
    await page.getByRole('button', { name: hi['owner.continue'], exact: true }).click();
    await expect(
      page.getByRole('button', { name: hi['owner.reviewOrder'], exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: hi['owner.reviewOrder'], exact: true }).click();
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/admin/orders/phone') && r.request().method() === 'POST',
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: hi['owner.placeOrder'], exact: true })
      .click();
    const response = await created;
    expect(response.status()).toBe(201);
    const order = (await response.json()) as Order;
    expect(order).toMatchObject({
      source: 'WALK_IN',
      deliveryFeePaise: 0,
      totalPaise: pricePaise * quantity,
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
      before.stock - quantity,
    );
    expect(
      await db.inventoryMovement.count({
        where: { productId, reference: order.number, kind: 'WALK_IN_SALE', quantity: -quantity },
      }),
    ).toBe(1);
  } finally {
    await db.deliveryZone.update({
      where: { id: 'p2-phone-order-zone' },
      data: { minimumOrderPaise: 0 },
    });
  }
});

test('the new-order button is one tap away on every desk screen except the order form', async ({
  page,
}) => {
  await signInHindi(page);
  const newOrder = page.getByRole('link', { name: hi['owner.newOrderAction'], exact: true });
  for (const route of ['/today', '/orders', '/customers', '/khata', '/stock', '/more']) {
    await page.goto(desk + route);
    await expect(newOrder, route).toBeVisible();
  }
  await newOrder.click();
  await expect(page).toHaveURL(/\/orders\/new$/);
  await expect(
    page.getByRole('heading', { name: hi['owner.newOrder'], exact: true }),
  ).toBeVisible();
  await expect(newOrder).toHaveCount(0);
});
