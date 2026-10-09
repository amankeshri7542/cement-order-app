import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, observePage } from './fixtures';

const site = 'http://localhost:3004';
const api = 'http://localhost:4010/api/v1';
const catalogue = `${site}/products?q=TEST+V2`;
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});
const cards = (page: Page) =>
  page.locator('article').filter({ has: page.locator('a[href^="/products/"]') });

function database() {
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    !new URL(url).pathname.endsWith('_test') ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  )
    throw new Error('Disposable loopback test DB required.');
  return new PrismaClient({ datasourceUrl: url });
}

test.beforeAll(async () => {
  const db = database();
  try {
    await db.category.upsert({
      where: { id: 'test-v2' },
      update: {},
      create: { id: 'test-v2', name: 'TEST materials', slug: 'test-v2' },
    });
    const products = Array.from({ length: 27 }, (_, i) => ({
      id: `test-v2-${String(i).padStart(2, '0')}`,
      name: `TEST V2 Material ${String(i).padStart(2, '0')}`,
      brand: i < 20 ? 'TEST Brand A' : 'TEST Brand B',
      categoryId: 'test-v2',
      type: 'PPC Cement',
      grade: 'PPC',
      unit: 'bag',
      packSize: '50 kg',
      minQuantity: 10,
      quantityStep: 5,
      pricePaise: 10025 + i * 100,
      stock: i === 26 ? 0 : 50,
      active: true,
      images: [],
      description: 'Isolated TEST material for storefront browser verification.',
      recommendedUse: 'TEST construction only.',
    }));
    for (const product of products)
      await db.product.upsert({ where: { id: product.id }, create: product, update: product });
  } finally {
    await db.$disconnect();
  }
});

