import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addDays,
  csvDocument,
  csvRupees,
  csvText,
  daysBetween,
  followUpChangeSchema,
  followUpCreateSchema,
  isRealDay,
  khataViewSchema,
  maskPhone,
  openingApproveSchema,
  openingDraftSchema,
  promiseState,
  quietCheck,
  quietRule,
  quietText,
  reminderBlock,
  reminderSchema,
  reminderText,
  whatsappLink,
} from './crm';

const uuid = '11111111-1111-4111-8111-111111111111';
const hidden = (code: number) => `Ram${String.fromCodePoint(code)}esh`;

describe('dates', () => {
  test('a real day is a real day', () => {
    assert.equal(isRealDay('2026-11-05'), true);
    assert.equal(isRealDay('2028-02-29'), true);
    for (const bad of ['2026-02-31', '2026-13-01', '05-11-2026', '2026-1-5', '', 'today'])
      assert.equal(isRealDay(bad), false, bad);
  });
  test('adds and counts days across a month and a year', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(daysBetween('2026-12-31', '2027-01-02'), 2);
    assert.equal(daysBetween('2027-01-02', '2026-12-31'), -2);
  });
});

describe('follow-up requests', () => {
  const valid = { customerId: 'c1', dueOn: '2026-11-06', kind: 'PAYMENT', idempotencyKey: uuid };
  test('takes a plain call', () => {
    assert.equal(followUpCreateSchema.safeParse(valid).success, true);
  });
  test('takes a promise only on a payment call', () => {
    assert.equal(followUpCreateSchema.safeParse({ ...valid, promisedPaise: 5000 }).success, true);
    assert.equal(
      followUpCreateSchema.safeParse({ ...valid, kind: 'ORDER', promisedPaise: 5000 }).success,
      false,
    );
  });
  test('refuses a bad amount, date, key or extra field', () => {
    for (const bad of [
      { promisedPaise: 0 },
      { promisedPaise: -100 },
      { promisedPaise: 1.5 },
      { promisedPaise: 3_000_000_000 },
      { dueOn: '2026-02-31' },
      { kind: 'SPAM' },
      { idempotencyKey: 'not-a-key' },
      { doneAt: '2026-11-05' },
      { note: 'x'.repeat(501) },
    ])
      assert.equal(followUpCreateSchema.safeParse({ ...valid, ...bad }).success, false);
  });
  test('keeps Hindi half-letters and refuses characters that hide or reorder words', () => {
    const halfLetter = `क${String.fromCodePoint(0x94d)}${String.fromCodePoint(0x200d)}या`;
    assert.equal(followUpCreateSchema.safeParse({ ...valid, note: halfLetter }).success, true);
    for (const code of [0x202e, 0x200b, 0xfeff, 0x07])
      assert.equal(followUpCreateSchema.safeParse({ ...valid, note: hidden(code) }).success, false);
    assert.equal(followUpCreateSchema.safeParse({ ...valid, note: 'one\ntwo' }).success, true);
  });
  test('a snooze needs a day and a reason, and each action only its own fields', () => {
    const action = (body: object) => followUpChangeSchema.safeParse(body).success;
    assert.equal(action({ action: 'DONE', idempotencyKey: uuid }), true);
    assert.equal(action({ action: 'DONE', idempotencyKey: uuid, dueOn: '2026-11-06' }), false);
    assert.equal(
      action({ action: 'SNOOZE', dueOn: '2026-11-07', reason: 'Bahar hai', idempotencyKey: uuid }),
      true,
    );
    assert.equal(action({ action: 'SNOOZE', dueOn: '2026-11-07', idempotencyKey: uuid }), false);
    assert.equal(
      action({ action: 'SNOOZE', dueOn: '2026-11-07', reason: '   ', idempotencyKey: uuid }),
      false,
    );
    assert.equal(action({ action: 'ASSIGN', assigneeId: null, idempotencyKey: uuid }), true);
    assert.equal(action({ action: 'ASSIGN', idempotencyKey: uuid }), false);
    assert.equal(action({ action: 'DELETE', idempotencyKey: uuid }), false);
  });
});

