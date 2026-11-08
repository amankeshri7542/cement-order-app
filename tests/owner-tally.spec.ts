import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { hinglish, t as translate, type MessageKey } from '@shiv/i18n';
import { addDays, istToday, type StaffRole } from '@shiv/shared';
import { clearTally } from '../apps/api/test/tally-helper';
import { test, expect, deskLanguage } from './fixtures';

// The Tally page and the customer's two numbers on the real desk, API and database, as each role.
// The mirror is seeded the way apps/api/test/tally-helper.ts seeds it: no Tally and no PC are called.
// Every person, company and number here is made up for the test.
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const desk = 'http://localhost:3001';
const api = 'http://localhost:4010/api/v1';
const MAIN = 'loc_main';
const shots = process.env.TALLY_SHOTS;
const PAST_SAFE = 90071992547409931n;
const PAST_SAFE_SHOWN = '₹90,07,19,92,54,74,099.31';
let counter = 0;
const freshPhone = () => `9${String(Date.now()).slice(-8)}${counter++ % 10}`;
const say = (key: MessageKey, params?: Record<string, string | number>) =>
  translate(key, params, 'hinglish');
const today = istToday();
const daysAgo = (days: number) => addDays(today, -days);
const COPY_FROM = daysAgo(200);
test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

async function shot(page: Page, name: string) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
}
async function fitsWidth(page: Page) {
  const [content, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(content, 'nothing runs off the side of the screen').toBeLessThanOrEqual(width);
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
  const page = await context.newPage();
  await deskLanguage(page.context(), 'hinglish');
  return { context, page };
}
const laptop = (browser: Browser) => open(browser, 1440, 900);
const phone = (browser: Browser) => open(browser, 390, 844);
async function signIn(page: Page, digits: string, path: string) {
  await page.goto(`${desk}${path}`);
  await page.getByRole('textbox', { name: hinglish['owner.loginPhone'] }).fill(digits);
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/auth/otp/request') && r.status() === 201,
  );
  await page.getByRole('button', { name: hinglish['owner.sendCode'] }).click();
  await page
    .getByRole('textbox', { name: hinglish['owner.code'], exact: true })
    .fill((await (await sent).json()).devCode);
  await page.getByRole('button', { name: hinglish['owner.signIn'] }).click();
}
/** What the API itself says to this person, past whatever the screen hides. */
const asked = (context: BrowserContext, path: string) => context.request.get(`${api}${path}`);
const posted = (context: BrowserContext, path: string, data: object = {}) =>
  context.request.post(`${api}${path}`, { data, headers: { Origin: desk } });

async function pc(extra: object = {}) {
  return db.tallyDevice.create({
    data: {
      name: 'Sample PC',
      publicKey: randomUUID(),
      createdById: 'browser-fixture',
      state: 'OK',
      lastHeartbeatAt: new Date(),
      lastGoodAt: new Date(),
      version: '1.0.0',
      ...extra,
    },
  });
}
async function company(deviceId: string | null, extra: object = {}) {
  return db.tallyCompany.create({
    data: {
      guid: randomUUID(),
      name: 'Sample Books',
      role: 'PRIMARY',
      phase: 'LIVE',
      copyFrom: COPY_FROM,
      ownerDeviceId: deviceId,
      freshAt: new Date(),
      tieOut: { status: 'OK', total: 3, failed: 0 },
      ...extra,
    },
  });
}
const books = async (extra: object = {}) => company((await pc()).id, extra);
async function ledger(
  companyId: string,
  name: string,
  closing: bigint,
  extra: {
    phones?: string[];
    gstin?: string;
    className?: string;
    baseline?: bigint;
    tieOutOk?: boolean;
    gap?: bigint;
  } = {},
) {
  return db.tallyLedger.create({
    data: {
      companyId,
      guid: randomUUID(),
      alterId: 1n,
      name,
      parent: extra.className === 'CREDITOR' ? 'Sundry Creditors' : 'Sundry Debtors',
      class: extra.className ?? 'DEBTOR',
      closingPaise: closing,
      closingAsOf: new Date(),
      openingPaise: 0n,
      baselinePaise: extra.baseline ?? 0n,
      tieOutOk: extra.tieOutOk ?? true,
      tieOutGapPaise: extra.gap ?? 0n,
      phones: extra.phones ?? [],
      gstin: extra.gstin,
    },
  });
}
const joined = (row: { companyId: string; guid: string }, userId: string) =>
  db.tallyPartyLink.create({
    data: {
      companyId: row.companyId,
      guid: row.guid,
      userId,
      status: 'LINKED',
      method: 'TYPED',
      confirmedById: 'browser-fixture',
    },
  });
/** A khata entry by the same rule the app has: entries add up to the customer's balance. */
async function khata(customerId: string, amountPaise: number, on: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: customerId } });
  const balance = user.khataBalancePaise + amountPaise;
  const row = await db.customerLedgerEntry.create({
    data: {
      firmId: 'firm_main',
      customerId,
      kind: 'ADJUSTMENT',
      amountPaise,
      balanceAfterPaise: balance,
      actorId: 'browser-fixture',
      note: 'Sample entry',
      occurredAt: new Date(`${on}T12:00:00+05:30`),
    },
  });
  await db.user.update({ where: { id: customerId }, data: { khataBalancePaise: balance } });
  await db.customerFirmBalance.upsert({
    where: { customerId_firmId: { customerId, firmId: 'firm_main' } },
    create: { customerId, firmId: 'firm_main', balancePaise: amountPaise },
    update: { balancePaise: { increment: amountPaise } },
  });
  return row;
}
/** With Tally's sign: a sale is the party's debit, so negative. */
async function voucher(
  party: { guid: string; name: string; companyId: string },
  number: string,
  amount: bigint,
  date: string,
) {
  return db.tallyVoucher.create({
    data: {
      companyId: party.companyId,
      guid: randomUUID(),
      alterId: 1n,
      date,
      type: amount < 0n ? 'Sales' : 'Receipt',
      baseType: amount < 0n ? 'Sales' : 'Receipt',
      number,
      party: party.name,
      partyGuid: party.guid,
      partyAmountPaise: amount,
      lines: {
        create: [
          { ledgerGuid: party.guid, ledgerName: party.name, amountPaise: amount },
          { ledgerName: 'Sales Account', amountPaise: -amount },
        ],
      },
    },
  });
}
const worked = (customerId: string, row: object) =>
  db.khataRecon.create({
    data: { customerId, firmId: '', computedAt: new Date(), ...row } as never,
  });
const partyNames = (page: Page) => page.locator('main article h3').allInnerTexts();

test.beforeEach(async () => {
  await clearTally(db);
});
test.afterAll(async () => {
  await clearTally(db);
  await db.$disconnect();
});

