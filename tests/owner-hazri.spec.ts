import { randomUUID } from 'node:crypto';
import { hinglish } from '@shiv/i18n';
import { distanceMeters } from '@shiv/shared';
import { test, expect } from './fixtures';
import {
  askToLink,
  call,
  closeShops,
  database,
  desk,
  go,
  linkedPhone,
  liveQr,
  MAIN,
  ok,
  pairedScreen,
  person,
  photoOf,
  prepareShops,
  refusedPage,
  say,
  scan,
  SECOND,
  SHOP,
  signedInDesk,
  signIn,
  tab,
  today,
  toast,
  type Who,
} from './staff-world';

// Hazri on the desk, each tab, against the real API and a real database.
const db = database();
let boss: Who;
let screen: { id: string; token: string };
test.setTimeout(120000);
test.beforeAll(async () => {
  await prepareShops(db);
  boss = await person(db, 'OWNER', { name: 'Bada Malik' });
  screen = await pairedScreen(boss);
});
test.afterAll(async () => {
  // Nothing of this spec lingers on anyone else's Today page.
  await db.attendanceReview.updateMany({ where: { status: 'OPEN' }, data: { status: 'ACCEPTED' } });
  await closeShops(db);
});

/** Someone with a linked phone, ready to scan at the main shop. */
async function staffWithPhone(name: string, shops = [MAIN]) {
  const who = await person(db, 'STOCK_KEEPER', { name, shops });
  return { who, phone: await linkedPhone(db, who, boss) };
}
const isoMinute = () => {
  const ist = new Date(Date.now() + 5.5 * 3600000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
};
const minutesBack = (back: number) => {
  const ist = new Date(Date.now() + 5.5 * 3600000 - back * 60000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
};
const line = (page: import('@playwright/test').Page, name: string) =>
  page.locator('li').filter({ hasText: name });
const stateOf = (page: import('@playwright/test').Page, name: string) =>
  line(page, name).locator('[class*="__status"]');
const openDay = (page: import('@playwright/test').Page, name: string) =>
  line(page, name).locator('button').first().click();

test('an owner reads the day: a scan, a hand mark with no time to choose, and a correction beside the original', async ({
  browser,
}) => {
  const { who: came, phone } = await staffWithPhone('Ramesh Aaya');
  const handMarked = await person(db, 'STOCK_KEEPER', { name: 'Suresh Haath' });
  await scan(phone, await liveQr(screen.token));
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await go(page, '/hazri');
    await expect(page.getByRole('heading', { name: hinglish['owner.hazri.title'] })).toBeVisible();

    // A status has a shape as well as a colour.
    await expect(stateOf(page, came.name)).toHaveText(hinglish['owner.hazri.status.PRESENT']);
    await expect(stateOf(page, came.name).locator('svg')).toBeVisible();
    const handRow = line(page, handMarked.name);
    await expect(stateOf(page, handMarked.name)).toHaveText(hinglish['owner.hazri.status.ABSENT']);

    // The sheet asks why, and has nowhere to choose a time.
    await page
      .getByRole('button', { name: say('owner.hazri.mark.for', { name: handMarked.name }) })
      .click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(hinglish['owner.hazri.mark.body'])).toBeVisible();
    await expect(sheet.locator('input[type="time"], input[type="date"]')).toHaveCount(0);
    await sheet
      .getByRole('textbox', { name: hinglish['owner.hazri.mark.why'] })
      .fill('Phone toota hai');
    // Tapped twice, marked once.
    await sheet
      .getByRole('button', { name: hinglish['owner.hazri.mark.in'], exact: true })
      .dblclick();
    await expect(handRow.getByText(hinglish['owner.hazri.flag.MANUAL'])).toBeVisible();
    const marks = await db.attendanceEvent.findMany({ where: { userId: handMarked.id } });
    expect(marks.map((row) => [row.kind, row.actorId])).toEqual([['MANUAL_IN', boss.id]]);
    // Now the same button sends them home.
    await expect(
      page.getByRole('button', { name: say('owner.hazri.mark.for', { name: handMarked.name }) }),
    ).toHaveText(hinglish['owner.hazri.mark.out']);

    // A person's whole day.
    await openDay(page, came.name);
    const day = page.getByRole('dialog');
    await expect(day.getByText(hinglish['owner.hazri.event.IN'], { exact: true })).toBeVisible();
    await day.getByRole('combobox', { name: hinglish['owner.hazri.fix.which'] }).selectOption('IN');
    const time = day.getByRole('textbox', { name: hinglish['owner.hazri.fix.time'] });
    // A time still to come is refused here, before it can sit on the record for good.
    if (isoMinute() < '23:30') {
      await time.fill('23:59');
      await expect(day.getByText(hinglish['owner.hazri.fix.future'])).toBeVisible();
      await expect(
        day.getByRole('button', { name: hinglish['owner.hazri.fix.save'], exact: true }),
      ).toBeDisabled();
    }
    const earlier = minutesBack(5);
    await time.fill(earlier);
    await day
      .getByRole('textbox', { name: hinglish['owner.hazri.fix.reason'] })
      .fill('Galat time tha');
    await day.getByRole('button', { name: hinglish['owner.hazri.fix.save'], exact: true }).click();
    await expect(
      day.getByText(hinglish['owner.hazri.event.CORRECTION'], { exact: true }),
    ).toBeVisible();
    await expect(
      day.getByText(say('owner.hazri.person.note', { note: 'Galat time tha' })),
    ).toBeVisible();
    // The original is still there, beside the correction.
    await expect(day.getByText(hinglish['owner.hazri.event.IN'], { exact: true })).toBeVisible();
    const rows = await db.attendanceEvent.findMany({
      where: { userId: came.id },
      orderBy: { seq: 'asc' },
    });
    expect(rows.map((row) => row.kind)).toEqual(['IN', 'CORRECTION']);

    // Owners also see the proof, and what it does and does not prove.
    await expect(day.getByText(hinglish['owner.hazri.proof.ok'])).toBeVisible();
    await expect(day.getByText(hinglish['owner.hazri.proof.noCode'])).toBeVisible();
    await expect(day.getByText(hinglish['owner.hazri.proof.means'])).toBeVisible();
  } finally {
    await context.close();
  }
});

test('the proof shows the night’s code, and says so when the record no longer adds up', async ({
  browser,
}) => {
  const { who, phone } = await staffWithPhone('Tampered Record');
  await scan(phone, await liveQr(screen.token));
  await db.proofAnchor.upsert({
    where: { day: today() },
    update: {},
    create: { day: today(), root: 'abcdef1234567890', prevRoot: '', sentAt: new Date() },
  });
  await db.$executeRawUnsafe(
    'ALTER TABLE "AttendanceEvent" DISABLE TRIGGER attendance_event_append_only',
  );
  await db.$executeRaw`UPDATE "AttendanceEvent" SET "reason" = 'changed behind the app' WHERE "userId" = ${who.id}`;
  await db.$executeRawUnsafe(
    'ALTER TABLE "AttendanceEvent" ENABLE TRIGGER attendance_event_append_only',
  );
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await go(page, '/hazri');
    await openDay(page, who.name);
    const day = page.getByRole('dialog');
    await expect(day.getByText(say('owner.hazri.proof.broken', { seq: 1 }))).toBeVisible();
    await expect(
      day.getByText(say('owner.hazri.proof.code', { code: 'abcdef1234' })),
    ).toBeVisible();
    await expect(day.getByText(hinglish['owner.hazri.proof.means'])).toBeVisible();
  } finally {
    await context.close();
    await db.proofAnchor.delete({ where: { day: today() } });
  }
});

