import { expect, test } from '@playwright/test';
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
  SECOND,
  setFix,
} from './world';

test.beforeEach(resetWorld);
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

async function order(extra: { number?: string; deliveryDate?: string; locationId?: string } = {}) {
  const number = extra.number ?? `SC-${randomUUID().slice(0, 6)}`;
  return db.order.create({
    data: {
      number,
      locationId: extra.locationId ?? MAIN,
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
        line1: 'Plot 12, private lane',
        area: 'Kankarbagh',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800020',
      },
      deliveryDate: extra.deliveryDate ?? today(),
      notes: '',
      subtotalPaise: 8000000,
      deliveryFeePaise: 0,
      totalPaise: 8000000,
      items: {
        create: {
          productId: 'cement',
          name: 'Cement',
          unit: '50 kg bag',
          packSize: '',
          quantity: 100,
          pricePaise: 80000,
          listPricePaise: 80000,
          priceVersion: 1,
          lineTotalPaise: 8000000,
        },
      },
      payment: { create: { method: 'COD', status: 'PENDING', amountPaise: 8000000 } },
    },
  });
}
const openKaam = async (page: import('@playwright/test').Page) => {
  await page.getByTestId('tab-kaam').click();
  await page.getByTestId('screen-stock').waitFor();
};

test('today’s loads: material and count only, and a load done with its vehicle', async ({
  page,
}) => {
  const row = await order({ number: 'SC-2047' });
  await order({ number: 'SC-LATER', deliveryDate: '2099-01-01' });
  await linked(page, 'keeper');
  await openKaam(page);
  await expect(page.getByText('Aaj ki loading')).toBeVisible();
  await expect(page.getByText('Order SC-2047')).toBeVisible();
  await expect(page.getByText('100', { exact: true })).toBeVisible();
  await expect(page.getByText('Order SC-LATER')).toHaveCount(0);
  await audit(page, 'loads');
  // No money, no customer, no address: only what the yard needs.
  await expect(page.getByTestId('load-SC-2047')).not.toContainText('₹');
  await expect(page.locator('body')).not.toContainText(/80,000|Test Customer|private lane|udhaar/i);
  await page.getByTestId('load-done-SC-2047').click();
  await audit(page, 'load done');
  await page.getByTestId('load-send').click();
  await expect(page.getByText('Gaadi number').first()).toBeVisible();
  await page.getByTestId('vehicle-input').fill('br01ab1234');
  await page.getByTestId('load-send').click();
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  await expect(floodTitle(page)).toHaveText('Load ho gaya');
  await audit(page, 'load flood');
  expect(await db.orderLoad.findFirstOrThrow({ where: { orderId: row.id } })).toMatchObject({
    vehicle: 'BR01AB1234',
    loadedById: 'keeper',
  });
  expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PREPARING');
  await page.getByTestId('flood-home').click();
  await expect(page.getByTestId('load-finished-SC-2047')).toContainText('Ho gaya');
});

test('no loads today reads plainly', async ({ page }) => {
  await linked(page, 'keeper');
  await openKaam(page);
  await expect(page.getByTestId('loads-empty')).toHaveText('Aaj koi loading nahi');
  await audit(page, 'loads empty');
});

test('a load offline shows it has not gone, and goes once', async ({ page, context }) => {
  const row = await order({ number: 'SC-OFF' });
  await linked(page, 'keeper');
  await openKaam(page);
  await page.getByTestId('load-done-SC-OFF').waitFor();
  await context.setOffline(true);
  await page.getByTestId('load-done-SC-OFF').click();
  await page.getByTestId('vehicle-input').fill('BR01AB0001');
  await page.getByTestId('load-send').click();
  await expect(page.getByTestId('flood-amber')).toBeVisible();
  await expect(page.getByText('Abhi gaya nahi')).toBeVisible();
  await page.getByTestId('flood-home').click();
  await expect(page.getByTestId('load-finished-SC-OFF')).toContainText('Abhi gaya nahi');
  expect(await db.orderLoad.count()).toBe(0);
  await context.setOffline(false);
  await expect
    .poll(() => db.orderLoad.count({ where: { orderId: row.id } }), { timeout: 25000 })
    .toBe(1);
});

