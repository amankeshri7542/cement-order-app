import { hi } from '@shiv/i18n';
import { PrismaClient } from '@prisma/client';
import { money } from '@shiv/shared';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const customerId = 'p2-khata-customer';
const customerPhone = '+919100000702';
const customerName = 'सुनीता खाता परीक्षण';
const productId = 'p2-khata-cement';
const productName = 'Phase Two Khata Cement';
const productNameHi = 'खाता अभ्यास सीमेंट';
const pricePaise = 35000;
const deliveryFeePaise = 2500;
const totalPaise = pricePaise * 2 + deliveryFeePaise;
const paymentPaise = 20000;
const customerNote = 'साइट पर माल भेजने से पहले सुबह फ़ोन करें।';
const paymentNote = 'पहली नकद किस्त';
const reversalNote = 'किस्त गलत ग्राहक में दर्ज हुई थी';

// A registered service worker makes WebKit route requests around page.route(), which this spec uses.
test.use({ viewport: { width: 360, height: 800 }, actionTimeout: 15000, serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
  )
    throw new Error('Owner khata journeys require a disposable _test database.');
  await db.user.upsert({
    where: { id: customerId },
    update: { name: customerName, creditAllowed: false, creditLimitPaise: null },
    create: { id: customerId, phone: customerPhone, name: customerName, role: 'CUSTOMER' },
  });
  // Udhaar can only be turned on over a signed opening, here a signed nothing.
  await db.khataSignoff.createMany({
    data: [
      {
        customerId,
        firmId: 'firm_main',
        locationId: 'loc_main',
        asOf: '2026-01-01',
        chosenPaise: 0,
        enteredById: 'browser-fixture',
        approvedById: 'browser-fixture',
        requestHash: 'browser-fixture',
      },
    ],
    skipDuplicates: true,
  });
  await db.product.upsert({
    where: { id: productId },
    update: { stock: 50, pricePaise, active: true },
    create: {
      id: productId,
      categoryId: 'cement',
      name: productName,
      nameHi: productNameHi,
      brand: 'Shiv',
      type: 'Cement',
      grade: 'PPC',
      unit: 'bag',
      packSize: '50 kg',
      pricePaise,
      stock: 50,
      images: [],
      description: 'Khata browser fixture only.',
      descriptionHi: 'खाते का अभ्यास',
      recommendedUse: 'Test only.',
    },
  });
  await db.deliveryZone.upsert({
    where: { id: 'p2-khata-zone' },
    update: { deliveryFeePaise, minimumOrderPaise: 0, freeDeliveryAbovePaise: null, active: true },
    create: {
      id: 'p2-khata-zone',
      name: 'खाता अभ्यास इलाका',
      deliveryFeePaise,
      minimumOrderPaise: 0,
      estimate: 'Aaj',
      pincodes: { create: [{ pincode: '800072' }] },
    },
  });
});
test.afterAll(() => db.$disconnect());

