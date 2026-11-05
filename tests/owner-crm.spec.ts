import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Browser, Page } from '@playwright/test';
import { hi } from '@shiv/i18n';
import { addDays, istToday, money, type StaffRole } from '@shiv/shared';
import { test, expect } from './fixtures';

// Calls, reminders, the opening sheet and the reports on the real desk, as each role that uses them.
// Every person and number here is made up for the test. The API refuses all of this on its own (see
// apps/api/test/crm.test.ts); these journeys check each person's screen.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const MAIN = 'loc_main';
const SECOND = 'loc_crm_browser_b';
const shots = process.env.CRM_SHOTS;
let counter = 0;
const freshPhone = () => `9${String(Date.now()).slice(-8)}${counter++ % 10}`;
test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

async function shot(page: Page, name: string) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
}

async function staff(role: StaffRole, shops: string[] = [MAIN]) {
  const phone = freshPhone();
  const user = await db.user.create({
    data: { phone: `+91${phone}`, name: `Sample ${role} ${phone.slice(-4)}`, role: 'ADMIN' },
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
async function customer(name: string) {
  const phone = freshPhone();
  const user = await db.user.create({
    data: { phone: `+91${phone}`, name: `Sample ${name} ${phone.slice(-4)}`, area: 'Sample Nagar' },
  });
  return { ...user, digits: phone };
}
async function open(browser: Browser, width: number, height: number) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.route('https://wa.me/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'WhatsApp would open here.' }),
  );
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'hi'));
  return { context, page };
}
const laptop = (browser: Browser) => open(browser, 1440, 900);
const phone = (browser: Browser) => open(browser, 390, 844);
async function signIn(page: Page, digits: string, path = '/today') {
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
}
/** A signed opening without clicking through the sheet, for the journeys that start after it. */
async function signedOpening(customerId: string, paise: number, locationId = MAIN) {
  const entry = await db.customerLedgerEntry.create({
    data: {
      customerId,
      kind: 'OPENING_BALANCE',
      amountPaise: paise,
      balanceAfterPaise: paise,
      actorId: 'browser-fixture',
      occurredAt: new Date(`${istToday()}T00:00:00+05:30`),
      idempotencyKey: 'opening:firm_main',
      requestHash: 'browser-fixture',
      note: 'Opening balance',
      locationId,
    },
  });
  await db.user.update({ where: { id: customerId }, data: { khataBalancePaise: paise } });
  await db.khataSignoff.create({
    data: {
      customerId,
      firmId: 'firm_main',
      locationId,
      asOf: istToday(),
      paperPaise: paise,
      chosenPaise: paise,
      enteredById: 'browser-fixture',
      approvedById: 'browser-fixture',
      ledgerEntryId: entry.id,
      requestHash: 'browser-fixture',
    },
  });
}
async function call(
  customerId: string,
  locationId: string,
  extra: Partial<{
    dueOn: string;
    kind: 'PAYMENT' | 'CALLBACK';
    promisedPaise: number;
    note: string;
  }> = {},
) {
  return db.followUp.create({
    data: {
      customerId,
      locationId,
      dueOn: istToday(),
      kind: 'PAYMENT',
      createdById: 'browser-fixture',
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      ...extra,
    },
  });
}
const sold = async (customerId: string, daysAgo: number, locationId = MAIN) =>
  db.order.create({
    data: {
      number: `SC-CRM-${randomUUID().slice(0, 12)}`,
      userId: customerId,
      idempotencyKey: randomUUID(),
      status: 'DELIVERED',
      source: 'PHONE',
      address: { area: 'Sample Nagar', phone: '' },
      deliveryDate: istToday(),
      notes: '',
      subtotalPaise: 41000,
      deliveryFeePaise: 0,
      totalPaise: 41000,
      locationId,
      createdAt: new Date(Date.now() - daysAgo * 86400000),
      items: {
        create: {
          productId: 'test-ultratech',
          name: 'UltraTech Super',
          unit: '50 kg bag',
          quantity: 1,
          pricePaise: 41000,
          listPricePaise: 41000,
          priceVersion: 1,
          lineTotalPaise: 41000,
        },
      },
    },
  });

