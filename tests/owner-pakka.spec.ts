import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { request as apiRequest } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { hi } from '@shiv/i18n';
import type { StaffRole } from '@shiv/shared';
import { test, expect } from './fixtures';
import { addPerson, tokenFor } from '../apps/api/test/staff-helper';

// Pakka karo, on the real desk. The server's rules are in apps/api/test/confirm.test.ts; these
// journeys check what a person sees and taps, on a small phone with large text.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const api = 'http://localhost:4010/api/v1';
const MAIN = 'loc_main';
let counter = 0;
const unique = () => `${Date.now().toString(36)}${counter++}`;
const freshPhone = () => `9${String(Date.now()).slice(-8)}${counter++ % 10}`;
test.use({ serviceWorkers: 'block' });
// Waiting orders count against the shop's limit on unpaid orders, so these do not stay waiting.
test.afterEach(() =>
  db.order.updateMany({
    where: { userId: { startsWith: 'p2cust' }, status: 'AWAITING_CONFIRMATION' },
    data: { status: 'CANCELLED' },
  }),
);
test.afterAll(() => db.$disconnect());

async function staff(role: StaffRole, shops: string[] = [MAIN]) {
  const phone = freshPhone();
  const id = `p2${role.toLowerCase().replace('_', '')}${unique()}`;
  const allShops = ['OWNER', 'ACCOUNTANT', 'TECH_OPERATOR'].includes(role);
  await addPerson(db, {
    id,
    role,
    phone: `+91${phone}`,
    ...(allShops ? {} : { shops }),
  });
  await db.user.update({ where: { id }, data: { name: `${role} ${phone.slice(-4)}` } });
  return { id, digits: phone, name: `${role} ${phone.slice(-4)}` };
}

/** A real customer order through the real checkout, the way the app places it. */
async function customerOrder(quantity = 5, notes = '') {
  const id = `p2cust${unique()}`;
  const phone = `+91${freshPhone()}`;
  await addPerson(db, { id, phone });
  const name = `Grahak ${id.slice(-5)}`;
  await db.user.update({ where: { id }, data: { name, language: 'hi' } });
  await db.address.create({
    data: {
      id: `${id}-site`,
      userId: id,
      label: 'Site',
      name,
      phone,
      line1: 'Plot 12',
      area: 'Kankarbagh',
      city: 'Patna',
      state: 'Bihar',
      pincode: '800020',
      landmark: '',
    },
  });
  const product = await db.product.findFirstOrThrow({
    where: { active: true, stock: { gt: 200 }, quantityStep: 1, minQuantity: { lte: 1 } },
    orderBy: { createdAt: 'asc' },
  });
  const client = await apiRequest.newContext({
    baseURL: `${api}/`,
    extraHTTPHeaders: { Authorization: `Bearer ${tokenFor(id)}` },
  });
  try {
    const cart = await client.put('cart/items', { data: { productId: product.id, quantity } });
    expect(cart.status(), await cart.text()).toBe(200);
    const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const review = await client.post('checkout/review', {
      data: { addressId: `${id}-site`, deliveryDate: day, paymentMethod: 'COD', notes },
    });
    expect(review.status(), await review.text()).toBe(201);
    const placed = await client.post('orders', {
      data: { reviewId: (await review.json()).id, idempotencyKey: randomUUID() },
    });
    expect(placed.status(), await placed.text()).toBe(201);
    const order = (await placed.json()) as { id: string; number: string; totalPaise: number };
    return { ...order, customerId: id, customerName: name, productId: product.id };
  } finally {
    await client.dispose();
  }
}

async function open(
  browser: Browser,
  viewport = { width: 390, height: 844 },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'hi'));
  return { context, page };
}
async function signIn(page: Page, digits: string, path = '/inbox') {
  await page.goto(`${desk}${path}`);
  await page.getByRole('textbox', { name: hi['owner.loginPhone'] }).fill(digits);
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: hi['owner.sendCode'] }).click();
  await page
    .getByRole('textbox', { name: hi['owner.code'], exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: hi['owner.signIn'] }).click();
}
const cardOf = (page: Page, name: string) => page.locator('article', { hasText: name });
const pakka = (scope: Page | ReturnType<Page['locator']>) =>
  scope.getByRole('button', { name: hi['owner.pakka.confirm'], exact: true });

