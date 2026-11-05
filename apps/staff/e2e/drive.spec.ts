import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  adminGet,
  adminPost,
  audit,
  db,
  floodTitle,
  linked,
  MAIN,
  resetWorld,
  tokenFor,
} from './world';

test.beforeEach(resetWorld);
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

async function order(method: 'COD' | 'CREDIT' | 'ONLINE' = 'COD', loaded = true) {
  const row = await db.order.create({
    data: {
      number: `SC-${randomUUID().slice(0, 6)}`,
      locationId: MAIN,
      userId: 'customer',
      source: 'PHONE',
      createdById: 'manager',
      idempotencyKey: randomUUID(),
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      confirmedById: 'manager',
      address: {
        name: 'Test Customer',
        phone: '+919000007100',
        line1: 'Plot 12',
        area: 'Kankarbagh',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800020',
        landmark: 'Mandir ke paas',
      },
      deliveryDate: today(),
      notes: '',
      subtotalPaise: 1850000,
      deliveryFeePaise: 0,
      totalPaise: 1850000,
      items: {
        create: {
          productId: 'cement',
          name: 'Cement',
          unit: '50 kg bag',
          packSize: '',
          quantity: 50,
          pricePaise: 37000,
          listPricePaise: 37000,
          priceVersion: 1,
          lineTotalPaise: 1850000,
        },
      },
      payment: {
        create: {
          method,
          status: method === 'ONLINE' ? 'CAPTURED' : 'PENDING',
          amountPaise: 1850000,
        },
      },
    },
  });
  if (loaded) {
    await db.orderLoad.create({
      data: {
        orderId: row.id,
        locationId: MAIN,
        vehicle: 'BR01AB1234',
        loadedById: 'manager',
        idempotencyKey: randomUUID(),
      },
    });
    await db.order.update({ where: { id: row.id }, data: { status: 'PREPARING' } });
  }
  return row;
}
const trip = async (orderIds: string[]) =>
  adminPost('manager', 'trips', {
    locationId: MAIN,
    driverId: 'driver',
    vehicle: 'BR01AB1234',
    orderIds,
    idempotencyKey: randomUUID(),
  });
const openTrip = async (page: Page) => {
  await page.getByTestId('tab-kaam').click();
  await page.getByTestId('screen-trip').waitFor();
};
const leave = async (page: Page) => {
  await page.getByTestId('trip-leave').click();
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  await page.getByTestId('flood-home').click();
};

test('no trip today reads plainly', async ({ page }) => {
  await linked(page, 'driver');
  await openTrip(page);
  await expect(page.getByTestId('trip-empty')).toHaveText('Aaj koi trip nahi');
  await audit(page, 'trip empty');
});

test('the whole trip, cash delivery: stop card, photo, money, and it reaches the server', async ({
  page,
}) => {
  const row = await order();
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await expect(page.getByText('Aaj ki trip')).toBeVisible();
  await audit(page, 'trip');
  await page.getByTestId('trip-leave').click();
  await expect(floodTitle(page)).toHaveText(/^Maal nikal gaya, /);
  await audit(page, 'trip left');
  expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
    'OUT_FOR_DELIVERY',
  );
  await page.getByTestId('flood-home').click();
  await page.getByTestId('trip-next').click();
  await expect(page.getByTestId('stop-name')).toHaveText('Test Customer');
  await expect(page.getByTestId('stop-address')).toHaveText('Plot 12, Kankarbagh, Mandir ke paas');
  await expect(page.getByTestId('stop-figure')).toHaveText('Lena hai ₹18,500');
  await audit(page, 'stop');
  const fontSize = await page
    .getByTestId('stop-figure')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBe(40);
  // Tap to call, and the map link, go where they should.
  await page.getByTestId('stop-call').click();
  await page.getByTestId('stop-map').click();
  const opened = await page.evaluate(
    () => (globalThis as never as { __staffOpened: string[] }).__staffOpened,
  );
  expect(opened[0]).toBe('tel:+919000007100');
  expect(opened[1]).toContain('https://www.google.com/maps/search/?api=1&query=');
  expect(opened[1]).toContain('Kankarbagh');

  await page.getByTestId('stop-reached').click();
  await expect(page.getByText('Kitna mila?')).toBeVisible();
  await expect(page.getByTestId('money-input')).toHaveValue('18500');
  await audit(page, 'delivered');
  await page.getByTestId('delivered-save').click();
  await expect(page.getByTestId('form-error')).toContainText('Photo lo, ya batao kyun nahi.');
  await page.getByTestId('delivered-photo').click();
  await page.getByTestId('photo-take').click();
  await page.getByTestId('photo-use').click();
  await page.getByTestId('delivered-save').click();
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  await expect(floodTitle(page)).toHaveText(/^Maal pahunch gaya, /);
  await expect(page.getByText('₹18,500 aapke paas hai. Dukaan par do.')).toBeVisible();
  await audit(page, 'delivered flood');
  const updated = await db.order.findUniqueOrThrow({ where: { id: row.id } });
  expect(updated.status).toBe('DELIVERED');
  expect(await db.driverCollection.findFirstOrThrow()).toMatchObject({
    amountPaise: 1850000,
    channel: 'CASH',
    driverId: 'driver',
  });
  const proof = await db.deliveryProof.findFirstOrThrow({ where: { kind: 'DELIVERED' } });
  expect(proof.evidenceId).toBeTruthy();
  await page.getByTestId('flood-home').click();
  await expect(page.getByTestId('trip-cash')).toContainText('₹18,500');
});