test('storefront renders real product HTML, metadata, integer-paise prices and selling terms', async ({
  page,
  request,
}) => {
  const response = await request.get(`${site}/products/test-v2-00`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('TEST V2 Material 00');
  expect(html).toMatch(/<title>[^<]*TEST V2 Material 00/);
  expect(html).toContain('100.25');
  await page.goto(`${site}/products/test-v2-00`);
  await expect(
    page.getByRole('heading', { name: 'TEST V2 Material 00', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('₹100.25', { exact: true })).toBeVisible();
  await expect(page.getByText('50 kg', { exact: true })).toBeVisible();
  await expect(page.getByText('PPC', { exact: true })).toBeVisible();
  await expect(page.getByText(/minimum/i)).toBeVisible();
  await expect(page.getByText('Quantity increment', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /cart|buy|order|pay/i })).toHaveCount(0);
});

test('storefront filters, sorts and paginates without duplicates and restores browser Back', async ({
  page,
}) => {
  await page.goto(catalogue);
  await expect(cards(page)).toHaveCount(12);
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('test-v2');
  await page.getByRole('combobox', { name: 'Brand', exact: true }).selectOption('TEST Brand B');
  await page.getByRole('combobox', { name: 'Availability', exact: true }).selectOption('in');
  await page.getByRole('combobox', { name: 'Sort by', exact: true }).selectOption('price_desc');
  await expect(cards(page)).toHaveCount(6);
  await expect(cards(page).first()).toContainText('TEST V2 Material 25');
  await expect(cards(page).last()).toContainText('TEST V2 Material 20');
  await page.goto(catalogue);
  await expect(cards(page)).toHaveCount(12);
  await page.getByRole('button', { name: 'Show more materials' }).click();
  await expect(cards(page)).toHaveCount(24);
  await page.getByRole('button', { name: 'Show more materials' }).click();
  await expect(cards(page)).toHaveCount(27);
  const names = await cards(page).locator('h2, h3').allTextContents();
  expect(new Set(names).size).toBe(27);
  await page.getByRole('link', { name: /TEST V2 Material 24/ }).click();
  await expect(
    page.getByRole('heading', { name: 'TEST V2 Material 24', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${site}/products/test-v2-24`);
  await page.goBack();
  await expect(page.getByLabel('Search materials')).toHaveValue('TEST V2');
  await expect(cards(page)).toHaveCount(27);
});

test('storefront keeps a normal product press intact when normalized search is unchanged', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(catalogue);
  await expect(cards(page)).toHaveCount(12);
  await page.getByLabel('Search materials').fill('  TEST V2  ');
  const product = page.getByRole('link', { name: /TEST V2 Material 00/ });
  await product.hover();
  await page.mouse.down();
  await page.clock.runFor(400);
  await page.mouse.up();
  await expect(
    page.getByRole('heading', { name: 'TEST V2 Material 00', exact: true, level: 1 }),
  ).toBeVisible();
});

test('storefront rapid search and filter responses cannot replace a newer selection', async ({
  page,
}) => {
  let release!: () => void;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${api}/products?**`, async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'TEST V2 Material 01') await slow;
    await route.continue();
  });
  await page.goto(catalogue);
  await expect(cards(page)).toHaveCount(12);
  const oldRequest = page.waitForRequest(
    (r) => new URL(r.url()).searchParams.get('q') === 'TEST V2 Material 01',
  );
  await page.getByLabel('Search materials').fill('TEST V2 Material 01');
  await oldRequest;
  await page.getByLabel('Search materials').fill('TEST V2 Material 25');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText('TEST V2 Material 25');
  const oldResponse = page.waitForResponse(
    (r) => new URL(r.url()).searchParams.get('q') === 'TEST V2 Material 01',
  );
  release();
  await (await oldResponse).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText('TEST V2 Material 25');
  await page.getByRole('link', { name: /TEST V2 Material 25/ }).click();
  await expect(
    page.getByRole('heading', { name: 'TEST V2 Material 25', exact: true, level: 1 }),
  ).toBeVisible();
});

test('storefront distinguishes out-of-stock, missing products and empty search', async ({
  page,
}) => {
  await page.goto(`${site}/products/does-not-exist`);
  await expect(
    page.getByRole('heading', { name: 'This material is not available.', exact: true }),
  ).toBeVisible();
  await page.goto(`${site}/products/test-v2-26`);
  await expect(page.getByText(/out of stock/i).first()).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Materials', exact: true })
    .click();
  await page.getByLabel('Search materials').fill('NO-SUCH-TEST-V2-MATERIAL');
  await expect(page.getByText(/no materials|no products/i).first()).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test('storefront loading, network failure and retry do not fabricate catalogue data', async ({
  page,
}) => {
  let release!: () => void;
  const loading = new Promise<void>((resolve) => {
    release = resolve;
  });
  let releaseRetry!: () => void;
  const retryGate = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
  let failing = true;
  await page.route(`${api}/products?**`, async (route) => {
    await loading;
    if (failing) await route.abort('failed');
    else {
      await retryGate;
      await route.continue();
    }
  });
  await page.goto(catalogue);
  await expect(page.getByText(/loading materials/i)).toBeVisible();
  release();
  await expect(
    page.getByRole('region', { name: 'Materials catalogue', exact: true }).getByRole('alert'),
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  failing = false;
  const background = page.waitForRequest((r) => r.url().startsWith(`${api}/products?`));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await background;
  await expect(
    page.getByRole('region', { name: 'Materials catalogue', exact: true }).getByRole('alert'),
  ).toBeVisible();
  await page.getByRole('button', { name: /try again|retry/i }).click();
  releaseRetry();
  await expect(cards(page)).toHaveCount(12);
});

test('storefront refreshes on reconnect and focus without duplicate lists', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const streams: EventSource[] = [];
    Object.defineProperty(window, '__storefrontStreams', { value: streams });
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        streams.push(this);
      }
    };
  });
  await page.goto(catalogue);
  await expect(cards(page)).toHaveCount(12);
  const streamCount = await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeunload'));
    return (window as typeof window & { __storefrontStreams: EventSource[] }).__storefrontStreams
      .length;
  });
  expect(streamCount).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      (window as typeof window & { __storefrontStreams: EventSource[] }).__storefrontStreams.every(
        (source) => source.readyState === EventSource.CLOSED,
      ),
    ),
  ).toBe(true);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  );
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const streams = (window as typeof window & { __storefrontStreams: EventSource[] })
          .__storefrontStreams;
        return { count: streams.length, state: streams.at(-1)?.readyState };
      }),
    )
    .toEqual({ count: streamCount + 1, state: 1 });
  await page.getByRole('button', { name: 'Show more materials' }).click();
  await expect(cards(page)).toHaveCount(24);
  await context.setOffline(true);
  await expect(page.getByText(/offline|connection lost/i).first()).toBeVisible();
  const db = database();
  try {
    await db.product.update({
      where: { id: 'test-v2-02' },
      data: { pricePaise: 23567, priceVersion: { increment: 1 } },
    });
  } finally {
    await db.$disconnect();
  }
  const refreshed = page.waitForResponse((r) => r.url().startsWith(`${api}/products?`) && r.ok());
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  await expect(cards(page)).toHaveCount(24);
  await expect(cards(page).filter({ hasText: 'TEST V2 Material 02' })).toContainText('₹235.67');
  const names = await cards(page).locator('h2, h3').allTextContents();
  expect(new Set(names).size).toBe(24);
});

