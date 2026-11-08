import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { hinglish } from '@shiv/i18n';
import type { StaffRole } from '@shiv/shared';
import { test, expect, deskLanguage } from './fixtures';
import { grantOwners } from '../apps/api/test/staff-helper';
import { hashPassword } from '../apps/api/src/security';

// User aur access, walked through as each role on the real desk. The API refuses all of this on
// its own (see permissions-matrix.test.ts); these journeys check each person sees only their job.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const api = 'http://localhost:4010/api/v1';
const MAIN = 'loc_main';
let counter = 0;
const freshPhone = () => `9${String(Date.now()).slice(-8)}${counter++ % 10}`;
test.use({ serviceWorkers: 'block' });
// One open shop, as the family has today. A test below opens a second one for itself.
test.beforeAll(() =>
  db.location.updateMany({ where: { id: { not: MAIN } }, data: { active: false } }),
);
test.afterAll(() => db.$disconnect());

/** Someone fresh on the staff list, ready to sign in with a code. */
async function staff(role: StaffRole, shops: string[] = [MAIN]) {
  const phone = freshPhone();
  const user = await db.user.create({
    data: { phone: `+91${phone}`, name: `Test ${role} ${phone.slice(-4)}`, role: 'ADMIN' },
  });
  const allShops = ['OWNER', 'ACCOUNTANT', 'TECH_OPERATOR'].includes(role);
  await db.staffMembership.createMany({
    data: (allShops ? [null] : shops).map((locationId) => ({
      userId: user.id,
      locationId,
      role,
      grantedById: 'browser-fixture',
    })),
  });
  return { ...user, digits: phone };
}
async function open(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await deskLanguage(page.context(), 'hinglish');
  return { context, page };
}
async function signIn(page: Page, digits: string, path = '/today') {
  await page.goto(`${desk}${path}`);
  await page.getByRole('textbox', { name: hinglish['owner.loginPhone'] }).fill(digits);
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: hinglish['owner.sendCode'] }).click();
  await page
    .getByRole('textbox', { name: hinglish['owner.code'], exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: hinglish['owner.signIn'] }).click();
}
const nav = (page: Page) =>
  page.getByRole('navigation', { name: hinglish['owner.desk'], exact: true });