describe('numbers', () => {
  test('masking keeps only enough to tell people apart', () => {
    assert.equal(maskPhone('+919876543210'), '+91XXXXXXX210');
    assert.equal(maskPhone('walk-in:store'), '');
    assert.equal(maskPhone('deleted:abc'), '');
  });
  test('a link is made only for a real mobile, with the words safely encoded', () => {
    const text = 'Namaste & "ji"?\n#1';
    const link = whatsappLink('+919876543210', text);
    assert.ok(link!.startsWith('https://wa.me/919876543210?text='));
    assert.equal(decodeURIComponent(new URL(link!).search.slice('?text='.length)), text);
    assert.equal(whatsappLink('walk-in:store', text), null);
    assert.equal(whatsappLink('+911234567890', text), null);
  });
});

describe('reminders', () => {
  const asks = {
    purpose: 'PAYMENT' as const,
    stopped: false,
    signed: true,
    balancePaise: 100,
    phone: '+919876543210',
  };
  test('a signed balance with a mobile and no stop may go', () => {
    assert.equal(reminderBlock(asks), null);
  });
  test('a stop request beats everything, and no mobile beats that', () => {
    assert.equal(reminderBlock({ ...asks, stopped: true }), 'STOPPED');
    assert.equal(reminderBlock({ ...asks, stopped: true, signed: false }), 'STOPPED');
    assert.equal(reminderBlock({ ...asks, phone: 'walk-in:store', stopped: true }), 'NO_PHONE');
  });
  test('nothing before sign-off, and nothing when nothing is owed', () => {
    assert.equal(reminderBlock({ ...asks, signed: false }), 'NOT_SIGNED');
    assert.equal(reminderBlock({ ...asks, balancePaise: 0 }), 'NO_BALANCE');
    assert.equal(reminderBlock({ ...asks, balancePaise: -500 }), 'NO_BALANCE');
  });
  test('a quiet customer needs no balance or signature, but a stop still stands', () => {
    const quiet = { ...asks, purpose: 'QUIET' as const, signed: false, balancePaise: 0 };
    assert.equal(reminderBlock(quiet), null);
    assert.equal(reminderBlock({ ...quiet, stopped: true }), 'STOPPED');
  });
  test('the words carry the name and the balance', () => {
    const text = reminderText({ name: 'Ramesh', balancePaise: 12500000, shop: 'Shiv Cement' });
    assert.match(text, /Namaste Ramesh ji/);
    assert.match(text, /₹1,25,000 baaki/);
    assert.doesNotMatch(text, /\.00/);
    assert.match(reminderText({ name: 'R', balancePaise: 150, shop: 'S' }), /₹1\.50 baaki/);
  });
  test('no name still reads properly', () => {
    assert.match(reminderText({ name: '', balancePaise: 100, shop: 'S' }), /^Namaste, S ke/);
    assert.match(quietText({ name: '   ', shop: 'S' }), /^Namaste, S se/);
  });
  test('a name cannot smuggle in a link, new lines, formatting or hidden characters', () => {
    const text = reminderText({
      name: `Ram\n\nhttps://evil.example/pay *urgent* ${hidden(0x202e)} www.x.in`,
      balancePaise: 100,
      shop: 'S',
    });
    assert.doesNotMatch(text, /https?:|www\.|\n|\*/);
    assert.ok(![...text].some((ch) => ch.codePointAt(0) === 0x202e));
  });
  test('a very long name is cut, so the amount stays on the first line', () => {
    const text = reminderText({ name: 'A'.repeat(500), balancePaise: 100, shop: 'S' });
    assert.ok(text.length < 200);
  });
  test('a quiet message never mentions money', () => {
    assert.doesNotMatch(quietText({ name: 'Ram', shop: 'S' }), /₹|baaki/);
  });
  test('the request cannot carry the words or an amount', () => {
    assert.equal(reminderSchema.safeParse({ idempotencyKey: uuid }).success, true);
    assert.equal(
      reminderSchema.safeParse({ idempotencyKey: uuid, text: 'pay now' }).success,
      false,
    );
    assert.equal(
      reminderSchema.safeParse({ idempotencyKey: uuid, balancePaise: 1 }).success,
      false,
    );
  });
});

