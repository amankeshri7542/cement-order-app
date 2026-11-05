import { PrismaClient } from '@prisma/client';
import { test, expect } from './fixtures';

// The public website: server-rendered, every word and rate in the first HTML, no API call at load.
const site = 'http://localhost:3004';
const api = 'http://localhost:4010/api/v1';
const devanagari = /[ऀ-ॿ]/;

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

const base = {
  brand: 'TEST PUB',
  type: 'Test type',
  grade: 'Test grade',
  images: [],
  description: 'Disposable test fixture; not product advice.',
  recommendedUse: 'Test only.',
  active: true,
};
const seed = [
  {
    id: 'test-pub-cement-a',
    name: 'TEST PUB Cement A',
    categoryId: 'cement',
    unit: '50 kg bag',
    pricePaise: 39500,
    stock: 100,
  },
  {
    id: 'test-pub-cement-b',
    name: 'TEST PUB Cement B',
    categoryId: 'cement',
    unit: '50 kg bag',
    pricePaise: 41000,
    stock: 37,
    brand: 'TEST OTHER',
  },
  {
    id: 'test-pub-empty',
    name: 'TEST PUB Empty',
    categoryId: 'cement',
    unit: '50 kg bag',
    pricePaise: 40000,
    stock: 0,
  },
  {
    id: 'test-pub-order',
    name: 'TEST PUB Order Only',
    categoryId: 'cement',
    unit: '50 kg bag',
    pricePaise: 77700,
    stock: 5,
    sourcing: 'ON_REQUEST' as const,
  },
  {
    id: 'test-pub-sariya',
    name: 'TEST PUB Sariya',
    categoryId: 'steel',
    unit: 'kg · 12 mm',
    pricePaise: 6800,
    stock: 500,
  },
  {
    id: 'test-pub-balu',
    name: 'TEST PUB Balu',
    categoryId: 'sand',
    unit: '100 cu ft',
    pricePaise: 680000,
    stock: 10,
  },
  {
    id: 'test-pub-gitti',
    name: 'TEST PUB Gitti',
    categoryId: 'aggregates',
    unit: '100 cu ft',
    pricePaise: 520000,
    stock: 10,
  },
  {
    id: 'test-pub-bricks',
    name: 'TEST PUB Bricks',
    categoryId: 'bricks',
    unit: '1,000 bricks',
    pricePaise: 850000,
    stock: 10,
  },
];

test.beforeAll(async () => {
  const db = database();
  try {
    for (const [id, name] of [
      ['steel', 'Steel'],
      ['sand', 'Sand'],
      ['aggregates', 'Aggregates'],
      ['bricks', 'Bricks & blocks'],
    ] as const)
      await db.category.upsert({ where: { slug: id }, create: { id, name, slug: id }, update: {} });
    for (const row of seed) {
      const data = { ...base, ...row, priceCheckedAt: new Date() };
      await db.product.upsert({ where: { id: row.id }, create: data, update: data });
    }
    await db.productAlias.upsert({
      where: { normalizedAlias: 'test-pub-alias' },
      create: {
        productId: 'test-pub-sariya',
        alias: 'test-pub-alias',
        normalizedAlias: 'test-pub-alias',
        source: 'test',
        confirmedBy: 'test',
      },
      update: {},
    });
  } finally {
    await db.$disconnect();
  }
});

// Rates are cached for a few seconds in development, so a test may wait for a fresh read.
async function htmlWith(
  request: import('@playwright/test').APIRequestContext,
  path: string,
  needle: string,
) {
  let html = '';
  await expect
    .poll(
      async () => {
        html = await (await request.get(`${site}${path}`)).text();
        return html.includes(needle);
      },
      { timeout: 30000, intervals: [1000] },
    )
    .toBe(true);
  return html;
}

for (const path of [
  '/',
  '/rates',
  '/materials',
  '/materials/cement',
  '/materials/sariya',
  '/materials/cement/test-pub-cement-a',
])
  test(`${path}: every word and rate is in the first HTML, with no stock count and no Hindi`, async ({
    request,
  }) => {
    const html = await htmlWith(request, path, '₹');
    expect(html).not.toMatch(devanagari);
    expect(html).not.toMatch(/"stock"|lowStock/);
    expect(html).not.toContain('hreflang');
    // Sample rates never reach a search engine, whatever else is set.
    expect(html).toMatch(/<meta name="robots" content="noindex/);
  });

test('the rate board shows each rate with its unit, and the sample tag', async ({
  request,
  page,
}) => {
  await htmlWith(request, '/rates', 'TEST PUB Cement A');
  await page.goto(`${site}/rates`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toContainText(/rates/i);
  await expect(main.getByText('Sample rates, not real prices')).toBeVisible();
  const row = main.getByRole('row', { name: /TEST PUB Cement A/ });
  await expect(row).toContainText('₹395');
  await expect(row).toContainText('a bori (50 kg)');
  await expect(main.getByRole('row', { name: /TEST PUB Sariya/ })).toContainText('a kg, 12 mm');
  await expect(main.getByRole('row', { name: /TEST PUB Balu/ })).toContainText('per 100 cu ft');
  // All groups are open on this page.
  expect(await page.locator('details:not([open])', { hasText: 'TEST PUB' }).count()).toBe(0);
});

test('a guest’s public page makes no API call at load, not even a sign-in check', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(api)) calls.push(request.url());
  });
  for (const path of ['/', '/rates', '/materials', '/materials/cement', '/about', '/guide']) {
    await page.goto(`${site}${path}`);
    await page.waitForLoadState('networkidle');
  }
  expect(calls).toEqual([]);
});

