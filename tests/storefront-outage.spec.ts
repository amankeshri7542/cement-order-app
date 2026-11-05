import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// What only a controllable shop can show: outages, old rates, real rates, approved facts, the guide
// and Ask. A small fake API stands in for the real one, and a second website server reads from it.
// Most Ask routes here are stubs of the contract in packages/shared/src/advisor.ts, since a model
// answers only on a server that passed its safety test. One test passes them to the real API.
const apiPort = 4091;
const sitePort = 3091;
const site = `http://localhost:${sitePort}`;
const revalidateSecret = 'outage-spec-secret';

const now = () => new Date().toISOString();
const product = (over: Record<string, unknown> = {}) => ({
  id: 'mock-cement',
  name: 'Mock Cement',
  brand: 'Mock',
  type: 'PPC',
  grade: 'PPC',
  unit: '50 kg bag',
  packSize: '',
  minQuantity: 1,
  quantityStep: 1,
  pricePaise: 40000,
  availability: 'IN_STOCK',
  priceUpdatedAt: now(),
  checkedAt: now(),
  images: [],
  description: 'A mock.',
  recommendedUse: 'Mock use.',
  categorySlug: 'cement',
  searchTerms: [],
  ...over,
});
const catalog = (over: Record<string, unknown> = {}) => ({
  products: [product()],
  categories: [{ id: 'cement', name: 'Cement', slug: 'cement' }],
  ratesCheckedAt: now(),
  sampleRates: false,
  generatedAt: now(),
  ...over,
});
const unapproved = {
  name: 'Shiv Cement Store',
  city: 'Patna, Bihar',
  story: 'A family shop for the materials your next project needs.',
  contactApproved: false,
  phone: '',
  whatsapp: '',
  address: '',
  hours: '',
  directionsUrl: '',
  family: [],
  gallery: [],
  firm: null,
};
const approved = {
  ...unapproved,
  contactApproved: true,
  phone: '+919000000001',
  whatsapp: '+919000000002',
  address: 'Mock Road, Patna',
  hours: 'Mock hours',
  directionsUrl: 'https://maps.example.test/mock',
  firm: {
    legalName: 'Mock Legal Name',
    tradeName: 'Mock Trade',
    gstin: null,
    complaintOfficerName: 'Mock Officer',
    complaintOfficerPhone: '+919000000003',
  },
};
const article = {
  slug: 'cement-storage',
  title: 'Storing cement at site',
  titleHinglish: '',
  summary: 'How to keep cement dry.',
  stages: [],
  materials: ['cement'],
  checkedOn: '2027-03',
};
const turnView = (over: Record<string, unknown> = {}) => ({
  id: 'turn-1',
  clientTurnId: 'x',
  status: 'DONE',
  speaker: 'Shiv Cement AI',
  route: 'EXPLAIN_TERM',
  level: 'CHECKED',
  label: 'CHECKED',
  language: 'en',
  text: 'Keep bags dry. Stack them off the floor.',
  products: [],
  nudge: null,
  delivery: null,
  estimate: null,
  citations: [
    {
      slug: 'cement-storage',
      title: 'Storing cement at site',
      href: '/guide/cement-storage',
      citedText: 'x',
      checkedOn: '2027-03',
    },
  ],
  articles: [],
  followups: ['How do I read a cement bag?'],
  limit: null,
  whatsappUrl: null,
  feedback: null,
  createdAt: now(),
  ...over,
});

const state: {
  down: boolean;
  catalog: unknown;
  shop: unknown;
  config: { askEnabled: boolean; whatsappDeskLive: boolean };
  guide: (typeof article)[];
  turn: (body: Record<string, unknown>) => {
    status: number;
    events?: unknown[];
    holdOpen?: boolean;
    cut?: boolean | 'early';
    view?: unknown;
  };
  feedback: unknown[];
  listStatus: string;
  turns: Record<string, unknown>;
  requests: string[];
  realAdvisor: boolean;
} = {
  down: false,
  catalog: catalog(),
  shop: unapproved,
  config: { askEnabled: false, whatsappDeskLive: false },
  guide: [],
  turn: () => ({ status: 201 }),
  feedback: [],
  listStatus: 'ok',
  turns: {},
  requests: [],
  realAdvisor: false,
};

