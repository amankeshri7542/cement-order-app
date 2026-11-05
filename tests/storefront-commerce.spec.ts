import { PrismaClient } from '@prisma/client';
import type { APIRequestContext, Page } from '@playwright/test';
import { productSchema } from '@shiv/shared';
import { test, expect, isCancelledFetch, verifyAndSkipName } from './fixtures';

// One list with three exits, sign-in, checkout and rate requests.
const site = 'http://localhost:3004';
const api = 'http://localhost:4010/api/v1';
const first = 'test-web-cement';
const second = 'test-web-steel';
const big = 'test-web-big';
const empty = 'test-web-empty';
const onRequest = 'test-web-order-only';
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
const fixtures = [
  {
    id: first,
    name: 'TEST WEB Cement PPC',
    unit: '50 kg bag',
    minQuantity: 1,
    quantityStep: 1,
    pricePaise: 38000,
    stock: 1000,
  },
  {
    id: second,
    name: 'TEST WEB Steel TMT',
    unit: 'kg',
    minQuantity: 5,
    quantityStep: 5,
    pricePaise: 6500,
    stock: 1000,
  },
  {
    id: big,
    name: 'TEST WEB Costly',
    unit: '50 kg bag',
    minQuantity: 1,
    quantityStep: 1,
    pricePaise: 90000000,
    stock: 1000,
  },
  {
    id: empty,
    name: 'TEST WEB Empty',
    unit: '50 kg bag',
    minQuantity: 1,
    quantityStep: 1,
    pricePaise: 38000,
    stock: 0,
  },
  {
    id: onRequest,
    name: 'TEST WEB Order Only',
    unit: '50 kg bag',
    minQuantity: 1,
    quantityStep: 1,
    pricePaise: 38000,
    stock: 10,
    sourcing: 'ON_REQUEST' as const,
  },
];
test.beforeAll(async () => {
  const db = database();
  try {
    for (const row of fixtures) {
      const data = {
        ...row,
        categoryId: 'cement',
        brand: 'TEST WEB',
        type: 'Test',
        grade: 'TEST grade',
        packSize: '',
        description: 'Disposable test fixture; not product advice.',
        recommendedUse: 'Test only.',
        images: [],
        active: true,
      };
      await db.product.upsert({ where: { id: row.id }, create: data, update: data });
    }
  } finally {
    await db.$disconnect();
  }
});

/** Puts lines straight on the list, as tapping Add on a public page does. */
async function fillList(
  page: Page,
  lines: {
    id: string;
    qty: number;
    name?: string;
    rate?: number | null;
    min?: number;
    step?: number;
  }[],
) {
  await page.goto(`${site}/about`);
  await page.evaluate((rows) => {
    localStorage.setItem(
      'shiv_list_v1',
      JSON.stringify({
        lines: rows.map((row) => ({
          i: row.id,
          n: row.name ?? `Name of ${row.id}`,
          u: 'a bori (50 kg)',
          m: row.min ?? 1,
          s: row.step ?? 1,
          r: row.rate === undefined ? 38000 : row.rate,
          h: `/materials/cement/${row.id}`,
          q: row.qty,
        })),
      }),
    );
  }, lines);
}
const exit = (page: Page, name: 'order' | 'whatsapp' | 'rate') =>
  page.locator(`[data-exit="${name}"]`);