test('an item only brought in to order shows no price anywhere', async ({ request }) => {
  const html = await htmlWith(request, '/materials/cement', 'TEST PUB Order Only');
  expect(html).not.toContain('₹777');
  expect(html).toContain('Ask for the rate');
  const own = await (await request.get(`${site}/materials/cement/test-pub-order`)).text();
  expect(own).not.toContain('₹777');
  expect(own).not.toContain('"offers"');
});

test('an out-of-stock item says so in a word, and its page stays up', async ({ page }) => {
  const response = await page.goto(`${site}/materials/cement/test-pub-empty`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('main').getByText('Not available right now. Ask the shop.'),
  ).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: /^Add/ })).toHaveCount(0);
});

test('a category shows its lowest rate, “from”, brand filters and how to buy', async ({ page }) => {
  await page.goto(`${site}/materials/cement`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toContainText('Cement rate in Patna');
  await expect(main.getByText('How it is sold')).toBeVisible();
  await expect(main.getByText('What to check when it arrives')).toBeVisible();
  await main.getByRole('link', { name: 'TEST OTHER', exact: true }).click();
  await expect(page).toHaveURL(/brand=TEST(\+|%20)OTHER/);
  await expect(main.getByRole('row', { name: /TEST PUB Cement B/ })).toBeVisible();
  await expect(main.getByRole('row', { name: /TEST PUB Cement A/ })).toHaveCount(0);
  // Filter addresses point Google at the base page.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `${site}/materials/cement`,
  );
});

test('the trade word is the address, and the title follows the rate', async ({ page, request }) => {
  await htmlWith(request, '/materials/sariya', 'TEST PUB Sariya');
  await page.goto(`${site}/materials/sariya`);
  await expect(page).toHaveTitle(/Sariya \(TMT steel rod\) rate in Patna/);
  await expect(page).toHaveTitle(/₹68 a kg/);
  await expect(page.getByRole('main').getByText(/also called saria or chhad/)).toBeVisible();
  const steel = await request.get(`${site}/materials/steel`, { maxRedirects: 0 });
  expect(steel.status()).toBe(404);
});

test('search finds a material by trade word, plain word and confirmed alias', async ({ page }) => {
  for (const q of ['saria', 'rod', 'test-pub-alias']) {
    await page.goto(`${site}/materials?q=${encodeURIComponent(q)}`);
    await expect(
      page.getByRole('main').getByRole('row', { name: /TEST PUB Sariya/ }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  }
});

test('search works as a plain form, and a miss says who to ask', async ({ page }) => {
  await page.goto(`${site}/materials`);
  await page.getByRole('searchbox', { name: 'Search materials' }).fill('nothing-like-this');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/q=nothing-like-this/);
  await expect(page.getByRole('heading', { name: 'Not listed? Ask the shop.' })).toBeVisible();
});

test('bad input is harmless everywhere it can be typed into an address', async ({
  page,
  request,
}) => {
  const script = '<script>window.__pwn=1</script>';
  await page.goto(`${site}/materials?q=${encodeURIComponent(script)}`);
  expect(
    await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn),
  ).toBeUndefined();
  await expect(page.getByRole('main').getByText(script)).toBeVisible();
  for (const path of [
    '/materials/%3Cscript%3E',
    '/materials/cement/%3Cscript%3E',
    '/materials/..%2F..%2Fetc',
    '/guide/%3Cscript%3E',
    `/materials/cement/${'x'.repeat(4000)}`,
  ]) {
    const response = await request.get(`${site}${path}`);
    expect(response.status(), path).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain('<script>window');
  }
  const long = await request.get(`${site}/materials?q=${'x'.repeat(3000)}`);
  expect(long.status()).toBe(200);
  const array = await request.get(`${site}/materials/cement?brand=a&brand=b&grade[]=x`);
  expect(array.status()).toBe(200);
});

