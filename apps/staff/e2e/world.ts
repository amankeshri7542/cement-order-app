import { expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { staffE2E } from '../../../playwright.staff.config';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = staffE2E.database;
process.env.OTP_HASH_SECRET = staffE2E.otpSecret;
process.env.OTP_PROVIDER = 'mock';

// After the environment above, because the server's own helper reads its config from it.
const { qrText } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../api/src/staff/secret') as typeof import('../../api/src/staff/secret');
const helper =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../api/test/staff-helper') as typeof import('../../api/test/staff-helper');
const { addPerson, clearShopWork, tokenFor } = helper;
export { tokenFor };

export const db = new PrismaClient({ datasourceUrl: staffE2E.database });
export const MAIN = 'loc_main';
export const SECOND = 'loc_staffapp_b';
export const SHOP = { lat: 25.6, lng: 85.1 };
export const FAR = { lat: 25.7, lng: 85.2 };

export const numbers = {
  papa: '9000007001',
  chacha: '9000007002',
  manager: '9000007003',
  keeper: '9000007004',
  driver: '9000007005',
  helper: '9000007006',
  cashier: '9000007007',
  keeperb: '9000007008',
  driverb: '9000007009',
} as const;
export type Who = keyof typeof numbers;
const names: Record<Who, string> = {
  papa: 'Test Owner',
  chacha: 'Test Partner',
  manager: 'Test Manager',
  keeper: 'Test Keeper',
  driver: 'Test Driver',
  helper: 'Test Helper',
  cashier: 'Test Cashier',
  keeperb: 'Second Keeper',
  driverb: 'Second Driver',
};

/** Every test starts from a clean shop with the same people. */
export async function resetWorld() {
  await clearShopWork(db as never);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "FinancialMovement", "User", "Category", "Product", "Order", "AuditLog", "AuthRateLimit", "OtpChallenge", "Notification", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true, attendanceOn: true, ...FAR, radiusM: 100, graceMinutes: 10 },
    create: {
      id: SECOND,
      firmId: 'firm_main',
      slug: 'staffapp-b',
      name: 'Second shop',
      attendanceOn: true,
      ...FAR,
    },
  });
  await db.location.update({
    where: { id: MAIN },
    data: { attendanceOn: true, ...SHOP, radiusM: 100, graceMinutes: 10, active: true },
  });
  for (const [id, role, shops] of [
    ['papa', 'OWNER', undefined],
    ['chacha', 'OWNER', undefined],
    ['manager', 'MANAGER', [MAIN]],
    ['keeper', 'STOCK_KEEPER', [MAIN]],
    ['keeperb', 'STOCK_KEEPER', [SECOND]],
    ['driver', 'DRIVER', [MAIN]],
    ['driverb', 'DRIVER', [SECOND]],
    ['helper', 'HELPER', [MAIN]],
    ['cashier', 'CASHIER', [MAIN]],
  ] as const)
    await addPerson(db as never, {
      id,
      role,
      phone: `+91${numbers[id]}`,
      ...(shops ? { shops: [...shops] } : {}),
    });
  for (const id of Object.keys(names) as Who[])
    await db.user.update({ where: { id }, data: { name: names[id] } });
  await addPerson(db as never, { id: 'customer', phone: '+919000007100' });
  await db.category.create({ data: { id: 'cat', name: 'Cement', slug: 'cement' } });
  await db.product.createMany({
    data: [
      { id: 'cement', name: 'Cement', unit: '50 kg bag', pricePaise: 80000, stock: 100 },
      { id: 'sariya', name: 'Sariya 12 mm', unit: 'piece', pricePaise: 50000, stock: 40 },
    ].map((row) => ({
      ...row,
      brand: 'Test',
      categoryId: 'cat',
      type: 'PPC',
      grade: 'PPC',
      minQuantity: 1,
      description: 'Test',
      recommendedUse: 'Test',
      images: [],
    })),
  });
  await db.storeSettings.create({ data: { id: 'store', phone: '+919000007000' } });
}