test('udhaar: no money screen and nothing taken', async ({ page }) => {
  await db.user.update({
    where: { id: 'customer' },
    data: { creditAllowed: true, creditLimitPaise: 90000000 },
  });
  const row = await order('CREDIT');
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await leave(page);
  await page.getByTestId('trip-next').click();
  await expect(page.getByTestId('stop-figure')).toHaveText('Udhaar: paisa nahi lena');
  await expect(page.locator('body')).not.toContainText(/₹|balance|khata/i);
  await page.getByTestId('stop-reached').click();
  await expect(page.getByTestId('money-input')).toHaveCount(0);
  await page.getByTestId('skip-dark').click();
  await audit(page, 'udhaar delivered');
  await page.getByTestId('delivered-save').click();
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  expect(await db.driverCollection.count()).toBe(0);
  expect(await db.deliveryProof.findFirstOrThrow()).toMatchObject({ skipReason: 'Andhera hai' });
});

test('paid already: nothing to take', async ({ page }) => {
  const row = await order('ONLINE');
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await leave(page);
  await page.getByTestId('trip-next').click();
  await expect(page.getByTestId('stop-figure')).toHaveText('Paisa nahi lena');
});

test('UPI: on the shop’s code, so nothing is in the driver’s hand', async ({ page }) => {
  const row = await order();
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await leave(page);
  await page.getByTestId('trip-next').click();
  await page.getByTestId('stop-reached').click();
  await page.getByTestId('money-upi').click();
  await page.getByTestId('skip-refused').click();
  await page.getByTestId('delivered-save').click();
  await expect(page.getByText('₹18,500 UPI se mila.')).toBeVisible();
  await page.getByTestId('flood-home').click();
  await expect(page.getByTestId('trip-cash')).toContainText('₹0');
  expect(await db.driverCollection.findFirstOrThrow()).toMatchObject({ channel: 'UPI' });
});

test('less than the bill: says so, and the figure given is what goes', async ({ page }) => {
  const row = await order();
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await leave(page);
  await page.getByTestId('trip-next').click();
  await page.getByTestId('stop-reached').click();
  await page.getByTestId('money-input').fill('18000.50');
  await expect(page.getByTestId('money-diff')).toContainText('₹499.50 kam hai.');
  await page.getByTestId('skip-dark').click();
  await page.getByTestId('delivered-save').click();
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  expect((await db.driverCollection.findFirstOrThrow()).amountPaise).toBe(1800050);
});

test('bad money is refused on the phone', async ({ page }) => {
  const row = await order();
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await leave(page);
  await page.getByTestId('trip-next').click();
  await page.getByTestId('stop-reached').click();
  await page.getByTestId('money-input').fill('abc');
  await page.getByTestId('skip-dark').click();
  await page.getByTestId('delivered-save').click();
  await expect(page.getByTestId('form-error')).toContainText('Likho kitna mila.');
  expect(await db.driverCollection.count()).toBe(0);
});

test('goods not loaded: the driver cannot leave, and it says why', async ({ page }) => {
  const row = await order('COD', false);
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await expect(page.getByTestId('trip-not-loaded')).toContainText('Maal abhi load nahi hua.');
  await expect(page.getByTestId('trip-leave')).toHaveCount(0);
  await audit(page, 'not loaded');
});

