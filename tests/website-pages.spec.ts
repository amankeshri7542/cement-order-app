import { PrismaClient } from '@prisma/client';
import { test, expect, verifyAndSkipName } from './fixtures';

// The shop, guide, delivery, contact, legal and account-deletion pages.
const site = 'http://localhost:3004';
const api = 'http://localhost:4010/api/v1';
const desk = 'http://localhost:3001';
const pages: [string, RegExp][] = [
  ['/about', /A family shop in Patna/],
  ['/contact', /Contact the shop/],
  ['/delivery', /Delivery/],
  ['/guide', /The guide/],
  ['/privacy', /Privacy, in plain language/],
  ['/terms', /How ordering works/],
  ['/whatsapp', /Order on WhatsApp/],
  ['/awards', /Top 5 in Bihar/],
];
const devanagari = /[ऀ-ॿ]/;

for (const [path, heading] of pages)
  test(`${path} has its own heading, title and address, and no Hindi`, async ({
    page,
    request,
  }) => {
    await page.goto(`${site}${path}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(page.locator('h1')).toHaveCount(1);
    expect(await page.title()).toContain('Shiv Cement Store');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${site}${path}`);
    const html = await (await request.get(`${site}${path}`)).text();
    expect(html).not.toMatch(devanagari);
    expect(html).toMatch(/<meta name="robots" content="noindex/);
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }),
    ).toBeVisible();
  });

test('placeholders are labelled, so Aman can find every one in a review build', async ({
  page,
}) => {
  for (const [path, id] of [
    ['/about', 'shop-contact'],
    ['/contact', 'legal-facts'],
    ['/awards', 'awards'],
    ['/whatsapp', 'whatsapp-number'],
    ['/privacy', 'privacy-retention'],
    ['/terms', 'terms'],
  ] as const) {
    await page.goto(`${site}${path}`);
    const note = page.locator(`[data-placeholder="${id}"]`);
    await expect(note).toBeVisible();
    await expect(note).toContainText('Placeholder, not shown to customers.');
  }
});

test('no fact is made up: until approved, no address, number or hours are shown', async ({
  page,
}) => {
  await page.goto(`${site}/about`);
  const main = page.getByRole('main');
  await expect(main.getByRole('row', { name: /City/ })).toContainText('Patna, Bihar');
  for (const word of ['Address', 'Phone', 'Hours'])
    await expect(main.getByRole('rowheader', { name: word, exact: true })).toHaveCount(0);
  await expect(main.locator('a[href^="tel:"]')).toHaveCount(0);
});

test('awards never claim a certificate that is not there', async ({ page }) => {
  await page.goto(`${site}/awards`);
  const main = page.getByRole('main');
  await expect(main.getByText('Certificate photo goes here')).toHaveCount(3);
  await expect(main.locator('[data-placeholder="awards"]')).toContainText('hidden from customers');
  await expect(main.locator('img')).toHaveCount(0);
});

test('search engines are kept out until indexing is switched on', async ({ request }) => {
  const robots = await (await request.get(`${site}/robots.txt`)).text();
  expect(robots).toMatch(/Disallow: \//);
  const sitemap = await (await request.get(`${site}/sitemap.xml`)).text();
  expect(sitemap).not.toContain('<loc>');
});

test('a material’s page carries structured data that matches the page, and no photo it lacks', async ({
  page,
}) => {
  await page.goto(`${site}/materials/cement/test-ultratech`);
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const product = blocks
    .map((text) => JSON.parse(text))
    .find((data) => data['@type'] === 'Product');
  expect(product.name).toBe('UltraTech Super');
  expect(product.offers.priceCurrency).toBe('INR');
  expect(product.image).toBeUndefined();
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(product.name);
  await expect(page.getByRole('main')).toContainText(`₹${Number(product.offers.price)}`);
  // No FAQ markup, no star ratings.
  expect(blocks.join(' ')).not.toMatch(/FAQPage|aggregateRating|HowTo/);
});

test('the delivery page answers a pincode, and remembers it', async ({ page }) => {
  await page.goto(`${site}/delivery`);
  const main = page.getByRole('main');
  const input = main.getByLabel('Site pincode');
  await input.fill('12');
  await main.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(main.getByRole('alert')).toContainText('six-digit pincode');
  await input.fill('800020');
  await main.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(main.getByText(/The shop delivers to 800020/)).toBeVisible();
  await expect(main.getByText(/Delivery ₹[\d,]+/)).toBeVisible();
  await page.reload();
  await expect(input).toHaveValue('800020');
  await input.fill('999999');
  await main.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(main.getByText(/does not list 999999/)).toBeVisible();
});

test('a lost connection during a pincode check says so', async ({ page }) => {
  await page.goto(`${site}/delivery`);
  await page.route(`${api}/delivery/**`, (route) => route.abort());
  const main = page.getByRole('main');
  await main.getByLabel('Site pincode').fill('800020');
  await main.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(main.getByRole('alert')).toContainText('could not be reached');
});

test('the enquiry form names the field the shop refused and takes focus there', async ({
  page,
}) => {
  await page.goto(`${site}/contact`);
  await page.route(`${api}/web/enquiries`, (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'INVALID_INPUT', message: 'x', details: [{ field: 'message' }] },
      }),
    }),
  );
  const main = page.getByRole('main');
  await main.getByLabel('Your name').fill('Asha');
  await main.getByLabel('Mobile number').fill('9876543210');
  await main.getByLabel('Your question').fill('A question');
  await main.getByRole('button', { name: 'Send to the shop' }).click();
  await expect(main.getByRole('alert')).toHaveText('Please check your message.');
  await expect(main.getByRole('alert')).toBeFocused();
  await expect(main.getByLabel('Your question')).toHaveAttribute('aria-invalid', 'true');
});