export const deskHeaders = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
export async function adminPost(who: string, path: string, body: object = {}, method = 'POST') {
  const response = await fetch(`${staffE2E.api}/admin/${path}`, {
    method,
    headers: { ...deskHeaders(who), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
export async function adminGet(who: string, path: string) {
  const response = await fetch(`${staffE2E.api}/admin/${path}`, { headers: deskHeaders(who) });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}
export async function pairScreen(locationId = MAIN) {
  const made = await adminPost('papa', 'screens', { locationId });
  const paired = await fetch(`${staffE2E.api}/screen/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: made.pairingCode }),
  }).then((res) => res.json());
  const screen = await db.shopScreen.findUniqueOrThrow({ where: { id: made.id } });
  return { screen, token: paired.token as string };
}
/** The code on the wall right now, from the server's own route. */
export async function liveQr(token: string) {
  const wall = await fetch(`${staffE2E.api}/screen/today`, {
    headers: { 'x-shop-screen': token },
  }).then((res) => res.json());
  return wall.qr as string;
}
export const oldQr = (screen: { id: string; code: string; epoch: number }, secondsAgo: number) =>
  qrText(screen, Math.floor((Date.now() - secondsAgo * 1000) / 1000 / 20));

// ---- Driving the app ----------------------------------------------------------------------------
export const fixAt = (place: { lat: number; lng: number }, extra: object = {}) => ({
  status: 'OK',
  fix: { ...place, accuracyM: 15, mocked: false, ...extra },
});
export async function setFix(page: Page, state: object) {
  await page.evaluate((value) => {
    (globalThis as never as { __staffFix: unknown }).__staffFix = value;
  }, state);
}
/** A real sign-in, up to the point someone must agree. */
export async function signIn(page: Page, who: Who) {
  await page.goto('/');
  await page.getByTestId('phone-input').fill(numbers[who]);
  await page.getByTestId('number-next').click();
  await page.getByTestId('dev-code').waitFor();
  const shown = (await page.getByTestId('dev-code').textContent()) ?? '';
  const code = shown.replace(/\D/g, '');
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('code-next').click();
}
export async function decide(
  userId: string,
  decision: 'APPROVE' | 'REFUSE' = 'APPROVE',
  by = 'papa',
) {
  const asked = await db.deviceLinkRequest.findFirstOrThrow({
    where: { userId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  await adminPost(by, `device-requests/${asked.id}/decide`, { decision });
}
/** Linked, notice read and approved: the hazri screen, ready to scan. */
export async function linked(page: Page, who: Who) {
  await signIn(page, who);
  await page.getByTestId('yours-ok').click();
  await page.getByTestId('notice-accept').click();
  await page.getByTestId('screen-waiting').waitFor();
  await decide(who, 'APPROVE', who === 'papa' ? 'chacha' : 'papa');
  await page.getByTestId('link-check').click();
  await page.getByTestId('screen-hazri').waitFor();
  await setFix(page, fixAt(SHOP));
}
export async function scan(page: Page, code: string) {
  await page.getByTestId('screen-scan').waitFor();
  await page.waitForFunction(() =>
    Boolean((globalThis as never as { __staffScan?: unknown }).__staffScan),
  );
  await page.evaluate((text) => {
    (globalThis as never as { __staffScan(text: string): void }).__staffScan(text);
  }, code);
}
export const floodTitle = (page: Page) => page.getByTestId('flood-title');

/** The design rules, checked on what is really on screen, for whichever screen is open. */
export async function audit(page: Page, name: string) {
  if (process.env.STAFF_SHOTS)
    await page.screenshot({
      path: `.local/staff-e2e/shots/${name.replace(/[^a-z0-9]+/gi, '-')}.png`,
    });
  const found = await page.evaluate(() => {
    const problems: string[] = [];
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const devanagari = new RegExp('[\\u0900-\\u097F]');
    while (walker.nextNode()) {
      const text = (walker.currentNode.textContent ?? '').trim();
      const parent = walker.currentNode.parentElement;
      if (
        !text ||
        !parent ||
        !visible(parent) ||
        parent.tagName === 'SCRIPT' ||
        parent.tagName === 'STYLE'
      )
        continue;
      if (devanagari.test(text)) problems.push(`Devanagari: ${text}`);
      const size = parseFloat(getComputedStyle(parent).fontSize);
      if (size < 18) problems.push(`Too small (${size}): ${text}`);
      const weight = getComputedStyle(parent).fontWeight;
      if (!['400', '500'].includes(weight)) problems.push(`Weight ${weight}: ${text}`);
    }
    const exempt = /^(language-switch|month-prev|month-next|day-)/;
    let lamps = 0;
    for (const el of document.querySelectorAll('[role="button"], button, [role="tab"]')) {
      if (!visible(el)) continue;
      const id = el.getAttribute('data-testid') ?? '';
      const height = el.getBoundingClientRect().height;
      if (!exempt.test(id) && height < 64) problems.push(`Button ${id} is ${height} tall`);
      if (getComputedStyle(el).backgroundColor === 'rgb(242, 163, 58)') lamps++;
      if (el.getBoundingClientRect().right > window.innerWidth + 1)
        problems.push(`Button ${id} runs off the screen`);
    }
    if (lamps > 1) problems.push(`${lamps} bright buttons`);
    if (document.documentElement.scrollWidth > window.innerWidth + 1)
      problems.push('Wider than the screen');
    return problems;
  });
  expect(found, name).toEqual([]);
}
export { randomUUID };
