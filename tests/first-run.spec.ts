import { PrismaClient } from '@prisma/client';
import type { Browser, Page } from '@playwright/test';
import { test, expect, deskLanguage } from './fixtures';
import { hinglish } from '@shiv/i18n';
import { grantOwners } from '../apps/api/test/staff-helper';

// Phase 11 first run. A brand-new customer on the website (the app's is in customer-app.spec.ts), from a fresh install
// (nothing stored) to "what happens next" after their first order; and a new store's owner
// desk, whose Hindi setup screens persist the shop's real settings.
// Test data from tests/setup.ts: UltraTech Super ₹410/bag, pincode 800020 delivers for ₹500.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const site = 'http://localhost:3004';
const desk = 'http://localhost:3001';
const freshPhone = () => `9${String(Date.now()).slice(-9)}`;
// First-run checks start before a service worker has been installed.
test.use({ serviceWorkers: 'block' });
test.afterAll(() => db.$disconnect());

/** A browser with nothing saved: no language, no basket, no pincode, no session. */
async function freshInstall(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  return { context, page: await context.newPage() };
}

test('website first run: pincode, list, sign-in with name, order, what happens next', async ({
  browser,
}) => {
  const { context, page } = await freshInstall(browser);
  try {
    await page.goto(`${site}/delivery`);
    const pincode = page.getByRole('main').getByLabel('Site pincode');
    await expect(pincode).toBeEnabled();
    await pincode.fill('800020');
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(page.getByRole('main').getByText(/The shop delivers to 800020/)).toBeVisible();
    // Remembered: a reload fills and checks it again.
    await page.reload();
    await expect(pincode).toHaveValue('800020');
    await expect(page.getByRole('main').getByText(/Delivery ₹500/)).toBeVisible();

    await page.goto(`${site}/materials/cement/test-ultratech`);
    await page.getByRole('button', { name: 'Add UltraTech Super to your list' }).click();
    await page
      .locator('[data-site-nav]')
      .getByRole('link', { name: /Your list/ })
      .click();
    await expect(page).toHaveURL(`${site}/list`);
    await expect(page.getByRole('main').getByText(/The shop delivers to 800020/)).toBeVisible();

    // Sign in from the list; the new account is asked for a name once, then checkout.
    await page.locator('[data-exit="order"]').click();
    const mobile = page.getByRole('main').getByLabel('Mobile number', { exact: true });
    await expect(mobile).toBeEnabled();
    await mobile.fill(freshPhone());
    const otp = page.waitForResponse((r) => r.url().endsWith('/auth/otp/request'));
    await page.getByRole('button', { name: 'Get sign-in code', exact: true }).click();
    await page
      .getByRole('main')
      .getByLabel('Six-digit code')
      .fill((await (await otp).json()).devCode);
    await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible();
    await page.getByLabel('Your name', { exact: true }).fill('Asha Devi');
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await expect(page).toHaveURL(`${site}/checkout`, { timeout: 30000 });

    // With no saved address the form opens by itself, already holding name, phone and pincode.
    const form = page.locator('.address-form');
    await expect(form.getByLabel('Recipient name')).toHaveValue('Asha Devi');
    await expect(form.getByLabel('Pincode')).toHaveValue('800020');
    await expect(page.getByText('Choose or add a delivery address first.')).toBeVisible();
    await form.getByLabel('House / street / site').fill('Plot 7');
    await form.getByLabel('Area', { exact: true }).fill('Rajendra Nagar');
    await form.getByRole('button', { name: 'Save address', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Deliver here' })).toBeChecked();
    await page.getByRole('button', { name: 'Review current order', exact: true }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Place COD order', exact: true }).click();

    await expect(
      page.getByRole('heading', { name: 'Thank you. Your order is placed.', exact: true }),
    ).toBeVisible();
    const next = page.getByRole('region', { name: 'What happens next' });
    await expect(next).toBeVisible();
    await expect(next.locator('[aria-current="step"]')).toContainText('The shop confirms');
    await expect(next.getByRole('link', { name: /Call the shop|WhatsApp/ })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

/** A new owner signs in with OTP and the default Hindi interface. */
async function deskSignIn(page: Page, phone: string) {
  await deskLanguage(page.context(), 'hinglish');
  await page.goto(`${desk}/today`);
  const mobile = page.getByRole('textbox', { name: hinglish['owner.loginPhone'] });
  await expect(mobile).toHaveValue('');
  await mobile.fill(phone);
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: hinglish['owner.sendCode'] }).click();
  await page
    .getByRole('textbox', { name: hinglish['owner.code'], exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: hinglish['owner.signIn'] }).click();
  await expect(
    page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi-Latn');
}
test('owner first run: Hindi setup routes save store information on the server', async ({
  page,
}) => {
  const phone = freshPhone();
  const owner = await db.user.create({
    data: { phone: `+91${phone}`, name: 'First-run owner', role: 'ADMIN' },
  });
  await grantOwners(db);
  await deskSignIn(page, phone);
  expect(await db.adminCredential.count({ where: { userId: owner.id } })).toBe(0);
  const navigation = page.getByRole('navigation', { name: hinglish['owner.desk'], exact: true });
  await navigation.getByRole('link', { name: hinglish['owner.more'], exact: true }).click();
  await page.getByRole('link', { name: hinglish['owner.settings.title'], exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('listitem').filter({ hasText: '800020' }).first()).toBeVisible();
  const before = await db.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });
  const information = page.getByLabel(hinglish['owner.deliveryMessage'], { exact: true });
  await expect(information).toHaveValue(before.deliveryMessage);
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/admin/store') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: hinglish['owner.save'], exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const after = await db.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });
  expect(after.version).toBe(before.version + 1);
  expect(after).toMatchObject({
    phone: before.phone,
    deliveryMessage: before.deliveryMessage,
    deliveryFeePaise: before.deliveryFeePaise,
    freeDeliveryAbovePaise: before.freeDeliveryAbovePaise,
    onlinePaymentsEnabled: before.onlinePaymentsEnabled,
  });
  await page.reload();
  await expect(information).toHaveValue(after.deliveryMessage);
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi-Latn');
  await navigation.getByRole('link', { name: hinglish['owner.more'], exact: true }).click();
  await page.getByRole('link', { name: hinglish['owner.staff'], exact: true }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByText(/First-run owner/).first()).toBeVisible();
});
