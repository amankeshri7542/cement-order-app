import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { test, expect, deskLanguage } from './fixtures';

// Hindi product names: the owner can add a Hindi name on the desk. The website and the customer
// app have one language, so they never print the name, but website search still finds it.
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
  await deskLanguage(page.context(), 'en');
  await page.goto(desk);
  await page.getByRole('textbox', { name: 'Staff mobile number' }).fill('9999997007');
  const sent = page.waitForResponse((r) => r.url().endsWith('/auth/otp/request'));
  await page.getByRole('button', { name: 'Get verification code' }).click();
  await page
    .getByRole('textbox', { name: 'Verification code', exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

test('a Hindi name saved on the desk stays off the website, and still finds the product', async ({
  page,
}) => {
  await deskLogin(page);
  await page.goto('http://localhost:3001/stock?tab=maal');
  await page.getByRole('searchbox', { name: 'Find goods or brand', exact: true }).fill(name);
  await page.getByRole('button', { name: `Change goods ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name in Hindi (if any)', { exact: true }).fill(nameHi);
  await dialog.getByLabel('About this item in Hindi (if any)', { exact: true }).fill(descriptionHi);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  // The desk keeps the name staff read off the bag; the Hindi name is stored beside it.
  await expect(
    page.getByRole('button', { name: `Change goods ${name}`, exact: true }),
  ).toBeVisible();

  // The website has one language: the English name, and no Hindi anywhere, even when one is saved.
  // A new product shows once the website's saved catalogue has been read again.
  await expect
    .poll(async () => (await page.request.get(`${site}/materials/cement/${productId}`)).status(), {
      timeout: 30000,
    })
    .toBe(200);
  await page.goto(`${site}/materials/cement/${productId}`);
  const main = page.getByRole('main');
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  await expect(main.getByText(nameHi)).toHaveCount(0);
  await expect(main.getByText(descriptionHi)).toHaveCount(0);
  expect(await page.content()).not.toMatch(/[\u0900-\u097F]/);

  // A customer who types the Hindi name still finds it: the words are matched on the server only.
  await expect
    .poll(
      async () => {
        await page.goto(`${site}/materials?q=${encodeURIComponent(nameHi)}`);
        return main.getByRole('row', { name: new RegExp(name) }).count();
      },
      { timeout: 30000, intervals: [1000] },
    )
    .toBeGreaterThan(0);
});