async function signIn(page: Page, phone: string, next: string) {
  await page.goto(`${site}/account?next=${encodeURIComponent(next)}`);
  await signInHere(page, phone);
  await expect(page).toHaveURL(`${site}${next}`);
}
async function signInHere(page: Page, phone: string) {
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
}
async function seedAddress(page: Page, phone: string) {
  const response = await page.request.post(`${api}/me/addresses`, {
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
  expect(response.ok(), await response.text()).toBe(true);
}
async function token(request: APIRequestContext, phone = '+919999997009') {
  const response = await request.post(`${api}/auth/otp/request`, { data: { phone } });
  expect(response.ok()).toBe(true);
  const verified = await request.post(`${api}/auth/otp/verify`, {
    data: { phone, code: (await response.json()).devCode },
  });
  expect(verified.ok()).toBe(true);
  return { Authorization: `Bearer ${(await verified.json()).accessToken}` };
}
/** Signed in, one line on the list, placed through to the checkbox on the review. */
async function checkout(page: Page, phone: string) {
  await signIn(page, phone, '/list');
  await seedAddress(page, phone);
  await page.evaluate(
    ([id]) => {
      localStorage.setItem(
        'shiv_list_v1',
        JSON.stringify({
          lines: [
            {
              i: id,
              n: 'TEST WEB Cement PPC',
              u: 'a bori (50 kg)',
              m: 1,
              s: 1,
              r: 38000,
              h: `/materials/cement/${id}`,
              q: 2,
            },
          ],
        }),
      );
    },
    [first],
  );
  await page.goto(`${site}/list`);
  await expect(exit(page, 'order')).toBeVisible();
  await exit(page, 'order').click();
  await expect(page).toHaveURL(`${site}/checkout`);
  await page.getByRole('radio', { name: 'Deliver here', exact: true }).check();
  await page.getByRole('button', { name: 'Review current order', exact: true }).click();
  await expect(page.getByRole('checkbox')).toBeVisible();
  await page.getByRole('checkbox').check();
}

test('an empty list says how buying works, and offers no exit', async ({ page }) => {
  await page.goto(`${site}/list`);
  await expect(page.getByRole('heading', { name: 'Nothing yet.' })).toBeVisible();
  await expect(page.locator('[data-exit]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'See the rates' })).toBeVisible();
});

test('Add builds the list on a public page: count, stepper, slip, and it survives a reload', async ({
  page,
  request,
}) => {
  await expect
    .poll(
      async () =>
        (await (await request.get(`${site}/rates`)).text()).includes('TEST WEB Cement PPC'),
      { timeout: 30000 },
    )
    .toBe(true);
  await page.goto(`${site}/rates`);
  const count = page.locator('[data-site-nav] [data-list-count]');
  const row = page.getByRole('row', { name: /TEST WEB Steel TMT/ });
  await expect(count).toHaveText('0');
  // The step and minimum are 5.
  await row.getByRole('button', { name: 'One more TEST WEB Steel TMT' }).click();
  await expect(row.locator('output')).toHaveText('5');
  await expect(count).toHaveText('1');
  await row.getByRole('button', { name: 'One more TEST WEB Steel TMT' }).click();
  await expect(row.locator('output')).toHaveText('10');
  const slip = page.locator('[data-slip]').first();
  await expect(slip).toContainText('10 × TEST WEB Steel TMT');
  await expect(slip).toContainText('₹650');
  await page.reload();
  await expect(count).toHaveText('1');
  await expect(row.locator('output')).toHaveText('10');
  await row.getByRole('button', { name: 'One less TEST WEB Steel TMT' }).click();
  await row.getByRole('button', { name: 'One less TEST WEB Steel TMT' }).click();
  await expect(row.locator('output')).toHaveText('0');
  await expect(count).toHaveText('0');
});

test('a stage row with several brands opens a chooser; one with a single product adds it', async ({
  page,
  request,
}) => {
  await expect
    .poll(
      async () => (await (await request.get(`${site}/`)).text()).includes('TEST WEB Cement PPC'),
      { timeout: 30000 },
    )
    .toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(site);
  // Before the page is live this is a plain link to the cement page, on purpose.
  await page.waitForLoadState('networkidle');
  const panel = page.locator('[data-panel="0"]');
  await panel.getByRole('link', { name: 'Add Cement to your list' }).click();
  const dialog = page.getByRole('dialog', { name: 'Which cement?' });
  await expect(dialog).toBeVisible();
  // The link opens the chooser and stays here; it does not also go to the cement page behind it.
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(`${site}/`);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Not sure which? How to choose')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add TEST WEB Cement PPC to your list' }).click();
  await expect(page.locator('[data-site-nav] [data-list-count]')).toHaveText('1');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('all fine: Place order leads, and the list shows the rate, total and sample tag', async ({
  page,
}) => {
  await fillList(page, [{ id: first, qty: 3, name: 'TEST WEB Cement PPC' }]);
  await page.goto(`${site}/list`);
  await expect(exit(page, 'order')).toHaveClass(/btn-solid/);
  await expect(exit(page, 'rate')).toHaveClass(/btn-quiet/);
  await expect(page.getByRole('main').getByText('Sample rates, not real prices')).toBeVisible();
  await expect(page.locator('[data-order-off]')).toHaveCount(0);
  await expect(page.getByRole('main').getByText('₹1,140').first()).toBeVisible();
});

test('a line over the fixed online limit: Ask for a rate leads, with the reason on the line', async ({
  page,
}) => {
  await fillList(page, [{ id: big, qty: 1, name: 'TEST WEB Costly', rate: 90000000 }]);
  await page.goto(`${site}/list`);
  await expect(exit(page, 'rate')).toHaveClass(/btn-solid/);
  await expect(exit(page, 'order')).toHaveCount(0);
  await expect(page.locator('[data-order-off]')).toContainText('the shop will reply');
  await expect(page.getByRole('listitem').filter({ hasText: 'TEST WEB Costly' })).toContainText(
    'Large for an online order',
  );
});

test('out of stock and brought-in-to-order lines also go to Ask for a rate, and no count ever shows', async ({
  page,
}) => {
  await fillList(page, [
    { id: empty, qty: 1, name: 'TEST WEB Empty' },
    { id: onRequest, qty: 1, name: 'TEST WEB Order Only', rate: null },
  ]);
  const checks: string[] = [];
  page.on('response', async (response) => {
    if (response.url().endsWith('/public/list-check')) checks.push(await response.text());
  });
  await page.goto(`${site}/list`);
  await expect(exit(page, 'rate')).toHaveClass(/btn-solid/);
  const lines = page.getByRole('main').getByRole('listitem');
  await expect(lines.filter({ hasText: 'TEST WEB Empty' })).toContainText(
    'Not available right now',
  );
  await expect(lines.filter({ hasText: 'TEST WEB Order Only' })).toContainText(
    'Brought in to order',
  );
  await expect(lines.filter({ hasText: 'TEST WEB Order Only' })).toContainText('Ask for the rate');
  expect(checks.join()).not.toMatch(/"stock"|"available"|"left"/);
});

test('a retired product is flagged, and the rest of the list stands', async ({ page }) => {
  await fillList(page, [
    { id: 'test-web-never-existed', qty: 1 },
    { id: first, qty: 1, name: 'TEST WEB Cement PPC' },
  ]);
  await page.goto(`${site}/list`);
  const gone = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ hasText: 'Name of test-web-never-existed' });
  await expect(gone).toContainText('No longer sold');
  await expect(exit(page, 'order')).toHaveCount(0);
  await gone.getByRole('button', { name: /Remove/ }).click();
  await expect(exit(page, 'order')).toBeVisible();
});

test('a quantity the shop cannot sell is explained, with one tap to fix it', async ({ page }) => {
  await fillList(page, [
    { id: second, qty: 7, min: 1, step: 1, name: 'TEST WEB Steel TMT', rate: 6500 },
  ]);
  await page.goto(`${site}/list`);
  const line = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ hasText: 'TEST WEB Steel TMT' });
  await expect(line).toContainText('Smallest order 5, in steps of 5');
  await line.getByRole('button', { name: 'Change to 10' }).click();
  await expect(line.locator('output')).toHaveText('10');
  await expect(exit(page, 'order')).toBeVisible();
});

