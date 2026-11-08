import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { hinglish, t as words, type MessageKey } from '@shiv/i18n';
import type { StaffRole } from '@shiv/shared';
import { test, expect, deskLanguage } from './fixtures';

// List and Maal ki list, walked through as each role on the real desk. The API refuses these writes
// on its own; these journeys check each person sees only their job and that a refusal reaches them
// in plain words. Maal ki list opens from its tab on the Stock page.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const api = 'http://localhost:4010/api/v1';
const MAIN = 'loc_main';
const DAY = 86400000;
let counter = 0;
const freshPhone = () => `9${String(Date.now()).slice(-8)}${counter++ % 10}`;
const say = (key: MessageKey, params: Record<string, string | number> = {}) =>
  words(key, params, 'hinglish');
/** A calendar day in Patna, this many days from today. */
const dayAhead = (days: number) =>
  new Date(Date.now() + days * DAY + 5.5 * 3600000).toISOString().slice(0, 10);

test.use({ serviceWorkers: 'block' });
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
async function signIn(page: Page, digits: string, path = '/lists') {
  await page.goto(`${desk}${path}`);
  await page.getByRole('textbox', { name: hinglish['owner.loginPhone'] }).fill(digits);
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: hinglish['owner.sendCode'] }).click();
  await page
    .getByRole('textbox', { name: hinglish['owner.code'], exact: true })
    .fill((await (await sent).json()).devCode);
  const verified = page.waitForResponse((r) => r.url().endsWith('/auth/otp/verify'));
  await page.getByRole('button', { name: hinglish['owner.signIn'] }).click();
  expect((await verified).ok()).toBe(true);
  await expect(page.getByRole('textbox', { name: hinglish['owner.loginPhone'] })).toHaveCount(0);
}
/** What the API itself says to this signed-in person, whatever the screen offers. */
function ask(page: Page, method: string, path: string, body: unknown = {}) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { url: `${api}${path}`, method, body },
  );
}

/** A customer's list. `agreed` gives one the customer has already said yes to, at ₹380 and ₹750. */
async function aList(agreed?: { day?: string }) {
  const phone = `+91${freshPhone()}`;
  const name = `Grahak ${phone.slice(-4)}`;
  const customer = await db.user.create({ data: { phone, name } });
  const product = await db.product.findFirstOrThrow({
    where: { active: true, stock: { gt: 200 }, quantityStep: 1, minQuantity: { lte: 1 } },
    orderBy: { createdAt: 'asc' },
  });
  const quote = await db.quote.create({
    data: {
      number: `LIST-${randomUUID().slice(0, 8)}`,
      userId: customer.id,
      locationId: MAIN,
      address: {
        label: 'Site',
        name,
        phone,
        line1: 'Plot 12',
        area: 'Kankarbagh',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800020',
        landmark: 'Mandir ke paas',
      },
      deliveryDate: agreed?.day ?? dayAhead(2),
      company: '',
      gstin: '',
      notes: 'Gaadi gate par rokna',
      ...(agreed
        ? {
            status: 'ACCEPTED' as const,
            revision: 1,
            deliveryConfirmed: true,
            deliveryFeePaise: 75000,
            totalPaise: 38000 * 10 + 75000,
            validUntil: new Date(Date.now() + 3 * DAY),
            decisionSource: 'CUSTOMER',
            decisionActorId: customer.id,
            decisionAt: new Date(),
          }
        : {}),
      items: {
        create: [
          {
            productId: product.id,
            name: product.name,
            unit: product.unit,
            packSize: product.packSize,
            quantity: 10,
            unitPricePaise: agreed ? 38000 : null,
          },
        ],
      },
      work: { create: {} },
    },
    include: { work: true },
  });
  return { quote, work: quote.work!, product, name, phone };
}
type Listed = Awaited<ReturnType<typeof aList>>;
const rowOf = (page: Page, number: string) => page.locator('article', { hasText: number });
const button = (page: Page, key: MessageKey) =>
  page.getByRole('button', { name: hinglish[key], exact: true });