test('old addresses move for good, and no Hindi address is left', async ({ request }) => {
  const moved = async (path: string, to: string) => {
    const response = await request.get(`${site}${path}`, { maxRedirects: 0 });
    expect(response.status(), path).toBe(308);
    expect(response.headers().location, path).toBe(to);
  };
  await moved('/about?lang=hi', '/about');
  await moved('/materials/cement?brand=ACC&lang=hi', '/materials/cement?brand=ACC');
  await moved('/hi', '/');
  await moved('/hi/rates', '/rates');
  await moved('/cart', '/list');
  await moved('/products', '/materials');
  await moved('/products?category=steel', '/materials/sariya');
  await moved('/products/test-pub-cement-a', '/materials/cement/test-pub-cement-a');
  const missing = await request.get(`${site}/products/does-not-exist`, { maxRedirects: 0 });
  expect(missing.status()).toBe(404);
});

test('there is no language switch', async ({ page }) => {
  await page.goto(site);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: /English|Hindi|हिन्दी/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Hindi|हिन्दी/ })).toHaveCount(0);
  // Visitors may use their browser's own translation on public pages, not on buying pages.
  expect(await page.locator('html').getAttribute('translate')).toBeNull();
  await page.goto(`${site}/list`);
  await expect(page.locator('main [translate="no"]').first()).toBeAttached();
});

test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });
  test('every word, rate and link is there, and Add is hidden', async ({ page }) => {
    await page.goto(`${site}/rates`);
    const main = page.getByRole('main');
    await expect(main.getByRole('row', { name: /TEST PUB Cement A/ })).toContainText('₹395');
    await expect(main.getByRole('button', { name: /One more/ }).first()).toBeHidden();
    await main.getByRole('link', { name: 'TEST PUB Cement A' }).click();
    await expect(page).toHaveURL(/\/materials\/cement\/test-pub-cement-a$/);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      'TEST PUB Cement A',
    );
  });
  test('the home page is a complete stacked page', async ({ page }) => {
    await page.goto(site);
    await expect(page.locator('html')).not.toHaveAttribute('data-film', /.+/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('A home goes up');
    await expect(page.getByRole('heading', { name: 'Slab day' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'One evening, the lights come on' }),
    ).toBeVisible();
    // The film's own layers are gone, and the page is not seven screens of nothing.
    const height = await page.evaluate(
      () => document.querySelector('[data-film-root]')!.getBoundingClientRect().height,
    );
    expect(height).toBeLessThan(6000);
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  test('the home page is complete and nothing keeps moving', async ({ page }) => {
    await page.goto(site);
    await expect(page.locator('html')).not.toHaveAttribute('data-film', /.+/);
    await expect(page.getByRole('heading', { name: 'Walls go up, row by row' })).toBeVisible();
    await page.waitForTimeout(1000);
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.playState === 'running' &&
              animation.effect?.getTiming().iterations === Infinity,
          ).length,
    );
    expect(running).toBe(0);
  });
});

test.describe('the film', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('lays over the page: scrolling moves stages, the rail jumps, and the words are always there', async ({
    page,
  }) => {
    await page.goto(site);
    await expect(page.locator('html')).toHaveAttribute('data-film', 'full');
    await expect(page.locator('[data-film-root]')).toHaveAttribute('data-film-ready', '', {
      timeout: 20000,
    });
    const stage = page.locator('[data-rail] button[aria-current="step"]');
    await page.evaluate(() => window.scrollTo(0, innerHeight * 1.5));
    await expect(stage).toHaveAttribute('aria-label', 'Foundation');
    await page.locator('[data-go="3"]').click();
    await expect(stage).toHaveAttribute('aria-label', 'Slab');
    await expect(page.getByRole('heading', { name: 'Slab day' })).toHaveCSS('opacity', '1');
    // Buttons in a hidden panel cannot take focus.
    const hidden = page.locator('[data-panel="0"] [data-add], [data-panel="0"] a').first();
    await expect(hidden).toHaveAttribute('tabindex', '-1');
    // The last stage falls to night and the rates follow on.
    await page.locator('[data-go="5"]').click();
    await expect(page.locator('[data-film-root]')).toHaveAttribute('data-night', '');
    await page.evaluate(() => document.querySelector('#rates')!.scrollIntoView());
    await expect(page.getByRole('heading', { name: /rates$/i }).first()).toBeInViewport();
  });
  test('a tier is chosen before first paint, and tall windows get the still page', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 2100 } });
    const page = await context.newPage();
    await page.goto(site);
    await expect(page.locator('html')).not.toHaveAttribute('data-film', /.+/);
    await context.close();
  });
  test('a blocked film file leaves the whole page working', async ({ page }) => {
    await page.route(/film_engine|engine/, (route) => route.abort());
    await page.goto(site);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /rates$/i }).first()).toBeAttached();
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Open the full rate page' }),
    ).toBeAttached();
  });
});