test('a rate that changed since adding shows the new one and says so', async ({ page }) => {
  await fillList(page, [{ id: first, qty: 1, name: 'TEST WEB Cement PPC', rate: 30000 }]);
  await page.goto(`${site}/list`);
  await expect(
    page.getByRole('main').getByText('Rate changed since you added this. It was ₹300.'),
  ).toBeVisible();
  await expect(page.getByRole('main').getByText('₹380').first()).toBeVisible();
});

test('a price tampered with in the browser never reaches the shop', async ({ page }) => {
  const phone = '9888820001';
  await signIn(page, phone, '/list');
  await seedAddress(page, phone);
  await page.evaluate(
    ([id]) =>
      localStorage.setItem(
        'shiv_list_v1',
        JSON.stringify({
          lines: [
            {
              i: id,
              n: 'TEST WEB Cement PPC',
              u: 'a bori',
              m: 1,
              s: 1,
              r: 1,
              h: `/materials/cement/${id}`,
              q: 2,
            },
          ],
        }),
      ),
    [first],
  );
  await page.goto(`${site}/list`);
  await exit(page, 'order').click();
  await expect(page).toHaveURL(`${site}/checkout`);
  await page.getByRole('radio', { name: 'Deliver here', exact: true }).check();
  await page.getByRole('button', { name: 'Review current order', exact: true }).click();
  await expect(page.getByText('₹760').first()).toBeVisible();
});