test('a truck received, with supplier and photo, goes straight into stock', async ({ page }) => {
  await linked(page, 'keeper');
  await openKaam(page);
  await page.getByTestId('stock-truck').click();
  await page.getByTestId('material-choose').waitFor();
  await audit(page, 'truck');
  await page.getByTestId('truck-send').click();
  await expect(page.getByTestId('form-error')).toContainText('Kaun sa maal?');
  await page.getByTestId('material-choose').click();
  await audit(page, 'pick');
  await page.getByTestId('material-cement').click();
  await audit(page, 'truck chosen');
  await page.getByTestId('truck-qty').fill('200');
  await page.getByRole('button', { name: /\+1$/ }).click();
  await expect(page.getByTestId('truck-qty')).toHaveValue('201');
  await page.getByTestId('truck-send').click();
  await expect(page.getByTestId('form-error')).toContainText('Likho kisse aaya.');
  await page.getByTestId('truck-supplier').fill('Test Depot');
  await page.getByTestId('truck-vehicle').fill('BR01TR9999');
  await page.getByTestId('truck-photo').click();
  await page.getByTestId('photo-take').click();
  await page.getByTestId('photo-use').click();
  await expect(page.getByText('Photo lag gayi')).toBeVisible();
  await page.getByTestId('truck-send').click();
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  await expect(floodTitle(page)).toHaveText('Stock mein jud gaya');
  const receipt = await db.stockReceipt.findFirstOrThrow();
  expect(receipt).toMatchObject({
    productId: 'cement',
    quantity: 201,
    supplierName: 'Test Depot',
    vehicle: 'BR01TR9999',
    actorId: 'keeper',
    locationId: MAIN,
  });
  expect(receipt.evidenceId).toBeTruthy();
  expect(
    await db.evidenceObject.findUniqueOrThrow({ where: { id: receipt.evidenceId! } }),
  ).toMatchObject({ kind: 'KANTA_SLIP', locationId: MAIN });
  expect(
    (
      await db.stockLevel.findUniqueOrThrow({
        where: { productId_locationId: { productId: 'cement', locationId: MAIN } },
      })
    ).quantity,
  ).toBeGreaterThanOrEqual(201);
});

test('damage needs a photo, and only asks: the stock has not moved', async ({ page }) => {
  await linked(page, 'keeper');
  await openKaam(page);
  await page.getByTestId('stock-more').click();
  await audit(page, 'more');
  await page.getByTestId('more-damage').click();
  await page.getByTestId('material-choose').waitFor();
  await audit(page, 'damage');
  await page.getByTestId('material-choose').click();
  await page.getByTestId('material-cement').click();
  await page.getByTestId('damage-qty').fill('12');
  await page.getByTestId('damage-wet').click();
  await page.getByTestId('damage-send').click();
  await expect(page.getByTestId('form-error')).toContainText('Photo zaroori hai.');
  await page.getByTestId('damage-photo').click();
  await page.getByTestId('photo-take').click();
  await page.getByTestId('photo-use').click();
  await page.getByTestId('damage-send').click();
  await expect(page.getByTestId('flood-amber')).toBeVisible();
  await expect(floodTitle(page)).toHaveText('Manager ko bhej diya');
  const list = await adminGet('papa', 'approvals');
  expect(list.items[0].detail).toMatchObject({ quantity: 12 });
  expect(list.items[0].detail.evidenceId).toBeTruthy();
  const asked = await db.approvalRequest.findFirstOrThrow({ where: { kind: 'STOCK_DAMAGE' } });
  expect(asked).toMatchObject({ requestedById: 'keeper', locationId: MAIN });
  expect(asked.payload).toMatchObject({ productId: 'cement', quantity: 12 });
  expect(await db.inventoryMovement.count({ where: { kind: 'MANUAL_ADJUSTMENT' } })).toBe(0);
});

