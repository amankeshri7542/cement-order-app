import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseExits, type LineStatus } from './list-exits';

const base = {
  statuses: ['ok'] as LineStatus[],
  pincode: 'none' as const,
  whatsapp: true,
  online: true,
  checkFailed: false,
};

test('all fine: Place order leads, with both others quiet', () => {
  assert.deepEqual(chooseExits(base), {
    lead: 'order',
    others: ['whatsapp', 'rate'],
    orderOff: null,
    note: null,
  });
  assert.equal(chooseExits({ ...base, pincode: 'served' }).lead, 'order');
});
test('an empty list offers nothing', () => {
  assert.deepEqual(chooseExits({ ...base, statuses: [] }), {
    lead: null,
    others: [],
    orderOff: null,
    note: null,
  });
});
for (const status of ['over', 'unavailable', 'on_request'] as const)
  test(`a line that is ${status}: Ask for a rate leads and Place order is off, with a reason`, () => {
    const exits = chooseExits({ ...base, statuses: ['ok', status] });
    assert.equal(exits.lead, 'rate');
    assert.deepEqual(exits.others, ['whatsapp']);
    assert.ok(exits.orderOff);
    assert.doesNotMatch(exits.orderOff!, /\d/);
  });
test('a line off the list or a wrong quantity also stops Place order', () => {
  assert.ok(chooseExits({ ...base, statuses: ['gone'] }).orderOff);
  assert.ok(chooseExits({ ...base, statuses: ['invalid'] }).orderOff);
});
test('a pincode not served: WhatsApp leads, then a rate, and Place order is off', () => {
  const exits = chooseExits({ ...base, pincode: 'not_served' });
  assert.equal(exits.lead, 'whatsapp');
  assert.deepEqual(exits.others, ['rate']);
  assert.ok(exits.orderOff);
});
test('with no approved number there is no WhatsApp anywhere', () => {
  const none = { ...base, whatsapp: false };
  assert.deepEqual(chooseExits(none).others, ['rate']);
  assert.equal(chooseExits({ ...none, pincode: 'not_served' }).lead, 'rate');
  assert.deepEqual(chooseExits({ ...none, statuses: ['over'] }).others, []);
});
test('offline: the list is saved and nothing needing the server is offered', () => {
  const exits = chooseExits({ ...base, online: false });
  assert.equal(exits.lead, null);
  assert.deepEqual(exits.others, []);
  assert.match(exits.note!, /offline/);
});
test('when the shop cannot be reached, Place order does not lead', () => {
  const exits = chooseExits({ ...base, checkFailed: true });
  assert.notEqual(exits.lead, 'order');
  assert.ok(exits.orderOff);
  assert.match(exits.note!, /could not be reached/);
});
test('an answer still on its way alarms nobody, and placing re-checks on the server anyway', () => {
  const exits = chooseExits({ ...base, statuses: ['unknown'] });
  assert.equal(exits.lead, 'order');
  assert.equal(exits.note, null);
  assert.equal(exits.orderOff, null);
});
test('a line problem beats a pincode problem, so the customer sees the first thing to fix', () => {
  assert.equal(chooseExits({ ...base, statuses: ['over'], pincode: 'not_served' }).lead, 'rate');
});
test('a pincode still being checked or failed does not hold up the order', () => {
  assert.equal(chooseExits({ ...base, pincode: 'checking' }).lead, 'order');
  assert.equal(chooseExits({ ...base, pincode: 'failed' }).lead, 'order');
});
