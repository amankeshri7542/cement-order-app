import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstName, hazriView, type Today } from '../src/logic/hazri';
import type { QueueEntry } from '../src/logic/queue';

const noon = Date.parse('2026-11-03T06:30:00.000Z');
const today = (extra: Partial<Today> = {}): Today => ({
  serverNow: '2026-11-03T06:30:00.000Z',
  day: '2026-11-03',
  user: { id: 'u', name: 'Test Person' },
  noticeVersion: 1,
  noticeAccepted: true,
  roles: ['STOCK_KEEPER'],
  shops: [{ id: 's', name: 'Main' }],
  access: [],
  schedule: null,
  next: 'IN',
  arrivedAt: null,
  shopName: null,
  status: 'ABSENT',
  firstInAt: null,
  lastOutAt: null,
  minutes: null,
  lateMinutes: 0,
  flags: [],
  openReviews: 0,
  ...extra,
});
const punch = (kind: 'IN' | 'OUT'): QueueEntry => ({
  id: kind,
  kind: 'punch',
  method: 'POST',
  path: 'attendance/punch',
  body: { kind },
  userId: 'u',
  claimsAge: true,
  mono: 0,
  boot: 1,
  carriedMs: 0,
  rebooted: false,
});

test('morning, nothing yet', () => {
  const view = hazriView(today(), noon, []);
  assert.equal(view.next, 'IN');
  assert.equal(view.status, 'none');
});
test('arrived: the next scan is going home', () => {
  const view = hazriView(
    today({
      next: 'OUT',
      firstInAt: '2026-11-03T03:32:00.000Z',
      status: 'PRESENT',
      lateMinutes: 17,
    }),
    noon,
    [],
  );
  assert.equal(view.next, 'OUT');
  assert.equal(view.status, 'in');
  assert.equal(view.lateMinutes, 17);
});
test('both done: the day reads as finished', () => {
  const view = hazriView(
    today({
      firstInAt: '2026-11-03T03:32:00.000Z',
      lastOutAt: '2026-11-03T13:11:00.000Z',
      minutes: 579,
      status: 'PRESENT',
    }),
    noon,
    [],
  );
  assert.equal(view.status, 'done');
  assert.equal(view.minutes, 579);
});
test('with the manager', () => {
  assert.equal(hazriView(today({ status: 'REVIEW' }), noon, []).status, 'review');
});
test('an open question about another day is not today’s hazri', () => {
  assert.equal(hazriView(today({ openReviews: 1 }), noon, []).status, 'none');
});
test('a scan on the phone moves them on, so going home works with no signal', () => {
  const view = hazriView(today(), noon, [punch('IN')]);
  assert.equal(view.next, 'OUT');
  assert.equal(view.status, 'waiting');
  assert.equal(view.waiting, 1);
  assert.equal(hazriView(today(), noon, [punch('IN'), punch('OUT')]).next, 'IN');
});
test('yesterday’s answer says nothing about today', () => {
  const view = hazriView(
    today({ day: '2026-11-02', next: 'OUT', firstInAt: '2026-11-02T03:32:00.000Z' }),
    noon,
    [],
  );
  assert.equal(view.next, 'IN');
  assert.equal(view.firstInAt, null);
  assert.equal(view.stale, true);
});
test('with no clock to trust, the last known day stands', () => {
  const view = hazriView(today({ next: 'OUT' }), null, []);
  assert.equal(view.next, 'OUT');
  assert.equal(view.stale, false);
});
test('no answer yet at all still allows a scan', () => {
  assert.equal(hazriView(null, null, []).next, 'IN');
});
test('first names', () => {
  assert.equal(firstName('  Test Person '), 'Test');
  assert.equal(firstName(''), '');
});
