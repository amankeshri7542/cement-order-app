import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hi } from '@shiv/i18n';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  call,
  closeShops,
  database,
  go,
  MAIN,
  ok,
  person,
  prepareShops,
  refusedPage,
  say,
  signedInDesk,
  today,
  toast,
  type Who,
} from './staff-world';

// Fixed monthly pay, with attendance beside it as a fact. Real API, real database.
const db = database();
const MONTH = '2026-09';
const MONTH_NAME = 'September 2026';
let boss: Who;
test.setTimeout(150000);
test.beforeEach(async () => {
  await prepareShops(db);
  boss = await person(db, 'OWNER', { name: 'Salary Malik' });
});
test.afterAll(async () => closeShops(db));

const setTerms = (who: Who, amountPaise = 1_500_000) =>
  ok(boss.token, 'PUT', `/admin/salary/terms/${who.id}`, {
    effectiveFrom: '2026-01-01',
    amountPaise,
  });
const card = (page: Page, name: string) => page.locator('article').filter({ hasText: name });
const openMonth = async (page: Page, month = MONTH) => {
  await go(page, '/salary');
  await page.getByRole('combobox', { name: hi['owner.salary.month'] }).selectOption(month);
};
const lockMonth = (month = MONTH) =>
  ok(boss.token, 'POST', `/admin/salary/runs/${month}/lock`, { confirm: true });