/** A real phone order at the main shop, to look at from other roles. */
async function aPhoneOrder(page: Page) {
  const product = await db.product.findFirstOrThrow({
    where: { active: true, stock: { gt: 5 } },
    orderBy: { createdAt: 'asc' },
  });
  const created = await page.evaluate(
    async ({ api, productId, key, quantity }) => {
      const response = await fetch(`${api}/admin/orders/phone`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerPhone: '+919999990011',
          customerName: 'Grahak Ramesh',
          address: {
            label: 'Site',
            name: 'Grahak Ramesh',
            phone: '+919999990011',
            line1: 'Plot 12',
            area: 'Kankarbagh',
            city: 'Patna',
            state: 'Bihar',
            pincode: '800020',
            landmark: '',
          },
          items: [{ productId, quantity }],
          deliveryDate: 'today',
          paymentMethod: 'COD',
          idempotencyKey: key,
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { api, productId: product.id, key: randomUUID(), quantity: Math.max(product.minQuantity, 1) },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body as { id: string; number: string };
}

test('an owner adds a cashier, previews the role, and the cashier sees only their job', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const { context, page } = await open(browser);
  const phone = freshPhone();
  const name = `Sita ${phone.slice(-4)}`;
  try {
    await signIn(page, owner.digits);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
    ).toBeVisible();
    await nav(page).getByRole('link', { name: hinglish['owner.more'], exact: true }).click();
    await page.getByRole('link', { name: hinglish['owner.people'] }).click();
    await expect(page.getByRole('heading', { name: hinglish['owner.people'] })).toBeVisible();
    // Your own row says it is you, and offers no way to change your own access.
    const own = page.locator('article', { hasText: owner.name });
    await expect(own).toContainText(hinglish['owner.you']);
    await expect(own.getByRole('button')).toHaveCount(0);

    await page.getByRole('button', { name: hinglish['owner.addPerson'] }).click();
    await page.getByRole('textbox', { name: hinglish['owner.personName'] }).fill(name);
    await page.getByRole('textbox', { name: hinglish['owner.personPhone'] }).fill(phone);
    await page
      .getByRole('combobox', { name: hinglish['owner.personRole'] })
      .selectOption('CASHIER');
    await page.getByText(hinglish['owner.rolePreview']).click();
    await expect(page.getByText(hinglish['owner.can.takeMoney'], { exact: true })).toBeVisible();
    await expect(page.getByText(hinglish['owner.can.refund'], { exact: true })).toBeVisible();
    // The preview says refunds are something a cashier cannot do.
    const cannot = page.locator('ul').nth(1);
    await expect(cannot).toContainText(hinglish['owner.can.refund']);
    await page.getByRole('button', { name: hinglish['owner.save'] }).click();

    // The invite is ready to send, and goes only when the owner taps it.
    await expect(page.getByRole('heading', { name: hinglish['owner.inviteTitle'] })).toBeVisible();
    const send = page.getByRole('link', { name: hinglish['owner.inviteSend'] });
    await expect(send).toHaveAttribute('href', new RegExp(`wa\\.me/91${phone}`));
    await page.getByRole('button', { name: hinglish['owner.close'], exact: true }).last().click();
    await expect(page.locator('article', { hasText: name })).toContainText(
      hinglish['owner.role.CASHIER'],
    );

    const cashier = await open(browser);
    try {
      await signIn(cashier.page, phone);
      await expect(
        cashier.page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
      ).toBeVisible();
      // No udhaar total on Today, and the menu holds no people, reports or rates.
      await expect(cashier.page.getByText(hinglish['owner.totalDue'])).toHaveCount(0);
      await nav(cashier.page)
        .getByRole('link', { name: hinglish['owner.more'], exact: true })
        .click();
      await expect(cashier.page).toHaveURL(`${desk}/more`);
      await expect(
        cashier.page.getByRole('heading', { name: hinglish['owner.more'], exact: true }),
      ).toBeVisible();
      for (const key of [
        'owner.people',
        'owner.reports',
        'owner.activity',
        'owner.rateStudio',
      ] as const)
        await expect(cashier.page.getByRole('link', { name: hinglish[key] })).toHaveCount(0);
      // Typing the address gets a polite page, not the screen.
      await cashier.page.goto(`${desk}/more?view=users`);
      await expect(
        cashier.page.getByRole('heading', { name: hinglish['owner.notYourPage'] }),
      ).toBeVisible();
      await expect(
        cashier.page.getByRole('button', { name: hinglish['owner.addPerson'] }),
      ).toHaveCount(0);
      await cashier.page.goto(`${desk}/khata`);
      await expect(
        cashier.page.getByRole('heading', { name: hinglish['owner.notYourPage'] }),
      ).toBeVisible();

      // The owner pauses them, and their next request sends them back to sign in.
      await page
        .locator('article', { hasText: name })
        .getByRole('button', { name: hinglish['owner.pausePerson'] })
        .click();
      await page
        .getByRole('button', { name: hinglish['owner.pausePerson'], exact: true })
        .last()
        .click();
      await expect(page.locator('article', { hasText: name })).toContainText(
        hinglish['owner.paused'],
      );
      await cashier.page.goto(`${desk}/orders`);
      await expect(
        cashier.page.getByRole('textbox', { name: hinglish['owner.loginPhone'] }),
      ).toBeVisible();

      // Signing in while paused opens nothing. (A new code is normally a minute's wait away.)
      await db.otpChallenge.deleteMany({ where: { phone: `+91${phone}` } });
      await signIn(cashier.page, phone);
      await expect(cashier.page.getByText(hinglish['owner.noDeskAccess'])).toBeVisible();
    } finally {
      await cashier.context.close();
    }
  } finally {
    await context.close();
  }
});

test('a stock keeper starts at stock, sees what to load, and sees no rupee anywhere', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const keeper = await staff('STOCK_KEEPER');
  const ownerSide = await open(browser);
  const { context, page } = await open(browser);
  try {
    await signIn(ownerSide.page, owner.digits);
    await expect(
      ownerSide.page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
    ).toBeVisible();
    const order = await aPhoneOrder(ownerSide.page);

    await signIn(page, keeper.digits);
    await expect(page).toHaveURL(/\/stock/);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.stock'], exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: hinglish['owner.stockReceived'] }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: hinglish['owner.changePrice'] })).toHaveCount(0);
    await expect(page.getByRole('button', { name: hinglish['owner.shareRates'] })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('₹');
    await expect(page.getByRole('link', { name: hinglish['owner.newOrder'] })).toHaveCount(0);

    await page.goto(`${desk}/orders/${order.id}`);
    await expect(page.getByRole('heading', { name: hinglish['owner.toLoad'] })).toBeVisible();
    await expect(page.locator('main')).toContainText('Kankarbagh');
    await expect(page.locator('main')).not.toContainText('₹');
    await expect(page.locator('main')).not.toContainText('Ramesh');
    await expect(page.locator('main')).not.toContainText('9999990011');

    await page.goto(`${desk}/orders`);
    await expect(page.locator('main')).not.toContainText('₹');
    await page.goto(`${desk}/customers`);
    await expect(page.getByRole('heading', { name: hinglish['owner.notYourPage'] })).toBeVisible();
    await page.goto(`${desk}/today`);
    await expect(page).toHaveURL(/\/stock/);
  } finally {
    await context.close();
    await ownerSide.context.close();
  }
});

test('the accountant reads everything and has no buttons that change anything', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const accountant = await staff('ACCOUNTANT');
  const ownerSide = await open(browser);
  const { context, page } = await open(browser);
  try {
    await signIn(ownerSide.page, owner.digits);
    await expect(
      ownerSide.page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
    ).toBeVisible();
    const order = await aPhoneOrder(ownerSide.page);
    await signIn(page, accountant.digits);
    await expect(page.getByText(hinglish['owner.totalDue'])).toBeVisible();
    await expect(page.getByRole('link', { name: hinglish['owner.newOrder'] })).toHaveCount(0);
    await page.goto(`${desk}/orders/${order.id}`);
    await expect(page.getByRole('heading', { name: 'Grahak Ramesh' })).toBeVisible();
    for (const key of ['owner.startPreparing', 'owner.receiveMoney', 'owner.cancelOrder'] as const)
      await expect(page.getByRole('button', { name: hinglish[key] })).toHaveCount(0);
    await page.goto(`${desk}/stock`);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.stock'], exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: hinglish['owner.stockReceived'] })).toHaveCount(
      0,
    );
    await page.goto(`${desk}/orders/new`);
    await expect(page.getByRole('heading', { name: hinglish['owner.notYourPage'] })).toBeVisible();
  } finally {
    await context.close();
    await ownerSide.context.close();
  }
});

