import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Review screenshots for the website, the customer app (Expo web) and the owner desk.
// Run through scripts/shots/run.mjs (playwright.shots.config.ts); prepare.mjs makes the data.
// Each product signs in once and reuses that session: sign-in codes are rate limited per phone.
const set = (process.env.SHOTS_SET || 'demo') as 'demo' | 'empty';
const out = process.env.SHOTS_DIR || 'docs/screenshots/p11/before';
const site = 'http://localhost:3022';
const app = 'http://localhost:8090';
const desk = 'http://localhost:3021';
const owner = '9900090199';
const customer = '9900090101'; // demo customer 1: a confirmed order (website)
const appCustomer = '9900090102'; // demo customer 2: an order out for delivery (app)
const widths = [360, 390, 768, 1440] as const;
const langs = ['en', 'hi'] as const;
type Lang = (typeof langs)[number];
type Session = Awaited<ReturnType<BrowserContext['storageState']>>;
const prefix = set === 'empty' ? 'empty-' : '';

const failures: string[] = [];
test.afterAll(() => {
  if (failures.length) console.log(`Screens not captured:\n- ${failures.join('\n- ')}`);
});

async function settle(page: Page) {
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(900);
}
// Full pages at the two main widths; 360 and 768 keep the first screen only (repository size).
const full = (width: number) => width === 390 || width === 1440;
async function shot(page: Page, folder: string, name: string, fullPage = true) {
  mkdirSync(join(out, folder), { recursive: true });
  await settle(page);
  // JPEG keeps the review set small enough for the repository; the dev-only badge is hidden.
  await page.screenshot({
    path: join(out, folder, `${prefix}${name}.jpg`),
    type: 'jpeg',
    quality: 80,
    fullPage,
    style: 'nextjs-portal { display: none !important; }',
  });
}
/** One screen: a failure is recorded and the run moves on to the next screen. */
async function attempt(label: string, body: () => Promise<void>) {
  try {
    await body();
  } catch (error) {
    failures.push(`${label}: ${(error as Error).message.split('\n')[0]}`);
  }
}
/** A browser at one width with the product's language set (always, over any saved choice). */
async function context(
  browser: Browser,
  width: number,
  key: string,
  value: string,
  storageState?: Session,
) {
  const height = width >= 1024 ? 900 : width >= 768 ? 1024 : 800;
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: width < 768,
    hasTouch: width < 768,
    storageState,
  });
  await ctx.addInitScript(
    ([k, v]) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage blocked */
      }
    },
    [key, value] as const,
  );
  return ctx;
}
const siteContext = (b: Browser, w: number, lang: Lang, state?: Session) =>
  context(b, w, 'shiv-storefront-language', lang, state);
const appContext = (b: Browser, lang: Lang, state?: Session) =>
  context(b, 390, 'shiv_language', JSON.stringify(lang), state);
const deskContext = (b: Browser, w: number, lang: Lang, state?: Session) =>
  context(b, w, 'shiv-owner-language', lang, state);

async function code(page: Page, click: () => Promise<void>) {
  const sent = page.waitForResponse((r) => r.url().endsWith('/auth/otp/request'));
  await click();
  const response = await sent;
  const body = await response.json();
  if (!body.devCode) throw new Error(`No sign-in code (${response.status()}).`);
  return body.devCode as string;
}
async function siteSession(browser: Browser): Promise<Session> {
  const ctx = await siteContext(browser, 390, 'en');
  const page = await ctx.newPage();
  await page.goto(`${site}/account?next=${encodeURIComponent('/orders')}`);
  const mobile = page.getByRole('main').getByLabel('Mobile number', { exact: true });
  await expect(mobile).toBeEnabled();
  await mobile.fill(customer);
  const otp = await code(page, () =>
    page.getByRole('button', { name: 'Get sign-in code', exact: true }).click(),
  );
  await page.getByRole('main').getByLabel('Six-digit code').fill(otp);
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  // A first sign-in may ask for a name: this sample customer already has one.
  await page.waitForURL(`${site}/orders`);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}
