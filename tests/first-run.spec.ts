import { PrismaClient } from '@prisma/client';
import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { appUrl } from './app';
import { hi } from '@shiv/i18n';

// Phase 11 first run. A brand-new customer on the app and on the website, from a fresh install
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

test('app first run: language, pincode, basket, sign-in with name, order, what happens next', async ({
  browser,
}) => {
  const { context, page } = await freshInstall(browser);
  try {
    await page.goto(appUrl);
    // The language is asked once, before anything else.
    await page.getByRole('button', { name: 'Choose English' }).click();
    await expect(page.getByRole('heading', { name: 'Your first order in 3 steps' })).toBeVisible();
    await expect(page.getByText('Check your site pincode', { exact: true })).toBeVisible();

    // The pincode check remembers the pincode for the basket and the new address.
    await page.getByRole('textbox', { name: 'Delivery pincode' }).fill('800020');
    await expect(page.getByText(/Delivery to 800020/)).toBeVisible();
    await expect(page.getByText(/Delivery fee ₹500\.00 · minimum order ₹0\.00/)).toBeVisible();

    await page.getByRole('tab', { name: 'Materials', exact: true }).click();
    await page.getByRole('button', { name: 'View UltraTech Super', exact: true }).click();
    await page.getByRole('textbox', { name: 'Quantity', exact: true }).fill('10');
    await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
    await page.getByRole('tab', { name: /^Basket/ }).click();
    await expect(page.getByRole('heading', { name: 'Your basket', exact: true })).toBeVisible();
    // Delivery for the remembered pincode shows in the basket before sign-in.
    await expect(page.getByText(/Delivery to 800020/)).toBeVisible();

    // Sign in from the basket; a new account is asked for a name once.
    await page.getByRole('button', { name: 'Sign in to order', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Mobile number (+91)', exact: true })
      .fill(freshPhone());
    const sent = page.waitForResponse(
      (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
    );
    await page.getByRole('button', { name: 'Get verification code', exact: true }).click();
    const code = (await (await sent).json()).devCode;
    await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code);
    await page.getByRole('button', { name: 'Verify & continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Asha Devi');
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Checkout asks for an address; the new address starts from the name and the pincode.
    await page.getByRole('button', { name: 'Add address', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Pincode', exact: true })).toHaveValue('800020');
    await expect(page.getByRole('textbox', { name: 'Person receiving', exact: true })).toHaveValue(
      'Asha Devi',
    );
    await page.getByRole('textbox', { name: 'House, plot or street', exact: true }).fill('Plot 7');
    await page
      .getByRole('textbox', { name: 'Area / locality', exact: true })
      .fill('Rajendra Nagar');
    await page.getByRole('button', { name: 'Save address', exact: true }).click();
    await page.getByRole('button', { name: 'Place order · ₹4,600.00', exact: true }).click();

    // What happens next mirrors the real status: received, then the shop's call.
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What happens next' })).toBeVisible();
    await expect(page.getByLabel(/^The shop calls you\. Now\./)).toBeVisible();
    await expect(
      page.getByText('Someone from the shop calls to confirm', { exact: false }),
    ).toBeVisible();
    // No call or WhatsApp buttons while the shop's number is not approved (C2).
    await expect(page.getByRole('button', { name: 'Call the shop' })).toHaveCount(0);

    // Home greets by name; the first-order card is gone now that an order exists.
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await expect(page.getByText('Namaste, Asha', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your first order in 3 steps' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('app: the language chosen before signing in is the one the store keeps for the account', async ({
  browser,
}) => {
  // A new account starts as English on the server; notifications are worded from what is kept.
  const { context, page } = await freshInstall(browser);
  try {
    const phone = freshPhone();
    await page.goto(appUrl);
    await page.getByRole('button', { name: 'हिंदी चुनें' }).click();
    await page.getByRole('tab', { name: 'ऑर्डर', exact: true }).click();
    await page.getByRole('textbox', { name: /मोबाइल नंबर/ }).fill(phone);
    const sent = page.waitForResponse(
      (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
    );
    await page.getByRole('button', { name: 'कोड भेजें', exact: true }).click();
    const code = (await (await sent).json()).devCode;
    await page.getByRole('textbox', { name: 'सत्यापन कोड', exact: true }).fill(code);
    await page.getByRole('button', { name: 'कोड पक्का करें', exact: true }).click();
    // Skipping the name question must not lose the language either.
    await page.getByRole('button', { name: 'अभी छोड़ें', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(async () => {
      const user = await db.user.findUnique({ where: { phone: `+91${phone}` } });
      expect(user?.language).toBe('hi');
    }).toPass();
  } finally {
    await context.close();
  }
});

test('website first run: language, pincode, basket, sign-in with name, order, what happens next', async ({
  browser,
}) => {
  const { context, page } = await freshInstall(browser);
  try {
    await page.goto(site);
    // Hindi and back: the first-order card and the pincode check speak both languages.
    await page.getByRole('button', { name: 'हिन्दी', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'पहला ऑर्डर, 3 आसान कदम' })).toBeVisible();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    const firstOrder = page.getByRole('region', { name: 'Your first order in 3 steps' });
    await expect(firstOrder).toBeVisible();

    const pincode = page.getByRole('main').getByLabel('Delivery pincode');
    await expect(pincode).toBeEnabled();
    await pincode.fill('800020');
    await page.getByRole('button', { name: 'Check pincode', exact: true }).click();
    await expect(page.locator('#delivery .delivery-result')).toContainText('Delivery to 800020');
    // Remembered: a reload fills and checks it again.
    await page.reload();
    await expect(pincode).toHaveValue('800020');
    await expect(page.locator('#delivery .delivery-result')).toContainText('Delivery fee: ₹500.00');

    await page.goto(`${site}/products/test-ultratech`);
    await page.getByRole('button', { name: 'Add to basket', exact: true }).click();
    await page.getByRole('link', { name: /^Basket 1$/ }).click();
    const basketDelivery = page.locator('#basket-delivery .delivery-result');
    await expect(basketDelivery).toContainText('Delivery to 800020');

    // Sign in from the basket; the new account is asked for a name once, then checkout.
    await page.getByRole('link', { name: 'Sign in to checkout', exact: true }).click();
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
    await expect(page).toHaveURL(`${site}/checkout`);

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
    await expect(next.locator('[aria-current="step"]')).toContainText('The shop calls you');
    await expect(next.getByRole('link', { name: /Call the shop|WhatsApp/ })).toHaveCount(0);

    // Back home: the first-order card stays away once an order exists.
    await page.goto(site);
    await expect(page.getByRole('heading', { name: /^Building materials/ })).toBeVisible();
    await expect(page.locator('#delivery .delivery-result')).toContainText('Delivery to 800020');
    await expect(firstOrder).toHaveCount(0);
  } finally {
    await context.close();
  }
});

/** A new owner signs in with OTP and the default Hindi interface. */
async function deskSignIn(page: Page, phone: string) {
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'hi'));
  await page.goto(`${desk}/today`);
  const mobile = page.getByRole('textbox', { name: hi['owner.loginPhone'] });
  await expect(mobile).toHaveValue('');
  await mobile.fill(phone);
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: hi['owner.sendCode'] }).click();
  await page
    .getByRole('textbox', { name: hi['owner.code'], exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: hi['owner.signIn'] }).click();
  await expect(page.getByRole('heading', { name: hi['owner.today'], exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
}
test('owner first run: Hindi setup routes save store information on the server', async ({
  page,
}) => {
  const phone = freshPhone();
  const owner = await db.user.create({
    data: { phone: `+91${phone}`, name: 'First-run owner', role: 'ADMIN' },
  });
  await deskSignIn(page, phone);
  expect(await db.adminCredential.count({ where: { userId: owner.id } })).toBe(0);
  const navigation = page.getByRole('navigation', { name: hi['owner.desk'], exact: true });
  await navigation.getByRole('link', { name: hi['owner.more'], exact: true }).click();
  for (const key of ['owner.zones', 'owner.storeDetails', 'owner.staff'] as const)
    await expect(page.getByRole('link', { name: hi[key], exact: true })).toBeVisible();
  await page.getByRole('link', { name: hi['owner.zones'], exact: true }).click();
  await expect(page).toHaveURL(/\/more\?view=zones$/);
  await expect(page.getByRole('heading', { name: hi['owner.zones'], exact: true })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: '800020' }).first()).toBeVisible();
  await navigation.getByRole('link', { name: hi['owner.more'], exact: true }).click();
  await page.getByRole('link', { name: hi['owner.storeDetails'], exact: true }).click();
  await expect(page).toHaveURL(/\/more\?view=store$/);
  const before = await db.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });
  const information = page.getByLabel(hi['owner.deliveryMessage'], { exact: true });
  await expect(information).toHaveValue(before.deliveryMessage);
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/admin/store') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: hi['owner.save'], exact: true }).click();
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
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await navigation.getByRole('link', { name: hi['owner.more'], exact: true }).click();
  await page.getByRole('link', { name: hi['owner.staff'], exact: true }).click();
  await expect(page).toHaveURL(/\/more\?view=staff$/);
  await expect(page.getByText(/^First-run owner · /)).toBeVisible();
});
