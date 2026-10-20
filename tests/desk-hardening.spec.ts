import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { en } from '@shiv/i18n';

// Owner-desk hardening from the October 2026 audit: the order search must not reload the desk on
// every keystroke (F03), an outage at load is not a sign-out (F15), the money report shows the
// range picked last (F16), failures look like failures (F35) and bad replies offer recovery (F22).
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const api = 'http://localhost:4010/api/v1';
const phone = '9297513751';
const categoryPrefix = 'जाँच श्रेणी';
// Routed requests must reach the page, not the desk's alert worker.
test.use({ actionTimeout: 15000, serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Desk hardening journeys require the disposable _test database.');
  await db.user.createMany({
    skipDuplicates: true,
    data: [{ phone: `+91${phone}`, name: 'Desk hardening owner', role: 'ADMIN' as const }],
  });
});
test.afterAll(async () => {
  await db.category.deleteMany({
    where: { name: { startsWith: categoryPrefix }, slug: { startsWith: 'cat-' } },
  });
  await db.$disconnect();
});

async function signIn(page: Page) {
  await page.goto(`${desk}/today`);
  await page.getByRole('textbox', { name: en['owner.loginPhone'] }).fill(phone);
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: en['owner.sendCode'] }).click();
  await page
    .locator('input[autocomplete="one-time-code"]')
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: en['owner.signIn'] }).click();
}

async function open(page: Page, route: string, heading: string) {
  await page.goto(`${desk}${route}`);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}
test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  });

  test('typing an order search loads once and keeps the live stream open (F03)', async ({
    page,
  }) => {
    await open(page, '/orders', en['owner.orders']);
    // Let the sign-in load and the live stream's first refresh finish.
    await page.waitForTimeout(1500);
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/')) requests.push(request.url());
    });
    const searched = page.waitForResponse(
      (r) => r.url().includes('/admin/orders?') && r.url().includes('q=9900000003'),
    );
    await page
      .getByRole('searchbox', { name: en['owner.searchOrders'] })
      .pressSequentially('9900000003', { delay: 40 });
    await searched;
    await page.waitForTimeout(1000);
    const streams = requests.filter((url) => url.includes('/admin/events'));
    const calls = requests.filter((url) => !url.includes('/admin/events'));
    expect(streams, 'no new live-stream connections while typing').toEqual([]);
    expect(calls.length, calls.join('\n')).toBeLessThanOrEqual(8);
    expect(
      calls.filter((url) => url.includes('/admin/orders?') && !url.includes('q=9900000003')),
      'no partial searches reach the server',
    ).toEqual([]);
    await expect(page.getByRole('searchbox', { name: en['owner.searchOrders'] })).toHaveValue(
      '9900000003',
    );
    await expect(page).toHaveURL(`${desk}/orders`);
  });

  test('the money report shows the range picked last, not the slower one (F16)', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-10-20T06:00:00Z') });
    await open(page, '/more?view=reports', en['owner.reports']);
    const net = page.locator('section').filter({
      has: page.getByRole('heading', { name: en['owner.collections'], exact: true }),
    });
    await expect(net).toBeVisible();
    const todayFigures = await net.textContent();
    // Every range longer than one day answers slowly, with a figure Today cannot have.
    await page.route(
      (url) =>
        url.pathname.endsWith('/admin/reports/money') &&
        url.searchParams.get('from') !== url.searchParams.get('to'),
      async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.fulfill({ response, json: { ...body, netPaise: 987654321 } });
      },
    );
    const slow = page.waitForResponse(
      (r) =>
        r.url().includes('/admin/reports/money?') &&
        new URL(r.url()).searchParams.get('from') !== new URL(r.url()).searchParams.get('to'),
    );
    await page.getByRole('button', { name: en['owner.month'], exact: true }).click();
    await page.getByRole('button', { name: en['owner.today'], exact: true }).click();
    await slow;
    await page.waitForTimeout(500);
    await expect(
      page.getByRole('button', { name: en['owner.today'], exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(net).not.toContainText('98,76,543');
    await expect(net).toHaveText(todayFigures!);
  });

  test('a Hindi-only category is added and a failure is shown as an alert (F35)', async ({
    page,
  }) => {
    await open(page, '/more?view=products', en['owner.materials']);
    const name = `${categoryPrefix} ${String(Date.now() % 100000).replace(/\d/g, (d) => '०१२३४५६७८९'[Number(d)]!)}`;
    await page.getByRole('textbox', { name: 'New category name' }).fill(name);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Category added' })).toBeVisible();
    const saved = await db.category.findFirstOrThrow({ where: { name } });
    expect(saved.slug).toMatch(/^cat-[a-z0-9]+$/);

    const reason = 'Someone else changed this just now.';
    // A made-up reply crosses origins (desk → API), so it carries the API's CORS headers.
    await page.route('**/api/v1/admin/categories', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 409,
            headers: {
              'access-control-allow-origin': desk,
              'access-control-allow-credentials': 'true',
            },
            json: { error: { code: 'CONFLICT', message: reason } },
          })
        : route.continue(),
    );
    await page.getByRole('textbox', { name: 'New category name' }).fill(`${categoryPrefix} दो`);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByRole('alert').filter({ hasText: en['error.CONFLICT'] })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: en['error.CONFLICT'] })).toHaveCount(0);
  });

  test('settings edits survive another owner saving, with a reload notice (F35)', async ({
    page,
  }) => {
    await open(page, '/more?view=store', en['owner.storeDetails']);
    const message = page.getByLabel(en['owner.deliveryMessage'], { exact: true });
    const original = await message.inputValue();
    await message.fill('Edited while another owner saves');
    // The other owner saves the same values; only the version moves.
    await page.evaluate(async (base) => {
      const store = await (await fetch(`${base}/store`, { credentials: 'include' })).json();
      const response = await fetch(`${base}/admin/store`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: store.version,
          phone: store.phone,
          deliveryFeePaise: store.deliveryFeePaise,
          freeDeliveryAbovePaise: store.freeDeliveryAbovePaise,
          onlinePaymentsEnabled: store.onlinePaymentsEnabled,
          deliveryMessage: store.deliveryMessage,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
    }, api);
    const stale = page.waitForResponse(
      (r) => r.url().endsWith('/admin/store') && r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: en['owner.save'], exact: true }).click();
    const response = await stale;
    expect(response.status()).toBe(409);
    expect((await response.json()).error.code).toBe('CONFLICT');
    await expect(page.getByRole('alert').filter({ hasText: en['error.CONFLICT'] })).toBeVisible();
    await expect(message).toHaveValue('Edited while another owner saves');
    // A confirmed reload discards the draft and fetches the latest server version.
    await page.reload();
    await expect(message).toHaveValue(original);
    await expect(page.getByRole('alert').filter({ hasText: en['error.CONFLICT'] })).toHaveCount(0);
  });
});

