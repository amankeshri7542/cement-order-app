import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Browser, Page } from '@playwright/test';
import { hi } from '@shiv/i18n';
import type { StaffRole } from '@shiv/shared';
import { test, expect } from './fixtures';

// Daam aur offer, stock between shops, Manzoori and Galla, walked through as each role.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const MAIN = 'loc_main';
const SECOND = 'loc_p4_b';
let counter = 0;
const freshPhone = () => `7${String(Date.now()).slice(-8)}${counter++ % 10}`;
test.use({ serviceWorkers: 'block' });
test.setTimeout(90000);
test.beforeAll(async () => {
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true, stockStartedAt: null },
    create: { id: SECOND, firmId: 'firm_main', slug: 'p4-b', name: 'P4 doosri dukaan' },
  });
});
test.afterAll(async () => {
  await db.location.update({ where: { id: SECOND }, data: { active: false } });
  await db.$disconnect();
});

async function staff(role: StaffRole, shops: string[] = [MAIN]) {
  const digits = freshPhone();
  const user = await db.user.create({
    data: { phone: `+91${digits}`, name: `Test ${role} ${digits.slice(-4)}`, role: 'ADMIN' },
  });
  const allShops = ['OWNER', 'ACCOUNTANT', 'TECH_OPERATOR'].includes(role);
  await db.staffMembership.createMany({
    data: (allShops ? [null] : shops).map((locationId) => ({
      userId: user.id,
      role,
      locationId,
      grantedById: 'browser-fixture',
    })),
  });
  return digits;
}
async function signedIn(browser: Browser, role: StaffRole, shops?: string[], width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'hi'));
  await page.goto(`${desk}/more`);
  await page.getByRole('textbox', { name: hi['owner.loginPhone'] }).fill(await staff(role, shops));
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: hi['owner.sendCode'] }).click();
  await page
    .getByRole('textbox', { name: hi['owner.code'], exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: hi['owner.signIn'] }).click();
  await expect(page.getByRole('navigation', { name: hi['owner.desk'], exact: true })).toBeVisible();
  return { context, page };
}
async function product(name = `P4 cement ${randomUUID().slice(0, 6)}`, stock = 100) {
  const category = await db.category.upsert({
    where: { slug: 'p4-cat' },
    update: {},
    create: { name: 'P4 Cement', slug: 'p4-cat' },
  });
  const row = await db.product.create({
    data: {
      name,
      brand: 'P4',
      categoryId: category.id,
      type: 'PPC',
      grade: 'PPC',
      unit: 'bag',
      pricePaise: 40000,
      stock,
      minQuantity: 1,
      description: 'Test',
      recommendedUse: 'Test',
      images: [],
    },
  });
  return row;
}
const go = (page: Page, path: string) => page.goto(`${desk}${path}`);