test('storefront checks supported and unsupported delivery pincodes read-only', async ({
  page,
}) => {
  let hydrate!: () => void;
  const hydration = new Promise<void>((resolve) => {
    hydrate = resolve;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await hydration;
    await route.continue();
  });
  try {
    await page.goto(site, { waitUntil: 'commit' });
    await expect(page.getByLabel('Delivery pincode')).toBeDisabled();
  } finally {
    hydrate();
  }
  await page.getByLabel('Delivery pincode').fill('800020');
  await page.getByRole('button', { name: 'Check pincode' }).click();
  await expect(page.getByText('Test delivery', { exact: false })).toBeVisible();
  await page.getByLabel('Delivery pincode').fill('999999');
  await page.getByRole('button', { name: 'Check pincode' }).click();
  await expect(
    page.getByText('Delivery is not listed for this pincode.', { exact: true }),
  ).toBeVisible();
});

test('storefront persists Hindi, supports keyboard navigation and fits narrow enlarged text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(catalogue);
  await expect(cards(page)).toHaveCount(12);
  await page.getByRole('button', { name: 'हिन्दी', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync('docs/screenshots/storefront', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/storefront/mobile-hindi.png', fullPage: true });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByLabel('Search materials').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('TEST V2 Material 00');
  await expect(cards(page)).toHaveCount(1);
  const link = page.getByRole('link', { name: /TEST V2 Material 00/ });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'TEST V2 Material 00', exact: true, level: 1 }),
  ).toBeVisible();
  await page.addStyleTag({
    content: ':root { --body: Arial, sans-serif; --display: Arial, sans-serif; }',
  });
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>('body *')].map(
      (element) => [element, parseFloat(getComputedStyle(element).fontSize)] as const,
    );
    for (const [element, size] of sizes) element.style.fontSize = `${size * 2}px`;
  });
  const layout = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= innerWidth,
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
    overflow: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => element.getBoundingClientRect().right > innerWidth)
      .map((element) => ({
        tag: element.tagName,
        class: element.className,
        text: element.innerText?.slice(0, 80),
        right: element.getBoundingClientRect().right,
      })),
  }));
  expect(layout.fits, JSON.stringify(layout)).toBe(true);
});

