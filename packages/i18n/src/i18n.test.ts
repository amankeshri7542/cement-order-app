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
test('Hindi is the default and parameters are plain text', () => {
  assert.match(t('owner.orderNumber', { number: 'SC-1' }), /SC-1/);
  assert.match(t('owner.today'), /[\u0900-\u097f]/);
  assert.equal(t('owner.today', {}, 'en'), 'Today');
});