test('a cashier takes money but cannot move an order along or give money back', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const cashier = await staff('CASHIER');
  const ownerSide = await open(browser);
  const { context, page } = await open(browser);
  try {
    await signIn(ownerSide.page, owner.digits);
    await expect(
      ownerSide.page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
    ).toBeVisible();
    const order = await aPhoneOrder(ownerSide.page);
    await signIn(page, cashier.digits);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
    ).toBeVisible();
    await page.goto(`${desk}/orders/${order.id}`);
    await expect(page.getByRole('button', { name: hinglish['owner.receiveMoney'] })).toBeVisible();
    await expect(page.getByRole('button', { name: hinglish['owner.startPreparing'] })).toHaveCount(
      0,
    );
  } finally {
    await context.close();
    await ownerSide.context.close();
  }
});

test('the technical operator lands on the system pages and reaches no business page', async ({
  browser,
}) => {
  const tech = await staff('TECH_OPERATOR');
  const { context, page } = await open(browser);
  try {
    await signIn(page, tech.digits);
    await expect(page).toHaveURL(/\/system/);
    for (const path of ['/orders', '/customers', '/khata', '/stock']) {
      await page.goto(`${desk}${path}`);
      await expect(
        page.getByRole('heading', { name: hinglish['owner.notYourPage'] }),
      ).toBeVisible();
    }
  } finally {
    await context.close();
  }
});