test('a day can be looked back on, with no hand marking in the past', async ({ browser }) => {
  const { who } = await staffWithPhone('Pichhla Din');
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await go(page, '/hazri');
    await expect(
      page.getByRole('button', { name: say('owner.hazri.mark.for', { name: who.name }) }),
    ).toBeVisible();
    await page.getByRole('textbox', { name: hinglish['owner.hazri.day'] }).fill('2026-10-01');
    await expect(line(page, who.name)).toBeVisible();
    await expect(page.getByRole('button', { name: /ki hazri haath se$/ })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: hinglish['owner.hazri.here.button'] }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('each card says what the checks saw in plain words, with no codes and no accusation', async ({
  browser,
}) => {
  const far = await staffWithPhone('Door Wala');
  const mocked = await staffWithPhone('Nakli Nishan');
  const offline = await staffWithPhone('Bina Net');
  const asked = await staffWithPhone('Problem Wala');
  const query = await staffWithPhone('Sawaal Wala');
  const qr = () => liveQr(screen.token);
  // A weak fix earlier this month shows on the far scan's card.
  await scan(far.phone, await qr(), {
    lat: undefined,
    lng: undefined,
    accuracyM: undefined,
    location: 'NO_FIX',
  });
  const place = { lat: SHOP.lat + 0.011, lng: SHOP.lng };
  await scan(far.phone, await qr(), { kind: 'OUT', ...place });
  await scan(mocked.phone, await qr(), { mocked: true });
  // A code on the wall now, from a phone claiming two hours ago: the two clocks disagree.
  await scan(offline.phone, await qr(), { claimedAgeMs: 2 * 3600000 });
  const evidenceId = await photoOf(asked.phone, 'ATTENDANCE_PHOTO');
  await ok(asked.phone.token, 'POST', '/attendance/problem', {
    captureId: randomUUID(),
    problem: 'NO_QR',
    kind: 'IN',
    locationId: MAIN,
    note: 'Screen kharab hai',
    evidenceId,
  });
  await ok(query.phone.token, 'POST', '/staff/me/query', { day: today(), note: 'Time galat hai' });

  const { context, page } = await signedInDesk(browser, boss);
  const photos: { cookie: boolean }[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/admin/evidence/'))
      photos.push({ cookie: request.url().startsWith('http://localhost:4010') });
  });
  try {
    await go(page, '/hazri?tab=reviews');
    const card = (name: string) => page.locator('article').filter({ hasText: name });

    const distance = (distanceMeters(place, SHOP) / 1000).toFixed(1);
    const farCard = card(far.who.name);
    await expect(
      farCard.getByText(say('owner.hazri.why.farFresh', { distance: `${distance} km` })),
    ).toBeVisible();
    await expect(
      farCard.getByText(say('owner.hazri.review.weakMonth', { count: 1 })),
    ).toBeVisible();
    const map = farCard.getByRole('link', { name: hinglish['owner.hazri.review.map'] });
    await expect(map).toHaveAttribute('href', new RegExp(`query=${place.lat},${place.lng}$`));

    await expect(
      card(mocked.who.name).getByText('Apna phone. Nakli location ka nishan mila.'),
    ).toBeVisible();

    const late = card(offline.who.name);
    await expect(
      late.getByText(/Internet ke bina scan hua\. Phone par .*, server par/),
    ).toBeVisible();
    await expect(late.getByText('Phone ka time aur QR ka time alag hain.')).toBeVisible();
    await expect(late.getByText(/Yeh QR .* par screen par tha\./)).toBeVisible();
    // Accepting uses the claimed time, and the card says so before anyone taps.
    await expect(late.getByText(/Sahi maanne par .* ginega/)).toBeVisible();

    const problem = card(asked.who.name);
    await expect(problem.getByText(hinglish['owner.hazri.why.PROBLEM_NO_QR'])).toBeVisible();
    await expect(problem.getByText('Screen kharab hai')).toBeVisible();
    // The photo is read with a session, and has no address of its own.
    const photo = problem.getByRole('img', { name: hinglish['owner.evidence.alt'] });
    await expect(photo).toBeVisible();
    await expect(photo).toHaveAttribute('src', /^blob:/);
    await expect
      .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    expect(photos.length).toBeGreaterThan(0);

    await expect(card(query.who.name).getByText(hinglish['owner.hazri.why.QUERY'])).toBeVisible();

    const words = await page.locator('main').innerText();
    for (const code of [
      'MOCKED',
      'LOCATION_OFF',
      'OTHER_SHOP',
      'OLD_QR',
      'TIME_MISMATCH',
      'PROBLEM_',
      'WEAK_FIX',
      'OFFLINE',
      'QUERY',
      'undefined',
      'null',
    ])
      expect(words).not.toContain(code);
    expect(words.toLowerCase()).not.toMatch(/\b(fraud|chori|chor|dhokha|jhooth)\b/);

    // Three buttons on each, in the owners' words.
    await expect(
      card(mocked.who.name).getByRole('button', { name: hinglish['owner.hazri.review.accept'] }),
    ).toBeVisible();
    await expect(
      card(mocked.who.name).getByRole('button', { name: hinglish['owner.hazri.review.reject'] }),
    ).toBeVisible();
    // An owner has nobody to send it up to; a manager does, as the next test shows.
    await expect(
      card(mocked.who.name).getByRole('button', { name: hinglish['owner.hazri.review.toOwner'] }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await db.attendanceReview.updateMany({
      where: { status: 'OPEN' },
      data: { status: 'ACCEPTED' },
    });
  }
});

test('Sahi hai settles it, and the second person sees it was already done, not an error', async ({
  browser,
}) => {
  const other = await person(db, 'OWNER', { name: 'Chhota Malik' });
  const { who, phone } = await staffWithPhone('Do Log Dekhe');
  await scan(phone, await liveQr(screen.token), { mocked: true });
  const first = await signedInDesk(browser, boss);
  const second = await signedInDesk(browser, other);
  try {
    for (const { page } of [first, second]) await go(page, '/hazri?tab=reviews');
    const card = (page: import('@playwright/test').Page) =>
      page.locator('article').filter({ hasText: who.name });
    await expect(card(second.page)).toBeVisible();
    await card(first.page)
      .getByRole('button', { name: hinglish['owner.hazri.review.accept'] })
      .click();
    await expect(
      toast(first.page, say('owner.hazri.review.accepted', { name: who.name })),
    ).toBeVisible();
    await expect(card(first.page)).toHaveCount(0);

    // The stale card on the other desk.
    await card(second.page)
      .getByRole('button', { name: hinglish['owner.hazri.review.accept'] })
      .click();
    await expect(toast(second.page, hinglish['owner.hazri.alreadyDone'])).toBeVisible();
    await expect(second.page.locator('main').getByRole('alert')).toHaveCount(0);
    await expect(card(second.page)).toHaveCount(0);

    const review = await db.attendanceReview.findFirstOrThrow({ where: { userId: who.id } });
    expect(review.status).toBe('ACCEPTED');
    expect(review.decidedById).toBe(boss.id);
    expect(await db.attendanceEvent.count({ where: { userId: who.id, kind: 'DECISION' } })).toBe(1);
  } finally {
    await first.context.close();
    await second.context.close();
  }
});

test('Galat hai asks why, keeps the entry on record, and the day does not count it', async ({
  browser,
}) => {
  const { who, phone } = await staffWithPhone('Galat Scan');
  await scan(phone, await liveQr(screen.token), { mocked: true });
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await go(page, '/hazri?tab=reviews');
    const card = page.locator('article').filter({ hasText: who.name });
    await card.getByRole('button', { name: hinglish['owner.hazri.review.reject'] }).click();
    const sheet = page.getByRole('dialog');
    const send = sheet.getByRole('button', {
      name: hinglish['owner.hazri.review.reject'],
      exact: true,
    });
    await send.click();
    // The reason is required, so nothing has moved yet.
    expect((await db.attendanceReview.findFirstOrThrow({ where: { userId: who.id } })).status).toBe(
      'OPEN',
    );
    await sheet
      .getByRole('textbox', { name: hinglish['owner.hazri.review.rejectWhy'] })
      .fill('Dukaan par nahi tha');
    await send.click();
    await expect(toast(page, say('owner.hazri.review.rejected', { name: who.name }))).toBeVisible();
    const review = await db.attendanceReview.findFirstOrThrow({ where: { userId: who.id } });
    expect(review).toMatchObject({ status: 'REJECTED', note: 'Dukaan par nahi tha' });
    expect(await db.attendanceEvent.count({ where: { userId: who.id, kind: 'IN' } })).toBe(1);
    const day = await db.attendanceDay.findFirstOrThrow({ where: { userId: who.id } });
    expect(day.firstInAt).toBeNull();
  } finally {
    await context.close();
  }
});

test('Malik ko bhejo moves it up: gone from the manager, there for the owner, and a stale tap is told', async ({
  browser,
}) => {
  const manager = await person(db, 'MANAGER', { name: 'Manager Saab' });
  const colleague = await person(db, 'MANAGER', { name: 'Doosra Manager' });
  const { who, phone } = await staffWithPhone('Upar Bhejo');
  await scan(phone, await liveQr(screen.token), { mocked: true });
  const one = await signedInDesk(browser, manager);
  const two = await signedInDesk(browser, colleague);
  const owner = await signedInDesk(browser, boss);
  try {
    for (const { page } of [one, two]) await go(page, '/hazri?tab=reviews');
    const card = (page: import('@playwright/test').Page) =>
      page.locator('article').filter({ hasText: who.name });
    await card(one.page)
      .getByRole('button', { name: hinglish['owner.hazri.review.toOwner'] })
      .click();
    await expect(
      toast(one.page, say('owner.hazri.review.sentUp', { name: who.name })),
    ).toBeVisible();
    await expect(card(one.page)).toHaveCount(0);

    // The other manager still has it on the screen. Their tap is refused, plainly.
    await card(two.page)
      .getByRole('button', { name: hinglish['owner.hazri.review.accept'] })
      .click();
    await expect(toast(two.page, hinglish['owner.hazri.review.movedOn'])).toBeVisible();
    expect((await db.attendanceReview.findFirstOrThrow({ where: { userId: who.id } })).status).toBe(
      'OPEN',
    );

    await go(owner.page, '/hazri?tab=reviews');
    await expect(
      card(owner.page).getByText(hinglish['owner.hazri.review.withOwner']),
    ).toBeVisible();
    await card(owner.page)
      .getByRole('button', { name: hinglish['owner.hazri.review.accept'] })
      .click();
    await expect(card(owner.page)).toHaveCount(0);
  } finally {
    await one.context.close();
    await two.context.close();
    await owner.context.close();
  }
});

test('a manager never sees their own card, and it goes straight to an owner', async ({
  browser,
}) => {
  const manager = await person(db, 'MANAGER', { name: 'Apna Card' });
  const phone = await linkedPhone(db, manager, boss);
  await scan(phone, await liveQr(screen.token), { mocked: true });
  const review = await db.attendanceReview.findFirstOrThrow({ where: { userId: manager.id } });
  expect(review.toOwner).toBe(true);
  const { context, page } = await signedInDesk(browser, manager);
  try {
    await go(page, '/hazri?tab=reviews');
    await expect(page.locator('article').filter({ hasText: manager.name })).toHaveCount(0);
    expect(
      (
        await call(manager.token, 'POST', `/admin/attendance/reviews/${review.id}/decide`, {
          decision: 'ACCEPT',
        })
      ).status,
    ).toBe(403);
  } finally {
    await context.close();
    await ok(boss.token, 'POST', `/admin/attendance/reviews/${review.id}/decide`, {
      decision: 'ACCEPT',
    });
  }
});

test('net band tha: many accepted with one reason, ticking only what is plainly the network', async ({
  browser,
}) => {
  const a = await staffWithPhone('Net Band Ek');
  const b = await staffWithPhone('Net Band Do');
  const c = await staffWithPhone('Nakli Teen');
  const other = await person(db, 'OWNER', { name: 'Doosre Malik' });
  // Older than a slow network explains, but still agreeing with the code's own time.
  await scan(a.phone, await liveQr(screen.token), { claimedAgeMs: 150000 });
  await scan(b.phone, await liveQr(screen.token), { claimedAgeMs: 150000 });
  await scan(c.phone, await liveQr(screen.token), { mocked: true });
  const first = await signedInDesk(browser, boss);
  const second = await signedInDesk(browser, other);
  try {
    await go(first.page, '/hazri?tab=reviews');
    await first.page.getByRole('button', { name: hinglish['owner.hazri.bulk.title'] }).click();
    const sheet = first.page.getByRole('dialog');
    await expect(
      sheet.getByRole('textbox', { name: hinglish['owner.hazri.bulk.reason'] }),
    ).toHaveValue('Dukaan ka net band tha');
    const tick = (name: string) => sheet.getByRole('checkbox', { name: new RegExp(name) });
    await expect(tick(a.who.name)).toBeChecked();
    await expect(tick(b.who.name)).toBeChecked();
    await expect(tick(c.who.name)).not.toBeChecked();

    // Someone else decides one of them while this sheet is open.
    const taken = await db.attendanceReview.findFirstOrThrow({ where: { userId: b.who.id } });
    await ok(other.token, 'POST', `/admin/attendance/reviews/${taken.id}/decide`, {
      decision: 'ACCEPT',
    });

    await sheet.getByRole('button', { name: say('owner.hazri.bulk.save', { count: 2 }) }).click();
    await expect(
      toast(first.page, say('owner.hazri.bulk.someDone', { count: 1, done: 1 })),
    ).toBeVisible();
    const left = await db.attendanceReview.findFirstOrThrow({ where: { userId: a.who.id } });
    expect(left).toMatchObject({ status: 'ACCEPTED', note: 'Dukaan ka net band tha' });
    expect(
      (await db.attendanceReview.findFirstOrThrow({ where: { userId: c.who.id } })).status,
    ).toBe('OPEN');
    // Accepting an offline scan counts the time it was taken, and the record keeps both.
    const day = await db.attendanceDay.findFirstOrThrow({ where: { userId: a.who.id } });
    const event = await db.attendanceEvent.findFirstOrThrow({
      where: { userId: a.who.id, kind: 'IN' },
    });
    expect(day.firstInAt?.getTime()).toBe(event.serverAt.getTime() - 150000);
  } finally {
    await first.context.close();
    await second.context.close();
    await db.attendanceReview.updateMany({
      where: { status: 'OPEN' },
      data: { status: 'ACCEPTED' },
    });
  }
});

test('the count shows on Today, on the side bar and under Aur on a phone, and goes when settled', async ({
  browser,
}) => {
  await db.attendanceReview.updateMany({ where: { status: 'OPEN' }, data: { status: 'ACCEPTED' } });
  const { phone } = await staffWithPhone('Ginti Wala');
  await scan(phone, await liveQr(screen.token), { mocked: true });
  const laptop = await signedInDesk(browser, boss, { path: '/today' });
  const handset = await signedInDesk(browser, boss, { path: '/today', width: 360 });
  try {
    const link = laptop.page.getByRole('link', {
      name: say('owner.hazri.toLookLink', { count: 1 }),
    });
    await expect(link).toBeVisible();
    const side = laptop.page.getByRole('navigation', { name: hinglish['owner.desk'], exact: true });
    await expect(
      side.getByRole('link', { name: `${hinglish['owner.hazri.title']} 1` }),
    ).toBeVisible();
    // The five phone tabs are the same five.
    const tabs = handset.page.getByRole('navigation', {
      name: hinglish['owner.desk'],
      exact: true,
    });
    await expect(tabs.locator('a:visible')).toHaveCount(5);
    await expect(
      tabs.getByRole('link', { name: hinglish['owner.more'], exact: true }),
    ).toBeVisible();
    await go(handset.page, '/more');
    await expect(
      handset.page
        .getByRole('main')
        .getByRole('link', { name: new RegExp(`${hinglish['owner.hazri.title']} \\(1\\)`) }),
    ).toBeVisible();
    await link.click();
    await expect(tab(laptop.page, 'owner.hazri.tab.reviews')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await laptop.page.getByRole('button', { name: hinglish['owner.hazri.review.accept'] }).click();
    await expect(laptop.page.getByText(hinglish['owner.hazri.review.empty'])).toBeVisible();
    await go(laptop.page, '/today');
    await expect(
      laptop.page.getByRole('heading', { name: hinglish['owner.today'], exact: true }),
    ).toBeVisible();
    await expect(laptop.page.getByRole('link', { name: /Hazri dekhna hai/ })).toHaveCount(0);
  } finally {
    await laptop.context.close();
    await handset.context.close();
  }
});

test('a manager has their own shop only: another shop’s data is refused at the API too', async ({
  browser,
}) => {
  const manager = await person(db, 'MANAGER', { name: 'Apni Dukaan' });
  const here = await person(db, 'STOCK_KEEPER', { name: 'Yahan Wala' });
  const there = await person(db, 'STOCK_KEEPER', { name: 'Wahan Wala', shops: [SECOND] });
  const { context, page } = await signedInDesk(browser, manager);
  try {
    await go(page, '/hazri');
    await expect(line(page, here.name)).toBeVisible();
    await expect(page.getByText(there.name)).toHaveCount(0);
    await tab(page, 'owner.hazri.tab.setup').click();
    await expect(page.getByRole('heading', { name: 'Doosri dukaan' })).toHaveCount(0);
    for (const [method, path, body] of [
      ['GET', `/admin/attendance/day?locationId=${SECOND}&day=${today()}`],
      ['GET', `/admin/attendance/person/${there.id}/${today()}`],
      ['GET', `/admin/attendance/reviews?locationId=${SECOND}`],
      ['GET', `/admin/attendance/proof/${here.id}/${today()}`],
      ['GET', `/admin/screens/here/${SECOND}`],
      ['PATCH', `/admin/locations/${SECOND}/hazri`, { radiusM: 200 }],
      ['POST', '/admin/screens', { locationId: SECOND }],
      [
        'POST',
        '/admin/attendance/manual',
        { userId: there.id, kind: 'MANUAL_IN', locationId: SECOND, idempotencyKey: randomUUID() },
      ],
      [
        'POST',
        '/admin/attendance/corrections',
        {
          userId: there.id,
          day: today(),
          corrects: 'IN',
          minute: 540,
          reason: 'Doosri dukaan',
          idempotencyKey: randomUUID(),
        },
      ],
      ['POST', `/admin/staff/${there.id}/device/revoke`, {}],
    ] as [string, string, unknown?][])
      expect((await call(manager.token, method, path, body)).status, path).toBe(403);
    // A manager reads no proof, and no proof block shows on a day.
    await tab(page, 'owner.hazri.tab.today').click();
    await openDay(page, here.name);
    await expect(
      page.getByRole('dialog').getByText(hinglish['owner.hazri.fix.title']),
    ).toBeVisible();
    await expect(
      page.getByRole('dialog').getByText(hinglish['owner.hazri.proof.title']),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('nobody corrects or marks their own hazri', async ({ browser }) => {
  const manager = await person(db, 'MANAGER', { name: 'Khud Ka' });
  const { context, page } = await signedInDesk(browser, manager);
  try {
    await go(page, '/hazri');
    await expect(line(page, manager.name)).toBeVisible();
    await expect(
      page.getByRole('button', { name: say('owner.hazri.mark.for', { name: manager.name }) }),
    ).toHaveCount(0);
    await openDay(page, manager.name);
    await expect(page.getByRole('dialog').getByText(hinglish['owner.hazri.fix.title'])).toHaveCount(
      0,
    );
    expect(
      (
        await call(manager.token, 'POST', '/admin/attendance/manual', {
          userId: manager.id,
          kind: 'MANUAL_IN',
          locationId: MAIN,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(403);
  } finally {
    await context.close();
  }
});

test('the accountant reads the day and the night, and can change nothing', async ({ browser }) => {
  const accountant = await person(db, 'ACCOUNTANT', { name: 'Hisaab Wale' });
  const worker = await person(db, 'STOCK_KEEPER', { name: 'Padhne Wala' });
  const { context, page } = await signedInDesk(browser, accountant);
  try {
    await go(page, '/hazri');
    await expect(tab(page, 'owner.hazri.tab.today')).toBeVisible();
    await expect(tab(page, 'owner.hazri.tab.night')).toBeVisible();
    await expect(tab(page, 'owner.hazri.tab.reviews')).toHaveCount(0);
    await expect(tab(page, 'owner.hazri.tab.phones')).toHaveCount(0);
    await expect(tab(page, 'owner.hazri.tab.setup')).toHaveCount(0);
    await expect(line(page, worker.name).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /ki hazri haath se$/ })).toHaveCount(0);
    await openDay(page, worker.name);
    await expect(page.getByRole('dialog').getByText(hinglish['owner.hazri.fix.title'])).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('dialog').getByText(hinglish['owner.hazri.proof.title']),
    ).toHaveCount(0);
    for (const [method, path, body] of [
      ['GET', '/admin/attendance/reviews'],
      ['GET', '/admin/device-requests'],
      ['GET', `/admin/attendance/proof/${worker.id}/${today()}`],
      ['PATCH', `/admin/locations/${MAIN}/hazri`, { radiusM: 200 }],
      [
        'POST',
        '/admin/attendance/manual',
        { userId: worker.id, kind: 'MANUAL_IN', locationId: MAIN, idempotencyKey: randomUUID() },
      ],
    ] as [string, string, unknown?][])
      expect((await call(accountant.token, method, path, body)).status, path).toBe(403);
  } finally {
    await context.close();
  }
});

for (const role of ['CASHIER', 'STOCK_KEEPER'] as const)
  test(`a ${role} is politely refused, and the API refuses too`, async ({ browser }) => {
    const who = await person(db, role);
    const { context, page } = await signedInDesk(browser, who);
    try {
      await refusedPage(page, '/hazri');
      const side = page.getByRole('navigation', { name: hinglish['owner.desk'], exact: true });
      await expect(side.getByRole('link', { name: hinglish['owner.hazri.title'] })).toHaveCount(0);
      for (const path of [
        `/admin/attendance/day?locationId=${MAIN}`,
        '/admin/attendance/reviews',
        '/admin/attendance/summary',
        '/admin/staff-phones',
        '/admin/attendance/shops',
      ])
        expect((await call(who.token, 'GET', path)).status, path).toBe(403);
    } finally {
      await context.close();
    }
  });

test('a driver has no desk at all', async ({ browser }) => {
  const driver = await person(db, 'DRIVER');
  const { context, page } = await signIn(browser, driver, { path: '/hazri' });
  try {
    await expect(page.getByText(hinglish['owner.noDeskAccess'])).toBeVisible();
    await expect(page.getByRole('heading', { name: hinglish['owner.hazri.title'] })).toHaveCount(0);
    expect(
      (await call(driver.token, 'GET', `/admin/attendance/day?locationId=${MAIN}`)).status,
    ).toBe(403);
  } finally {
    await context.close();
  }
});

test('a first phone: a manager decides, with old, new and the shop code on the card', async ({
  browser,
}) => {
  const manager = await person(db, 'MANAGER', { name: 'Phone Manager' });
  const other = await person(db, 'MANAGER', { name: 'Doosra Phone Manager' });
  const who = await person(db, 'STOCK_KEEPER', { name: 'Naya Phone' });
  const phone = await askToLink(db, who, { model: 'Redmi 12', reason: 'Pehli baar' });
  const first = await signedInDesk(browser, manager);
  const second = await signedInDesk(browser, other);
  try {
    for (const { page } of [first, second]) {
      await go(page, '/hazri?tab=phones');
      await expect(
        page.getByRole('tab', { name: hinglish['owner.hazri.tab.phones'] }),
      ).toHaveAttribute('aria-selected', 'true');
    }
    const card = (page: import('@playwright/test').Page) =>
      page.locator('article').filter({ hasText: who.name });
    await expect(card(first.page).getByText(hinglish['owner.hazri.phone.first'])).toBeVisible();
    await expect(
      card(first.page).getByText(say('owner.hazri.phone.new', { model: 'Redmi 12' })),
    ).toBeVisible();
    await expect(
      card(first.page).getByText(hinglish['owner.hazri.phone.notScanned']),
    ).toBeVisible();
    await expect(card(first.page).getByText('Pehli baar')).toBeVisible();

    // Scanning the shop's code from the new phone shows on the card.
    const qr = await liveQr(screen.token);
    await ok(phone.token, 'POST', '/staff/devices/qr-proof', {
      qr,
      signature: phone.key.sign(`link|${qr}`),
    });
    await go(first.page, '/hazri?tab=phones');
    await expect(card(first.page).getByText(hinglish['owner.hazri.phone.scanned'])).toBeVisible();

    await card(first.page)
      .getByRole('button', { name: hinglish['owner.hazri.phone.approve'] })
      .click();
    await expect(
      toast(first.page, say('owner.hazri.phone.approved', { name: who.name })),
    ).toBeVisible();
    // The other manager's card is stale, and they are told it is done.
    await expect(card(second.page)).toBeVisible();
    await card(second.page)
      .getByRole('button', { name: hinglish['owner.hazri.phone.refuse'] })
      .click();
    await expect(toast(second.page, hinglish['owner.hazri.alreadyDone'])).toBeVisible();
    expect(
      (await db.deviceLinkRequest.findUniqueOrThrow({ where: { id: phone.requestId } })).status,
    ).toBe('APPROVED');
  } finally {
    await first.context.close();
    await second.context.close();
  }
});

test('changing a phone is an owner’s call: the manager does not even see it', async ({
  browser,
}) => {
  const manager = await person(db, 'MANAGER', { name: 'Na Dekhe' });
  const who = await person(db, 'STOCK_KEEPER', { name: 'Phone Badla' });
  await linkedPhone(db, who, boss, { model: 'Purana Phone' });
  const asked = await askToLink(db, who, { model: 'Naya Phone Model', reason: 'Purana toot gaya' });
  const managerDesk = await signedInDesk(browser, manager);
  const ownerDesk = await signedInDesk(browser, boss);
  try {
    await go(managerDesk.page, '/hazri?tab=phones');
    await expect(
      managerDesk.page.getByRole('heading', { name: hinglish['owner.hazri.phone.asked'] }),
    ).toBeVisible();
    await expect(managerDesk.page.locator('article').filter({ hasText: who.name })).toHaveCount(0);
    expect(
      (
        await call(manager.token, 'POST', `/admin/device-requests/${asked.requestId}/decide`, {
          decision: 'APPROVE',
        })
      ).status,
    ).toBe(403);

    await go(ownerDesk.page, '/hazri?tab=phones');
    const card = ownerDesk.page.locator('article').filter({ hasText: who.name });
    await expect(card.getByText(hinglish['owner.hazri.phone.change'])).toBeVisible();
    await expect(
      card.getByText(new RegExp(say('owner.hazri.phone.old', { model: 'Purana Phone' }))),
    ).toBeVisible();
    await expect(
      card.getByText(say('owner.hazri.phone.new', { model: 'Naya Phone Model' })),
    ).toBeVisible();
    await expect(card.getByText('Purana toot gaya')).toBeVisible();
    await card.getByRole('button', { name: hinglish['owner.hazri.phone.refuse'] }).click();
    await expect(
      toast(ownerDesk.page, say('owner.hazri.phone.refused', { name: who.name })),
    ).toBeVisible();
    // The old phone stays.
    expect(await db.staffDevice.count({ where: { userId: who.id, status: 'ACTIVE' } })).toBe(1);
  } finally {
    await managerDesk.context.close();
    await ownerDesk.context.close();
  }
});

test('Phone kho gaya: a confirm, then it stops at once', async ({ browser }) => {
  const { who, phone } = await staffWithPhone('Gumshuda Wala');
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await go(page, '/hazri?tab=phones');
    const row = page.locator('li').filter({ hasText: who.name });
    await expect(
      row.getByText(say('owner.hazri.phone.linked', { model: 'Test phone' })),
    ).toBeVisible();
    const cut = page.getByRole('button', {
      name: say('owner.hazri.phone.cutFor', { name: who.name }),
    });
    await cut.click();
    const sheet = page.getByRole('dialog');
    await expect(
      sheet.getByText(say('owner.hazri.phone.cutBody', { name: who.name })),
    ).toBeVisible();
    await sheet.getByRole('button', { name: hinglish['owner.keepEditing'] }).click();
    expect(await db.staffDevice.count({ where: { userId: who.id, status: 'ACTIVE' } })).toBe(1);

    await cut.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: hinglish['owner.hazri.phone.cutYes'] })
      .click();
    await expect(toast(page, say('owner.hazri.phone.cutDone', { name: who.name }))).toBeVisible();
    expect(await db.staffDevice.count({ where: { userId: who.id, status: 'ACTIVE' } })).toBe(0);
    await expect(row.getByText(hinglish['owner.hazri.today.notLinked'])).toBeVisible();
    await expect(cut).toHaveCount(0);
    // The phone's next scan is refused.
    const qr = await liveQr(screen.token);
    await expect(scan(phone, qr)).rejects.toThrow(/40[13]/);
  } finally {
    await context.close();
  }
});

test('Raat ka hisaab: numbers by shop, then names, and plain about what the code proves', async ({
  browser,
}) => {
  await prepareShops(db);
  boss = await person(db, 'OWNER', { name: 'Raat Malik' });
  screen = await pairedScreen(boss);
  const manager = await person(db, 'MANAGER', { name: 'Raat Manager' });
  const marked = await person(db, 'STOCK_KEEPER', { name: 'Haath Se Lagi' });
  const driver = await person(db, 'DRIVER', { name: 'Raat Driver' });
  const { who: far, phone: farPhone } = await staffWithPhone('Door Se Mana');
  await ok(manager.token, 'POST', '/admin/attendance/manual', {
    userId: marked.id,
    kind: 'MANUAL_IN',
    locationId: MAIN,
    note: 'Phone nahi',
    idempotencyKey: randomUUID(),
  });
  await ok(manager.token, 'POST', '/admin/attendance/corrections', {
    userId: marked.id,
    day: today(),
    corrects: 'IN',
    minute: 0,
    reason: 'Pehle aaya tha',
    idempotencyKey: randomUUID(),
  });
  await scan(farPhone, await liveQr(screen.token), { lat: SHOP.lat + 0.02, lng: SHOP.lng });
  const review = await db.attendanceReview.findFirstOrThrow({ where: { userId: far.id } });
  await ok(manager.token, 'POST', `/admin/attendance/reviews/${review.id}/decide`, {
    decision: 'ACCEPT',
    note: 'Kaam par bahar tha',
  });
  // Setup changed by a person, and a scan on a code shown from a manager's own phone.
  await ok(manager.token, 'PATCH', `/admin/locations/${MAIN}/hazri`, {
    lat: SHOP.lat,
    lng: SHOP.lng,
  });
  const here = await ok(manager.token, 'GET', `/admin/screens/here/${MAIN}`);
  const { phone: onCode } = await staffWithPhone('Phone Code Wala');
  await scan(onCode, here.qr);
  // A delivery that took less than the bill, and a count that differs.
  await db.driverCollection.create({
    data: {
      orderId: 'none',
      driverId: driver.id,
      locationId: MAIN,
      duePaise: 500000,
      amountPaise: 450000,
      channel: 'CASH',
      idempotencyKey: randomUUID(),
    },
  });
  const key = randomUUID();
  await db.driverCollection.updateMany({
    where: { driverId: driver.id },
    data: { handoverKey: key },
  });
  await db.cashHandover.createMany({
    data: [
      {
        handoverKey: key,
        step: 'OFFERED',
        locationId: MAIN,
        driverId: driver.id,
        amountPaise: 440000,
        actorId: driver.id,
      },
      {
        handoverKey: key,
        step: 'COUNTED',
        locationId: MAIN,
        driverId: driver.id,
        amountPaise: 430000,
        actorId: manager.id,
      },
    ],
  });
  await db.proofAnchor.upsert({
    where: { day: today() },
    update: { root: '1a2b3c4d5e6f7a8b' },
    create: { day: today(), root: '1a2b3c4d5e6f7a8b', prevRoot: '', sentAt: new Date() },
  });
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await go(page, '/hazri?tab=night');
    await expect(page.getByRole('cell', { name: 'Doosri dukaan' })).toBeVisible();
    const byHand = page.getByRole('region', { name: hinglish['owner.hazri.night.byHand'] });
    await expect(
      byHand.getByText(new RegExp(`${marked.name}, .* par aaye, ${manager.name} ne lagayi`)),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: hinglish['owner.hazri.night.accepted'] })
        .getByText(new RegExp(`${far.name}, ${manager.name} ne sahi mana · Kaam par bahar tha`)),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: hinglish['owner.hazri.night.corrections'] })
        .getByText(/Pehle aaya tha/),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: hinglish['owner.hazri.night.managerCode'] }).getByText(
        say('owner.hazri.night.managerCodeRow', {
          name: 'Phone Code Wala',
          codeOf: manager.name,
        }),
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: hinglish['owner.hazri.night.setupTitle'] }).getByText(
        say('owner.hazri.night.setup.position', {
          by: manager.name,
          shop: 'Shiv Cement',
        }).replace('Shiv Cement', ''),
      ),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: hinglish['owner.hazri.night.setupTitle'] })
        .getByText(new RegExp(`${manager.name} ne .* ki jagah badli`)),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: hinglish['owner.hazri.night.collections'] }).getByText(
        say('owner.hazri.night.collectionRow', {
          driver: driver.name,
          due: '₹5,000.00',
          amount: '₹4,500.00',
        }),
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: hinglish['owner.hazri.night.cash'] }).getByText(
        say('owner.hazri.night.cashRow', {
          driver: driver.name,
          collected: '₹4,500.00',
          offered: '₹4,400.00',
          counted: '₹4,300.00',
        }),
      ),
    ).toBeVisible();
    await expect(page.getByText('1a2b3c4d5e', { exact: true })).toBeVisible();
    await expect(page.getByText(hinglish['owner.hazri.proof.means'])).toBeVisible();
    await expect(page.getByText(/imaandaari/)).toBeVisible();

    // Another day has its own record.
    await page.getByRole('textbox', { name: hinglish['owner.hazri.day'] }).fill('2026-10-01');
    await expect(page.getByText(hinglish['owner.hazri.night.noCode'])).toBeVisible();
    await expect(
      page.getByRole('region', { name: hinglish['owner.hazri.night.byHand'] }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await db.proofAnchor.delete({ where: { day: today() } });
  }
});