test('owner price publication reaches storefront and existing customer app', async ({
  page,
  browser,
}, info) => {
  const ownerContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const customer = await customerContext.newPage();
  const cataloguePage = await page.context().newPage();
  observePage(owner, info);
  observePage(customer, info);
  observePage(cataloguePage, info);
  try {
    await page.goto(`${site}/products/test-v2-00`);
    await expect(page.getByText('₹100.25', { exact: true })).toBeVisible();
    await cataloguePage.goto(catalogue);
    await expect(cards(cataloguePage)).toHaveCount(12);
    await customer.goto('http://localhost:8082');
    await customer.getByRole('tab', { name: 'Products', exact: true }).click();
    await customer
      .getByRole('textbox', { name: 'Search cement, steel, sand…', exact: true })
      .fill('TEST V2 Material 00');
    await expect(customer.getByRole('button', { name: 'View TEST V2 Material 00' })).toBeVisible();
    await owner.addInitScript(() => localStorage.setItem('shiv-owner-language', 'en'));
    await owner.goto('http://localhost:3001');
    await owner.getByRole('textbox', { name: 'Staff mobile number' }).fill('9297513708');
    const otp = owner.waitForResponse(
      (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
    );
    await owner.getByRole('button', { name: 'Get verification code' }).click();
    await owner
      .getByRole('textbox', { name: 'Verification code', exact: true })
      .fill((await (await otp).json()).devCode);
    await owner.getByRole('button', { name: 'Open store desk' }).click();
    await expect(owner.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await owner.getByRole('button', { name: /Prices & stock$/ }).click();
    await owner.getByRole('textbox', { name: 'Search products' }).fill('TEST V2 Material 00');
    await owner.getByRole('button', { name: 'Edit TEST V2 Material 00' }).click();
    await owner.getByLabel('Selling price (₹)').fill('137.45');
    await owner.getByLabel('Brand', { exact: true }).fill('TEST Brand Published');
    await owner.getByRole('button', { name: 'Save product', exact: true }).click();
    await expect(owner.getByText('₹137.45', { exact: true })).toBeVisible();
    await expect(page.getByText('₹137.45', { exact: true })).toBeVisible();
    await expect(customer.getByText('₹137.45', { exact: true })).toBeVisible();
    await expect(
      cataloguePage
        .getByRole('combobox', { name: 'Brand', exact: true })
        .locator('option', { hasText: 'TEST Brand Published' }),
    ).toHaveCount(1);
    await cataloguePage
      .getByRole('combobox', { name: 'Brand', exact: true })
      .selectOption('TEST Brand Published');
    await expect(cards(cataloguePage)).toHaveCount(1);
    await expect(cards(cataloguePage)).toContainText('₹137.45');
  } finally {
    await ownerContext.close();
    await customerContext.close();
    await cataloguePage.close();
  }
});

test('storefront public requests omit credentials, enforce CSP and never reserve stock', async ({
  page,
  context,
}) => {
  const db = database();
  const before = await Promise.all([
    db.order.count(),
    db.inventoryMovement.count(),
    db.product.findUniqueOrThrow({ where: { id: 'test-v2-01' } }),
  ]);
  const requests: { method: string; path: string; cookie: string | undefined }[] = [];
  await context.addCookies([
    { name: 'storefront-boundary-test', value: 'private', domain: 'localhost', path: '/' },
  ]);
  await page.route(`${api}/**`, async (route) => {
    requests.push({
      method: route.request().method(),
      path: new URL(route.request().url()).pathname,
      cookie: (await route.request().allHeaders()).cookie,
    });
    await route.continue();
  });
  try {
    const response = await page.goto(catalogue);
    const headers = response!.headers();
    // Next dev enforces revalidation; the production header check requires no-store.
    expect(headers['cache-control']).toContain('no-cache');
    expect(headers['cache-control']).toContain('must-revalidate');
    expect(headers['cache-control']).not.toContain('s-maxage');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toContain("object-src 'none'");
    expect(
      headers['content-security-policy'].split(';').find((v) => v.trim().startsWith('script-src')),
    ).not.toContain('unsafe-inline');
    expect(headers['x-content-type-options']).toBe('nosniff');
    await expect(cards(page)).toHaveCount(12);
    await page.getByRole('link', { name: /TEST V2 Material 01/ }).click();
    await expect(
      page.getByRole('heading', { name: 'TEST V2 Material 01', exact: true, level: 1 }),
    ).toBeVisible();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.method === 'GET' && !r.cookie)).toBe(true);
    expect(requests.some((r) => /admin|orders|cart|staff|attendance/.test(r.path))).toBe(false);
    const after = await Promise.all([
      db.order.count(),
      db.inventoryMovement.count(),
      db.product.findUniqueOrThrow({ where: { id: 'test-v2-01' } }),
    ]);
    expect([after[0], after[1], after[2].stock]).toEqual([before[0], before[1], before[2].stock]);
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy|script-src/i.test(message.text()))
        violations.push(message.text());
    });
    await page.route(`${site}/products/test-v2-01`, async (route) => {
      const original = await route.fetch();
      await route.fulfill({
        response: original,
        body: (await original.text()).replace(
          '</head>',
          '<script>document.documentElement.dataset.injected="yes"</script></head>',
        ),
      });
    });
    await page.reload();
    await expect.poll(() => violations.length).toBeGreaterThan(0);
    expect(await page.locator('html').getAttribute('data-injected')).toBeNull();
  } finally {
    await db.$disconnect();
  }
});

test('storefront desktop shopping view records browser performance and screenshots', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(site);
  await expect(cards(page).first()).toBeVisible();
  mkdirSync('docs/screenshots/storefront', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/storefront/desktop.png', fullPage: true });
  const metrics = await page.evaluate(() => ({
    navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
    paint: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
    resources: performance.getEntriesByType('resource').map((entry) => entry.toJSON()),
  }));
  await info.attach('storefront-local-dev-performance', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  await page.goto(`${site}/products/test-v2-01`);
  await expect(
    page.getByRole('heading', { name: 'TEST V2 Material 01', exact: true, level: 1 }),
  ).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/storefront/product.png', fullPage: true });
});
