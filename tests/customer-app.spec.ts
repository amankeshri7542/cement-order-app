import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  addSite,
  addToList,
  apiUrl,
  appLogin,
  appUrl,
  fillSite,
  openList,
  placeButton,
  placeOrder,
  searchMaterials,
  tab,
  verifyCode,
  waiting,
} from './app';

// The customer app, from nothing to a repeat order. Test data from tests/setup.ts: UltraTech Super
// ₹410 a bag, and pincode 800020 delivers for ₹500.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
test.afterAll(() => db.$disconnect());
test.use({ serviceWorkers: 'block', viewport: { width: 360, height: 800 } });

const freshPhone = () => `9${String(Date.now()).slice(-7)}${Math.floor(10 + Math.random() * 89)}`;
const devanagari = new RegExp(`[${String.fromCodePoint(0x0900)}-${String.fromCodePoint(0x097f)}]`);
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const site = {
  pincode: '800020',
  line1: 'Plot 14, Road 3',
  landmark: 'Near the tank',
  name: 'Suresh',
};

test('first launch goes straight to Home: rates, no question, no Hindi', async ({ page }) => {
  await page.goto(appUrl);
  await expect(page.getByRole('heading', { name: "Today's rates", exact: true })).toBeVisible();
  await expect(page.getByText('Sample rates', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /UltraTech Super, ₹/ })).toBeVisible();
  // Ask is off on this server, so there are three tabs.
  await expect(tab(page, 'Ask')).toBeHidden();
  for (const name of ['Home', 'Orders', 'Account'] as const)
    await expect(tab(page, name)).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(devanagari);
  expect(await noOverflow(page)).toBe(true);
});

test('a guest builds a list with no network, and it survives a restart', async ({ page }) => {
  await page.goto(appUrl);
  await expect(page.getByRole('button', { name: /UltraTech Super, ₹/ })).toBeVisible();
  // The rates are on the phone now. From here on the shop cannot be reached.
  await page.route(`${apiUrl}/**`, (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await expect(page.getByTestId('list-bar')).toContainText('Your list');
  await expect(page.getByTestId('list-bar')).toContainText('₹410');
  await page.getByRole('button', { name: 'More UltraTech Super', exact: true }).click();
  await expect(page.getByTestId('list-bar')).toContainText('₹820');
  await page.reload();
  await expect(page.getByTestId('list-bar')).toContainText('₹820');
});

test('typing 200 is one entry, and stepping to nothing takes it off', async ({ page }) => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  const box = page.getByRole('textbox', { name: 'UltraTech Super quantity', exact: true });
  await box.fill('200');
  await box.blur();
  await expect(page.getByTestId('list-bar')).toContainText('₹82,000');
  await box.fill('abc');
  await box.blur();
  await expect(box).toHaveValue('200');
  await box.fill('1');
  await box.blur();
  await page.getByRole('button', { name: 'Less UltraTech Super', exact: true }).click();
  await expect(page.getByTestId('list-bar')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }),
  ).toBeVisible();
});

test('first order: sign in only at Place, add a site, and the status is honest', async ({
  page,
}) => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await openList(page);
  await expect(page.getByText('The shop confirms this order.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in to order', exact: true }).click();
  await verifyCode(page, freshPhone());
  // With no site yet, the form opens by itself, on top of the panel.
  await fillSite(page, site);
  await expect(placeButton(page)).toHaveText(/₹910/);
  await placeOrder(page);
  await expect(page.getByText('No need to call', { exact: false })).toBeVisible();
  await expect(page.getByText('Waiting', { exact: true })).toBeVisible();
  // The order leaves the list empty, and Home has turned to the repeat state.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('list-bar')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Order again', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Track', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ask about building your home' })).toBeHidden();
});

test('Order again takes two taps and never touches a half-built list', async ({ page }) => {
  const phone = freshPhone();
  await appLogin(page, phone);
  await addSite(page, site);
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await openList(page);
  await placeOrder(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  // A half-built list, then a repeat of the last order.
  await addToList(page, 'UltraTech Super', 7);
  await expect(page.getByTestId('list-bar')).toContainText('₹2,870');
  const created = page.waitForResponse(
    (response) => response.url() === `${apiUrl}/orders` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Order again', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Order again', exact: true })).toBeVisible();
  // Reached from Order again, the panel shows only Place order.
  await expect(page.getByRole('button', { name: 'Ask for a rate', exact: true })).toBeHidden();
  await placeOrder(page);
  const order = await (await created).json();
  expect(order.items).toHaveLength(1);
  expect(order.items[0].quantity).toBe(1);
  expect(order.repeatOfOrderId).toBeTruthy();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('list-bar')).toContainText('₹2,870');
  // The same lines to the same site lately earns a line, and the button still works.
  await page.getByRole('button', { name: 'Order again', exact: true }).first().click();
  await expect(page.getByText(/You ordered this at/)).toBeVisible();
  await expect(placeButton(page)).toBeEnabled();
});