test('not connected yet: each person is told what comes next, and no number is made up', async ({
  browser,
}) => {
  test.setTimeout(240000);
  const owner = await staff('OWNER');
  const someone = await customer('Nobody Linked');
  const { context, page } = await laptop(browser);
  await signIn(page, owner.digits, '/tally');
  const main = page.locator('main');
  await expect(
    main.getByRole('heading', { name: hinglish['owner.crm.tally.notConnected'] }),
  ).toBeVisible({ timeout: 60000 });
  for (const key of [
    'owner.tally.empty.body',
    'owner.tally.empty.step1',
    'owner.tally.empty.step2',
    'owner.tally.empty.step3',
    'owner.tally.empty.step4',
  ] as const)
    await expect(main.getByText(hinglish[key])).toBeVisible();
  await expect(main.getByRole('button', { name: hinglish['owner.tally.connect'] })).toBeVisible();
  await expect(main.getByText(/₹/)).toHaveCount(0);
  await shot(page, 'empty-owner-laptop');
  await page.getByRole('tab', { name: hinglish['owner.tally.tab.party'] }).click();
  await expect(main.getByText(hinglish['owner.crm.tally.notConnected'])).toBeVisible();
  await expect(main.getByRole('link', { name: hinglish['owner.tally.goHaal'] })).toBeVisible();
  await page.getByRole('tab', { name: hinglish['owner.tally.tab.farq'] }).click();
  await expect(page).toHaveURL(/tab=farq/);
  await expect(main.getByText(hinglish['owner.crm.tally.notConnected'])).toBeVisible();
  // The customer page keeps working, and says the same.
  await page.goto(`${desk}/customers/${someone.id}`);
  await expect(page.getByRole('heading', { name: someone.name, exact: true })).toBeVisible();
  await expect(main.getByText(hinglish['owner.crm.tally.notConnected'])).toBeVisible();
  await page.getByRole('tab', { name: hinglish['owner.tally.numbers.tab'] }).click();
  const panel = main.getByRole('region', { name: hinglish['owner.tally.numbers.title'] });
  await expect(panel.getByText(hinglish['owner.crm.tally.notConnected'])).toBeVisible();
  await expect(panel.getByRole('link', { name: hinglish['owner.tally.goHaal'] })).toBeVisible();
  await context.close();

  const accountant = await staff('ACCOUNTANT');
  const second = await phone(browser);
  await signIn(second.page, accountant.digits, '/tally');
  const hers = second.page.locator('main');
  await expect(hers.getByText(hinglish['owner.tally.empty.notYours'])).toBeVisible({
    timeout: 30000,
  });
  await expect(hers.getByText(hinglish['owner.tally.port.prime'])).toBeVisible();
  await expect(hers.getByRole('button', { name: hinglish['owner.tally.connect'] })).toHaveCount(0);
  await fitsWidth(second.page);
  await shot(second.page, 'empty-accountant-phone');
  await second.context.close();
});

test('an owner connects a PC with a code shown once, says which file is real, stops and cuts off', async ({
  browser,
}) => {
  test.setTimeout(240000);
  const owner = await staff('OWNER');
  const { context, page } = await laptop(browser);
  await signIn(page, owner.digits, '/tally');
  const main = page.locator('main');
  await main.getByRole('button', { name: hinglish['owner.tally.connect'] }).click();
  const sheet = page.getByRole('dialog', { name: hinglish['owner.tally.connect'] });
  await expect(
    sheet.getByRole('button', { name: hinglish['owner.tally.pair.make'] }),
  ).toBeDisabled();
  await sheet
    .getByRole('textbox', { name: hinglish['owner.tally.pair.name'] })
    .fill('Sample Counter PC');
  await sheet.getByRole('button', { name: hinglish['owner.tally.pair.make'] }).click();
  const made = page.getByRole('dialog', {
    name: say('owner.tally.pair.codeTitle', { pc: 'Sample Counter PC' }),
  });
  const shown = made.getByTestId('pair-code');
  await expect(shown).toHaveText(/^\d{8}$/);
  const code = (await shown.innerText()).trim();
  await expect(made.getByText(`pair ${code} --api http://localhost:4010`)).toBeVisible();
  await shot(page, 'pair-code-laptop');
  // Only its keyed hash is kept, and once this closes nobody can read it again.
  const stored = await db.tallyPairingCode.findFirstOrThrow({ where: { createdById: owner.id } });
  expect(stored.hash).not.toContain(code);
  await made.getByRole('button', { name: hinglish['owner.tally.pair.done'] }).click();
  await expect(page.getByText(code)).toHaveCount(0);
  await main.getByRole('button', { name: hinglish['owner.tally.connect'] }).click();
  await expect(page.getByTestId('pair-code')).toHaveCount(0);
  await page
    .getByRole('dialog', { name: hinglish['owner.tally.connect'] })
    .getByRole('button', { name: hinglish['owner.close'] })
    .click();

  // The PC pairs itself and reports a company, which waits for a person.
  const counter = await pc({ name: 'Sample Counter PC' });
  const waiting = await company(counter.id, {
    name: 'Sample New Books',
    role: 'PENDING',
    phase: 'MASTERS',
    copyFrom: null,
    freshAt: null,
    tieOut: undefined,
  });
  await page.reload();
  const pcCard = main.locator('article').filter({ hasText: 'Sample Counter PC' });
  const firm = main.locator('article').filter({ hasText: 'Sample New Books' });
  await expect(pcCard.getByText(hinglish['owner.tally.state.OK'], { exact: true })).toBeVisible();
  await expect(firm.getByText(hinglish['owner.tally.role.PENDING'], { exact: true })).toBeVisible();
  await expect(firm.getByText(hinglish['owner.tally.company.pendingBody'])).toBeVisible();
  await shot(page, 'company-pending-laptop');
  // Saying no leaves it alone. Nothing starts without a yes.
  const primary = firm.getByRole('button', { name: hinglish['owner.tally.company.setPrimary'] });
  await primary.click();
  const startAsk = page.getByRole('dialog', {
    name: say('owner.tally.company.primaryTitle', { name: 'Sample New Books' }),
  });
  await startAsk.getByRole('button', { name: hinglish['owner.keepEditing'] }).click();
  await expect(startAsk).toBeHidden();
  expect((await db.tallyCompany.findUniqueOrThrow({ where: { id: waiting.id } })).role).toBe(
    'PENDING',
  );
  await primary.click();
  await startAsk.getByRole('button', { name: hinglish['owner.tally.company.primaryYes'] }).click();
  await expect(firm.getByText(hinglish['owner.tally.role.PRIMARY'], { exact: true })).toBeVisible();
  expect(await db.tallyCompany.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({
    role: 'PRIMARY',
    copyFrom: expect.any(String),
  });
  await expect(firm.getByText(hinglish['owner.tally.phase.MASTERS'])).toBeVisible();
  await expect(firm.getByText(hinglish['owner.tally.neverFresh'])).toBeVisible();

  // Bridge roko, and back on.
  await main.getByRole('button', { name: hinglish['owner.tally.pauseAll'] }).click();
  const stop = page.getByRole('dialog', { name: hinglish['owner.tally.pauseAllTitle'] });
  await stop.getByRole('button', { name: hinglish['owner.tally.pauseAllYes'] }).click();
  await expect(
    pcCard.getByText(hinglish['owner.tally.state.PAUSED'], { exact: true }),
  ).toBeVisible();
  expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: counter.id } })).pausedAt).not.toBe(
    null,
  );
  await main.getByRole('button', { name: hinglish['owner.tally.resumeAll'] }).click();
  await expect(pcCard.getByText(hinglish['owner.tally.state.OK'], { exact: true })).toBeVisible();
  expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: counter.id } })).pausedAt).toBe(
    null,
  );

  // Cutting off asks first, and "no" means no.
  await pcCard.getByRole('button', { name: hinglish['owner.tally.cutOff'] }).click();
  const cutAsk = page.getByRole('dialog', {
    name: say('owner.tally.cutOffTitle', { pc: 'Sample Counter PC' }),
  });
  await expect(cutAsk.getByText(hinglish['owner.tally.cutOffBody'])).toBeVisible();
  await cutAsk.getByRole('button', { name: hinglish['owner.keepEditing'] }).click();
  expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: counter.id } })).revokedAt).toBe(
    null,
  );
  await pcCard.getByRole('button', { name: hinglish['owner.tally.cutOff'] }).click();
  await cutAsk.getByRole('button', { name: hinglish['owner.tally.cutOffYes'] }).click();
  await expect(main.getByText(say('owner.tally.cutPcs', { count: 1 }))).toBeVisible();
  expect(
    (await db.tallyDevice.findUniqueOrThrow({ where: { id: counter.id } })).revokedAt,
  ).not.toBe(null);
  // Nothing is left to copy this file, and the page says so with what to do next.
  await expect(firm.getByText(hinglish['owner.tally.company.pcGone'])).toBeVisible();
  await expect(main.getByText(hinglish['owner.tally.noPc'])).toBeVisible();
  await expect(main.getByText(hinglish['owner.tally.empty.step2'])).toBeVisible();
  await context.close();
});

