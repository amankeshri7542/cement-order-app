import { createHash, randomBytes, randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import type { BrowserContext, Page, Request } from '@playwright/test';
import { allShopRoles, type StaffRole } from '@shiv/shared';
import { hinglish, type MessageKey } from '@shiv/i18n';
import { test, expect, deskLanguage } from './fixtures';

// Plan v4 B4b: the top bar's search finds customers, orders and goods from the server, each group
// only for those who may read it, and every list page sends the shop or firm chosen in the top bar.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const MAIN = 'loc_main';
const FIRM_TWO = 'b4b_firm_two';
const SHOP_TWO = 'b4b_shop_two';
const CUSTOMER = 'b4b-customer';
const PRODUCT = 'b4b-product';
const ORDER_NUMBER = 'SC-B4B-80427';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const say = (key: MessageKey) => hinglish[key];
const tokens = new Map<StaffRole, string>();
let orderId = '';
test.use({ actionTimeout: 15000 });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const main = await db.location.findUniqueOrThrow({ where: { id: MAIN } });
  await db.firm.upsert({
    where: { id: FIRM_TWO },
    update: { active: true },
    create: { id: FIRM_TWO, legalName: 'B4b Doosri Firm (test)', tradeName: 'B4b Doosri Firm' },
  });
  await db.location.upsert({
    where: { id: SHOP_TWO },
    update: { active: true, firmId: FIRM_TWO },
    create: {
      id: SHOP_TWO,
      name: 'B4b doosri firm ki dukaan',
      slug: 'b4b-doosri-firm',
      firmId: FIRM_TWO,
      kind: 'SHOP',
    },
  });
  let n = 0;
  for (const role of ['OWNER', 'MANAGER', 'STOCK_KEEPER'] as const) {
    const id = `b4b-${role.toLowerCase()}`;
    await db.user.upsert({
      where: { id },
      update: { preferences: {}, language: 'hinglish' },
      create: {
        id,
        phone: `+9191000009${String(n++).padStart(2, '0')}`,
        name: `Search ${role}`,
        role: 'ADMIN',
        language: 'hinglish',
      },
    });
    await db.staffMembership.deleteMany({ where: { userId: id } });
    await db.staffMembership.create({
      data: {
        userId: id,
        role,
        locationId: allShopRoles.includes(role) ? null : MAIN,
        grantedById: 'fixture',
      },
    });
    await db.session.deleteMany({ where: { userId: id } });
    const token = randomBytes(32).toString('base64url').slice(0, 43);
    await db.session.create({
      data: {
        userId: id,
        surface: 'DESK',
        accessHash: hash(token),
        refreshHash: hash(`${token}-refresh`),
        expiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 86400000),
      },
    });
    tokens.set(role, token);
  }
  await db.user.upsert({
    where: { id: CUSTOMER },
    update: { name: 'Kalpnath Searchwala', area: 'Danapur', deletedAt: null },
    create: {
      id: CUSTOMER,
      phone: '+919191000990',
      name: 'Kalpnath Searchwala',
      area: 'Danapur',
    },
  });
  const category = await db.category.upsert({
    where: { slug: 'cement' },
    update: {},
    create: { name: 'Cement', slug: 'cement' },
  });
  await db.product.upsert({
    where: { id: PRODUCT },
    update: { active: true, name: 'Zelkova Cement PPC' },
    create: {
      id: PRODUCT,
      name: 'Zelkova Cement PPC',
      brand: 'Zelkova',
      categoryId: category.id,
      type: 'Cement',
      grade: 'PPC',
      unit: 'bag',
      pricePaise: 40000,
      description: 'Search test',
      recommendedUse: 'Search test',
      images: [],
    },
  });
  await db.stockLevel.upsert({
    where: { productId_locationId: { productId: PRODUCT, locationId: MAIN } },
    update: { quantity: 42, lowStockAt: 10 },
    create: { productId: PRODUCT, locationId: MAIN, quantity: 42, lowStockAt: 10 },
  });
  await db.payment.deleteMany({ where: { order: { number: ORDER_NUMBER } } });
  await db.order.deleteMany({ where: { number: ORDER_NUMBER } });
  orderId = (
    await db.order.create({
      data: {
        firmId: main.firmId,
        number: ORDER_NUMBER,
        userId: CUSTOMER,
        idempotencyKey: randomUUID(),
        status: 'CONFIRMED',
        source: 'PHONE',
        address: {
          name: 'Kalpnath Searchwala',
          phone: '+919191000990',
          area: 'Danapur',
          line1: 'Gali 4',
        },
        deliveryDate: '2026-11-08',
        notes: '',
        subtotalPaise: 400000,
        deliveryFeePaise: 0,
        totalPaise: 400000,
        locationId: MAIN,
        // Every real order has its payment row and an address, as order creation makes them.
        payment: { create: { method: 'COD', amountPaise: 400000 } },
      },
    })
  ).id;
});
test.afterAll(async () => {
  await db.payment.deleteMany({ where: { order: { number: ORDER_NUMBER } } });
  await db.order.deleteMany({ where: { number: ORDER_NUMBER } });
  await db.product.updateMany({ where: { id: PRODUCT }, data: { active: false } });
  await db.location.updateMany({ where: { id: SHOP_TWO }, data: { active: false } });
  await db.firm.updateMany({ where: { id: FIRM_TWO }, data: { active: false } });
  await db.$disconnect();
});

