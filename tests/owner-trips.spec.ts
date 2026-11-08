import { randomUUID } from 'node:crypto';
import { hinglish } from '@shiv/i18n';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  linkedPhone,
  call,
  closeShops,
  database,
  go,
  MAIN,
  ok,
  person,
  prepareShops,
  refusedPage,
  say,
  SECOND,
  signedInDesk,
  signIn,
  today,
  toast,
  type Who,
} from './staff-world';

// Which orders go on which truck, and the drivers' cash at the drawer. Real API, real database.
const db = database();
let customer: Who;
let boss: Who;
test.setTimeout(120000);
test.beforeAll(async () => {
  await prepareShops(db);
  boss = await person(db, 'OWNER', { name: 'Trip Malik' });
  customer = await person(db, 'STOCK_KEEPER', { name: 'Grahak Log' });
});
test.afterAll(async () => closeShops(db));

async function order(locationId = MAIN, area = 'Kankarbagh') {
  return db.order.create({
    data: {
      number: `SC-T-${randomUUID().slice(0, 8)}`,
      locationId,
      // An order carries its shop's firm (plan v4 A3; the database checks it).
      firmId: (await db.location.findUniqueOrThrow({ where: { id: locationId } })).firmId,
      userId: customer.id,
      source: 'PHONE',
      createdById: boss.id,
      idempotencyKey: randomUUID(),
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      confirmedById: boss.id,
      address: {
        name: 'Site Wale',
        phone: '+919000006100',
        line1: 'Plot 12',
        area,
        city: 'Patna',
        state: 'Bihar',
        pincode: '800020',
      },
      deliveryDate: today(),
      notes: '',
      subtotalPaise: 160000,
      deliveryFeePaise: 0,
      totalPaise: 160000,
      items: {
        create: {
          productId: 'test-ultratech',
          name: 'UltraTech Super',
          unit: 'bag',
          packSize: '',
          quantity: 4,
          pricePaise: 40000,
          listPricePaise: 40000,
          priceVersion: 1,
          lineTotalPaise: 160000,
        },
      },
      payment: { create: { method: 'COD', status: 'PENDING', amountPaise: 160000 } },
    },
  });
}
const pick = (page: Page, number: string) =>
  page.getByRole('checkbox', { name: new RegExp(number) });
const tripCard = (page: Page, driver: string) =>
  page.locator('article').filter({ hasText: driver });