test('each PC and company state reads in plain words, and a sleeping PC is no alarm', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const owner = await staff('OWNER');
  const old = new Date(Date.now() - 3 * 86400000);
  const hours = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
  const silent = await pc({ name: 'Sample Quiet PC', lastHeartbeatAt: old, lastGoodAt: old });
  await pc({ name: 'Sample Port PC', state: 'PORT_OFF' });
  await pc({ name: 'Sample Closed PC', state: 'TALLY_CLOSED' });
  await pc({ name: 'Sample Licence PC', state: 'EDUCATIONAL' });
  await pc({ name: 'Sample Busy PC', state: 'BUSY', caps: { slowMs: 45000 } });
  await pc({
    name: 'Sample Full PC',
    caps: { diskFreeMb: 100, claimedElsewhere: 1, updateFailed: '1.1.0' },
  });
  const missing = await pc({ name: 'Sample Missing PC', state: 'COMPANY_MISSING' });
  await company(missing.id, { name: 'Sample Closed File' });
  await company(silent.id, {
    name: 'Sample Copying File',
    phase: 'BACKFILL',
    copyFrom: daysAgo(100),
    backfillCursor: daysAgo(50),
    freshAt: null,
    tieOut: undefined,
  });
  await company(silent.id, {
    name: 'Sample Old File',
    freshAt: old,
    tieOut: { status: 'FAILED', total: 40, failed: 3 },
    failures: 4,
  });
  await company(silent.id, {
    name: 'Sample Rewritten File',
    phase: 'MASTERS',
    rewrittenAt: new Date(),
    tieOut: { status: 'REWRITTEN' },
  });
  await company(silent.id, {
    name: 'Sample Twin File',
    role: 'PENDING',
    phase: 'MASTERS',
    sameNameAsId: 'some-other-company',
  });
  await company(silent.id, { name: 'Sample Copy File', role: 'BRANCH_COPY' });
  const { context, page } = await laptop(browser);
  await signIn(page, owner.digits, '/tally');
  const main = page.locator('main');
  const card = (name: string) => main.locator('article').filter({ hasText: name });
  await expect(card('Sample Port PC')).toBeVisible({ timeout: 30000 });
  // In shop hours a silent PC needs someone. After closing it is expected, and costs nobody a look.
  if (hours >= 8 && hours < 20)
    await expect(
      card('Sample Quiet PC').getByText(hinglish['owner.tally.state.PC_SILENT'], { exact: true }),
    ).toBeVisible();
  else {
    await expect(
      card('Sample Quiet PC').getByText(hinglish['owner.tally.state.PC_ASLEEP'], { exact: true }),
    ).toBeVisible();
    await expect(card('Sample Quiet PC').getByText(/Aapko kuch nahi karna/)).toBeVisible();
  }
  await expect(
    card('Sample Port PC').getByText(hinglish['owner.tally.state.PORT_OFF'], { exact: true }),
  ).toBeVisible();
  await expect(card('Sample Port PC').getByText(hinglish['owner.tally.port.prime'])).toBeVisible();
  await expect(card('Sample Port PC').getByText(hinglish['owner.tally.port.erp9'])).toBeVisible();
  await expect(
    card('Sample Closed PC').getByText(hinglish['owner.tally.state.TALLY_CLOSEDBody']),
  ).toBeVisible();
  await expect(
    card('Sample Licence PC').getByText(hinglish['owner.tally.state.EDUCATIONALBody']),
  ).toBeVisible();
  // Busy is the technical person's to watch, not an owner's.
  await expect(
    card('Sample Busy PC').getByText(hinglish['owner.tally.state.OK'], { exact: true }),
  ).toBeVisible();
  await expect(
    card('Sample Busy PC').getByText(hinglish['owner.tally.state.BUSY'], { exact: true }),
  ).toHaveCount(0);
  await expect(card('Sample Full PC').getByText(/disk bhar rahi hai/)).toBeVisible();
  await expect(card('Sample Full PC').getByText(/doosre computer ki hai/)).toBeVisible();
  await expect(card('Sample Full PC').getByText(/purana wapas laga diya/)).toBeVisible();
  await expect(
    card('Sample Missing PC').getByText(
      say('owner.tally.state.COMPANY_MISSINGBody', { name: 'Sample Closed File' }),
    ),
  ).toBeVisible();
  await expect(card('Sample Copying File').getByText(/Tally copy ho raha hai: 49%/)).toBeVisible();
  await expect(card('Sample Copying File').getByRole('progressbar')).toBeVisible();
  await expect(
    card('Sample Closed File').getByText(say('owner.tally.tie.OK', { total: 3 })),
  ).toBeVisible();
  const oldCard = card('Sample Old File');
  await expect(
    oldCard.getByText(say('owner.tally.tie.FAILED', { total: 40, failed: 3 })),
  ).toBeVisible();
  await expect(oldCard.getByText(/Yeh copy purani hai/)).toBeVisible();
  await expect(oldCard.getByText(/baar baar ruk raha hai/)).toBeVisible();
  await expect(
    card('Sample Rewritten File').getByText(hinglish['owner.tally.tie.REWRITTEN']),
  ).toBeVisible();
  await expect(
    card('Sample Twin File').getByText(hinglish['owner.tally.company.sameName']),
  ).toBeVisible();
  await expect(
    card('Sample Copy File').getByText(hinglish['owner.tally.role.BRANCH_COPY'], { exact: true }),
  ).toBeVisible();
  await expect(card('Sample Copy File').getByText(/Tally copy ho raha hai/)).toHaveCount(0);
  await shot(page, 'haal-states-laptop');
  // Taking a file out of the count asks first.
  await card('Sample Copy File')
    .getByRole('button', { name: hinglish['owner.tally.company.change'] })
    .click();
  const change = page.getByRole('dialog', {
    name: say('owner.tally.company.changeTitle', { name: 'Sample Copy File' }),
  });
  await expect(
    change.getByRole('button', { name: hinglish['owner.tally.company.setCopy'] }),
  ).toHaveAttribute('aria-pressed', 'true');
  await change.getByRole('button', { name: hinglish['owner.tally.company.setIgnore'] }).click();
  await expect(
    card('Sample Copy File').getByText(hinglish['owner.tally.role.IGNORE'], { exact: true }),
  ).toBeVisible();
  await change.getByRole('button', { name: hinglish['owner.close'] }).last().click();
  await context.close();

  const small = await phone(browser);
  const again = await staff('OWNER');
  await signIn(small.page, again.digits, '/tally');
  await expect(small.page.locator('main article').first()).toBeVisible({ timeout: 30000 });
  await fitsWidth(small.page);
  await shot(small.page, 'haal-states-phone');
  await small.context.close();
});