async function openCount() {
  const made = await adminPost('manager', 'stock/counts', {
    locationId: MAIN,
    productIds: ['cement', 'sariya'],
  });
  return made.id as string;
}
test('a blind count: names and empty boxes, one line at a time, and no book figure anywhere', async ({
  page,
}) => {
  await adminPost('papa', 'stock/receive-seed', {}).catch(() => {});
  await db.stockLevel.upsert({
    where: { productId_locationId: { productId: 'cement', locationId: MAIN } },
    update: { quantity: 98765 },
    create: { productId: 'cement', locationId: MAIN, quantity: 98765 },
  });
  const id = await openCount();
  await linked(page, 'keeper');
  const seen: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/stock/counts/'))
      void response
        .text()
        .then((text) => seen.push(text))
        .catch(() => {});
  });
  await openKaam(page);
  await page.getByTestId('open-count').click();
  await page.getByTestId('count-box-cement').waitFor();
  await expect(page.getByTestId('count-progress')).toHaveText('2 me se 0 ho gaye');
  await audit(page, 'count');
  await expect(page.locator('body')).not.toContainText('98765');
  await expect(page.locator('body')).not.toContainText('98,765');
  await expect(page.getByTestId('count-box-cement')).toHaveValue('');

  await page.getByTestId('count-send').click();
  await expect(page.getByTestId('form-error')).toContainText('Pehle sab maal gino.');

  await page.getByTestId('count-box-cement').fill('90000');
  await page.getByTestId('count-box-sariya').click();
  await expect(page.getByTestId('count-progress')).toHaveText('2 me se 1 ho gaye');
  // That line is on the server already, before the count is sent.
  await expect
    .poll(
      async () =>
        (await db.stockCountLine.findFirst({ where: { countId: id, productId: 'cement' } }))
          ?.countedQty,
    )
    .toBe(90000);
  await page.getByTestId('count-box-sariya').fill('3');
  await page.getByTestId('count-send').click();
  // A difference is not this person's to see, so the words are the same either way.
  await expect(floodTitle(page)).toHaveText('Ginti bhej di');
  await expect(page.getByText('Manager dekhega.')).toBeVisible();
  await audit(page, 'count sent');
  await expect(page.locator('body')).not.toContainText('8765');
  expect(seen.join('')).not.toMatch(/systemQty|differenceQty|heldQty|98765/);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain('98765');
  expect((await db.stockCount.findUniqueOrThrow({ where: { id } })).status).toBe('SUBMITTED');
});