for (const [width, height] of [
  [360, 560],
  [360, 800],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [1920, 1080],
] as const)
  test.describe(`at ${width} by ${height}`, () => {
    test.use({ viewport: { width, height } });
    test('no page scrolls sideways, and the rate bar is on the first screen', async ({ page }) => {
      for (const path of [
        '/',
        '/rates',
        '/materials',
        '/materials/cement',
        '/materials/cement/test-pub-cement-a',
        '/list',
        '/about',
        '/contact',
        '/delivery',
        '/guide',
        '/privacy',
      ]) {
        await page.goto(`${site}${path}`);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
      await page.goto(site);
      const bar = page.locator('[data-ratebar]');
      await expect(bar).toBeInViewport();
      const box = (await bar.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      await expect(
        page.locator('[data-site-nav]').getByRole('link', { name: /Your list/ }),
      ).toBeInViewport();
    });
  });

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 560 } });
  test('the menu opens and closes, and holds every page', async ({ page }) => {
    await page.goto(site);
    const menu = page.locator('[data-menu]');
    await menu.locator('summary').click();
    const sheet = menu.getByRole('navigation', { name: 'Menu' });
    await expect(sheet.getByRole('link', { name: 'Rates', exact: true })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'My orders' })).toBeVisible();
    await sheet.getByRole('link', { name: 'Rates', exact: true }).click();
    await expect(page).toHaveURL(`${site}/rates`);
    await expect(sheet).toBeHidden();
  });
});

test.describe('on a slow connection', () => {
  test('a tap on Add before the page’s code arrives still lands on the list', async ({ page }) => {
    // Hold back every script after the document, so the inline queue is all there is.
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    await page.route('**/_next/static/**/*.js*', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${site}/materials/cement/test-pub-cement-a`, { waitUntil: 'commit' });
    const add = page.getByRole('button', { name: 'Add TEST PUB Cement A to your list' });
    await add.click();
    await expect(add).toHaveAttribute('aria-pressed', 'true');
    release();
    await expect(page.locator('[data-site-nav] [data-list-count]')).toHaveText('1', {
      timeout: 30000,
    });
    const stored = await page.evaluate(() => localStorage.getItem('shiv_list_v1'));
    expect(JSON.parse(stored!).lines).toHaveLength(1);
    expect(JSON.parse(stored!).lines[0]).toMatchObject({ i: 'test-pub-cement-a', q: 1 });
  });
});

test('a price published by the owner reaches the next page load', async ({ page, request }) => {
  const db = database();
  try {
    await db.product.update({ where: { id: 'test-pub-gitti' }, data: { pricePaise: 530000 } });
  } finally {
    await db.$disconnect();
  }
  await htmlWith(request, '/materials/gitti', '₹5,300');
  await page.goto(`${site}/materials/gitti`);
  await expect(page.getByRole('main').getByRole('row', { name: /TEST PUB Gitti/ })).toContainText(
    '₹5,300',
  );
});

test('public pages send a nonce and strict headers, and can be kept for Back', async ({
  request,
}) => {
  const first = await request.get(`${site}/rates`);
  const second = await request.get(`${site}/rates`);
  const nonce = (headers: Record<string, string>) =>
    /'nonce-([^']+)'/.exec(headers['content-security-policy']!)?.[1];
  expect(nonce(first.headers())).toBeTruthy();
  expect(nonce(first.headers())).not.toBe(nonce(second.headers()));
  // The development server writes its own cache header; lib/redirects-proxy.test.ts and the
  // production headers check cover what a real server sends.
  expect(first.headers()['x-frame-options']).toBe('DENY');
  expect(first.headers()['x-content-type-options']).toBe('nosniff');
  const list = await request.get(`${site}/list`);
  expect(list.headers()['cache-control']).toMatch(/no-store/);
});

test('the mason’s thread and the nav mark where you are', async ({ page }) => {
  await page.goto(`${site}/rates`);
  await expect(
    page.locator('[data-nav-links]').getByRole('link', { name: 'Rates', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page
    .locator('[data-nav-links]')
    .getByRole('link', { name: 'Materials', exact: true })
    .click();
  await expect(page).toHaveURL(`${site}/materials`);
  await expect(
    page.locator('[data-nav-links]').getByRole('link', { name: 'Materials', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.locator('[data-nav-links]').getByRole('link', { name: 'Rates', exact: true }),
  ).not.toHaveAttribute('aria-current', 'page');
  await expect(page.locator('html')).not.toHaveAttribute('data-nav-pending', '');
});

test('keyboard users reach the rates first thing', async ({ page, browserName }) => {
  await page.goto(`${site}/rates`);
  // Safari's default: Tab skips links, and Option+Tab is what reaches them.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  // A real table, read in order, with its rates beside their names.
  await expect(page.locator('main table caption').first()).toBeAttached();
  await expect(page.locator('main th[scope="row"]').first()).toBeAttached();
});