async function signInHindi(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('shiv-owner-language', 'hi');
    } catch {
      /* Storage may be disabled. */
    }
  });
  await page.goto(desk + '/today');
  await page
    .getByRole('textbox', { name: 'Staff ka mobile number', exact: true })
    .fill('9999997007');
  const sent = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.status() === 201,
  );
  await page.getByRole('button', { name: 'Code mangao', exact: true }).click();
  const challenge = (await (await sent).json()) as { devCode: string };
  await page.getByRole('textbox', { name: 'Code', exact: true }).fill(challenge.devCode);
  await page.getByRole('button', { name: 'Desk kholo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Aaj', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
}

test('Hindi customer settings, credit delivery, payment and reversal preserve the khata', async ({
  page,
}) => {
  test.setTimeout(120000);
  await signInHindi(page);
  await page.goto(`${desk}/customers/${customerId}`);
  await expect(page.getByRole('heading', { name: customerName, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Udhaar aur details', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Udhaar chalu karo', exact: true }).check();
  await page.getByRole('textbox', { name: 'Udhaar limit (₹)', exact: true }).fill('5000');
  await page.getByRole('textbox', { name: 'Area', exact: true }).fill('दानापुर अभ्यास');
  await page
    .getByRole('textbox', { name: 'Tag, comma lagakar', exact: true })
    .fill('ठेकेदार, नियमित');
  const settingsSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/admin/customers/${customerId}`) &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  );
  await page.getByRole('button', { name: 'Save karo', exact: true }).click();
  await settingsSaved;
  expect(await db.user.findUniqueOrThrow({ where: { id: customerId } })).toMatchObject({
    creditAllowed: true,
    creditLimitPaise: 500000,
    area: 'दानापुर अभ्यास',
    tags: ['ठेकेदार', 'नियमित'],
    khataBalancePaise: 0,
  });
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Dukaan ko kya yaad rakhna hai?', exact: true })
    .fill(customerNote);
  const noteSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/admin/customers/${customerId}/notes`) &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await page.getByRole('button', { name: 'Note jodo', exact: true }).click();
  await noteSaved;
  await expect(page.getByText(customerNote, { exact: true })).toBeVisible();
  expect(await db.customerNote.count({ where: { customerId, body: customerNote } })).toBe(1);

  await page
    .locator('#owner-main')
    .getByRole('link', { name: hi['owner.newOrder'], exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/orders/new\\?customer=${customerId}$`));
  await expect(page.getByRole('textbox', { name: 'Mobile number', exact: true })).toHaveValue(
    customerPhone.slice(3),
  );
  await expect(page.getByRole('textbox', { name: 'Grahak ka naam', exact: true })).toHaveValue(
    customerName,
  );
  await page.getByRole('button', { name: 'Aage badho', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Maal dhoondo', exact: true }).fill(productName);
  await expect(page.getByRole('heading', { name: productNameHi, exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: `${hi['owner.quantity']} ${productNameHi}`, exact: true })
    .fill('2');
  await page.getByRole('button', { name: 'Aage badho', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Ghar, plot ya site ka pata', exact: true })
    .fill('साइट ७२, स्कूल के पास');
  await page.getByRole('textbox', { name: 'Area', exact: true }).fill('दानापुर अभ्यास');
  await page.getByRole('textbox', { name: 'Pincode', exact: true }).fill('800072');
  await expect(page.getByRole('button', { name: 'Udhaar', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Udhaar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Udhaar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Order dekho', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Order dekho', exact: true });
  await expect(
    review.getByText(`${hi['owner.balanceAfter']}: ${money(totalPaise)}`, { exact: true }),
  ).toBeVisible();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/admin/orders/phone') &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await review.getByRole('button', { name: 'Order pakka karo', exact: true }).click();
  const order = (await (await created).json()) as {
    id: string;
    number: string;
    totalPaise: number;
  };
  expect(order.totalPaise).toBe(totalPaise);
  const success = page.getByRole('dialog', { name: 'Order ban gaya', exact: true });
  await expect(success).toBeVisible();
  await success.getByRole('button', { name: 'Order dekho', exact: true }).click();
  expect(await db.customerLedgerEntry.count({ where: { orderId: order.id } })).toBe(0);
  expect((await db.user.findUniqueOrThrow({ where: { id: customerId } })).khataBalancePaise).toBe(
    0,
  );
  await page.getByRole('button', { name: 'Taiyaari shuru karo', exact: true }).click();
  await page.getByRole('button', { name: 'Maal nikal gaya', exact: true }).click();
  let hiddenDeliveryReply = false;
  await page.route(`**/admin/orders/${order.id}/status`, async (route) => {
    const body = route.request().postDataJSON();
    if (body?.status === 'DELIVERED' && !hiddenDeliveryReply) {
      hiddenDeliveryReply = true;
      const committed = await route.fetch();
      expect(committed.ok()).toBeTruthy();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Maal pahunch gaya', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Maal pahunch gaya', exact: true })
    .getByRole('button', { name: 'Maal pahunch gaya', exact: true })
    .click();
  await expect(page.getByText('Pahunch gaya', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('Yeh bikri grahak ke khate mein hai.', { exact: true }),
  ).toBeVisible();
  const sale = await db.customerLedgerEntry.findUniqueOrThrow({ where: { orderId: order.id } });
  expect(sale).toMatchObject({
    customerId,
    kind: 'SALE_ON_CREDIT',
    amountPaise: totalPaise,
    balanceAfterPaise: totalPaise,
  });
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).stock).toBe(48);
  await page.reload();
  await expect(page.getByText('Pahunch gaya', { exact: true }).first()).toBeVisible();
  expect(hiddenDeliveryReply).toBe(true);
  expect(await db.customerLedgerEntry.count({ where: { orderId: order.id } })).toBe(1);
  await page.getByRole('link', { name: 'Udhaar', exact: true }).click();
  await expect(page.getByRole('heading', { name: customerName, exact: true })).toBeVisible();
  await expect(page.getByText(money(totalPaise), { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Paisa mil gaya', exact: true }).click();
  const receipt = page.getByRole('dialog', { name: 'Paisa mil gaya', exact: true });
  await receipt.getByRole('textbox', { name: 'Rakam (₹)', exact: true }).fill('200');
  await receipt.getByRole('textbox', { name: 'Note', exact: true }).fill(paymentNote);
  await receipt.getByLabel('Paisa kaise', { exact: true }).selectOption('CASH');
  await receipt.getByRole('button', { name: 'Save karo', exact: true }).click();
  await expect(receipt).toBeHidden();
  const paymentRow = page.getByRole('tabpanel').locator('article').filter({ hasText: paymentNote });
  await expect(paymentRow).toBeVisible();
  await expect(
    paymentRow.getByText(money(totalPaise - paymentPaise), { exact: true }),
  ).toBeVisible();
  const payment = await db.customerLedgerEntry.findFirstOrThrow({
    where: { customerId, kind: 'PAYMENT_RECEIVED', note: paymentNote },
    include: { financialMovement: true },
  });
  expect(payment).toMatchObject({
    amountPaise: -paymentPaise,
    balanceAfterPaise: totalPaise - paymentPaise,
    financialMovement: { kind: 'KHATA_PAYMENT', amountPaise: paymentPaise, channel: 'CASH' },
  });
  expect((await db.user.findUniqueOrThrow({ where: { id: customerId } })).khataBalancePaise).toBe(
    totalPaise - paymentPaise,
  );

  await paymentRow.getByRole('button', { name: 'Entry kaato', exact: true }).click();
  const reverse = page.getByRole('dialog', { name: 'Entry kaato', exact: true });
  await reverse
    .getByRole('textbox', { name: 'Kyon kaat rahe hain', exact: true })
    .fill(reversalNote);
  await reverse.getByRole('button', { name: 'Entry kaato', exact: true }).click();
  await expect(reverse).toBeHidden();
  await expect(page.getByRole('tabpanel').getByText(reversalNote, { exact: true })).toBeVisible();
  await expect(paymentRow.getByRole('button', { name: 'Entry kaato', exact: true })).toHaveCount(0);
  const reversal = await db.customerLedgerEntry.findUniqueOrThrow({
    where: { reversesId: payment.id },
    include: { financialMovement: true },
  });
  expect(reversal).toMatchObject({
    customerId,
    kind: 'REVERSAL',
    amountPaise: paymentPaise,
    balanceAfterPaise: totalPaise,
    note: reversalNote,
    financialMovement: {
      kind: 'KHATA_PAYMENT_REVERSAL',
      amountPaise: paymentPaise,
      channel: 'CASH',
    },
  });
  expect(
    (await db.customerLedgerEntry.findUniqueOrThrow({ where: { id: payment.id } })).amountPaise,
  ).toBe(-paymentPaise);
  expect((await db.user.findUniqueOrThrow({ where: { id: customerId } })).khataBalancePaise).toBe(
    totalPaise,
  );
  expect(await db.customerLedgerEntry.count({ where: { customerId } })).toBe(3);
  expect(
    await db.customerLedgerEntry.count({
      where: { customerId, orderId: order.id, kind: 'SALE_ON_CREDIT' },
    }),
  ).toBe(1);
  expect(
    await db.financialMovement.count({
      where: { id: { in: [payment.financialMovementId!, reversal.financialMovementId!] } },
    }),
  ).toBe(2);
  await page.goto(desk + '/khata');
  await expect(page.getByRole('heading', { name: 'Udhaar', exact: true })).toBeVisible();
  await expect(page.getByRole('link').filter({ hasText: customerName }).first()).toBeVisible();
});

test('unsaved customer notes survive cancelled payment and tab navigation', async ({ page }) => {
  await signInHindi(page);
  await page.goto(`${desk}/customers/${customerId}`);
  await page.getByRole('tab', { name: hi['owner.customerNotes'], exact: true }).click();
  const note = page.getByRole('textbox', { name: hi['owner.notePlaceholder'], exact: true });
  await note.fill('अभी सहेजा नहीं गया नोट');
  await page.getByRole('button', { name: hi['owner.receiveMoney'], exact: true }).click();
  const warning = page.getByRole('dialog', { name: hi['owner.unsavedTitle'], exact: true });
  await warning.getByRole('button', { name: hi['owner.keepEditing'], exact: true }).click();
  await expect(note).toHaveValue('अभी सहेजा नहीं गया नोट');
  await page.getByRole('tab', { name: hi['owner.khata'], exact: true }).click();
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: hi['owner.discard'], exact: true }).click();
  await expect(page.getByRole('tab', { name: hi['owner.khata'], exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(
    await db.customerNote.count({ where: { customerId, body: 'अभी सहेजा नहीं गया नोट' } }),
  ).toBe(0);
});
