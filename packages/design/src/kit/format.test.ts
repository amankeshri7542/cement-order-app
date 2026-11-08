import { describe, expect, it } from 'vitest';
import {
  changeOf,
  formatCount,
  formatMoney,
  formatQty,
  matchOptions,
  moveRow,
  pageRange,
  parseRupees,
  rupeesText,
  shiftDay,
  sparkPoints,
} from './format';

describe('money', () => {
  it('keeps paise when exact and rounds to whole rupees otherwise, with Indian grouping', () => {
    expect(formatMoney(12345650, true)).toBe('₹1,23,456.50');
    expect(formatMoney(12345650)).toBe('₹1,23,457');
    expect(formatMoney(12345649)).toBe('₹1,23,456');
    expect(formatMoney(0, true)).toBe('₹0.00');
    expect(formatMoney(0)).toBe('₹0');
  });
  it('writes a minus as a real minus sign, and never "−₹0"', () => {
    expect(formatMoney(-50000, true)).toBe('−₹500.00');
    expect(formatMoney(-49)).toBe('₹0');
    expect(formatMoney(-50)).toBe('−₹1');
  });
  it('shows nothing for a value that is not a number', () => {
    expect(formatMoney(Number.NaN)).toBe('');
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('typed rupees', () => {
  it('reads what people type at the counter', () => {
    expect(parseRupees('1250')).toBe(125000);
    expect(parseRupees('1,250.5')).toBe(125050);
    expect(parseRupees('₹ 1,23,456.75')).toBe(12345675);
    expect(parseRupees('0.05')).toBe(5);
    expect(parseRupees('12.')).toBe(1200);
  });
  it('refuses what is not an amount', () => {
    for (const bad of ['', 'abc', '12.345', '1e5', '--5', '5-', '१२', '0x10', '1 2.3.4'])
      expect(parseRupees(bad), bad).toBeNull();
  });
  it('refuses a negative unless asked, and anything above ₹2 crore', () => {
    expect(parseRupees('-500')).toBeNull();
    expect(parseRupees('-500', true)).toBe(-50000);
    expect(parseRupees('−500', true)).toBe(-50000);
    expect(parseRupees('20000000')).toBe(2_000_000_000);
    expect(parseRupees('20000000.01')).toBeNull();
    expect(parseRupees('99999999999999999999')).toBeNull();
  });
  it('writes paise back as rupees for the field', () => {
    expect(rupeesText(125050)).toBe('1250.50');
    expect(rupeesText(125000)).toBe('1250');
    expect(rupeesText(-5)).toBe('-0.05');
    expect(rupeesText(null)).toBe('');
  });
});

describe('quantities and counts', () => {
  it('groups digits the Indian way and keeps the unit as stored', () => {
    expect(formatQty(125000, 'bori')).toBe('1,25,000 bori');
    expect(formatQty(12.5, 'cft')).toBe('12.5 cft');
    expect(formatQty(-3)).toBe('−3');
    expect(formatCount(1240)).toBe('1,240');
    expect(formatCount(-4)).toBe('0');
  });
});

describe('KPI change', () => {
  it('says the direction and the share', () => {
    expect(changeOf(110, 100)).toEqual({ direction: 'up', share: 10 });
    expect(changeOf(90, 100)).toEqual({ direction: 'down', share: 10 });
    expect(changeOf(100, 100)).toEqual({ direction: 'same', share: 0 });
    expect(changeOf(-50, -100)).toEqual({ direction: 'up', share: 50 });
  });
  it('says nothing when there is nothing to compare with', () => {
    expect(changeOf(100, 0)).toBeNull();
    expect(changeOf(100, null)).toBeNull();
    expect(changeOf(100, undefined)).toBeNull();
  });
});

describe('days', () => {
  it('steps across months and years', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('sparkline', () => {
  it('fits the values in the box, high at the top', () => {
    expect(sparkPoints([0, 10], 10, 10)).toBe('0.0,10.0 10.0,0.0');
    expect(sparkPoints([5, 5, 5], 10, 10)).toBe('0.0,10.0 5.0,10.0 10.0,10.0');
  });
  it('draws nothing with fewer than two numbers', () => {
    expect(sparkPoints([5], 10, 10)).toBe('');
    expect(sparkPoints([Number.NaN, 4], 10, 10)).toBe('');
  });
});

describe('pager range', () => {
  it('counts from one', () => {
    expect(pageRange(0, 50)).toEqual({ from: 1, to: 50 });
    expect(pageRange(50, 12)).toEqual({ from: 51, to: 62 });
    expect(pageRange(0, 0)).toBeNull();
  });
});

describe('keyboard rows', () => {
  it('moves by one, by a page and to the ends, never past them', () => {
    expect(moveRow('ArrowDown', 0, 5)).toBe(1);
    expect(moveRow('ArrowDown', 4, 5)).toBe(4);
    expect(moveRow('ArrowUp', 0, 5)).toBe(0);
    expect(moveRow('ArrowUp', -1, 5)).toBe(0);
    expect(moveRow('PageDown', 2, 50, 10)).toBe(12);
    expect(moveRow('PageDown', 45, 50, 10)).toBe(49);
    expect(moveRow('PageUp', 5, 50, 10)).toBe(0);
    expect(moveRow('Home', 30, 50)).toBe(0);
    expect(moveRow('End', 0, 50)).toBe(49);
    expect(moveRow('a', 3, 50)).toBe(3);
  });
  it('has nowhere to go in an empty list, and clamps a row that went away', () => {
    expect(moveRow('ArrowDown', 0, 0)).toBe(-1);
    expect(moveRow('ArrowUp', 40, 5)).toBe(3);
  });
});

describe('combobox matching', () => {
  const options = [
    { id: '1', label: 'Ramesh Kumar', hint: '98765 43210' },
    { id: '2', label: 'Kumar Hardware' },
    { id: '3', label: 'Suresh', hint: 'Danapur' },
  ];
  it('puts names that start with the typing first, then any other match', () => {
    expect(matchOptions(options, 'kum').map((o) => o.id)).toEqual(['2', '1']);
    expect(matchOptions(options, 'DANA').map((o) => o.id)).toEqual(['3']);
    expect(matchOptions(options, '43210').map((o) => o.id)).toEqual(['1']);
  });
  it('shows the list when nothing is typed, and keeps to the limit', () => {
    expect(matchOptions(options, '  ')).toHaveLength(3);
    expect(matchOptions(options, '', 2)).toHaveLength(2);
    expect(matchOptions(options, 'zzz')).toEqual([]);
  });
});