test('a manager sets the stops in order, picks a driver and a vehicle, and it is made once', async ({
  browser,
}) => {
  const manager = await person(db, 'MANAGER', { name: 'Trip Manager' });
  const driver = await person(db, 'DRIVER', { name: 'Raju Driver' });
  const helper = await person(db, 'HELPER', { name: 'Chhotu Helper' });
  const [first, second, third] = [await order(), await order(MAIN, 'Boring Road'), await order()];
  await ok(manager.token, 'POST', `/staff/stock/loads/${first.id}`, {
    idempotencyKey: randomUUID(),
  });
  const { context, page } = await signedInDesk(browser, manager);
  try {
    await go(page, '/trips');
    await expect(
      page.getByRole('heading', { name: hinglish['owner.trips.title'], exact: true }),
    ).toBeVisible();
    await expect(pick(page, first.number)).toBeVisible();
    await expect(page.locator('label').filter({ hasText: first.number })).toContainText(
      hinglish['owner.trips.loaded'],
    );
    await expect(page.locator('label').filter({ hasText: second.number })).toContainText(
      hinglish['owner.trips.notLoaded'],
    );
    // No rate, money or udhaar on the list.
    expect(await page.locator('main').innerText()).not.toContain('₹');

    await pick(page, first.number).check();
    await pick(page, second.number).check();
    await pick(page, third.number).check();
    await expect(page.getByText(hinglish['owner.trips.loadFirst'])).toBeVisible();
    await page
      .getByRole('button', { name: say('owner.trips.moveUp', { number: second.number }) })
      .click();
    await page
      .getByRole('button', { name: say('owner.trips.moveDown', { number: first.number }) })
      .click();
    await pick(page, third.number).uncheck();

    await page
      .getByRole('combobox', { name: hinglish['owner.trips.driver'] })
      .selectOption({ label: driver.name });
    await page
      .getByRole('combobox', { name: hinglish['owner.trips.helper'] })
      .selectOption({ label: helper.name });
    await page.getByRole('textbox', { name: hinglish['owner.trips.vehicle'] }).fill('BR01AB1234');
    // Tapped twice, made once.
    await page.getByRole('button', { name: say('owner.trips.create', { count: 2 }) }).dblclick();
    await expect(toast(page, say('owner.trips.created', { name: driver.name }))).toBeVisible();

    const trips = await db.trip.findMany({
      where: { driverId: driver.id },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });
    expect(trips.length).toBe(1);
    expect(trips[0]!.stops.map((stop) => stop.orderId)).toEqual([second.id, first.id]);
    expect(trips[0]).toMatchObject({
      vehicle: 'BR01AB1234',
      helperId: helper.id,
      createdById: manager.id,
    });

    const card = tripCard(page, driver.name);
    await expect(card.getByText(hinglish['owner.trips.status.PLANNED'])).toBeVisible();
    await expect(card.getByRole('listitem')).toHaveCount(2);
    await expect(card.getByRole('listitem').first()).toContainText(second.number);
    await expect(card.getByText(hinglish['owner.trips.stop.PENDING']).first()).toBeVisible();
    // What went on the trip leaves the ready list, and the other order stays.
    await expect(pick(page, first.number)).toHaveCount(0);
    await expect(pick(page, third.number)).toBeVisible();

    // Each stop's state shows, in words.
    const [stopOne, stopTwo] = trips[0]!.stops;
    await db.trip.update({
      where: { id: trips[0]!.id },
      data: { status: 'OUT', startedAt: new Date() },
    });
    await db.tripStop.update({ where: { id: stopOne!.id }, data: { status: 'DELIVERED' } });
    await db.tripStop.update({
      where: { id: stopTwo!.id },
      data: { status: 'PROBLEM', problem: 'NO_ACCESS' },
    });
    await page.reload();
    await expect(card.getByText(hinglish['owner.trips.status.OUT'])).toBeVisible();
    await expect(card.getByText(hinglish['owner.trips.stop.DELIVERED'])).toBeVisible();
    await expect(
      card.getByText(
        `${hinglish['owner.trips.stop.PROBLEM']}: ${hinglish['owner.trips.problem.NO_ACCESS']}`,
      ),
    ).toBeVisible();
    // A trip on the road has no cancel button.
    await expect(card.getByRole('button', { name: hinglish['owner.trips.cancel'] })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a trip not started can be cancelled, and the orders come back; a stale tap is told', async ({
  browser,
}) => {
  const manager = await person(db, 'MANAGER', { name: 'Radd Manager' });
  const driver = await person(db, 'DRIVER', { name: 'Radd Driver' });
  const started = await person(db, 'DRIVER', { name: 'Nikla Driver' });
  const one = await order();
  const two = await order();
  await ok(manager.token, 'POST', '/admin/trips', {
    locationId: MAIN,
    driverId: driver.id,
    orderIds: [one.id],
    idempotencyKey: randomUUID(),
  });
  const running = await ok(manager.token, 'POST', '/admin/trips', {
    locationId: MAIN,
    driverId: started.id,
    orderIds: [two.id],
    idempotencyKey: randomUUID(),
  });
  const { context, page } = await signedInDesk(browser, manager);
  try {
    await go(page, '/trips');
    const card = tripCard(page, driver.name);
    await card.getByRole('button', { name: hinglish['owner.trips.cancel'] }).click();
    await expect(
      page.getByRole('dialog').getByText(say('owner.trips.cancelBody', { name: driver.name })),
    ).toBeVisible();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: hinglish['owner.trips.cancel'] })
      .click();
    await expect(toast(page, hinglish['owner.trips.cancelled'])).toBeVisible();
    await expect(
      card.getByText(hinglish['owner.trips.status.CANCELLED'], { exact: true }),
    ).toBeVisible();
    await expect(pick(page, one.number)).toBeVisible();

    // The driver leaves while the card is still on this screen.
    await db.trip.update({ where: { id: running.id }, data: { status: 'OUT' } });
    await tripCard(page, started.name)
      .getByRole('button', { name: hinglish['owner.trips.cancel'] })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: hinglish['owner.trips.cancel'] })
      .click();
    await expect(toast(page, hinglish['owner.trips.cantCancel'])).toBeVisible();
    await expect(
      tripCard(page, started.name).getByText(hinglish['owner.trips.status.OUT']),
    ).toBeVisible();
    expect((await db.trip.findUniqueOrThrow({ where: { id: running.id } })).status).toBe('OUT');
  } finally {
    await context.close();
  }
});