test('a tampered list cannot put a bad link or script on the page', async ({ page }) => {
  await page.goto(`${site}/about`);
  await page.evaluate(() =>
    localStorage.setItem(
      'shiv_list_v1',
      JSON.stringify({
        lines: [
          {
            i: 'x',
            n: '<img src=x onerror=window.__pwn=1>',
            u: 'a kg',
            m: 1,
            s: 1,
            r: 100,
            h: '/materials/cement/x',
            q: 1,
          },
          {
            i: 'y',
            n: 'Bad link',
            u: 'a kg',
            m: 1,
            s: 1,
            r: 100,
            h: 'javascript:window.__pwn=1',
            q: 1,
          },
          { i: 'z', n: 'Bad rate', u: 'a kg', m: 1, s: 1, r: -100, h: '/materials/cement/z', q: 1 },
        ],
      }),
    ),
  );
  await page.goto(`${site}/rates`);
  await expect(page.locator('[data-slip-lines]').first()).toContainText('<img src=x');
  await page.goto(`${site}/list`);
  expect(
    await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn),
  ).toBeUndefined();
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('a[href^="javascript"]')).toHaveCount(0);
});

test('the shop’s list check failing keeps the list and does not lead with Place order', async ({
  page,
}) => {
  await fillList(page, [{ id: first, qty: 1, name: 'TEST WEB Cement PPC' }]);
  await page.route(`${api}/public/list-check`, (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  await page.goto(`${site}/list`);
  await expect(
    page.getByRole('main').getByRole('status').filter({ hasText: 'could not be reached' }),
  ).toBeVisible();
  await expect(exit(page, 'order')).toHaveCount(0);
  await expect(exit(page, 'rate')).toBeVisible();
  await page.unroute(`${api}/public/list-check`);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(exit(page, 'order')).toBeVisible();
});

test('offline: Add still works, the list says it is saved, and nothing needing the server is offered', async ({
  page,
  context,
}) => {
  await fillList(page, [{ id: first, qty: 1, name: 'TEST WEB Cement PPC' }]);
  await page.goto(`${site}/list`);
  await expect(exit(page, 'order')).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByRole('main').getByText('You are offline. Your list is saved.'),
  ).toBeVisible();
  await expect(page.locator('[data-exit]')).toHaveCount(0);
  const line = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ hasText: 'TEST WEB Cement PPC' });
  await line.getByRole('button', { name: 'One more TEST WEB Cement PPC' }).click();
  await expect(line.locator('output')).toHaveText('2');
  await context.setOffline(false);
  await expect(exit(page, 'order')).toBeVisible();
});

test('a pincode the shop does not list turns off Place order, with the reason', async ({
  page,
}) => {
  await fillList(page, [{ id: first, qty: 1, name: 'TEST WEB Cement PPC' }]);
  await page.goto(`${site}/list`);
  await expect(exit(page, 'order')).toBeVisible();
  const main = page.getByRole('main');
  await main.getByLabel('Site pincode').fill('999999');
  await main.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(main.getByText(/does not list 999999/)).toBeVisible();
  await expect(exit(page, 'order')).toHaveCount(0);
  await expect(page.locator('[data-order-off]')).toContainText('does not list this pincode');
  await main.getByLabel('Site pincode').fill('800020');
  await main.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(exit(page, 'order')).toBeVisible();
});

test('the WhatsApp exit in a review build carries the whole list and no price', async ({
  page,
}) => {
  await fillList(page, [
    { id: first, qty: 3, name: 'TEST WEB Cement PPC' },
    { id: second, qty: 10, name: 'TEST WEB Steel TMT', rate: 6500, min: 5, step: 5 },
  ]);
  await page.goto(`${site}/list`);
  const href = await exit(page, 'whatsapp').getAttribute('href');
  const text = decodeURIComponent(new URL(href!).searchParams.get('text')!);
  expect(text).toContain('Namaste, mujhe yeh chahiye:');
  expect(text).toContain('3 x TEST WEB Cement PPC');
  expect(text).toContain('10 x TEST WEB Steel TMT');
  expect(text).not.toMatch(/₹|\d{3,}\.\d/);
});

test('Place order signs in, returns to the list and carries on to checkout, with the list intact', async ({
  page,
}) => {
  await fillList(page, [{ id: first, qty: 2, name: 'TEST WEB Cement PPC' }]);
  await page.goto(`${site}/list`);
  await exit(page, 'order').click();
  await expect(page).toHaveURL(/\/account\?next=/);
  await signInHere(page, '9888820002');
  await expect(page).toHaveURL(`${site}/checkout`, { timeout: 30000 });
  const cart = await (await page.request.get(`${api}/cart`)).json();
  expect(
    cart.map((row: { productId: string; quantity: number }) => [row.productId, row.quantity]),
  ).toEqual([[first, 2]]);
});

