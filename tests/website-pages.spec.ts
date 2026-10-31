import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';

// Phase 4: the public information pages, search-engine basics and the enquiry form.
const site = 'http://localhost:3004';
const api = 'http://localhost:4010/api/v1';
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
test.afterAll(() => db.$disconnect());

const pages = [
  ['/about', 'About Shiv Cement Store', 'शिव सीमेंट स्टोर के बारे में'],
  ['/delivery', 'Delivery', 'डिलीवरी'],
  ['/contact', 'Contact the shop', 'दुकान से संपर्क'],
  ['/privacy', 'Privacy, in plain language', 'निजता, सरल भाषा में'],
  ['/terms', 'How ordering works', 'ऑर्डर कैसे काम करता है'],
  ['/delete-account', 'Delete your account', 'अपना खाता हटाएँ'],
] as const;

for (const [path, english, hindi] of pages) {
  test(`${path} reads in both languages, has its own address and passes the accessibility checks`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${site}${path}`);
    await expect(page.getByRole('heading', { level: 1, name: english })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${site}${path}`);
    await expect(page).toHaveTitle(/Shiv Cement Store/);
    const widths = await page.evaluate(() => ({
      content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewport: window.innerWidth,
    }));
    expect(widths.content, `${path} must not scroll sideways at 360px`).toBeLessThanOrEqual(
      widths.viewport,
    );
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) => node.target),
      })),
      path,
    ).toEqual([]);
    await page.getByRole('button', { name: /हिन्दी/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: hindi })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  });
}

test('the server writes the first page in the visitor’s language', async ({ request }) => {
  const asked = await request.get(`${site}/about`, {
    headers: { 'Accept-Language': 'hi-IN,hi;q=0.9,en;q=0.8' },
  });
  const html = await asked.text();
  expect(html).toContain('<html lang="hi"');
  expect(html).toContain('शिव सीमेंट स्टोर के बारे में');
  // A saved choice beats the browser's language.
  const saved = await request.get(`${site}/about`, {
    headers: { 'Accept-Language': 'hi', Cookie: 'shiv_lang=en' },
  });
  const english = await saved.text();
  expect(english).toContain('<html lang="en"');
  expect(english).toContain('About Shiv Cement Store');
  // Nobody asked for Hindi: English, as before.
  const plain = await (await request.get(`${site}/about`)).text();
  expect(plain).toContain('<html lang="en"');
  // The Hindi address (for links and search engines) wins over a saved English choice.
  const addressed = await (
    await request.get(`${site}/about?lang=hi`, { headers: { Cookie: 'shiv_lang=en' } })
  ).text();
  expect(addressed).toContain('<html lang="hi"');
  expect(addressed).toContain(`<link rel="canonical" href="${site}/about?lang=hi"`);
});