test.beforeAll(async () => {
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true },
    create: { id: SECOND, firmId: 'firm_main', slug: 'crm-browser-b', name: 'Sample second shop' },
  });
});
test.afterAll(async () => {
  await db.location.updateMany({ where: { id: SECOND }, data: { active: false } });
  await db.$disconnect();
});

test('an owner signs an opening, reminds on WhatsApp, writes a call and sees it all on one page', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const papa = await staff('OWNER');
  const ramesh = await customer('Ramesh');
  const { context, page } = await laptop(browser);
  await signIn(page, papa.digits, '/udhaar/opening');

  // Before sign-off the customer's balance goes nowhere.
  await page.getByRole('searchbox', { name: hi['owner.crm.opening.search'] }).fill(ramesh.name);
  await expect(page.getByRole('link', { name: ramesh.name })).toBeVisible();
  await page.getByRole('textbox', { name: hi['owner.crm.opening.paper'] }).fill('12500');
  await page.getByRole('button', { name: hi['owner.crm.opening.write'] }).click();
  await expect(page.getByText(hi['owner.crm.opening.written'], { exact: true })).toBeVisible();
  await shot(page, 'opening-sheet-laptop');
  expect(await db.khataSignoff.count({ where: { customerId: ramesh.id } })).toBe(0);
  await page.getByRole('checkbox', { name: /pakka karo/ }).check();
  await page.getByRole('button', { name: /grahak pakke karo/ }).click();
  await expect(page.getByText(/1 pakke ho gaye/)).toBeVisible();
  expect(await db.khataSignoff.count({ where: { customerId: ramesh.id } })).toBe(1);
  expect((await db.user.findUniqueOrThrow({ where: { id: ramesh.id } })).khataBalancePaise).toBe(
    1250000,
  );

  // The customer page: facts on the left, everything that happened on the right.
  await page.goto(`${desk}/customers/${ramesh.id}`);
  await expect(page.getByRole('heading', { name: ramesh.name, exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: hi['owner.crm.tab.everything'] })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText(/Pakka, /).first()).toBeVisible();
  await expect(page.getByText(hi['status.OPENING_BALANCE'] ?? 'Opening').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: hi['owner.crm.rates.title'] })).toBeVisible();

  // One tap: a person's WhatsApp opens with the words filled in. Nothing is sent from here.
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: hi['owner.crm.remind'], exact: true }).click();
  const whatsapp = await opened;
  const url = new URL(whatsapp.url());
  expect(url.hostname).toBe('wa.me');
  expect(url.pathname).toBe(`/${ramesh.phone.slice(1)}`);
  const words = url.searchParams.get('text')!;
  expect(words).toContain(ramesh.name);
  expect(words).toContain('₹12,500');
  await whatsapp.close();
  await expect(page.getByText(hi['owner.crm.row.reminder'], { exact: true }).first()).toBeVisible();
  expect(await db.outboundMessage.count({ where: { userId: ramesh.id } })).toBe(0);
  expect(
    await db.customerContact.count({ where: { customerId: ramesh.id, kind: 'REMINDER' } }),
  ).toBe(1);

  // A second tap the same day needs a person to say they mean it.
  await page.getByRole('button', { name: hi['owner.crm.remind'], exact: true }).click();
  const again = page.getByRole('dialog', { name: hi['owner.crm.remindedTodayTitle'] });
  await expect(again).toBeVisible();
  await again.getByRole('button', { name: hi['owner.crm.notNow'] }).click();
  await expect(again).toBeHidden();

  // A follow-up with a promise.
  await page.getByRole('button', { name: hi['owner.crm.newCall'], exact: true }).click();
  const sheet = page.getByRole('dialog', { name: hi['owner.crm.newCall'] });
  await sheet.getByRole('button', { name: hi['owner.crm.kind.payment'], exact: true }).click();
  await sheet.getByRole('button', { name: hi['owner.crm.when.today'], exact: true }).click();
  await sheet.getByRole('textbox', { name: hi['owner.crm.promised'] }).fill('5000');
  await sheet.getByRole('textbox', { name: hi['owner.crm.note'] }).fill('Beta dega');
  await shot(page, 'follow-up-sheet-laptop');
  await sheet.getByRole('button', { name: hi['owner.crm.writeCall'] }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Beta dega').first()).toBeVisible();
  await shot(page, 'customer-page-laptop');

  // It is on Aaj ke call, and it can be moved with a reason, then done.
  await page.goto(`${desk}/calls`);
  await expect(page.getByRole('heading', { name: hi['owner.crm.todayCalls'] })).toBeVisible();
  const card = page.locator('article').filter({ hasText: ramesh.name });
  await expect(card).toBeVisible();
  await expect(card.getByText(hi['owner.crm.promise.open'], { exact: true })).toBeVisible();
  await shot(page, 'calls-laptop');
  await card.getByRole('button', { name: hi['owner.crm.later'], exact: true }).click();
  const later = page.getByRole('dialog', { name: hi['owner.crm.later'] });
  await expect(later.getByRole('button', { name: hi['owner.crm.moveCall'] })).toBeDisabled();
  await later.getByRole('textbox', { name: hi['owner.crm.laterWhy'] }).fill('Bahar gaye hain');
  await later.getByRole('button', { name: hi['owner.crm.moveCall'] }).click();
  await expect(later).toBeHidden();
  await expect(page.locator('article').filter({ hasText: ramesh.name })).toHaveCount(0);
  await page.getByRole('tab', { name: hi['owner.crm.tab.upcoming'] }).click();
  const moved = page.locator('article').filter({ hasText: ramesh.name });
  await expect(moved.getByText(/Bahar gaye hain/)).toBeVisible();
  await moved.getByRole('button', { name: hi['owner.crm.markDone'] }).click();
  await expect(moved).toHaveCount(0);
  await page.getByRole('tab', { name: hi['owner.crm.tab.done'] }).click();
  await expect(page.locator('article').filter({ hasText: ramesh.name })).toBeVisible();
  await context.close();
});

