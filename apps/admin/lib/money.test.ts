import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rupeesToPaise } from './money';

test('reads typed rupees as whole paise', () => {
  assert.equal(rupeesToPaise('380'), 38000);
  assert.equal(rupeesToPaise('380.5'), 38050);
  assert.equal(rupeesToPaise('380.05'), 38005);
  assert.equal(rupeesToPaise('0.01'), 1);
});
test('a space around the figure changes nothing', () => {
  assert.equal(rupeesToPaise('380.5 '), 38050);
  assert.equal(rupeesToPaise(' 380.5'), 38050);
  assert.equal(rupeesToPaise(' -5.5 ', true), -550);
});
test('refuses what is not money', () => {
  for (const value of ['', 'abc', '1.234', '-5', '1,000', '₹5'])
    assert.throws(() => rupeesToPaise(value));
  assert.throws(() => rupeesToPaise('99999999999'));
});
test('a minus sign only where one is allowed', () => {
  assert.equal(rupeesToPaise('-5', true), -500);
  assert.throws(() => rupeesToPaise('-5'));
});