async function as(context: BrowserContext, role: StaffRole) {
  await deskLanguage(context, 'hinglish');
  await context.addCookies([
    { name: 'shiv_access', value: tokens.get(role)!, domain: 'localhost', path: '/api/v1' },
  ]);
}
const searchBox = (page: Page) =>
  page.getByRole('combobox', { name: say('owner.shell.searchLabel') });
const group = (page: Page, key: MessageKey) => page.getByRole('group', { name: say(key) });
/** The search box at this width: the top bar's on a laptop, the Menu's on a phone or tablet. */
async function openSearch(page: Page, width: number) {
  await page.goto(`${desk}${width >= 1024 ? '/today' : '/more'}`);
  return width >= 1024
    ? searchBox(page)
    : page.getByRole('main').getByRole('combobox', {
        name: say('owner.shell.searchLabel'),
      });
}

test('four letters find a customer, an order and goods, and each opens its page', async ({
  context,
  page,
}) => {
  await as(context, 'OWNER');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${desk}/today`);
  const box = searchBox(page);
  await box.fill('kalp');
  const customers = group(page, 'owner.shell.searchCustomers');
  await expect(customers.getByRole('option', { name: /Kalpnath Searchwala/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/customers/${CUSTOMER}$`));

  await searchBox(page).fill('0427');
  const orders = group(page, 'owner.shell.searchOrders');
  await orders.getByRole('option', { name: new RegExp(ORDER_NUMBER) }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
  // The development server builds a page the first time it opens.
  await page.waitForLoadState('load', { timeout: 60000 });

  await searchBox(page).fill('zelk');
  const goods = group(page, 'owner.shell.searchGoods');
  const product = goods.getByRole('option', { name: /Zelkova Cement PPC/ });
  await expect(product).toContainText('42');
  await product.click();
  await expect(page).toHaveURL(new RegExp(`/stock\\?product=${PRODUCT}$`));
  await expect(page.getByText(say('owner.stockPage.onlyOne'))).toBeVisible();
  await expect(page.locator('#owner-main').getByText('Zelkova Cement PPC').first()).toBeVisible();
  await page.getByRole('link', { name: say('owner.stockPage.showAll') }).click();
  await expect(page).toHaveURL(/\/stock$/);

  // With the box empty, what was opened from it comes back, newest first.
  await searchBox(page).click();
  const recent = group(page, 'owner.shell.searchRecent');
  await expect(recent.getByRole('option')).toHaveCount(3);
  await expect(recent.getByRole('option').first()).toContainText('Zelkova Cement PPC');
  await expect(recent).not.toContainText('+91');
});

