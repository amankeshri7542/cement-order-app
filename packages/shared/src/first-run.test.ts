import assert from 'node:assert/strict';
import test from 'node:test';
import { firstOrderSteps, isPincode, nextSteps } from './first-run';
import { hasDevanagari } from './i18n';

const states = (status: string) =>
  nextSteps({ status: status as never, number: 'SCS-1' })?.map((step) => step.state);

test('what happens next follows the real order statuses', () => {
  assert.deepEqual(states('CONFIRMED'), ['done', 'current', 'todo', 'todo', 'todo']);
  assert.deepEqual(states('PREPARING'), ['done', 'done', 'current', 'todo', 'todo']);
  assert.deepEqual(states('OUT_FOR_DELIVERY'), ['done', 'done', 'done', 'current', 'todo']);
  assert.deepEqual(states('DELIVERED'), ['done', 'done', 'done', 'done', 'done']);
  for (const off of ['CANCELLED', 'PENDING_PAYMENT', 'DELIVERY_EXCEPTION', 'REFUNDED'])
    assert.equal(nextSteps({ status: off as never, number: 'SCS-1' }), null);
});

test('first-run text is complete in both languages and promises no times', () => {
  const steps = nextSteps({ status: 'CONFIRMED', number: 'SCS-1' })!;
  const texts = [
    ...steps.flatMap((step) => [step.title, step.body]),
    ...firstOrderSteps.flatMap((step) => [step.title, step.body]),
  ];
  for (const [en, hi] of texts) {
    assert.ok(en.trim() && !hasDevanagari(en), `English text: ${en}`);
    assert.ok(hasDevanagari(hi), `Hindi text: ${hi}`);
    // No delivery-time promises: no hours, minutes or "same day" claims.
    assert.doesNotMatch(`${en} ${hi}`, /\b\d+\s*(hours?|hrs?|minutes?|mins?)\b|same[- ]day|घंटे/i);
  }
  assert.match(steps[0]!.body[0], /SCS-1/);
});

test('a pincode is six digits not starting with zero', () => {
  assert.ok(isPincode('800099'));
  for (const value of ['080001', '80001', '8000999', 'abcdef', 800099, null])
    assert.equal(isPincode(value), false);
});
