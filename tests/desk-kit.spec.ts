import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { en, hi } from '@shiv/i18n';
import { test, expect, deskLanguage } from './fixtures';

// Plan v4 B3a: the kit, part 1, in a real browser. /kit shows every part with sample data. Each
// part renders in both themes with no serious axe issue; the page works at every size from 320 to
// 2560 px and at 200% text; and the DataTable stays smooth with 10,000 rows.
const desk = 'http://localhost:3001';
test.use({ actionTimeout: 15000 });
test.describe.configure({ mode: 'serial' });
// The kit speaks Hinglish here, the desk's default; the last test switches language.
test.beforeEach(async ({ context }) => deskLanguage(context, 'hinglish'));

async function open(page: Page, query = '') {
  await page.goto(`${desk}/kit${query}`);
  await expect(page.getByRole('heading', { name: 'DataTable' })).toBeVisible();
}

for (const theme of ['light', 'dark'] as const)
  test(`every kit part passes axe in ${theme}`, async ({ context, page }) => {
    await context.addCookies([{ name: 'shiv_theme', value: theme, url: desk }]);
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Open the parts that only show on use: a combobox list, a row menu and a chosen row.
    await page.getByRole('combobox', { name: 'Combobox' }).fill('1');
    await expect(page.getByRole('listbox', { name: 'Combobox' })).toBeVisible();
    await page.getByRole('checkbox', { name: /^Nirmaan Cement 1 chuno$/ }).check();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const serious = result.violations
      .filter((row) => row.impact === 'serious' || row.impact === 'critical')
      .map(({ id, nodes }) => ({ id, targets: nodes.slice(0, 3).map((node) => node.target) }));
    expect(serious).toEqual([]);
  });

const sizes: [number, number][] = [
  [320, 720],
  [360, 780],
  [390, 844],
  [600, 900],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
  [844, 390],
];

/** Sideways scroll, and controls a thumb cannot hit below 1024 px. */
async function sizeProblems(page: Page, width: number) {
  return page.evaluate((wide) => {
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > window.innerWidth + 1)
      found.push(`page scrolls sideways: ${root.scrollWidth} > ${window.innerWidth}`);
    if (wide < 1024) {
      const targets = document.querySelectorAll<HTMLElement>(
        'main button, main select, main input:not([type="checkbox"]):not([type="radio"]):not([type="date"]), main [role="switch"], main a[href]',
      );
      for (const target of targets) {
        const box = target.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        // Inside the ledger table a laptop row is 36 px; below 1024 px every control is 48 px.
        if (box.height < 47.5)
          found.push(
            `small target: ${target.tagName} "${(target.textContent ?? target.getAttribute('aria-label') ?? '').trim().slice(0, 30)}" ${Math.round(box.height)}px`,
          );
      }
    }
    return found;
  }, width);
}