test('when paper and Tally differ an owner can choose, and must say why', async ({ browser }) => {
  test.setTimeout(120000);
  const papa = await staff('OWNER');
  const differs = await customer('Differs');
  await db.khataOpeningDraft.create({
    data: {
      customerId: differs.id,
      locationId: MAIN,
      asOf: istToday(),
      paperPaise: 700000,
      tallyPaise: 650000n,
      tallyAsOf: new Date(),
      enteredById: papa.id,
    },
  });
  const { context, page } = await laptop(browser);
  await signIn(page, papa.digits, '/udhaar/opening');
  await page.getByRole('searchbox', { name: hi['owner.crm.opening.search'] }).fill(differs.name);
  await expect(page.getByText(hi['owner.crm.opening.differs'])).toBeVisible();
  await page.getByRole('checkbox', { name: hi['owner.crm.opening.useTally'] }).check();
  await page.getByRole('checkbox', { name: /pakka karo/ }).check();
  await page.getByRole('button', { name: /grahak pakke karo/ }).click();
  // No reason yet: the row is refused, and nothing is signed.
  await expect(page.getByRole('list', { name: hi['owner.crm.opening.refused'] })).toBeVisible();
  expect(await db.khataSignoff.count({ where: { customerId: differs.id } })).toBe(0);
  await page
    .getByRole('textbox', { name: hi['owner.crm.opening.why'] })
    .fill('Accountant ne dekha');
  await page.getByRole('checkbox', { name: /pakka karo/ }).check();
  await page.getByRole('button', { name: /grahak pakke karo/ }).click();
  await expect(page.getByText(/1 pakke ho gaye/)).toBeVisible();
  expect(
    await db.khataSignoff.findFirstOrThrow({ where: { customerId: differs.id } }),
  ).toMatchObject({
    paperPaise: 700000,
    chosenPaise: 650000,
    reason: 'Accountant ne dekha',
  });
  await context.close();
});