test('joining a list to a cart never doubles a quantity, however many times it is sent', async ({
  page,
}) => {
  const phone = '9888820003';
  await signIn(page, phone, '/list');
  // The account already holds 5 of it from another phone.
  await page.request.put(`${api}/cart/items`, {
    headers: { Origin: site },
    data: { productId: first, quantity: 5 },
  });
  await page.evaluate(
    ([id]) =>
      localStorage.setItem(
        'shiv_list_v1',
        JSON.stringify({
          lines: [
            {
              i: id,
              n: 'TEST WEB Cement PPC',
              u: 'a bori',
              m: 1,
              s: 1,
              r: 38000,
              h: `/materials/cement/${id}`,
              q: 2,
            },
          ],
        }),
      ),
    [first],
  );
  await page.goto(`${site}/list`);
  await exit(page, 'order').click();
  await expect(page).toHaveURL(`${site}/checkout`);
  await page.goBack();
  await expect(exit(page, 'order')).toBeVisible();
  await exit(page, 'order').click();
  await expect(page).toHaveURL(`${site}/checkout`);
  const cart = await (await page.request.get(`${api}/cart`)).json();
  expect(cart[0].quantity).toBe(2);
});

test('a double tap on Place order sends each line once and opens checkout once', async ({
  page,
}) => {
  const phone = '9888820021';
  await signIn(page, phone, '/list');
  await seedAddress(page, phone);
  await page.evaluate(
    ([id]) =>
      localStorage.setItem(
        'shiv_list_v1',
        JSON.stringify({
          lines: [
            {
              i: id,
              n: 'TEST WEB Cement PPC',
              u: 'a bori',
              m: 1,
              s: 1,
              r: 38000,
              h: `/materials/cement/${id}`,
              q: 6,
            },
          ],
        }),
      ),
    [first],
  );
  let puts = 0;
  await page.route(`${api}/cart/items`, async (route) => {
    if (route.request().method() === 'PUT') puts++;
    await route.continue();
  });
  await page.goto(`${site}/list`);
  await expect(exit(page, 'order')).toBeVisible();
  await exit(page, 'order').dblclick();
  await expect(page).toHaveURL(`${site}/checkout`);
  expect(puts).toBe(1);
  const cart = await (await page.request.get(`${api}/cart`)).json();
  expect(cart[0].quantity).toBe(6);
});

test('a line added on another phone joins this list, and one taken off here leaves the cart', async ({
  page,
}) => {
  const phone = '9888820004';
  await signIn(page, phone, '/list');
  await page.request.put(`${api}/cart/items`, {
    headers: { Origin: site },
    data: { productId: first, quantity: 4 },
  });
  await page.goto(`${site}/list`);
  const line = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ hasText: 'TEST WEB Cement PPC' });
  await expect(line.locator('output')).toHaveText('4');
  await line.getByRole('button', { name: /Remove/ }).click();
  await expect(page.getByRole('heading', { name: 'Nothing yet.' })).toBeVisible();
  // The empty list has no exit to send the removal, so it goes with the next list.
  await page.evaluate(
    ([id]) => {
      const saved = JSON.parse(localStorage.getItem('shiv_list_v1')!);
      saved.lines = [
        {
          i: id,
          n: 'TEST WEB Steel TMT',
          u: 'a kg',
          m: 5,
          s: 5,
          r: 6500,
          h: `/materials/cement/${id}`,
          q: 5,
        },
      ];
      localStorage.setItem('shiv_list_v1', JSON.stringify(saved));
    },
    [second],
  );
  await page.goto(`${site}/list`);
  await expect(
    page.getByRole('main').getByRole('listitem').filter({ hasText: 'TEST WEB Cement PPC' }),
  ).toHaveCount(0);
  await exit(page, 'order').click();
  await expect(page).toHaveURL(`${site}/checkout`);
  const cart = await (await page.request.get(`${api}/cart`)).json();
  expect(cart.map((row: { productId: string }) => row.productId)).toEqual([second]);
});