test('an owner changes a whole group of rates on one screen, and a big jump asks first', async ({
  browser,
}) => {
  const item = await product();
  const { context, page } = await signedIn(browser, 'OWNER');
  try {
    await go(page, '/rates');
    await expect(
      page.getByRole('heading', { name: hi['owner.rates.title'], exact: true }),
    ).toBeVisible();
    const row = page.getByRole('textbox', {
      name: hi['owner.rates.rateFor'].replace('{name}', item.name),
      exact: true,
    });
    await expect(row).toHaveValue('400');
    await row.fill('395');
    await expect(page.getByText('-₹5.00, pehle ₹400.00')).toBeVisible();
    await page.getByRole('button', { name: hi['owner.rates.publish'], exact: true }).click();
    await expect(page.getByText(hi['owner.rates.published'], { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        db.product.findUniqueOrThrow({ where: { id: item.id } }).then((p) => p.pricePaise),
      )
      .toBe(39500);
    await row.fill('3950');
    await expect(page.getByText(hi['owner.rates.bigRow'], { exact: true })).toBeVisible();
    await page.getByRole('button', { name: hi['owner.rates.publish'], exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: hi['owner.keepEditing'], exact: true })
      .click();
    expect((await db.product.findUniqueOrThrow({ where: { id: item.id } })).pricePaise).toBe(39500);
  } finally {
    await context.close();
  }
});

test('a manager asks for new rates, and an owner’s yes makes them live', async ({ browser }) => {
  const item = await product();
  const manager = await signedIn(browser, 'MANAGER');
  const owner = await signedIn(browser, 'OWNER');
  try {
    await go(manager.page, '/rates');
    await manager.page
      .getByRole('textbox', {
        name: hi['owner.rates.rateFor'].replace('{name}', item.name),
        exact: true,
      })
      .fill('410');
    await expect(
      manager.page.getByRole('button', { name: hi['owner.rates.publish'], exact: true }),
    ).toHaveCount(0);
    await manager.page
      .getByRole('button', { name: hi['owner.rates.askOwner'], exact: true })
      .click();
    await expect(manager.page.getByText(hi['owner.rates.asked'], { exact: true })).toBeVisible();
    expect((await db.product.findUniqueOrThrow({ where: { id: item.id } })).pricePaise).toBe(40000);
    await go(owner.page, '/manzoori');
    const card = owner.page
      .locator('article')
      .filter({ hasText: hi['owner.approval.kind.RATE_CHANGE'] })
      .filter({ hasText: item.name })
      .first();
    // The owner reads what they are agreeing to: the item, from and to.
    await expect(
      card.getByText(
        hi['owner.manzoori.rateLine']
          .replace('{name}', item.name)
          .replace('{from}', '₹400.00')
          .replace('{to}', '₹410.00'),
      ),
    ).toBeVisible();
    await expect(card.getByText(hi['owner.manzoori.rateBig'])).toHaveCount(0);
    await card.getByRole('button', { name: hi['owner.manzoori.approve'], exact: true }).click();
    await expect
      .poll(() =>
        db.product.findUniqueOrThrow({ where: { id: item.id } }).then((p) => p.pricePaise),
      )
      .toBe(41000);
  } finally {
    await manager.context.close();
    await owner.context.close();
  }
});

test('a slipped digit in a rate request is called out to the owner before any yes', async ({
  browser,
}) => {
  const item = await product();
  const manager = await signedIn(browser, 'MANAGER');
  const owner = await signedIn(browser, 'OWNER');
  try {
    await go(manager.page, '/rates');
    await manager.page
      .getByRole('textbox', {
        name: hi['owner.rates.rateFor'].replace('{name}', item.name),
        exact: true,
      })
      .fill('4');
    await manager.page
      .getByRole('button', { name: hi['owner.rates.askOwner'], exact: true })
      .click();
    await expect(manager.page.getByText(hi['owner.rates.asked'], { exact: true })).toBeVisible();
    await go(owner.page, '/manzoori');
    const card = owner.page
      .locator('article')
      .filter({ hasText: hi['owner.approval.kind.RATE_CHANGE'] })
      .filter({ hasText: item.name })
      .first();
    await expect(
      card.getByText(
        hi['owner.manzoori.rateLine']
          .replace('{name}', item.name)
          .replace('{from}', '₹400.00')
          .replace('{to}', '₹4.00'),
      ),
    ).toBeVisible();
    await expect(card.getByText(hi['owner.manzoori.rateBig'])).toBeVisible();
    await card.getByRole('button', { name: hi['owner.manzoori.reject'], exact: true }).click();
    await expect(
      card.getByRole('button', { name: hi['owner.manzoori.approve'], exact: true }),
    ).toHaveCount(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: item.id } })).pricePaise).toBe(40000);
  } finally {
    await manager.context.close();
    await owner.context.close();
  }
});

