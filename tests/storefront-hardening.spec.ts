import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { test, expect, isCancelledFetch, verifyAndSkipName } from './fixtures';

// Review findings kept fixed: review survives focus, Back after an order, Patna dates, autofill.
const site = 'http://localhost:3004';
const api = 'http://localhost:4010/api/v1';
const cement = 'test-hard-cement';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (error) => {
    if (!isCancelledFetch(error.message)) list.push(error.message);
  });
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
function database() {
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    !new URL(url).pathname.endsWith('_test') ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  )
    throw new Error('Disposable loopback database required');
  return new PrismaClient({ datasourceUrl: url });
}
test.beforeAll(async () => {
  const db = database();
  try {
    const data = {
      name: 'TEST HARD Cement',
      categoryId: 'cement',
      brand: 'TEST HARD',
      type: 'Cement',
      grade: 'TEST grade',
      unit: 'bag',
      packSize: '50 kg',
      minQuantity: 1,
      quantityStep: 1,
      pricePaise: 38000,
      stock: 500,
      description: 'Disposable test fixture; not product advice.',
      recommendedUse: 'Test only.',
      images: [],
      active: true,
    };
    await db.product.upsert({
      where: { id: cement },
      create: { id: cement, ...data },
      update: data,
    });
  } finally {
    await db.$disconnect();
  }
});
async function login(page: Page, phone: string, next = '/list') {
  await page.goto(`${site}/account?next=${encodeURIComponent(next)}`);
  const field = page.getByRole('main').getByLabel('Mobile number', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill(phone);
  const otp = page.waitForResponse((response) => response.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get sign-in code', exact: true }).click();
  const response = await otp;
  expect(response.status(), await response.text()).toBe(201);
  await page
    .getByRole('main')
    .getByLabel('Six-digit code')
    .fill((await response.json()).devCode);
  await verifyAndSkipName(page, () =>
    page.getByRole('button', { name: 'Verify and continue', exact: true }).click(),
  );
  await expect(page).toHaveURL(`${site}${next}`);
}
async function review(page: Page, phone: string) {
  await login(page, phone);
  const address = await page.request.post(`${api}/me/addresses`, {
    headers: { Origin: site },
    data: {
      label: 'Test site',
      name: 'Website customer',
      phone: `+91${phone}`,
      line1: 'Plot 18',
      area: 'Test Area',
      city: 'Patna',
      state: 'Bihar',
      pincode: '800020',
      landmark: '',
    },
  });
  expect(address.ok(), await address.text()).toBe(true);
  const line = await page.request.put(`${api}/cart/items`, {
    headers: { Origin: site },
    data: { productId: cement, quantity: 2 },
  });
  expect(line.ok(), await line.text()).toBe(true);
  await page.goto(`${site}/checkout`);
  await page.getByRole('radio', { name: 'Deliver here', exact: true }).check();
  await page.getByRole('button', { name: 'Review current order', exact: true }).click();
  await expect(page.getByRole('checkbox')).toBeVisible();
  await page.getByRole('checkbox').check();
}

test('checkout review and consent survive focus and visibility changes', async ({ page }) => {
  await review(page, '9888830001');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  await expect(page.getByRole('checkbox')).toBeChecked();
});

test('placing an order replaces checkout in history, so Back does not reopen an empty checkout', async ({
  page,
}) => {
  await review(page, '9888830002');
  await page.getByRole('button', { name: 'Place COD order', exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/[^?]+\?confirmed=1/);
  await page.goBack();
  await expect(page).not.toHaveURL(`${site}/checkout`);
});

test('checkout defaults to tomorrow in Patna even just after midnight IST', async ({ page }) => {
  // 00:30 on 10 March in Patna is still 9 March in UTC, where the clock may be running.
  await page.clock.setFixedTime(new Date('2026-03-09T19:00:00.000Z'));
  await login(page, '9888830003', '/checkout');
  await expect(page.getByRole('main').getByLabel('Requested delivery date')).toHaveValue(
    '2026-03-11',
  );
});

test('sign-in accepts an autofilled +91 number with spaces', async ({ page }) => {
  await page.goto(`${site}/account`);
  const field = page.getByRole('main').getByLabel('Mobile number', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill('+91 98888 30004');
  const otp = page.waitForResponse((response) => response.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get sign-in code', exact: true }).click();
  expect((await otp).status()).toBe(201);
});

test('sign-in can only send you to our own buying pages afterwards', async ({ page }) => {
  await page.goto(`${site}/account?next=${encodeURIComponent('https://evil.example/')}`);
  const field = page.getByRole('main').getByLabel('Mobile number', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill('9888830005');
  const otp = page.waitForResponse((response) => response.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get sign-in code', exact: true }).click();
  await page
    .getByRole('main')
    .getByLabel('Six-digit code')
    .fill((await (await otp).json()).devCode);
  await verifyAndSkipName(page, () =>
    page.getByRole('button', { name: 'Verify and continue', exact: true }).click(),
  );
  await expect(page).toHaveURL(`${site}/list`);
});

test('signing out clears this person’s list from a shared phone', async ({ page }) => {
  await login(page, '9888830006', '/account');
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        'shiv_list_v1',
        JSON.stringify({
          lines: [
            {
              i: id,
              n: 'Mine',
              u: 'a bori',
              m: 1,
              s: 1,
              r: 100,
              h: `/materials/cement/${id}`,
              q: 1,
            },
          ],
        }),
      ),
    cement,
  );
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('shiv_signed_in_v1'))).toBe('1');
  await page
    .getByRole('main')
    .getByRole('button', { name: /Sign out/ })
    .first()
    .click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('shiv_list_v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('shiv_signed_in_v1'))).toBeNull();
});

test('a failed sign-in check explains that browsing still works', async ({ page }) => {
  await page.route(`${api}/auth/**`, (route) => route.abort());
  await page.goto(`${site}/list`);
  await expect(page.getByRole('alert').filter({ hasText: 'could not be checked' })).toBeVisible();
  await expect(page.locator('[data-site-nav]')).toBeVisible();
});

test('an outage during checkout asks to retry, not to sign in again, and recovers', async ({
  page,
}) => {
  await login(page, '9888830007');
  await page.route(`${api}/auth/**`, (route) => route.abort());
  await page.goto(`${site}/checkout`);
  await expect(
    page.getByRole('heading', { name: 'We could not confirm your sign-in.' }),
  ).toBeVisible();
  await page.unroute(`${api}/auth/**`);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Every detail, before you order.' }),
  ).toBeVisible();
});