test('someone with no pay is listed with a way to set it, and nothing is guessed', async ({
  browser,
}) => {
  const who = await person(db, 'STOCK_KEEPER', { name: 'Bina Salary' });
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await openMonth(page);
    const none = page.getByRole('region', { name: hi['owner.salary.noTerms'] });
    await expect(none.getByText(who.name)).toBeVisible();
    await expect(card(page, who.name)).toHaveCount(0);
    await page
      .getByRole('button', { name: say('owner.salary.terms.for', { name: who.name }) })
      .click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('textbox', { name: hi['owner.salary.terms.from'] })).toHaveValue(
      `${MONTH}-01`,
    );
    await sheet.getByRole('textbox', { name: hi['owner.salary.terms.amount'] }).fill('sau');
    await expect(sheet.getByRole('button', { name: hi['owner.save'], exact: true })).toBeDisabled();
    await sheet.getByRole('textbox', { name: hi['owner.salary.terms.amount'] }).fill('15000');
    await sheet.getByRole('button', { name: hi['owner.save'], exact: true }).click();
    await expect(toast(page, say('owner.salary.terms.saved', { name: who.name }))).toBeVisible();
    await expect(card(page, who.name).getByText('₹15,000.00').first()).toBeVisible();
    await expect(none.getByText(who.name)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('the month: fixed pay, attendance as a fact that moves nothing, additions and deductions with reasons', async ({
  browser,
}) => {
  const who = await person(db, 'STOCK_KEEPER', { name: 'Mahine Wala' });
  await setTerms(who);
  await db.attendanceDay.createMany({
    data: [
      {
        userId: who.id,
        day: `${MONTH}-02`,
        status: 'PRESENT',
        firstInAt: new Date(`${MONTH}-02T04:00:00Z`),
        lateMinutes: 25,
        flags: ['NO_OUT'],
        locationIds: [MAIN],
      },
      {
        userId: who.id,
        day: `${MONTH}-03`,
        status: 'PRESENT',
        firstInAt: new Date(`${MONTH}-03T04:00:00Z`),
        lateMinutes: 0,
        flags: [],
        locationIds: [MAIN],
      },
    ],
  });
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await openMonth(page);
    const row = card(page, who.name);
    // Two days only, one of them late, and the pay is still the whole month.
    await expect(row.getByText(hi['owner.salary.facts.title'])).toBeVisible();
    await expect(row.getByText(new RegExp('2 din aaye, 1 din late'))).toBeVisible();
    await expect(row.locator('div', { hasText: hi['owner.salary.line.net'] }).last()).toContainText(
      '₹15,000.00',
    );
    await expect(page.getByText(hi['owner.salary.factsMoveNothing'])).toBeVisible();

    const adjust = async (kind: 'ADDITION' | 'DEDUCTION', rupees: string, reason: string) => {
      await page
        .getByRole('button', { name: say('owner.salary.adjust.for', { name: who.name }) })
        .click();
      const sheet = page.getByRole('dialog');
      await sheet
        .getByRole('combobox', { name: hi['owner.salary.adjust.kind'] })
        .selectOption(kind);
      await sheet.getByRole('textbox', { name: hi['owner.salary.amount'] }).fill(rupees);
      await sheet.getByRole('textbox', { name: hi['owner.salary.reason'] }).fill(reason);
      await sheet.getByRole('button', { name: hi['owner.save'], exact: true }).click();
      return sheet;
    };
    await adjust('ADDITION', '1000', 'Diwali ka bonus');
    await expect(row.getByText(`${hi['owner.salary.line.add']}: Diwali ka bonus`)).toBeVisible();
    await expect(row.locator('div', { hasText: hi['owner.salary.line.net'] }).last()).toContainText(
      '₹16,000.00',
    );

    // More than half the month is refused, and the sheet says so.
    const refused = await adjust('DEDUCTION', '9000', 'Bahut zyada');
    await expect(refused.getByText(hi['error.DEDUCTIONS_OVER_LIMIT'])).toBeVisible();
    await refused.getByRole('button', { name: hi['owner.close'] }).click();

    await adjust('DEDUCTION', '333.33', 'Maal ka nuksan');
    await expect(row.getByText(`${hi['owner.salary.line.take']}: Maal ka nuksan`)).toBeVisible();
    // Round off has its own line, and the net is whole rupees.
    await expect(row.getByText(hi['owner.salary.line.roundOff'])).toBeVisible();
    await expect(row.locator('div', { hasText: hi['owner.salary.line.net'] }).last()).toContainText(
      '₹15,667.00',
    );

    // Taking a line back keeps both.
    await row.getByRole('button', { name: hi['owner.salary.takeBack.button'] }).first().click();
    const back = page.getByRole('dialog');
    await back.getByRole('textbox', { name: hi['owner.salary.reason'] }).fill('Galti se joda');
    await back.getByRole('button', { name: hi['owner.salary.takeBack.button'] }).click();
    await expect(
      row.getByText(say('owner.salary.line.takenBack', { reason: 'Galti se joda' })),
    ).toBeVisible();
    await expect(row.getByText(`${hi['owner.salary.line.add']}: Diwali ka bonus`)).toBeVisible();
    await expect(row.locator('div', { hasText: hi['owner.salary.line.net'] }).last()).toContainText(
      '₹14,667.00',
    );
    expect(await db.payAdjustment.count({ where: { userId: who.id } })).toBe(3);
  } finally {
    await context.close();
  }
});

test('a tap twice adds once, and a stale take-back is told it was done', async ({ browser }) => {
  const who = await person(db, 'STOCK_KEEPER', { name: 'Do Tap' });
  await setTerms(who);
  const line = await ok(boss.token, 'POST', `/admin/salary/runs/${MONTH}/adjustments`, {
    userId: who.id,
    kind: 'ADDITION',
    amountPaise: 50000,
    reason: 'Pehli line',
    idempotencyKey: randomUUID(),
  });
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await openMonth(page);
    await card(page, who.name)
      .getByRole('button', { name: hi['owner.salary.takeBack.button'] })
      .click();
    const back = page.getByRole('dialog');
    await back.getByRole('textbox', { name: hi['owner.salary.reason'] }).fill('Galat');
    await ok(boss.token, 'POST', `/admin/salary/adjustments/${line.id}/reverse`, {
      reason: 'Kisi aur ne',
    });
    await back.getByRole('button', { name: hi['owner.salary.takeBack.button'] }).click();
    await expect(toast(page, hi['owner.hazri.alreadyDone'])).toBeVisible();
    expect(await db.payAdjustment.count({ where: { userId: who.id, kind: 'REVERSAL' } })).toBe(1);

    await page
      .getByRole('button', { name: say('owner.salary.adjust.for', { name: who.name }) })
      .click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('textbox', { name: hi['owner.salary.amount'] }).fill('200');
    await sheet.getByRole('textbox', { name: hi['owner.salary.reason'] }).fill('Do baar dabaya');
    await sheet.getByRole('button', { name: hi['owner.save'], exact: true }).dblclick();
    await expect(
      card(page, who.name).getByText(`${hi['owner.salary.line.add']}: Do baar dabaya`),
    ).toBeVisible();
    expect(
      await db.payAdjustment.count({ where: { userId: who.id, reason: 'Do baar dabaya' } }),
    ).toBe(1);
  } finally {
    await context.close();
  }
});

