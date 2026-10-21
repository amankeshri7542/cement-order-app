import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { apiUrl, appLogin, tab } from './app';

// The app's account features, matched by the website's tests/storefront-account.spec.ts
// (packages/shared/src/features.ts lists both). Each test uses its own customer.
const tomorrow = () => new Date(Date.now() + 5.5 * 3600000 + 86400000).toISOString().slice(0, 10);

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
)
  throw new Error('Disposable loopback database required');
const db = new PrismaClient({ datasourceUrl: url });
test.afterAll(() => db.$disconnect());

/** Signs a customer in through the API (a second phone) and returns its bearer header. */
async function apiSession(request: APIRequestContext, phone: string) {
  // Skip the wait between codes for one number.
  await db.otpChallenge.deleteMany({ where: { phone: `+91${phone}` } });
  const sent = await request.post(`${apiUrl}/auth/otp/request`, { data: { phone: `+91${phone}` } });
  expect(sent.status()).toBe(201);
  const verified = await request.post(`${apiUrl}/auth/otp/verify`, {
    data: { phone: `+91${phone}`, code: (await sent.json()).devCode },
    headers: { 'User-Agent': 'Second phone' },
  });
  expect(verified.status()).toBe(201);
  return { Authorization: `Bearer ${(await verified.json()).accessToken}` };
}

/** Places a cash-on-delivery order for the customer behind `headers`; returns its number. */
async function placeOrder(request: APIRequestContext, headers: Record<string, string>) {
  const ok = async (response: Awaited<ReturnType<APIRequestContext['post']>>) => {
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await ok(
    await request.put(`${apiUrl}/cart/items`, {
      headers,
      data: { productId: 'test-ultratech', quantity: 2 },
    }),
  );
  const address = await ok(
    await request.post(`${apiUrl}/me/addresses`, {
      headers,
      data: {
        label: 'Site',
        name: 'Account Test',
        phone: '+919876543210',
        line1: 'Plot 4',
        area: 'Boring Road',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800001',
      },
    }),
  );
  const review = await ok(
    await request.post(`${apiUrl}/checkout/review`, {
      headers,
      data: { addressId: address.id, deliveryDate: tomorrow(), paymentMethod: 'COD' },
    }),
  );
  const order = await ok(
    await request.post(`${apiUrl}/orders`, {
      headers,
      data: { reviewId: review.id, idempotencyKey: randomUUID() },
    }),
  );
  return order.number as string;
}

async function openAccount(page: Page) {
  await tab(page, 'Account').click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}

test('the profile name can be changed', async ({ page }) => {
  await appLogin(page, '9888850001');
  await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Ravi Kumar');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Profile saved', { exact: true })).toBeVisible();
  await page.reload();
  await openAccount(page);
  await expect(page.getByText('Ravi Kumar', { exact: true })).toBeVisible();
});

test('another signed-in phone can be signed out', async ({ page, request }) => {
  const phone = '9888850002';
  await appLogin(page, phone);
  const other = await apiSession(request, phone);
  await page.getByRole('button', { name: 'Signed-in phones', exact: true }).click();
  await expect(page.getByText(/^This phone · /)).toBeVisible();
  const second = page.getByText(/^Second phone · /);
  await expect(second).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
  await expect(second).toHaveCount(0);
  expect((await request.get(`${apiUrl}/me`, { headers: other })).status()).toBe(401);
});

test('the account can be deleted once no order is open', async ({ page, request }) => {
  const phone = '9888850003';
  await appLogin(page, phone);
  await placeOrder(request, await apiSession(request, phone));
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Type DELETE to confirm', exact: true }).fill('DELETE');
  const remove = page.getByRole('button', { name: 'Permanently delete my account', exact: true });
  await remove.click();
  await expect(
    page.getByText('Complete or cancel open orders and refunds before deleting your account.'),
  ).toBeVisible();
  // Cancel the open order, then deletion goes through and the app returns to Home signed out.
  const headers = await apiSession(request, phone);
  const orders = await (await request.get(`${apiUrl}/orders`, { headers })).json();
  for (const order of orders.items)
    expect((await request.post(`${apiUrl}/orders/${order.id}/cancel`, { headers })).status()).toBe(
      201,
    );
  await remove.click();
  await expect(page.getByText('Account deleted', { exact: true })).toBeVisible();
  await tab(page, 'Account').click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('deleting the account removes its drafts and frozen basket from the device', async ({
  page,
}) => {
  const phone = '9888850005';
  await appLogin(page, phone);
  const { id } = await db.user.findUniqueOrThrow({ where: { phone: `+91${phone}` } });
  // The web build keeps the phone's SecureStore records in localStorage under the same keys.
  await page.evaluate((id) => {
    localStorage.setItem(
      `shiv_draft_${id}`,
      JSON.stringify({ checkout: { notes: 'TEST private site note' }, quote: { gstin: '' } }),
    );
    localStorage.setItem(`shiv_merge_${id}`, JSON.stringify({ key: 'k', lines: [] }));
  }, id);
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Type DELETE to confirm', exact: true }).fill('DELETE');
  await page.getByRole('button', { name: 'Permanently delete my account', exact: true }).click();
  await expect(page.getByText('Account deleted', { exact: true })).toBeVisible();
  expect(
    await page.evaluate((id) => Object.keys(localStorage).filter((key) => key.includes(id)), id),
  ).toEqual([]);
});

test('an order summary can be shared', async ({ page, request }) => {
  const phone = '9888850004';
  await appLogin(page, phone);
  const number = await placeOrder(request, await apiSession(request, phone));
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
  await tab(page, 'Orders').click();
  await page.getByRole('button', { name: new RegExp(`^Open ${number}`) }).click();
  await page.getByRole('button', { name: 'Share order summary', exact: true }).click();
  const shared = await page.evaluate(() => (window as unknown as { __shared: object[] }).__shared);
  expect(JSON.stringify(shared)).toContain(number);
  expect(JSON.stringify(shared)).toContain('not a GST invoice');
});