test('the accountant links parties, biggest first, by one tap, by search and by phone, with undo', async ({
  browser,
}) => {
  test.setTimeout(300000);
  const accountant = await staff('ACCOUNTANT');
  const asha = await customer('Asha');
  const mohan = await customer('Mohan');
  const firm = await books();
  await ledger(firm.id, 'Sample Cash Sales', -50000n);
  await ledger(firm.id, 'Sample Big Party', -9000000n);
  const ashaRow = await ledger(firm.id, 'Sample Asha Traders', -1250000n, { phones: [asha.phone] });
  await ledger(firm.id, 'Sample Doubtful Party', -3000n, { tieOutOk: false, gap: -100n });
  await ledger(firm.id, 'Sample Cement Supplier', PAST_SAFE, { className: 'CREDITOR' });
  const { context, page } = await laptop(browser);
  await signIn(page, accountant.digits, '/tally?tab=party');
  const main = page.locator('main');
  const row = (name: string) => main.locator('article').filter({ hasText: name });
  await expect(row('Sample Big Party')).toBeVisible({ timeout: 60000 });
  expect(await partyNames(page)).toEqual([
    'Sample Big Party',
    'Sample Asha Traders',
    'Sample Cash Sales',
    'Sample Doubtful Party',
  ]);
  await expect(main.getByText('₹0 of ₹1,03,030 udhaar juda, 0 of 4 party')).toBeVisible();
  await expect(row('Sample Big Party').getByText('₹90,000', { exact: true })).toBeVisible();
  await expect(
    row('Sample Big Party').getByText(hinglish['owner.tally.party.owes'], { exact: true }),
  ).toBeVisible();
  await expect(row('Sample Big Party').getByText(/ tak$/)).toBeVisible();
  await expect(
    row('Sample Doubtful Party').getByText(hinglish['owner.crm.tally.notSure']),
  ).toBeVisible();
  // The suggestion gives its reason, and an accountant reads no customer's whole number.
  const ashaCard = row('Sample Asha Traders');
  await expect(ashaCard.getByText(asha.name)).toBeVisible();
  await expect(ashaCard.getByText(new RegExp(hinglish['owner.tally.party.byPHONE']))).toBeVisible();
  await expect(
    ashaCard.getByText(`XXXXXXX${asha.digits.slice(-3)}`, { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(asha.phone)).toHaveCount(0);
  await shot(page, 'party-accountant-laptop');

  // One tap, then undo.
  const yes = `${hinglish['owner.tally.yes']}: ${asha.name}`;
  await ashaCard.getByRole('button', { name: yes }).click();
  await expect(
    main.getByText(
      say('owner.tally.party.linkedLine', { party: 'Sample Asha Traders', name: asha.name }),
    ),
  ).toBeVisible();
  await expect(row('Sample Asha Traders')).toHaveCount(0);
  await expect(main.getByText('₹12,500 of ₹1,03,030 udhaar juda, 1 of 4 party')).toBeVisible();
  const held = await db.tallyPartyLink.findFirstOrThrow({ where: { guid: ashaRow.guid } });
  expect(held).toMatchObject({
    userId: asha.id,
    status: 'LINKED',
    method: 'PHONE',
    score: 100,
    confirmedById: accountant.id,
  });
  await shot(page, 'party-undo-laptop');
  await main.getByRole('button', { name: hinglish['owner.tally.undo'] }).click();
  await expect(row('Sample Asha Traders')).toBeVisible();
  await expect(main.getByText('₹0 of ₹1,03,030 udhaar juda, 0 of 4 party')).toBeVisible();
  expect((await db.tallyPartyLink.findFirstOrThrow({ where: { guid: ashaRow.guid } })).status).toBe(
    'UNLINKED',
  );

  // Link again, and undo from the Jude hue list as well.
  await row('Sample Asha Traders').getByRole('button', { name: yes }).click();
  await expect(row('Sample Asha Traders')).toHaveCount(0);
  await main
    .getByRole('button', { name: hinglish['owner.tally.party.linked'], exact: true })
    .click();
  const linkedRow = row('Sample Asha Traders');
  await expect(linkedRow.getByRole('link', { name: asha.name })).toBeVisible();
  await expect(linkedRow.getByRole('link', { name: asha.name })).toHaveAttribute(
    'href',
    `/customers/${asha.id}?tab=tally`,
  );
  await linkedRow
    .getByRole('button', { name: `${hinglish['owner.tally.undo']}: Sample Asha Traders` })
    .click();
  await expect(main.getByText(hinglish['owner.tally.party.noneLinked'])).toBeVisible();
  await main.getByRole('button', { name: hinglish['owner.tally.party.todo'] }).click();

  // Search for someone already here.
  await row('Sample Big Party')
    .getByRole('button', { name: hinglish['owner.tally.party.find'] })
    .click();
  const sheet = page.getByRole('dialog', {
    name: say('owner.tally.link.title', { party: 'Sample Big Party' }),
  });
  await sheet
    .getByRole('searchbox', { name: hinglish['owner.tally.link.search'] })
    .fill('Nobody By This Name');
  await expect(sheet.getByText(hinglish['owner.tally.link.none'])).toBeVisible();
  await sheet
    .getByRole('searchbox', { name: hinglish['owner.tally.link.search'] })
    .fill(mohan.name);
  await expect(sheet.getByText(`XXXXXXX${mohan.digits.slice(-3)}`, { exact: false })).toBeVisible();
  await shot(page, 'party-search-laptop');
  await sheet
    .getByRole('button', { name: `${hinglish['owner.tally.yes']}: ${mohan.name}` })
    .click();
  await expect(sheet).toBeHidden();
  await expect(row('Sample Big Party')).toHaveCount(0);

  // A new person, by phone. A wrong number cannot be sent.
  await row('Sample Doubtful Party')
    .getByRole('button', { name: hinglish['owner.tally.party.find'] })
    .click();
  const fresh = page.getByRole('dialog', {
    name: say('owner.tally.link.title', { party: 'Sample Doubtful Party' }),
  });
  const save = fresh.getByRole('button', { name: hinglish['owner.tally.link.save'] });
  await expect(fresh.getByRole('textbox', { name: hinglish['owner.tally.link.name'] })).toHaveValue(
    'Sample Doubtful Party',
  );
  await expect(save).toBeDisabled();
  await fresh.getByRole('textbox', { name: hinglish['owner.tally.link.phone'] }).fill('12345');
  await expect(save).toBeDisabled();
  const newDigits = freshPhone();
  await fresh.getByRole('textbox', { name: hinglish['owner.tally.link.phone'] }).fill(newDigits);
  await save.click();
  await expect(fresh).toBeHidden();
  expect(await db.user.findUniqueOrThrow({ where: { phone: `+91${newDigits}` } })).toMatchObject({
    role: 'CUSTOMER',
    name: 'Sample Doubtful Party',
  });

  // "Grahak nahi", and its undo.
  await row('Sample Cash Sales')
    .getByRole('button', { name: hinglish['owner.tally.party.notCustomer'] })
    .click();
  await expect(
    main.getByText(say('owner.tally.party.markedLine', { party: 'Sample Cash Sales' })),
  ).toBeVisible();
  await expect(row('Sample Cash Sales')).toHaveCount(0);
  const show = main.getByRole('group', { name: hinglish['owner.tally.party.show'] });
  await show.getByRole('button', { name: hinglish['owner.tally.party.notCustomers'] }).click();
  await expect(
    row('Sample Cash Sales').getByText(hinglish['owner.tally.party.marked']),
  ).toBeVisible();
  await main
    .getByRole('button', { name: hinglish['owner.tally.undo'], exact: true })
    .first()
    .click();
  await expect(row('Sample Cash Sales')).toHaveCount(0);

  // Someone else got there first: said in words, and the row shows the truth.
  await show.getByRole('button', { name: hinglish['owner.tally.party.todo'] }).click();
  await expect(row('Sample Asha Traders').getByRole('button', { name: yes })).toBeVisible();
  await db.tallyPartyLink.update({
    where: { companyId_guid: { companyId: firm.id, guid: ashaRow.guid } },
    data: { userId: mohan.id, status: 'LINKED' },
  });
  await row('Sample Asha Traders').getByRole('button', { name: yes }).click();
  await expect(page.getByText(hinglish['error.TALLY_LINK_TAKEN'])).toBeVisible();
  await expect(row('Sample Asha Traders')).toHaveCount(0);

  // The last one, and the to-do list says it is done.
  await row('Sample Cash Sales')
    .getByRole('button', { name: hinglish['owner.tally.party.notCustomer'] })
    .click();
  await expect(main.getByText(hinglish['owner.tally.party.allDone'])).toBeVisible();

  // A search that finds nothing says so.
  await main
    .getByRole('searchbox', { name: hinglish['owner.tally.party.search'] })
    .fill('Zzz Nobody');
  await expect(main.getByText(hinglish['owner.tally.party.noMatch'])).toBeVisible();
  await main.getByRole('searchbox', { name: hinglish['owner.tally.party.search'] }).fill('');

  // A supplier's dues past 2^53 show to the paisa.
  await main.getByRole('button', { name: hinglish['owner.tally.party.creditors'] }).click();
  const supplier = row('Sample Cement Supplier');
  await expect(supplier.getByText(PAST_SAFE_SHOWN)).toBeVisible();
  await expect(
    supplier.getByText(hinglish['owner.tally.party.toPay'], { exact: true }),
  ).toBeVisible();
  await shot(page, 'party-big-number-laptop');
  // Nothing here reached the books or the khata.
  expect(await db.tallyLedger.count({ where: { closingPaise: -1250000n } })).toBe(1);
  await context.close();
});

test('a party’s name is only ever text, whatever Tally holds, in Hindi too', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const firm = await books();
  await ledger(firm.id, 'Sample <img src=x onerror="window.pwned=1"> Party', -9000n);
  await ledger(firm.id, 'सैंपल पार्टी', -8000n);
  await ledger(firm.id, 'Sample'.padEnd(120, ' x'), -7000n);
  const { context, page } = await laptop(browser);
  await signIn(page, owner.digits, '/tally?tab=party');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: /<img src=x/ })).toBeVisible({ timeout: 60000 });
  await expect(main.getByRole('heading', { name: 'सैंपल पार्टी' })).toBeVisible();
  await expect(main.locator('article img')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { pwned?: number }).pwned),
  ).toBeUndefined();
  // The same in its own search: nothing a person types reaches the database as anything but text.
  const search = main.getByRole('searchbox', { name: hinglish['owner.tally.party.search'] });
  await search.fill(`' OR 1=1 --`);
  await expect(main.getByText(hinglish['owner.tally.party.noMatch'])).toBeVisible();
  await search.fill('सैंपल');
  await expect(main.getByRole('heading', { name: 'सैंपल पार्टी' })).toBeVisible();
  await expect(main.locator('article')).toHaveCount(1);
  await fitsWidth(page);
  await context.close();
});

