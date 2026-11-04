import { PrismaClient } from '@prisma/client';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { hi } from '@shiv/i18n';
import type { StaffRole } from '@shiv/shared';
import { test, expect } from './fixtures';

// The Report, Kisne kya kiya, Settings and System pages as each job sees them. The API refuses all
// of this on its own (see reports-charts.test.ts); this checks the desk says so politely.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const MAIN = 'loc_main';
let counter = 0;
const freshPhone = () => `8${String(Date.now()).slice(-8)}${counter++ % 10}`;
test.use({ serviceWorkers: 'block' });
test.afterAll(() => db.$disconnect());

/** Someone fresh on the staff list, ready to sign in with a code. */
async function staff(role: StaffRole, shops: string[] = [MAIN]) {
  const phone = freshPhone();
  const user = await db.user.create({
    data: { phone: `+91${phone}`, name: `Test ${role} ${phone.slice(-4)}`, role: 'ADMIN' },
  });
  const allShops = ['OWNER', 'ACCOUNTANT', 'TECH_OPERATOR'].includes(role);
  await db.staffMembership.createMany({
    data: (allShops ? [null] : shops).map((locationId) => ({
      userId: user.id,
      locationId,
      role,
      grantedById: 'browser-fixture',
    })),
  });
  return { ...user, digits: phone };
}
async function open(
  browser: Browser,
  width = 390,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'hi'));
  return { context, page };
}
async function signIn(page: Page, digits: string, path: string) {
  await page.goto(`${desk}${path}`);
  await page.getByRole('textbox', { name: hi['owner.loginPhone'] }).fill(digits);
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: hi['owner.sendCode'] }).click();
  await page
    .getByRole('textbox', { name: hi['owner.code'], exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: hi['owner.signIn'] }).click();
  // Leaving before the session is written would land on the sign-in page again.
  await expect(page.getByRole('navigation', { name: hi['owner.desk'], exact: true })).toBeVisible();
}
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });

test('an owner reads the report: ranges, figures, charts, tables and the CSV', async ({
  browser,
}) => {
  const owner = await staff('OWNER');
  const { context, page } = await open(browser, 1280);
  try {
    await signIn(page, owner.digits, '/reports');
    await expect(heading(page, hi['owner.reports.title'])).toBeVisible();
    await expect(page.getByText(hi['owner.reports.subtitle'])).toBeVisible();
    for (const key of ['7', '30', 'month'] as const)
      await expect(
        page.getByRole('button', { name: hi[`owner.reports.range.${key}`], exact: true }),
      ).toBeVisible();
    for (const key of ['moneyIn', 'orders', 'given', 'back'] as const)
      await expect(
        page.getByText(hi[`owner.reports.figure.${key}`], { exact: true }).first(),
      ).toBeVisible();
    await page.getByRole('button', { name: hi['owner.reports.range.7'], exact: true }).click();
    await expect(
      page.getByRole('button', { name: hi['owner.reports.range.7'], exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    const items = page.getByRole('figure').filter({ hasText: hi['owner.reports.items'] });
    await items.getByRole('button', { name: hi['owner.reports.seeTable'] }).click();
    await expect(items.getByRole('table')).toBeVisible();
    await items.getByRole('button', { name: hi['owner.reports.seeChart'] }).click();
    await expect(items.getByRole('table')).toHaveCount(0);

    for (const key of ['moneyByDay', 'sources', 'age', 'confirm'] as const)
      await expect(heading(page, hi[`owner.reports.${key}`])).toBeVisible();
    // The seeded shop may be new, so either the columns or the thin-data note shows.
    const byDay = page.getByRole('figure').filter({ hasText: hi['owner.reports.moneyByDay'] });
    await expect(
      byDay
        .getByText(hi['owner.reports.thin'])
        .or(byDay.getByRole('button', { name: /: ₹/ }))
        .first(),
    ).toBeVisible();

    const file = page.waitForEvent('download');
    await page.getByRole('button', { name: hi['owner.reports.csv'] }).click();
    expect((await file).suggestedFilename()).toMatch(/^shiv-\d{4}-\d{2}-\d{2}-.*\.csv$/);
  } finally {
    await context.close();
  }
});

test('a manager reads the report for their shop and has no shop comparison', async ({
  browser,
}) => {
  const manager = await staff('MANAGER');
  const { context, page } = await open(browser);
  try {
    await signIn(page, manager.digits, '/reports');
    await expect(heading(page, hi['owner.reports.title'])).toBeVisible();
    await expect(heading(page, hi['owner.reports.confirm'])).toBeVisible();
    await expect(heading(page, hi['owner.reports.shops'])).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('the log reads in plain sentences, never event names, and says it cannot be changed', async ({
  browser,
}) => {
  const owner = await staff('OWNER');
  await db.auditLog.create({
    data: { actorId: owner.id, event: 'RATES_REAFFIRMED', entityId: 'rates', details: {} },
  });
  await db.auditLog.create({
    data: { actorId: 'system', event: 'SOMETHING_NEW_LATER', entityId: 'x', details: {} },
  });
  const { context, page } = await open(browser, 1280);
  try {
    await signIn(page, owner.digits, '/activity');
    await expect(heading(page, hi['owner.activity.title'])).toBeVisible();
    await expect(page.getByText(hi['owner.activity.subtitle'])).toBeVisible();
    const table = page.getByRole('table');
    await expect(
      table.getByText(hi['owner.activity.event.RATES_REAFFIRMED']).first(),
    ).toBeVisible();
    await expect(table.getByText(hi['owner.activity.unknown']).first()).toBeVisible();
    await expect(page.getByText('RATES_REAFFIRMED')).toHaveCount(0);
    await expect(page.getByText('SOMETHING_NEW_LATER')).toHaveCount(0);
    await page.getByLabel(hi['owner.activity.filter.person']).selectOption(owner.id);
    await expect(table.getByText(hi['owner.activity.unknown'])).toHaveCount(0);
    await page.getByLabel(hi['owner.activity.filter.day']).fill('2020-01-01');
    await expect(page.getByText(hi['owner.activity.empty'])).toBeVisible();
  } finally {
    await context.close();
  }
});

test('an owner sees every part of settings, and turning the bell off stays off', async ({
  browser,
}) => {
  const owner = await staff('OWNER');
  const { context, page } = await open(browser, 1280);
  try {
    await signIn(page, owner.digits, '/settings');
    for (const key of ['shop', 'zones', 'logins', 'language', 'thisPhone'] as const)
      await expect(heading(page, hi[`owner.settings.${key}`])).toBeVisible();
    await expect(page.getByRole('button', { name: hi['owner.settings.testAlert'] })).toBeVisible();
    const bell = page.getByRole('checkbox', { name: hi['owner.settings.bell'] });
    await bell.uncheck();
    await page.reload();
    await expect(bell).not.toBeChecked();
  } finally {
    await context.close();
  }
});

test('a cashier gets their own settings only, and no shop settings or test alert', async ({
  browser,
}) => {
  const cashier = await staff('CASHIER');
  const { context, page } = await open(browser);
  try {
    await signIn(page, cashier.digits, '/settings');
    for (const key of ['logins', 'language', 'thisPhone'] as const)
      await expect(heading(page, hi[`owner.settings.${key}`])).toBeVisible();
    for (const key of ['shop', 'zones'] as const)
      await expect(heading(page, hi[`owner.settings.${key}`])).toHaveCount(0);
    await expect(page.getByRole('button', { name: hi['owner.settings.testAlert'] })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('the technical operator reads the system page, and it says it changes no money', async ({
  browser,
}) => {
  const tech = await staff('TECH_OPERATOR');
  const { context, page } = await open(browser, 1280);
  try {
    await signIn(page, tech.digits, '/system');
    await expect(heading(page, hi['owner.system.title'])).toBeVisible();
    await expect(page.getByText(hi['owner.system.subtitle'])).toBeVisible();
    for (const key of ['work', 'lanes', 'warnings', 'whatsapp', 'messages'] as const)
      await expect(heading(page, hi[`owner.system.${key}`])).toBeVisible();
  } finally {
    await context.close();
  }
});

test('each job is refused the pages that are not theirs, politely', async ({ browser }) => {
  test.setTimeout(180000);
  const refusals: [StaffRole, string[]][] = [
    ['CASHIER', ['/reports', '/activity', '/system']],
    ['STOCK_KEEPER', ['/reports', '/activity', '/system']],
    ['MANAGER', ['/activity', '/system']],
    ['ACCOUNTANT', ['/system']],
    ['TECH_OPERATOR', ['/reports', '/activity']],
  ];
  for (const [role, paths] of refusals) {
    const person = await staff(role);
    const { context, page } = await open(browser);
    try {
      await signIn(page, person.digits, paths[0]!);
      for (const path of paths) {
        await page.goto(`${desk}${path}`);
        await expect(page.getByText(hi['owner.notYourPage'])).toBeVisible();
      }
    } finally {
      await context.close();
    }
  }
});