test('lock: a running month and open hazri cards are refused in words, and the confirm says who decides', async ({
  browser,
}) => {
  const who = await person(db, 'STOCK_KEEPER', { name: 'Lock Wala' });
  await setTerms(who);
  const { context, page } = await signedInDesk(browser, boss);
  try {
    // The month still running.
    await openMonth(page, today().slice(0, 7));
    await expect(page.getByText(hi['owner.salary.lock.notOver'])).toBeVisible();
    await page.getByRole('button', { name: hi['owner.salary.lock.button'] }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: hi['owner.salary.lock.confirmYes'] })
      .click();
    await expect(
      page.getByRole('alert').filter({ hasText: hi['error.MONTH_NOT_OVER'] }),
    ).toBeVisible();

    // An open card from that month.
    const event = await db.attendanceEvent.findFirst({ where: { userId: who.id } });
    expect(event).toBeNull();
    await db.$executeRawUnsafe(
      `INSERT INTO "AttendanceReview" ("id","eventId","userId","locationId","kind","toOwner","status","createdAt")
       VALUES ('rev_lock','none','${who.id}','${MAIN}','FAR',false,'OPEN','${MONTH}-10T06:00:00Z')`,
    );
    await openMonth(page);
    await page.getByRole('button', { name: hi['owner.salary.lock.button'] }).click();
    const confirm = page.getByRole('dialog');
    await expect(
      confirm.getByText(/Yeh system ka hisaab hai\. Pakka malik karta hai\./),
    ).toBeVisible();
    await expect(
      confirm.getByRole('heading', {
        name: say('owner.salary.lock.confirmTitle', { month: MONTH_NAME }),
      }),
    ).toBeVisible();
    // Changing their mind does nothing.
    await confirm.getByRole('button', { name: hi['owner.keepEditing'] }).click();
    expect(await db.payRun.count({ where: { month: MONTH, status: 'LOCKED' } })).toBe(0);

    await page.getByRole('button', { name: hi['owner.salary.lock.button'] }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: hi['owner.salary.lock.confirmYes'] })
      .click();
    const alert = page
      .getByRole('alert')
      .filter({ hasText: say('owner.salary.lock.reviewsOpen', { count: 1 }) });
    await expect(alert).toBeVisible();
    await expect(
      alert.getByRole('link', { name: hi['owner.salary.lock.toReviews'] }),
    ).toHaveAttribute('href', '/hazri?tab=reviews');
    expect(await db.payRun.count({ where: { month: MONTH, status: 'LOCKED' } })).toBe(0);

    await db.attendanceReview.update({ where: { id: 'rev_lock' }, data: { status: 'ACCEPTED' } });
    await openMonth(page);
    await page.getByRole('button', { name: hi['owner.salary.lock.button'] }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: hi['owner.salary.lock.confirmYes'] })
      .click();
    await expect(toast(page, 'Pakka ho gaya')).toBeVisible();
    await expect(page.getByText(/Pakka hua/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: hi['owner.salary.lock.button'] })).toHaveCount(0);
    // A locked month offers no way to add a line.
    await expect(
      page.getByRole('button', { name: say('owner.salary.adjust.for', { name: who.name }) }),
    ).toHaveCount(0);
    expect(
      (await call(boss.token, 'POST', `/admin/salary/runs/${MONTH}/lock`, { confirm: true }))
        .status,
    ).toBe(409);
  } finally {
    await context.close();
    await db.attendanceReview.deleteMany({ where: { id: 'rev_lock' } });
  }
});