test('both numbers, each line in words, adding up on screen, with one-tap matches and undo', async ({
  browser,
}) => {
  test.setTimeout(300000);
  const owner = await staff('OWNER');
  const ramesh = await customer('Ramesh');
  const firm = await books({ tieOut: { status: 'FAILED', total: 1, failed: 1 } });
  // Before our copy: Tally held ₹500 and the khata ₹800, so ₹300 opens the difference.
  // In the books: 300 paise that our copy cannot find, which is what stays unexplained.
  const party = await ledger(firm.id, 'Sample Ramesh Ledger', -154800n, {
    baseline: -50000n,
    tieOutOk: false,
    gap: -300n,
  });
  await joined(party, ramesh.id);
  await khata(ramesh.id, 80000, addDays(COPY_FROM, -10)); // The opening.
  await khata(ramesh.id, 5000, daysAgo(1)); // In the khata, this week.
  await khata(ramesh.id, 12300, daysAgo(10)); // In the khata, over a week ago.
  await voucher(party, 'SAMPLE-ONLY', -7000n, daysAgo(2)); // Only in Tally.
  // Matched by a person, with Tally ₹50 short.
  const sale = await khata(ramesh.id, 100000, daysAgo(5));
  const bill = await voucher(party, 'SAMPLE-SHORT', -95000n, daysAgo(5));
  await db.khataVoucherMatch.create({
    data: {
      entryId: sale.id,
      voucherId: bill.id,
      amountPaise: 100000n,
      method: 'PERSON',
      confirmedById: 'browser-fixture',
    },
  });
  await db.tallyVoucherChange.create({
    data: {
      companyId: firm.id,
      voucherId: bill.id,
      kind: 'ALTERED',
      oldAmountPaise: -100000n,
      newAmountPaise: -95000n,
    },
  });
  // Same amount, a day apart, one on each side: a suggestion, and nothing more until accepted.
  await khata(ramesh.id, 2500, daysAgo(1));
  await voucher(party, 'SAMPLE-NEAR', -2500n, daysAgo(2));
  const entriesBefore = await db.customerLedgerEntry.count({ where: { customerId: ramesh.id } });

  const { context, page } = await laptop(browser);
  await signIn(page, owner.digits, `/customers/${ramesh.id}?tab=tally`);
  const main = page.locator('main');
  const panel = main.getByRole('region', { name: hinglish['owner.tally.numbers.title'] });
  await expect(panel).toBeVisible({ timeout: 60000 });
  await expect(
    page.getByRole('tab', { name: hinglish['owner.tally.numbers.tab'] }),
  ).toHaveAttribute('aria-selected', 'true');
  // Khata ₹1,998, Tally ₹1,548 with its time, so a difference of ₹450.
  await expect(panel.getByText('₹1,998', { exact: true })).toBeVisible();
  await expect(panel.getByText('₹1,548', { exact: true })).toBeVisible();
  await expect(panel.getByText('₹450', { exact: true })).toBeVisible();
  await expect(panel.getByText(/^Tally, .* tak$/)).toBeVisible();
  // The left side says the same, second to the khata, and points here.
  await expect(main.getByText(/^Tally ₹1,548 · /)).toBeVisible();
  await expect(main.getByText(/Khate se farq ₹450/)).toBeVisible();

  const why = panel.getByRole('region', { name: hinglish['owner.tally.numbers.why'] });
  for (const key of [
    'owner.tally.line.OPENING',
    'owner.tally.line.TIMING',
    'owner.tally.line.APP_ONLY',
    'owner.tally.line.TALLY_ONLY',
    'owner.tally.line.AMOUNT',
    'owner.tally.line.unexplained',
  ] as const)
    await expect(why.getByText(hinglish[key]).first()).toBeVisible();
  await expect(why.getByText(hinglish['owner.tally.numbers.addsUp'])).toBeVisible();
  // What the screen shows must itself add up: every line, to the total under it, read off the page.
  const amounts = async () =>
    ((await why.innerText()).match(/[+-]₹[\d,.]+/g) ?? []).map((shown) => {
      const digits = shown.replace(/[^\d.]/g, '');
      const [rupees = '0', paise = ''] = digits.split('.');
      const value = BigInt(rupees) * 100n + BigInt(paise.padEnd(2, '0') || '0');
      return shown.startsWith('-') ? -value : value;
    });
  const seen = await amounts();
  expect(seen.length).toBeGreaterThan(5);
  const total = seen.pop()!;
  expect(total).toBe(45000n);
  expect(seen.reduce((sum, value) => sum + value, 0n)).toBe(total);
  // The line a person can act on carries its own number and date.
  await expect(why.getByText(/SAMPLE-ONLY/)).toBeVisible();
  // A fact about a matched voucher, adding nothing to the sum.
  const changes = panel.getByRole('region', { name: hinglish['owner.tally.numbers.changes'] });
  await expect(changes.getByText(/₹1,000 se ₹950/)).toBeVisible();
  await expect(panel.getByText(hinglish['owner.crm.tally.notSure']).first()).toBeVisible();
  await shot(page, 'customer-numbers-laptop');

  // A suggestion is one tap, changes neither book, and can be taken back.
  const suggestions = panel.getByRole('region', { name: hinglish['owner.tally.numbers.suggest'] });
  await expect(suggestions.getByText(/SAMPLE-NEAR/)).toBeVisible();
  await suggestions
    .getByRole('button', { name: new RegExp(`^${hinglish['owner.tally.yes']}`) })
    .click();
  await expect(suggestions).toHaveCount(0);
  await expect(why.getByText(/SAMPLE-NEAR/)).toHaveCount(0);
  await expect(panel.getByText('₹450', { exact: true })).toBeVisible();
  expect(await db.customerLedgerEntry.count({ where: { customerId: ramesh.id } })).toBe(
    entriesBefore,
  );
  expect((await db.tallyLedger.findUniqueOrThrow({ where: { id: party.id } })).closingPaise).toBe(
    -154800n,
  );
  expect((await db.user.findUniqueOrThrow({ where: { id: ramesh.id } })).khataBalancePaise).toBe(
    199800,
  );
  const again = await amounts();
  const newTotal = again.pop()!;
  expect(again.reduce((sum, value) => sum + value, 0n)).toBe(newTotal);
  expect(newTotal).toBe(45000n);
  const matches = panel.getByRole('region', { name: hinglish['owner.tally.numbers.matches'] });
  await expect(matches.getByRole('listitem')).toHaveCount(2);
  await matches.getByRole('button', { name: /SAMPLE-NEAR/ }).click();
  await expect(matches.getByRole('listitem')).toHaveCount(1);
  await expect(
    panel.getByRole('region', { name: hinglish['owner.tally.numbers.suggest'] }),
  ).toBeVisible();
  // A row in the log, never an edit: both the match and its undo stay.
  expect(await db.khataVoucherMatch.count()).toBe(3);

  // Undoing a link asks first, and then it is simply not linked.
  await panel.getByRole('button', { name: hinglish['owner.tally.numbers.unlink'] }).click();
  const ask = page.getByRole('dialog', {
    name: say('owner.tally.numbers.unlinkTitle', { party: 'Sample Ramesh Ledger' }),
  });
  await ask.getByRole('button', { name: hinglish['owner.tally.numbers.unlinkYes'] }).click();
  await expect(panel.getByText(hinglish['owner.crm.tally.notLinked'])).toBeVisible();
  await expect(panel.getByRole('link', { name: hinglish['owner.tally.goParty'] })).toBeVisible();
  await context.close();
});

