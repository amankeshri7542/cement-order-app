import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Website order history: the same track, cancel and reorder the app offers (journeys.spec.ts).
const site = 'http://localhost:3004';
const api = 'http://localhost:4010/api/v1';
const tomorrow = () => new Date(Date.now() + 5.5 * 3600000 + 86400000).toISOString().slice(0, 10);

async function login(page: Page, phone: string) {
  await page.goto(`${site}/account?next=${encodeURIComponent('/orders')}`);
  const mobile = page.getByRole('main').getByLabel('Mobile number', { exact: true });
  await expect(mobile).toBeEnabled();
  await mobile.fill(phone);
  const otp = page.waitForResponse((response) => response.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get sign-in code', exact: true }).click();
  const response = await otp;
  expect(response.status(), await response.text()).toBe(201);
  await page
    .getByRole('main')
    .getByLabel('Six-digit code')
    .fill((await response.json()).devCode);
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  await expect(page).toHaveURL(`${site}/orders`);
}

/** Places a cash-on-delivery order with the browser's own session; returns its number. */
async function placeOrder(page: Page, phone: string) {
  const call = async (method: 'post' | 'put', path: string, data: object) => {
    const response = await page.request[method](`${api}${path}`, {
      headers: { Origin: site },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await call('put', '/cart/items', { productId: 'test-ultratech', quantity: 3 });
  const address = await call('post', '/me/addresses', {
    label: 'Site',
    name: 'Website customer',
    phone: `+91${phone}`,
    line1: 'Plot 18',
    area: 'Kankarbagh',
    city: 'Patna',
    state: 'Bihar',
    pincode: '800020',
    landmark: '',
  });
  const review = await call('post', '/checkout/review', {
    addressId: address.id,
    deliveryDate: tomorrow(),
    paymentMethod: 'COD',
  });
  const order = await call('post', '/orders', {
    reviewId: review.id,
    idempotencyKey: randomUUID(),
  });
  return order.number as string;
}

test('order history tracks, cancels and reorders', async ({ page }) => {
  const phone = '9888860001';
  await login(page, phone);
  const number = await placeOrder(page, phone);
  await page.reload();
  const record = page.locator('.order-record').filter({ hasText: number });
  await expect(record).toContainText('UltraTech Super');
  await expect(record).toContainText('Pay on delivery');
  // Tracking: the order's own page shows its progress.
  await record.getByRole('link', { name: number }).click();
  await expect(page).toHaveURL(/\/orders\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Your order, in progress.' })).toBeVisible();
  await expect(page.locator('.order-progress li').first()).toBeVisible();
  await page.goto(`${site}/orders`);
  page.once('dialog', (dialog) => dialog.accept());
  await record.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(record).toContainText('Cancelled');
  await expect(record.getByRole('button', { name: 'Cancel order', exact: true })).toHaveCount(0);
  await record.getByRole('button', { name: 'Reorder at current prices', exact: true }).click();
  await expect(page).toHaveURL(`${site}/cart`);
  await expect(page.getByRole('main').getByLabel('Quantity for UltraTech Super')).toHaveValue('3');
});
