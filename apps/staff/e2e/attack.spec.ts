import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  adminPost,
  db,
  floodTitle,
  linked,
  liveQr,
  MAIN,
  pairScreen,
  resetWorld,
  scan,
  SECOND,
  SHOP,
  setFix,
} from './world';
import { staffE2E } from '../../../playwright.staff.config';

test.beforeEach(resetWorld);

const session = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('staff:secure:staff_session')!) as {
        access: string;
        refresh: string;
        userId: string;
      },
  );
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
async function order(driverId = 'driver', locationId = MAIN) {
  const row = await db.order.create({
    data: {
      number: `SC-${randomUUID().slice(0, 6)}`,
      locationId,
      userId: 'customer',
      source: 'PHONE',
      createdById: 'manager',
      idempotencyKey: randomUUID(),
      status: 'PREPARING',
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
      },
      deliveryDate: today(),
      notes: '',
      subtotalPaise: 100000,
      deliveryFeePaise: 0,
      totalPaise: 100000,
      payment: { create: { method: 'COD', status: 'PENDING', amountPaise: 100000 } },
      loads: {
        create: {
          locationId,
          vehicle: 'BR01',
          loadedById: 'manager',
          idempotencyKey: randomUUID(),
        },
      },
    },
  });
  const trip = await adminPost('papa', 'trips', {
    locationId,
    driverId,
    orderIds: [row.id],
    idempotencyKey: randomUUID(),
  });
  return { row, tripId: trip.id as string };
}

test('a scan changed on the way fails the phone’s signature: red, and nothing saved', async ({
  page,
}) => {
  await linked(page, 'keeper');
  const { token } = await pairScreen();
  await page.route('**/attendance/punch', async (route) => {
    const body = route.request().postDataJSON();
    await route.continue({ postData: JSON.stringify({ ...body, lat: 25.9, lng: 85.9 }) });
  });
  await page.getByTestId('hazri-main').click();
  await scan(page, await liveQr(token));
  await expect(page.getByTestId('flood-red')).toBeVisible();
  await expect(floodTitle(page)).toHaveText('Yeh phone pehchana nahi gaya');
  expect(await db.attendanceEvent.count()).toBe(0);
});

test('a recorded scan sent again is one record with the first answer', async ({ page }) => {
  await linked(page, 'keeper');
  const { token } = await pairScreen();
  let sent = '';
  await page.route('**/attendance/punch', async (route) => {
    sent = route.request().postData() ?? '';
    await route.continue();
  });
  await page.getByTestId('hazri-main').click();
  await scan(page, await liveQr(token));
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  const { access } = await session(page);
  const replay = await fetch(`${staffE2E.api}/attendance/punch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: sent,
  }).then((res) => res.json());
  expect(replay.replay).toBe(true);
  expect(await db.attendanceEvent.count({ where: { userId: 'keeper' } })).toBe(1);
});

test('a captured scan cannot be turned into a later one by changing its age', async ({ page }) => {
  await linked(page, 'keeper');
  const { token } = await pairScreen();
  let sent: Record<string, unknown> = {};
  await page.route('**/attendance/punch', async (route) => {
    sent = route.request().postDataJSON();
    await route.abort('internetdisconnected');
  });
  await page.getByTestId('hazri-main').click();
  await scan(page, await liveQr(token));
  await expect(page.getByTestId('flood-amber')).toBeVisible();
  const { access } = await session(page);
  const reply = await fetch(`${staffE2E.api}/attendance/punch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...sent, claimedAgeMs: 90000 }),
  });
  expect(reply.status).toBe(403);
});

