import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { appLogin, appUrl, basketTab, openMaterial, tab } from './app';

// What the customer app does on a bad connection and how it speaks about quantities and the shop's
// phone (Master Plan v2, Phase 3). "The store cannot be reached" is made by failing every call to
// the API while the app itself still loads, as the other recovery specs do.
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
)
  throw new Error('Disposable loopback database required');
const db = new PrismaClient({ datasourceUrl: url });
test.afterAll(() => db.$disconnect());

const unreachable = '**/api/v1/**';
const storeUnreachable = (page: Page) =>
  page.route(unreachable, (route) => route.abort('connectionfailed'));
/** The browser keeps AsyncStorage values in localStorage under the same key. */
const saved = (page: Page, prefix: string) =>
  page.waitForFunction(
    (start) => Object.keys(localStorage).some((key) => key.startsWith(start)),
    prefix,
  );

test('the last rates stay on screen, with their age, when the store cannot be reached', async ({
  page,
}) => {
  await page.goto(appUrl);
  const cement = page.getByRole('button', { name: /^Cement: from ₹/ });
  await expect(cement).toBeVisible();
  const label = (await cement.getAttribute('aria-label'))!;
  await saved(page, 'shiv_cache_v1:catalog');

  await storeUnreachable(page);
  await page.reload();
  await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  const banner = page.getByRole('alert').filter({ hasText: 'Showing prices saved' });
  await expect(banner).toContainText('Check your connection');

  // The connection returns: the store's own rates replace the saved ones and the notice goes,
  // whether the customer taps Retry or the app notices first.
  await page.unroute(unreachable);
  await expect(async () => {
    if (await banner.isVisible())
      await banner.getByRole('button', { name: 'Retry' }).click({ timeout: 1000 });
    await expect(banner).toBeHidden({ timeout: 1000 });
  }).toPass();
  await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
});

test('the Materials list keeps its first page for a visit with no signal', async ({ page }) => {
  await page.goto(appUrl);
  await tab(page, 'Materials').click();
  const count = page.getByText(/^\d+ materials?( · more below)?$/);
  await expect(count).toBeVisible();
  const counted = (await count.textContent())!;
  await saved(page, 'shiv_cache_v1:catalogue');

  await storeUnreachable(page);
  await page.reload();
  await tab(page, 'Materials').click();
  await expect(page.getByText(counted, { exact: true })).toBeVisible();
  await expect(page.getByText(/Showing the list saved/)).toBeVisible();
  await expect(page.getByTestId(/^product-/).first()).toBeVisible();
});

test('a connection that drops twice recovers by itself and shows no error', async ({ page }) => {
  let dropped = 0;
  let served = 0;
  await page.route('**/api/v1/categories', (route) => {
    if (dropped < 2) {
      dropped += 1;
      return route.abort('connectionfailed');
    }
    served += 1;
    return route.continue();
  });
  await page.goto(appUrl);
  await expect(page.getByRole('button', { name: /^Cement: from ₹/ })).toBeVisible();
  expect({ dropped, served: served > 0 }).toEqual({ dropped: 2, served: true });
  await expect(page.getByRole('alert').filter({ hasText: 'Check your connection' })).toHaveCount(0);
});

test('a customer’s saved orders are removed from the phone when they sign out', async ({
  page,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await appLogin(page, '9900000771');
  await tab(page, 'Orders').click();
  await expect(page.getByText('No orders yet', { exact: true })).toBeVisible();
  await saved(page, 'shiv_cache_v1:orders:');
  await tab(page, 'Account').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.startsWith('shiv_cache_v1:orders:')),
      ),
    )
    .toEqual([]);
});

test('a new sign-in code can be asked for after thirty seconds, not before', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-06-01T10:00:00Z') });
  await page.goto(appUrl);
  await tab(page, 'Account').click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('textbox', { name: 'Mobile number (+91)', exact: true }).fill('9900000772');
  const first = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code', exact: true }).click();
  await first;
  await expect(page.getByRole('button', { name: /^Resend code in \d+s$/ })).toBeDisabled();

  // The store's own cooldown is the same thirty seconds; its clock is real, so clear it here.
  await db.otpChallenge.updateMany({
    where: { phone: '+919900000772' },
    data: { sentAt: new Date(Date.now() - 31000) },
  });
  await page.clock.fastForward('00:31');
  const resend = page.getByRole('button', { name: 'Resend code', exact: true });
  await expect(resend).toBeEnabled();
  const second = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.status() === 201,
  );
  await resend.click();
  await second;
  await expect(page.getByRole('button', { name: /^Resend code in \d+s$/ })).toBeDisabled();
});

test('the order-by-phone card appears only once the shop’s number is approved', async ({
  page,
}) => {
  await page.goto(appUrl);
  await expect(page.getByRole('button', { name: /^Cement: from ₹/ })).toBeVisible();
  await expect(page.getByTestId('call-to-order')).toHaveCount(0);

  const approved = (contactApproved: boolean) =>
    page.route('**/api/v1/shop-content', (route) =>
      route.fulfill({
        json: { contactApproved, phone: '+919100000999', whatsapp: '+919100000999' },
        headers: {
          'access-control-allow-origin': appUrl,
          'access-control-allow-credentials': 'true',
        },
      }),
    );
  await approved(true);
  await page.reload();
  const card = page.getByTestId('call-to-order');
  await expect(card.getByRole('button', { name: 'Call the shop' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'WhatsApp' })).toBeVisible();
  // Under the empty states too.
  await basketTab(page).click();
  await expect(page.getByText('Your basket is empty', { exact: true })).toBeVisible();
  await expect(page.getByTestId('call-to-order')).toBeVisible();

  await page.unroute('**/api/v1/shop-content');
  await approved(false);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Cement: from ₹/ })).toBeVisible();
  await expect(page.getByTestId('call-to-order')).toHaveCount(0);
});

test('a product says what one unit is and the order rule in plain words', async ({ page }) => {
  const name = 'Pack Words Cement';
  await db.product.upsert({
    where: { id: 'p3-pack-words' },
    update: { stock: 500, active: true, minQuantity: 10, quantityStep: 10, packSize: '50 kg bag' },
    create: {
      id: 'p3-pack-words',
      categoryId: 'cement',
      name,
      brand: 'Test',
      type: 'Cement',
      grade: 'PPC',
      unit: 'bag',
      packSize: '50 kg bag',
      minQuantity: 10,
      quantityStep: 10,
      pricePaise: 40000,
      stock: 500,
      images: [],
      description: 'Browser fixture only.',
      recommendedUse: 'Test only.',
    },
  });
  await page.goto(appUrl);
  await openMaterial(page, name);
  await expect(page.getByText('1 bag = 50 kg', { exact: true })).toBeVisible();
  await expect(page.getByText('At least 10 bags, in lots of 10', { exact: true })).toBeVisible();
  await expect(page.getByText(/steps of|minimum 10/i)).toHaveCount(0);
});
