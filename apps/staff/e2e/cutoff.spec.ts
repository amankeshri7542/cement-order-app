import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  adminPost,
  audit,
  db,
  linked,
  MAIN,
  numbers,
  pairScreen,
  liveQr,
  resetWorld,
  scan,
  signIn,
} from './world';

test.beforeEach(resetWorld);
const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

const stored = (page: Page) => page.evaluate(() => JSON.stringify(localStorage));
async function driverWithTrip(page: Page) {
  const row = await db.order.create({
    data: {
      number: `SC-${randomUUID().slice(0, 6)}`,
      locationId: MAIN,
      userId: 'customer',
      source: 'PHONE',
      createdById: 'manager',
      idempotencyKey: randomUUID(),
      status: 'PREPARING',
      confirmedAt: new Date(),
      confirmedById: 'manager',
      address: {
        name: 'Private Customer',
        phone: '+919000007100',
        line1: 'Private lane 12',
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
          locationId: MAIN,
          vehicle: 'BR01',
          loadedById: 'manager',
          idempotencyKey: randomUUID(),
        },
      },
    },
  });
  await adminPost('manager', 'trips', {
    locationId: MAIN,
    driverId: 'driver',
    orderIds: [row.id],
    idempotencyKey: randomUUID(),
  });
  await linked(page, 'driver');
  await page.getByTestId('tab-kaam').click();
  await page.getByTestId('trip-leave').waitFor();
}

test('a cut-off phone wipes everything it holds, and stays wiped', async ({ page }) => {
  await driverWithTrip(page);
  await page.getByTestId('tab-paisa').click();
  await page.getByTestId('screen-paisa').waitFor();
  // The whole trip was on the phone.
  expect(await stored(page)).toContain('Private lane 12');
  expect(await stored(page)).toContain('staff:cache:');
  await expect.poll(() => stored(page)).toContain('staff:cache:driver:pay');

  await adminPost('manager', 'staff/driver/device/revoke');
  await page.getByTestId('tab-hazri').click();
  await expect(page.getByTestId('screen-cut-off')).toBeVisible();
  await expect(page.getByText('Yeh phone band kar diya gaya')).toBeVisible();
  await audit(page, 'cut off wiped');

  const after = await stored(page);
  expect(after).not.toContain('Private lane 12');
  expect(after).not.toContain('Private Customer');
  expect(after).not.toContain('staff:cache:');
  expect(after).not.toContain('staff_session');
  expect(after).not.toContain('staff:queue');

  // A restart does not bring anything back.
  await page.reload();
  await expect(page.getByTestId('screen-cut-off')).toBeVisible();
  expect(await stored(page)).not.toContain('Private lane 12');
});

test('a phone sitting open finds out by itself within a minute, and wipes', async ({ page }) => {
  await driverWithTrip(page);
  expect(await stored(page)).toContain('Private lane 12');
  await adminPost('manager', 'staff/driver/device/revoke');
  // Nobody touches it.
  await expect(page.getByTestId('screen-cut-off')).toBeVisible({ timeout: 75000 });
  expect(await stored(page)).not.toContain('Private lane 12');
});

test('work waiting on a cut-off phone goes with it, and nothing is sent', async ({
  page,
  context,
}) => {
  await driverWithTrip(page);
  await context.setOffline(true);
  await page.getByTestId('trip-leave').click();
  await expect(page.getByText('Abhi gaya nahi')).toBeVisible();
  await page.getByTestId('flood-home').click();
  expect(await stored(page)).toContain('staff/trips/');
  await adminPost('manager', 'staff/driver/device/revoke');
  await context.setOffline(false);
  await expect(page.getByTestId('screen-cut-off')).toBeVisible({ timeout: 25000 });
  expect(await stored(page)).not.toContain('staff/trips/');
  expect(await db.trip.count({ where: { status: 'OUT' } })).toBe(0);
});

