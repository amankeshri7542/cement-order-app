import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hinglish } from '@shiv/i18n';
import type { Browser, Page } from '@playwright/test';
import { qrPath, qrSymbol } from '../apps/admin/components/owner/hazri/code-loop';
import { test, expect } from './fixtures';
import {
  apiUrl,
  closeShops,
  database,
  desk,
  linkedPhone,
  liveQr,
  liveWall,
  MAIN,
  ok,
  pairedScreen,
  person,
  prepareShops,
  scan,
  signedInDesk,
  type Who,
} from './staff-world';

// The wall: no login and nobody's session, with a code, a clock and first names.
const db = database();
let boss: Who;
test.setTimeout(120000);
test.beforeAll(async () => {
  await prepareShops(db);
  boss = await person(db, 'OWNER', { name: 'Screen Malik' });
});
test.afterAll(async () => closeShops(db));

declare global {
  interface Window {
    cspProblems?: string[];
    wakeLocks?: number;
  }
}

async function wallPage(browser: Browser, width = 1280, height = 800) {
  const context = await browser.newContext({
    viewport: { width, height },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await watch(page);
  return { context, page };
}
async function watch(page: Page) {
  await page.addInitScript(() => {
    window.cspProblems = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      window.cspProblems!.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
    window.wakeLocks = 0;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          window.wakeLocks! += 1;
          return { release: async () => {} };
        },
      },
    });
    localStorage.setItem('shiv-owner-language', 'hi');
  });
}
const qr = (page: Page) => page.getByRole('img', { name: hinglish['owner.screen.qrLabel'] });
const pathOf = (page: Page) => qr(page).locator('path').getAttribute('d');
const wallAnswer = (page: Page) =>
  page.waitForResponse((response) => response.url().endsWith('/screen/today') && response.ok());
async function pair(page: Page, code: string) {
  await page.getByRole('textbox', { name: hinglish['owner.screen.digits'] }).fill(code);
  const answered = wallAnswer(page);
  await page.getByRole('button', { name: hinglish['owner.screen.pair'] }).click();
  return answered;
}
const newCode = async () =>
  (await ok(boss.token, 'POST', '/admin/screens', { locationId: MAIN })).pairingCode as string;