test('a count with no difference reads exactly the same', async ({ page }) => {
  await db.stockLevel.upsert({
    where: { productId_locationId: { productId: 'cement', locationId: MAIN } },
    update: { quantity: 5 },
    create: { productId: 'cement', locationId: MAIN, quantity: 5 },
  });
  await db.stockLevel.upsert({
    where: { productId_locationId: { productId: 'sariya', locationId: MAIN } },
    update: { quantity: 7 },
    create: { productId: 'sariya', locationId: MAIN, quantity: 7 },
  });
  const id = await openCount();
  await linked(page, 'keeper');
  await openKaam(page);
  await page.getByTestId('open-count').click();
  await page.getByTestId('count-box-cement').fill('5');
  await page.getByTestId('count-box-sariya').fill('7');
  await page.getByTestId('count-send').click();
  await expect(floodTitle(page)).toHaveText('Ginti bhej di');
  expect((await db.stockCount.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED');
});

test('a double tap adds to stock once, and loads once', async ({ page }) => {
  const row = await order({ number: 'SC-TWICE' });
  await linked(page, 'keeper');
  await openKaam(page);
  await page.getByTestId('load-done-SC-TWICE').click();
  await page.getByTestId('vehicle-input').fill('BR01AB0002');
  await page.getByTestId('load-send').dblclick();
  await expect(floodTitle(page)).toHaveText('Load ho gaya');
  expect(await db.orderLoad.count({ where: { orderId: row.id } })).toBe(1);
  await page.getByTestId('flood-home').click();
  await page.getByTestId('stock-truck').click();
  await page.getByTestId('material-choose').click();
  await page.getByTestId('material-cement').click();
  await page.getByTestId('truck-qty').fill('10');
  await page.getByTestId('truck-supplier').fill('Test Depot');
  await page.getByTestId('truck-send').dblclick();
  await expect(floodTitle(page)).toHaveText('Stock mein jud gaya');
  expect(await db.stockReceipt.count()).toBe(1);
});

test('no count going on reads plainly', async ({ page }) => {
  await linked(page, 'keeper');
  await openKaam(page);
  await page.getByTestId('stock-more').click();
  await page.getByTestId('more-count').click();
  await expect(page.getByTestId('count-none')).toHaveText('Abhi koi ginti nahi');
  await audit(page, 'count none');
});

async function sendTransfer() {
  await db.stockLevel.upsert({
    where: { productId_locationId: { productId: 'cement', locationId: SECOND } },
    update: { quantity: 500 },
    create: { productId: 'cement', locationId: SECOND, quantity: 500 },
  });
  return adminPost('papa', 'stock/transfers', {
    fromLocationId: SECOND,
    toLocationId: MAIN,
    lines: [{ productId: 'cement', quantity: 40 }],
    vehicle: 'BR01TT0001',
    idempotencyKey: randomUUID(),
  });
}
test('a transfer received: counted blind, and it joins this shop', async ({ page }) => {
  const sent = await sendTransfer();
  await linked(page, 'keeper');
  await openKaam(page);
  await page.getByTestId('open-transfers').click();
  await expect(page.getByText('Second shop se')).toBeVisible();
  await expect(page.getByText(/^Nikla: /)).toBeVisible();
  await audit(page, 'transfers');
  await page.getByTestId(`transfer-${sent.id}`).click();
  await expect(page.locator('body')).not.toContainText('40');
  await audit(page, 'transfer receive');
  await page.getByTestId('transfer-send').click();
  await expect(page.getByTestId('form-error')).toContainText('Har maal ka number likho.');
  await page.getByTestId('receive-box-cement').fill('40');
  await page.getByTestId('transfer-send').click();
  await expect(floodTitle(page)).toHaveText('Mil gaya');
  expect(await db.stockTransfer.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({
    status: 'RECEIVED',
    receivedById: 'keeper',
  });
});
test('a transfer with fewer than sent is kept as different, with no blame', async ({ page }) => {
  const sent = await sendTransfer();
  await linked(page, 'keeper');
  await openKaam(page);
  await page.getByTestId('open-transfers').click();
  await page.getByTestId(`transfer-${sent.id}`).click();
  await page.getByTestId('receive-box-cement').fill('35');
  await page.getByTestId('transfer-send').click();
  await expect(floodTitle(page)).toHaveText('Mil gaya');
  expect((await db.stockTransfer.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe(
    'DIFFERENT',
  );
});
test('nothing on the way reads plainly', async ({ page }) => {
  await linked(page, 'keeper');
  await openKaam(page);
  await page.getByTestId('stock-more').click();
  await page.getByTestId('more-transfers').click();
  await expect(page.getByTestId('transfers-none')).toHaveText('Raaste mein koi maal nahi');
});
test('a keeper at another shop does not see this shop’s loads', async ({ page }) => {
  await order({ number: 'SC-OTHER' });
  await linked(page, 'keeperb');
  await openKaam(page);
  await expect(page.getByTestId('loads-empty')).toBeVisible();
});
test('someone with no Kaam, like a helper, has no Kaam tab', async ({ page }) => {
  await linked(page, 'helper');
  await expect(page.getByTestId('tab-kaam')).toHaveCount(0);
  await expect(page.getByTestId('tab-hazri')).toBeVisible();
  await expect(page.getByTestId('tab-paisa')).toBeVisible();
  void setFix;
});