test('a reply landing after the wipe is thrown away, not written back', async ({ page }) => {
  await driverWithTrip(page);
  // The trip list is on its way when the phone finds out it was cut off.
  await page.route('**/staff/trips/mine', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByTestId('tab-paisa').click();
  await page.getByTestId('tab-kaam').click();
  await page.waitForTimeout(300);
  await adminPost('manager', 'staff/driver/device/revoke');
  // Another request meets the cut-off first.
  await page.getByTestId('tab-hazri').click();
  await expect(page.getByTestId('screen-cut-off')).toBeVisible();
  await page.waitForTimeout(3000);
  const after = await stored(page);
  expect(after).not.toContain('Private lane 12');
  expect(after).not.toContain('staff:cache:');
  expect(after).not.toContain('staff_session');
});

test('someone else signing in on a phone still waiting never sees the first person’s work', async ({
  page,
}) => {
  await signIn(page, 'keeper');
  await page.getByTestId('yours-ok').click();
  await page.evaluate(() => {
    localStorage.setItem('staff:cache:keeper:loads', JSON.stringify([{ id: 'secret-load' }]));
    localStorage.setItem(
      'staff:queue',
      JSON.stringify({
        entries: [
          {
            id: 'left-behind',
            kind: 'load',
            method: 'POST',
            path: 'staff/stock/loads/x',
            body: {},
            userId: 'keeper',
            claimsAge: false,
            mono: 0,
            boot: 1,
            carriedMs: 0,
            rebooted: false,
          },
        ],
        failures: [],
      }),
    );
  });
  await page.reload();
  await db.otpChallenge.deleteMany({});
  await db.authRateLimit.deleteMany({});
  await page.evaluate(() => localStorage.removeItem('staff:secure:staff_session'));
  await page.reload();
  await page.getByTestId('phone-input').fill(numbers.helper);
  await page.getByTestId('number-next').click();
  await page.getByTestId('dev-code').waitFor();
  const code = ((await page.getByTestId('dev-code').textContent()) ?? '').replace(/\D/g, '');
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('code-next').click();
  await page.getByTestId('yours-ok').waitFor();
  const after = await stored(page);
  expect(after).not.toContain('secret-load');
  expect(after).not.toContain('left-behind');
});

test('another person’s token gets nothing of mine', async ({ browser }) => {
  const mine = await (
    await browser.newContext({ viewport: { width: 360, height: 640 } })
  ).newPage();
  await linked(mine, 'driver');
  const session = await mine.evaluate(() => localStorage.getItem('staff:secure:staff_session'));
  // Copying the session to another browser gets its reads, but no way to renew without the key.
  const other = await (
    await browser.newContext({ viewport: { width: 360, height: 640 } })
  ).newPage();
  await other.goto('/');
  await other.evaluate((value) => {
    localStorage.setItem('staff:secure:staff_session', value!);
  }, session);
  await db.session.updateMany({
    where: { userId: 'driver', surface: 'STAFF_APP' },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await other.reload();
  // This browser's key is not the phone's, so renewal is refused and it must ask for a code.
  await expect(other.getByTestId('screen-number')).toBeVisible();
  await mine.context().close();
  await other.context().close();
});

test('a phone cut off may link again, as a new request for a person to decide', async ({
  page,
}) => {
  await linked(page, 'keeper');
  await adminPost('manager', 'staff/keeper/device/revoke');
  await page.reload();
  await page.getByTestId('screen-cut-off').waitFor();
  await page.getByTestId('relink').click();
  await db.otpChallenge.deleteMany({});
  await db.authRateLimit.deleteMany({});
  await page.getByTestId('phone-input').fill(numbers.keeper);
  await page.getByTestId('number-next').click();
  await page.getByTestId('dev-code').waitFor();
  const code = ((await page.getByTestId('dev-code').textContent()) ?? '').replace(/\D/g, '');
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('code-next').click();
  await page.getByTestId('yours-ok').click();
  await expect(page.getByTestId('screen-new-phone')).toBeVisible();
  const asked = await db.deviceLinkRequest.findFirstOrThrow({
    where: { userId: 'keeper', status: 'PENDING' },
  });
  expect(asked.kind).toBe('CHANGE');
  void signIn;
});

test('a token renewed in the background keeps working, signed by this phone', async ({ page }) => {
  await linked(page, 'keeper');
  const { token } = await pairScreen();
  // The access token runs out.
  await db.session.updateMany({
    where: { userId: 'keeper', surface: 'STAFF_APP' },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await page.getByTestId('hazri-main').click();
  await scan(page, await liveQr(token));
  await expect(page.getByTestId('flood-ok')).toBeVisible();
  expect(await db.attendanceEvent.count({ where: { userId: 'keeper' } })).toBe(1);
});

test('a session gone for good asks for a code, and loses nothing waiting', async ({ page }) => {
  await linked(page, 'keeper');
  const { token } = await pairScreen();
  const code = await liveQr(token);
  await page.route('**/api/v1/**', (route) => route.abort('internetdisconnected'));
  await page.getByTestId('hazri-main').click();
  await scan(page, code);
  await expect(page.getByTestId('flood-amber')).toBeVisible();
  await page.getByTestId('flood-home').click();
  await page.unroute('**/api/v1/**');
  await db.session.updateMany({
    where: { userId: 'keeper', surface: 'STAFF_APP' },
    data: { expiresAt: new Date(Date.now() - 1000), refreshExpiresAt: new Date(Date.now() - 1000) },
  });
  await page.reload();
  await expect(page.getByTestId('screen-number')).toBeVisible();
  expect(await stored(page)).toContain('attendance/punch');
  await db.otpChallenge.deleteMany({});
  await page.getByTestId('phone-input').fill(numbers.keeper);
  await page.getByTestId('number-next').click();
  await page.getByTestId('dev-code').waitFor();
  const otp = ((await page.getByTestId('dev-code').textContent()) ?? '').replace(/\D/g, '');
  await page.getByTestId('code-input').fill(otp);
  await page.getByTestId('code-next').click();
  await expect
    .poll(() => db.attendanceEvent.count({ where: { userId: 'keeper' } }), { timeout: 25000 })
    .toBe(1);
});