test('a line the server refuses at Place order stays on the list with a reason, and reveals no count', async ({
  page,
}) => {
  const phone = '9888820005';
  await signIn(page, phone, '/list');
  const db = database();
  try {
    await db.product.upsert({
      where: { id: 'test-web-few' },
      create: {
        id: 'test-web-few',
        name: 'TEST WEB Few',
        categoryId: 'cement',
        brand: 'TEST WEB',
        type: 'T',
        grade: 'G',
        unit: 'bag',
        pricePaise: 40000,
        stock: 3,
        images: [],
        description: 'x',
        recommendedUse: 'x',
        active: true,
      },
      update: { stock: 3, pricePaise: 40000 },
    });
  } finally {
    await db.$disconnect();
  }
  await page.evaluate(() =>
    localStorage.setItem(
      'shiv_list_v1',
      JSON.stringify({
        lines: [
          {
            i: 'test-web-few',
            n: 'TEST WEB Few',
            u: 'a bori',
            m: 1,
            s: 1,
            r: 40000,
            h: '/materials/cement/test-web-few',
            q: 5,
          },
        ],
      }),
    ),
  );
  await page.goto(`${site}/list`);
  await exit(page, 'order').click();
  const line = page.getByRole('main').getByRole('listitem').filter({ hasText: 'TEST WEB Few' });
  await expect(line).toContainText('The shop needs to check this quantity. Ask for a rate.');
  await expect(line).not.toContainText('3');
  await expect(page).toHaveURL(`${site}/list`);
});

test('a signed-in customer sees their own rate, and a guest never asks for it', async ({
  page,
  context,
}) => {
  const phone = '9888820006';
  const db = database();
  await signIn(page, phone, '/list');
  const user = await db.user.findUniqueOrThrow({ where: { phone: `+91${phone}` } });
  const today = new Date().toISOString().slice(0, 10);
  const rule = await db.priceRule.create({
    data: {
      kind: 'SPECIAL',
      title: 'Test special',
      productId: first,
      customerId: user.id,
      minQuantity: 1,
      valueType: 'RATE',
      value: 35000,
      startsOn: today,
      endsOn: '2099-12-31',
      createdById: 'test',
      active: true,
    },
  });
  try {
    await page.goto(`${site}/materials/cement/${first}`);
    await expect(page.locator(`[data-your-rate="${first}"]`)).toHaveText('Your rate ₹350');
    // It belongs to this person alone.
    const other = await context.browser()!.newContext();
    const guest = await other.newPage();
    const asked: string[] = [];
    guest.on('request', (request) => {
      if (request.url().includes('/me/rates')) asked.push(request.url());
    });
    await guest.goto(`${site}/materials/cement/${first}`);
    await guest.waitForLoadState('networkidle');
    expect(asked).toEqual([]);
    await expect(guest.locator(`[data-your-rate="${first}"]`)).toBeHidden();
    await other.close();
  } finally {
    await db.priceRule.delete({ where: { id: rule.id } });
    await db.$disconnect();
  }
});

test('a public offer shows on the rate and product pages', async ({ page, request }) => {
  const db = database();
  const today = new Date().toISOString().slice(0, 10);
  const rule = await db.priceRule.create({
    data: {
      kind: 'OFFER',
      title: 'TEST public offer',
      productId: first,
      minQuantity: 100,
      valueType: 'AMOUNT_OFF',
      value: 1000,
      startsOn: today,
      endsOn: '2099-12-31',
      createdById: 'test',
      active: true,
      isPublic: true,
    },
  });
  try {
    await expect
      .poll(
        async () =>
          (await (await request.get(`${site}/rates`)).text()).includes('TEST public offer'),
        { timeout: 30000 },
      )
      .toBe(true);
    await page.goto(`${site}/materials/cement/${first}`);
    await expect(
      page.getByRole('main').getByText(/TEST public offer ₹10 off on 100 or more/),
    ).toBeVisible();
  } finally {
    await db.priceRule.delete({ where: { id: rule.id } });
    await db.$disconnect();
  }
});

