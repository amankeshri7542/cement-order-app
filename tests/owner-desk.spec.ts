import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { en, hi } from '@shiv/i18n';
import { money, type Order } from '@shiv/shared';
import { test, expect } from './fixtures';

const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const productId = 'p4-counter-cement';
const productName = 'P4 Counter Cement';
test.use({ actionTimeout: 15000 });
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  await db.product.upsert({
    where: { id: productId },
    update: { stock: 50, lowStockAt: 25, active: true },
    create: {
      id: productId,
      name: productName,
      categoryId: 'cement',
      brand: 'QA',
      type: 'PPC',
      grade: 'PPC',
      unit: '50 kg bag',
      pricePaise: 40000,
      stock: 50,
      images: [],
      description: 'Phase 4 desk fixture only',
      recommendedUse: 'QA only',
    },
  });
});
test.afterAll(() => db.$disconnect());
async function signIn(
  page: Page,
  words = { send: en['owner.sendCode'], open: en['owner.signIn'] },
) {
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: words.send }).click();
  await page
    .locator('input[autocomplete="one-time-code"]')
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: words.open }).click();
}

test('the desk opens in Hindi with no pre-filled number and switches to English', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'hi'));
  await page.goto(`${desk}/today`);
  await expect(page.getByRole('heading', { name: hi['owner.loginTitle'] })).toBeVisible();
  const phone = page.getByRole('textbox', { name: hi['owner.loginPhone'] });
  await expect(phone).toHaveValue('');
  await phone.fill('9297513713');
  await signIn(page, { send: hi['owner.sendCode'], open: hi['owner.signIn'] });
  await expect(page.getByRole('heading', { name: hi['owner.today'], exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: hi['owner.nextWork'], exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await page.goto(`${desk}/more?view=language`);
  await page.getByLabel(hi['owner.language']).selectOption('en');
  await page.getByRole('link', { name: en['owner.today'], exact: true }).click();
  await expect(page.getByRole('heading', { name: en['owner.today'], exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(`${desk}/today`);
    await page.getByRole('textbox', { name: en['owner.loginPhone'] }).fill('9297513713');
    await signIn(page);
    await expect(page.getByRole('heading', { name: en['owner.today'], exact: true })).toBeVisible();
  });

  test('counter sale at the displayed price paid by UPI reaches stock and money report', async ({
    page,
  }) => {
    await page.goto(`${desk}/stock`);
    await page.getByRole('searchbox', { name: en['owner.searchProducts'] }).fill(productName);
    const product = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: productName, exact: true }) });
    await product.getByRole('button', { name: en['owner.changePrice'], exact: true }).click();
    const editor = page.getByRole('dialog');
    await editor.getByLabel(en['owner.price'], { exact: true }).fill('380');
    await editor.getByRole('button', { name: en['owner.save'], exact: true }).click();
    await expect(editor).toBeHidden();
    await page.getByRole('link', { name: en['owner.walkIn'], exact: true }).click();
    await page.getByRole('checkbox', { name: en['owner.anonymous'], exact: true }).uncheck();
    await page.getByLabel(en['owner.phone'], { exact: true }).fill('9297513798');
    await page.getByLabel(en['owner.name'], { exact: true }).fill('Ramesh mistri');
    await page.getByRole('button', { name: en['owner.continue'], exact: true }).click();
    await page.getByRole('searchbox', { name: en['owner.searchProducts'] }).fill(productName);
    await page
      .getByRole('textbox', { name: `${en['owner.quantity']} ${productName}`, exact: true })
      .fill('2');
    await page.getByRole('button', { name: en['owner.continue'], exact: true }).click();
    await page.getByRole('button', { name: en['owner.reviewOrder'], exact: true }).click();
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/admin/orders/phone') && r.request().method() === 'POST',
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: en['owner.placeOrder'], exact: true })
      .click();
    const response = await created;
    expect(response.status()).toBe(201);
    const order = (await response.json()) as Order;
    expect(order).toMatchObject({ source: 'WALK_IN', totalPaise: 76000 });
    await expect(page).toHaveURL(new RegExp(`/orders/${order.id}(?:\\?created=1)?$`));
    await page
      .getByRole('dialog')
      .getByRole('button', { name: en['owner.viewOrder'], exact: true })
      .click();
    const details = page
      .locator('details')
      .filter({
        has: page.locator('summary').filter({ hasText: new RegExp(`^${en['owner.more']}$`) }),
      })
      .first();
    await details.locator('summary').first().click();
    await page.getByRole('button', { name: en['owner.receiveMoney'], exact: true }).click();
    const receipt = page.getByRole('dialog');
    await receipt.getByLabel(en['owner.paymentMethod']).selectOption('UPI');
    await receipt.getByRole('button', { name: en['owner.receiveMoney'], exact: true }).click();
    await expect(receipt).toBeHidden();
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(48);
    const customer = await db.user.findUniqueOrThrow({ where: { id: order.userId } });
    expect(customer.name).toBe('Ramesh mistri');
    const payment = await db.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe('CAPTURED');
    const sale = await db.financialMovement.findFirstOrThrow({
      where: { paymentId: payment.id, kind: 'COLLECTION' },
    });
    expect(sale).toMatchObject({ channel: 'UPI', amountPaise: 76000 });
    expect(
      await db.financialMovement.count({ where: { paymentId: payment.id, kind: 'COLLECTION' } }),
    ).toBe(1);
    await page.goto(`${desk}/more?view=reports`);
    await expect(
      page.getByRole('heading', { name: en['owner.reports'], exact: true }),
    ).toBeVisible();
    const report = await page.evaluate(async () => {
      const day = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
      const response = await fetch(
        `http://localhost:4010/api/v1/admin/reports/money?from=${day}&to=${day}`,
        { credentials: 'include' },
      );
      return response.json();
    });
    expect(report.collections.upiPaise).toBeGreaterThanOrEqual(76000);
    const collections = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: en['owner.collections'], exact: true }) });
    await expect(collections).toContainText(money(report.netPaise));
    await page.getByRole('button', { name: en['owner.week'], exact: true }).click();
    await expect(page.getByRole('button', { name: en['owner.week'], exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: en['owner.export'], exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^shiv-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await file.path())!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('UPI');
  });

  test('the desk installs: manifest and alert worker load under security policy', async ({
    page,
    browserName,
  }) => {
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      return link ? (await fetch(link.href)).json() : null;
    });
    expect(manifest).toMatchObject({
      short_name: 'शिव डेस्क',
      display: 'standalone',
      lang: 'hi',
      start_url: '/today',
    });
    // Linux WebKit has no service workers and macOS WebKit does; Chrome proves the policy allows it.
    test.skip(browserName !== 'chromium', 'service workers are checked in Chrome');
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration('/'))?.active?.state ?? null,
        ),
      )
      .toBe('activated');
  });

  test('a per-product low-stock level drives its warning', async ({ page }) => {
    await page.goto(`${desk}/more?view=products`);
    await page.getByRole('textbox', { name: 'Search products' }).fill(productName);
    await page.getByRole('button', { name: `Edit ${productName}` }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Low-stock alert at').fill('60');
    await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.goto(`${desk}/stock`);
    await page.getByRole('searchbox', { name: en['owner.searchProducts'] }).fill(productName);
    const row = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: productName, exact: true }) });
    await expect(row.getByText(en['owner.lowStock'], { exact: true })).toBeVisible();
    expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).lowStockAt).toBe(60);
  });

  test('staff screen edits roles, queues a WhatsApp test alert and logs it in plain language', async ({
    page,
  }) => {
    await page.goto(`${desk}/more?view=staff`);
    await page.getByRole('button', { name: 'Edit Phase 4 desk admin' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Role at the shop').fill('Retail counter');
    await dialog.getByRole('checkbox', { name: /WhatsApp alerts/ }).check();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText('Retail counter · +919297513713 · WhatsApp alerts on'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Send a test alert' }).click();
    await expect(page.getByText(/Test alert sent/)).toBeVisible();
    const log = page.locator('.activity-list li').filter({ hasText: 'Test alert' }).first();
    await expect(log).toContainText('Sent');
    await expect(log).toContainText('…3713');
    expect(
      await db.outboundMessage.count({
        where: { template: 'shiv_test_alert', recipient: '919297513713', status: 'SENT' },
      }),
    ).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Turn on alerts here' }).click();
    await expect(page.locator('.error[role="alert"]')).toContainText(
      /not set up on the server|cannot show alerts/,
    );
    await page.goto(`${desk}/more?view=activity`);
    const entry = page.getByRole('article').filter({ hasText: en['owner.staffChanged'] }).first();
    await expect(entry).toContainText('Phase 4 desk admin');
    await expect(entry).not.toContainText('{');
  });

  test.describe('lost responses', () => {
    // WebKit routes requests around page.route() once the desk's service worker controls the page.
    test.use({ serviceWorkers: 'block' });
    test('a lost stock receipt can be closed and retried without adding stock twice', async ({
      page,
    }) => {
      const quantity = 7;
      const note = `Lost stock receipt ${Date.now()}`;
      const before = await db.product.findUniqueOrThrow({ where: { id: productId } });
      await page.goto(`${desk}/stock`);
      await page.getByRole('searchbox', { name: en['owner.searchProducts'] }).fill(productName);
      const product = page.getByRole('article').filter({
        has: page.getByRole('heading', { name: productName, exact: true }),
      });
      await product.getByRole('button', { name: en['owner.stockReceived'], exact: true }).click();
      const attempts: Record<string, unknown>[] = [];
      let committed: { id: string } | undefined;
      await page.route(`**/api/v1/admin/products/${productId}/movements`, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        attempts.push(route.request().postDataJSON() as Record<string, unknown>);
        if (attempts.length !== 1) return route.continue();
        const response = await route.fetch();
        expect(response.ok(), await response.text()).toBe(true);
        committed = (await response.json()) as { id: string };
        // The database commits; only the receipt sent back to this browser is lost.
        await route.abort('connectionfailed');
      });
      const receipt = page.getByRole('dialog', { name: en['owner.stockReceived'], exact: true });
      await receipt
        .getByLabel(en['owner.purchaseQuantity'], { exact: true })
        .fill(String(quantity));
      await receipt.getByLabel(en['owner.stockNote'], { exact: true }).fill(note);
      await receipt.getByRole('button', { name: en['owner.save'], exact: true }).click();
      await expect(receipt.getByRole('alert')).toContainText(en['error.network']);
      await expect(
        receipt.getByLabel(en['owner.purchaseQuantity'], { exact: true }),
      ).toBeDisabled();
      await expect(receipt.getByLabel(en['owner.stockNote'], { exact: true })).toBeDisabled();
      // Transport failures still refresh stock visible behind the receipt sheet.
      await expect(product).toContainText(
        en['owner.stockCount'].replace('{count}', String(before.stock + quantity)),
      );
      await receipt.getByRole('button', { name: en['owner.close'], exact: true }).click();
      await expect(receipt).toBeHidden();
      await product.getByRole('button', { name: en['owner.stockReceived'], exact: true }).click();
      await expect(receipt.getByLabel(en['owner.purchaseQuantity'], { exact: true })).toHaveValue(
        String(quantity),
      );
      await expect(receipt.getByLabel(en['owner.stockNote'], { exact: true })).toHaveValue(note);
      await expect(
        receipt.getByLabel(en['owner.purchaseQuantity'], { exact: true }),
      ).toBeDisabled();
      await expect(receipt.getByLabel(en['owner.stockNote'], { exact: true })).toBeDisabled();
      await receipt.getByRole('button', { name: en['owner.retry'], exact: true }).click();
      await expect(receipt).toBeHidden();
      expect(committed).toBeDefined();
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      expect(attempts[0]).toMatchObject({ kind: 'PURCHASE_IN', quantity, note });
      const movements = await db.inventoryMovement.findMany({
        where: { idempotencyKey: String(attempts[0].idempotencyKey) },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        id: committed!.id,
        productId,
        kind: 'PURCHASE_IN',
        quantity,
        note,
        balanceAfter: before.stock + quantity,
      });
      expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(
        before.stock + quantity,
      );
      await expect(product).toContainText(
        en['owner.stockCount'].replace('{count}', String(before.stock + quantity)),
      );
    });
  });
});