test('two owners lock at once: the second is told it is done, and it happens once', async ({
  browser,
}) => {
  const who = await person(db, 'STOCK_KEEPER', { name: 'Do Malik' });
  await setTerms(who);
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await openMonth(page);
    await expect(card(page, who.name)).toBeVisible();
    await page.getByRole('button', { name: hi['owner.salary.lock.button'] }).click();
    await lockMonth();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: hi['owner.salary.lock.confirmYes'] })
      .click();
    await expect(toast(page, hi['owner.hazri.alreadyDone'])).toBeVisible();
    await expect(page.getByRole('button', { name: hi['owner.salary.lock.button'] })).toHaveCount(0);
    expect(await db.staffLedgerEntry.count({ where: { userId: who.id, kind: 'EARNED' } })).toBe(1);
  } finally {
    await context.close();
  }
});

test('after the lock: the slip prints alone, a payment is written, and the drawer shows it with no name', async ({
  browser,
}) => {
  const who = await person(db, 'STOCK_KEEPER', { name: 'Slip Wala' });
  await setTerms(who, 2_000_000);
  await lockMonth();
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await page.addInitScript(() => {
      (window as unknown as { printed: number }).printed = 0;
      window.print = () => {
        (window as unknown as { printed: number }).printed += 1;
      };
    });
    await openMonth(page);
    const row = card(page, who.name);
    await expect(
      row.getByText(say('owner.salary.owedPill', { amount: '₹20,000.00' })),
    ).toBeVisible();
    await page
      .getByRole('button', { name: say('owner.salary.slip.for', { name: who.name }) })
      .click();
    const slip = page.getByRole('dialog');
    await expect(slip.getByRole('heading', { name: who.name, exact: true })).toBeVisible();
    await expect(slip.getByText(MONTH_NAME)).toBeVisible();
    await expect(slip.getByText(hi['owner.salary.line.net'])).toBeVisible();
    await slip.getByRole('button', { name: hi['owner.salary.slip.print'] }).click();
    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
    // On paper the desk around it goes, and the print button with it.
    await page.emulateMedia({ media: 'print' });
    await expect(
      page.getByRole('navigation', { name: hi['owner.desk'], exact: true }),
    ).toBeHidden();
    await expect(slip.getByRole('button', { name: hi['owner.salary.slip.print'] })).toBeHidden();
    await expect(page.locator('.print-slip').getByText(hi['owner.salary.line.net'])).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await slip.getByRole('button', { name: hi['owner.close'] }).first().click();

    // Cash from a shop's drawer, above the line, warns and still goes through.
    await page
      .getByRole('button', { name: say('owner.salary.pay.for', { name: who.name }) })
      .click();
    const pay = page.getByRole('dialog');
    await expect(pay.getByRole('textbox', { name: hi['owner.salary.amount'] })).toHaveValue(
      '20000',
    );
    await expect(pay.getByText(hi['owner.salary.money.cashWarning'])).toBeVisible();
    await pay.getByRole('textbox', { name: hi['owner.salary.amount'] }).fill('9000');
    await expect(pay.getByText(hi['owner.salary.money.cashWarning'])).toHaveCount(0);
    await pay
      .getByRole('combobox', { name: hi['owner.salary.money.from'] })
      .selectOption(`GALLA:${MAIN}`);
    await pay.getByRole('button', { name: hi['owner.salary.pay.save'] }).dblclick();
    await expect(
      toast(page, say('owner.salary.pay.saved', { name: who.name, amount: '₹9,000.00' })),
    ).toBeVisible();
    await expect(
      row.getByText(say('owner.salary.owedPill', { amount: '₹11,000.00' })),
    ).toBeVisible();
    expect(await db.staffLedgerEntry.count({ where: { userId: who.id, kind: 'PAID' } })).toBe(1);

    // The same day's second cash takes it over the line.
    await page
      .getByRole('button', { name: say('owner.salary.pay.for', { name: who.name }) })
      .click();
    const again = page.getByRole('dialog');
    await again.getByRole('textbox', { name: hi['owner.salary.amount'] }).fill('2000');
    await expect(again.getByText(hi['owner.salary.money.cashWarning'])).toBeVisible();
    // UPI has no drawer to pay from, and no warning.
    await again.getByRole('combobox', { name: hi['owner.salary.money.how'] }).selectOption('UPI');
    await expect(again.getByText(hi['owner.salary.money.cashWarning'])).toHaveCount(0);
    await expect(
      again.getByRole('combobox', { name: hi['owner.salary.money.from'] }).locator('option'),
    ).toHaveCount(1);
    await again.getByRole('textbox', { name: hi['owner.salary.money.utr'] }).fill('UTR12345');
    // More than is owed is refused, with what is owed.
    await again.getByRole('textbox', { name: hi['owner.salary.amount'] }).fill('50000');
    await again.getByRole('button', { name: hi['owner.salary.pay.save'] }).click();
    await expect(
      again.getByText(say('owner.salary.pay.dueIs', { amount: '₹11,000.00' })),
    ).toBeVisible();
    await again.getByRole('textbox', { name: hi['owner.salary.amount'] }).fill('11000');
    await again.getByRole('button', { name: hi['owner.salary.pay.save'] }).click();
    await expect(row.getByText(hi['owner.salary.paidAll'])).toBeVisible();
    await expect(
      page.getByRole('button', { name: say('owner.salary.pay.for', { name: who.name }) }),
    ).toHaveCount(0);

    // The drawer's line, with no name on it.
    await go(page, '/galla');
    const staffLine = page.getByRole('row', { name: new RegExp(hi['owner.galla.staffPaid']) });
    await expect(staffLine).toContainText('₹9,000.00');
    await expect(page.locator('main').getByText(who.name)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('the record: a payment taken back shows both entries, and the person’s answer is there', async ({
  browser,
}) => {
  const who = await person(db, 'STOCK_KEEPER', { name: 'Hisaab Dekho' });
  await setTerms(who);
  await lockMonth();
  const pay = (amountPaise: number) =>
    ok(boss.token, 'POST', `/admin/salary/runs/${MONTH}/pay`, {
      userId: who.id,
      amountPaise,
      channel: 'UPI',
      paidFrom: 'OWNER',
      utr: 'UTR777',
      idempotencyKey: randomUUID(),
    });
  const got = await pay(1000000);
  const notGot = await pay(200000);
  const wrong = await pay(100000);
  await ok(who.token, 'POST', `/staff/me/payments/${got.id}/ack`, { answer: 'GOT' });
  await ok(who.token, 'POST', `/staff/me/payments/${notGot.id}/ack`, { answer: 'NOT_GOT' });
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await openMonth(page);
    // "Nahi mila" shows on the month itself, without opening anyone's record.
    await expect(card(page, who.name).getByText(hi['owner.salary.ack.notGot'])).toBeVisible();
    await card(page, who.name).getByRole('button', { name: who.name, exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(hi['owner.salary.ack.got'])).toBeVisible();
    await expect(sheet.getByText(hi['owner.salary.ack.notGot'])).toBeVisible();
    await expect(sheet.getByText(hi['owner.salary.ack.none'])).toBeVisible();
    await expect(sheet.getByText(/Ref UTR777/).first()).toBeVisible();

    const entry = sheet
      .locator('li')
      .filter({ hasText: hi['owner.salary.entry.PAID'] })
      .filter({ hasText: '₹1,000.00' });
    await entry.getByRole('button', { name: hi['owner.salary.takeBack.button'] }).click();
    const back = page.getByRole('dialog').last();
    await back.getByRole('textbox', { name: hi['owner.salary.reason'] }).fill('Do baar likha gaya');
    await back.getByRole('button', { name: hi['owner.salary.takeBack.button'] }).click();
    await expect(sheet.getByText('Do baar likha gaya')).toBeVisible();
    // Both show: the entry, marked, and the opposite entry beside it.
    await expect(sheet.getByText(hi['owner.salary.entry.takenBack'])).toBeVisible();
    await expect(
      sheet.locator('li strong', { hasText: new RegExp(`^${hi['owner.salary.entry.REVERSAL']}$`) }),
    ).toBeVisible();
    await expect(entry.getByText(hi['owner.salary.entry.takenBack'])).toBeVisible();
    await expect(
      entry.getByRole('button', { name: hi['owner.salary.takeBack.button'] }),
    ).toHaveCount(0);
    const rows = await db.staffLedgerEntry.findMany({
      where: { userId: who.id, reversesId: wrong.id },
    });
    expect(rows.length).toBe(1);
  } finally {
    await context.close();
  }
});

test('an owner gives an advance and changes this month’s recovery, and nobody gives themselves one', async ({
  browser,
}) => {
  const who = await person(db, 'STOCK_KEEPER', { name: 'Advance Wala' });
  await setTerms(who);
  // Nobody sets their own pay, so the other owner sets this one's.
  const partner = await person(db, 'OWNER', { name: 'Doosra Malik' });
  await ok(partner.token, 'PUT', `/admin/salary/terms/${boss.id}`, {
    effectiveFrom: '2026-01-01',
    amountPaise: 5_000_000,
  });
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await openMonth(page);
    await card(page, who.name).getByRole('button', { name: who.name, exact: true }).click();
    let sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: hi['owner.salary.advance.give'] }).click();
    const give = page.getByRole('dialog').last();
    await give.getByRole('textbox', { name: hi['owner.salary.amount'] }).fill('12000');
    await give.getByRole('textbox', { name: hi['owner.salary.advance.monthly'] }).fill('2000');
    await expect(give.getByText(hi['owner.salary.money.cashWarning'])).toBeVisible();
    await give.getByRole('button', { name: hi['owner.salary.advance.save'] }).click();
    await expect(sheet.getByText(hi['owner.salary.entry.ADVANCE_GIVEN'])).toBeVisible();
    await sheet.getByRole('button', { name: hi['owner.close'] }).first().click();

    const row = card(page, who.name);
    await expect(
      row.getByText(say('owner.salary.line.advanceLeft', { amount: '₹12,000.00' })),
    ).toBeVisible();
    await expect(row.locator('div', { hasText: hi['owner.salary.line.net'] }).last()).toContainText(
      '₹13,000.00',
    );
    await row.getByRole('button', { name: hi['owner.salary.recovery.change'] }).click();
    const recovery = page.getByRole('dialog');
    await recovery.getByRole('textbox', { name: hi['owner.salary.recovery.amount'] }).fill('500');
    await recovery.getByRole('textbox', { name: hi['owner.salary.reason'] }).fill('Is mahine kam');
    await recovery.getByRole('button', { name: hi['owner.save'], exact: true }).click();
    await expect(row.locator('div', { hasText: hi['owner.salary.line.net'] }).last()).toContainText(
      '₹14,500.00',
    );
    await expect(row.getByText(/Is mahine kam/)).toBeVisible();

    // Their own sheet has no advance button, and the API refuses it too.
    await card(page, boss.name).getByRole('button', { name: boss.name, exact: true }).click();
    sheet = page.getByRole('dialog');
    await expect(
      sheet.getByRole('button', { name: hi['owner.salary.terms.change'] }),
    ).toBeVisible();
    await expect(sheet.getByRole('button', { name: hi['owner.salary.advance.give'] })).toHaveCount(
      0,
    );
    const own = await call(boss.token, 'POST', '/admin/salary/advances', {
      userId: boss.id,
      amountPaise: 100000,
      recoveryPaise: 0,
      channel: 'CASH',
      paidFrom: 'OWNER',
      idempotencyKey: randomUUID(),
    });
    expect(own.status).toBe(403);
  } finally {
    await context.close();
  }
});