test('the reports read right, at a laptop and on a phone', async ({ browser }) => {
  test.setTimeout(300000);
  const suresh = await customer('Suresh');
  await signedOpening(suresh.id, 880000);
  const quietOne = await customer('Mohan');
  for (const days of [50, 60, 70]) await sold(quietOne.id, days);
  await db.user.update({
    where: { id: quietOne.id },
    data: { lastOrderAt: new Date(Date.now() - 50 * 86400000) },
  });
  await db.financialMovement.create({
    data: {
      kind: 'COLLECTION',
      channel: 'CASH',
      amountPaise: 150000,
      locationId: MAIN,
      actorId: 'browser-fixture',
    },
  });
  for (const [name, open_] of [
    ['laptop', laptop],
    ['phone', phone],
  ] as const) {
    // A second code for one number so soon is refused by the resend limit, as it should be.
    const papa = await staff('OWNER');
    const { context, page } = await open_(browser);
    await signIn(page, papa.digits, '/reports/hisaab');
    await expect(page.getByRole('heading', { name: hi['owner.crm.report.shaam'] })).toBeVisible();
    await expect(page.getByText(hi['owner.crm.shaam.total'], { exact: true })).toBeVisible();
    await shot(page, `shaam-${name}`);
    await page.getByRole('tab', { name: hi['owner.crm.report.vasooli'] }).click();
    await expect(page.getByRole('link', { name: suresh.name })).toBeVisible();
    await expect(page.getByText(money(880000)).first()).toBeVisible();
    await shot(page, `vasooli-${name}`);
    await page.getByRole('tab', { name: hi['owner.crm.report.chup'] }).click();
    const quietCard = page.locator('article').filter({ hasText: quietOne.name });
    await expect(quietCard).toBeVisible();
    await expect(quietCard.getByText(/din se chup/)).toBeVisible();
    await shot(page, `chup-${name}`);
    await page.getByRole('tab', { name: hi['owner.crm.report.mahine'] }).click();
    await expect(page.getByRole('heading', { name: hi['owner.crm.mahine.sales'] })).toBeVisible();
    await shot(page, `mahine-${name}`);
    await page.getByRole('tab', { name: hi['owner.crm.report.suppliers'] }).click();
    await expect(page.getByText(hi['owner.crm.tally.notConnected']).first()).toBeVisible();
    await page.getByRole('tab', { name: hi['owner.crm.report.vasooli'] }).click();
    // The tab changes the page's address first, so wait for the list before asking for its sheet.
    await expect(page.getByRole('link', { name: suresh.name })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: hi['owner.reports.csv'] }).click();
    expect((await download).suggestedFilename()).toMatch(/^shiv-vasooli-.*\.csv$/);
    await context.close();
  }
});

