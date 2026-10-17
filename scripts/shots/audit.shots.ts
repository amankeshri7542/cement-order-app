import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Measured look-and-feel checks for the UX audit (Phase 11), on the same servers as the
// screenshots: tap targets under 44 px, unnamed controls, h1 count, page height and the first
// keyboard stops. Writes <SHOTS_DIR>/audit-<set>.json. Run: node scripts/shots/run.mjs demo
// <dir> --grep audit
const set = process.env.SHOTS_SET || 'demo';
const out = process.env.SHOTS_DIR || 'docs/screenshots/p11/before';
const site = 'http://localhost:3022';

type Finding = Awaited<ReturnType<typeof measure>>;
async function measure(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const controls = [
      ...document.querySelectorAll('a[href], button, input, select, textarea, summary'),
    ].filter(visible);
    const name = (el: Element) =>
      (
        el.getAttribute('aria-label') ||
        (el as HTMLElement).innerText ||
        (el as HTMLInputElement).labels?.[0]?.innerText ||
        el.getAttribute('title') ||
        ''
      )
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 60);
    // Inline links inside running text are exempt (WCAG 2.5.8 inline exception).
    const inline = (el: Element) =>
      el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li small');
    const small = controls
      .filter((el) => !inline(el))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height < 44 || r.width < 24)
      .map(({ el, r }) => ({
        tag: el.tagName.toLowerCase(),
        name: name(el),
        size: `${Math.round(r.width)}×${Math.round(r.height)}`,
      }));
    // Text contrast against the nearest opaque background (WCAG AA: 4.5, or 3 for large text).
    const rgb = (value: string) => (value.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]: number[]) =>
      [r!, g!, b!]
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    const background = (el: Element | null): number[] => {
      for (let node = el; node; node = node.parentElement) {
        const c = rgb(getComputedStyle(node).backgroundColor);
        if (c.length === 3 || (c.length === 4 && c[3]! >= 0.95)) return c.slice(0, 3);
      }
      return [255, 255, 255];
    };
    const lowContrast: { text: string; ratio: number; size: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || seen.has(el) || !node.textContent?.trim() || !visible(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      const fg = rgb(style.color);
      if (fg.length === 4 && fg[3]! < 1) continue;
      const a = lum(fg);
      const b = lum(background(el));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const px = parseFloat(style.fontSize);
      const large = px >= 24 || (px >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5))
        lowContrast.push({
          text: node.textContent.trim().slice(0, 40),
          ratio: Number(ratio.toFixed(2)),
          size: `${px}px/${style.fontWeight}`,
        });
    }
    return {
      lowContrast,
      height: document.documentElement.scrollHeight,
      h1: document.querySelectorAll('h1').length,
      unnamed: controls.filter((el) => !name(el)).map((el) => el.outerHTML.slice(0, 80)),
      small,
      placeholderText: /goes here|आएगी|lorem|TODO|placeholder/i.test(document.body.innerText)
        ? [...document.body.innerText.matchAll(/[^\n]*(goes here|आएगी|lorem|TODO)[^\n]*/gi)].map(
            (m) => m[0].slice(0, 80),
          )
        : [],
    };
  });
}
async function focusOrder(page: Page, stops = 12) {
  const names: string[] = [];
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press('Tab');
    names.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return '(body)';
        return `${el.tagName.toLowerCase()}: ${(el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)}`;
      }),
    );
  }
  return names;
}

test('audit', async ({ browser }) => {
  const result: Record<string, Finding & { focus?: string[] }> = {};
  for (const width of [390, 1440])
    for (const path of ['/', '/products', '/cart', '/account']) {
      const ctx = await browser.newContext({
        viewport: { width, height: 800 },
        isMobile: width < 768,
        hasTouch: width < 768,
      });
      const page = await ctx.newPage();
      await page.goto(`${site}${path}`);
      await page.waitForLoadState('load');
      await page.waitForTimeout(1200);
      const key = `${path} @${width}`;
      result[key] = await measure(page);
      if (path === '/') result[key].focus = await focusOrder(page);
      await ctx.close();
    }
  // The customer app's web build: React Native web renders plain elements, so the same checks run.
  for (const lang of ['en', 'hi']) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 800 },
      isMobile: true,
      hasTouch: true,
    });
    await ctx.addInitScript(
      (value) => localStorage.setItem('shiv_language', value),
      JSON.stringify(lang),
    );
    const page = await ctx.newPage();
    await page.goto('http://localhost:8090');
    await page.getByRole('tab').first().waitFor({ timeout: 120000 });
    await page.waitForTimeout(1500);
    result[`app home ${lang} @390`] = await measure(page);
    await page.getByRole('tab').nth(1).click();
    await page.waitForTimeout(1500);
    result[`app materials ${lang} @390`] = await measure(page);
    await ctx.close();
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `audit-${set}.json`), JSON.stringify(result, null, 2));
});