test('typing "5%" as a person’s limit is refused on the spot, and clears nothing', async ({
  browser,
}) => {
  await signedIn(browser, 'MANAGER').then(({ context }) => context.close());
  const { context, page } = await signedIn(browser, 'OWNER');
  try {
    await go(page, '/rates');
    await page.getByRole('tab', { name: hi['owner.rates.tab.limits'], exact: true }).click();
    const box = page
      .getByRole('textbox', { name: /percent \(khaali matlab dukaan ki seema\)/ })
      .first();
    await box.fill('5%');
    await expect(page.getByText(hi['owner.rates.personLimitBad']).first()).toBeVisible();
    await box.fill('5');
    await expect(page.getByText(hi['owner.rates.personLimitBad'])).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a cashier reads rates and cannot change them, and the rules tabs are the owners’', async ({
  browser,
}) => {
  await product();
  const { context, page } = await signedIn(browser, 'CASHIER');
  try {
    await go(page, '/rates');
    await expect(
      page.getByRole('heading', { name: hi['owner.rates.title'], exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: hi['owner.rates.same'], exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('tab', { name: hi['owner.rates.tab.offers'], exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('an owner makes a slab, and a customer group with a rate', async ({ browser }) => {
  const item = await product();
  const { context, page } = await signedIn(browser, 'OWNER');
  const group = `Regular ${randomUUID().slice(0, 4)}`;
  try {
    await go(page, '/rates');
    await page.getByRole('tab', { name: hi['owner.rates.tab.slabs'], exact: true }).click();
    await page.getByRole('button', { name: hi['owner.rates.add.SLAB'], exact: true }).click();
    const sheet = page.getByRole('dialog', { name: hi['owner.rates.add.SLAB'], exact: true });
    await sheet
      .getByRole('combobox', { name: hi['owner.rates.onWhat'], exact: true })
      .selectOption({ label: item.name });
    await sheet.getByRole('textbox', { name: hi['owner.rates.rupees'], exact: true }).fill('390');
    await sheet.getByRole('button', { name: hi['owner.save'], exact: true }).click();
    await expect(page.locator('article').filter({ hasText: item.name })).toBeVisible();
    await expect
      .poll(() =>
        db.priceRule.count({
          where: { productId: item.id, kind: 'SLAB', minQuantity: 100, value: 39000 },
        }),
      )
      .toBe(1);
    await page.getByRole('tab', { name: hi['owner.rates.tab.customers'], exact: true }).click();
    await page.getByRole('textbox', { name: hi['owner.rates.newGroup'], exact: true }).fill(group);
    await page.getByRole('button', { name: hi['owner.rates.addGroup'], exact: true }).click();
    await expect(page.getByText(new RegExp(group))).toBeVisible();
  } finally {
    await context.close();
  }
});

test('a transfer leaves one shop, shows on the road, and a shortage reaches an owner', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const item = await product();
  await db.stockLevel.upsert({
    where: { productId_locationId: { productId: item.id, locationId: MAIN } },
    update: { quantity: 100 },
    create: { productId: item.id, locationId: MAIN, quantity: 100 },
  });
  const keeper = await signedIn(browser, 'STOCK_KEEPER', [MAIN]);
  const other = await signedIn(browser, 'STOCK_KEEPER', [SECOND]);
  const owner = await signedIn(browser, 'OWNER');
  try {
    await go(keeper.page, '/stock');
    await keeper.page
      .getByRole('tab', { name: hi['owner.stockPage.tab.transfer'], exact: true })
      .click();
    await keeper.page
      .getByRole('button', { name: hi['owner.stockPage.send'], exact: true })
      .click();
    const sheet = keeper.page.getByRole('dialog', {
      name: hi['owner.stockPage.send'],
      exact: true,
    });
    await sheet
      .getByRole('combobox', { name: hi['owner.stockPage.toShop'], exact: true })
      .selectOption({ label: 'P4 doosri dukaan' });
    await sheet.getByRole('textbox', { name: item.name, exact: true }).fill('50');
    await sheet.getByRole('button', { name: hi['owner.stockPage.sendGo'], exact: true }).click();
    await expect
      .poll(() =>
        db.stockLevel
          .findUniqueOrThrow({
            where: { productId_locationId: { productId: item.id, locationId: MAIN } },
          })
          .then((row) => row.quantity),
      )
      .toBe(50);
    await go(other.page, '/stock');
    await other.page
      .getByRole('tab', { name: hi['owner.stockPage.tab.transfer'], exact: true })
      .click();
    const card = other.page.locator('article').filter({ hasText: item.name }).first();
    await card.getByRole('button', { name: hi['owner.stockPage.arrived'], exact: true }).click();
    const arrived = other.page.getByRole('dialog', {
      name: hi['owner.stockPage.arrived'],
      exact: true,
    });
    await arrived.getByRole('textbox', { name: item.name, exact: true }).fill('48');
    await arrived
      .getByRole('button', { name: hi['owner.stockPage.arrivedGo'], exact: true })
      .click();
    await expect(
      card.getByText(
        hi['owner.stockPage.shortLine'].replace('{received}', '48').replace('{sent}', '50'),
      ),
    ).toBeVisible();
    await go(owner.page, '/manzoori');
    await expect(
      owner.page
        .locator('article')
        .filter({ hasText: hi['owner.approval.kind.TRANSFER_SHORTAGE'] })
        .first(),
    ).toBeVisible();
  } finally {
    await keeper.context.close();
    await other.context.close();
    await owner.context.close();
    await db.approvalRequest.updateMany({
      where: { kind: 'TRANSFER_SHORTAGE', status: 'PENDING' },
      data: { status: 'REJECTED' },
    });
  }
});

test('a blind count shows no figures to the person counting, and only an owner writes the difference', async ({
  browser,
}) => {
  const count = await db.stockCount.findMany({
    where: { locationId: SECOND, status: { in: ['OPEN', 'SUBMITTED'] } },
  });
  for (const row of count)
    await db.stockCount.update({ where: { id: row.id }, data: { status: 'RECOUNT' } });
  const keeper = await signedIn(browser, 'STOCK_KEEPER', [SECOND]);
  const owner = await signedIn(browser, 'OWNER');
  try {
    await go(keeper.page, '/stock');
    await keeper.page
      .getByRole('tab', { name: hi['owner.stockPage.tab.count'], exact: true })
      .click();
    await keeper.page
      .getByRole('button', { name: hi['owner.stockPage.startOpening'], exact: true })
      .click();
    await expect(keeper.page.getByText(hi['owner.stockPage.countWhatYouCounted'])).toBeVisible();
    const started = await db.stockCount.findFirstOrThrow({
      where: { locationId: SECOND, status: 'OPEN' },
      include: { lines: true },
    });
    expect(started.opening).toBe(true);
    await expect(keeper.page.getByText(hi['owner.manzoori.system'], { exact: true })).toHaveCount(
      0,
    );
    const boxes = keeper.page.getByRole('textbox');
    const total = await boxes.count();
    for (let i = 0; i < total; i++) {
      await boxes.nth(i).fill('0');
      await boxes.nth(i).blur();
    }
    await expect
      .poll(() => db.stockCountLine.count({ where: { countId: started.id, countedQty: null } }))
      .toBe(0);
    await keeper.page
      .getByRole('button', { name: hi['owner.stockPage.countSend'], exact: true })
      .click();
    await expect(keeper.page.getByText(hi['owner.stockPage.countWaiting'])).toBeVisible();
    await go(owner.page, '/manzoori');
    const card = owner.page
      .locator('article')
      .filter({ hasText: hi['owner.manzoori.opening'] })
      .first();
    await card.getByRole('button', { name: hi['owner.manzoori.approve'], exact: true }).click();
    await expect
      .poll(() =>
        db.location.findUniqueOrThrow({ where: { id: SECOND } }).then((row) => row.stockStartedAt),
      )
      .not.toBeNull();
  } finally {
    await keeper.context.close();
    await owner.context.close();
  }
});

test('Galla: a short drawer needs a reason, and the owner sees it', async ({ browser }) => {
  // A close can never be removed, so each run needs a drawer that has not closed today.
  const tag = Date.now().toString(36);
  const shop = await db.location.create({
    data: {
      id: `loc_p4_g_${tag}`,
      firmId: 'firm_main',
      slug: `p4-g-${tag}`,
      name: 'P4 galla dukaan',
    },
  });
  const cashier = await signedIn(browser, 'CASHIER', [shop.id]);
  try {
    await go(cashier.page, '/galla');
    await expect(
      cashier.page.getByRole('heading', { name: hi['owner.galla.title'], exact: true }),
    ).toBeVisible();
    await cashier.page
      .getByRole('button', { name: hi['owner.galla.addPaidIn'], exact: true })
      .click();
    const sheet = cashier.page.getByRole('dialog', {
      name: hi['owner.galla.addPaidIn'],
      exact: true,
    });
    await sheet.getByRole('textbox', { name: hi['owner.galla.amount'], exact: true }).fill('1000');
    await sheet
      .getByRole('textbox', { name: hi['owner.galla.reason'], exact: true })
      .fill('Subah ka khulla');
    await sheet.getByRole('button', { name: hi['owner.save'], exact: true }).click();
    await expect(cashier.page.getByText('Subah ka khulla')).toBeVisible();
    await cashier.page
      .getByRole('textbox', { name: hi['owner.galla.howMuch'], exact: true })
      .fill('700');
    await expect(cashier.page.getByText(/₹300.00 kam hai/)).toBeVisible();
    await cashier.page
      .getByRole('textbox', { name: hi['owner.galla.reason'], exact: true })
      .fill('Note fat gaya');
    await cashier.page.getByRole('button', { name: hi['owner.galla.close'], exact: true }).click();
    await expect(cashier.page.getByText(/Note fat gaya/)).toBeVisible();
    const rows = await db.dayClose.findMany({ where: { locationId: shop.id } });
    expect(rows[0]).toMatchObject({
      expectedPaise: 100000,
      countedPaise: 70000,
      differencePaise: -30000,
    });
  } finally {
    await cashier.context.close();
    await db.location.update({ where: { id: shop.id }, data: { active: false } });
  }
});

test('a laptop gets a side bar and no tabs at the bottom; a phone gets five tabs', async ({
  browser,
}) => {
  const laptop = await signedIn(browser, 'OWNER', undefined, 1440);
  const phone = await signedIn(browser, 'OWNER', undefined, 390);
  try {
    const nav = (page: Page) =>
      page.getByRole('navigation', { name: hi['owner.desk'], exact: true });
    await expect(
      nav(laptop.page).getByRole('link', { name: hi['owner.rates.nav'], exact: true }),
    ).toBeVisible();
    const box = await nav(laptop.page).boundingBox();
    expect(box!.x).toBe(0);
    expect(box!.width).toBeLessThan(300);
    expect(box!.height).toBeGreaterThan(600);
    await expect(
      nav(phone.page).getByRole('link', { name: hi['owner.rates.nav'], exact: true }),
    ).toBeHidden();
    await expect(nav(phone.page).getByRole('link')).toHaveCount(
      await nav(phone.page).locator('a:visible').count(),
    );
    expect(await nav(phone.page).locator('a:visible').count()).toBe(5);
    // A typed address outside someone's job shows the polite page.
    const cashier = await signedIn(browser, 'CASHIER');
    await go(cashier.page, '/manzoori');
    await expect(
      cashier.page.getByRole('heading', { name: hi['owner.manzoori.title'], exact: true }),
    ).toBeVisible();
    await go(cashier.page, '/reports');
    await expect(cashier.page.getByText(hi['owner.notYourPage'])).toBeVisible();
    await cashier.context.close();
  } finally {
    await laptop.context.close();
    await phone.context.close();
  }
});

test('the shop chosen narrows the pages, and is remembered on this device', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'OWNER', undefined, 1440);
  try {
    const switcher = page.getByRole('combobox', { name: hi['owner.shell.shop'], exact: true });
    await switcher.selectOption({ label: 'P4 doosri dukaan' });
    await go(page, '/stock');
    await expect(switcher).toHaveValue(SECOND);
    await expect(
      page.getByRole('columnheader', { name: 'P4 doosri dukaan', exact: true }),
    ).toBeVisible();
    await expect(page.locator('th').filter({ hasText: 'Shiv' })).toHaveCount(0);
    await switcher.selectOption({ label: hi['owner.shell.allShops'] });
  } finally {
    await context.close();
  }
});
