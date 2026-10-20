import { type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/security';
import { test, expect } from './fixtures';

test('catalogue and material details render without View text-node warnings', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Unexpected text node'))
      warnings.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:8082');
  await page.getByRole('tab', { name: 'Materials', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search materials', exact: true })
    .fill('UltraTech Super');
  await page.getByRole('button', { name: 'View UltraTech Super', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Quantity', exact: true })).toBeVisible();
  await test.info().attach('view-child-warnings', {
    body: JSON.stringify(warnings),
    contentType: 'application/json',
  });
  expect(warnings).toEqual([]);
});

const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const api = 'http://localhost:4010/api/v1';
const password = 'qa-only-owner-passphrase';

test.beforeAll(async () => {
  const owner = await db.user.upsert({
    where: { phone: '+919297513760' },
    update: {},
    create: { phone: '+919297513760', name: 'QA Father', role: 'ADMIN' },
  });
  await db.adminCredential.upsert({
    where: { userId: owner.id },
    update: {},
    create: { userId: owner.id, passwordHash: await hashPassword(password) },
  });
});
test.afterAll(() => db.$disconnect());

async function requestOwnerCode(page: Page, phone: string) {
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'en'));
  await page.goto('http://localhost:3001/today');
  await page.getByRole('textbox', { name: 'Staff mobile number' }).fill(phone);
  const sent = page.waitForResponse((r) => r.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get verification code' }).click();
  const response = await sent;
  expect(response.status()).toBe(201);
  return (await response.json()).devCode as string;
}

test('owner signs in using OTP without requiring a stored passphrase', async ({ page }) => {
  const code = await requestOwnerCode(page, '9297513760');
  await expect(page.getByLabel('Staff passphrase', { exact: true })).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Verification code', exact: true })
    .fill(code === '111111' ? '222222' : '111111');
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.locator('form [role=alert]')).toBeVisible();
  expect(
    (await db.otpChallenge.findUniqueOrThrow({ where: { phone: '+919297513760' } })).consumed,
  ).toBe(false);
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code);
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect(
    (await db.otpChallenge.findUniqueOrThrow({ where: { phone: '+919297513760' } })).consumed,
  ).toBe(true);
});
test('invalid and expired OTPs reject login and a customer cannot open the owner desk', async ({
  page,
}) => {
  const phone = '+919888888860';
  const code = await requestOwnerCode(page, phone.slice(3));
  await page
    .getByRole('textbox', { name: 'Verification code', exact: true })
    .fill(code === '111111' ? '222222' : '111111');
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.locator('form [role=alert]')).toContainText(/code|sign-in/i);
  // Clock/expiry fixture injection; verification still uses the real API and PostgreSQL.
  await db.otpChallenge.update({ where: { phone }, data: { expiresAt: new Date(0) } });
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code);
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.locator('form [role=alert]')).toContainText(/invalid|expired/i);
  expect(await db.session.count({ where: { user: { phone } } })).toBe(0);
  await db.otpChallenge.update({
    where: { phone },
    data: { expiresAt: new Date(Date.now() + 60000) },
  });
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.locator('form [role=alert]')).toContainText(/owner|access|allowed/i);
  expect((await page.request.get(`${api}/admin/orders`)).status()).toBe(401);
  expect(await db.session.count({ where: { user: { phone } } })).toBe(0);
});

test('revoked owner session returns to OTP login without a page reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const code = await requestOwnerCode(page, '9297513760');
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code);
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.goto('http://localhost:3001/stock');
  await expect(page.getByRole('heading', { name: 'Stock & prices', exact: true })).toBeVisible();
  await db.session.deleteMany({ where: { user: { phone: '+919297513760' } } });
  let reloads = 0;
  page.on('load', () => reloads++);
  // An authenticated action discovers the revocation and clears owner-only cached data.
  await page.getByRole('button', { name: 'Share today’s rates on WhatsApp', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Get verification code', exact: true }),
  ).toBeVisible();
  expect((await page.request.get(`${api}/admin/orders`)).status()).toBe(401);
  await expect(page.getByRole('heading', { name: 'Stock & prices', exact: true })).toHaveCount(0);
  await db.otpChallenge.update({
    where: { phone: '+919297513760' },
    data: { sentAt: new Date(Date.now() - 61000) },
  });
  await page.getByLabel('Staff mobile number').fill('9297513760');
  const sent = page.waitForResponse((r) => r.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get verification code' }).click();
  await page
    .getByLabel('Verification code', { exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.getByRole('heading', { name: 'Stock & prices', exact: true })).toBeVisible();
  expect((await page.request.get(`${api}/admin/orders`)).status()).toBe(200);
  expect(reloads).toBe(0);
});
test('owner login fits 360px with doubled text sizes', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'en'));
  await page.goto('http://localhost:3001/today');
  await expect(page.getByRole('button', { name: 'Get verification code' })).toBeVisible();
  // Text enlargement simulation, not an actual phone accessibility setting or browser zoom.
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>('body *')].map(
      (el) => [el, parseFloat(getComputedStyle(el).fontSize)] as const,
    );
    for (const [el, size] of sizes) el.style.fontSize = `${size * 2}px`;
  });
  await page.screenshot({
    path: test.info().outputPath('owner-login-360-large-text.png'),
    fullPage: true,
  });
  await test.info().attach('large-text-layout', {
    body: JSON.stringify(
      await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.login-page, .login-page *')]
          .filter((el) => el.getBoundingClientRect().right > innerWidth)
          .map((el) => ({
            tag: el.tagName,
            className: el.className,
            width: el.getBoundingClientRect().width,
            right: el.getBoundingClientRect().right,
            scrollWidth: el.scrollWidth,
          })),
      ),
    ),
    contentType: 'application/json',
  });
  expect(
    await page.evaluate(() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
    })),
  ).toEqual({ viewport: 360, width: 360 });
});