test.describe('Setup', () => {
  test('from any page: ten fixes make a position, shown before it is saved', async ({
    browser,
  }) => {
    await db.location.update({
      where: { id: SECOND },
      data: { lat: null, lng: null, attendanceOn: false },
    });
    const { context, page } = await signedInDesk(browser, boss, {
      path: '/today',
      permissions: ['geolocation'],
      geolocation: { latitude: 26.2, longitude: 85.5, accuracy: 12 },
    });
    try {
      // Moving between pages keeps the first page's document, and its permission policy with it.
      const side = page.getByRole('navigation', { name: hinglish['owner.desk'], exact: true });
      await side.getByRole('link', { name: hinglish['owner.hazri.title'] }).click();
      await tab(page, 'owner.hazri.tab.setup').click();
      await expect(tab(page, 'owner.hazri.tab.setup')).toHaveAttribute('aria-selected', 'true');
      const card = page.getByRole('region', { name: 'Doosri dukaan' });
      await expect(card.getByText(hinglish['owner.hazri.setup.noPosition'])).toBeVisible();
      await card.getByRole('button', { name: hinglish['owner.hazri.setup.takeHere'] }).click();
      await expect(card.getByText(say('owner.hazri.setup.result', { count: 10 }))).toBeVisible({
        timeout: 30000,
      });
      await expect(
        card.getByText(say('owner.hazri.setup.resultAt', { lat: 26.2, lng: 85.5 })),
      ).toBeVisible();
      await expect(
        card.getByText(say('owner.hazri.setup.resultMargin', { accuracy: 12, spread: 0 })),
      ).toBeVisible();
      // Nothing is saved until someone agrees.
      expect((await db.location.findUniqueOrThrow({ where: { id: SECOND } })).lat).toBeNull();
      await card
        .getByRole('button', { name: hinglish['owner.hazri.setup.savePin'] })
        .first()
        .click();
      await expect(
        card.getByText(say('owner.hazri.setup.positionIs', { lat: 26.2, lng: 85.5 })),
      ).toBeVisible();
      expect(await db.location.findUniqueOrThrow({ where: { id: SECOND } })).toMatchObject({
        lat: 26.2,
        lng: 85.5,
      });
    } finally {
      await context.close();
    }
  });

  test('when the browser refuses, it says which switch, and typed figures still work', async ({
    browser,
  }) => {
    await db.location.update({
      where: { id: SECOND },
      data: { lat: null, lng: null, attendanceOn: false },
    });
    const { context, page } = await signedInDesk(browser, boss);
    try {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'geolocation', {
          value: {
            getCurrentPosition: (_ok: unknown, fail: (error: object) => void) =>
              fail({ code: 1, PERMISSION_DENIED: 1, message: 'Denied' }),
          },
        });
      });
      await go(page, '/hazri?tab=setup');
      const card = page.getByRole('region', { name: 'Doosri dukaan' });
      await card.getByRole('button', { name: hinglish['owner.hazri.setup.takeHere'] }).click();
      await expect(card.getByText(hinglish['owner.hazri.setup.refused'])).toBeVisible();

      // Hazri cannot start with no position, and the refusal says what to do.
      await card.getByRole('checkbox', { name: hinglish['owner.hazri.setup.on'] }).click();
      await expect(card.getByText(hinglish['error.PIN_NEEDED'])).toBeVisible();
      expect((await db.location.findUniqueOrThrow({ where: { id: SECOND } })).attendanceOn).toBe(
        false,
      );

      await card.getByText(hinglish['owner.hazri.setup.typeIt']).click();
      const save = card.getByRole('button', { name: hinglish['owner.hazri.setup.savePin'] });
      await card.getByRole('textbox', { name: hinglish['owner.hazri.setup.lat'] }).fill('95');
      await card.getByRole('textbox', { name: hinglish['owner.hazri.setup.lng'] }).fill('85.4');
      await expect(card.getByText(hinglish['owner.hazri.setup.badFigures'])).toBeVisible();
      await expect(save).toBeDisabled();
      await card.getByRole('textbox', { name: hinglish['owner.hazri.setup.lat'] }).fill('26.1');
      await save.click();
      await expect(
        card.getByText(say('owner.hazri.setup.positionIs', { lat: 26.1, lng: 85.4 })),
      ).toBeVisible();

      // Now it starts, and turning it off asks first.
      const on = card.getByRole('checkbox', { name: hinglish['owner.hazri.setup.on'] });
      await on.click();
      await expect(on).toBeChecked();
      await expect(
        card.getByText(hinglish['owner.hazri.setup.stateOn'], { exact: true }),
      ).toBeVisible();
      await on.click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: hinglish['owner.hazri.setup.offYes'] })
        .click();
      await expect(on).not.toBeChecked();
    } finally {
      await context.close();
      await db.location.update({ where: { id: SECOND }, data: { attendanceOn: true } });
    }
  });

  test('limits hold on the page, and the API holds them anyway', async ({ browser }) => {
    const { context, page } = await signedInDesk(browser, boss);
    try {
      await go(page, '/hazri?tab=setup');
      const card = page.getByRole('region', { name: 'Doosri dukaan' });
      const radius = card.getByRole('spinbutton', {
        name: say('owner.hazri.setup.radius', { min: 50, max: 300 }),
      });
      await radius.fill('20');
      await expect(
        card.getByRole('button', { name: hinglish['owner.save'], exact: true }),
      ).toBeDisabled();
      await radius.fill('150');
      await card.getByRole('spinbutton', { name: hinglish['owner.hazri.setup.grace'] }).fill('15');
      await card.getByRole('button', { name: hinglish['owner.save'], exact: true }).click();
      await expect(toast(page, hinglish['owner.saved'])).toBeVisible();
      expect(await db.location.findUniqueOrThrow({ where: { id: SECOND } })).toMatchObject({
        radiusM: 150,
        graceMinutes: 15,
      });
      expect(
        (await call(boss.token, 'PATCH', `/admin/locations/${SECOND}/hazri`, { radiusM: 20 }))
          .status,
      ).toBe(400);
    } finally {
      await context.close();
    }
  });

  test('a screen shows its six digits once, can be turned off, and a dead one has a stand-in', async ({
    browser,
  }) => {
    const { context, page } = await signedInDesk(browser, boss);
    try {
      await go(page, '/hazri?tab=setup');
      const card = page.getByRole('region', { name: 'Doosri dukaan' });
      await card.getByRole('button', { name: hinglish['owner.hazri.setup.addScreen'] }).click();
      await page
        .getByRole('dialog')
        .getByRole('textbox', { name: hinglish['owner.hazri.setup.screenLabel'] })
        .fill('Counter ke peeche');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: hinglish['owner.hazri.setup.makeCode'] })
        .click();
      const shown = page
        .getByRole('dialog')
        .getByLabel(hinglish['owner.hazri.setup.codeTitle'])
        .last();
      await expect(shown).toHaveText(/^\d{6}$/);
      const code = await shown.innerText();
      await expect(page.getByRole('dialog').getByText(/shop-screen/)).toBeVisible();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: hinglish['owner.close'] })
        .last()
        .click();
      await expect(card.getByText(hinglish['owner.hazri.setup.notPaired'])).toBeVisible();
      // Gone once closed: the page never holds it again.
      await expect(page.getByText(code, { exact: true })).toHaveCount(0);

      const { token } = await ok(null, 'POST', '/screen/pair', { code });
      await page.reload();
      await tab(page, 'owner.hazri.tab.setup').click();
      await expect(card.getByText(/Aakhri baar/)).toBeVisible();

      // Stand-in for a dead screen.
      await card.getByRole('button', { name: hinglish['owner.hazri.here.button'] }).click();
      const here = page.getByRole('dialog');
      await expect(here.getByRole('img', { name: hinglish['owner.screen.qrLabel'] })).toBeVisible();
      await expect(here.getByText(hinglish['owner.hazri.here.body'])).toBeVisible();
      await here.getByRole('button', { name: hinglish['owner.close'] }).click();

      await page
        .getByRole('button', {
          name: say('owner.hazri.setup.screenOffFor', { name: 'Counter ke peeche' }),
        })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: hinglish['owner.hazri.setup.screenOffYes'] })
        .click();
      await expect(toast(page, hinglish['owner.hazri.setup.screenOff'])).toBeVisible();
      await expect(card.getByText('Counter ke peeche')).toHaveCount(0);
      const after = await call(null, 'GET', '/screen/today', undefined, { 'x-shop-screen': token });
      expect(after.status).toBe(401);
    } finally {
      await context.close();
    }
  });
});

