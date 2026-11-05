import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';
import { addSite, apiUrl, appLogin, appUrl, tab } from './app';

const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
test.afterAll(() => db.$disconnect());
test.use({ serviceWorkers: 'block', viewport: { width: 360, height: 800 } });
const freshPhone = () => `9${String(Date.now()).slice(-7)}${Math.floor(10 + Math.random() * 89)}`;
const site = { pincode: '800020', line1: 'Plot 14', name: 'Suresh' };
const cors = { 'access-control-allow-origin': appUrl, 'access-control-allow-credentials': 'true' };

test('a guest sees only what is theirs: sign in and privacy', async ({ page }) => {
  await page.goto(appUrl);
  await tab(page, 'Account').click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Privacy', exact: true })).toBeVisible();
  for (const name of [/^Udhaar/, /^My people/, /^Sites/, /^Sign out/])
    await expect(page.getByRole('button', { name })).toBeHidden();
});

test('the name can be changed', async ({ page }) => {
  await appLogin(page, freshPhone());
  await page.getByRole('button', { name: 'Change your name', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Rakesh Kumar');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rakesh Kumar', exact: true })).toBeVisible();
});

test('the first site supplies the name, and a site can be changed and removed', async ({
  page,
}) => {
  await appLogin(page, freshPhone());
  await addSite(page, { ...site, landmark: 'Near the tank' });
  await expect(page.getByRole('heading', { name: 'Suresh', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Sites/ }).click();
  const row = page.getByRole('button', { name: /^Change /, exact: false }).first();
  await row.click();
  await page.getByRole('textbox', { name: 'Name of this site', exact: true }).fill('Danapur site');
  await page.getByRole('button', { name: 'Save site', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Change Danapur site', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Change Danapur site', exact: true }).click();
  await page.getByRole('button', { name: 'Remove this site', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change Danapur site', exact: true })).toBeHidden();
});

test('a pincode the shop does not serve says so and never guesses an area', async ({ page }) => {
  await appLogin(page, freshPhone());
  await page.getByRole('button', { name: /^Sites/ }).click();
  await page.getByRole('button', { name: 'Add a site', exact: true }).click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByRole('textbox', { name: 'Pincode', exact: true }).fill('110001');
  await expect(
    dialog.getByText('We do not deliver here yet. Ask the shop.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Area', exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Area', exact: true })).toHaveValue('');
});

test('other phones can be signed out, in one row', async ({ page, request }) => {
  const phone = freshPhone();
  await appLogin(page, phone);
  // Skip the wait between codes for one number.
  await db.otpChallenge.deleteMany({ where: { phone: `+91${phone}` } });
  const otp = await request.post(`${apiUrl}/auth/otp/request`, { data: { phone: `+91${phone}` } });
  const other = await request.post(`${apiUrl}/auth/otp/verify`, {
    data: { phone: `+91${phone}`, code: (await otp.json()).devCode, surface: 'CUSTOMER' },
  });
  const token = (await other.json()).accessToken;
  await request
    .get(`${apiUrl}/me`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => expect(r.ok()).toBe(true));
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Sign out of other phones', exact: true }).click();
  await expect(page.getByText('Other phones are signed out.', { exact: true })).toBeVisible();
  const after = await request.get(`${apiUrl}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(after.status()).toBe(401);
});

test('the account can be deleted once no order is open, and nothing stays on the phone', async ({
  page,
}) => {
  const phone = freshPhone();
  await appLogin(page, phone);
  await addSite(page, site);
  await tab(page, 'Account').click();
  await page.getByRole('button', { name: 'Delete my account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Type DELETE to confirm', exact: true }).fill('DELETE');
  await page.getByRole('button', { name: 'Delete my account for good', exact: true }).click();
  await expect(page.getByRole('heading', { name: "Today's rates", exact: true })).toBeVisible();
  await tab(page, 'Account').click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(saved).not.toContain('Plot 14');
  expect(saved).not.toContain('shiv_draft_');
  const left = await db.user.findUnique({ where: { phone: `+91${phone}` } });
  expect(left === null || left.deletedAt !== null).toBe(true);
});

test('an order summary can be shared', async ({ page }) => {
  await appLogin(page, freshPhone());
  await addSite(page, site);
  await tab(page, 'Home').click();
  await page.getByRole('button', { name: 'Add UltraTech Super to your list', exact: true }).click();
  await page.getByTestId('list-bar').click();
  await page.getByRole('button', { name: /^Place order/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Waiting for the shop', exact: true }),
  ).toBeVisible();
  // The web build has no share sheet here; capture what the app hands to it.
  await page.evaluate(() => {
    const shared: unknown[] = [];
    Object.assign(window, { __shared: shared });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: unknown) => {
        shared.push(data);
        return Promise.resolve();
      },
    });
  });
  await page.getByRole('button', { name: 'Share order summary', exact: true }).click();
  const shared = await page.evaluate(() => (window as unknown as { __shared: object[] }).__shared);
  expect(JSON.stringify(shared)).toContain('not a GST invoice');
  expect(JSON.stringify(shared)).toContain('UltraTech Super');
});

test('an unsigned customer sees no udhaar and no My people, on any screen', async ({ page }) => {
  await appLogin(page, freshPhone());
  await expect(page.getByRole('button', { name: /^Udhaar/ })).toBeHidden();
  await expect(page.getByRole('button', { name: /^My people/ })).toBeHidden();
  await tab(page, 'Home').click();
  await expect(page.getByText('Udhaar due', { exact: true })).toBeHidden();
});

test('a signed-off customer sees what they owe, read only, and can name their people', async ({
  page,
}) => {
  const entries = [
    {
      id: 'e1',
      kind: 'SALE_ON_CREDIT',
      amountPaise: 3490000,
      on: '2026-11-02T06:00:00Z',
      orderNumber: 'SC-2026-1',
      channel: '',
    },
    {
      id: 'e2',
      kind: 'PAYMENT_RECEIVED',
      amountPaise: -2000000,
      on: '2026-10-28T06:00:00Z',
      orderNumber: null,
      channel: 'CASH',
    },
  ];
  await page.route(`${apiUrl}/me/khata**`, (route) =>
    route.fulfill({
      headers: cors,
      json: {
        available: true,
        balancePaise: 1490000,
        asOf: '2026-11-03T06:00:00Z',
        remindersStopped: false,
        nextCursor: null,
        entries,
      },
    }),
  );
  await appLogin(page, freshPhone());
  await page.getByRole('button', { name: /^Udhaar/ }).click();
  await expect(page.getByText('You owe the shop', { exact: true })).toBeVisible();
  await expect(page.getByText('₹14,900', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Goods · SC-2026-1', { exact: true })).toBeVisible();
  await expect(page.getByText('Paid in cash', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('switch', { name: 'Reminders about this from the shop' }),
  ).toBeVisible();
  // Read only: no limit, no tags and no notes.
  await expect(page.getByText(/limit|tag|note/i)).toHaveCount(0);
  // The server still refuses an account the shop has not opened udhaar on, whatever the page says.
  await page.getByRole('button', { name: /My people/ }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Munshi');
  await page.getByRole('textbox', { name: 'Mobile', exact: true }).fill('9000000111');
  await page.getByRole('button', { name: 'Add this person', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});
