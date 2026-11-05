import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hi } from '@shiv/i18n';
import { istToday, punchMessage, staffNoticeVersion, type StaffRole } from '@shiv/shared';
import sharp from 'sharp';
import { addPerson, clearShopWork, tokenFor } from '../apps/api/test/staff-helper';
import { expect } from './fixtures';

// The real API and database, as the staff desk specs meet them: people with sessions, phones with
// real P-256 keys, shop screens, and scans signed the way the Android Keystore signs them.
export const desk = process.env.STAFF_DESK_URL ?? 'http://localhost:3001';
export const apiUrl = process.env.STAFF_API_URL ?? 'http://localhost:4010/api/v1';
export const MAIN = 'loc_main';
export const SECOND = 'loc_staff_b';
export const SHOP = { lat: 25.6, lng: 85.1 };

export const database = () => new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
export type Db = ReturnType<typeof database>;

/** A catalogue sentence with its gaps filled, as the screen shows it. */
export function say(key: keyof typeof hi, params: Record<string, string | number> = {}) {
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    hi[key] as string,
  );
}

export async function prepareShops(db: Db) {
  await clearShopWork(db);
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true, attendanceOn: true, ...SHOP, lat: 26.1, lng: 85.4, radiusM: 100 },
    create: {
      id: SECOND,
      firmId: 'firm_main',
      slug: 'staff-b',
      name: 'Doosri dukaan',
      attendanceOn: true,
      lat: 26.1,
      lng: 85.4,
    },
  });
  await db.location.update({
    where: { id: MAIN },
    data: { attendanceOn: true, ...SHOP, radiusM: 100, graceMinutes: 10 },
  });
}
export async function closeShops(db: Db) {
  await db.location.update({ where: { id: SECOND }, data: { active: false } });
  await db.$disconnect();
}

let made = 0;
export type Who = { id: string; phone: string; digits: string; name: string; token: string };
const allShopRoles: StaffRole[] = ['OWNER', 'ACCOUNTANT', 'TECH_OPERATOR'];
export async function person(
  db: Db,
  role: StaffRole,
  options: { shops?: string[]; name?: string } = {},
): Promise<Who> {
  made++;
  const stamp = Date.now();
  const id = `w${stamp.toString(36)}${made}`;
  const digits = `7${String(stamp).slice(-8)}${made % 10}`;
  const phone = `+91${digits}`;
  await addPerson(db, {
    id,
    phone,
    role,
    ...(allShopRoles.includes(role) ? {} : { shops: options.shops ?? [MAIN] }),
  });
  const name = options.name ?? `${role} ${String(stamp).slice(-5)}${made}`;
  await db.user.update({ where: { id }, data: { name } });
  return { id, phone, digits, name, token: tokenFor(id) };
}

type Answer = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
export async function call(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* A file, or an empty answer: the text is the answer. */
  }
  return { status: response.status, body: parsed };
}
export async function ok(token: string | null, method: string, path: string, body?: unknown) {
  const answer = await call(token, method, path, body);
  if (answer.status >= 300)
    throw new Error(`${method} ${path} gave ${answer.status}: ${JSON.stringify(answer.body)}`);
  return answer.body;
}

export function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    sign: (message: string) => sign('sha256', Buffer.from(message), privateKey).toString('base64'),
  };
}
export type Key = ReturnType<typeof makeKey>;
export type Phone = { key: Key; token: string; requestId: string; who: Who };

