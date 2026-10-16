import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Owner-desk hardening from the October 2026 audit: the order search must not reload the desk on
// every keystroke (F03), an outage at load is not a sign-out (F15), the money report shows the
// range picked last (F16), failures look like failures (F35) and a crash offers recovery (F22).
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
  await page.goto(desk);
  await page.getByRole('textbox', { name: 'Staff mobile number' }).fill(phone);
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code' }).click();
  await page
    .locator('input[autocomplete="one-time-code"]')
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: 'Open store desk' }).click();
}

async function open(page: Page, route: string, heading: string) {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, route);
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
    await open(page, 'orders', 'Orders');
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
      .getByRole('textbox', { name: 'Search orders' })
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
    await expect(page.getByRole('textbox', { name: 'Search orders' })).toHaveValue('9900000003');
    expect(page.url()).toContain('q=9900000003');
  });

  test('the money report shows the range picked last, not the slower one (F16)', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Today’s money' }).click();
    await expect(page.getByRole('heading', { name: 'Money', exact: true })).toBeVisible();
    const net = page
      .getByRole('region', { name: 'Money summary' })
      .locator('article', { hasText: 'Net collected' });
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
    const firstOfMonth = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(8, 10) === '01';
    const range = page.getByRole('group', { name: 'Date range' });
    // On the 1st, "This month" is the same single day as Today.
    await range.getByRole('button', { name: firstOfMonth ? 'Last 7 days' : 'This month' }).click();
    await range.getByRole('button', { name: 'Today' }).click();
    await slow;
    await page.waitForTimeout(500);
    await expect(range.getByRole('button', { name: 'Today' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(net).not.toContainText('98,76,543');
    await expect(net).toHaveText(todayFigures!);
  });

  test('a Hindi-only category is added and a failure is shown as an alert (F35)', async ({
    page,
  }) => {
    await open(page, 'prices-stock', 'Prices & stock');
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
    await expect(page.getByRole('alert').filter({ hasText: reason })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: reason })).toHaveCount(0);
  });

  test('settings edits survive another owner saving, with a reload notice (F35)', async ({
    page,
  }) => {
    await open(page, 'settings', 'Finance & settings');
    const message = page.getByLabel('Delivery information for customers');
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
    await page.getByRole('button', { name: 'Refresh data' }).click();
    await expect(page.getByText('These settings were changed elsewhere')).toBeVisible();
    await expect(message).toHaveValue('Edited while another owner saves');
    await page.getByRole('button', { name: 'Reload latest settings' }).click();
    await expect(message).toHaveValue(original);
    await expect(page.getByText('These settings were changed elsewhere')).toBeHidden();
  });
});

test('an unreachable server at load offers a retry, not the sign-in form (F15)', async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  let failed = false;
  await page.route('**/api/v1/me', (route) => {
    if (failed) return route.continue();
    failed = true;
    return route.abort('connectionfailed');
  });
  await page.reload();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Could not check sign-in' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

test('a malformed reply shows the recovery screen and Try again restores the desk (F22)', async ({
  page,
}) => {
  let broken = false;
  await page.route('**/api/v1/admin/dashboard', async (route) => {
    if (broken) return route.continue();
    broken = true;
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), lowStock: null } });
  });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  // The dev server's issue badge can sit over the page; a direct click reaches the button.
  await page.getByRole('button', { name: 'Try again' }).dispatchEvent('click');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});