describe('promises', () => {
  const made = { promisedPaise: 1000, paidSincePaise: 0, dueOn: '2026-11-05', today: '2026-11-05' };
  test('no promise, no state', () => {
    assert.equal(promiseState({ ...made, promisedPaise: null }), null);
  });
  test('open up to and including the day', () => {
    assert.equal(promiseState(made), 'OPEN');
    assert.equal(promiseState({ ...made, paidSincePaise: 999 }), 'OPEN');
  });
  test('broken the day after, unless it came in', () => {
    assert.equal(promiseState({ ...made, today: '2026-11-06' }), 'BROKEN');
    assert.equal(promiseState({ ...made, today: '2026-11-06', paidSincePaise: 999 }), 'BROKEN');
    assert.equal(promiseState({ ...made, today: '2026-11-06', paidSincePaise: 1000 }), 'KEPT');
  });
  test('kept the moment the money arrives, even early', () => {
    assert.equal(promiseState({ ...made, paidSincePaise: 2000 }), 'KEPT');
  });
});

describe('chup grahak', () => {
  const today = '2026-11-05';
  const ago = (days: number) => addDays(today, -days);
  test('needs enough orders in the year', () => {
    assert.equal(quietCheck([ago(100), ago(200)], today), null);
    assert.equal(quietCheck([], today), null);
    assert.equal(quietCheck([ago(100), ago(200), ago(400)], today), null);
  });
  test(`quiet at ${quietRule.minQuietDays} days and not one day before`, () => {
    const orders = (last: number) => [ago(last), ago(last + 5), ago(last + 10)];
    assert.equal(quietCheck(orders(45), today)!.quiet, true);
    assert.equal(quietCheck(orders(44), today)!.quiet, false);
  });
  test('measured against their own pattern: a slow buyer is not quiet at 45 days', () => {
    const check = quietCheck([ago(60), ago(120), ago(180), ago(240)], today)!;
    assert.equal(check.usualGapDays, 60);
    assert.equal(check.thresholdDays, 120);
    assert.equal(check.quiet, false);
    assert.equal(quietCheck([ago(120), ago(180), ago(240), ago(300)], today)!.quiet, true);
  });
  test('a fast buyer still gets the floor', () => {
    const check = quietCheck([ago(30), ago(33), ago(36), ago(39)], today)!;
    assert.equal(check.usualGapDays, 3);
    assert.equal(check.thresholdDays, 45);
    assert.equal(check.quiet, false);
  });
  test('three orders on one day count as three orders with no gap', () => {
    const check = quietCheck([ago(50), ago(50), ago(50)], today)!;
    assert.equal(check.orders, 3);
    assert.equal(check.usualGapDays, null);
    assert.equal(check.quiet, true);
  });
  test('an even number of gaps takes the middle two', () => {
    assert.equal(
      quietCheck([ago(50), ago(60), ago(90), ago(150), ago(250)], today)!.usualGapDays,
      45,
    );
  });
  test('it says the plain facts, and no score', () => {
    const check = quietCheck([ago(50), ago(60), ago(70)], today)!;
    assert.deepEqual(Object.keys(check).sort(), [
      'lastOrderOn',
      'orders',
      'quiet',
      'quietDays',
      'thresholdDays',
      'usualGapDays',
    ]);
  });
});