test('two people pick the same order: the second is told plainly, and nothing doubles', async ({
  browser,
}) => {
  const manager = await person(db, 'MANAGER', { name: 'Pehla Manager' });
  const colleague = await person(db, 'MANAGER', { name: 'Doosra Manager' });
  const driver = await person(db, 'DRIVER', { name: 'Ek Driver' });
  const shared = await order();
  const first = await signedInDesk(browser, manager);
  const second = await signedInDesk(browser, colleague);
  try {
    for (const { page } of [first, second]) {
      await go(page, '/trips');
      await pick(page, shared.number).check();
      await page
        .getByRole('combobox', { name: hinglish['owner.trips.driver'] })
        .selectOption({ label: driver.name });
    }
    await first.page.getByRole('button', { name: say('owner.trips.create', { count: 1 }) }).click();
    await expect(
      toast(first.page, say('owner.trips.created', { name: driver.name })),
    ).toBeVisible();
    await second.page
      .getByRole('button', { name: say('owner.trips.create', { count: 1 }) })
      .click();
    await expect(second.page.getByText(hinglish['error.ORDER_BUSY'])).toBeVisible();
    // The order leaves their list too, and nothing was made twice.
    await expect(pick(second.page, shared.number)).toHaveCount(0);
    expect(await db.tripStop.count({ where: { orderId: shared.id } })).toBe(1);
  } finally {
    await first.context.close();
    await second.context.close();
  }
});

test('one trip holds twenty stops at most, and the page stops there too', async ({ browser }) => {
  const manager = await person(db, 'MANAGER', { name: 'Bees Manager' });
  const orders = [];
  for (let index = 0; index < 21; index++) orders.push(await order());
  const { context, page } = await signedInDesk(browser, manager);
  try {
    await go(page, '/trips');
    for (const row of orders.slice(0, 20)) await pick(page, row.number).check();
    await expect(pick(page, orders[20]!.number)).toBeDisabled();
    await pick(page, orders[0]!.number).uncheck();
    await expect(pick(page, orders[20]!.number)).toBeEnabled();
  } finally {
    await context.close();
    await db.order.updateMany({
      where: { id: { in: orders.map((row) => row.id) } },
      data: { status: 'CANCELLED' },
    });
  }
});

test('plain words when there is nothing, and an owner chooses the shop', async ({ browser }) => {
  await db.order.updateMany({
    where: { status: { in: ['CONFIRMED', 'PREPARING', 'DELIVERY_EXCEPTION'] } },
    data: { status: 'CANCELLED' },
  });
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await go(page, '/trips');
    await expect(page.getByText(hinglish['owner.trips.noOrders'])).toBeVisible();
    const choose = page.getByRole('combobox', { name: hinglish['owner.whichShop'] });
    await choose.selectOption(SECOND);
    await expect(page.getByText(hinglish['owner.trips.noOrders'])).toBeVisible();
    await expect(page.getByText(hinglish['owner.trips.noTrips'])).toBeVisible();
    const there = await order(SECOND);
    await page.reload();
    await choose.selectOption(SECOND);
    await pick(page, there.number).check();
    // No driver at that shop yet, and it says who can add one.
    await expect(page.getByText(hinglish['owner.trips.noDrivers'])).toBeVisible();
  } finally {
    await context.close();
  }
});

test('a tampered trip is refused: another shop’s order, or a driver from elsewhere', async () => {
  const manager = await person(db, 'MANAGER', { name: 'Chhed Manager' });
  const elsewhere = await person(db, 'DRIVER', { name: 'Doosri Dukaan Driver', shops: [SECOND] });
  const here = await person(db, 'DRIVER', { name: 'Yahan Driver' });
  const other = await order(SECOND);
  const mine = await order();
  const attempt = (body: object) =>
    call(manager.token, 'POST', '/admin/trips', { idempotencyKey: randomUUID(), ...body });
  expect(
    (await attempt({ locationId: SECOND, driverId: elsewhere.id, orderIds: [other.id] })).status,
  ).toBe(403);
  expect(
    (await attempt({ locationId: MAIN, driverId: here.id, orderIds: [other.id] })).status,
  ).toBe(409);
  expect(
    (await attempt({ locationId: MAIN, driverId: elsewhere.id, orderIds: [mine.id] })).status,
  ).toBe(409);
  expect((await attempt({ locationId: MAIN, driverId: here.id, orderIds: [] })).status).toBe(400);
  for (const path of [
    `/admin/trips?locationId=${SECOND}`,
    `/admin/trips/ready?locationId=${SECOND}`,
    `/admin/trips/drivers?locationId=${SECOND}`,
  ])
    expect((await call(manager.token, 'GET', path)).status, path).toBe(403);
});