test('every size from 320 to 2560 px works, and again at 200% text', async ({ page }) => {
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await open(page);
    expect(await sizeProblems(page, width), `${width}×${height}`).toEqual([]);
  }
  for (const [width, height] of [
    [360, 780],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await open(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(sideways, `${width} at 200%`).toBeLessThanOrEqual(1);
  }
});

test('10,000 rows stay smooth: few rows drawn, quick frames, and End reaches the last', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${desk}/kit?rows=10000`);
  // Ungrouped, so the order is plain and the last row is the 10,000th.
  await page.getByRole('switch', { name: 'Group' }).click();
  const table = page.getByRole('table', { name: 'Sample stock' });
  await expect(table).toHaveAttribute('aria-rowcount', '10001');
  const drawn = await table.locator('tbody tr[data-row]').count();
  expect(drawn).toBeGreaterThan(5);
  expect(drawn).toBeLessThan(150);
  // Scroll the table from top to bottom in steps and time every frame on the way.
  const frames = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>('[class*="tableScroll"]')!;
    const gaps: number[] = [];
    let last = performance.now();
    let running = true;
    const tick = (now: number) => {
      gaps.push(now - last);
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const end = scroller.scrollHeight;
    for (let top = 0; top < end; top += end / 60) {
      scroller.scrollTop = top;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
    running = false;
    gaps.sort((a, b) => a - b);
    return {
      p95: gaps[Math.floor(gaps.length * 0.95)]!,
      worst: gaps.at(-1)!,
      count: gaps.length,
      rowsNow: document.querySelectorAll('tbody tr[data-row]').length,
    };
  });
  expect(frames.count).toBeGreaterThan(30);
  expect(frames.p95, JSON.stringify(frames)).toBeLessThan(50);
  expect(frames.rowsNow).toBeLessThan(150);
  // Keyboard: End goes to the 10,000th row, drawing it first.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[class*="tableScroll"]')!.scrollTop = 0;
  });
  const first = table.locator('tbody tr[data-row="0"]');
  await first.focus();
  await page.keyboard.press('End');
  const last = table.locator('tbody tr[data-row="9999"]');
  await expect(last).toBeFocused();
  await expect(last).toContainText('10000');
  await expect(last).toBeInViewport();
  // The total row adds up all 10,000, and the Due tile is the same figure.
  const rupees = (text: string) => Number(text.replace(/[^\d.]/g, ''));
  const footerDue = await table.locator('tfoot td').filter({ hasText: '₹' }).last().innerText();
  const tileDue = (await page.getByRole('button', { name: /^Due ₹/ }).innerText()).split('\n')[1]!;
  expect(Math.round(rupees(footerDue))).toBe(rupees(tileDue));
});

test('the table in a real browser: keyboard, selection, menu, sort and grouping', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  const table = page.getByRole('table', { name: 'Sample stock' });
  // Grouped: a group header with its count, and a subtotal under the double rule.
  await expect(table.getByRole('button', { name: /^Cement chhupao$/ })).toContainText('12 line');
  const row = table.locator('tbody tr[data-row="0"]');
  await row.focus();
  await page.keyboard.press('ArrowDown');
  await expect(table.locator('tbody tr[data-row="1"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('opened')).toHaveText('Sthir Cement 2');
  await page.keyboard.press('x');
  await expect(table.locator('tbody tr[data-row="1"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('1 chune')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bulk 1' })).toBeVisible();
  // The row menu opens on its button, moves with arrows and closes with Escape.
  const menuButton = table.getByRole('button', { name: 'Nirmaan Cement 1 ke aur kaam' });
  await menuButton.click();
  await expect(page.getByRole('menuitem', { name: 'Open' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Remove' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  // Sort asks "the server" (the page) and the header says how it is sorted.
  await page.getByRole('switch', { name: 'Group' }).click();
  await table.getByRole('button', { name: 'Stock se lagao' }).click();
  await expect(table.locator('thead th').nth(3)).toHaveAttribute('aria-sort', 'descending');
  // The header stays in view while the table scrolls under it.
  const head = table.locator('thead th').nth(1);
  const before = await head.boundingBox();
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[class*="tableScroll"]')!.scrollTop = 400;
  });
  const after = await head.boundingBox();
  expect(after?.y).toBeCloseTo(before!.y, 0);
  // A KPI tile is its filter, and the table follows.
  await page.getByRole('button', { name: /^Low stock/ }).click();
  await expect(page.getByRole('button', { name: /^Low stock/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const shown = await table.locator('tbody tr[data-row]').count();
  const lowChip = await page.getByRole('button', { name: /^Low \d/ }).innerText();
  expect(String(shown)).toBe(lowChip.replace(/\D/g, ''));
  // "/" puts the cursor in the search.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeFocused();
});

test('on a phone the table becomes two-line rows with 48 px targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const list = page.getByRole('list', { name: 'Sample stock' });
  await expect(list).toBeVisible();
  await expect(page.getByRole('table', { name: 'Sample stock' })).toHaveCount(0);
  const heights = await list
    .locator('li[data-row]')
    .evaluateAll((rows) => rows.slice(0, 10).map((row) => row.getBoundingClientRect().height));
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(47.5);
  await expect(list.locator('li[data-row]').first()).toContainText('Nirmaan Cement 1');
});

test('the kit speaks the page language', async ({ context, page }) => {
  await deskLanguage(context, 'hi');
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  const table = page.getByRole('table', { name: 'Sample stock' });
  await expect(table.locator('tfoot')).toContainText(hi['kit.table.total']!);
  await expect(page.getByText(hi['kit.stamp.due']!).first()).toBeVisible();
  await deskLanguage(context, 'en');
  await open(page);
  await expect(page.getByRole('table', { name: 'Sample stock' }).locator('tfoot')).toContainText(
    en['kit.table.total'],
  );
});