test('a driver gets a polite note instead of the desk', async ({ browser }) => {
  const driver = await staff('DRIVER');
  const { context, page } = await open(browser);
  try {
    await signIn(page, driver.digits);
    await expect(page.getByText(hinglish['owner.noDeskAccess'])).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('with a passphrase on file, changing access asks for it, and a wrong one changes nothing', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const passphrase = 'correct horse battery staple';
  await db.adminCredential.create({
    data: { userId: owner.id, passwordHash: await hashPassword(passphrase) },
  });
  const helper = await staff('HELPER');
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
    ).toBeVisible();
    await page.goto(`${desk}/more?view=users`);
    const row = page.locator('article', { hasText: helper.name });
    await row.getByRole('button', { name: hinglish['owner.pausePerson'] }).click();
    await page
      .getByRole('button', { name: hinglish['owner.pausePerson'], exact: true })
      .last()
      .click();
    await expect(page.getByRole('heading', { name: hinglish['owner.stepUpTitle'] })).toBeVisible();

    await page.locator('input[type=password]').fill('wrong wrong wrong');
    await page.getByRole('button', { name: hinglish['owner.confirm'], exact: true }).click();
    await expect(page.getByText(hinglish['error.STEP_UP_FAILED'])).toBeVisible();
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: helper.id } })).staffPausedAt,
    ).toBeNull();

    await page.locator('input[type=password]').fill(passphrase);
    await page.getByRole('button', { name: hinglish['owner.confirm'], exact: true }).click();
    await expect(row).toContainText(hinglish['owner.paused']);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: helper.id } })).staffPausedAt,
    ).not.toBeNull();
  } finally {
    await context.close();
  }
});

test('with two shops, an owner chooses the shop, and a person sees only theirs', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const second = await db.location.upsert({
    where: { id: 'loc_browser_b' },
    update: { active: true, name: 'Danapur shop' },
    create: { id: 'loc_browser_b', firmId: 'firm_main', slug: 'browser-b', name: 'Danapur shop' },
  });
  const owner = await staff('OWNER');
  const { context, page } = await open(browser);
  const phone = freshPhone();
  const name = `Ravi ${phone.slice(-4)}`;
  try {
    await signIn(page, owner.digits);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
    ).toBeVisible();
    await page.goto(`${desk}/more?view=users`);
    await page.getByRole('button', { name: hinglish['owner.addPerson'] }).click();
    await page.getByRole('textbox', { name: hinglish['owner.personName'] }).fill(name);
    await page.getByRole('textbox', { name: hinglish['owner.personPhone'] }).fill(phone);
    await page
      .getByRole('combobox', { name: hinglish['owner.personRole'] })
      .selectOption('MANAGER');
    await page.getByRole('button', { name: hinglish['owner.save'] }).click();
    // Saving with no shop chosen is refused and explained.
    await expect(page.getByText(hinglish['error.SHOP_REQUIRED'])).toBeVisible();
    await page.getByRole('checkbox', { name: 'Danapur shop' }).check();
    await page.getByRole('button', { name: hinglish['owner.save'] }).click();
    await expect(page.getByRole('heading', { name: hinglish['owner.inviteTitle'] })).toBeVisible();
    await page.getByRole('button', { name: hinglish['owner.close'], exact: true }).last().click();
    const row = page.locator('article', { hasText: name });
    await expect(row).toContainText('Danapur shop');
    // An all-shop role has no shop list to choose from.
    await row.getByRole('button', { name: hinglish['owner.change'] }).click();
    await page
      .getByRole('combobox', { name: hinglish['owner.personRole'] })
      .selectOption('ACCOUNTANT');
    await expect(page.getByRole('checkbox', { name: 'Danapur shop' })).toHaveCount(0);
    await page.getByRole('button', { name: hinglish['owner.close'], exact: true }).last().click();

    // The owner's phone order now asks which shop.
    await page.goto(`${desk}/orders/new`);
    await expect(page.getByRole('combobox', { name: hinglish['owner.whichShop'] })).toBeVisible();
  } finally {
    await db.location.update({ where: { id: second.id }, data: { active: false } });
    await context.close();
  }
});