test('money past 2^53 shows exactly on the customer page and on the Farq list, and adds up', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const accountant = await staff('ACCOUNTANT');
  const large = await customer('Large');
  const small = await customer('Small');
  const firm = await books();
  const party = await ledger(firm.id, 'Sample Large Ledger', -PAST_SAFE);
  await joined(party, large.id);
  await joined(await ledger(firm.id, 'Sample Small Ledger', -9000n), small.id);
  await worked(small.id, {
    appPaise: 0,
    tallyPaise: 9000n,
    differencePaise: -9000n,
    unexplainedPaise: 0n,
    reasons: { TALLY_ONLY: '-9000' },
    tallyAsOf: new Date(),
  });
  await worked(large.id, {
    appPaise: 0,
    tallyPaise: PAST_SAFE,
    differencePaise: -PAST_SAFE,
    unexplainedPaise: -PAST_SAFE,
    reasons: {},
    tallyAsOf: new Date(),
  });
  const { context, page } = await laptop(browser);
  await signIn(page, accountant.digits, '/tally?tab=farq');
  const main = page.locator('main');
  const rows = main.locator('tbody tr');
  await expect(rows).toHaveCount(2, { timeout: 60000 });
  // No reason known goes first.
  await expect(rows.first().getByRole('link', { name: large.name })).toBeVisible();
  await expect(rows.first().getByText(`-${PAST_SAFE_SHOWN}`).first()).toBeVisible();
  await expect(rows.nth(1).getByText(/Sirf Tally mein -₹90/)).toBeVisible();
  await shot(page, 'farq-laptop');
  // Opening one customer goes straight to their numbers.
  await rows.first().getByRole('link', { name: large.name }).click();
  const panel = main.getByRole('region', { name: hinglish['owner.tally.numbers.title'] });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(PAST_SAFE_SHOWN, { exact: true })).toBeVisible();
  await expect(panel.getByText(`-${PAST_SAFE_SHOWN}`, { exact: true }).first()).toBeVisible();
  await expect(panel.getByText(hinglish['owner.tally.numbers.addsUp'])).toBeVisible();
  await expect(main.getByText(`Tally ${PAST_SAFE_SHOWN}`, { exact: false })).toBeVisible();
  await shot(page, 'customer-big-number-laptop');
  await context.close();
});

test('a Tally time just after midnight is that day in India, not the day before', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const owner = await staff('OWNER');
  const someone = await customer('Midnight');
  // 00:30 in India is still the day before in UTC, which is how a date cut from the text goes wrong.
  const late = new Date(`${daysAgo(1)}T00:30:00+05:30`);
  const shown = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(late);
  const firm = await books({ freshAt: late });
  await joined(await ledger(firm.id, 'Sample Midnight Ledger', -5000n), someone.id);
  const supplier = await ledger(firm.id, 'Sample Midnight Supplier', PAST_SAFE, {
    className: 'CREDITOR',
  });
  await db.tallyLedger.update({ where: { id: supplier.id }, data: { closingAsOf: late } });
  const { context, page } = await laptop(browser);
  await signIn(page, owner.digits, `/customers/${someone.id}`);
  const main = page.locator('main');
  await expect(main.getByText(`Tally ₹50 · ${shown} · 00:30 tak`)).toBeVisible({ timeout: 60000 });
  await page.goto(`${desk}/reports/hisaab?tab=suppliers`);
  await expect(main.getByText(PAST_SAFE_SHOWN).first()).toBeVisible();
  await expect(main.getByText(`${shown} · 00:30 tak`)).toBeVisible();
  await context.close();
});