for (const role of ['CASHIER', 'STOCK_KEEPER', 'ACCOUNTANT'] as const)
  test(`a ${role} has no trips page, and the API agrees`, async ({ browser }) => {
    const who = await person(db, role);
    const { context, page } = await signedInDesk(browser, who);
    try {
      await refusedPage(page, '/trips');
      for (const path of [
        `/admin/trips?locationId=${MAIN}`,
        `/admin/trips/ready?locationId=${MAIN}`,
      ])
        expect((await call(who.token, 'GET', path)).status, path).toBe(403);
    } finally {
      await context.close();
    }
  });
test('a driver has no desk, and cannot assign trips', async ({ browser }) => {
  const driver = await person(db, 'DRIVER');
  const { context, page } = await signIn(browser, driver, { path: '/trips' });
  try {
    await expect(page.getByText(hinglish['owner.noDeskAccess'])).toBeVisible();
    expect((await call(driver.token, 'GET', `/admin/trips/ready?locationId=${MAIN}`)).status).toBe(
      403,
    );
  } finally {
    await context.close();
  }
});

// ---- Driver ka paisa

/** Cash the driver took, and handed over with their own figure. */
async function handover(driver: Who, collectedPaise: number, offeredPaise: number) {
  await db.driverCollection.create({
    data: {
      orderId: randomUUID(),
      driverId: driver.id,
      locationId: MAIN,
      duePaise: collectedPaise,
      amountPaise: collectedPaise,
      channel: 'CASH',
      idempotencyKey: randomUUID(),
    },
  });
  const key = randomUUID();
  // A driver works from a linked phone: a desk sign-in holds no driving rights.
  const phone = await linkedPhone(db, driver, await person(db, 'OWNER'));
  await ok(phone.token, 'POST', '/staff/cash/handover', {
    amountPaise: offeredPaise,
    handoverKey: key,
  });
  return key;
}
const cash = (page: Page) => page.getByRole('region', { name: hinglish['owner.cash.title'] });
const countIt = async (page: Page, driver: Who, rupees: string, note = '') => {
  await page
    .getByRole('button', { name: say('owner.cash.countFor', { name: driver.name }) })
    .click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('textbox', { name: hinglish['owner.cash.howMuch'] }).fill(rupees);
  if (note) await sheet.getByRole('textbox', { name: hinglish['owner.cash.note'] }).fill(note);
  return sheet;
};

test('a cashier sees cash still out, counts a handover, and it joins the drawer', async ({
  browser,
}) => {
  const cashier = await person(db, 'CASHIER', { name: 'Galla Wala' });
  const driver = await person(db, 'DRIVER', { name: 'Paisa Driver' });
  await db.driverCollection.create({
    data: {
      orderId: randomUUID(),
      driverId: driver.id,
      locationId: MAIN,
      duePaise: 70000,
      amountPaise: 70000,
      channel: 'CASH',
      idempotencyKey: randomUUID(),
    },
  });
  const { context, page } = await signedInDesk(browser, cashier);
  try {
    await go(page, '/galla');
    const out = cash(page)
      .locator('div')
      .filter({ hasText: hinglish['owner.cash.withDrivers'] })
      .first();
    await expect(out.getByText(driver.name)).toBeVisible();
    await expect(out.getByText('₹700.00')).toBeVisible();

    const phone = await linkedPhone(db, driver, await person(db, 'OWNER'));
    await ok(phone.token, 'POST', '/staff/cash/handover', {
      amountPaise: 70000,
      handoverKey: randomUUID(),
    });
    await page.reload();
    await expect(cash(page).getByText(hinglish['owner.cash.waiting'])).toBeVisible();
    const before = await ok(cashier.token, 'GET', `/admin/galla?locationId=${MAIN}`);
    const sheet = await countIt(page, driver, '700');
    await expect(sheet.getByText(/Ginti mein fark/)).toHaveCount(0);
    await sheet.getByRole('button', { name: hinglish['owner.cash.take'] }).click();
    await expect(toast(page, say('owner.cash.countedSame', { name: driver.name }))).toBeVisible();
    await expect(cash(page).getByText(hinglish['owner.cash.done'])).toBeVisible();
    await expect(
      cash(page).getByText(say('owner.cash.countedBy', { name: cashier.name })),
    ).toBeVisible();
    const after = await ok(cashier.token, 'GET', `/admin/galla?locationId=${MAIN}`);
    expect(after.sales - before.sales).toBe(70000);
  } finally {
    await context.close();
  }
});