test('one tap confirms, the customer hears nothing for 10 seconds, and Wapas lo puts it back', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const owner = await staff('OWNER');
  const order = await customerOrder();
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    const card = cardOf(page, order.customerName);
    await expect(card).toBeVisible();
    await expect(card).toContainText(hi['owner.pakka.fromApp']);

    await pakka(card).click();
    const undo = page.getByRole('button', { name: /^Wapas lo \d+$/ });
    await expect(undo).toBeVisible();
    await expect(page.getByText(`${order.customerName} ko message ja raha hai`)).toBeVisible();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'CONFIRMED',
    );
    // The customer's message is written and waiting. It has not gone.
    const held = await db.notification.findFirstOrThrow({
      where: { orderId: order.id, dedupeKey: { startsWith: 'decision:' } },
    });
    expect(held.sendAfter!.getTime()).toBeGreaterThan(Date.now());

    await undo.click();
    await expect(cardOf(page, order.customerName)).toBeVisible();
    await expect(pakka(cardOf(page, order.customerName))).toBeVisible();
    const back = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(back).toMatchObject({ status: 'AWAITING_CONFIRMATION', confirmedById: null });
    expect(
      await db.notification.count({
        where: { orderId: order.id, dedupeKey: { startsWith: 'decision:' } },
      }),
    ).toBe(0);

    // The double-tap guard ignores anything within half a second of the last tap.
    await page.waitForTimeout(600);
    await pakka(cardOf(page, order.customerName)).click();
    await expect(page.getByRole('button', { name: /^Wapas lo \d+$/ })).toBeVisible();
    // The hold runs out, and undo is gone.
    await expect(page.getByText(hi['owner.pakka.sent'])).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /^Wapas lo \d+$/ })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('on a small phone with large text the main button is on screen with no scrolling', async ({
  browser,
}) => {
  const owner = await staff('OWNER');
  const order = await customerOrder();
  const { context, page } = await open(browser, { width: 360, height: 640 });
  try {
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = '130%';
      });
    });
    await signIn(page, owner.digits);
    const card = cardOf(page, order.customerName);
    await expect(card).toBeVisible();
    await page.goto(`${desk}/inbox/${order.id}`);
    const button = pakka(page);
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    const tabs = await page.locator('nav[data-owner-tabs]').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // Sits above the tabs, not behind them, and inside the screen.
    expect(box!.y + box!.height).toBeLessThanOrEqual(tabs!.y + 1);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(640);
  } finally {
    await context.close();
  }
});

test('when two owners act, the second is told who did it, not shown an error', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const first = await staff('OWNER');
  const second = await staff('OWNER');
  const order = await customerOrder();
  const a = await open(browser);
  const b = await open(browser);
  try {
    await signIn(a.page, first.digits);
    // The second phone misses the live update, so it still shows the button when it is tapped.
    await b.page.route('**/admin/events', (route) => route.abort());
    await signIn(b.page, second.digits);
    await expect(cardOf(a.page, order.customerName)).toBeVisible();
    await expect(cardOf(b.page, order.customerName)).toBeVisible();
    await pakka(cardOf(a.page, order.customerName)).click();
    await expect(a.page.getByRole('button', { name: /^Wapas lo \d+$/ })).toBeVisible();
    await pakka(cardOf(b.page, order.customerName)).click();
    await expect(b.page.getByText(new RegExp(`${first.name} ne .* par kar diya`))).toBeVisible();
    await expect(
      b.page.getByRole('alert').filter({ hasText: hi['error.ALREADY_DECIDED'] }),
    ).toHaveCount(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).confirmedById).toBe(
      first.id,
    );
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('Badal kar pakka karo shows the exact message and the new amount', async ({ browser }) => {
  test.setTimeout(90000);
  const owner = await staff('OWNER');
  const order = await customerOrder(5);
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    const card = cardOf(page, order.customerName);
    await card.getByRole('button', { name: hi['owner.pakka.change'] }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: /badhao$/ }).click();
    const rate = sheet.getByRole('textbox', { name: hi['owner.change.rate'] });
    await rate.fill('300');
    await expect(sheet.getByText(`${order.customerName} ko yeh jayega`)).toBeVisible();
    await expect(sheet.getByText(/kuch badlav ke saath/)).toBeVisible();
    await expect(sheet.getByText(/Ab total ₹/)).toBeVisible();
    // A half-typed rate does not break anything, and the button waits for it.
    await rate.fill('');
    await expect(sheet.getByRole('button', { name: /mein pakka karo|Pakka karo/ })).toBeDisabled();
    await rate.fill('300');
    await sheet.getByRole('button', { name: /mein pakka karo/ }).click();
    await expect(page.getByRole('button', { name: /^Wapas lo \d+$/ })).toBeVisible();
    const saved = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    expect(saved.items[0]).toMatchObject({ quantity: 6, pricePaise: 30000 });
    expect(saved.items[0]!.listPricePaise).toBeGreaterThan(30000);
  } finally {
    await context.close();
  }
});