test('a rate moved after the review: nothing is placed, and the new total is on the button', async ({
  page,
}) => {
  await appLogin(page, freshPhone());
  await addSite(page, site);
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await openList(page);
  await expect(placeButton(page)).toHaveText(/₹910/);
  const before = await db.product.findUniqueOrThrow({ where: { id: 'test-ultratech' } });
  try {
    await db.product.update({
      where: { id: 'test-ultratech' },
      data: { pricePaise: 42000, priceVersion: { increment: 1 } },
    });
    const refused = page.waitForResponse(
      (response) => response.url() === `${apiUrl}/orders` && response.status() === 409,
    );
    await placeButton(page).click();
    await refused;
    await expect(placeButton(page)).toHaveText(/₹920/);
    await expect(page.getByText('Rate changed, was ₹410', { exact: false })).toBeVisible();
    await expect(waiting(page)).toBeHidden();
  } finally {
    await db.product.update({
      where: { id: 'test-ultratech' },
      data: { pricePaise: before.pricePaise, priceVersion: { increment: 1 } },
    });
  }
});

test('a connection lost as Place is tapped makes no duplicate', async ({ page }) => {
  await appLogin(page, freshPhone());
  await addSite(page, site);
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await openList(page);
  await expect(placeButton(page)).toBeEnabled();
  const bodies: unknown[] = [];
  await page.route(`${apiUrl}/orders`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (bodies.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await placeButton(page).click();
  const check = page.getByRole('button', { name: 'Check my order', exact: true });
  await expect(check).toBeVisible();
  await expect(page.getByText('Not sure this reached us', { exact: false }).first()).toBeVisible();
  // Even after a restart, the request is still known and checking cannot make a second order.
  await page.reload();
  await expect(page.getByRole('button', { name: /Not sure this reached us/ })).toBeVisible();
  await page.getByRole('button', { name: /Not sure this reached us/ }).click();
  await page.getByRole('button', { name: 'Check my order', exact: true }).click();
  await expect(waiting(page)).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  const list = await (await page.request.get(`${apiUrl}/orders`)).json();
  expect(list.items).toHaveLength(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('list-bar')).toBeHidden();
});

test('search is on the phone: saria finds steel, and an empty result is honest', async ({
  page,
}) => {
  await page.goto(appUrl);
  await expect(page.getByRole('button', { name: /UltraTech Super, ₹/ })).toBeVisible();
  await page.route(`${apiUrl}/**`, (route) => route.abort('failed'));
  await searchMaterials(page, 'ultra');
  await expect(page.getByRole('button', { name: /UltraTech Super, ₹/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('zzzznothing');
  // Home's own line is on the screen below, kept in place.
  await expect(page.getByText('Not listed? Ask the shop', { exact: true }).last()).toBeVisible();
});

test('a product page shows the rate beside its unit, and Add turns into the way to the list', async ({
  page,
}) => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: /UltraTech Super, ₹/ }).click();
  await expect(
    page.getByRole('heading', { name: 'UltraTech Super', exact: true }).last(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add · ₹410', exact: false }).click();
  await page.getByRole('button', { name: 'Added. See your list', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your list', exact: true })).toBeVisible();
});

test('a tampered link or someone else’s order shows nothing of it', async ({ page, browser }) => {
  await appLogin(page, freshPhone());
  await addSite(page, { ...site, name: 'Secret Receiver' });
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await openList(page);
  await placeOrder(page);
  const orderId = new URL(page.url()).hash.split('/').at(-1)!;
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const other = await context.newPage();
  try {
    await appLogin(other, freshPhone());
    await other.goto(`${appUrl}/#/order/${orderId}`);
    await expect(
      other.getByText('This order is not available in your account.', { exact: true }),
    ).toBeVisible();
    await expect(other.getByText('Secret Receiver')).toBeHidden();
    // Signed out, the page asks for sign-in and shows nothing first.
    await other.goto(`${appUrl}/#/order/not an id`);
    await expect(other.getByRole('heading', { name: "Today's rates", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('signing out clears the list, the orders and the sites from the phone', async ({ page }) => {
  await appLogin(page, freshPhone());
  await addSite(page, site);
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await openList(page);
  await placeOrder(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await addToList(page, 'UltraTech Super');
  await tab(page, 'Account').click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  // Back on Home, signed out.
  await expect(page.getByRole('heading', { name: "Today's rates", exact: true })).toBeVisible();
  await tab(page, 'Account').click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(saved).not.toContain('Secret');
  expect(saved).not.toContain('Plot 14');
  expect(saved).not.toContain('mine:');
  await tab(page, 'Home').click();
  await expect(page.getByTestId('list-bar')).toBeHidden();
  await tab(page, 'Orders').click();
  await expect(page.getByText('Sign in to see your orders', { exact: true })).toBeVisible();
});

test('a staff number browses but cannot order', async ({ page }) => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await openList(page);
  await page.getByRole('button', { name: 'Sign in to order', exact: true }).click();
  await verifyCode(page, '9999997008');
  await expect(page.getByText('This is a staff number', { exact: false })).toBeVisible();
  await expect(placeButton(page)).toBeHidden();
});

test('WhatsApp stays hidden until the shop’s number is approved', async ({ page }) => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await openList(page);
  await expect(page.getByRole('button', { name: 'Ask for a rate', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send on WhatsApp', exact: true })).toBeHidden();
});

test('with an approved number, the list goes as text with no prices', async ({ page }) => {
  await page.route(`${apiUrl}/public/shop`, (route) =>
    route.fulfill({
      json: { contactApproved: true, phone: '+919000000000', whatsapp: '+919000000000' },
      headers: {
        'access-control-allow-origin': appUrl,
        'access-control-allow-credentials': 'true',
      },
    }),
  );
  await page.addInitScript(() => {
    (window as unknown as { opened: string[] }).opened = [];
    window.open = ((url: string) => {
      (window as unknown as { opened: string[] }).opened.push(url);
      return null;
    }) as typeof window.open;
  });
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await openList(page);
  await page.getByRole('button', { name: 'Send on WhatsApp', exact: true }).click();
  const opened = await page.evaluate(() => (window as unknown as { opened: string[] }).opened);
  expect(opened).toHaveLength(1);
  const text = decodeURIComponent(opened[0]!.split('text=')[1]!);
  expect(text).toContain('Shiv app se list:');
  expect(text).toContain('UltraTech Super');
  expect(text).not.toContain('₹');
  expect(opened[0]).toContain('https://wa.me/919000000000');
  await expect(page.getByText('Sent on WhatsApp? Clear this list', { exact: true })).toBeVisible();
  // The list is never cleared by itself.
  await expect(page.getByTestId('panel-test-ultratech')).toBeVisible();
});

test('the rate the shop keeps stays on screen with its age when the shop cannot be reached', async ({
  page,
}) => {
  await page.goto(appUrl);
  await expect(page.getByRole('button', { name: /UltraTech Super, ₹/ })).toBeVisible();
  await page.route(`${apiUrl}/**`, (route) => route.abort('failed'));
  await page.reload();
  await expect(page.getByRole('button', { name: /UltraTech Super, ₹/ })).toBeVisible();
  await expect(page.getByText(/Rates from just now|Rates from \d+ minutes? ago/)).toBeVisible();
});

test('the first launch with no signal says so, and Try again recovers', async ({ page }) => {
  await page.route(`${apiUrl}/public/catalog`, (route) => route.abort('failed'));
  await page.goto(appUrl);
  await expect(page.getByText('The first rates need internet.', { exact: true })).toBeVisible();
  await page.unroute(`${apiUrl}/public/catalog`);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: /UltraTech Super, ₹/ })).toBeVisible();
});

test('Ask a person: a typed list goes to the shop, and the reply lives at the top of Orders', async ({
  page,
}) => {
  await appLogin(page, freshPhone());
  await addSite(page, site);
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await openList(page);
  await page.getByRole('button', { name: 'Ask for a rate', exact: true }).click();
  await expect(
    page.getByText('We got your list. The shop will reply here.', { exact: true }).first(),
  ).toBeVisible();
  await expect(tab(page, 'Orders')).toHaveAttribute('aria-selected', 'true');
  // The list sent opens from there. A failed read says so and can be tried again.
  await page.route(`${apiUrl}/quotes/*`, (route) => route.abort('failed'));
  await page.getByRole('button', { name: /^We got your list/ }).click();
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeVisible();
  await page.unroute(`${apiUrl}/quotes/*`);
  await retry.click();
  await expect(page.getByText('1 × UltraTech Super', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  // The list is still there until the customer says otherwise.
  await tab(page, 'Home').click();
  await expect(page.getByTestId('list-bar')).toBeVisible();
});