const rateBox = (page: Page, { product }: Listed) =>
  page.getByRole('textbox', {
    name: say('owner.lists.rateLabel', {
      name: product.name,
      quantity: 10,
      unit: product.packSize || product.unit,
    }),
    exact: true,
  });
const openList = (page: Page, { quote }: Listed) =>
  page.goto(`${desk}/lists?id=${encodeURIComponent(quote.id)}`);
/** Types rates and delivery cost, without sending. */
async function fillRates(page: Page, list: Listed, rate = '380', freight = '750') {
  await rateBox(page, list).fill(rate);
  await page
    .getByRole('textbox', { name: hinglish['owner.lists.freight'], exact: true })
    .fill(freight);
  await page.getByRole('checkbox', { name: hinglish['owner.lists.checked'] }).check();
}
async function confirmSheet(page: Page, key: MessageKey) {
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: hinglish[key], exact: true })
    .click();
}

test('an owner gives rates, writes down the customer’s yes, and makes one order', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const owner = await staff('OWNER');
  const list = await aList();
  const { quote, phone } = list;
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.lists.title'], exact: true }),
    ).toBeVisible();
    const row = rowOf(page, quote.number);
    await expect(row).toContainText(hinglish['owner.lists.state.REQUESTED']);
    await expect(row).toContainText(hinglish['owner.lists.noTotal']);
    await expect(row.getByRole('link', { name: hinglish['owner.call'] })).toHaveAttribute(
      'href',
      `tel:${phone}`,
    );

    // Rate do, with the total adding up on screen as it is typed.
    await row
      .getByRole('button', {
        name: `${hinglish['owner.lists.rateDo']} ${quote.number}`,
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/lists\\?id=${quote.id}$`));
    await expect(page.getByRole('heading', { name: quote.number })).toBeVisible();
    await expect(page.locator('main')).toContainText('Gaadi gate par rokna');
    await fillRates(page, list);
    await expect(page.locator('main')).toContainText('₹4,550');
    await button(page, 'owner.lists.send').click();
    await expect(page.getByRole('dialog').last()).toContainText('₹4,550');
    await confirmSheet(page, 'owner.lists.send');

    await expect(page).toHaveURL(`${desk}/lists`);
    await expect(page.getByText(hinglish['owner.lists.sent'])).toBeVisible();
    await expect(row).toContainText(hinglish['owner.lists.state.SENT']);
    const sent = await db.quote.findUniqueOrThrow({
      where: { id: quote.id },
      include: { items: true },
    });
    expect(sent).toMatchObject({
      status: 'SENT',
      revision: 1,
      totalPaise: 455000,
      deliveryFeePaise: 75000,
      deliveryConfirmed: true,
    });
    expect(sent.items[0]!.unitPricePaise).toBe(38000);

    // The note is needed: who said yes, how and when.
    await row
      .getByRole('button', { name: `${hinglish['owner.lists.open']} ${quote.number}`, exact: true })
      .click();
    await button(page, 'owner.lists.recordYes').click();
    const sheet = page.getByRole('dialog');
    await sheet
      .getByRole('button', { name: hinglish['owner.lists.recordYes'], exact: true })
      .click();
    await expect(sheet.getByText(hinglish['owner.lists.recordNeeded'])).toBeVisible();
    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('SENT');
    await sheet
      .getByRole('textbox', { name: hinglish['owner.lists.recordNote'] })
      .fill('Ramesh ji ne phone par kaha, 4 baje');
    await sheet
      .getByRole('button', { name: hinglish['owner.lists.recordYes'], exact: true })
      .click();
    await expect(page).toHaveURL(`${desk}/lists`);
    await expect
      .poll(async () => (await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status)
      .toBe('ACCEPTED');
    expect(await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).toMatchObject({
      decisionSource: 'STORE_RECORDED',
      decisionNote: 'Ramesh ji ne phone par kaha, 4 baje',
    });

    // Order banao, at exactly the agreed rates.
    await row
      .getByRole('button', {
        name: `${hinglish['owner.lists.makeOrder']} ${quote.number}`,
        exact: true,
      })
      .click();
    await expect(page.locator('main')).toContainText(hinglish['owner.lists.acceptedNote']);
    await button(page, 'owner.lists.makeOrder').click();
    const converted = page.waitForResponse(
      (r) => r.url().endsWith(`/quotes/${quote.id}/convert`) && r.request().method() === 'POST',
    );
    await confirmSheet(page, 'owner.lists.makeOrder');
    const response = await converted;
    expect(response.status()).toBe(201);
    const order = (await response.json()) as { id: string; number: string };
    await expect(page).toHaveURL(`${desk}/orders/${order.id}`);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      quoteId: quote.id,
      quoteRevision: 1,
      totalPaise: 455000,
    });

    // Asking again gives the same order, and the list now only points to it.
    const replay = await ask(page, 'POST', `/admin/quotes/${quote.id}/convert`, { revision: 1 });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(order.id);
    expect(await db.order.count({ where: { quoteId: quote.id } })).toBe(1);
    await openList(page, list);
    await expect(
      page.getByRole('link', { name: say('owner.lists.orderLink', { number: order.number }) }),
    ).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(button(page, 'owner.lists.makeOrder')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('changing agreed rates needs a fresh yes, and no order is made meanwhile', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const list = await aList({});
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    await openList(page, list);
    await expect(page.locator('main')).toContainText(hinglish['owner.lists.saidInApp']);
    await expect(page.locator('main')).toContainText('₹4,550');
    await expect(rateBox(page, list)).toHaveCount(0);

    await button(page, 'owner.lists.changeRates').click();
    await expect(page.getByText(hinglish['owner.lists.changeWarn'])).toBeVisible();
    await expect(button(page, 'owner.lists.makeOrder')).toHaveCount(0);
    await expect(rateBox(page, list)).toHaveValue('380');
    await rateBox(page, list).fill('390');
    await button(page, 'owner.lists.sendAgain').click();
    await confirmSheet(page, 'owner.lists.sendAgain');
    await expect(page).toHaveURL(`${desk}/lists`);

    expect(await db.quote.findUniqueOrThrow({ where: { id: list.quote.id } })).toMatchObject({
      status: 'SENT',
      revision: 2,
      totalPaise: 465000,
      decisionSource: null,
    });
    expect(await db.order.count({ where: { quoteId: list.quote.id } })).toBe(0);
    // The old revision cannot be turned into an order behind the customer's back.
    const stale = await ask(page, 'POST', `/admin/quotes/${list.quote.id}/convert`, {
      revision: 1,
    });
    expect(stale.status).toBe(409);
  } finally {
    await context.close();
  }
});

test('when the agreed day has passed, the order asks for a new day', async ({ browser }) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const list = await aList({ day: dayAhead(-1) });
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    await openList(page, list);
    await page
      .getByRole('combobox', { name: hinglish['owner.lists.newDay'] })
      .selectOption(dayAhead(3));
    await button(page, 'owner.lists.makeOrder').click();
    await confirmSheet(page, 'owner.lists.makeOrder');
    await expect(page).toHaveURL(/\/orders\//);
    const order = await db.order.findFirstOrThrow({ where: { quoteId: list.quote.id } });
    expect(order.deliveryDate).toBe(dayAhead(3));
  } finally {
    await context.close();
  }
});

test('a list that changed elsewhere refuses the send and keeps what was typed', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const list = await aList();
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    await openList(page, list);
    await fillRates(page, list);
    await db.quote.update({
      where: { id: list.quote.id },
      data: {
        status: 'SENT',
        revision: 1,
        totalPaise: 100,
        validUntil: new Date(Date.now() + DAY),
      },
    });
    await button(page, 'owner.lists.send').click();
    await confirmSheet(page, 'owner.lists.send');
    await expect(page.getByText(hinglish['error.QUOTE_CHANGED'])).toBeVisible();
    await expect(page.getByText(hinglish['owner.lists.changedElsewhere'])).toBeVisible();
    await expect(rateBox(page, list)).toHaveValue('380');
    expect(await db.quote.findUniqueOrThrow({ where: { id: list.quote.id } })).toMatchObject({
      revision: 1,
      totalPaise: 100,
    });
  } finally {
    await context.close();
  }
});

test('leaving with typed rates asks first', async ({ browser }) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const list = await aList();
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    await openList(page, list);
    await rateBox(page, list).fill('380');
    await page.getByRole('link', { name: hinglish['owner.back'] }).click();
    await expect(page.getByRole('heading', { name: hinglish['owner.unsavedTitle'] })).toBeVisible();
    await confirmSheet(page, 'owner.keepEditing');
    await expect(page).toHaveURL(/\?id=/);
    await expect(rateBox(page, list)).toHaveValue('380');

    await page.getByRole('link', { name: hinglish['owner.back'] }).click();
    await confirmSheet(page, 'owner.discard');
    await expect(page).toHaveURL(`${desk}/lists`);
    await expect(rowOf(page, list.quote.number)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('bad rates, delivery cost and times are explained, and nothing is sent', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const list = await aList();
  const { context, page } = await open(browser);
  const offers: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/offer')) offers.push(request.url());
  });
  try {
    await signIn(page, owner.digits);
    await openList(page, list);
    await fillRates(page, list, 'bahut', '750');
    await button(page, 'owner.lists.send').click();
    const badRate = say('owner.lists.badRate', { name: list.product.name });
    await expect(page.getByText(badRate)).toBeVisible();
    // Free goods are not a rate.
    await rateBox(page, list).fill('0');
    await button(page, 'owner.lists.send').click();
    await expect(page.getByText(badRate)).toBeVisible();
    // More than the API can hold.
    await rateBox(page, list).fill('1000001');
    await button(page, 'owner.lists.send').click();
    await expect(page.getByText(badRate)).toBeVisible();

    await rateBox(page, list).fill('380');
    await page
      .getByRole('textbox', { name: hinglish['owner.lists.freight'], exact: true })
      .fill('-5');
    await button(page, 'owner.lists.send').click();
    await expect(page.getByText(hinglish['owner.lists.badFreight'])).toBeVisible();

    await page
      .getByRole('textbox', { name: hinglish['owner.lists.freight'], exact: true })
      .fill('750');
    await page.getByLabel(hinglish['owner.lists.validUntil']).fill('2020-01-01T10:00');
    await button(page, 'owner.lists.send').click();
    await expect(page.getByText(hinglish['owner.lists.badExpiry'])).toBeVisible();

    // A decimal typed with a trailing space stays the amount it looks like.
    await page.getByLabel(hinglish['owner.lists.validUntil']).fill(`${dayAhead(5)}T10:00`);
    await rateBox(page, list).fill('380.5 ');
    await expect(page.locator('main')).toContainText('₹4,555');
    expect(offers).toEqual([]);
  } finally {
    await context.close();
  }
});

test('an owner takes the list, gives it to someone, and sends a failed alert again', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const manager = await staff('MANAGER');
  const list = await aList();
  const { id } = list.work;
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits);
    await openList(page, list);
    await expect(page.getByText(hinglish['owner.lists.nobody'])).toBeVisible();
    await button(page, 'owner.lists.take').click();
    await expect(page.getByText(say('owner.lists.holder', { name: owner.name }))).toBeVisible();
    await expect(button(page, 'owner.lists.take')).toHaveCount(0);
    expect(await db.ownerWork.findUniqueOrThrow({ where: { id } })).toMatchObject({
      assignedToId: owner.id,
    });

    const give = page.getByRole('combobox', { name: hinglish['owner.lists.giveTo'] });
    await expect(give.locator('option', { hasText: manager.name })).toHaveCount(1);
    await give.selectOption(manager.id);
    await expect(page.getByText(say('owner.lists.holder', { name: manager.name }))).toBeVisible();
    expect((await db.ownerWork.findUniqueOrThrow({ where: { id } })).assignedToId).toBe(manager.id);

    // Marked delivered so the background worker leaves it alone until the button is pressed.
    await db.ownerWork.update({
      where: { id },
      data: { lastError: 'NO_OWNER', attempts: 3, deliveredAt: new Date() },
    });
    await openList(page, list);
    await expect(page.getByText(say('owner.lists.alertFailed', { count: 3 }))).toBeVisible();
    const retried = page.waitForResponse(
      (r) => r.url().endsWith(`/work/${id}/retry`) && r.request().method() === 'POST',
    );
    await button(page, 'owner.lists.alertAgain').click();
    expect((await retried).status()).toBe(201);
    await expect(page.getByText(hinglish['owner.lists.alertSent'])).toBeVisible();
  } finally {
    await context.close();
  }
});

test('an accountant reads a list and has nothing to press; the API refuses them too', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const accountant = await staff('ACCOUNTANT');
  const list = await aList({});
  const { context, page } = await open(browser);
  try {
    await signIn(page, accountant.digits);
    await expect(rowOf(page, list.quote.number)).toContainText('₹4,550');
    await expect(
      rowOf(page, list.quote.number).getByRole('button', {
        name: `${hinglish['owner.lists.open']} ${list.quote.number}`,
        exact: true,
      }),
    ).toBeVisible();
    await openList(page, list);
    await expect(page.locator('main')).toContainText('₹4,550');
    await expect(page.locator('main')).toContainText(list.name);
    await expect(page.locator('main').getByRole('textbox')).toHaveCount(0);
    await expect(page.locator('main').getByRole('combobox')).toHaveCount(0);
    for (const key of [
      'owner.lists.makeOrder',
      'owner.lists.changeRates',
      'owner.lists.send',
      'owner.lists.sendAgain',
      'owner.lists.recordYes',
      'owner.lists.take',
    ] as const)
      await expect(button(page, key)).toHaveCount(0);
    const refused = await ask(page, 'POST', `/admin/quotes/${list.quote.id}/convert`, {
      revision: 1,
    });
    expect(refused.status).toBe(403);
    expect(await db.order.count({ where: { quoteId: list.quote.id } })).toBe(0);
  } finally {
    await context.close();
  }
});

test('a cashier may take a list and give it on, but gives no rates', async ({ browser }) => {
  test.setTimeout(120000);
  const cashier = await staff('CASHIER');
  const list = await aList();
  const { context, page } = await open(browser);
  try {
    await signIn(page, cashier.digits);
    await expect(
      rowOf(page, list.quote.number).getByRole('button', {
        name: `${hinglish['owner.lists.open']} ${list.quote.number}`,
        exact: true,
      }),
    ).toBeVisible();
    await openList(page, list);
    await expect(button(page, 'owner.lists.take')).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: hinglish['owner.lists.giveTo'] }),
    ).toBeVisible();
    await expect(page.locator('main').getByRole('textbox')).toHaveCount(0);
    await expect(button(page, 'owner.lists.send')).toHaveCount(0);
    const refused = await ask(page, 'POST', `/admin/quotes/${list.quote.id}/offer`, {
      expectedRevision: 0,
      deliveryConfirmed: true,
      items: [{ productId: list.product.id, unitPricePaise: 100 }],
      deliveryFeePaise: 0,
      validUntil: new Date(Date.now() + DAY).toISOString(),
    });
    expect(refused.status).toBe(403);
    await button(page, 'owner.lists.take').click();
    await expect(page.getByText(say('owner.lists.holder', { name: cashier.name }))).toBeVisible();
  } finally {
    await context.close();
  }
});

test('a manager at another shop does not see this shop’s list', async ({ browser }) => {
  test.setTimeout(120000);
  const second = await db.location.upsert({
    where: { id: 'loc_browser_b' },
    update: { active: true, name: 'Danapur shop' },
    create: { id: 'loc_browser_b', firmId: 'firm_main', slug: 'browser-b', name: 'Danapur shop' },
  });
  const manager = await staff('MANAGER', [second.id]);
  const list = await aList();
  const { context, page } = await open(browser);
  try {
    await signIn(page, manager.digits);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.lists.title'], exact: true }),
    ).toBeVisible();
    await expect(rowOf(page, list.quote.number)).toHaveCount(0);
    await openList(page, list);
    await expect(page.getByText(hinglish['owner.lists.notFound'])).toBeVisible();
    await expect(page.locator('main')).not.toContainText(list.name);
    const refused = await ask(page, 'POST', `/admin/quotes/${list.quote.id}/acknowledge`);
    expect(refused.status).toBe(403);
  } finally {
    await db.location.update({ where: { id: second.id }, data: { active: false } });
    await context.close();
  }
});

for (const role of ['STOCK_KEEPER', 'TECH_OPERATOR'] as const)
  test(`${role} gets a polite page, and the list is never asked for`, async ({ browser }) => {
    test.setTimeout(90000);
    const person = await staff(role);
    const { context, page } = await open(browser);
    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/admin/quotes')) asked.push(request.url());
    });
    try {
      await signIn(page, person.digits);
      await expect(page.getByText(hinglish['owner.notYourPage'])).toBeVisible();
      await expect(page.getByRole('heading', { name: hinglish['owner.lists.title'] })).toHaveCount(
        0,
      );
      expect(asked).toEqual([]);
    } finally {
      await context.close();
    }
  });

/** The Maal ki list tab on the Stock page. */
async function openMaal(page: Page) {
  await page.goto(`${desk}/stock`);
  await page.getByRole('tab', { name: hinglish['owner.stockPage.tab.maal'], exact: true }).click();
  await expect(
    page.getByRole('button', { name: hinglish['owner.maal.add'], exact: true }),
  ).toBeVisible();
}
async function fillGoods(page: Page, name: string, category: string) {
  const sheet = page.getByRole('dialog');
  const box = (key: MessageKey) => sheet.getByRole('textbox', { name: hinglish[key], exact: true });
  await box('owner.maal.name').fill(name);
  await box('owner.maal.brand').fill('Test Brand');
  await sheet.getByRole('combobox', { name: hinglish['owner.maal.category'] }).selectOption({
    label: category,
  });
  await box('owner.maal.type').fill('PPC Cement');
  await box('owner.maal.grade').fill('53 grade');
  await box('owner.maal.unit').fill('50 kg bag');
  await box('owner.maal.price').fill('410');
  await box('owner.maal.description').fill('Pakka maal');
  await box('owner.maal.recommendedUse').fill('Chhat aur deewar');
  return sheet;
}

test('an owner adds a category and goods, with no way to type a stock balance', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const owner = await staff('OWNER');
  const suffix = randomUUID().slice(0, 6);
  const category = `Test ${suffix}`;
  const name = `Test maal ${suffix}`;
  const { context, page } = await open(browser);
  try {
    await signIn(page, owner.digits, '/stock');
    await openMaal(page);

    const newCategory = page.getByRole('textbox', { name: hinglish['owner.maal.newCategory'] });
    await newCategory.fill(category);
    await page.getByRole('button', { name: hinglish['owner.maal.addCategory'] }).click();
    await expect(page.getByText(hinglish['owner.maal.categoryAdded'])).toBeVisible();
    await expect(newCategory).toHaveValue('');
    expect(await db.category.count({ where: { name: category } })).toBe(1);
    // The same name again is explained, not treated as someone else's edit.
    await newCategory.fill(category);
    await page.getByRole('button', { name: hinglish['owner.maal.addCategory'] }).click();
    await expect(page.getByText(hinglish['owner.maal.categoryExists'])).toBeVisible();
    await newCategory.fill('');

    await page.getByRole('button', { name: hinglish['owner.maal.add'], exact: true }).click();
    const sheet = await fillGoods(page, name, category);
    await expect(sheet).toContainText(hinglish['owner.maal.stockNew']);
    await expect(sheet.getByRole('spinbutton')).toHaveCount(0);
    await expect(sheet.getByRole('textbox', { name: /stock/i })).toHaveCount(0);

    // Refused before anything is sent.
    const box = (key: MessageKey) =>
      sheet.getByRole('textbox', { name: hinglish[key], exact: true });
    await box('owner.maal.price').fill('sasta');
    await sheet.getByRole('button', { name: hinglish['owner.save'], exact: true }).click();
    await expect(sheet.getByText(hinglish['owner.maal.badPrice'])).toBeVisible();
    await box('owner.maal.price').fill('410');
    await box('owner.maal.minQuantity').fill('3');
    await box('owner.maal.quantityStep').fill('2');
    await sheet.getByRole('button', { name: hinglish['owner.save'], exact: true }).click();
    await expect(sheet.getByText(hinglish['owner.maal.badStep'])).toBeVisible();
    await box('owner.maal.minQuantity').fill('4');

    await sheet.getByRole('button', { name: hinglish['owner.save'], exact: true }).click();
    await expect(page.getByText(hinglish['owner.maal.saved'])).toBeVisible();
    const product = await db.product.findFirstOrThrow({ where: { name } });
    expect(product).toMatchObject({
      stock: 0,
      pricePaise: 41000,
      minQuantity: 4,
      quantityStep: 2,
      active: true,
    });
    expect(await db.inventoryMovement.count({ where: { productId: product.id } })).toBe(0);

    // The filters find it, and leave the rest out.
    const filter = page.getByRole('combobox', { name: hinglish['owner.maal.filter'] });
    await filter.selectOption({ label: category });
    await expect(page.locator('article', { hasText: name })).toBeVisible();
    await expect(page.locator('article')).toHaveCount(1);
    await filter.selectOption({ label: hinglish['owner.maal.allCategories'] });
    await page.getByRole('searchbox', { name: hinglish['owner.maal.search'] }).fill(`${suffix}x`);
    await expect(page.getByText(hinglish['owner.maal.empty'])).toBeVisible();
    await page.getByRole('searchbox', { name: hinglish['owner.maal.search'] }).fill(suffix);
    await expect(page.locator('article', { hasText: name })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('changing goods keeps the stock as it is, and a stale edit is refused', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const suffix = randomUUID().slice(0, 6);
  const name = `Test maal ${suffix}`;
  const product = await db.product.create({
    data: {
      categoryId: 'cement',
      name,
      brand: 'Test Brand',
      type: 'PPC Cement',
      grade: '53 grade',
      unit: '50 kg bag',
      pricePaise: 41000,
      stock: 0,
      images: [],
      description: 'Pakka maal',
      recommendedUse: 'Chhat aur deewar',
    },
  });
  const { context, page } = await open(browser);
  const edit = page.getByRole('button', {
    name: `${hinglish['owner.maal.edit']} ${name}`,
    exact: true,
  });
  try {
    await signIn(page, owner.digits, '/stock');
    await openMaal(page);
    await page.getByRole('searchbox', { name: hinglish['owner.maal.search'] }).fill(suffix);
    await edit.click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText(say('owner.maal.stockNow', { count: 0 }));
    await expect(sheet.getByRole('spinbutton')).toHaveCount(0);
    await sheet
      .getByRole('textbox', { name: hinglish['owner.maal.price'], exact: true })
      .fill('425.50');
    await sheet.getByRole('button', { name: hinglish['owner.save'], exact: true }).click();
    await expect(page.getByText(hinglish['owner.maal.saved'])).toBeVisible();
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({
      pricePaise: 42550,
      version: 2,
      stock: 0,
    });
    expect(await db.productPriceHistory.count({ where: { productId: product.id } })).toBe(1);

    // Someone else saved first: refused, explained, and nothing written.
    await expect(edit).toBeVisible();
    await edit.click();
    await db.product.update({ where: { id: product.id }, data: { version: { increment: 1 } } });
    await sheet
      .getByRole('textbox', { name: hinglish['owner.maal.price'], exact: true })
      .fill('500');
    await sheet.getByRole('button', { name: hinglish['owner.save'], exact: true }).click();
    await expect(sheet.getByText(hinglish['error.CONFLICT'])).toBeVisible();
    await expect(sheet.getByText(hinglish['owner.maal.changedElsewhere'])).toBeVisible();
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).pricePaise).toBe(
      42550,
    );

    // Leaving with changes asks first.
    await sheet.getByRole('button', { name: hinglish['owner.close'], exact: true }).click();
    await expect(page.getByRole('heading', { name: hinglish['owner.unsavedTitle'] })).toBeVisible();
    await confirmSheet(page, 'owner.discard');
    await expect(sheet).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a photo comes only from an upload, shows at once, and can be taken off', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const suffix = randomUUID().slice(0, 6);
  const category = `Test ${suffix}`;
  await db.category.create({ data: { name: category, slug: `test-${suffix}` } });
  const { context, page } = await open(browser);
  const publicUrl = 'https://assets.invalid/products/00000000-0000-0000-0000-000000000000.webp';
  // The test API has no photo storage, so the upload itself is answered here.
  const headers = {
    'Access-Control-Allow-Origin': desk,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST',
  };
  await page.route('**/api/v1/admin/uploads', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers })
      : route.fulfill({ status: 201, headers, json: { publicUrl } }),
  );
  try {
    await signIn(page, owner.digits, '/stock');
    await openMaal(page);
    await page.getByRole('button', { name: hinglish['owner.maal.add'], exact: true }).click();
    const sheet = await fillGoods(page, `Test maal ${suffix}`, category);
    const file = sheet.getByLabel(hinglish['owner.maal.photoUpload']);
    // A file that is not a photo goes nowhere.
    await file.setInputFiles({
      name: 'list.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF'),
    });
    await expect(sheet.getByText(hinglish['error.INVALID_IMAGE'])).toBeVisible();
    await file.setInputFiles({
      name: 'bori.png',
      mimeType: 'image/png',
      buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
    });
    await expect(sheet.getByRole('img', { name: hinglish['owner.maal.photoAlt'] })).toHaveAttribute(
      'src',
      publicUrl,
    );
    // The API takes only photos it stored itself.
    await sheet.getByRole('button', { name: hinglish['owner.save'], exact: true }).click();
    await expect(sheet.getByText(hinglish['owner.maal.photoNotOurs'])).toBeVisible();
    expect(await db.product.count({ where: { name: `Test maal ${suffix}` } })).toBe(0);

    await sheet
      .getByRole('button', { name: hinglish['owner.maal.photoRemove'], exact: true })
      .click();
    await expect(sheet.getByRole('img', { name: hinglish['owner.maal.photoAlt'] })).toHaveCount(0);
    await sheet.getByRole('button', { name: hinglish['owner.save'], exact: true }).click();
    await expect(page.getByText(hinglish['owner.maal.saved'])).toBeVisible();
    expect(
      (await db.product.findFirstOrThrow({ where: { name: `Test maal ${suffix}` } })).images,
    ).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const role of ['MANAGER', 'CASHIER', 'STOCK_KEEPER'] as const)
  test(`${role} has no Maal ki list, and the API refuses the writes`, async ({ browser }) => {
    test.setTimeout(90000);
    const person = await staff(role);
    const { context, page } = await open(browser);
    try {
      await signIn(page, person.digits, '/stock');
      await expect(
        page.getByRole('heading', { name: hinglish['owner.stock'], exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('tab', { name: hinglish['owner.stockPage.tab.maal'] }),
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: hinglish['owner.maal.add'] })).toHaveCount(0);
      const made = await ask(page, 'POST', '/admin/products', { name: 'Chupke se' });
      expect(made.status).toBe(403);
      const category = await ask(page, 'POST', '/admin/categories', { name: 'Chupke', slug: 'x' });
      expect(category.status).toBe(403);
      const changed = await ask(page, 'PATCH', '/admin/products/test-ultratech', { name: 'x' });
      expect(changed.status).toBe(403);
    } finally {
      await context.close();
    }
  });