test('a problem at a stop goes to the manager, once', async ({ page }) => {
  const row = await order();
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await leave(page);
  await page.getByTestId('trip-next').click();
  await page.getByTestId('stop-problem').click();
  for (const words of ['Gaadi nahi pahunch sakti', 'Customer nahi mila', 'Kam maal liya'])
    await expect(page.getByText(words)).toBeVisible();
  await audit(page, 'stop problem');
  await page.getByTestId('stop-problem-CUSTOMER_ABSENT').click();
  await page.getByTestId('stop-problem-note').fill('Phone nahi uthaya');
  await page.getByTestId('stop-problem-send').click();
  await expect(page.getByTestId('flood-amber')).toBeVisible();
  await expect(floodTitle(page)).toHaveText('Manager ko bhej diya');
  expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
    'DELIVERY_EXCEPTION',
  );
  expect(await db.deliveryProof.count({ where: { kind: 'PROBLEM' } })).toBe(1);
});

test('a whole trip offline: cached, queued, "Abhi gaya nahi", and no duplicates', async ({
  page,
  context,
}) => {
  const one = await order();
  const two = await order('CREDIT');
  await db.user.update({
    where: { id: 'customer' },
    data: { creditAllowed: true, creditLimitPaise: 90000000 },
  });
  await trip([one.id, two.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await page.getByTestId('trip-leave').waitFor();
  await context.setOffline(true);
  await page.getByTestId('trip-leave').click();
  await expect(page.getByTestId('flood-amber')).toBeVisible();
  await expect(page.getByText('Abhi gaya nahi')).toBeVisible();
  await audit(page, 'left offline');
  await page.getByTestId('flood-home').click();
  await expect(page.getByTestId('trip-not-sent')).toBeVisible();
  await expect(page.getByTestId('offline-band')).toBeVisible();
  // Everything for the stop is on the phone already.
  await page.getByTestId('trip-next').click();
  await expect(page.getByTestId('stop-figure')).toHaveText('Lena hai ₹18,500');
  await page.getByTestId('stop-reached').click();
  await page.getByTestId('skip-dark').click();
  await page.getByTestId('delivered-save').click();
  await expect(page.getByTestId('flood-amber')).toBeVisible();
  await page.getByTestId('flood-home').click();
  await expect(page.getByTestId('stop-row-1')).toContainText('Abhi gaya nahi');
  await expect(page.getByTestId('trip-cash')).toContainText('₹18,500');
  await page.getByTestId('trip-next').click();
  await page.getByTestId('stop-problem').click();
  await page.getByTestId('stop-problem-NO_ACCESS').click();
  await page.getByTestId('stop-problem-send').click();
  await expect(page.getByTestId('flood-amber')).toBeVisible();
  await page.getByTestId('flood-home').click();
  expect(await db.driverCollection.count()).toBe(0);
  expect((await db.order.findUniqueOrThrow({ where: { id: one.id } })).status).toBe('PREPARING');
  await context.setOffline(false);
  await expect
    .poll(async () => (await db.order.findUniqueOrThrow({ where: { id: one.id } })).status, {
      timeout: 30000,
    })
    .toBe('DELIVERED');
  await expect
    .poll(async () => (await db.order.findUniqueOrThrow({ where: { id: two.id } })).status, {
      timeout: 30000,
    })
    .toBe('DELIVERY_EXCEPTION');
  expect(await db.driverCollection.count()).toBe(1);
  expect(
    await db.orderStatusHistory.count({ where: { orderId: one.id, status: 'DELIVERED' } }),
  ).toBe(1);
  expect(
    await db.orderStatusHistory.count({ where: { orderId: one.id, status: 'OUT_FOR_DELIVERY' } }),
  ).toBe(1);
  // Claimed age went with it.
  expect(
    (await db.deliveryProof.findFirstOrThrow({ where: { kind: 'DELIVERED' } })).claimedAgeMs,
  ).toBeGreaterThan(0);
});

test('a reply lost after the server took it: the retry changes nothing', async ({ page }) => {
  const row = await order();
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await leave(page);
  // The server gets the step; the reply never reaches the phone.
  let dropped = false;
  await page.route('**/delivered', async (route) => {
    const response = await route.fetch();
    if (!dropped) {
      dropped = true;
      await route.abort('connectionreset');
      return;
    }
    await route.fulfill({ response });
  });
  await page.getByTestId('trip-next').click();
  await page.getByTestId('stop-reached').click();
  await page.getByTestId('skip-dark').click();
  await page.getByTestId('delivered-save').click();
  await expect(page.getByTestId('flood-amber')).toBeVisible();
  await expect
    .poll(async () => (await db.order.findUniqueOrThrow({ where: { id: row.id } })).status)
    .toBe('DELIVERED');
  await page.getByTestId('flood-home').click();
  await expect
    .poll(
      () => page.evaluate(() => JSON.parse(localStorage.getItem('staff:queue')!).entries.length),
      {
        timeout: 30000,
      },
    )
    .toBe(0);
  expect(await db.driverCollection.count()).toBe(1);
  expect(await db.deliveryProof.count({ where: { kind: 'DELIVERED' } })).toBe(1);
});

test('a double tap on Save delivers once and takes money once', async ({ page }) => {
  const row = await order();
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await page.getByTestId('trip-leave').dblclick();
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  await page.getByTestId('flood-home').click();
  await page.getByTestId('trip-next').click();
  await page.getByTestId('stop-reached').click();
  await page.getByTestId('skip-dark').click();
  await page.getByTestId('delivered-save').dblclick();
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  expect(await db.driverCollection.count()).toBe(1);
  expect(await db.deliveryProof.count({ where: { kind: 'DELIVERED' } })).toBe(1);
  await page.getByTestId('flood-home').click();
  await page.getByTestId('trip-cash').click();
  await page.getByTestId('cash-give').dblclick();
  await expect(floodTitle(page)).toHaveText('Cashier ki ginti baaki');
  expect(await db.cashHandover.count()).toBe(1);
});

test('cash: given to the cashier, waiting, then done', async ({ page }) => {
  const row = await order();
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await leave(page);
  await page.getByTestId('trip-next').click();
  await page.getByTestId('stop-reached').click();
  await page.getByTestId('skip-dark').click();
  await page.getByTestId('delivered-save').click();
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  await page.getByTestId('flood-home').click();
  await page.getByTestId('trip-cash').click();
  await expect(page.getByTestId('cash-figure')).toHaveText('₹18,500');
  await expect(page.getByText('Dukaan par do.')).toBeVisible();
  await audit(page, 'cash');
  await page.getByTestId('cash-give').click();
  await expect(floodTitle(page)).toHaveText('Cashier ki ginti baaki');
  await audit(page, 'cash waiting');
  await page.getByTestId('flood-home').click();
  await expect(page.getByTestId('handover-waiting')).toBeVisible();
  await expect(page.getByTestId('cash-none')).toBeVisible();
  const [handover] = await db.cashHandover.findMany();
  await adminPost('cashier', `galla/handovers/${handover!.handoverKey}/count`, {
    countedPaise: 1850000,
  });
  await page.reload();
  await page.getByTestId('tab-kaam').click();
  await page.getByTestId('trip-cash').click();
  await expect(page.getByTestId('handover-done')).toContainText('Ginti ho gayi, sab theek');
});

test('count differs: both numbers stay, the driver is told plainly, and no one is blamed', async ({
  page,
}) => {
  const row = await order();
  await trip([row.id]);
  await linked(page, 'driver');
  await openTrip(page);
  await leave(page);
  await page.getByTestId('trip-next').click();
  await page.getByTestId('stop-reached').click();
  await page.getByTestId('skip-dark').click();
  await page.getByTestId('delivered-save').click();
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  await page.getByTestId('flood-home').click();
  await page.getByTestId('trip-cash').click();
  await page.getByTestId('cash-give').click();
  await expect(floodTitle(page)).toHaveText('Cashier ki ginti baaki');
  const [handover] = await db.cashHandover.findMany();
  await adminPost('cashier', `galla/handovers/${handover!.handoverKey}/count`, {
    countedPaise: 1800000,
  });
  await page.reload();
  await page.getByTestId('tab-kaam').click();
  await page.getByTestId('trip-cash').click();
  const card = page.getByTestId('handover-different');
  await expect(card).toContainText('₹500 ka fark');
  await expect(card).toContainText('Aapne ₹18,500 kaha. Cashier ne ₹18,000 gina. Malik dekhega.');
  await expect(page.locator('body')).not.toContainText(/chori|thief|galti|blame/i);
  await audit(page, 'count differs');
  void adminGet;
  void tokenFor;
});

test('another driver’s trip is not on this phone', async ({ page }) => {
  const row = await order();
  await trip([row.id]);
  await linked(page, 'driverb');
  await openTrip(page);
  await expect(page.getByTestId('trip-empty')).toBeVisible();
});
