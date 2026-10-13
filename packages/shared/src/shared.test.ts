import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clientConfigSchema,
  shortDayLabel,
  weekdayLabel,
  compareVersions,
  ageLabel,
  customerErrorCodes,
  customerErrors,
  dayLabel,
  deliveryDateOptions,
  errorCodes,
  errorText,
  glossary,
  hasDevanagari,
  istToday,
  maxOrderable,
  orderStatusLabels,
  orderStatuses,
  orderStatusText,
  quantityProblem,
  quoteStatusLabels,
  paymentStatusLabels,
  roundUpQuantity,
  stepDown,
  stepUp,
  toMergePayload,
  guestIntentSchema,
} from './index';

const steel = { minQuantity: 50, quantityStep: 10 };

test('quantity rules match the API: whole, minimum, multiple of step, maximum', () => {
  assert.equal(quantityProblem(steel, 60), null);
  assert.equal(quantityProblem(steel, 40), 'minimum');
  assert.equal(quantityProblem(steel, 65), 'step');
  assert.equal(quantityProblem(steel, 12.5), 'whole');
  assert.equal(quantityProblem(steel, 200, 150), 'maximum');
  assert.equal(roundUpQuantity(steel, 1), 50);
  assert.equal(roundUpQuantity(steel, 51), 60);
  assert.equal(stepUp(steel, 50), 60);
  assert.equal(stepDown(steel, 60), 50);
  assert.equal(stepDown(steel, 50), 0, 'below the minimum means remove');
  assert.equal(maxOrderable(steel, 125), 120);
  assert.equal(maxOrderable(steel, 45), 0, 'stock below the minimum cannot be ordered');
});

test('dates are Patna calendar days in both languages', () => {
  // 20:00 UTC on 11 Oct is already 12 Oct in Patna.
  assert.equal(istToday(new Date('2026-10-11T20:00:00Z')), '2026-10-12');
  assert.deepEqual(deliveryDateOptions(new Date('2026-10-11T20:00:00Z'), 1, 3), [
    '2026-10-13',
    '2026-10-14',
    '2026-10-15',
  ]);
  assert.equal(dayLabel('2026-10-12', 'en'), '12 Oct 2026');
  assert.ok(hasDevanagari(dayLabel('2026-10-12', 'hi')));
  assert.equal(dayLabel('not-a-date', 'hi'), 'not-a-date');
  const now = new Date('2026-10-12T12:00:00Z');
  assert.equal(ageLabel('2026-10-12T11:45:00Z', 'en', now), '15 min');
  assert.equal(ageLabel('2026-10-12T09:00:00Z', 'hi', now), '3 घंटे');
  assert.equal(ageLabel('2026-10-09T12:00:00Z', 'hi', now), '3 दिन');
  assert.equal(ageLabel('2026-10-09T12:00:00Z', 'en', now), '3d');
});

test('every label, glossary word and customer error has real Hindi text', () => {
  for (const status of orderStatuses)
    assert.ok(hasDevanagari(orderStatusLabels[status][1]), status);
  for (const [status, [, hi]] of Object.entries(quoteStatusLabels))
    assert.ok(hasDevanagari(hi), status);
  for (const [status, [, hi]] of Object.entries(paymentStatusLabels))
    assert.ok(hasDevanagari(hi), status);
  for (const [key, [en, hi]] of Object.entries(glossary))
    if (key !== 'whatsapp') assert.ok(hasDevanagari(hi) && !hasDevanagari(en), key);
  for (const code of customerErrorCodes) {
    const [en, hi] = customerErrors[code];
    assert.ok(en.length > 10 && !hasDevanagari(en), `${code} English`);
    assert.ok(hasDevanagari(hi), `${code} Hindi`);
  }
  assert.equal(new Set(errorCodes).size, errorCodes.length, 'no duplicate error codes');
});

test('errorText prefers the shared translation, then the server message in English only', () => {
  assert.equal(errorText('OUT_OF_STOCK', 'hi'), customerErrors.OUT_OF_STOCK[1]);
  assert.equal(errorText('SOMETHING_NEW', 'en', 'Specific server text'), 'Specific server text');
  assert.equal(
    errorText('SOMETHING_NEW', 'hi', 'Specific server text'),
    customerErrors.REQUEST_FAILED[1],
  );
  assert.equal(orderStatusText('DELIVERED', 'hi'), 'डिलीवरी हो गई');
  assert.equal(orderStatusText('UNKNOWN', 'hi'), 'UNKNOWN');
});

test('guest basket keeps ids only and becomes the existing merge request', () => {
  const intent = guestIntentSchema.parse({
    key: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    lines: [{ productId: 'ultratech-ppc', quantity: 20 }],
  });
  assert.deepEqual(toMergePayload(intent), {
    idempotencyKey: intent.key,
    items: [{ productId: 'ultratech-ppc', quantity: 20 }],
  });
  assert.throws(() => guestIntentSchema.parse({ key: 'x', lines: [] }));
});

test('app versions compare numerically, not as text', () => {
  assert.ok(compareVersions('1.0.10', '1.0.9') > 0);
  assert.ok(compareVersions('1.2.0', '1.10.0') < 0);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  assert.ok(
    clientConfigSchema.safeParse({
      android: { minimumVersion: '1.0.0', latestVersion: '1.1.0', storeUrl: 'https://example.com' },
    }).success,
  );
});

test('delivery chips name the weekday and short date in Patna time', () => {
  assert.equal(weekdayLabel('2026-10-15', 'en'), 'Thu');
  assert.equal(shortDayLabel('2026-10-15', 'en'), '15 Oct');
  assert.ok(hasDevanagari(weekdayLabel('2026-10-15', 'hi')));
});