test('placing an order empties the list once, and it cannot be sent again', async ({ page }) => {
  await checkout(page, '9888820007');
  await page.getByRole('button', { name: 'Place COD order', exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/[^?]+\?confirmed=1/);
  await expect(page.locator('[data-site-nav] [data-list-count]')).toHaveText('0');
  await page.goto(`${site}/list`);
  await expect(page.getByRole('heading', { name: 'Nothing yet.' })).toBeVisible();
});

test('COD lost success recovers exactly one order after reload', async ({ page }) => {
  await checkout(page, '9888820008');
  let orderId = '';
  let dropped = false;
  await page.route(`${api}/orders`, async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      orderId = (await response.json()).id;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Place COD order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recover order result' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Recover order result' }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${orderId}`));
  await expect(page.getByText('Waiting for the shop', { exact: true }).first()).toBeVisible();
  const db = database();
  try {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(await db.order.count({ where: { userId: order.userId } })).toBe(1);
    expect(await db.ownerWork.count({ where: { orderId } })).toBe(1);
    expect(
      await db.inventoryMovement.count({
        where: { actorId: order.userId, productId: first, kind: 'ONLINE_ORDER' },
      }),
    ).toBe(1);
  } finally {
    await db.$disconnect();
  }
});

test('double-tapping Place COD order creates one order', async ({ page }) => {
  const phone = '9888820009';
  await checkout(page, phone);
  await page.getByRole('button', { name: 'Place COD order', exact: true }).dblclick();
  await expect(page).toHaveURL(/\/orders\//);
  await expect(page.getByText('Waiting for the shop', { exact: true }).first()).toBeVisible();
  const db = database();
  try {
    const user = await db.user.findUniqueOrThrow({ where: { phone: `+91${phone}` } });
    expect(await db.order.count({ where: { userId: user.id } })).toBe(1);
    const order = await db.order.findFirstOrThrow({ where: { userId: user.id } });
    expect(await db.ownerWork.count({ where: { orderId: order.id } })).toBe(1);
  } finally {
    await db.$disconnect();
  }
});

test('an order placed stays visible when a refresh fails; a changed rate asks for consent again', async ({
  page,
  request,
}) => {
  await checkout(page, '9888820010');
  const admin = await token(request);
  const product = await (await request.get(`${api}/products/${first}`)).json();
  // The public route never gives the real count, and a change must carry the real one.
  const db = database();
  const { stock } = await db.product.findUniqueOrThrow({ where: { id: first } });
  await db.$disconnect();
  const updated = await request.patch(`${api}/admin/products/${first}`, {
    headers: admin,
    data: {
      ...productSchema.parse(productSchema.strip().parse({ ...product, stock })),
      pricePaise: product.pricePaise + 100,
      expectedVersion: product.version,
    },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review current order', exact: true }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('checkbox').check();
  let committed = false;
  await page.route(`${api}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/orders') && route.request().method() === 'POST') {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed = true;
      await route.fulfill({ response });
    } else if (committed && path.endsWith('/cart')) await route.abort('failed');
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Place COD order', exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/[^?]+\?confirmed=1/);
  await expect(page.getByText('Waiting for the shop', { exact: true }).first()).toBeVisible();
});

test('a late checkout success cannot move or announce into a switched account', async ({
  page,
}) => {
  await checkout(page, '9888820011');
  let release!: () => void;
  let persisted!: () => void;
  let delivered!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  const savedOrder = new Promise<void>((resolve) => (persisted = resolve));
  const resultDelivered = new Promise<void>((resolve) => (delivered = resolve));
  let orderId = '';
  await page.route(`${api}/orders`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    orderId = (await response.json()).id;
    persisted();
    await hold;
    await route.fulfill({ response });
    delivered();
  });
  await page.getByRole('button', { name: 'Place COD order', exact: true }).click();
  await savedOrder;
  const phone = '+919888820012';
  const otp = await page.request.post(`${api}/auth/otp/request`, {
    headers: { Origin: site },
    data: { phone },
  });
  expect(otp.ok(), await otp.text()).toBe(true);
  const verified = await page.request.post(`${api}/auth/otp/verify`, {
    headers: { Origin: site },
    data: { phone, code: (await otp.json()).devCode },
  });
  expect(verified.ok(), await verified.text()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.goto(`${site}/account`);
  await expect(page.getByText(phone, { exact: true })).toBeVisible();
  release();
  await resultDelivered.catch(() => {});
  await expect(page).toHaveURL(`${site}/account`);
  await expect(page.getByText(phone, { exact: true })).toBeVisible();
  expect((await page.request.get(`${api}/orders/${orderId}`)).status()).toBe(404);
});

