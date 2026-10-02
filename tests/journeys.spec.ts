import { test, expect, type Page } from '@playwright/test';
import { productSchema } from '@shiv/shared';

async function mobileLogin(page: Page, phone: string) {
  await page.goto('http://localhost:8082');
  await page.getByRole('tab', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Mobile number (+91)' }).fill(phone);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code' }).click();
  const code = (await (await response).json()).devCode;
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code);
  await page.getByRole('button', { name: 'Verify & continue' }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}
async function adminLogin(page: Page, phone = '9297513707') {
  await page.goto('http://localhost:3001');
  await page.getByRole('textbox', { name: 'Staff mobile number' }).fill(phone);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code' }).click();
  const code = (await (await response).json()).devCode;
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(code);
  await page.getByRole('button', { name: 'Open store desk' }).click();
}
test('customer places a COD order, tracks it, reorders and requests a bulk quote', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const runtimeErrors: string[] = [];
  page.on('pageerror', (e) => runtimeErrors.push(e.message));
  await mobileLogin(page, '9888888881');
  await page.getByRole('button', { name: 'Saved addresses', exact: true }).click();
  for (const [name, value] of [
    ['Recipient name', 'Ravi Kumar'],
    ['Building, plot or street', 'Plot 24'],
    ['Area / locality', 'Kankarbagh'],
    ['Pincode', '800020'],
  ])
    await page.getByRole('textbox', { name, exact: true }).fill(value!);
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page.getByText('Address saved', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Products' }).click();
  await page.getByRole('button', { name: 'View UltraTech Super' }).click();
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await page.getByRole('button', { name: 'Your cart, 1 products' }).click();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await page.getByRole('button', { name: 'Review your order' }).click();
  await expect(page.getByText('₹4,600.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText('Order received.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Order again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeVisible();
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Get bulk price', exact: true }).click();
  await page.getByRole('button', { name: 'UltraTech Super', exact: true }).click();
  await page.getByRole('button', { name: 'Send bulk request' }).click();
  await expect(page.getByText('Requested', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.getByRole('tab', { name: 'होम' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: 'test-results/customer-mobile.png' });
});
test('admin changes price and finance policy, fulfils an order and replies to a quotation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await adminLogin(page);
  await expect(page.getByRole('heading', { name: 'A good day to build.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-overview.png', fullPage: true });
  await page.getByRole('button', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'Edit UltraTech Super' }).click();
  await page.getByLabel('Selling price (₹)').fill('425');
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByText('₹425.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finance & settings', exact: true }).click();
  await page.getByLabel('Flat delivery charge (₹)').fill('600');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Store and finance settings saved')).toBeVisible();
  await page
    .getByRole('button', { name: /^Orders/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: /^Open SC-/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Mark preparing' }).click();
  await page.getByRole('button', { name: 'Mark out for delivery' }).click();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Record cash payment received' }).click();
  await page.getByRole('button', { name: 'Mark delivered' }).click();
  await expect(
    page.getByRole('dialog').getByText('Delivered', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Bulk quotes', exact: true }).click();
  await page
    .getByRole('button', { name: /^Open quote/ })
    .first()
    .click();
  await page.getByLabel(/UltraTech Super.*price per unit/).fill('400');
  await page.getByRole('button', { name: 'Send quotation' }).click();
  await expect(page.getByText('Sent', { exact: true })).toBeVisible();
});
test('live price updates refresh the catalogue and invalidate an accepted checkout total', async ({
  page,
  request,
}) => {
  await mobileLogin(page, '9888888883');
  await page.getByRole('button', { name: 'Saved addresses', exact: true }).click();
  for (const [name, value] of [
    ['Recipient name', 'Price review customer'],
    ['Building, plot or street', 'Plot 25'],
    ['Area / locality', 'Patna'],
    ['Pincode', '800020'],
  ])
    await page.getByRole('textbox', { name, exact: true }).fill(value!);
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page.getByText('Address saved', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Products' }).click();
  const otp = await request.post('http://localhost:4010/api/v1/auth/otp/request', {
    data: { phone: '+919297513708' },
  });
  const login = await request.post('http://localhost:4010/api/v1/auth/otp/verify', {
    data: { phone: '+919297513708', code: (await otp.json()).devCode },
  });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  async function updatePrice(pricePaise: number) {
    const result = await request.get('http://localhost:4010/api/v1/products/test-ultratech');
    const product = await result.json();
    const data = Object.fromEntries(
      Object.keys(productSchema.shape).map((key) => [key, product[key]]),
    );
    const response = await request.patch(
      'http://localhost:4010/api/v1/admin/products/test-ultratech',
      { headers, data: { ...data, pricePaise, expectedVersion: product.version } },
    );
    expect(response.ok()).toBe(true);
  }
  await updatePrice(45000);
  await expect(page.getByText('₹450.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View UltraTech Super' }).click();
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await page.getByRole('button', { name: 'Your cart, 1 products' }).click();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await page.getByRole('button', { name: 'Review your order' }).click();
  await page.getByRole('checkbox').check();
  await updatePrice(47500);
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByRole('alert')).toContainText('Review the updated total');
  await page.getByRole('button', { name: 'Review your order' }).click();
  await expect(page.getByText('₹5,350.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText('Order received.', { exact: true })).toBeVisible();
});

test('admin UI denies a customer account and a lost network produces a recoverable error', async ({
  page,
}) => {
  await adminLogin(page, '9888888882');
  await expect(
    page.getByRole('alert').filter({ hasText: 'does not have store staff access' }),
  ).toBeVisible();
  await page.goto('http://localhost:8082');
  await page.route('**/api/v1/products', (route) => route.abort());
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Check your connection');
  await page.unroute('**/api/v1/products');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View UltraTech Super' })).toBeVisible();
});