test('the sheet downloads for a locked month, and a formula in a name stays text', async ({
  browser,
}) => {
  const who = await person(db, 'STOCK_KEEPER', { name: '=HYPERLINK("x")' });
  await setTerms(who);
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await openMonth(page);
    await expect(page.getByRole('button', { name: hi['owner.salary.csv'] })).toHaveCount(0);
    await lockMonth();
    await page.reload();
    await page.getByRole('combobox', { name: hi['owner.salary.month'] }).selectOption(MONTH);
    const file = page.waitForEvent('download');
    await page.getByRole('button', { name: hi['owner.salary.csv'] }).click();
    const download = await file;
    expect(download.suggestedFilename()).toBe(`shiv-salary-${MONTH}.csv`);
    const text = await readFile((await download.path())!, 'utf8');
    expect(text).toContain('Name,Monthly');
    expect(text).toContain("'=HYPERLINK");
  } finally {
    await context.close();
  }
});

test('the accountant reads and downloads, and has no button to change anything', async ({
  browser,
}) => {
  const accountant = await person(db, 'ACCOUNTANT', { name: 'Padhne Wale' });
  const who = await person(db, 'STOCK_KEEPER', { name: 'Accountant Dekhe' });
  const noPay = await person(db, 'STOCK_KEEPER', { name: 'Accountant Bina Salary' });
  await setTerms(who);
  const { context, page } = await signedInDesk(browser, accountant);
  try {
    await openMonth(page);
    await expect(card(page, who.name)).toBeVisible();
    await expect(
      page.getByRole('region', { name: hi['owner.salary.noTerms'] }).getByText(noPay.name),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: hi['owner.salary.lock.button'] })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: say('owner.salary.adjust.for', { name: who.name }) }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: say('owner.salary.terms.for', { name: noPay.name }) }),
    ).toHaveCount(0);
    await card(page, who.name).getByRole('button', { name: who.name, exact: true }).click();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: hi['owner.salary.terms.change'] }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('dialog').getByRole('button', { name: hi['owner.salary.advance.give'] }),
    ).toHaveCount(0);

    await lockMonth();
    await page.reload();
    await page.getByRole('combobox', { name: hi['owner.salary.month'] }).selectOption(MONTH);
    await expect(page.getByRole('button', { name: hi['owner.salary.csv'] })).toBeVisible();
    await page
      .getByRole('button', { name: say('owner.salary.slip.for', { name: who.name }) })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: hi['owner.close'] }).first().click();
    await expect(
      page.getByRole('button', { name: say('owner.salary.pay.for', { name: who.name }) }),
    ).toHaveCount(0);
    for (const [method, path, body] of [
      ['PUT', `/admin/salary/terms/${who.id}`, { effectiveFrom: '2026-01-01', amountPaise: 1 }],
      [
        'POST',
        `/admin/salary/runs/${MONTH}/pay`,
        {
          userId: who.id,
          amountPaise: 1,
          channel: 'UPI',
          paidFrom: 'OWNER',
          idempotencyKey: randomUUID(),
        },
      ],
      [
        'POST',
        '/admin/salary/advances',
        {
          userId: who.id,
          amountPaise: 1,
          recoveryPaise: 0,
          channel: 'UPI',
          paidFrom: 'OWNER',
          idempotencyKey: randomUUID(),
        },
      ],
    ] as [string, string, unknown][])
      expect((await call(accountant.token, method, path, body)).status, path).toBe(403);
  } finally {
    await context.close();
  }
});

