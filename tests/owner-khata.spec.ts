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
  await db.product.upsert({
    where: { id: productId },
    update: { stock: 50, pricePaise, active: true },
    create: {
      id: productId,
      categoryId: 'cement',
      name: productName,
      nameHi: productNameHi,
      brand: 'शिव',
      type: 'सीमेंट',
      grade: 'पीपीसी',
      unit: 'बोरी',
      packSize: '५० किलो',
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
      estimate: 'आज',
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
  await page.getByRole('textbox', { name: 'मालिक का मोबाइल नंबर', exact: true }).fill('9297513707');
  const sent = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.status() === 201,
  );
  await page.getByRole('button', { name: 'कोड भेजें', exact: true }).click();
  const challenge = (await (await sent).json()) as { devCode: string };
  await page.getByRole('textbox', { name: 'साइन इन कोड', exact: true }).fill(challenge.devCode);
  await page.getByRole('button', { name: 'दुकान डेस्क खोलें', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'आज', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
}

test('Hindi customer settings, credit delivery, payment and reversal preserve the khata', async ({
  page,
}) => {
  test.setTimeout(120000);
  await signInHindi(page);
  await page.goto(`${desk}/customers/${customerId}`);
  await expect(page.getByRole('heading', { name: customerName, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'उधार और जानकारी', exact: true }).click();
  await page.getByRole('checkbox', { name: 'उधार चालू करें', exact: true }).check();
  await page.getByRole('textbox', { name: 'उधार की सीमा (₹)', exact: true }).fill('5000');
  await page.getByRole('textbox', { name: 'इलाका', exact: true }).fill('दानापुर अभ्यास');
  await page
    .getByRole('textbox', { name: 'पहचान, कॉमा से अलग करें', exact: true })
    .fill('ठेकेदार, नियमित');
  const settingsSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/admin/customers/${customerId}`) &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  );
  await page.getByRole('button', { name: 'सहेजें', exact: true }).click();
  await settingsSaved;
  expect(await db.user.findUniqueOrThrow({ where: { id: customerId } })).toMatchObject({
    creditAllowed: true,
    creditLimitPaise: 500000,
    area: 'दानापुर अभ्यास',
    tags: ['ठेकेदार', 'नियमित'],
    khataBalancePaise: 0,
  });
  await page.getByRole('tab', { name: 'नोट्स', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'दुकान को क्या याद रखना है?', exact: true })
    .fill(customerNote);
  const noteSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/admin/customers/${customerId}/notes`) &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await page.getByRole('button', { name: 'नोट जोड़ें', exact: true }).click();
  await noteSaved;
  await expect(page.getByText(customerNote, { exact: true })).toBeVisible();
  expect(await db.customerNote.count({ where: { customerId, body: customerNote } })).toBe(1);

  await page.getByRole('link', { name: 'नया ऑर्डर', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/new\\?customer=${customerId}$`));
  await expect(page.getByRole('textbox', { name: 'मोबाइल नंबर', exact: true })).toHaveValue(
    customerPhone.slice(3),
  );
  await expect(page.getByRole('textbox', { name: 'ग्राहक का नाम', exact: true })).toHaveValue(
    customerName,
  );
  await page.getByRole('button', { name: 'आगे बढ़ें', exact: true }).click();
  await page.getByRole('searchbox', { name: 'सामग्री खोजें', exact: true }).fill(productName);
  await expect(page.getByRole('heading', { name: productNameHi, exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: `मात्रा ${productNameHi}`, exact: true }).fill('2');
  await page.getByRole('button', { name: 'आगे बढ़ें', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'घर, प्लॉट या साइट का पता', exact: true })
    .fill('साइट ७२, स्कूल के पास');
  await page.getByRole('textbox', { name: 'इलाका', exact: true }).fill('दानापुर अभ्यास');
  await page.getByRole('textbox', { name: 'पिनकोड', exact: true }).fill('800072');
  await expect(page.getByRole('button', { name: 'उधार', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'उधार', exact: true }).click();
  await expect(page.getByRole('button', { name: 'उधार', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'ऑर्डर जाँचें', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'ऑर्डर जाँचें', exact: true });
  await expect(
    review.getByText(`इस उधार के बाद बाकी: ${money(totalPaise)}`, { exact: true }),
  ).toBeVisible();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/admin/orders/phone') &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await review.getByRole('button', { name: 'ऑर्डर पक्का करें', exact: true }).click();
  const order = (await (await created).json()) as {
    id: string;
    number: string;
    totalPaise: number;
  };
  expect(order.totalPaise).toBe(totalPaise);
  const success = page.getByRole('dialog', { name: 'ऑर्डर दर्ज हो गया', exact: true });
  await expect(success).toBeVisible();
  await success.getByRole('button', { name: 'ऑर्डर देखें', exact: true }).click();
  expect(await db.customerLedgerEntry.count({ where: { orderId: order.id } })).toBe(0);
  expect((await db.user.findUniqueOrThrow({ where: { id: customerId } })).khataBalancePaise).toBe(
    0,
  );
  await page.getByRole('button', { name: 'माल तैयार करें', exact: true }).click();
  await page.getByRole('button', { name: 'माल भेजें', exact: true }).click();
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
  await page.getByRole('button', { name: 'डिलीवरी पूरी करें', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'डिलीवरी पूरी करें', exact: true })
    .getByRole('button', { name: 'डिलीवरी पूरी करें', exact: true })
    .click();
  await expect(page.getByText('डिलीवरी पूरी', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('यह बिक्री ग्राहक के खाते में दर्ज है।', { exact: true }),
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
  await expect(page.getByText('डिलीवरी पूरी', { exact: true }).first()).toBeVisible();
  expect(hiddenDeliveryReply).toBe(true);
  expect(await db.customerLedgerEntry.count({ where: { orderId: order.id } })).toBe(1);
  await page.getByRole('link', { name: 'खाता', exact: true }).click();
  await expect(page.getByRole('heading', { name: customerName, exact: true })).toBeVisible();
  await expect(page.getByText(money(totalPaise), { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'पैसा मिला', exact: true }).click();
  const receipt = page.getByRole('dialog', { name: 'पैसा मिला', exact: true });
  await receipt.getByRole('textbox', { name: 'रकम (₹)', exact: true }).fill('200');
  await receipt.getByRole('textbox', { name: 'नोट', exact: true }).fill(paymentNote);
  await receipt.getByLabel('भुगतान का तरीका', { exact: true }).selectOption('CASH');
  await receipt.getByRole('button', { name: 'सहेजें', exact: true }).click();
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

  await paymentRow.getByRole('button', { name: 'एंट्री उलटें', exact: true }).click();
  const reverse = page.getByRole('dialog', { name: 'एंट्री उलटें', exact: true });
  await reverse.getByRole('textbox', { name: 'सुधार की वजह', exact: true }).fill(reversalNote);
  await reverse.getByRole('button', { name: 'एंट्री उलटें', exact: true }).click();
  await expect(reverse).toBeHidden();
  await expect(page.getByRole('tabpanel').getByText(reversalNote, { exact: true })).toBeVisible();
  await expect(paymentRow.getByRole('button', { name: 'एंट्री उलटें', exact: true })).toHaveCount(
    0,
  );
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
  await expect(page.getByRole('heading', { name: 'खाता', exact: true })).toBeVisible();
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