test('a difference shows all three figures in neutral words, until an owner settles it', async ({
  browser,
}) => {
  const cashier = await person(db, 'CASHIER', { name: 'Ginne Wala' });
  const driver = await person(db, 'DRIVER', { name: 'Fark Driver' });
  const key = await handover(driver, 160000, 150000);
  const counter = await signedInDesk(browser, cashier);
  const owner = await signedInDesk(browser, boss);
  try {
    await go(counter.page, '/galla');
    const sheet = await countIt(counter.page, driver, '1400', 'Note gine');
    await expect(
      sheet.getByText(
        say('owner.cash.differsNow', { counted: '₹1,400.00', collected: '₹1,600.00' }),
      ),
    ).toBeVisible();
    await sheet.getByRole('button', { name: hinglish['owner.cash.take'] }).click();
    await expect(
      toast(counter.page, say('owner.cash.countedDiffers', { name: driver.name })),
    ).toBeVisible();
    const card = (page: Page) => cash(page).locator('article').filter({ hasText: driver.name });
    await expect(card(counter.page).getByText(hinglish['owner.cash.different'])).toBeVisible();
    for (const figure of ['₹1,600.00', '₹1,500.00', '₹1,400.00'])
      await expect(card(counter.page).getByText(figure)).toBeVisible();
    const words = await cash(counter.page).innerText();
    expect(words.toLowerCase()).not.toMatch(
      /\b(chori|chor|short|shortage|theft|kam diya|gaayab)\b/,
    );
    // A cashier does not settle it, and is not offered to.
    await expect(
      card(counter.page).getByRole('button', { name: hinglish['owner.cash.settle'] }),
    ).toHaveCount(0);
    expect(
      (
        await call(cashier.token, 'POST', `/admin/galla/handovers/${key}/settle`, {
          note: 'Theek hai',
        })
      ).status,
    ).toBe(403);

    await go(owner.page, '/galla');
    await card(owner.page).getByRole('button', { name: hinglish['owner.cash.settle'] }).click();
    const settle = owner.page.getByRole('dialog');
    await settle
      .getByRole('textbox', { name: hinglish['owner.cash.settleNote'] })
      .fill('Baat ho gayi');
    await settle.getByRole('button', { name: hinglish['owner.cash.settle'] }).click();
    await expect(toast(owner.page, say('owner.cash.settled', { name: driver.name }))).toBeVisible();
    await expect(
      card(owner.page).getByText(hinglish['owner.cash.settledState'], { exact: true }),
    ).toBeVisible();
    await expect(card(owner.page).getByText(/Baat ho gayi/)).toBeVisible();
    // All the figures stay, and the record has every step.
    await expect(card(owner.page).getByText('₹1,400.00')).toBeVisible();
    const steps = await db.cashHandover.findMany({ where: { handoverKey: key } });
    expect(steps.map((row) => row.step).sort()).toEqual(['COUNTED', 'OFFERED', 'SETTLED']);
  } finally {
    await counter.context.close();
    await owner.context.close();
  }
});