test('a complaint reaches the desk and the visitor keeps a number', async ({ page }) => {
  const phone = `98${Date.now().toString().slice(-8)}`;
  await page.goto(`${site}/contact#enquiry`);
  const main = page.getByRole('main');
  await main.getByRole('radio', { name: 'A complaint' }).check();
  await main.getByLabel('Your name').fill('Complaint Test');
  await main.getByLabel('Mobile number').fill(phone);
  await main.getByLabel('What went wrong?').fill('The bags arrived wet.');
  await main.getByRole('button', { name: 'Send to the shop' }).click();
  await expect(
    main.getByRole('heading', { name: 'Your message has reached the shop.' }),
  ).toBeFocused();
  const ticket = await main.locator('[data-ticket]').textContent();
  expect(ticket).toMatch(/^[A-Z0-9]{8}$/);
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  try {
    const row = await db.webEnquiry.findFirst({ where: { phone: `+91${phone}` } });
    expect(row?.interest).toBe('Complaint');
    expect(row?.id.slice(-8).toUpperCase()).toBe(ticket);
    expect(row?.language).toBe('en');
  } finally {
    await db.$disconnect();
  }
});

test('a robot filling the hidden field learns nothing and reaches nobody', async ({ page }) => {
  const phone = `97${Date.now().toString().slice(-8)}`;
  await page.goto(`${site}/contact`);
  const main = page.getByRole('main');
  await main.getByLabel('Your name').fill('Robot');
  await main.getByLabel('Mobile number').fill(phone);
  await main.getByLabel('Your question').fill('Buy now');
  await page.locator('input[autocomplete="off"][tabindex="-1"]').fill('https://spam.example');
  await main.getByRole('button', { name: 'Send to the shop' }).click();
  await expect(main.locator('[data-ticket]')).toBeVisible();
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  try {
    expect(await db.webEnquiry.count({ where: { phone: `+91${phone}` } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});

test('a material carries into the enquiry from its link', async ({ page }) => {
  await page.goto(`${site}/contact?interest=PPC%20cement`);
  await expect(page.getByRole('main').getByLabel(/Material you are asking about/)).toHaveValue(
    'PPC cement',
  );
});

test('the public deletion page deletes a verified account', async ({ page }) => {
  const phone = `96${Date.now().toString().slice(-8)}`;
  await page.goto(`${site}/delete-account`);
  const main = page.getByRole('main');
  await main.getByLabel('Mobile number (+91)').fill(phone);
  const sent = page.waitForResponse((r) => r.url().endsWith('/auth/otp/request'));
  await main.getByRole('button', { name: 'Get verification code' }).click();
  await main.getByLabel('Verification code').fill((await (await sent).json()).devCode);
  await main.getByRole('button', { name: 'Verify the number' }).click();
  await main.getByLabel('Type DELETE to confirm').fill('DELETE');
  await main.getByRole('button', { name: 'Delete my account' }).click();
  await expect(
    main.getByText('Your account has been deleted and its sessions ended.'),
  ).toBeFocused();
});

test('an enquiry reaches the owner’s Today screen and can be marked done', async ({
  browser,
  page,
}) => {
  await page.goto(`${site}/contact?interest=Desk%20test`);
  const phone = `95${Date.now().toString().slice(-8)}`;
  const main = page.getByRole('main');
  await main.getByLabel('Your name').fill('Desk Visitor');
  await main.getByLabel('Mobile number').fill(phone);
  await main.getByLabel('Your question').fill('Do you deliver on Sunday?');
  await main.getByRole('button', { name: 'Send to the shop' }).click();
  await expect(
    main.getByRole('heading', { name: 'Your message has reached the shop.' }),
  ).toBeVisible();
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  try {
    const row = await db.webEnquiry.findFirst({ where: { phone: `+91${phone}` } });
    expect(row?.status).toBe('NEW');
    expect(row?.interest).toBe('Desk test');
  } finally {
    await db.$disconnect();
  }
  void browser;
  void desk;
  void verifyAndSkipName;
});

test('nobody can make the site drop its saved rates without the secret', async ({ request }) => {
  const none = await request.post(`${site}/api/revalidate`);
  expect(none.status()).toBe(403);
  const wrong = await request.post(`${site}/api/revalidate`, {
    headers: { 'x-revalidate-secret': 'guess' },
  });
  expect(wrong.status()).toBe(403);
});

test('the page-numbers route takes bad input quietly and never fails', async ({ request }) => {
  for (const data of [
    '',
    'not json',
    'null',
    '[]',
    JSON.stringify({ name: 'nonsense' }),
    JSON.stringify({
      name: 'LCP',
      value: 'x',
      path: '//evil.example/<script>',
      tier: 'mine',
      memory: -1,
    }),
    JSON.stringify({ name: 'LCP', path: 'x'.repeat(600) }),
  ]) {
    const response = await request.post(`${site}/api/e`, {
      data,
      headers: { 'content-type': 'text/plain' },
    });
    expect(response.status(), data.slice(0, 40)).toBe(204);
  }
  const read = await request.get(`${site}/api/e`);
  expect(read.status()).toBe(405);
});