test('on a phone the Menu’s box finds them too, under the box, and pages filter below', async ({
  context,
  page,
}) => {
  await as(context, 'OWNER');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${desk}/more`);
  const box = page
    .getByRole('main')
    .getByRole('combobox', { name: say('owner.shell.searchLabel') });
  await box.fill('kalp');
  const customer = group(page, 'owner.shell.searchCustomers').getByRole('option', {
    name: /Kalpnath Searchwala/,
  });
  await expect(customer).toBeVisible();
  // Nothing floats over the page: the results push it down.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await box.fill('gall');
  await expect(page.getByRole('main').getByRole('navigation').getByRole('link')).toHaveText([
    /Galla/,
  ]);
  await box.fill('kalp');
  await customer.tap().catch(() => customer.click());
  await expect(page).toHaveURL(new RegExp(`/customers/${CUSTOMER}$`));
});

test('a misspelt brand and a size said in words still find the goods', async ({
  context,
  page,
}) => {
  await as(context, 'OWNER');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${desk}/today`);
  await searchBox(page).fill('zelkoa ppc');
  await expect(
    group(page, 'owner.shell.searchGoods').getByRole('option', { name: /Zelkova/ }),
  ).toBeVisible();
});

test('a stock keeper finds goods and never a customer', async ({ context, page }) => {
  await as(context, 'STOCK_KEEPER');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${desk}/stock`);
  await searchBox(page).fill('Kalpnath');
  await expect(
    page.getByRole('status').filter({ hasText: say('owner.shell.searchLoading') }),
  ).toHaveCount(0);
  await expect(group(page, 'owner.shell.searchCustomers')).toHaveCount(0);
  await expect(page.getByRole('listbox')).not.toContainText('Kalpnath');
  await searchBox(page).fill('zelk');
  await expect(
    group(page, 'owner.shell.searchGoods').getByRole('option', { name: /Zelkova/ }),
  ).toBeVisible();
});

test('when the server cannot be reached, pages and actions still show', async ({
  context,
  page,
}) => {
  await as(context, 'OWNER');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/admin/search?**', (route) => route.abort());
  await page.goto(`${desk}/today`);
  await searchBox(page).fill('galla');
  await expect(page.getByText(say('owner.shell.searchFailed'))).toBeVisible();
  await expect(
    group(page, 'owner.shell.searchPages').getByRole('option', { name: /Galla/ }),
  ).toBeVisible();
});

// Plan v4, 02 section 3: a test that each list page passes the scope to the API. The pages here
// are those whose API takes it today; the others keep their own shop choice until their rebuild
// (named in the B4b report with their phase).
const listPages: { path: string; api: RegExp; shop: string | null; firm: boolean }[] = [
  { path: '/today', api: /\/admin\/dashboard/, shop: 'locationId', firm: true },
  { path: '/reports', api: /\/admin\/reports\/money/, shop: 'locationId', firm: true },
  { path: '/orders', api: /\/admin\/orders\?/, shop: 'locationId', firm: true },
  // Customers belong to firms: a chosen shop stands for its firm.
  { path: '/customers', api: /\/admin\/customers\?/, shop: 'firmId', firm: true },
  { path: '/inbox', api: /\/admin\/inbox/, shop: 'locationId', firm: false },
  { path: '/calls', api: /\/admin\/followups/, shop: 'locationId', firm: false },
  { path: '/galla', api: /\/admin\/galla\?/, shop: 'locationId', firm: false },
];

test('each list page sends the shop or firm chosen in the top bar', async ({ context, page }) => {
  await as(context, 'OWNER');
  await page.setViewportSize({ width: 1440, height: 900 });
  const asked: string[] = [];
  page.on('request', (request: Request) => {
    if (request.url().includes('/api/v1/admin/')) asked.push(decodeURIComponent(request.url()));
  });
  for (const [scope, label] of [
    [`shop:${SHOP_TWO}`, 'a shop'],
    [`firm:${FIRM_TWO}`, 'a firm'],
  ] as const) {
    await page.goto(`${desk}/today`);
    await page.evaluate((value) => localStorage.setItem('shiv-desk-scope', value), scope);
    for (const list of listPages) {
      if (scope.startsWith('firm') && !list.firm) continue;
      asked.length = 0;
      await page.goto(`${desk}${list.path}`);
      const wanted =
        scope.startsWith('firm') || list.shop === 'firmId'
          ? `firmId=${FIRM_TWO}`
          : `locationId=${SHOP_TWO}`;
      await expect
        .poll(() => asked.some((url) => list.api.test(url) && url.includes(wanted)), {
          message: `${list.path} with ${label}: ${asked.filter((url) => list.api.test(url)).join(' ')}`,
        })
        .toBe(true);
    }
  }
  // The search sends it too.
  await page.evaluate(
    (value) => localStorage.setItem('shiv-desk-scope', value),
    `shop:${SHOP_TWO}`,
  );
  await page.goto(`${desk}/today`);
  asked.length = 0;
  await searchBox(page).fill('zelk');
  await expect
    .poll(() =>
      asked.some((url) => url.includes('/admin/search?') && url.includes(`locationId=${SHOP_TWO}`)),
    )
    .toBe(true);
  await page.evaluate(() => localStorage.removeItem('shiv-desk-scope'));
});

test('a manager’s tampered scope for another shop never reaches the server', async ({
  context,
  page,
}) => {
  await as(context, 'MANAGER');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${desk}/today`);
  const asked: string[] = [];
  page.on('request', (request: Request) => {
    if (request.url().includes('/api/v1/admin/')) asked.push(request.url());
  });
  await page.evaluate(
    (value) => localStorage.setItem('shiv-desk-scope', value),
    `shop:${SHOP_TWO}`,
  );
  await page.goto(`${desk}/orders`);
  await expect.poll(() => asked.some((url) => url.includes('/admin/orders?'))).toBe(true);
  await searchBox(page).fill('zelk');
  await expect.poll(() => asked.some((url) => url.includes('/admin/search?'))).toBe(true);
  expect(asked.filter((url) => url.includes(SHOP_TWO))).toEqual([]);
});