test('a cashier does the shop’s calls, and owner reports are not theirs', async ({ browser }) => {
  test.setTimeout(120000);
  const cashier = await staff('CASHIER');
  const mine = await customer('Geeta');
  const elsewhere = await customer('Hari');
  await signedOpening(mine.id, 90000);
  await signedOpening(elsewhere.id, 70000, SECOND);
  await call(mine.id, MAIN, { promisedPaise: 20000, dueOn: addDays(istToday(), -2) });
  await call(elsewhere.id, SECOND, { note: 'Doosri dukaan ki call' });
  const { context, page } = await phone(browser);
  await signIn(page, cashier.digits, '/calls');
  const card = page.locator('article').filter({ hasText: mine.name });
  await expect(card).toBeVisible();
  await expect(card.getByText(hi['owner.crm.promise.broken'], { exact: true })).toBeVisible();
  await expect(card.getByText(mine.phone)).toBeVisible();
  await expect(
    card.getByRole('button', { name: hi['owner.crm.remind'], exact: true }),
  ).toBeVisible();
  await expect(card.getByRole('button', { name: hi['owner.crm.giveTo'] })).toHaveCount(0);
  await expect(page.getByText('Doosri dukaan ki call')).toHaveCount(0);
  await shot(page, 'calls-phone-cashier');
  await page.goto(`${desk}/reports/hisaab`);
  await expect(page.getByRole('heading', { name: hi['owner.notYourPage'] })).toBeVisible();
  await page.goto(`${desk}/udhaar/opening`);
  await expect(page.getByRole('heading', { name: hi['owner.notYourPage'] })).toBeVisible();
  await page.goto(`${desk}/customers/${mine.id}`);
  await expect(page.getByRole('heading', { name: mine.name, exact: true })).toBeVisible();
  await expect(page.getByText(/Tally/)).toHaveCount(0);
  await shot(page, 'customer-page-phone-cashier');
  await context.close();
});

test('the accountant reads without numbers, types the sheet and signs nothing', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const accountant = await staff('ACCOUNTANT');
  const owes = await customer('Lata');
  await signedOpening(owes.id, 40000);
  await call(owes.id, MAIN);
  const waiting = await customer('Pending');
  await db.khataOpeningDraft.create({
    data: {
      customerId: waiting.id,
      locationId: MAIN,
      asOf: istToday(),
      paperPaise: 12300,
      enteredById: accountant.id,
    },
  });
  const { context, page } = await laptop(browser);
  await signIn(page, accountant.digits, '/reports/hisaab?tab=vasooli');
  const row = page.locator('tr').filter({ hasText: owes.name });
  await expect(row).toBeVisible();
  await expect(row.getByText(`+91XXXXXXX${owes.digits.slice(-3)}`)).toBeVisible();
  await expect(page.getByText(owes.phone)).toHaveCount(0);
  await expect(row.getByRole('button', { name: hi['owner.crm.remind'], exact: true })).toHaveCount(
    0,
  );
  await page.goto(`${desk}/calls`);
  const card = page.locator('article').filter({ hasText: owes.name });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button')).toHaveCount(0);
  await page.goto(`${desk}/udhaar/opening`);
  await page.getByRole('searchbox', { name: hi['owner.crm.opening.search'] }).fill(waiting.name);
  await expect(page.getByRole('link', { name: waiting.name })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await context.close();
});

test('a manager runs their own shop only, and can hand a call to their own people', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const manager = await staff('MANAGER');
  const helper = await staff('CASHIER');
  const other = await staff('CASHIER', [SECOND]);
  const ours = await customer('Ours');
  const theirs = await customer('Theirs');
  await signedOpening(ours.id, 50000);
  await signedOpening(theirs.id, 60000, SECOND);
  await call(ours.id, MAIN);
  await call(theirs.id, SECOND);
  const { context, page } = await phone(browser);
  await signIn(page, manager.digits, '/calls');
  const card = page.locator('article').filter({ hasText: ours.name });
  await expect(card).toBeVisible();
  await expect(page.locator('article').filter({ hasText: theirs.name })).toHaveCount(0);
  await card.getByRole('button', { name: hi['owner.crm.giveTo'] }).click();
  const give = page.getByRole('dialog', { name: hi['owner.crm.giveTo'] });
  await expect(give.getByRole('button', { name: helper.name })).toBeVisible();
  await expect(give.getByRole('button', { name: other.name })).toHaveCount(0);
  await give.getByRole('button', { name: helper.name }).click();
  await expect(give).toBeHidden();
  await expect(card.getByText(helper.name)).toBeVisible();
  await page.goto(`${desk}/reports/hisaab?tab=vasooli`);
  await expect(page.getByRole('link', { name: ours.name })).toBeVisible();
  await expect(page.getByRole('link', { name: theirs.name })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: hi['owner.crm.report.suppliers'] })).toHaveCount(0);
  await context.close();
});