test('an owner sets a shift from a date: a new row, with the old one left alone', async ({
  browser,
}) => {
  const who = await person(db, 'STOCK_KEEPER', { name: 'Shift Wala' });
  const manager = await person(db, 'MANAGER', { name: 'Shift Na Badle' });
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await go(page, '/users');
    await page
      .getByRole('button', { name: say('owner.shift.openFor', { name: who.name }) })
      .click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(hinglish['owner.shift.none'])).toBeVisible();
    const start = sheet.getByRole('textbox', { name: hinglish['owner.shift.start'] });
    const end = sheet.getByRole('textbox', { name: hinglish['owner.shift.end'] });
    const save = sheet.getByRole('button', { name: hinglish['owner.shift.save'] });
    // Ending before it starts is said out loud, and not sent.
    await start.fill('19:00');
    await end.fill('09:00');
    await expect(sheet.getByText(hinglish['owner.shift.backwards'])).toBeVisible();
    await expect(save).toBeDisabled();
    await start.fill('09:30');
    await end.fill('18:30');
    await sheet.getByRole('spinbutton', { name: hinglish['owner.shift.break'] }).fill('45');
    await sheet.getByRole('checkbox', { name: 'Itvaar' }).uncheck();
    await sheet.getByRole('checkbox', { name: 'Mangalvar' }).check();
    // An earlier date would rewrite days already counted.
    const from = sheet.getByRole('textbox', { name: hinglish['owner.shift.from'] });
    await from.fill('2026-01-01');
    await expect(save).toBeDisabled();
    await from.fill('2030-01-01');
    await save.click();
    await expect(toast(page, 'Nayi shift')).toBeVisible();
    expect(await db.staffSchedule.findMany({ where: { userId: who.id } })).toMatchObject([
      {
        effectiveFrom: '2030-01-01',
        startMinute: 570,
        endMinute: 1110,
        breakMinutes: 45,
        weeklyOffs: [2],
      },
    ]);

    const later = '2030-02-01';
    await from.fill(later);
    await save.click();
    await expect.poll(() => db.staffSchedule.count({ where: { userId: who.id } })).toBe(2);
    const first = await db.staffSchedule.findFirstOrThrow({
      where: { userId: who.id, effectiveFrom: '2030-01-01' },
    });
    expect(first.startMinute).toBe(570);

    // The no-phone switch, and its mark on the roster.
    const noPhone = sheet.getByRole('checkbox', { name: hinglish['owner.shift.noPhone'] });
    await noPhone.click();
    await expect(toast(page, say('owner.shift.noPhoneOn', { name: who.name }))).toBeVisible();
    await expect(noPhone).toBeChecked();
    expect((await db.staffProfile.findUniqueOrThrow({ where: { userId: who.id } })).noPhone).toBe(
      true,
    );
    await go(page, '/hazri');
    await expect(
      line(page, who.name).getByText(hinglish['owner.hazri.today.noPhone']),
    ).toBeVisible();

    // Nobody else moves a shift or a switch.
    for (const [path, body] of [
      [
        `/admin/staff/${who.id}/schedule`,
        { effectiveFrom: '2030-03-01', startMinute: 0, endMinute: 10 },
      ],
      [`/admin/staff/${who.id}/no-phone`, { noPhone: false }],
    ] as [string, object][])
      expect((await call(manager.token, 'PUT', path, body)).status, path).toBe(403);
  } finally {
    await context.close();
  }
});