test('every page names its English and Hindi addresses for search engines', async ({ page }) => {
  for (const path of ['/', '/products', '/about', '/contact']) {
    await page.goto(`${site}${path}`);
    // The home page may be written with or without its trailing slash.
    const hindi = path === '/' ? new RegExp(`^${site}/?\\?lang=hi$`) : `${site}${path}?lang=hi`;
    await expect(page.locator('link[rel="alternate"][hreflang="hi"]')).toHaveAttribute(
      'href',
      hindi,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveCount(1);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);
  }
  await page.goto(`${site}/contact?lang=hi`);
  await expect(page).toHaveTitle(/दुकान से संपर्क/);
  // Switching language drops ?lang=, so a reload keeps the visitor's choice.
  await page.getByRole('button', { name: /English/ }).click();
  await expect(page).toHaveURL(`${site}/contact`);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('search engines are kept out until indexing is switched on', async ({ request }) => {
  const robots = await (await request.get(`${site}/robots.txt`)).text();
  expect(robots).toContain('Disallow: /');
  expect(robots).not.toContain('Sitemap:');
  const home = await (await request.get(site)).text();
  expect(home).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  // An empty sitemap, not an error, while the site is private.
  const sitemap = await request.get(`${site}/sitemap.xml`);
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).not.toContain('<loc>');
});

test('a material’s page carries structured data that matches the page', async ({
  page,
  request,
}) => {
  // Whichever material the catalogue lists first: other specs rename and hide seed materials in
  // the shared test database, so a fixed name is not reliable when the whole suite runs.
  const list = await (await request.get(`${api}/products?limit=1`)).json();
  const product = list.items[0] as { id: string; name: string; pricePaise: number };
  expect(product, 'the test catalogue lists a material').toBeTruthy();
  await page.goto(`${site}/products/${product.id}`);
  await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible();
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const parsed = blocks.map((block) => JSON.parse(block));
  const item = parsed.find((entry) => entry['@type'] === 'Product');
  expect(item.name).toBe(product.name);
  expect(item.offers.priceCurrency).toBe('INR');
  expect(item.offers.price).toBe((product.pricePaise / 100).toFixed(2));
  expect(item.offers.availability).toMatch(/InStock|OutOfStock/);
  expect(parsed.some((entry) => entry['@type'] === 'BreadcrumbList')).toBe(true);
  // A WhatsApp share of the page shows a picture.
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute(
    'content',
    /opengraph-image|https:/,
  );
});

test('the enquiry form names the field the shop refused and takes focus there', async ({
  page,
}) => {
  await page.goto(`${site}/contact`);
  const form = page.getByRole('main');
  await form.getByLabel('Your name').fill('Ram\u202Eesh');
  await form.getByLabel('Mobile number').fill('9876543210');
  await form.getByLabel('Your question').fill('Rate for 50 bags?');
  await form.getByRole('button', { name: 'Send to the shop' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Please check your name.' });
  await expect(alert).toBeFocused();
  await expect(form.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByLabel('Your question')).not.toHaveAttribute('aria-invalid', 'true');
});

test('the delivery page answers a pincode and the footer links the policies', async ({ page }) => {
  await page.goto(`${site}/delivery`);
  await page.getByRole('main').getByLabel('Delivery pincode').fill('800020');
  await page.getByRole('button', { name: 'Check pincode' }).click();
  await expect(page.getByText('Delivery to 800020')).toBeVisible();
  await expect(page.getByText(/Delivery fee/).first()).toBeVisible();
  const footer = page.getByRole('contentinfo');
  for (const [name, href] of [
    ['Privacy', '/privacy'],
    ['Terms', '/terms'],
    ['Delete account', '/delete-account'],
    ['Contact', '/contact'],
  ] as const)
    await expect(footer.getByRole('link', { name }).first()).toHaveAttribute('href', href);
});

test('the public deletion page deletes a verified account', async ({ page }) => {
  const phone = `+919${String(Date.now()).slice(-9)}`;
  const user = await db.user.create({ data: { phone, name: 'Deletion Test', role: 'CUSTOMER' } });
  await page.goto(`${site}/delete-account`);
  await page.getByRole('textbox', { name: /Mobile number/ }).fill(phone.slice(3));
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: 'Get verification code' }).click();
  const code = (await (await sent).json()).devCode;
  await page.getByRole('textbox', { name: 'Verification code' }).fill(code);
  await page.getByRole('button', { name: 'Verify the number' }).click();
  await expect(page.getByText(`Signed in as ${phone}`)).toBeVisible();
  await page.getByRole('textbox', { name: /Type DELETE/ }).fill('DELETE');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByText(/has been deleted/)).toBeVisible();
  const after = await db.user.findUnique({ where: { id: user.id } });
  expect(after?.name).not.toBe('Deletion Test');
});

test('an enquiry from the Contact page reaches the owner’s Today screen and can be marked done', async ({
  page,
  browser,
}) => {
  const name = `Enquiry Visitor ${Date.now()}`;
  const message = 'Need 200 bags for a roof slab.\n<b>not bold</b>';
  await page.goto(`${site}/contact?interest=PPC%20cement`);
  const form = page.getByRole('main');
  await expect(form.getByLabel('Material you are asking about (optional)')).toHaveValue(
    'PPC cement',
  );
  await form.getByLabel('Your name').fill(name);
  await form.getByLabel('Mobile number').fill('98765 43210');
  await form.getByLabel('Site pincode (optional)').fill('800020');
  await form.getByLabel('Your question').fill(message);
  const sent = page.waitForResponse((r) => r.url().endsWith('/web/enquiries'));
  await form.getByRole('button', { name: 'Send to the shop' }).click();
  expect((await sent).status()).toBe(201);
  await expect(page.getByText('Your message has reached the shop.')).toBeVisible();
  const stored = await db.webEnquiry.findFirstOrThrow({ where: { name } });
  expect(stored).toMatchObject({ phone: '+919876543210', pincode: '800020', status: 'NEW' });

  // The owner, on a phone, in Hindi.
  const owner = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const desk = await owner.newPage();
  await desk.addInitScript(() => localStorage.setItem('shiv-owner-language', 'hi'));
  await desk.goto('http://localhost:3001/today');
  await desk.getByRole('textbox', { name: 'मालिक का मोबाइल नंबर', exact: true }).fill('9297513707');
  const code = desk.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await desk.getByRole('button', { name: 'कोड भेजें', exact: true }).click();
  const { devCode } = (await (await code).json()) as { devCode: string };
  await desk.getByRole('textbox', { name: 'साइन इन कोड', exact: true }).fill(devCode);
  await desk.getByRole('button', { name: 'दुकान डेस्क खोलें', exact: true }).click();
  const card = desk.getByRole('article').filter({ hasText: name });
  await expect(card).toBeVisible();
  await expect(card.getByText('सामग्री: PPC cement')).toBeVisible();
  // Markup sent by a visitor is shown as text, never rendered.
  await expect(card.getByText('<b>not bold</b>', { exact: false })).toBeVisible();
  await expect(card.locator('b')).toHaveCount(0);
  await card.getByRole('button', { name: 'हो गया', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await db.webEnquiry.findUniqueOrThrow({ where: { id: stored.id } })).status).toBe(
    'HANDLED',
  );
  await owner.close();
});