test('Ask for a rate sends the list as one request, recovers a lost answer, and converts once', async ({
  page,
  request,
}) => {
  const phone = '9888820013';
  await signIn(page, phone, '/quotes');
  await seedAddress(page, phone);
  await page.evaluate(
    ([a, b]) =>
      localStorage.setItem(
        'shiv_list_v1',
        JSON.stringify({
          lines: [
            {
              i: a,
              n: 'TEST WEB Cement PPC',
              u: 'a bori',
              m: 1,
              s: 1,
              r: 38000,
              h: `/materials/cement/${a}`,
              q: 20,
            },
            {
              i: b,
              n: 'TEST WEB Steel TMT',
              u: 'a kg',
              m: 5,
              s: 5,
              r: 6500,
              h: `/materials/cement/${b}`,
              q: 50,
            },
          ],
        }),
      ),
    [first, second],
  );
  await page.goto(`${site}/list`);
  await exit(page, 'rate').click();
  await expect(page).toHaveURL(`${site}/quotes`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'TEST WEB Cement PPC' })).toBeVisible();
  await page.getByRole('radio', { name: 'Deliver here', exact: true }).check();
  await main.getByLabel('Company (optional)').fill('TEST draft company');
  await page.reload();
  await expect(main.getByLabel('Company (optional)')).toHaveValue('TEST draft company');
  let quoteId = '';
  let quoteNumber = '';
  let dropped = false;
  await page.route(`${api}/quotes`, async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      const quote = await response.json();
      quoteId = quote.id;
      quoteNumber = quote.number;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Ask the shop for a rate', exact: true }).click();
  const recover = page.getByRole('button', { name: "Recover the shop's answer" });
  await expect(recover).toBeVisible();
  await page.reload();
  await recover.click();
  await expect(page.getByRole('heading', { name: quoteNumber, exact: true })).toBeVisible();
  // The list goes once it has been asked about.
  await expect(page.locator('[data-site-nav] [data-list-count]')).toHaveText('0');
  const admin = await token(request);
  const sent = await request.post(`${api}/admin/quotes/${quoteId}/offer`, {
    headers: admin,
    data: {
      expectedRevision: 0,
      items: [
        { productId: first, unitPricePaise: 37000 },
        { productId: second, unitPricePaise: 6400 },
      ],
      deliveryFeePaise: 50000,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      note: 'Test offer, freight included.',
      deliveryConfirmed: true,
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  await page.getByRole('button', { name: 'Refresh offers', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Accept this revision', exact: true }).click();
  await expect(page.getByText('Accepted · awaiting conversion', { exact: true })).toBeVisible();
  const converted = await request.post(`${api}/admin/quotes/${quoteId}/convert`, {
    headers: admin,
    data: { revision: 1 },
  });
  expect(converted.ok(), await converted.text()).toBe(true);
  const order = await converted.json();
  const duplicate = await request.post(`${api}/admin/quotes/${quoteId}/convert`, {
    headers: admin,
    data: { revision: 1 },
  });
  expect((await duplicate.json()).id).toBe(order.id);
});

test('saved address editing works; account switches and revocation clear private forms', async ({
  page,
}) => {
  const phone = '9888820014';
  await signIn(page, phone, '/list');
  await seedAddress(page, phone);
  await page.goto(`${site}/account`);
  await page.getByRole('button', { name: 'Edit address', exact: true }).click();
  await page.getByRole('main').getByLabel('House / street / site').fill('Plot 19 edited');
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page.getByText(/Plot 19 edited/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit address', exact: true }).click();
  await page.getByRole('main').getByLabel('Recipient name').fill('PRIVATE A DRAFT');
  const otp = await page.request.post(`${api}/auth/otp/request`, {
    headers: { Origin: site },
    data: { phone: '+919888820015' },
  });
  expect(
    (
      await page.request.post(`${api}/auth/otp/verify`, {
        headers: { Origin: site },
        data: { phone: '+919888820015', code: (await otp.json()).devCode },
      })
    ).ok(),
  ).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('+919888820015', { exact: true })).toBeVisible();
  await expect(page.locator('input[value="PRIVATE A DRAFT"]')).toHaveCount(0);
  await expect(page.getByText(/Plot 19 edited/)).toHaveCount(0);
  await page.request.post(`${api}/auth/logout`, { headers: { Origin: site }, data: {} });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('main').getByLabel('Mobile number', { exact: true })).toBeVisible();
});

test('compare shows two materials side by side at their own units', async ({ page }) => {
  await page.goto(`${site}/compare`);
  await expect(page.getByRole('heading', { name: 'Nothing to compare yet.' })).toBeVisible();
  await page.goto(`${site}/materials/cement/${first}`);
  await page.getByRole('main').getByRole('button', { name: 'Compare' }).click();
  await page.goto(`${site}/materials/cement/${second}`);
  await page.getByRole('main').getByRole('button', { name: 'Compare' }).click();
  await page.getByRole('main').getByRole('link', { name: 'Open comparison' }).click();
  await expect(page).toHaveURL(`${site}/compare`);
  const articles = page.getByRole('main').getByRole('article');
  await expect(articles).toHaveCount(2);
  // Another test here moves this rate by a rupee, on purpose.
  await expect(articles.first()).toContainText(/₹38\d, a bori/);
  await expect(articles.last()).toContainText('₹65');
});