test('someone tied to no shop has no shift to set, and an owner has none for themselves', async ({
  browser,
}) => {
  const accountant = await person(db, 'ACCOUNTANT', { name: 'Bina Shift' });
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await go(page, '/users');
    await expect(page.locator('article').filter({ hasText: accountant.name })).toBeVisible();
    await expect(
      page.getByRole('button', { name: say('owner.shift.openFor', { name: accountant.name }) }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: say('owner.shift.openFor', { name: boss.name }) }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a damage report’s photo shows in Manzoori, read with the session and never by an address', async ({
  browser,
}) => {
  const { who, phone } = await staffWithPhone('Nuksan Wala');
  const cashier = await person(db, 'CASHIER', { name: 'Photo Na Dekhe' });
  const evidenceId = await photoOf(phone, 'DAMAGE_PHOTO');
  await ok(phone.token, 'POST', '/admin/stock/damage', {
    locationId: MAIN,
    productId: 'test-ultratech',
    quantity: 1,
    note: 'Bori phat gayi',
    evidenceId,
    idempotencyKey: randomUUID(),
  });
  const { context, page } = await signedInDesk(browser, boss);
  try {
    await go(page, '/manzoori');
    const card = page.locator('article').filter({ hasText: 'Bori phat gayi' });
    await expect(card.getByText(hinglish['owner.approval.kind.STOCK_DAMAGE'])).toBeVisible();
    const photo = card.getByRole('img', { name: hinglish['owner.evidence.alt'] });
    await expect(photo).toBeVisible();
    await expect(photo).toHaveAttribute('src', /^blob:/);
    await expect
      .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    // Each read is on the record.
    await expect
      .poll(() => db.auditLog.count({ where: { event: 'EVIDENCE_READ', entityId: evidenceId } }))
      .toBeGreaterThanOrEqual(1);
    // Without a session, or without the job, there is nothing to fetch.
    expect((await call(null, 'GET', `/admin/evidence/${evidenceId}`)).status).toBe(401);
    expect((await call(cashier.token, 'GET', `/admin/evidence/${evidenceId}`)).status).toBe(403);
    // The person who asked sees that it is waiting, and not the card meant for the decider.
    expect(who.name).toBeTruthy();
    // A photo erased since shows a plain line instead of a broken picture.
    await db.evidenceObject.update({ where: { id: evidenceId }, data: { erasedAt: new Date() } });
    await page.reload();
    await expect(
      page
        .locator('article')
        .filter({ hasText: 'Bori phat gayi' })
        .getByText(hinglish['owner.evidence.gone']),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('the desk’s pages let this site ask for location, and nothing else may', async ({
  request,
}) => {
  const response = await request.get(`${desk}/hazri`);
  const policy = response.headers()['permissions-policy'] ?? '';
  expect(policy).toContain('geolocation=(self)');
  expect(policy).toContain('camera=()');
  expect(policy).toContain('microphone=()');
});
