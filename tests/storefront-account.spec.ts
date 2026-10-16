import { PrismaClient } from '@prisma/client';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Website account parity with the Android app: profile, signed-in devices, account deletion
// and sharing an order on WhatsApp. Each test signs in with its own 98888400xx number.
const site = 'http://localhost:3004';
const api = 'http://localhost:4010/api/v1';
const product = 'test-web-account-cement';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (error) => list.push(error.message));
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
      name: 'TEST WEB Account Cement',
      categoryId: 'cement',
      brand: 'TEST WEB',
      type: 'Cement',
      grade: 'PPC',
      unit: 'bag',
      packSize: '50 kg',
      minQuantity: 1,
      quantityStep: 1,
      pricePaise: 38000,
      stock: 1000,
      description: 'Disposable test fixture; not product advice.',
      recommendedUse: 'Test only.',
      images: [],
      active: true,
    };
    await db.product.upsert({
      where: { id: product },
      create: { id: product, ...data },
      update: data,
    });
  } finally {
    await db.$disconnect();
  }
});
async function login(page: Page, phone: string) {
  await page.goto(`${site}/account?next=${encodeURIComponent('/orders')}`);
  const main = page.getByRole('main');
  await expect(main.getByLabel('Mobile number', { exact: true })).toBeEnabled();
  await main.getByLabel('Mobile number', { exact: true }).fill(phone);
  const otp = page.waitForResponse((response) => response.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get sign-in code', exact: true }).click();
  const response = await otp;
  expect(response.status(), await response.text()).toBe(201);
  await main.getByLabel('Six-digit code').fill((await response.json()).devCode);
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  await expect(page).toHaveURL(`${site}/orders`);
}
/** A second sign-in for the same number, as another phone would make it (bearer tokens). */
async function otherDevice(request: APIRequestContext, phone: string) {
  // The browser sign-in just used this number's one-code-a-minute allowance.
  const db = database();
  try {
    await db.otpChallenge.deleteMany({ where: { phone: `+91${phone}` } });
  } finally {
    await db.$disconnect();
  }
  const sent = await request.post(`${api}/auth/otp/request`, { data: { phone: `+91${phone}` } });
  expect(sent.ok(), await sent.text()).toBe(true);
  const verified = await request.post(`${api}/auth/otp/verify`, {
    headers: { 'User-Agent': 'ShivAccountTest/1.0' },
    data: { phone: `+91${phone}`, code: (await sent.json()).devCode },
  });
  expect(verified.ok(), await verified.text()).toBe(true);
  return { Authorization: `Bearer ${(await verified.json()).accessToken}` };
}
/** Places a COD order through the website checkout and returns its number. */
async function placeOrder(page: Page, phone: string) {
  const address = await page.request.post(`${api}/me/addresses`, {
    headers: { Origin: site },
    data: {
      label: 'Test site',
      name: 'Website customer',
      phone: `+91${phone}`,
      line1: 'Plot 18',
      area: 'Kankarbagh',
      city: 'Patna',
      state: 'Bihar',
      pincode: '800020',
      landmark: '',
    },
  });
  expect(address.ok(), await address.text()).toBe(true);
  const cart = await page.request.put(`${api}/cart/items`, {
    headers: { Origin: site },
    data: { productId: product, quantity: 2 },
  });
  expect(cart.ok(), await cart.text()).toBe(true);
  await page.goto(`${site}/checkout`);
  await page.getByRole('radio', { name: 'Deliver here', exact: true }).check();
  await page.getByRole('button', { name: 'Review current order', exact: true }).click();
  await expect(page.getByRole('checkbox')).toBeVisible();
  await page.getByRole('checkbox').check();
  const placed = page.waitForResponse(
    (response) => response.url() === `${api}/orders` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Place COD order', exact: true }).click();
  const response = await placed;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(page).toHaveURL(/\/orders\//);
  return (await response.json()).number as string;
}
async function openDelete(page: Page) {
  await page.goto(`${site}/account`);
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  const confirmation = page.getByRole('main').getByLabel('Type DELETE to confirm');
  const remove = page.getByRole('button', { name: 'Permanently delete my account', exact: true });
  // Only the typed word unlocks deletion.
  await confirmation.fill('delete');
  await expect(remove).toBeDisabled();
  await confirmation.fill('DELETE');
  await expect(remove).toBeEnabled();
  return remove;
}

test('a customer edits their name on the website and it stays after reload', async ({ page }) => {
  const phone = '9888840001';
  await login(page, phone);
  await page.goto(`${site}/account`);
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
  const name = page.getByRole('main').getByLabel('Full name');
  // An empty name is caught before any request is sent.
  let patches = 0;
  page.on('request', (request) => {
    if (request.url() === `${api}/me` && request.method() === 'PATCH') patches++;
  });
  await name.fill('   ');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter your name' })).toBeVisible();
  expect(patches).toBe(0);
  await name.fill('Account Test Customer');
  const saved = page.waitForResponse(
    (response) => response.url() === `${api}/me` && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Account Test Customer', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Account Test Customer', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Name: Account Test Customer', { exact: true })).toBeVisible();
  const db = database();
  try {
    const user = await db.user.findUniqueOrThrow({ where: { phone: `+91${phone}` } });
    expect(user.name).toBe('Account Test Customer');
  } finally {
    await db.$disconnect();
  }
});

test('signed-in devices mark this browser and sign out another phone', async ({
  page,
  request,
}) => {
  const phone = '9888840002';
  await login(page, phone);
  const other = await otherDevice(request, phone);
  expect((await request.get(`${api}/auth/session`, { headers: other })).ok()).toBe(true);
  const listed = page.waitForResponse(
    (response) => response.url() === `${api}/auth/sessions` && response.ok(),
  );
  await page.goto(`${site}/account`);
  await listed;
  const devices = page.getByRole('main').getByRole('listitem');
  await expect(devices).toHaveCount(2);
  await expect(devices.filter({ hasText: 'This device' })).toHaveCount(1);
  await expect(devices.filter({ hasText: 'This device' })).toContainText('Last used');
  const phoneRow = devices.filter({ hasText: 'ShivAccountTest/1.0' });
  await expect(phoneRow).toHaveCount(1);
  // The current browser cannot sign itself out from the list; the summary's Sign out does that.
  await expect(
    devices.filter({ hasText: 'This device' }).getByRole('button', { name: /^Sign out device/ }),
  ).toHaveCount(0);
  const revoked = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${api}/auth/sessions/`) &&
      response.request().method() === 'DELETE',
  );
  await phoneRow.getByRole('button', { name: 'Sign out device: ShivAccountTest/1.0' }).click();
  expect((await revoked).ok()).toBe(true);
  await expect(phoneRow).toHaveCount(0);
  await expect(devices).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Sign out other devices' })).toBeHidden();
  expect((await request.get(`${api}/auth/session`, { headers: other })).status()).toBe(401);
  // This browser is still signed in.
  await page.reload();
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1);
});

test('deleting the account is refused while an order is open', async ({ page }) => {
  const phone = '9888840003';
  await login(page, phone);
  await placeOrder(page, phone);
  const remove = await openDelete(page);
  const refused = page.waitForResponse((response) => response.url() === `${api}/me/delete`);
  await remove.click();
  expect((await refused).status()).toBe(409);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Complete or cancel open orders' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'See open orders', exact: true })).toHaveAttribute(
    'href',
    '/orders',
  );
  // Still signed in, with the account intact.
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  const db = database();
  try {
    const user = await db.user.findUniqueOrThrow({ where: { phone: `+91${phone}` } });
    expect(user.deletedAt).toBeNull();
  } finally {
    await db.$disconnect();
  }
});

test('deleting an account with no open orders signs out and returns home', async ({ page }) => {
  const phone = '9888840004';
  await login(page, phone);
  const db = database();
  try {
    const { id } = await db.user.findUniqueOrThrow({ where: { phone: `+91${phone}` } });
    const remove = await openDelete(page);
    const deleted = page.waitForResponse((response) => response.url() === `${api}/me/delete`);
    await remove.click();
    expect((await deleted).ok()).toBe(true);
    await expect(page).toHaveURL(`${site}/`);
    await expect(page.getByRole('status').filter({ hasText: 'Account deleted' })).toBeVisible();
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    expect(user.deletedAt).not.toBeNull();
    expect(await db.session.count({ where: { userId: id } })).toBe(0);
    // The browser no longer holds a working session.
    await page.goto(`${site}/account`);
    await expect(page.getByRole('button', { name: 'Get sign-in code', exact: true })).toBeVisible();
    expect((await page.request.get(`${api}/auth/session`)).status()).toBe(401);
  } finally {
    await db.$disconnect();
  }
});

test('each order can be shared on WhatsApp without the delivery address', async ({ page }) => {
  const phone = '9888840005';
  await login(page, phone);
  const number = await placeOrder(page, phone);
  const listed = page.waitForResponse(
    (response) => response.url().startsWith(`${api}/orders?`) && response.ok(),
  );
  await page.goto(`${site}/orders`);
  await listed;
  const record = page.getByRole('article').filter({ hasText: number });
  const share = record.getByRole('link', { name: 'Share on WhatsApp', exact: true });
  const href = (await share.getAttribute('href')) || '';
  expect(href.startsWith('https://wa.me/?text=')).toBe(true);
  expect(href).toContain(encodeURIComponent(number));
  const text = decodeURIComponent(href.slice('https://wa.me/?text='.length));
  expect(text).toContain('TEST WEB Account Cement × 2 bag');
  expect(text).toContain('Status: Confirmed');
  expect(text).toMatch(/Total: ₹/);
  expect(text).not.toContain('Plot 18');
  expect(text).not.toContain(phone);
  await expect(share).toHaveAttribute('target', '_blank');
});