/** The tab coming back into view makes the wall look at once, instead of waiting for the timer. */
const look = (page: Page) =>
  page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('pairs with six digits, and a wrong code is told plainly', async ({ browser }) => {
  const { context, page } = await wallPage(browser);
  try {
    await page.goto(`${desk}/shop-screen`);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.screen.pairTitle'] }),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: hinglish['owner.loginPhone'] })).toHaveCount(0);
    const digits = page.getByRole('textbox', { name: hinglish['owner.screen.digits'] });
    const button = page.getByRole('button', { name: hinglish['owner.screen.pair'] });
    await digits.fill('12a');
    await expect(digits).toHaveValue('12');
    await expect(button).toBeDisabled();
    await digits.fill('000000');
    await button.click();
    await expect(
      page.getByRole('alert').filter({ hasText: hinglish['error.SCREEN_BAD_CODE'] }),
    ).toBeVisible();
    await pair(page, await newCode());
    await expect(qr(page)).toBeVisible();
    // A code can pair one screen, once.
    const used = await newCode();
    await ok(null, 'POST', '/screen/pair', { code: used });
    expect(
      await page.evaluate(
        async ({ code, api }) => {
          const response = await fetch(`${api}/screen/pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          });
          return response.status;
        },
        { code: used, api: apiUrl },
      ),
    ).toBe(400);
    await page.reload();
    await expect(qr(page)).toBeVisible();
    expect(await page.evaluate(() => window.wakeLocks)).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test('shows the real code, nothing but names and times, and first names only', async ({
  browser,
}) => {
  const late = await person(db, 'STOCK_KEEPER', { name: 'Ramesh Kumar Pandey' });
  const gone = await person(db, 'STOCK_KEEPER', { name: 'Suresh Yadav' });
  // A shift that began a minute after midnight, so this scan is late by anyone's reckoning.
  for (const who of [late, gone])
    await db.staffSchedule.create({
      data: {
        userId: who.id,
        effectiveFrom: '2026-01-01',
        startMinute: 1,
        endMinute: 1439,
        breakMinutes: 0,
        weeklyOffs: [],
        createdById: boss.id,
      },
    });
  const screen = await pairedScreen(boss);
  const latePhone = await linkedPhone(db, late, boss);
  const gonePhone = await linkedPhone(db, gone, boss);
  await scan(latePhone, await liveQr(screen.token));
  await scan(gonePhone, await liveQr(screen.token));
  await scan(gonePhone, await liveQr(screen.token), { kind: 'OUT' });
  const day = await db.attendanceDay.findFirstOrThrow({ where: { userId: late.id } });
  expect(day.lateMinutes).toBeGreaterThanOrEqual(0);

  const { context, page } = await wallPage(browser);
  try {
    await page.goto(`${desk}/shop-screen`);
    const answer = await pair(page, await newCode());
    const wall = await answer.json();
    // What is drawn is exactly the code the server gave.
    expect(await pathOf(page)).toBe(qrPath(wall.qr).path);
    expect(qrSymbol(wall.qr).segments[0]!.mode.id).toBe('Alphanumeric');
    expect(qrSymbol(wall.qr).modules.size).toBeLessThanOrEqual(29);

    await expect(page.getByRole('heading', { name: wall.shopName })).toBeVisible();
    const names = page.locator('li');
    await expect(names.filter({ hasText: 'Ramesh' })).toBeVisible();
    await expect(names.filter({ hasText: 'Suresh' })).toBeVisible();
    const text = await page.locator('main').innerText();
    for (const hidden of ['Kumar', 'Pandey', 'Yadav', late.phone, gone.phone])
      expect(text).not.toContain(hidden);
    // Nothing else, ever: no "late", no status, no role, no count.
    expect(text.toLowerCase()).not.toMatch(/\blate\b|dekhna|stock|manager|malik/);
    // Going home shows both times.
    await expect(names.filter({ hasText: 'Suresh' })).toHaveText(/\d\d:\d\d - \d\d:\d\d/);
  } finally {
    await context.close();
  }
});

test('the code changes on time, with the bar as the only motion, and the CSP blocks nothing', async ({
  browser,
}) => {
  const { context, page } = await wallPage(browser);
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  const sent: { headers: Record<string, string>; at: number }[] = [];
  page.on('request', async (request) => {
    if (request.url().endsWith('/screen/today'))
      sent.push({ headers: await request.allHeaders(), at: Date.now() });
  });
  try {
    await page.goto(`${desk}/shop-screen`);
    const first = await (await pair(page, await newCode())).json();
    const firstPath = await pathOf(page);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(1);

    const next = await (await wallAnswer(page)).json();
    expect(next.qr).not.toBe(first.qr);
    await expect.poll(() => pathOf(page)).not.toBe(firstPath);
    expect(await pathOf(page)).toBe(qrPath(next.qr).path);
    // Asked for just after the old code's life ended, not at a guess.
    const gap = sent.at(-1)!.at - sent.at(-2)!.at;
    expect(gap).toBeGreaterThan(first.msLeft - 1000);
    expect(gap).toBeLessThan(first.msLeft + 3000);

    // The screen's own token goes, and nobody's session.
    for (const { headers } of sent) {
      expect(headers['x-shop-screen']).toBeTruthy();
      expect(headers.cookie).toBeUndefined();
    }
    expect(await page.evaluate(() => window.cspProblems)).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a real QR reader reads what is drawn, on a laptop and shrunk as on a far-off cheap screen', async ({
  browser,
}) => {
  const { readBarcodes, prepareZXingModule } = await import('zxing-wasm/reader');
  const wasm = await readFile(
    join(process.cwd(), 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'),
  );
  prepareZXingModule({
    overrides: {
      wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    },
    fireImmediately: true,
  });
  for (const [width, height] of [
    [1280, 800],
    [360, 740],
  ] as const) {
    const { context, page } = await wallPage(browser, width, height);
    try {
      await page.goto(`${desk}/shop-screen`);
      const wall = await (await pair(page, await newCode())).json();
      await expect(qr(page)).toBeVisible();
      const [found] = await readBarcodes(new Uint8Array(await qr(page).screenshot()), {
        formats: ['QRCode'],
        tryHarder: false,
      });
      expect(found?.text).toBe(wall.qr);
      expect(found?.ecLevel).toBe('M');
    } finally {
      await context.close();
    }
  }
});

test('with no internet it says the code cannot change, keeps showing it, and recovers alone', async ({
  browser,
}) => {
  const { context, page } = await wallPage(browser);
  try {
    await page.goto(`${desk}/shop-screen`);
    await pair(page, await newCode());
    await expect(qr(page)).toBeVisible();
    const before = await pathOf(page);
    await context.setOffline(true);
    const band = page.getByText(hinglish['owner.screen.offline']);
    await expect(band).toBeVisible();
    await expect(qr(page)).toBeVisible();
    expect(await pathOf(page)).toBe(before);
    // The band takes its height from the code, so the whole code stays on screen.
    const box = await qr(page).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(800);
    // Still paired: being offline is not being turned off.
    expect(await page.evaluate(() => localStorage.getItem('shiv-shop-screen'))).toBeTruthy();
    await context.setOffline(false);
    await expect(band).toHaveCount(0);

    // The server down with the line up reads the same.
    await page.route('**/screen/today', (route) => route.abort());
    await look(page);
    await expect(band).toBeVisible();
    await page.unroute('**/screen/today');
    await look(page);
    await expect(band).toHaveCount(0);
    // A server error too: it never unpairs on anything but being told to.
    await page.route('**/screen/today', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await look(page);
    await expect(band).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('shiv-shop-screen'))).toBeTruthy();
    await page.unroute('**/screen/today');
  } finally {
    await context.close();
  }
});

test('turned off from the desk, it asks to be paired again, clearly, and can be', async ({
  browser,
}) => {
  const { context, page } = await wallPage(browser);
  try {
    await page.goto(`${desk}/shop-screen`);
    const code = await newCode();
    await pair(page, code);
    await expect(qr(page)).toBeVisible();
    const row = await db.shopScreen.findFirstOrThrow({
      where: { locationId: MAIN, status: 'ACTIVE', kind: 'SCREEN' },
      orderBy: { lastSeenAt: 'desc' },
    });
    await ok(boss.token, 'POST', `/admin/screens/${row.id}/revoke`, {});
    await look(page);
    await expect(
      page.getByRole('alert').filter({ hasText: hinglish['owner.screen.gone'] }),
    ).toBeVisible();
    await expect(qr(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('shiv-shop-screen'))).toBeNull();
    await pair(page, await newCode());
    await expect(qr(page)).toBeVisible();
    await expect(page.getByText(hinglish['owner.screen.gone'])).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a token someone made up gets nothing, and the page asks to pair', async ({ browser }) => {
  const { context, page } = await wallPage(browser);
  try {
    await page.addInitScript(() => localStorage.setItem('shiv-shop-screen', 'made-up-token'));
    await page.goto(`${desk}/shop-screen`);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.screen.pairTitle'] }),
    ).toBeVisible();
    await expect(page.getByText(hinglish['owner.screen.gone'])).toBeVisible();
    await expect(qr(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('someone signed in on the same browser lends the screen nothing', async ({ browser }) => {
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await watch(page);
    const seen = page.waitForRequest((request) => request.url().endsWith('/screen/pair'));
    await page.goto(`${desk}/shop-screen`);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.screen.pairTitle'] }),
    ).toBeVisible();
    const code = await newCode();
    const answer = pair(page, code);
    expect((await (await seen).allHeaders()).cookie).toBeUndefined();
    const today = await (await answer).request().allHeaders();
    expect(today.cookie).toBeUndefined();
    expect(today['x-shop-screen']).toBeTruthy();
  } finally {
    await context.close();
  }
});

test('says so when hazri has not started at this shop', async ({ browser }) => {
  await db.location.update({ where: { id: MAIN }, data: { attendanceOn: false } });
  const { context, page } = await wallPage(browser);
  try {
    await page.goto(`${desk}/shop-screen`);
    await pair(page, await newCode());
    await expect(page.getByText(hinglish['owner.screen.notStarted'])).toBeVisible();
    // The code still shows, because linking a new phone needs it before hazri starts.
    await expect(qr(page)).toBeVisible();
  } finally {
    await context.close();
    await db.location.update({ where: { id: MAIN }, data: { attendanceOn: true } });
  }
});

for (const [label, width, height] of [
  ['a phone', 360, 740],
  ['a cheap screen', 1024, 600],
  ['a phone on its side', 740, 360],
] as const)
  test(`fits ${label}, with a code a camera can read`, async ({ browser }) => {
    const { context, page } = await wallPage(browser, width, height);
    try {
      await page.goto(`${desk}/shop-screen`);
      await pair(page, await newCode());
      await expect(qr(page)).toBeVisible();
      const box = await qr(page).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(Math.min(width, height) * 0.72);
      expect(box!.height).toBeCloseTo(box!.width, 0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });

test('the wall the API serves has first names only, whoever asks', async () => {
  const screen = await pairedScreen(boss);
  const wall = await liveWall(screen.token);
  for (const entry of wall.people) expect(entry.name).not.toContain(' ');
});