test('offering less, then a count that matches it, is still a difference against the deliveries', async ({
  browser,
}) => {
  const cashier = await person(db, 'CASHIER', { name: 'Barabar Wala' });
  const driver = await person(db, 'DRIVER', { name: 'Kam Offer Driver' });
  await handover(driver, 160000, 150000);
  const { context, page } = await signedInDesk(browser, cashier);
  try {
    await go(page, '/galla');
    const sheet = await countIt(page, driver, '1500');
    await sheet.getByRole('button', { name: hinglish['owner.cash.take'] }).click();
    const card = cash(page).locator('article').filter({ hasText: driver.name });
    await expect(card.getByText(hinglish['owner.cash.different'])).toBeVisible();
    await expect(card.getByText('₹1,600.00').first()).toBeVisible();
    await expect(card.getByText('₹1,500.00').first()).toBeVisible();
    await expect(card.locator('dd')).toHaveCount(3);
  } finally {
    await context.close();
  }
});

test('two people count the same cash: the second is told it is done, and it enters once', async ({
  browser,
}) => {
  const one = await person(db, 'CASHIER', { name: 'Pehla Cashier' });
  const two = await person(db, 'MANAGER', { name: 'Doosra Ginne Wala' });
  const driver = await person(db, 'DRIVER', { name: 'Do Log Driver' });
  const key = await handover(driver, 90000, 90000);
  const first = await signedInDesk(browser, one);
  const second = await signedInDesk(browser, two);
  try {
    for (const { page } of [first, second]) await go(page, '/galla');
    const sheet = await countIt(first.page, driver, '900');
    await sheet.getByRole('button', { name: hinglish['owner.cash.take'] }).click();
    await expect(
      toast(first.page, say('owner.cash.countedSame', { name: driver.name })),
    ).toBeVisible();
    // Another figure on the stale card is not taken.
    const stale = await countIt(second.page, driver, '850');
    await stale.getByRole('button', { name: hinglish['owner.cash.take'] }).click();
    await expect(toast(second.page, hinglish['owner.cash.alreadyCounted'])).toBeVisible();
    const counted = await db.cashHandover.findMany({
      where: { handoverKey: key, step: 'COUNTED' },
    });
    expect(counted.map((row) => [row.amountPaise, row.actorId])).toEqual([[90000, one.id]]);
    expect(await db.financialMovement.count({ where: { counterParty: driver.id } })).toBe(1);
  } finally {
    await first.context.close();
    await second.context.close();
  }
});

test('nonsense in the box is not sent, and another shop’s handover is refused', async ({
  browser,
}) => {
  const cashier = await person(db, 'CASHIER', { name: 'Galat Figure' });
  const away = await person(db, 'CASHIER', { name: 'Doosri Dukaan Cashier', shops: [SECOND] });
  const driver = await person(db, 'DRIVER', { name: 'Figure Driver' });
  const key = await handover(driver, 50000, 50000);
  const { context, page } = await signedInDesk(browser, cashier);
  try {
    await go(page, '/galla');
    const sheet = await countIt(page, driver, 'bahut');
    await expect(sheet.getByRole('button', { name: hinglish['owner.cash.take'] })).toBeDisabled();
    await sheet.getByRole('textbox', { name: hinglish['owner.cash.howMuch'] }).fill('-5');
    await expect(sheet.getByRole('button', { name: hinglish['owner.cash.take'] })).toBeDisabled();
    expect(
      (await call(away.token, 'POST', `/admin/galla/handovers/${key}/count`, { countedPaise: 1 }))
        .status,
    ).toBe(403);
    expect(
      (await call(away.token, 'GET', `/admin/galla/handovers?locationId=${MAIN}`)).status,
    ).toBe(403);
  } finally {
    await context.close();
  }
});

test('the accountant reads the drawer and gets no cash counting; a stock keeper has no Galla', async ({
  browser,
}) => {
  const accountant = await person(db, 'ACCOUNTANT', { name: 'Galla Accountant' });
  const keeper = await person(db, 'STOCK_KEEPER');
  const reader = await signedInDesk(browser, accountant);
  const stock = await signedInDesk(browser, keeper);
  try {
    await go(reader.page, '/galla');
    await expect(
      reader.page.getByRole('heading', { name: hinglish['owner.galla.title'] }),
    ).toBeVisible();
    await expect(cash(reader.page)).toHaveCount(0);
    expect(
      (await call(accountant.token, 'GET', `/admin/galla/handovers?locationId=${MAIN}`)).status,
    ).toBe(403);
    await refusedPage(stock.page, '/galla');
    expect(
      (await call(keeper.token, 'GET', `/admin/galla/handovers?locationId=${MAIN}`)).status,
    ).toBe(403);
  } finally {
    await reader.context.close();
    await stock.context.close();
  }
});