test('an owner sets a passphrase on the people page, and removing someone then asks for it', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const helper = await staff('HELPER');
  const { context, page } = await open(browser);
  const passphrase = 'my long private sentence';
  try {
    await signIn(page, owner.digits);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
    ).toBeVisible();
    await page.goto(`${desk}/more?view=users`);
    await expect(page.getByText(hinglish['owner.passphraseNeeded'])).toBeVisible();
    await page.getByRole('button', { name: hinglish['owner.passphraseSet'] }).click();
    const fields = page.locator('dialog input[type=password]');
    await fields.nth(0).fill(passphrase);
    await fields.nth(1).fill('something different here');
    await expect(page.getByText(hinglish['owner.passphraseDiffer'])).toBeVisible();
    await expect(page.getByRole('button', { name: hinglish['owner.save'] })).toBeDisabled();
    await fields.nth(1).fill(passphrase);
    await page.getByRole('button', { name: hinglish['owner.save'] }).click();
    await expect(page.getByText(hinglish['owner.passphraseIsSet'])).toBeVisible();

    // The rarer actions live inside the person's sheet, and the list stays calm.
    const row = page.locator('article', { hasText: helper.name });
    await expect(row.getByRole('button', { name: hinglish['owner.removePerson'] })).toHaveCount(0);
    await row.getByRole('button', { name: hinglish['owner.change'] }).click();
    await page.getByRole('button', { name: hinglish['owner.removePerson'] }).click();
    await page
      .getByRole('button', { name: hinglish['owner.removePerson'], exact: true })
      .last()
      .click();
    await expect(page.getByRole('heading', { name: hinglish['owner.stepUpTitle'] })).toBeVisible();
    await page.locator('dialog input[type=password]').last().fill(passphrase);
    await page.getByRole('button', { name: hinglish['owner.confirm'], exact: true }).click();
    await expect(page.locator('article', { hasText: helper.name })).toHaveCount(0);
    expect(await db.staffMembership.count({ where: { userId: helper.id, endedAt: null } })).toBe(0);
  } finally {
    await context.close();
  }
});

test('a cashier’s customer list has no udhaar amounts and no sorting by who owes', async ({
  browser,
}) => {
  const cashier = await staff('CASHIER');
  await db.user.upsert({
    where: { phone: '+919999990012' },
    update: { khataBalancePaise: 777700 },
    create: { phone: '+919999990012', name: 'Udhaar Grahak', khataBalancePaise: 777700 },
  });
  const { context, page } = await open(browser);
  try {
    await signIn(page, cashier.digits);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
    ).toBeVisible();
    await page.goto(`${desk}/customers`);
    await expect(page.locator('article, a', { hasText: 'Udhaar Grahak' }).first()).toBeVisible();
    await expect(page.locator('main')).not.toContainText('7,777');
    await expect(page.getByRole('button', { name: hinglish['owner.sortDue'] })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('an owner’s existing fixtures still get the whole desk', async ({ browser }) => {
  const owner = await db.user.create({
    data: { phone: `+91${freshPhone()}`, name: 'Fixture owner', role: 'ADMIN' },
  });
  await grantOwners(db);
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.phone.replace('+91', ''));
    await expect(
      page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
    ).toBeVisible();
    await nav(page).getByRole('link', { name: hinglish['owner.more'], exact: true }).click();
    for (const key of ['owner.people', 'owner.reports', 'owner.activity', 'owner.staff'] as const)
      await expect(page.getByRole('link', { name: hinglish[key] })).toBeVisible();
  } finally {
    await context.close();
  }
});
