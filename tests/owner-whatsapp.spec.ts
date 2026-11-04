import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Browser, Page } from '@playwright/test';
import { hi } from '@shiv/i18n';
import type { StaffRole } from '@shiv/shared';
import { test, expect } from './fixtures';

// The silent-reading screen, as each role sees it. The API's own refusals are in whatsapp.test.ts.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
let counter = 0;
const freshPhone = () => `8${String(Date.now()).slice(-8)}${counter++ % 10}`;
test.use({ serviceWorkers: 'block' });
test.afterEach(async () => {
  await db.waReaderRun.deleteMany({ where: { reader: 'e2e-sample' } });
  await db.waMessage.deleteMany({ where: { wamid: { startsWith: 'e2e-' } } });
  await db.waThread.deleteMany({ where: { contactKey: { startsWith: '+918' } } });
});
test.afterAll(() => db.$disconnect());

async function staff(role: StaffRole) {
  const digits = freshPhone();
  const user = await db.user.create({
    data: { phone: `+91${digits}`, name: `Test ${role} ${digits.slice(-4)}`, role: 'ADMIN' },
  });
  await db.staffMembership.create({
    data: {
      userId: user.id,
      role,
      locationId: ['OWNER', 'ACCOUNTANT', 'TECH_OPERATOR'].includes(role) ? null : 'loc_main',
      grantedById: 'browser-fixture',
    },
  });
  return digits;
}
async function signedIn(browser: Browser, role: StaffRole) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('shiv-owner-language', 'hi'));
  await page.goto(`${desk}/more`);
  await page.getByRole('textbox', { name: hi['owner.loginPhone'] }).fill(await staff(role));
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: hi['owner.sendCode'] }).click();
  await page
    .getByRole('textbox', { name: hi['owner.code'], exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: hi['owner.signIn'] }).click();
  await expect(page.getByRole('heading', { name: hi['owner.more'], exact: true })).toBeVisible();
  return { context, page };
}
const menuLink = (page: Page) =>
  page.getByRole('link', { name: hi['owner.whatsappReading'], exact: true });

/** A reading as the worker would leave it. */
async function sampleReading(words: string) {
  const thread = await db.waThread.create({
    data: {
      contactKey: `+91${freshPhone()}`,
      phone: `+91${freshPhone()}`,
      profileName: '<img src=x onerror=alert(1)>',
    },
  });
  const message = await db.waMessage.create({
    data: {
      wamid: `e2e-${randomUUID()}`,
      threadId: thread.id,
      direction: 'IN',
      type: 'text',
      text: words,
      state: 'READ',
      sentAt: new Date(),
    },
  });
  return db.waReaderRun.create({
    data: {
      threadId: thread.id,
      messageIds: [message.id],
      reader: 'e2e-sample',
      intent: 'ORDER',
      band: 'GREEN',
      wouldReply: 'DRAFT+ASK_DAY',
      output: {
        intent: 'ORDER',
        language: 'hinglish',
        lines: [
          {
            rawText: '50 bori',
            productId: null,
            productName: 'UltraTech Super',
            quantity: 50,
            unitWord: 'bori',
            evidence: '50 bori',
            method: 'EXACT',
            candidates: 1,
          },
        ],
        placeText: 'sipara',
        fulfilment: 'DELIVERY',
        dayKind: 'UNSPECIFIED',
        deliveryDate: null,
        timeWish: '',
        paymentWords: '',
        forWhom: '',
        flags: [],
        band: 'GREEN',
      },
    },
  });
}