for (const role of ['MANAGER', 'CASHIER', 'STOCK_KEEPER', 'TECH_OPERATOR'] as const)
  test(`a ${role} has no salary page, and the API agrees`, async ({ browser }) => {
    const who = await person(db, role);
    const { context, page } = await signedInDesk(browser, who);
    try {
      await refusedPage(page, '/salary');
      const side = page.getByRole('navigation', { name: hi['owner.desk'], exact: true });
      await expect(side.getByRole('link', { name: hi['owner.salary.title'] })).toHaveCount(0);
      for (const path of [
        `/admin/salary/runs/${MONTH}`,
        '/admin/salary/terms',
        `/admin/salary/people/${boss.id}`,
      ])
        expect((await call(who.token, 'GET', path)).status, path).toBe(403);
    } finally {
      await context.close();
    }
  });

test('a manager asks for an advance from the people page, and an owner reads it in Manzoori', async ({
  browser,
}) => {
  const manager = await person(db, 'MANAGER', { name: 'Maangne Wala' });
  const who = await person(db, 'STOCK_KEEPER', { name: 'Advance Chahiye' });
  const asker = await signedInDesk(browser, manager);
  const owner = await signedInDesk(browser, boss);
  try {
    await go(asker.page, '/staff');
    await asker.page.getByRole('button', { name: hi['owner.salary.ask.title'] }).click();
    const sheet = asker.page.getByRole('dialog');
    await sheet
      .getByRole('combobox', { name: hi['owner.salary.ask.who'] })
      .selectOption({ label: who.name });
    // Nobody's pay is on this sheet, and the asker is not on the list.
    expect(await sheet.innerText()).not.toContain('₹');
    await expect(sheet.getByRole('option', { name: manager.name })).toHaveCount(0);
    await sheet.getByRole('textbox', { name: hi['owner.salary.amount'] }).fill('3000');
    await sheet.getByRole('textbox', { name: hi['owner.salary.advance.monthly'] }).fill('500');
    await sheet
      .getByRole('textbox', { name: hi['owner.salary.reason'] })
      .fill('Ghar mein zaroorat');
    await sheet.getByRole('button', { name: hi['owner.salary.ask.send'] }).dblclick();
    await expect(toast(asker.page, hi['owner.salary.ask.sent'])).toBeVisible();
    expect(await db.approvalRequest.count({ where: { kind: 'ADVANCE' } })).toBe(1);
    // Nothing is given until an owner says so.
    expect((await ok(boss.token, 'GET', `/admin/salary/people/${who.id}`)).advancePaise).toBe(0);

    await go(owner.page, '/manzoori');
    const card_ = owner.page
      .locator('article')
      .filter({ hasText: hi['owner.approval.kind.ADVANCE'] });
    await expect(card_.getByText(who.name)).toBeVisible();
    await expect(card_.getByText('₹3,000.00')).toHaveCount(1);
    await expect(
      card_.getByText(say('owner.manzoori.advanceRecovery', { amount: '₹500.00' })),
    ).toBeVisible();
    await expect(card_.getByText('Ghar mein zaroorat')).toBeVisible();
    await card_.getByRole('button', { name: hi['owner.manzoori.approve'] }).click();
    await expect
      .poll(
        async () => (await ok(boss.token, 'GET', `/admin/salary/people/${who.id}`)).advancePaise,
      )
      .toBe(300000);
  } finally {
    await asker.context.close();
    await owner.context.close();
  }
});

