import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Hindi product names: the owner adds a Hindi name on the desk, the website shows it (with
// Hindi units) to Hindi readers, and English readers see the catalogue exactly as before.
const site = 'http://localhost:3004';
const desk = 'http://localhost:3001';
const productId = 'test-hindi-cement';
const name = 'TEST HINDI Cement';
const nameHi = 'टेस्ट हिन्दी सीमेंट';
const descriptionHi = 'प्लास्टर और चिनाई के लिए बंद बोरी।';
test.use({ actionTimeout: 15000 });

function database() {
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    !new URL(url).pathname.endsWith('_test') ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  )
    throw new Error('Disposable loopback database required');
  return new PrismaClient({ datasourceUrl: url });
}
test.beforeAll(async () => {
  const db = database();
  try {
    const data = {
      name,
      nameHi: null,
      categoryId: 'cement',
      brand: 'TEST HINDI',
      type: 'PPC',
      grade: '43',
      unit: 'bag',
      packSize: '50 kg',
      pricePaise: 38000,
      stock: 50,
      description: 'Disposable test fixture; not product advice.',
      descriptionHi: null,
      recommendedUse: 'Test only.',
      images: [],
      active: true,
    };
    await db.product.upsert({
      where: { id: productId },
      create: { id: productId, ...data },
      update: data,
    });
  } finally {
    await db.$disconnect();
  }
});

async function deskLogin(page: Page) {
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'en'));
  await page.goto(desk);
  await page.getByRole('textbox', { name: 'Staff mobile number' }).fill('9297513707');
  const sent = page.waitForResponse((r) => r.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get verification code' }).click();
  await page
    .getByRole('textbox', { name: 'Verification code', exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

test('a Hindi name saved on the desk reaches Hindi readers; English is unchanged', async ({
  page,
}) => {
  await deskLogin(page);
  await page.goto('http://localhost:3001/more?view=products');
  await page.getByRole('textbox', { name: 'Search products', exact: true }).fill(name);
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Hindi name / हिन्दी नाम', { exact: true }).fill(nameHi);
  await dialog.getByLabel('Hindi description / हिन्दी विवरण', { exact: true }).fill(descriptionHi);
  await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(dialog).toBeHidden();
  // The desk list shows the Hindi name under the English one; the Edit button keeps its name.
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText(nameHi);
  await expect(row.getByRole('button', { name: `Edit ${name}`, exact: true })).toBeVisible();

  // English readers see the stored English name and unit, with no Hindi text.
  await page.goto(`${site}/products/${productId}`);
  const main = page.getByRole('main');
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  await expect(main.locator('.detail-price')).toHaveText(/\/ bag$/);
  // Minimum quantity and quantity step are both 1.
  await expect(main.getByText('1 × bag', { exact: true })).toHaveCount(2);
  await expect(main.getByText(nameHi)).toHaveCount(0);
  await expect(main.getByText('बोरी')).toHaveCount(0);

  // Hindi readers see the Hindi name and unit, and the English name printed on the bag.
  await page.getByRole('button', { name: 'हिन्दी', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.getByRole('heading', { level: 1, name: nameHi, exact: true })).toBeVisible();
  await expect(main.getByText(name, { exact: true })).toBeVisible();
  await expect(main.locator('.detail-price')).toHaveText(/\/ बोरी$/);
  // Minimum quantity and quantity step are both 1.
  await expect(main.getByText('1 × बोरी', { exact: true })).toHaveCount(2);
  await expect(main.getByText(descriptionHi, { exact: true })).toBeVisible();

  // The catalogue finds it by its Hindi name and shows the Hindi card.
  await page.goto(`${site}/products`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  const search = main.getByLabel('सामग्री खोजें');
  await expect(search).toBeEnabled();
  await search.fill('हिन्दी सीमेंट');
  const card = main
    .getByRole('article')
    .filter({ has: page.locator(`a[href="/products/${productId}"]`) });
  await expect(card).toContainText(nameHi);
  await expect(card).toContainText('/ बोरी');

  // Back in English the card reads exactly as before.
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(card).toContainText(name);
  await expect(card).toContainText('/ bag');
  await expect(card).not.toContainText(nameHi);
});

test('the app shows the Hindi name and unit to Hindi readers', async ({ browser }) => {
  const db = database();
  try {
    await db.product.update({ where: { id: productId }, data: { nameHi, descriptionHi } });
  } finally {
    await db.$disconnect();
  }
  // A fresh phone that chose Hindi on first launch.
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('shiv_language', '"hi"'));
  const page = await context.newPage();
  await page.goto('http://localhost:8082');
  await page.getByRole('tab', { name: 'सामग्री', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'सामग्री खोजें', exact: true });
  await expect(
    page.getByText(/^\d+ (materials?|सामग्री)( · (more below|नीचे और))?$/),
  ).toBeVisible();
  await expect(async () => {
    await search.fill('हिन्दी सीमेंट');
    await expect(search).toHaveValue('हिन्दी सीमेंट', { timeout: 1000 });
  }).toPass();
  const row = page.getByTestId(`product-${productId}`);
  await expect(row).toContainText(nameHi);
  await expect(row).toContainText('बोरी');
  await expect(row).not.toContainText('/ bag');
  await context.close();
});