test('an owner checks a reading, tries the reader, and keeps a family number out', async ({
  browser,
}) => {
  const words = `sample ${randomUUID().slice(0, 6)} <b>bori</b> https://example.test`;
  const run = await sampleReading(words);
  const { context, page } = await signedIn(browser, 'OWNER');
  try {
    const errors: string[] = [];
    // WebKit reports a fetch cut short by leaving a page as an access-control error.
    page.on('pageerror', (error) => {
      if (!/access control checks|Load failed|Failed to fetch/.test(error.message))
        errors.push(error.message);
    });
    await menuLink(page).click();
    await expect(
      page.getByRole('heading', { name: hi['owner.whatsappReading'], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(hi['owner.wa.intro'])).toBeVisible();
    await expect(page.getByText(hi['owner.wa.modeOff'])).toBeVisible();
    await expect(page.getByText(hi['owner.wa.gateNotYet'], { exact: true })).toBeVisible();

    // Their words show as plain text beside what was understood, never as a link or markup.
    const card = page.locator('article').filter({ hasText: words });
    await expect(card).toBeVisible();
    await expect(card.locator('b, img, a')).toHaveCount(0);
    await expect(card.locator('li').filter({ hasText: '50 bori UltraTech Super' })).toBeVisible();
    await expect(card.getByText(hi['owner.wa.band.GREEN'], { exact: true })).toBeVisible();
    await expect(card.getByText(/Yeh abhi pakka nahi hai/)).toBeVisible();

    // Marking it takes it off the list and counts towards the gate.
    await card
      .getByRole('button', { name: hi['owner.wa.review.WRONG_LINES'], exact: true })
      .click();
    await expect(card).toHaveCount(0);
    await expect
      .poll(() =>
        db.waReaderRun.findUniqueOrThrow({ where: { id: run.id } }).then((row) => row.review),
      )
      .toBe('WRONG_LINES');

    // Trying the reader shows the same thing, and keeps nothing.
    const before = await db.waMessage.count();
    await page
      .getByRole('textbox', { name: hi['owner.wa.tryLabel'], exact: true })
      .fill('stock hai na? 500 bori');
    await page.getByRole('button', { name: hi['owner.wa.tryGo'], exact: true }).click();
    await expect(
      page.getByText(hi['owner.wa.intent.STOCK_OR_TIME_QUESTION'], { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Stock, samay, udhaar/)).toBeVisible();
    expect(await db.waMessage.count()).toBe(before);

    // A family number goes on the list, and can come off it.
    const family = freshPhone();
    await page.getByRole('textbox', { name: hi['owner.wa.phone'], exact: true }).fill(family);
    await page
      .getByRole('textbox', { name: hi['owner.wa.nameOptional'], exact: true })
      .fill('Ghar');
    await page
      .locator('section')
      .filter({ hasText: hi['owner.wa.numbersHelp'] })
      .getByRole('button', { name: hi['owner.wa.markOff'], exact: true })
      .click();
    const row = page.locator('div').filter({ hasText: /^Ghar/ }).last();
    await expect(row).toBeVisible();
    await expect
      .poll(() =>
        db.waThread.findUnique({ where: { phone: `+91${family}` } }).then((t) => t?.aiMode),
      )
      .toBe('OFF');
    await row.getByRole('button', { name: hi['owner.wa.readAgain'], exact: true }).click();
    await expect
      .poll(() =>
        db.waThread.findUnique({ where: { phone: `+91${family}` } }).then((t) => t?.aiMode),
      )
      .toBe('AUTO');

    // A number can be stopped from its own card, for numbers that cannot be typed.
    const other = `sample ${randomUUID().slice(0, 6)} bori`;
    const second = await sampleReading(other);
    await page.reload();
    const secondCard = page.locator('article').filter({ hasText: other });
    await secondCard.getByRole('button', { name: hi['owner.wa.markOff'], exact: true }).click();
    await expect(secondCard).toHaveCount(0);
    await expect
      .poll(() =>
        db.waThread.findUniqueOrThrow({ where: { id: second.threadId } }).then((t) => t.aiMode),
      )
      .toBe('OFF');

    // The switch for everything.
    await page.getByRole('button', { name: hi['owner.wa.pause'], exact: true }).click();
    await expect(page.getByText(hi['owner.wa.paused'], { exact: true })).toBeVisible();
    await page.getByRole('button', { name: hi['owner.wa.resume'], exact: true }).click();
    await expect(page.getByText(hi['owner.wa.paused'], { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('the technical operator sees the connection, and no words', async ({ browser }) => {
  const words = `secret ${randomUUID().slice(0, 6)} bori`;
  await sampleReading(words);
  const { context, page } = await signedIn(browser, 'TECH_OPERATOR');
  try {
    await menuLink(page).click();
    await expect(page.getByText(hi['owner.wa.connection'], { exact: true })).toBeVisible();
    await expect(page.getByText(hi['owner.wa.todayCounts'].split(':')[0]!)).toBeVisible();
    await expect(page.getByText(words)).toHaveCount(0);
    await expect(page.getByText(hi['owner.wa.readings'], { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: hi['owner.wa.pause'], exact: true })).toHaveCount(
      0,
    );
  } finally {
    await context.close();
  }
});

test('other staff do not see this screen, even by typing its address', async ({ browser }) => {
  const words = `secret ${randomUUID().slice(0, 6)} bori`;
  await sampleReading(words);
  for (const role of ['MANAGER', 'CASHIER'] as const) {
    const { context, page } = await signedIn(browser, role);
    try {
      await expect(menuLink(page)).toHaveCount(0);
      await page.goto(`${desk}/more?view=whatsapp`);
      await expect(page.getByRole('heading', { name: hi['owner.notYourPage'] })).toBeVisible();
      await expect(page.getByText(words)).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});
