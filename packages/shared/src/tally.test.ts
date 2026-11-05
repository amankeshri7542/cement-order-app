import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  bridgeMessage,
  dayShift,
  financialYearStart,
  tallyAmountToPaise,
  tallyAppEquivalent,
  tallyBaseType,
  tallyDate,
  tallyDayNumber,
  tallyLinkSchema,
  TallyAmountError,
} from './tally';

describe('a Tally amount in paise', () => {
  const cases: [string, bigint][] = [
    ['0', 0n],
    ['', 0n],
    ['  ', 0n],
    ['100', 10000n],
    ['100.5', 10050n],
    ['100.50', 10050n],
    ['-100.50', -10050n],
    ['(-)100.50', -10050n],
    ['(-) 1,23,456.78', -12345678n],
    ['1,23,456.78', 12345678n],
    ['1,00,00,000.00', 1000000000n],
    ['1234.50 Dr', -123450n],
    ['1234.50 Cr', 123450n],
    ['1234.50 dr', -123450n],
    ['1234.50Cr.', 123450n],
    ['.5', 50n],
    ['5.', 500n],
    ['+5', 500n],
    ['12.3400', 1234n],
    ['-0.00', 0n],
    // Past what a number holds exactly in paise, and past the khata's own cap.
    ['123456789012345.67', 12345678901234567n],
    ['\u00A01,000.00\u00A0', 100000n],
  ];
  for (const [text, paise] of cases)
    test(JSON.stringify(text), () => assert.equal(tallyAmountToPaise(text), paise));

  const refused = [
    'abc',
    '1.2.3',
    '1e5',
    '12.345',
    '1,000,',
    '-',
    '(-)',
    '.',
    'Dr',
    '- 5 Dr',
    '(-)5 Cr',
    '٣٤',
    '१०',
    '₹100',
    '=1+1',
    'NaN',
    'Infinity',
    '0x10',
    '1'.repeat(19),
  ];
  for (const text of refused)
    test(`refuses ${JSON.stringify(text)}, and never rounds`, () =>
      assert.throws(() => tallyAmountToPaise(text), TallyAmountError));
});

describe('the app’s view of a Tally balance', () => {
  test('a debit in Tally means the customer owes', () => {
    assert.equal(tallyAppEquivalent(-500n), 500n);
    assert.equal(tallyAppEquivalent(500n), -500n);
    assert.equal(tallyAppEquivalent(0n), 0n);
  });
});

describe('dates for Tally', () => {
  test('the form its samples use', () => {
    assert.equal(tallyDate('2026-04-01'), '1-Apr-2026');
    assert.equal(tallyDate('2026-12-31'), '31-Dec-2026');
    assert.equal(tallyDayNumber('2026-04-01'), '20260401');
  });
  test('the financial year turns on 1 April', () => {
    assert.equal(financialYearStart('2026-04-01'), '2026-04-01');
    assert.equal(financialYearStart('2026-03-31'), '2025-04-01');
    assert.equal(financialYearStart('2027-01-15'), '2026-04-01');
  });
  test('days move across months and leap years', () => {
    assert.equal(dayShift('2026-03-01', -1), '2026-02-28');
    assert.equal(dayShift('2028-03-01', -1), '2028-02-29');
    assert.equal(dayShift('2026-12-31', 1), '2027-01-01');
  });
});

describe('which voucher types are copied', () => {
  const parents = new Map([
    ['Sales', 'Sales'],
    ['GST Sale', 'Sales'],
    ['Counter Bill', 'GST Sale'],
    ['Payroll', 'Payroll'],
    ['Salary Paid', 'Payroll'],
    ['Contra', 'Contra'],
    ['Loop A', 'Loop B'],
    ['Loop B', 'Loop A'],
  ]);
  test('a custom type follows its parents to where they end', () => {
    assert.equal(tallyBaseType('Sales', parents), 'Sales');
    assert.equal(tallyBaseType('GST Sale', parents), 'Sales');
    assert.equal(tallyBaseType('Counter Bill', parents), 'Sales');
  });
  test('payroll never goes on the list, whatever a type is called', () => {
    assert.equal(tallyBaseType('Payroll', parents), '');
    assert.equal(tallyBaseType('Salary Paid', parents), '');
  });
  test('anything else stays off, a loop ends, and an unknown type is nothing', () => {
    assert.equal(tallyBaseType('Contra', parents), '');
    assert.equal(tallyBaseType('Loop A', parents), '');
    assert.equal(tallyBaseType('Nothing Here', parents), '');
  });
});

describe('what a PC signs', () => {
  test('every part of a request, in a fixed order', () => {
    assert.equal(bridgeMessage('PUT', '/x', '1', '2', 'ab'), 'PUT\n/x\n1\n2\nab');
  });
});

describe('linking a party', () => {
  test('names a customer or types a phone, not both and not neither', () => {
    assert.ok(tallyLinkSchema.safeParse({ userId: 'u' }).success);
    assert.ok(tallyLinkSchema.safeParse({ phone: '+919000000001', name: 'A' }).success);
    assert.ok(!tallyLinkSchema.safeParse({}).success);
    assert.ok(!tallyLinkSchema.safeParse({ userId: 'u', phone: '+919000000001' }).success);
    assert.ok(!tallyLinkSchema.safeParse({ phone: '12345' }).success);
  });
});
