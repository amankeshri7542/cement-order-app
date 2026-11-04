import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en, hi, t } from './index';
test('every English key has nonempty Hindi text and matching interpolation parameters', () => {
  assert.deepEqual(Object.keys(hi).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    assert.ok(hi[key].trim(), key);
    assert.deepEqual(
      [...hi[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
      [...en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
      key,
    );
  }
});
test('Hinglish is the default and parameters are plain text', () => {
  assert.match(t('owner.orderNumber', { number: 'SC-1' }), /SC-1/);
  assert.equal(t('owner.today'), 'Aaj');
  assert.equal(t('owner.today', {}, 'en'), 'Today');
});

test('everything the desk says is in Roman script, spelled the shop’s way', () => {
  const unused = /[\u0900-\u097f]/;
  const misspelt = /\b(udhar|baki|paka|nahin|bhaada|dukan|hisab|wasooli|manjoori|gadi)\b/i;
  for (const [key, value] of Object.entries(hi)) {
    assert.doesNotMatch(value, unused, key);
    assert.doesNotMatch(value, misspelt, key);
  }
});

test('the word pakka on a customer’s message only ever follows a person’s tap', () => {
  assert.doesNotMatch(en['push.orderPlaced.title'], /confirmed/i);
  assert.doesNotMatch(hi['push.orderPlaced.title'], /pakka/i);
});