test('while Tally copies no difference shows anywhere, and an old number says it is old', async ({
  browser,
}) => {
  test.setTimeout(240000);
  const owner = await staff('OWNER');
  const copying = await customer('Copying');
  const firm = await books({
    phase: 'BACKFILL',
    copyFrom: daysAgo(100),
    backfillCursor: daysAgo(50),
  });
  const party = await ledger(firm.id, 'Sample Copying Ledger', -5000n);
  await joined(party, copying.id);
  await khata(copying.id, 7000, daysAgo(1));
  // A pass that ran before the copy went back to the start must not surface now.
  await worked(copying.id, {
    appPaise: 7000,
    tallyPaise: 5000n,
    differencePaise: 2000n,
    unexplainedPaise: 0n,
    reasons: { TIMING: '2000' },
    tallyAsOf: new Date(),
  });
  const { context, page } = await laptop(browser);
  await signIn(page, owner.digits, `/customers/${copying.id}?tab=tally`);
  const main = page.locator('main');
  const panel = main.getByRole('region', { name: hinglish['owner.tally.numbers.title'] });
  await expect(panel).toBeVisible({ timeout: 60000 });
  // Both numbers and the time show. What is between them does not, until the copy is done.
  await expect(panel.getByText('₹70', { exact: true })).toBeVisible();
  await expect(panel.getByText('₹50', { exact: true })).toBeVisible();
  await expect(panel.getByText(hinglish['owner.crm.tally.copying'])).toBeVisible();
  await expect(panel.getByText(hinglish['owner.tally.line.total'])).toHaveCount(0);
  await expect(
    panel.getByRole('region', { name: hinglish['owner.tally.numbers.why'] }),
  ).toHaveCount(0);
  await expect(main.getByText(/Khate se farq/)).toHaveCount(0);
  await expect(main.getByText('₹20', { exact: true })).toHaveCount(0);
  const response = await asked(context, `/admin/tally/customers/${copying.id}/numbers`);
  expect((await response.json()).tally.differencePaise).toBeNull();
  await shot(page, 'customer-copying-laptop');
  await page.goto(`${desk}/tally?tab=farq`);
  await expect(main.getByText(hinglish['owner.tally.farq.copying'])).toBeVisible();
  await expect(main.getByRole('link', { name: copying.name })).toHaveCount(0);
  await page.goto(`${desk}/tally?tab=haal`);
  await expect(main.getByText(/Tally copy ho raha hai: 49%/)).toBeVisible();

  // Finished, with an old number: said in words, with the time.
  const fresh = new Date(Date.now() - 3 * 86400000);
  await db.tallyCompany.update({
    where: { id: firm.id },
    data: { phase: 'LIVE', freshAt: fresh },
  });
  await page.goto(`${desk}/customers/${copying.id}?tab=tally`);
  await expect(panel.getByText(/Yeh Tally number purana hai: .* tak ka\./)).toBeVisible();
  await expect(main.getByText(/Yeh Tally number purana hai: .* tak ka\./)).toHaveCount(2);
  await expect(panel.getByText(hinglish['owner.tally.line.total'])).not.toHaveCount(0);
  await shot(page, 'customer-stale-laptop');
  await page.goto(`${desk}/tally?tab=haal`);
  await expect(main.getByText(/Yeh copy purani hai/)).toBeVisible();
  await db.khataRecon.updateMany({ data: { tallyAsOf: fresh } });
  await page.goto(`${desk}/tally?tab=farq`);
  await expect(main.getByText(/^Purana: Tally .* tak$/)).toBeVisible();

  // History rewritten: the number is not to be relied on, and no green word goes with it.
  await db.tallyCompany.update({
    where: { id: firm.id },
    data: { phase: 'MASTERS', rewrittenAt: new Date(), freshAt: new Date() },
  });
  await page.goto(`${desk}/customers/${copying.id}?tab=tally`);
  await expect(panel.getByText(hinglish['owner.tally.numbers.rewritten'])).toBeVisible();
  await expect(panel.getByText(hinglish['owner.tally.numbers.tied'])).toHaveCount(0);
  await context.close();
});

test('a manager and a cashier see no Tally number anywhere, and the API refuses them too', async ({
  browser,
}) => {
  test.setTimeout(300000);
  const someone = await customer('Secret');
  const firm = await books();
  const party = await ledger(firm.id, 'Sample Secret Ledger', -7654300n);
  await joined(party, someone.id);
  await worked(someone.id, {
    appPaise: 0,
    tallyPaise: 7654300n,
    differencePaise: -7654300n,
    unexplainedPaise: 0n,
    reasons: {},
    tallyAsOf: new Date(),
  });
  for (const role of ['MANAGER', 'CASHIER'] as const) {
    const person = await staff(role);
    const { context, page } = await laptop(browser);
    await signIn(page, person.digits, `/customers/${someone.id}?tab=tally`);
    const main = page.locator('main');
    await expect(page.getByRole('heading', { name: someone.name, exact: true })).toBeVisible({
      timeout: 60000,
    });
    // An address cannot open what the job does not include.
    await expect(
      page.getByRole('tab', { name: hinglish['owner.crm.tab.everything'] }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: hinglish['owner.tally.numbers.tab'] })).toHaveCount(
      0,
    );
    await expect(main.getByText(/Tally/)).toHaveCount(0);
    await expect(page.getByText('76,543')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: hinglish['owner.tally.nav'], exact: true }),
    ).toHaveCount(0);
    await page.goto(`${desk}/tally`);
    await expect(page.getByRole('heading', { name: hinglish['owner.notYourPage'] })).toBeVisible();
    await page.goto(`${desk}/more`);
    await expect(
      page.getByRole('link', { name: hinglish['owner.tally.nav'], exact: true }),
    ).toHaveCount(0);
    for (const path of [
      '/admin/tally/status',
      '/admin/tally/health',
      '/admin/tally/parties',
      '/admin/tally/differences',
      `/admin/tally/customers/${someone.id}/numbers`,
      '/admin/tally/suppliers',
    ])
      expect((await asked(context, path)).status(), path).toBe(403);
    expect((await posted(context, `/admin/tally/parties/${party.id}/unlink`)).status()).toBe(403);
    expect((await posted(context, '/admin/tally/devices/pair', { name: 'x' })).status()).toBe(403);
    const facts = await asked(context, `/admin/customers/${someone.id}/crm`);
    expect(JSON.stringify(await facts.json())).not.toMatch(/tally|7654300/i);
    await context.close();
  }

  // A stock keeper is refused the page, and their nav has no word of it.
  const keeper = await staff('STOCK_KEEPER');
  const third = await phone(browser);
  await signIn(third.page, keeper.digits, '/tally');
  await expect(
    third.page.getByRole('heading', { name: hinglish['owner.notYourPage'] }),
  ).toBeVisible({
    timeout: 30000,
  });
  await expect(third.page.getByText(/Tally/)).toHaveCount(0);
  await shot(third.page, 'refused-keeper-phone');
  await third.context.close();

  // The technical operator keeps the PCs running, with no money and no party.
  const tech = await staff('TECH_OPERATOR');
  const fourth = await laptop(browser);
  await db.tallyDevice.updateMany({ data: { state: 'BUSY', caps: { slowMs: 45000 } } });
  await db.tallySyncJob.create({
    data: {
      deviceId: firm.ownerDeviceId!,
      companyId: firm.id,
      kind: 'MASTERS',
      status: 'APPLIED',
      reads: [],
      params: {},
    },
  });
  await signIn(fourth.page, tech.digits, '/tally?tab=farq');
  const hisMain = fourth.page.locator('main');
  await expect(hisMain.getByText(hinglish['owner.tally.techOnly'])).toBeVisible({ timeout: 30000 });
  await expect(fourth.page.getByRole('tab')).toHaveCount(0);
  await expect(
    hisMain.getByText(hinglish['owner.tally.state.BUSY'], { exact: true }),
  ).toBeVisible();
  await expect(hisMain.getByText(say('owner.tally.state.BUSYBody', { seconds: 45 }))).toBeVisible();
  await expect(
    hisMain.getByRole('button', { name: hinglish['owner.tally.connect'] }),
  ).toBeVisible();
  await expect(hisMain.getByText(/₹/)).toHaveCount(0);
  await expect(fourth.page.getByText('76,543')).toHaveCount(0);
  await hisMain.getByText(hinglish['owner.tally.tech.title']).click();
  await expect(hisMain.getByRole('cell', { name: 'MASTERS' })).toBeVisible();
  await shot(fourth.page, 'haal-tech-laptop');
  expect((await asked(fourth.context, '/admin/tally/status')).status()).toBe(403);
  expect((await asked(fourth.context, '/admin/tally/parties')).status()).toBe(403);
  expect((await asked(fourth.context, '/admin/tally/health')).status()).toBe(200);
  await fourth.context.close();

  // The accountant acts on parties and reads the PCs, and cannot change them.
  const accountant = await staff('ACCOUNTANT');
  const fifth = await laptop(browser);
  await signIn(fifth.page, accountant.digits, '/tally');
  const herMain = fifth.page.locator('main');
  await expect(herMain.locator('article').first()).toBeVisible({ timeout: 30000 });
  for (const word of [
    'owner.tally.connect',
    'owner.tally.pauseAll',
    'owner.tally.pausePc',
    'owner.tally.cutOff',
    'owner.tally.company.change',
  ] as const)
    await expect(herMain.getByRole('button', { name: hinglish[word] })).toHaveCount(0);
  await expect(herMain.getByText(hinglish['owner.tally.tech.title'])).toHaveCount(0);
  expect((await posted(fifth.context, '/admin/tally/pause', { paused: true })).status()).toBe(403);
  expect((await asked(fifth.context, '/admin/tally/status')).status()).toBe(200);
  expect((await asked(fifth.context, '/admin/tally/health')).status()).toBe(403);
  // A pending file tells her who decides.
  await db.tallyCompany.create({
    data: { guid: randomUUID(), name: 'Sample Waiting File', ownerDeviceId: firm.ownerDeviceId },
  });
  await fifth.page.reload();
  await expect(herMain.getByText(hinglish['owner.tally.company.pendingNotYours'])).toBeVisible();
  await expect(
    herMain.getByRole('button', { name: hinglish['owner.tally.company.setPrimary'] }),
  ).toHaveCount(0);
  await fifth.context.close();
});