describe('spreadsheet cells', () => {
  const inner = (cell: string) => cell.slice(1, -1);
  test('a formula start is defused, however it is dressed up', () => {
    for (const bad of [
      '=HYPERLINK("http://x")',
      '+91 cmd',
      '-1+1',
      '@SUM(A1)',
      ' =1+1',
      '\t=1+1',
      '\r\n=1+1',
      `${String.fromCodePoint(0x200b)}=1+1`,
      `${String.fromCodePoint(0xff1d)}1+1`,
      `${String.fromCodePoint(0xff0b)}1`,
      `${String.fromCodePoint(0xff20)}x`,
    ])
      assert.ok(inner(csvText(bad)).startsWith("'"), JSON.stringify(bad));
  });
  test('ordinary words are left alone', () => {
    assert.equal(csvText('Ramesh Kumar'), '"Ramesh Kumar"');
    assert.equal(csvText('राम'), '"राम"');
    assert.equal(csvText(''), '""');
  });
  test('quotes, commas, semicolons and new lines stay in one cell', () => {
    assert.equal(csvText('a"b'), '"a""b"');
    assert.equal(csvText('a,b;c'), '"a,b;c"');
    assert.equal(csvText('a\nb\tc'), '"a b c"');
  });
  test('hidden characters go, and Hindi joiners stay', () => {
    assert.equal(csvText(hidden(0x202e)), '"Ramesh"');
    const joined = `क${String.fromCodePoint(0x200d)}य`;
    assert.equal(csvText(joined), `"${joined}"`);
  });
  test('rupees are plain numbers and hold what a float cannot', () => {
    assert.equal(csvRupees(123456), '1234.56');
    assert.equal(csvRupees(5), '0.05');
    assert.equal(csvRupees(-150), '-1.50');
    assert.equal(csvRupees(0), '0.00');
    assert.equal(csvRupees(90071992547409931n), '900719925474099.31');
  });
  test('a document starts with the mark Excel needs, and ends each line properly', () => {
    const text = csvDocument([
      ['"a"', '1'],
      ['"b"', '2'],
    ]);
    assert.equal(text.codePointAt(0), 0xfeff);
    assert.equal(text.slice(1), '"a",1\r\n"b",2\r\n');
  });
});

describe('opening sheet requests', () => {
  test('a paper figure may be an advance, and must be whole paise', () => {
    const row = { customerId: 'c', asOf: '2026-04-01', paperPaise: -500 };
    assert.equal(openingDraftSchema.safeParse(row).success, true);
    assert.equal(openingDraftSchema.safeParse({ ...row, paperPaise: 1.5 }).success, false);
    assert.equal(openingDraftSchema.safeParse({ ...row, paperPaise: 3e9 }).success, false);
    assert.equal(openingDraftSchema.safeParse({ ...row, asOf: '2026-02-30' }).success, false);
  });
  test('a browser cannot send the Tally figure', () => {
    assert.equal(
      openingDraftSchema.safeParse({
        customerId: 'c',
        asOf: '2026-04-01',
        paperPaise: 1,
        tallyPaise: 1,
      }).success,
      false,
    );
  });
  test('a batch is bounded, and each customer appears once', () => {
    const row = (customerId: string) => ({ customerId, draftVersion: 1, chosenPaise: 100 });
    assert.equal(openingApproveSchema.safeParse({ rows: [row('a'), row('b')] }).success, true);
    assert.equal(openingApproveSchema.safeParse({ rows: [row('a'), row('a')] }).success, false);
    assert.equal(openingApproveSchema.safeParse({ rows: [] }).success, false);
    assert.equal(
      openingApproveSchema.safeParse({
        rows: Array.from({ length: 101 }, (_, index) => row(`c${index}`)),
      }).success,
      false,
    );
  });
  test('the customer view switch takes only a yes or no', () => {
    assert.equal(khataViewSchema.safeParse({ on: true }).success, true);
    assert.equal(khataViewSchema.safeParse({ on: 'yes' }).success, false);
  });
});