test('a manager beyond the cap is told to ask an owner, and cannot confirm it themselves', async ({
  browser,
}) => {
  test.setTimeout(90000);
  await db.location.update({ where: { id: MAIN }, data: { managerRateCapPercent: 5 } });
  const manager = await staff('MANAGER');
  const order = await customerOrder(5);
  const { context, page } = await open(browser);
  try {
    await signIn(page, manager.digits);
    await cardOf(page, order.customerName)
      .getByRole('button', { name: hi['owner.pakka.change'] })
      .click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('textbox', { name: hi['owner.change.rate'] }).fill('1');
    // The way forward is to ask, and only to ask.
    await expect(sheet.getByRole('button', { name: hi['owner.change.askOwner'] })).toBeEnabled();
    await expect(
      sheet.getByRole('button', { name: hi['error.RATE_CAP'], exact: true }),
    ).toBeDisabled();
  } finally {
    await db.location.update({ where: { id: MAIN }, data: { managerRateCapPercent: 0 } });
    await context.close();
  }
});

test('a cashier has no rate field and no udhaar, and an udhaar card is not theirs to confirm', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const cashier = await staff('CASHIER');
  const cash = await customerOrder(5);
  const udhaar = await customerOrder(5);
  await db.payment.update({ where: { orderId: udhaar.id }, data: { method: 'CREDIT' } });
  const { context, page } = await open(browser);
  try {
    await signIn(page, cashier.digits, '/inbox');
    const card = cardOf(page, udhaar.customerName);
    await expect(card).toContainText(hi['owner.pakka.onlyManagers']);
    await expect(pakka(card)).toHaveCount(0);

    await cardOf(page, cash.customerName)
      .getByRole('button', { name: hi['owner.pakka.change'] })
      .click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('textbox', { name: hi['owner.change.rate'] })).toHaveCount(0);
    await expect(sheet.getByRole('textbox', { name: hi['owner.change.delivery'] })).toHaveCount(0);
    await expect(sheet.getByRole('combobox', { name: hi['owner.change.payment'] })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('Nahi ho payega is one tap on a reason, and can be taken back', async ({ browser }) => {
  test.setTimeout(90000);
  const owner = await staff('OWNER');
  const order = await customerOrder(5);
  const before = (
    await db.stockLevel.findFirstOrThrow({
      where: { productId: order.productId, locationId: MAIN },
    })
  ).quantity;
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    await cardOf(page, order.customerName)
      .getByRole('button', { name: hi['owner.pakka.cannot'] })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: hi['owner.refuse.OUT_OF_STOCK'] })
      .click();
    await expect(page.getByText(`${order.customerName} ko bata rahe hain`)).toBeVisible();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'CANCELLED',
    );
    expect(
      (
        await db.stockLevel.findFirstOrThrow({
          where: { productId: order.productId, locationId: MAIN },
        })
      ).quantity,
    ).toBe(before + 5);
    await page.getByRole('button', { name: /^Wapas lo \d+$/ }).click();
    await expect(cardOf(page, order.customerName)).toBeVisible();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'AWAITING_CONFIRMATION',
    );
  } finally {
    await context.close();
  }
});

test('with no internet the buttons are off, and nothing is queued for later', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const owner = await staff('OWNER');
  const order = await customerOrder(5);
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    const card = cardOf(page, order.customerName);
    await expect(pakka(card)).toBeEnabled();
    await context.setOffline(true);
    await expect(page.getByText(hi['owner.offline'])).toBeVisible();
    await expect(pakka(card)).toBeDisabled();
    await context.setOffline(false);
    await expect(pakka(card)).toBeEnabled();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'AWAITING_CONFIRMATION',
    );
  } finally {
    await context.close();
  }
});

test('a double tap confirms only the card it was meant for', async ({ browser }) => {
  test.setTimeout(90000);
  const owner = await staff('OWNER');
  const first = await customerOrder(5);
  const second = await customerOrder(5);
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits, '/inbox');
    const button = pakka(cardOf(page, first.customerName));
    await button.dblclick();
    await expect(page.getByRole('button', { name: /^Wapas lo \d+$/ }).first()).toBeVisible();
    expect((await db.order.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
      'AWAITING_CONFIRMATION',
    );
  } finally {
    await context.close();
  }
});

test('the order page of a waiting order leads to the card, and old status buttons are gone', async ({
  browser,
}) => {
  const owner = await staff('OWNER');
  const order = await customerOrder(5);
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    // Leaving before sign-in finishes would cancel it.
    await expect(
      page.getByRole('navigation', { name: hi['owner.desk'], exact: true }),
    ).toBeVisible();
    await page.goto(`${desk}/orders/${order.id}`);
    await expect(
      page.getByRole('link', { name: new RegExp(hi['owner.pakka.confirm']) }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: hi['owner.startPreparing'] })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