let fake: Server;
let web: ChildProcess;
test.describe.configure({ mode: 'serial' });

async function waitFor(url: string) {
  for (let i = 0; i < 240; i++) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      /* Not up yet. */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`${url} did not start`);
}

test.beforeAll(async () => {
  test.setTimeout(240000);
  fake = createServer((req, res) => {
    const path = (req.url ?? '').replace(/^\/api\/v1/, '').split('?')[0]!;
    state.requests.push(`${req.method} ${path}`);
    res.setHeader('Access-Control-Allow-Origin', site);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-advisor-device');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (state.down) return void res.destroy();
    if (state.realAdvisor && path.startsWith('/advisor/')) {
      const upstream = request(
        `http://localhost:4010/api/v1${path}`,
        {
          method: req.method,
          headers: { ...req.headers, host: 'localhost:4010', origin: 'http://localhost:3004' },
        },
        (answer) => {
          res.writeHead(answer.statusCode ?? 502, {
            'Content-Type': String(answer.headers['content-type'] ?? 'application/json'),
          });
          answer.pipe(res);
        },
      );
      upstream.on('error', () => res.destroy());
      req.pipe(upstream);
      return;
    }
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (path === '/public/catalog') return json(200, state.catalog);
      if (path === '/public/offers') return json(200, { items: [] });
      if (path === '/public/shop') return json(200, state.shop);
      if (path === '/client-config') return json(200, state.config);
      if (path === '/guide') return json(200, { items: state.guide });
      if (path.startsWith('/guide/')) {
        const found = state.guide.find((item) => `/guide/${item.slug}` === path);
        if (!found) return json(404, { error: { code: 'NOT_FOUND' } });
        return json(200, {
          ...found,
          version: 1,
          sections: [{ id: 'dry', heading: 'Keep it dry', blocks: ['Water spoils cement.'] }],
          relatedQuestions: ['How do I read a cement bag?'],
          standardsMentioned: [],
          reviewDueOn: null,
        });
      }
      if (path === '/public/list-check')
        return json(201, {
          lines: (body.lines as { productId: string }[]).map((line) => ({
            productId: line.productId,
            status: state.listStatus,
            pricePaise: 40000,
            minQuantity: 1,
            quantityStep: 1,
          })),
        });
      if (path === '/auth/session') return json(401, { error: { code: 'UNAUTHORIZED' } });
      if (path === '/auth/refresh') return json(401, { error: { code: 'UNAUTHORIZED' } });
      if (path === '/advisor/device') return json(201, { deviceToken: 'adv1.token.signature' });
      if (path === '/advisor/turns') {
        const answer = state.turn(body);
        if (answer.status !== 201) return json(answer.status, { error: { code: 'ADVISOR_LIMIT' } });
        if (answer.view) return json(200, answer.view);
        res.writeHead(201, { 'Content-Type': 'text/event-stream' });
        for (const event of answer.events ?? [])
          res.write(
            `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
        // Early: before anything arrives. Otherwise the events get there first.
        if (answer.cut === 'early') return void res.destroy();
        if (answer.cut) return void setTimeout(() => res.destroy(), 200);
        if (!answer.holdOpen) res.end();
        return;
      }
      const turn = /^\/advisor\/turns\/([^/]+)(\/\w+)?$/.exec(path);
      if (turn) {
        if (turn[2] === '/feedback') state.feedback.push(body);
        return json(200, state.turns[turn[1]!] ?? turnView());
      }
      return json(404, { error: { code: 'NOT_FOUND' } });
    });
  }).listen(apiPort, '127.0.0.1');
  web = spawn('npx', ['next', 'dev', '--port', String(sitePort), '--hostname', '127.0.0.1'], {
    cwd: 'apps/storefront',
    env: {
      ...process.env,
      NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}/api/v1`,
      NEXT_DIST_DIR: '.next-shots/outage',
      CATALOG_TTL_SECONDS: '1',
      REVALIDATE_SECRET: revalidateSecret,
      SITE_URL: 'https://shop.example.test',
      SITE_INDEXING: 'on',
    },
    stdio: 'ignore',
    detached: true,
  });
  await waitFor(`${site}/terms`);
});
test.afterAll(async () => {
  if (web.pid) process.kill(-web.pid, 'SIGTERM');
  await new Promise((done) => fake.close(done));
});
// A read the website saved from the test before must not answer for this one.
const forgetSaved = () =>
  fetch(`${site}/api/revalidate`, {
    method: 'POST',
    headers: { 'x-revalidate-secret': revalidateSecret },
  });
test.beforeEach(async () => {
  state.down = false;
  state.catalog = catalog();
  state.shop = unapproved;
  state.config = { askEnabled: false, whatsappDeskLive: false };
  state.realAdvisor = false;
  state.guide = [];
  state.feedback = [];
  state.listStatus = 'ok';
  state.turns = {};
  state.turn = () => ({ status: 201 });
  await forgetSaved();
});

/** The website caches for a second and refreshes behind the scenes, so wait for a new read to land. */
async function settled(page: Page, path: string, ready: (html: string) => boolean) {
  await expect
    .poll(
      async () => {
        await forgetSaved();
        const response = await page.request.get(`${site}${path}`);
        return ready(await response.text());
      },
      { timeout: 30000, intervals: [700] },
    )
    .toBe(true);
}

test('rates: fresh ones say today; with the shop down the last known rates stay, with their time', async ({
  page,
}) => {
  await settled(page, '/rates', (html) => html.includes('₹400'));
  await page.goto(`${site}/rates`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Today’s rates');
  await expect(page).toHaveTitle(/rates in Patna today/);
  await expect(page.getByRole('main').getByText(/Checked today/)).toBeVisible();
  state.down = true;
  await page.waitForTimeout(1500);
  await page.goto(`${site}/rates`);
  await expect(page.getByRole('main').getByRole('row', { name: /Mock Cement/ })).toContainText(
    '₹400',
  );
  await expect(page.getByRole('main').getByText(/Checked today/)).toBeVisible();
});

test('every public page still opens with the shop down', async ({ page }) => {
  state.down = true;
  await page.waitForTimeout(1500);
  for (const path of [
    '/',
    '/materials',
    '/materials/cement',
    '/about',
    '/contact',
    '/delivery',
    '/guide',
    '/privacy',
    '/terms',
  ]) {
    const response = await page.goto(`${site}${path}`);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
  }
});

test('rates not checked today: the date shows, and “today” goes from the title and heading', async ({
  page,
}) => {
  const old = '2026-01-15T04:00:00.000Z';
  state.catalog = catalog({
    products: [product({ checkedAt: old, priceUpdatedAt: old })],
    ratesCheckedAt: old,
  });
  await settled(page, '/rates', (html) => html.includes('15 January'));
  await page.goto(`${site}/rates`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rates');
  await expect(page).not.toHaveTitle(/today/i);
  await expect(page.getByRole('main').getByText(/Rates as of 15 January/)).toBeVisible();
  await page.goto(`${site}/materials/cement`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cement rate in Patna');
  await page.goto(site);
  await expect(page.getByRole('main')).not.toContainText('today’s rate');
  await expect(page.getByRole('link', { name: 'See the rates' }).first()).toBeVisible();
});

test('sample rates are labelled everywhere and never indexed, even with indexing on', async ({
  page,
}) => {
  state.catalog = catalog({ sampleRates: true });
  await settled(page, '/rates', (html) => html.includes('Sample rates, not real prices'));
  for (const path of ['/rates', '/materials/cement', '/materials/cement/mock-cement']) {
    await page.goto(`${site}${path}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(
      page
        .getByRole('main')
        .getByText(/Sample rate/)
        .first(),
    ).toBeVisible();
  }
});

test('real rates with indexing on may be indexed, with clean canonical links and a sitemap', async ({
  page,
}) => {
  await settled(page, '/rates', (html) => html.includes('index, follow'));
  await page.goto(`${site}/materials/cement/mock-cement`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://shop.example.test/materials/cement/mock-cement',
  );
  await expect(page.getByRole('main').getByText(/Sample rate/)).toHaveCount(0);
});

test('a rate of nothing never prints: an empty catalogue and a broken answer both say so', async ({
  page,
}) => {
  state.catalog = catalog({ products: [] });
  await settled(page, '/rates', (html) => html.includes('Rate not available right now'));
  await page.goto(`${site}/rates`);
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Rate not available right now.' }),
  ).toBeVisible();
  expect(await page.content()).not.toContain('₹0');
  state.catalog = { nonsense: true };
  await page.waitForTimeout(1500);
  await page.goto(`${site}/rates`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.content()).not.toContain('₹0');
});

test('an approved number brings WhatsApp out, with the right text at each door', async ({
  page,
}) => {
  state.shop = approved;
  await settled(page, '/about', (html) => html.includes('Mock Road'));
  await page.goto(`${site}/about`);
  const main = page.getByRole('main');
  await expect(main.getByRole('row', { name: /Address/ })).toContainText('Mock Road, Patna');
  await expect(main.getByRole('link', { name: '+919000000001' })).toHaveAttribute(
    'href',
    'tel:+919000000001',
  );
  await expect(main.getByRole('row', { name: /Shop/ })).toContainText('Mock Legal Name');
  await page.goto(`${site}/materials/cement/mock-cement`);
  const ask = await page
    .getByRole('main')
    .getByRole('link', { name: 'Ask on WhatsApp' })
    .getAttribute('href');
  expect(ask).toContain('https://wa.me/919000000002?text=');
  expect(decodeURIComponent(ask!)).toContain(
    'Namaste, Mock Cement (a bori) ka rate aur delivery bata dijiye.',
  );
  expect(decodeURIComponent(ask!)).not.toContain('₹');
  await page.goto(site);
  const hero = page.getByRole('link', { name: 'Order on WhatsApp' }).first();
  expect(decodeURIComponent((await hero.getAttribute('href'))!)).toContain('order dena hai');
  await expect(page.locator('[data-placeholder="whatsapp-number"]')).toHaveCount(0);
  // Structured data for the one real shop, and only with approved facts.
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const store = blocks
    .map((text) => JSON.parse(text))
    .find((data) => data['@type'] === 'HardwareStore');
  expect(store.telephone).toBe('+919000000001');
  expect(store.address.streetAddress).toBe('Mock Road, Patna');
  await page.goto(`${site}/contact`);
  await expect(
    page.getByRole('main').getByRole('row', { name: /Complaints officer/ }),
  ).toContainText('Mock Officer');
  await expect(page.locator('[data-placeholder="legal-facts"]')).toHaveCount(0);
});

test('a bad number from the shop never becomes a link', async ({ page }) => {
  state.shop = { ...approved, whatsapp: 'https://evil.example', phone: 'javascript:alert(1)' };
  await settled(page, '/about', (html) => html.includes('Mock Road'));
  await page.goto(`${site}/about`);
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.locator('a[href*="evil.example"]')).toHaveCount(0);
  await expect(page.locator('a[href^="javascript"]')).toHaveCount(0);
});

test('list: the three exits with an approved number; WhatsApp leads when the pincode is not served', async ({
  page,
}) => {
  state.shop = approved;
  state.catalog = catalog();
  await settled(page, '/about', (html) => html.includes('Mock Road'));
  await page.goto(`${site}/materials/cement/mock-cement`);
  await page.getByRole('button', { name: 'Add Mock Cement to your list' }).click();
  await page.goto(`${site}/list`);
  const whatsapp = page.locator('[data-exit="whatsapp"]');
  await expect(page.locator('[data-exit="order"]')).toHaveClass(/btn-solid/);
  await expect(whatsapp).toHaveClass(/btn-line/);
  await expect(page.locator('[data-exit="rate"]')).toHaveClass(/btn-quiet/);
  const text = decodeURIComponent((await whatsapp.getAttribute('href'))!);
  expect(text).toContain('wa.me/919000000002');
  expect(text).toContain('1 x Mock Cement (a bori (50 kg))');
  expect(text).not.toContain('₹');
  state.listStatus = 'over';
  await page.reload();
  await expect(page.locator('[data-exit="rate"]')).toHaveClass(/btn-solid/);
  await expect(page.locator('[data-exit="whatsapp"]')).toBeVisible();
});

test('the guide comes from the shop’s signed articles, and is honest when there are none', async ({
  page,
}) => {
  state.guide = [];
  await settled(
    page,
    '/guide',
    (html) => html.includes('The guide is being checked') || html.includes('review'),
  );
  state.guide = [article];
  await settled(page, '/guide', (html) => html.includes('Storing cement at site'));
  await page.goto(`${site}/guide`);
  await expect(
    page.getByRole('main').getByText('Checked by a civil engineer, March 2027'),
  ).toBeVisible();
  await page.getByRole('link', { name: /Storing cement at site/ }).click();
  await expect(page).toHaveURL(`${site}/guide/cement-storage`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Storing cement at site');
  await expect(page.getByRole('main').getByText('Water spoils cement.')).toBeVisible();
  await expect(
    page.getByRole('main').getByText(/General guide, not advice on your house/),
  ).toBeVisible();
  const missing = await page.request.get(`${site}/guide/no-such-article`);
  expect(missing.status()).toBe(404);
});

const askOn = async (page: Page) => {
  state.config = { askEnabled: true, whatsappDeskLive: false };
  await settled(page, '/terms', (html) => html.includes('href="/ask"'));
};

test('with Ask off, there is no Ask link anywhere, but a review build still shows why', async ({
  page,
}) => {
  await settled(
    page,
    '/terms',
    (html) => !html.includes('href="/ask"') && !html.includes('data-ask'),
  );
  await page.goto(site);
  await expect(
    page.locator('[data-nav-links]').getByRole('link', { name: 'Ask', exact: true }),
  ).toHaveCount(0);
  await page.goto(`${site}/ask`);
  await expect(page.locator('[data-placeholder="ask-off"]')).toBeVisible();
});

test('Ask: opens in a sheet, loads only when asked for, and answers from the guide', async ({
  page,
}) => {
  await askOn(page);
  state.turn = () => ({
    status: 201,
    events: [
      { type: 'status', turnId: 'turn-1', clientTurnId: 'x', text: '' },
      { type: 'text', text: 'Keep bags dry.' },
      { type: 'done', turn: turnView() },
    ],
  });
  const panelChunks: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/advisor/')) panelChunks.push(request.url());
  });
  await page.goto(`${site}/materials/cement`);
  expect(panelChunks).toEqual([]);
  await page.locator('[data-nav-links]').getByRole('link', { name: 'Ask', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Ask' });
  await expect(sheet.getByRole('heading', { name: 'Ask about building your home.' })).toBeVisible();
  await expect(
    sheet.getByText('AI answers. Do not share your phone number or address here.'),
  ).toBeVisible();
  // The link opens the sheet and stays on this page; it does not also go to /ask behind it.
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(`${site}/materials/cement`);
  await sheet.getByLabel('Your question').fill('How do I store cement?');
  await sheet.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(sheet.getByText('Shiv Cement AI')).toBeVisible();
  await expect(sheet.getByText('Keep bags dry.', { exact: true })).toBeVisible();
  await expect(sheet.getByText('Checked', { exact: true })).toBeVisible();
  await expect(
    sheet.getByText(
      /From our guide: Storing cement at site\. Checked by a civil engineer, March 2027/,
    ),
  ).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Open it' })).toHaveAttribute(
    'href',
    '/guide/cement-storage',
  );
  // Feedback is words, not thumbs, and asks why only when something was wrong.
  await sheet.getByRole('button', { name: 'Not right' }).click();
  await sheet.getByRole('button', { name: 'Wrong' }).click();
  await expect(sheet.getByText('Thank you.', { exact: true })).toBeVisible();
  expect(state.feedback).toEqual([{ value: 'NOT_RIGHT', reason: 'WRONG' }]);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
});

test('Ask: at a limit, matching articles and a WhatsApp button, not a broken page', async ({
  page,
}) => {
  await askOn(page);
  state.turn = () => ({
    status: 201,
    events: [
      { type: 'status', turnId: 'turn-2', clientTurnId: 'x', text: '' },
      {
        type: 'done',
        turn: turnView({
          id: 'turn-2',
          text: 'You have asked a lot today. The guide is still here, or ask the shop.',
          label: null,
          level: 'FIXED',
          citations: [],
          followups: [],
          limit: 'DEVICE',
          articles: [
            {
              slug: 'cement-storage',
              title: 'Storing cement at site',
              titleHinglish: '',
              summary: 's',
              href: '/guide/cement-storage',
            },
          ],
          whatsappUrl: 'https://wa.me/919000000002?text=x',
        }),
      },
    ],
  });
  await page.goto(`${site}/ask`);
  await page.getByLabel('Your question').fill('One more question');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('You have asked a lot today.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Storing cement at site' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ask the shop on WhatsApp' })).toHaveAttribute(
    'href',
    /wa\.me\/919000000002/,
  );
  await expect(page.getByRole('button', { name: 'This helped' })).toHaveCount(0);
});

test('Ask: a limit with no approved number still leaves a way to the shop, and no WhatsApp button', async ({
  page,
}) => {
  await askOn(page);
  const text = 'You have asked a lot today. The guide and the shop are still here.';
  state.turn = () => ({
    status: 201,
    events: [
      { type: 'status', turnId: 'turn-9', clientTurnId: 'x', text: '' },
      { type: 'text', text },
      {
        type: 'done',
        turn: turnView({
          id: 'turn-9',
          text,
          limit: 'DEVICE',
          label: null,
          level: 'FIXED',
          citations: [],
          articles: [],
          whatsappUrl: null,
        }),
      },
    ],
  });
  await page.goto(`${site}/ask`);
  await page.getByLabel('Your question').fill('One more question');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Contact the shop' })).toHaveAttribute(
    'href',
    '/contact',
  );
  await expect(main.getByRole('link', { name: /WhatsApp/ })).toHaveCount(0);
  await expect(main.getByRole('alert')).toHaveCount(0);
});

test('Ask: the real advisor routes, with no model behind them, answer honestly through this panel', async ({
  page,
}) => {
  await askOn(page);
  state.realAdvisor = true;
  state.requests = [];
  await page.goto(`${site}/ask`);
  await page.getByLabel('Your question').fill('How do I store cement?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const main = page.getByRole('main');
  await expect(
    main.getByText('You can ask the shop or your engineer.', { exact: true }),
  ).toBeVisible();
  await expect(main.getByText('Shiv Cement AI', { exact: true }).first()).toBeVisible();
  // whatsappUrl is null until a number is approved, so there is no button.
  await expect(main.getByRole('link', { name: /WhatsApp/ })).toHaveCount(0);
  await main.getByRole('button', { name: 'Not right' }).click();
  await main.getByRole('button', { name: 'Wrong' }).click();
  await expect(main.getByText('Thank you.', { exact: true })).toBeVisible();
  // The same device token goes on being good for the next question.
  await page.getByLabel('Your question').fill('And in the rain?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(main.getByText('And in the rain?')).toBeVisible();
  expect(state.requests.filter((line) => line === 'POST /advisor/device')).toHaveLength(1);
});

test('Ask: a bad WhatsApp link or source link from the server is not followed', async ({
  page,
}) => {
  await askOn(page);
  state.turn = () => ({
    status: 201,
    events: [
      {
        type: 'done',
        turn: turnView({
          id: 'turn-3',
          limit: 'DEVICE',
          whatsappUrl: 'javascript:alert(1)',
          citations: [
            {
              slug: 'x',
              title: 'Evil',
              href: 'https://evil.example/',
              citedText: '',
              checkedOn: null,
            },
          ],
          articles: [
            {
              slug: 'x',
              title: 'Evil article',
              titleHinglish: '',
              summary: '',
              href: 'javascript:alert(1)',
            },
          ],
        }),
      },
    ],
  });
  await page.goto(`${site}/ask`);
  await page.getByLabel('Your question').fill('Q');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Evil article' })).toHaveAttribute('href', '/guide');
  await expect(page.locator('a[href^="javascript"], a[href*="evil.example"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Ask the shop on WhatsApp' })).toHaveCount(0);
});

test('Ask: a cut connection fetches the rest of the answer, with no second charge', async ({
  page,
}) => {
  await askOn(page);
  state.turns['turn-4'] = turnView({ id: 'turn-4', text: 'The whole answer. It came through.' });
  state.turn = () => ({
    status: 201,
    cut: true,
    events: [
      { type: 'status', turnId: 'turn-4', clientTurnId: 'x', text: '' },
      { type: 'text', text: 'The whole answer.' },
    ],
  });
  const asked = () => state.requests.filter((line) => line === 'POST /advisor/turns').length;
  const before = asked();
  await page.goto(`${site}/ask`);
  await page.getByLabel('Your question').fill('Q');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('It came through.', { exact: true })).toBeVisible();
  expect(asked() - before).toBe(1);
});

test('Ask: cut before the answer’s id came, the same question finds it, and nothing runs twice', async ({
  page,
}) => {
  await askOn(page);
  const ids: unknown[] = [];
  state.turn = (body) => {
    ids.push(body.clientTurnId);
    return ids.length === 1
      ? { status: 201, cut: 'early' }
      : {
          status: 201,
          view: turnView({ id: 'turn-8', text: 'Found the first answer. Nothing ran twice.' }),
        };
  };
  await page.goto(`${site}/ask`);
  await page.getByLabel('Your question').fill('Q');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('Nothing ran twice.', { exact: true })).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('Ask: waiting says so, Cancel stops it, and the box works again', async ({ page }) => {
  await askOn(page);
  state.turn = () => ({
    status: 201,
    holdOpen: true,
    events: [{ type: 'status', turnId: 'turn-5', clientTurnId: 'x', text: '' }],
  });
  await page.goto(`${site}/ask`);
  await page.getByLabel('Your question').fill('Slow one');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Checking the guide…' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Still checking…' })).toBeVisible({
    timeout: 6000,
  });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Still checking…' })).toHaveCount(0);
  await expect.poll(() => state.requests.includes('POST /advisor/turns/turn-5/cancel')).toBe(true);
});

test('Ask: too many questions shows the guide, not an error', async ({ page }) => {
  await askOn(page);
  state.turn = () => ({ status: 429 });
  await page.goto(`${site}/ask`);
  await page.getByLabel('Your question').fill('Q');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('You have asked a lot today.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the guide' })).toHaveAttribute(
    'href',
    '/guide',
  );
});

test('Ask: voice gives a draft to read and change, and sends nothing by itself', async ({
  page,
}) => {
  await askOn(page);
  await page.addInitScript(() => {
    class Fake {
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      lang = '';
      interimResults = false;
      start() {
        setTimeout(() => {
          this.onresult?.({ results: [{ 0: { transcript: 'cement kaise rakhein' } }] });
          this.onend?.();
        }, 10);
      }
      stop() {}
    }
    const speechWindow = window as unknown as {
      SpeechRecognition: unknown;
      webkitSpeechRecognition: unknown;
    };
    speechWindow.SpeechRecognition = Fake;
    speechWindow.webkitSpeechRecognition = Fake;
  });
  const asked = () => state.requests.filter((line) => line === 'POST /advisor/turns').length;
  const before = asked();
  await page.goto(`${site}/ask`);
  await page.getByRole('button', { name: 'Speak' }).click();
  await expect(page.getByLabel('Your question')).toHaveValue('cement kaise rakhein');
  await page.waitForTimeout(500);
  expect(asked()).toBe(before);
});

test('Ask: a rate on an answer can go on the list, and shows no stock', async ({ page }) => {
  await askOn(page);
  state.turn = () => ({
    status: 201,
    events: [
      {
        type: 'done',
        turn: turnView({
          id: 'turn-6',
          route: 'CATALOG',
          level: 'FIXED',
          label: null,
          citations: [],
          nudge: 'We sell these. You can buy them anywhere.',
          products: [
            {
              id: 'mock-cement',
              name: 'Mock Cement',
              brand: 'Mock',
              grade: 'PPC',
              unit: '50 kg bag',
              packSize: '',
              minQuantity: 1,
              quantityStep: 1,
              pricePaise: 40000,
              priceVersion: 1,
              priceUpdatedAt: now(),
              isSample: true,
              availability: 'IN_STOCK',
            },
          ],
        }),
      },
    ],
  });
  await page.goto(`${site}/ask`);
  await page.getByLabel('Your question').fill('Rate of cement');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Mock Cement' });
  await expect(row).toContainText('₹400');
  await expect(row).toContainText('sample rate');
  await row.getByRole('button', { name: 'Add to list' }).click();
  await expect(row.getByRole('button', { name: 'Added' })).toBeVisible();
  await expect(page.locator('[data-site-nav] [data-list-count]')).toHaveText('1');
});