for (const theme of ['light', 'dark'] as const)
  test(`the open search passes axe in ${theme}, on a laptop and a phone`, async ({
    context,
    page,
  }) => {
    await as(context, 'OWNER');
    await page.emulateMedia({ colorScheme: theme });
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await (await openSearch(page, width)).fill('kalp');
      await expect(group(page, 'owner.shell.searchCustomers')).toBeVisible();
      const result = await new AxeBuilder({ page }).include('[role="search"]').analyze();
      expect(
        result.violations.map((v) => `${v.id}: ${v.nodes.length}`),
        `${width}`,
      ).toEqual([]);
    }
  });

test('the open search fits every size from 320 to 2560 px, and at 200% text', async ({
  context,
  page,
}) => {
  await as(context, 'OWNER');
  for (const [width, height] of [
    [320, 640],
    [360, 640],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1440, 900],
    [2560, 1440],
    [844, 390],
  ] as const) {
    await page.setViewportSize({ width, height });
    await (await openSearch(page, width)).fill('zelk');
    await expect(group(page, 'owner.shell.searchGoods')).toBeVisible();
    const problems = await page.evaluate(() => {
      const found: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth + 1)
        found.push(`sideways ${document.documentElement.scrollWidth}`);
      const list = document.querySelector('[role="listbox"]')?.parentElement;
      const box = list?.getBoundingClientRect();
      if (box && (box.left < -1 || box.right > window.innerWidth + 1))
        found.push(`list ${Math.round(box.left)}–${Math.round(box.right)}`);
      for (const option of document.querySelectorAll<HTMLElement>('[role="option"]')) {
        const row = option.getBoundingClientRect();
        if (row.height < 47.5) found.push(`short ${option.textContent} ${row.height}`);
      }
      return found;
    });
    expect(problems, `${width}×${height}`).toEqual([]);
  }
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const box = await openSearch(page, width);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await box.fill('zelk');
    await expect(group(page, 'owner.shell.searchGoods')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      `${width} at 200%`,
    ).toBeLessThanOrEqual(1);
  }
});