/** Asks to link a phone, and leaves the request waiting for someone to decide. */
export async function askToLink(
  db: Db,
  who: Who,
  extra: { model?: string; reason?: string } = {},
): Promise<Phone> {
  await db.otpChallenge.deleteMany({ where: { phone: who.phone } });
  await db.authRateLimit.deleteMany({});
  const key = makeKey();
  const { devCode } = await ok(null, 'POST', '/auth/otp/request', { phone: who.phone });
  const verified = await ok(null, 'POST', '/staff-auth/verify', {
    phone: who.phone,
    code: devCode,
    publicKey: key.publicKey,
    signature: key.sign(`link-verify|${who.phone}|${devCode}`),
    model: extra.model ?? 'Test phone',
    sdk: 34,
    ...(extra.reason ? { reason: extra.reason } : {}),
  });
  const request = await db.deviceLinkRequest.findFirstOrThrow({
    where: { userId: who.id, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  return { key, token: verified.accessToken, requestId: request.id, who };
}
/** A phone someone has agreed to, whose person has read the notice. It can scan. */
export async function linkedPhone(db: Db, who: Who, decider: Who, extra = {}) {
  const phone = await askToLink(db, who, extra);
  await ok(decider.token, 'POST', `/admin/device-requests/${phone.requestId}/decide`, {
    decision: 'APPROVE',
  });
  await ok(phone.token, 'POST', '/staff/me/notice', { version: staffNoticeVersion });
  return phone;
}

export async function pairedScreen(decider: Who, locationId = MAIN) {
  const made_ = await ok(decider.token, 'POST', '/admin/screens', { locationId });
  const { token } = await ok(null, 'POST', '/screen/pair', { code: made_.pairingCode });
  return { id: made_.id as string, token: token as string };
}
export async function liveWall(screenToken: string) {
  const answer = await call(null, 'GET', '/screen/today', undefined, {
    'x-shop-screen': screenToken,
  });
  if (answer.status >= 300) throw new Error(`The wall gave ${answer.status}`);
  return answer.body as { qr: string; shopName: string; people: { name: string }[] };
}
export const liveQr = async (screenToken: string) => (await liveWall(screenToken)).qr;

export async function scan(phone: Phone, qr: string, extra: Record<string, unknown> = {}) {
  const body = {
    captureId: randomUUID(),
    qr,
    kind: 'IN',
    lat: SHOP.lat,
    lng: SHOP.lng,
    accuracyM: 15,
    mocked: false,
    location: 'OK',
    ...extra,
  };
  return ok(phone.token, 'POST', '/attendance/punch', {
    ...body,
    signature: phone.key.sign(punchMessage(body as never)),
  });
}
export async function photoOf(phone: Phone, kind: string, locationId = MAIN) {
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
    .png()
    .toBuffer();
  const response = await fetch(
    `${apiUrl}/staff/evidence?kind=${kind}&locationId=${encodeURIComponent(locationId)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${phone.token}`, 'Content-Type': 'image/png' },
      body: bytes,
    },
  );
  if (!response.ok) throw new Error(`Photo refused: ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}

/** Signs in on the desk the way a person does: their number, then the code. */
export async function signIn(
  browser: Browser,
  who: Who,
  options: BrowserContextOptions & { width?: number; path?: string } = {},
) {
  const { width = 1280, path = '/more', ...rest } = options;
  // Linking a phone just now, or a second desk, must not trip the wait between codes.
  const cleaner = database();
  await cleaner.otpChallenge.deleteMany({ where: { phone: who.phone } });
  await cleaner.authRateLimit.deleteMany({});
  await cleaner.$disconnect();
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 780 : 900 },
    serviceWorkers: 'block',
    ...rest,
  });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'hi'));
  await page.goto(`${desk}${path}`);
  await page.getByRole('textbox', { name: hi['owner.loginPhone'] }).fill(who.digits);
  const sent = page.waitForResponse(
    (response) => response.url().endsWith('/auth/otp/request') && response.status() === 201,
  );
  await page.getByRole('button', { name: hi['owner.sendCode'] }).click();
  await page
    .getByRole('textbox', { name: hi['owner.code'], exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: hi['owner.signIn'] }).click();
  return { context, page };
}
export async function signedInDesk(
  browser: Browser,
  who: Who,
  options: BrowserContextOptions & { width?: number; path?: string } = {},
) {
  const signed = await signIn(browser, who, options);
  await expect(
    signed.page.getByRole('navigation', { name: hi['owner.desk'], exact: true }),
  ).toBeVisible();
  return signed;
}
export const go = (page: Page, path: string) => page.goto(`${desk}${path}`);
export const tab = (page: Page, key: keyof typeof hi) =>
  page.getByRole('tab', { name: new RegExp(`^${hi[key]}`) });
/** A notice on the desk's toast, and not an error: it is good news that says what happened. */
export const toast = (page: Page, text: string) =>
  page.getByRole('status').filter({ hasText: text });
export const today = () => istToday();
/** A sentence that means "the page does not belong to you", and that the page really is refused. */
export async function refusedPage(page: Page, path: string) {
  await go(page, path);
  await expect(page.getByRole('heading', { name: hi['owner.notYourPage'] })).toBeVisible();
}