test('a phone holds every Tally screen with nothing off the side', async ({ browser }) => {
  test.setTimeout(240000);
  const owner = await staff('OWNER');
  const long = await customer('Long Named Customer For A Narrow Screen');
  const firm = await books();
  const party = await ledger(
    firm.id,
    'Sample Very Long Ledger Name Traders And Building Material Suppliers',
    -PAST_SAFE,
    { phones: [long.phone] },
  );
  await ledger(firm.id, 'Sample Suggestion Ledger', -5000n, { phones: [long.phone] });
  await ledger(firm.id, 'Sample Plain Ledger', -3000n);
  const linked = await customer('Linked');
  const linkedParty = await ledger(firm.id, 'Sample Linked Ledger', -7000n);
  await joined(linkedParty, linked.id);
  await khata(linked.id, 5000, daysAgo(1));
  await voucher(linkedParty, 'SAMPLE-ONE', -5000n, daysAgo(2));
  await voucher(linkedParty, 'SAMPLE-TWO', -2000n, daysAgo(20));
  await worked(linked.id, {
    appPaise: 5000,
    tallyPaise: 7000n,
    differencePaise: -2000n,
    unexplainedPaise: -PAST_SAFE,
    reasons: { TIMING: '5000', TALLY_ONLY: '-7000' },
    tallyAsOf: new Date(),
  });
  expect(party.id).toBeTruthy();
  const { context, page } = await phone(browser);
  await signIn(page, owner.digits, '/tally');
  const main = page.locator('main');
  await expect(main.locator('article').first()).toBeVisible({ timeout: 60000 });
  await fitsWidth(page);
  await shot(page, 'haal-phone');
  await page.getByRole('tab', { name: hinglish['owner.tally.tab.party'] }).click();
  await expect(main.getByText(PAST_SAFE_SHOWN)).toBeVisible();
  await fitsWidth(page);
  await shot(page, 'party-phone');
  // With no connection the band says so, and a tap that could only fail is not offered.
  const plain = main.locator('article').filter({ hasText: 'Sample Plain Ledger' });
  await context.setOffline(true);
  await expect(page.getByText(hinglish['owner.offline'])).toBeVisible();
  await expect(
    plain.getByRole('button', { name: hinglish['owner.tally.party.notCustomer'] }),
  ).toBeDisabled();
  await expect(
    plain.getByRole('button', { name: hinglish['owner.tally.party.find'] }),
  ).toBeDisabled();
  await context.setOffline(false);
  await expect(
    plain.getByRole('button', { name: hinglish['owner.tally.party.find'] }),
  ).toBeEnabled();
  await main
    .locator('article')
    .filter({ hasText: 'Sample Plain Ledger' })
    .getByRole('button', { name: hinglish['owner.tally.party.find'] })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await fitsWidth(page);
  await shot(page, 'party-search-phone');
  await page.getByRole('dialog').getByRole('button', { name: hinglish['owner.close'] }).click();
  await page.getByRole('tab', { name: hinglish['owner.tally.tab.farq'] }).click();
  await expect(main.getByRole('link', { name: linked.name })).toBeVisible();
  await expect(main.locator('table')).toHaveCount(0);
  await fitsWidth(page);
  await shot(page, 'farq-phone');
  await main.getByRole('link', { name: linked.name }).click();
  const panel = main.getByRole('region', { name: hinglish['owner.tally.numbers.title'] });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole('region', { name: hinglish['owner.tally.numbers.why'] }),
  ).toBeVisible();
  // It sits under the facts on a phone, so whoever came for it is taken to it.
  await expect(panel).toBeInViewport();
  await fitsWidth(page);
  await shot(page, 'customer-numbers-phone');
  await page.goto(`${desk}/customers/${linked.id}`);
  const see = main.getByRole('button', { name: hinglish['owner.tally.see'], exact: true });
  await see.click();
  await expect(panel).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(panel).not.toBeInViewport();
  await see.click();
  await expect(panel).toBeInViewport();
  // A phone reaches the page through Aur.
  await page.goto(`${desk}/more`);
  await page.getByRole('link', { name: hinglish['owner.tally.nav'], exact: true }).last().click();
  await expect(page).toHaveURL(/\/tally/);
  await context.close();
});

test('a PC’s program version is set by a person, and a bad one is refused in words', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const tech = await staff('TECH_OPERATOR');
  const device = await pc({ name: 'Sample Version PC' });
  await db.tallyRelease.create({
    data: {
      version: '1.1.0',
      manifest: 'sample',
      signature: 'c2FtcGxlLXNpZ25hdHVyZS1tYWRlLXVwLWZvci10aGUtdGVzdA==',
      files: {},
      createdById: 'browser-fixture',
    },
  });
  const { context, page } = await laptop(browser);
  await signIn(page, tech.digits, '/tally');
  const main = page.locator('main');
  await main.getByText(hinglish['owner.tally.tech.title']).click({ timeout: 30000 });
  const field = main.getByRole('textbox', {
    name: say('owner.tally.tech.versionFor', { pc: 'Sample Version PC' }),
  });
  const save = main.getByRole('button', { name: hinglish['owner.tally.tech.versionSave'] });
  await field.fill('nonsense');
  await save.click();
  await expect(main.getByText(hinglish['owner.tally.tech.versionBad'])).toBeVisible();
  await field.fill('9.9.9');
  await save.click();
  await expect(main.getByText(hinglish['error.BRIDGE_NO_RELEASE'])).toBeVisible();
  expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: device.id } })).targetVersion).toBe(
    null,
  );
  await field.fill('1.1.0');
  await save.click();
  await expect(
    main.getByText(say('owner.tally.versionNext', { version: '1.1.0' }), { exact: false }),
  ).toBeVisible();
  expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: device.id } })).targetVersion).toBe(
    '1.1.0',
  );
  const upload = main.getByLabel(hinglish['owner.tally.tech.releaseFile']);
  await upload.setInputFiles({
    name: 'release.json',
    mimeType: 'application/json',
    buffer: Buffer.from('this is not json'),
  });
  await expect(page.getByText(hinglish['owner.tally.tech.releaseBad'])).toBeVisible();
  await upload.setInputFiles({
    name: 'release.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: '1.2.0',
        manifest: 'sample-manifest',
        signature: 'c2FtcGxlLXNpZ25hdHVyZS1tYWRlLXVwLWZvci10aGUtdGVzdA==',
        files: { 'main.mjs': 'c2FtcGxl' },
      }),
    ),
  });
  await expect(
    page.getByText(say('owner.tally.tech.releaseAdded', { version: '1.2.0' })),
  ).toBeVisible();
  expect(await db.tallyRelease.count({ where: { version: '1.2.0' } })).toBe(1);
  // Adding a version moves no PC.
  expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: device.id } })).targetVersion).toBe(
    '1.1.0',
  );
  await context.close();
});