async function deskSession(browser: Browser): Promise<Session> {
  const ctx = await deskContext(browser, 1440, 'en');
  const page = await ctx.newPage();
  await page.goto(desk);
  await page.getByRole('textbox', { name: 'Staff mobile number' }).fill(owner);
  const otp = await code(page, () =>
    page.getByRole('button', { name: 'Get verification code' }).click(),
  );
  await page.locator('input[autocomplete="one-time-code"]').fill(otp);
  await page.getByRole('button', { name: 'Open store desk' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

test('website', async ({ browser }) => {
  for (const width of widths)
    for (const lang of langs) {
      const ctx = await siteContext(browser, width, lang);
      const page = await ctx.newPage();
      const tag = `${width}-${lang}`;
      await attempt(`site home ${tag}`, async () => {
        await page.goto(site);
        if (full(width)) await shot(page, 'storefront', `home-${tag}`);
        await shot(page, 'storefront', `home-fold-${tag}`, false);
      });
      if (set === 'empty' && width !== 390 && width !== 1440) {
        await ctx.close();
        continue;
      }
      await attempt(`site products ${tag}`, async () => {
        await page.goto(`${site}/products`);
        await shot(page, 'storefront', `products-${tag}`, full(width));
      });
      if (set === 'demo')
        await attempt(`site product ${tag}`, async () => {
          await page.goto(`${site}/products`);
          const href = await page
            .locator('main a[href^="/products/"]')
            .first()
            .getAttribute('href');
          await page.goto(`${site}${href}`);
          await shot(page, 'storefront', `product-${tag}`, full(width));
        });
      await attempt(`site empty basket ${tag}`, async () => {
        await page.goto(`${site}/cart`);
        await shot(page, 'storefront', `cart-empty-${tag}`, full(width));
      });
      await attempt(`site sign-in ${tag}`, async () => {
        await page.goto(`${site}/account`);
        await shot(page, 'storefront', `account-signed-out-${tag}`, full(width));
      });
      await ctx.close();
    }
  // Large text: the phone's font size doubled (the website sizes type in rem).
  await attempt('site home large text', async () => {
    const ctx = await siteContext(browser, 390, 'hi');
    const page = await ctx.newPage();
    await page.goto(site);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await shot(page, 'storefront', 'home-390-hi-large-text', false);
    await ctx.close();
  });
  if (set !== 'demo') return;
  // A signed-in sample customer with past orders, phone and desktop.
  let state: Session | undefined;
  await attempt('site sign-in', async () => {
    state = await siteSession(browser);
  });
  if (!state) return;
  for (const width of [390, 1440])
    for (const lang of langs) {
      const ctx = await siteContext(browser, width, lang, state);
      const page = await ctx.newPage();
      const tag = `${width}-${lang}`;
      await attempt(`site orders ${tag}`, async () => {
        await page.goto(`${site}/orders`);
        await expect(page.locator('.order-record').first()).toBeVisible();
        await shot(page, 'storefront', `orders-${tag}`);
      });
      await attempt(`site order detail ${tag}`, async () => {
        // The sample's confirmed order: the newest one still waiting for the shop.
        const record = page.locator('.order-record').filter({ hasText: /Confirmed|पक्का हुआ/ });
        await record.first().locator('h2 a').click();
        await expect(page.locator('.order-record')).toHaveCount(1);
        await shot(page, 'storefront', `order-detail-${tag}`);
      });
      await attempt(`site account ${tag}`, async () => {
        await page.goto(`${site}/account`);
        await shot(page, 'storefront', `account-${tag}`);
      });
      await attempt(`site checkout ${tag}`, async () => {
        await page.goto(`${site}/checkout`);
        await shot(page, 'storefront', `checkout-${tag}`);
      });
      await ctx.close();
    }
});

test('customer app (Expo web)', async ({ browser }) => {
  await attempt('app language chooser', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(app);
    await expect(page.getByRole('button', { name: 'Choose English' })).toBeVisible({
      timeout: 120000,
    });
    await shot(page, 'app', 'language-chooser', false);
    await ctx.close();
  });
  let state: Session | undefined;
  for (const lang of langs) {
    const ctx = await appContext(browser, lang, state);
    const page = await ctx.newPage();
    const words =
      lang === 'hi'
        ? { materials: 'सामग्री', account: 'खाता', orders: 'ऑर्डर' }
        : { materials: 'Materials', account: 'Account', orders: 'Orders' };
    await attempt(`app home ${lang}`, async () => {
      await page.goto(app);
      await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 120000 });
      await shot(page, 'app', `home-${lang}`);
      // The app scrolls inside its own view: two more screens of Home.
      for (const step of [1, 2]) {
        await page.mouse.move(195, 420);
        await page.mouse.wheel(0, 640);
        await shot(page, 'app', `home-${lang}-scroll-${step}`);
      }
    });
    await attempt(`app materials ${lang}`, async () => {
      await page.getByRole('tab', { name: words.materials, exact: true }).click();
      await shot(page, 'app', `materials-${lang}`);
    });
    if (set === 'demo')
      await attempt(`app product ${lang}`, async () => {
        await page
          .getByRole('button', { name: /^(View|देखें)/ })
          .first()
          .click();
        await shot(page, 'app', `product-${lang}`);
      });
    await attempt(`app basket ${lang}`, async () => {
      await page.getByRole('tab', { name: /^(Basket|टोकरी)/ }).click();
      await shot(page, 'app', `basket-empty-${lang}`);
    });
    await attempt(`app account ${lang}`, async () => {
      await page.getByRole('tab', { name: words.account, exact: true }).click();
      await shot(page, 'app', `account-${state ? 'signed-in' : 'signed-out'}-${lang}`);
    });
    if (set === 'demo')
      await attempt(`app orders ${lang}`, async () => {
        if (!state) {
          // Sign in once (English run first); the Hindi run reuses the saved session.
          await page.getByRole('button', { name: 'Sign in', exact: true }).click();
          await page
            .getByRole('textbox', { name: 'Mobile number (+91)', exact: true })
            .fill(appCustomer);
          const otp = await code(page, () =>
            page.getByRole('button', { name: 'Get verification code', exact: true }).click(),
          );
          await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill(otp);
          await page.getByRole('button', { name: 'Verify & continue', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
          state = await ctx.storageState();
          await shot(page, 'app', `account-signed-in-${lang}`);
        }
        await page.getByRole('tab', { name: words.orders, exact: true }).click();
        await shot(page, 'app', `orders-${lang}`);
        await page
          .getByRole('button', { name: /^(Open|खोलें) / })
          .first()
          .click();
        await shot(page, 'app', `order-detail-${lang}`);
        await page.getByRole('tab', { name: lang === 'hi' ? 'होम' : 'Home', exact: true }).click();
        await shot(page, 'app', `home-signed-in-${lang}`);
      });
    await ctx.close();
  }
});

test('owner desk', async ({ browser }) => {
  for (const width of [390, 1440])
    for (const lang of langs) {
      const ctx = await deskContext(browser, width, lang);
      const page = await ctx.newPage();
      await attempt(`desk sign-in ${width}-${lang}`, async () => {
        await page.goto(desk);
        await expect(
          page.locator('input[type="tel"], input[inputmode="tel"]').first(),
        ).toBeVisible();
        await shot(page, 'desk', `sign-in-${width}-${lang}`, false);
      });
      await ctx.close();
    }
  let state: Session | undefined;
  await attempt('desk sign-in', async () => {
    state = await deskSession(browser);
  });
  if (!state) return;
  for (const width of [390, 1440])
    for (const lang of langs) {
      const ctx = await deskContext(browser, width, lang, state);
      const page = await ctx.newPage();
      page.on('dialog', (d) => void d.dismiss());
      const tag = `${width}-${lang}`;
      await attempt(`desk today ${tag}`, async () => {
        await page.goto(desk);
        await expect(
          page.getByRole('heading', { name: lang === 'hi' ? 'आज' : 'Today', exact: true }),
        ).toBeVisible();
        await shot(page, 'desk', `today-${tag}`);
      });
      for (const screen of ['prices-stock', 'settings', 'staff'])
        await attempt(`desk ${screen} ${tag}`, async () => {
          await page.goto(`${desk}/#${screen}`);
          await shot(page, 'desk', `${screen}-${tag}`);
        });
      await ctx.close();
    }
});