test('a cashier, who has no people page, asks from Manzoori; a stock keeper gets no such button', async ({
  browser,
}) => {
  const cashier = await person(db, 'CASHIER', { name: 'Cashier Maange' });
  const keeper = await person(db, 'STOCK_KEEPER', { name: 'Stock Na Maange' });
  const other = await person(db, 'STOCK_KEEPER', { name: 'Kisi Aur Ke Liye' });
  const away = await person(db, 'STOCK_KEEPER', {
    name: 'Doosri Dukaan Wala',
    shops: ['loc_staff_b'],
  });
  const counter = await signedInDesk(browser, cashier);
  const stock = await signedInDesk(browser, keeper);
  try {
    await go(counter.page, '/manzoori');
    await counter.page.getByRole('button', { name: hi['owner.salary.ask.title'] }).click();
    const sheet = counter.page.getByRole('dialog');
    const who = sheet.getByRole('combobox', { name: hi['owner.salary.ask.who'] });
    await who.selectOption({ label: other.name });
    await expect(who.getByRole('option', { name: away.name })).toHaveCount(0);
    await sheet.getByRole('textbox', { name: hi['owner.salary.amount'] }).fill('1000');
    await sheet.getByRole('button', { name: hi['owner.salary.ask.send'] }).click();
    await expect(toast(counter.page, hi['owner.salary.ask.sent'])).toBeVisible();

    await go(stock.page, '/manzoori');
    await expect(
      stock.page.getByRole('heading', { name: hi['owner.manzoori.title'] }),
    ).toBeVisible();
    await expect(
      stock.page.getByRole('button', { name: hi['owner.salary.ask.title'] }),
    ).toHaveCount(0);
    expect((await call(keeper.token, 'GET', '/admin/salary/advances/people')).status).toBe(403);
    // Asking for someone at another shop is refused.
    expect(
      (
        await call(cashier.token, 'POST', '/admin/salary/advances/ask', {
          userId: away.id,
          amountPaise: 100000,
          recoveryPaise: 0,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(403);
  } finally {
    await counter.context.close();
    await stock.context.close();
  }
});