test('another person’s token cannot read this driver’s trip, or walk their stops', async ({
  browser,
}) => {
  const driver = await (
    await browser.newContext({ viewport: { width: 360, height: 640 } })
  ).newPage();
  const keeper = await (
    await browser.newContext({ viewport: { width: 360, height: 640 } })
  ).newPage();
  const { row, tripId } = await order();
  await linked(driver, 'driver');
  await linked(keeper, 'keeper');
  const { access } = await session(keeper);
  const headers = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' };
  expect((await fetch(`${staffE2E.api}/staff/trips/mine`, { headers })).status).toBe(403);
  expect(
    (
      await fetch(`${staffE2E.api}/staff/trips/${tripId}/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ idempotencyKey: randomUUID() }),
      })
    ).status,
  ).toBe(403);
  expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PREPARING');
  await driver.context().close();
  await keeper.context().close();
});

test('another driver’s stop on a tampered queue is refused, and told plainly', async ({ page }) => {
  const { row } = await order('driverb', SECOND);
  await linked(page, 'driver');
  const stop = await db.tripStop.findFirstOrThrow({ where: { orderId: row.id } });
  await page.evaluate((id) => {
    localStorage.setItem(
      'staff:queue',
      JSON.stringify({
        entries: [
          {
            id: 'k1',
            kind: 'delivered',
            method: 'POST',
            path: `staff/stops/${id}/delivered`,
            body: { idempotencyKey: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', skipReason: 'x' },
            userId: 'driver',
            claimsAge: true,
            mono: Date.now(),
            boot: 1,
            carriedMs: 0,
            rebooted: false,
          },
        ],
        failures: [],
      }),
    );
  }, stop.id);
  await page.reload();
  await expect(page.getByTestId('failed-band')).toContainText('Yeh trip kisi aur ki hai.');
  expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PREPARING');
  await page.getByTestId('failed-ok').click();
  await expect(page.getByTestId('failed-band')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('screen-hazri').waitFor();
  await expect(page.getByTestId('failed-band')).toHaveCount(0);
});

test('rights edited on the phone change nothing: the server decides', async ({ page }) => {
  await linked(page, 'helper');
  await expect(page.getByTestId('tab-kaam')).toHaveCount(0);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.endsWith(':today'))!;
    const today = JSON.parse(localStorage.getItem(key)!);
    today.access = [...today.access, 'trip.drive', 'stock.load', 'stock.report'];
    localStorage.setItem(key, JSON.stringify(today));
  });
  await page.reload();
  await page.getByTestId('screen-hazri').waitFor();
  // The next answer from the server puts it right.
  await expect(page.getByTestId('tab-kaam')).toHaveCount(0);
  const { access } = await session(page);
  expect(
    (
      await fetch(`${staffE2E.api}/staff/trips/mine`, {
        headers: { Authorization: `Bearer ${access}` },
      })
    ).status,
  ).toBe(403);
});

test('a Wi-Fi login page saying 200 does not lose a saved scan', async ({ page }) => {
  await linked(page, 'keeper');
  const { token } = await pairScreen();
  const code = await liveQr(token);
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Sign in to Wi-Fi</html>' }),
  );
  await page.getByTestId('hazri-main').click();
  await scan(page, code);
  await expect(floodTitle(page)).toHaveText('Scan phone mein save hai');
  await expect(page.getByText('Abhi gaya nahi')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('staff:queue'))).toContain(
    'attendance/punch',
  );
  await page.unroute('**/api/v1/**');
  await page.getByTestId('flood-home').click();
  await expect
    .poll(() => db.attendanceEvent.count({ where: { userId: 'keeper' } }), { timeout: 30000 })
    .toBe(1);
});

test('the server down mid-flow is amber, and a retry lands exactly once', async ({ page }) => {
  await linked(page, 'keeper');
  const { token } = await pairScreen();
  let failures = 2;
  await page.route('**/attendance/punch', async (route) => {
    if (failures-- > 0)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":{"code":"DOWN"}}',
      });
    else await route.continue();
  });
  await page.getByTestId('hazri-main').click();
  await scan(page, await liveQr(token));
  await expect(floodTitle(page)).toHaveText('Scan phone mein save hai');
  await page.getByTestId('flood-home').click();
  await expect
    .poll(() => db.attendanceEvent.count({ where: { userId: 'keeper' } }), { timeout: 40000 })
    .toBe(1);
});

test('location off at the phone still cannot be sent as inside the shop', async ({ page }) => {
  await linked(page, 'keeper');
  await setFix(page, { status: 'DENIED', fix: { ...SHOP, accuracyM: 5, mocked: false } });
  const { token } = await pairScreen();
  await page.getByTestId('hazri-main').click();
  let sent: Record<string, unknown> = {};
  await page.route('**/attendance/punch', async (route) => {
    sent = route.request().postDataJSON();
    await route.continue();
  });
  await scan(page, await liveQr(token));
  await expect(page.getByTestId('flood-amber')).toBeVisible();
  expect(sent.location).toBe('DENIED');
  expect(sent.lat).toBeUndefined();
});