test('an unreachable server at load offers a retry, not the sign-in form (F15)', async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  // Unreachable until Try again: the dev server checks the session twice on load (React strict
  // mode), so failing only the first check would let the second one through.
  let offline = true;
  await page.route('**/api/v1/auth/session', (route) =>
    offline ? route.abort('connectionfailed') : route.continue(),
  );
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: en['error.network'] })).toBeVisible();
  await expect(page.getByRole('textbox', { name: en['owner.loginPhone'] })).toHaveCount(0);
  offline = false;
  await page.getByRole('button', { name: en['owner.retry'], exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

test('a malformed reply shows a query error and Try again restores the dashboard (F22)', async ({
  page,
}) => {
  let broken = true;
  await page.route('**/api/v1/admin/dashboard', async (route) => {
    if (!broken) return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, contentType: 'application/json', body: '{ invalid JSON' });
  });
  await signIn(page);
  await expect(page.getByRole('alert').filter({ hasText: en['error.network'] })).toBeVisible();
  await expect(page.getByRole('textbox', { name: en['owner.loginPhone'] })).toHaveCount(0);
  broken = false;
  await page.getByRole('button', { name: en['owner.retry'], exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: en['error.CONFLICT'] })).toHaveCount(0);
  await expect(page.getByText(en['owner.todayCollections'], { exact: true })).toBeVisible();
});
test('a pasted +91 or 91 number keeps the right ten digits on the desk sign-in', async ({
  page,
}) => {
  await page.goto(`${desk}/today`);
  const field = page.getByRole('textbox', { name: en['owner.loginPhone'] });
  // Before the fix, "919297513751" became "9192975137", a different valid mobile.
  for (const pasted of [`91${phone}`, '+91 92975 13751', '092975-13751']) {
    await field.fill(pasted);
    await expect(field).toHaveValue(phone);
  }
});
