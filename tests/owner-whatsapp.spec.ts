import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Browser, Page } from '@playwright/test';
import { hinglish } from '@shiv/i18n';
import type { StaffRole } from '@shiv/shared';
import { test, expect, deskLanguage } from './fixtures';

// The silent-reading screen, as each role sees it. The API's own refusals are in whatsapp.test.ts.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
let counter = 0;
const freshPhone = () => `8${String(Date.now()).slice(-8)}${counter++ % 10}`;
test.use({ serviceWorkers: 'block' });
test.afterEach(async () => {
  await db.waReply.deleteMany({ where: { thread: { contactKey: { startsWith: '+918' } } } });
  await db.waDraft.deleteMany({
    where: { OR: [{ source: 'PASTE' }, { thread: { contactKey: { startsWith: '+918' } } }] },
  });
  await db.waLoadSize.deleteMany({ where: { label: { startsWith: 'E2E' } } });
  await db.waCallTally.deleteMany();
  await db.waSettings.updateMany({ data: { testNumbers: [], replyStage: 'OFF' } });
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
  await deskLanguage(page.context(), 'hinglish');
  await page.goto(`${desk}/more`);
  await page.getByRole('textbox', { name: hinglish['owner.loginPhone'] }).fill(await staff(role));
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: hinglish['owner.sendCode'] }).click();
  await page
    .getByRole('textbox', { name: hinglish['owner.code'], exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: hinglish['owner.signIn'] }).click();
  await expect(
    page.getByRole('heading', { name: hinglish['owner.shell.menu'], exact: true }),
  ).toBeVisible();
  return { context, page };
}
const menuLink = (page: Page) =>
  page.getByRole('link', { name: hinglish['owner.whatsappReading'], exact: true });

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
      page.getByRole('heading', { name: hinglish['owner.whatsappReading'], exact: true }),
    ).toBeVisible();
    await expect(page.getByText(hinglish['owner.wa.intro'])).toBeVisible();
    await expect(page.getByText(hinglish['owner.wa.modeOff'])).toBeVisible();
    await expect(page.getByText(hinglish['owner.wa.gateNotYet'], { exact: true })).toBeVisible();

    // Their words show as plain text beside what was understood, never as a link or markup.
    const card = page.locator('article').filter({ hasText: words });
    await expect(card).toBeVisible();
    await expect(card.locator('b, img, a')).toHaveCount(0);
    await expect(card.locator('li').filter({ hasText: '50 bori UltraTech Super' })).toBeVisible();
    await expect(card.getByText(hinglish['owner.wa.band.GREEN'], { exact: true })).toBeVisible();
    await expect(card.getByText(/Yeh abhi pakka nahi hai/)).toBeVisible();

    // Marking it takes it off the list and counts towards the gate.
    await card
      .getByRole('button', { name: hinglish['owner.wa.review.WRONG_LINES'], exact: true })
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
      .getByRole('textbox', { name: hinglish['owner.wa.tryLabel'], exact: true })
      .fill('stock hai na? 500 bori');
    await page.getByRole('button', { name: hinglish['owner.wa.tryGo'], exact: true }).click();
    await expect(
      page.getByText(hinglish['owner.wa.intent.STOCK_OR_TIME_QUESTION'], { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Stock, samay, udhaar/)).toBeVisible();
    expect(await db.waMessage.count()).toBe(before);

    // A family number goes on the list, and can come off it.
    const family = freshPhone();
    const numbers = page.locator('section').filter({ hasText: hinglish['owner.wa.numbersHelp'] });
    await numbers
      .getByRole('textbox', { name: hinglish['owner.wa.phone'], exact: true })
      .fill(family);
    await numbers
      .getByRole('textbox', { name: hinglish['owner.wa.nameOptional'], exact: true })
      .fill('Ghar');
    await numbers.getByRole('button', { name: hinglish['owner.wa.markOff'], exact: true }).click();
    const row = page.locator('div').filter({ hasText: /^Ghar/ }).last();
    await expect(row).toBeVisible();
    await expect
      .poll(() =>
        db.waThread.findUnique({ where: { phone: `+91${family}` } }).then((t) => t?.aiMode),
      )
      .toBe('OFF');
    await row.getByRole('button', { name: hinglish['owner.wa.readAgain'], exact: true }).click();
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
    await secondCard
      .getByRole('button', { name: hinglish['owner.wa.markOff'], exact: true })
      .click();
    await expect(secondCard).toHaveCount(0);
    await expect
      .poll(() =>
        db.waThread.findUniqueOrThrow({ where: { id: second.threadId } }).then((t) => t.aiMode),
      )
      .toBe('OFF');

    // The switch for everything.
    await page.getByRole('button', { name: hinglish['owner.wa.pause'], exact: true }).click();
    await expect(page.getByText(hinglish['owner.wa.paused'], { exact: true })).toBeVisible();
    await page.getByRole('button', { name: hinglish['owner.wa.resume'], exact: true }).click();
    await expect(page.getByText(hinglish['owner.wa.paused'], { exact: true })).toHaveCount(0);
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
    await expect(page.getByText(hinglish['owner.wa.connection'], { exact: true })).toBeVisible();
    await expect(
      page.getByText(new RegExp(`^${hinglish['owner.wa.todayCounts'].split(':')[0]!}:`)),
    ).toBeVisible();
    await expect(page.getByText(words)).toHaveCount(0);
    await expect(page.getByText(hinglish['owner.wa.readings'], { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: hinglish['owner.wa.pause'], exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('an owner pastes an order, picks a family size, says who pays, and a tap makes the order', async ({
  browser,
}) => {
  const product = await db.product.findFirstOrThrow({ where: { name: 'UltraTech Super' } });
  await db.stockLevel.upsert({
    where: { productId_locationId: { productId: product.id, locationId: 'loc_main' } },
    update: { quantity: 500 },
    create: { productId: product.id, locationId: 'loc_main', quantity: 500 },
  });
  const { context, page } = await signedIn(browser, 'OWNER');
  try {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      if (!/access control checks|Load failed|Failed to fetch/.test(error.message))
        errors.push(error.message);
    });
    await page.goto(`${desk}/whatsapp`);

    // The family's list comes first: a trolley means nothing without it.
    const sizes = page.locator('section').filter({ hasText: hinglish['owner.wa.sizesHelp'] });
    await sizes
      .getByLabel(hinglish['owner.wa.product'], { exact: true })
      .selectOption({ label: product.name });
    await sizes.getByRole('textbox', { name: hinglish['owner.wa.sizeName'] }).fill('E2E chhoti');
    await sizes.getByRole('spinbutton', { name: hinglish['owner.wa.sizeHolds'] }).fill('5');
    await sizes.getByRole('button', { name: hinglish['owner.wa.add'], exact: true }).click();
    await expect(sizes.getByText(/E2E chhoti = 5/)).toBeVisible();

    // A script in the paste box stays plain words, and nothing it says runs.
    const pasteBox = page.locator('section').filter({ hasText: hinglish['owner.wa.pasteHelp'] });
    const pasteWords = pasteBox.getByRole('textbox', {
      name: hinglish['owner.wa.pasteLabel'],
      exact: true,
    });
    await pasteWords.fill('<script>window.pwned=1</script><b>loud</b>');
    await pasteBox
      .getByRole('textbox', { name: hinglish['owner.wa.nameOptional'] })
      .fill('Script wala');
    await pasteBox.getByRole('button', { name: hinglish['owner.wa.pasteGo'], exact: true }).click();
    const script = page.locator('article').filter({ hasText: 'Script wala' });
    await expect(
      script.getByText('<script>window.pwned=1</script>', { exact: false }),
    ).toBeVisible();
    await expect(script.locator('script, b, a')).toHaveCount(0);
    expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
    await expect(pasteWords).toHaveValue('');

    const buyer = freshPhone();
    await pasteWords.fill('2 trolley ultratech');
    await pasteBox.getByRole('textbox', { name: hinglish['owner.wa.pastePhone'] }).fill(buyer);
    await pasteBox
      .getByRole('textbox', { name: hinglish['owner.wa.nameOptional'] })
      .fill('Raju tractor');
    await pasteBox.getByRole('button', { name: hinglish['owner.wa.pasteGo'], exact: true }).click();

    const card = page.locator('article').filter({ hasText: 'Raju tractor' });
    await expect(card).toBeVisible();
    await expect(card.getByText(hinglish['owner.wa.pasted'], { exact: true })).toBeVisible();

    // The reader left the quantity empty: only a person picks what a trolley holds.
    await expect(card.getByText(/"trolley"/)).toBeVisible();
    await expect(card.getByRole('spinbutton', { name: hinglish['owner.wa.quantity'] })).toHaveValue(
      '',
    );
    // Other items may share the brand, so the reader can leave this for a person too.
    await card
      .getByLabel(hinglish['owner.wa.product'], { exact: true })
      .selectOption({ label: product.name });
    await card
      .getByLabel(hinglish['owner.wa.sizePick'], { exact: true })
      .selectOption({ label: 'E2E chhoti (5)' });
    await card.getByRole('spinbutton', { name: hinglish['owner.wa.sizeCount'] }).fill('2');
    await expect(card.getByRole('spinbutton', { name: hinglish['owner.wa.quantity'] })).toHaveValue(
      '10',
    );

    // Who sent it and who pays are separate, and nothing on the card is decided until now.
    await expect(card.getByText(hinglish['owner.wa.whoOrdered'], { exact: true })).toBeVisible();
    await expect(card.getByText(hinglish['owner.wa.whoPays'], { exact: true })).toBeVisible();
    await card
      .getByRole('button', { name: hinglish['owner.wa.pay.PAID_NOW'], exact: true })
      .click();
    await card
      .getByRole('button', { name: hinglish['owner.wa.fulfil.PICKUP'], exact: true })
      .click();
    await card.getByRole('button', { name: hinglish['owner.wa.dayTomorrow'], exact: true }).click();
    await card.getByRole('button', { name: hinglish['owner.wa.confirmCard'], exact: true }).click();
    await expect(card).toHaveCount(0);

    const draft = await db.waDraft.findFirstOrThrow({
      where: { source: 'PASTE', orderedByPhone: `+91${buyer}` },
    });
    expect(draft.status).toBe('CONFIRMED');
    const order = await db.order.findUniqueOrThrow({
      where: { id: draft.orderId! },
      include: { items: true },
    });
    expect(order.source).toBe('WHATSAPP');
    expect(order.items[0]!.quantity).toBe(10);
    expect(order.notes).toContain('abhi mila');
    expect(await db.waReply.count({ where: { draftId: draft.id } })).toBe(0);

    // It stays on the record as finished.
    await page.getByRole('button', { name: hinglish['owner.wa.showClosed'], exact: true }).click();
    await expect(
      page.locator('article').filter({ hasText: hinglish['owner.wa.closed.CONFIRMED'] }).first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('the daily list holds what Papa answered, and it still takes a tap', async ({ browser }) => {
  const phone = `+91${freshPhone()}`;
  const thread = await db.waThread.create({
    data: { contactKey: phone, phone, savedName: 'Papa wala' },
  });
  const draft = await db.waDraft.create({
    data: {
      threadId: thread.id,
      source: 'WHATSAPP',
      orderedByName: 'Papa wala',
      orderedByPhone: phone,
      originalText: 'sample 50 bori',
      lines: [],
      band: 'AMBER',
      papaRepliedAt: new Date(),
    },
  });
  const { context, page } = await signedIn(browser, 'OWNER');
  try {
    await page.goto(`${desk}/whatsapp`);
    await expect(
      page.getByRole('heading', { name: hinglish['owner.wa.papaList'], exact: true }),
    ).toBeVisible();
    const card = page.locator('article').filter({ hasText: 'Papa wala' });
    await expect(card.getByText(hinglish['owner.wa.papaReplied'], { exact: true })).toBeVisible();
    await expect(
      card.getByRole('button', { name: hinglish['owner.wa.makeOrder'], exact: true }),
    ).toBeVisible();
    // With no lines yet, the server says what is missing in plain words, and makes nothing.
    await card.getByRole('button', { name: hinglish['owner.wa.makeOrder'], exact: true }).click();
    await expect(card.getByRole('alert')).toBeVisible();
    expect((await db.waDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('OPEN');
  } finally {
    await context.close();
  }
});

test('an owner keeps the stage, test numbers, quiet rules and the tally; the stage cannot move yet', async ({
  browser,
}) => {
  const { context, page } = await signedIn(browser, 'OWNER');
  try {
    await page.goto(`${desk}/whatsapp`);
    const stage = page.locator('section').filter({ hasText: hinglish['owner.wa.replies'] });
    await expect(stage.getByText(hinglish['owner.wa.stage.OFF'], { exact: true })).toBeVisible();
    await expect(stage.getByText(hinglish['owner.wa.check.GATE'], { exact: false })).toBeVisible();
    await expect(
      stage.getByText(hinglish['owner.wa.check.SECOND_NUMBER'], { exact: false }),
    ).toBeVisible();
    const up = stage.getByRole('button', {
      name: hinglish['owner.wa.moveUp'].replace('{stage}', hinglish['owner.wa.stage.TEST_NUMBERS']),
    });
    await expect(up).toBeDisabled();

    const number = freshPhone();
    await stage.getByRole('textbox', { name: hinglish['owner.wa.testNumberAdd'] }).fill(number);
    await stage.getByRole('button', { name: hinglish['owner.wa.add'], exact: true }).click();
    await expect(stage.getByText(`+91${number}`)).toBeVisible();
    await expect
      .poll(async () => (await db.waSettings.findFirstOrThrow()).testNumbers)
      .toEqual([`+91${number}`]);
    await stage.getByRole('button', { name: hinglish['owner.wa.remove'], exact: true }).click();
    await expect(stage.getByText(`+91${number}`)).toHaveCount(0);

    await stage.getByRole('spinbutton', { name: hinglish['owner.wa.quietMinutes'] }).fill('30');
    await stage.getByRole('button', { name: hinglish['owner.wa.saveRules'], exact: true }).click();
    await expect.poll(async () => (await db.waSettings.findFirstOrThrow()).quietMinutes).toBe(30);
    // The server holds to 30 to 60 whatever the box says.
    await stage.getByRole('spinbutton', { name: hinglish['owner.wa.quietMinutes'] }).fill('5');
    await stage.getByRole('button', { name: hinglish['owner.wa.saveRules'], exact: true }).click();
    await expect(stage.getByRole('alert')).toBeVisible();
    expect((await db.waSettings.findFirstOrThrow()).quietMinutes).toBe(30);
    await db.waSettings.updateMany({ data: { quietMinutes: 45 } });

    const tally = page.locator('section').filter({ hasText: hinglish['owner.wa.tallyHelp'] });
    const first = tally
      .locator('div')
      .filter({ hasText: hinglish['owner.wa.tallyPeriod.BASELINE'] })
      .first();
    await first.getByRole('spinbutton', { name: hinglish['owner.wa.tallyCalls'] }).fill('18');
    await first.getByRole('spinbutton', { name: hinglish['owner.wa.tallyOrders'] }).fill('30');
    await first.getByRole('button', { name: hinglish['owner.wa.tallySave'], exact: true }).click();
    await expect(
      tally.getByText(hinglish['owner.wa.tallyPerTen'].replace('{count}', '6')),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('managers and cashiers work cards at their shop, and see no readings or stage', async ({
  browser,
}) => {
  const words = `secret ${randomUUID().slice(0, 6)} bori`;
  await sampleReading(words);
  for (const role of ['MANAGER', 'CASHIER'] as const) {
    const { context, page } = await signedIn(browser, role);
    try {
      await expect(menuLink(page)).toBeVisible();
      await page.goto(`${desk}/whatsapp`);
      await expect(page.getByText(hinglish['owner.wa.pasteHelp'])).toBeVisible();
      await expect(page.getByText(words)).toHaveCount(0);
      await expect(page.getByText(hinglish['owner.wa.readings'], { exact: true })).toHaveCount(0);
      await expect(page.getByText(hinglish['owner.wa.replies'], { exact: true })).toHaveCount(0);
      await expect(page.getByText(hinglish['owner.wa.sizesHelp'])).toHaveCount(0);
      await expect(page.getByText(hinglish['owner.wa.tallyHelp'])).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});

test('other staff do not see this screen, even by typing its address', async ({ browser }) => {
  const words = `secret ${randomUUID().slice(0, 6)} bori`;
  await sampleReading(words);
  for (const role of ['STOCK_KEEPER', 'ACCOUNTANT'] as const) {
    const { context, page } = await signedIn(browser, role);
    try {
      await expect(menuLink(page)).toHaveCount(0);
      await page.goto(`${desk}/more?view=whatsapp`);
      await expect(
        page.getByRole('heading', { name: hinglish['owner.notYourPage'] }),
      ).toBeVisible();
      await expect(page.getByText(words)).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});
