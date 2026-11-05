import assert from 'node:assert/strict';
import { test } from 'node:test';
import { en, isMessageKey } from '@shiv/i18n';
import {
  asKhata,
  booksState,
  bytesWord,
  isOld,
  isVersion,
  justNow,
  lineWord,
  linesAddUp,
  pairCommand,
  partySide,
  pcGone,
  pcWord,
  plainMoney,
  reasonLines,
  roleWord,
  sharePercent,
  signedMoney,
  tieWord,
} from './pure';
import type { TallyPc } from './types';

const PAST_SAFE = '90071992547409931';

test('no amount past 2^53 loses a paisa, in any of the ways it is shown', () => {
  assert.equal(plainMoney(PAST_SAFE), '₹90,07,19,92,54,74,099.31');
  assert.equal(plainMoney(`-${PAST_SAFE}`), '₹90,07,19,92,54,74,099.31');
  assert.equal(signedMoney(PAST_SAFE), '+₹90,07,19,92,54,74,099.31');
  assert.equal(signedMoney(`-${PAST_SAFE}`), '-₹90,07,19,92,54,74,099.31');
  assert.equal(asKhata(`-${PAST_SAFE}`), PAST_SAFE);
  assert.equal(asKhata(PAST_SAFE), `-${PAST_SAFE}`);
});
test('a line always says which way it goes, and zero goes neither way', () => {
  assert.equal(signedMoney('5000'), '+₹50');
  assert.equal(signedMoney('-7000'), '-₹70');
  assert.equal(signedMoney('0'), '₹0');
  assert.equal(plainMoney('0'), '₹0');
  assert.equal(asKhata('0'), '0');
});
test('Tally keeps debit below zero, so a customer who owes is below zero', () => {
  assert.equal(partySide('-100'), 'owes');
  assert.equal(partySide('100'), 'holds');
  assert.equal(partySide('0'), 'clear');
  assert.equal(partySide('100', true), 'toPay');
  assert.equal(partySide('-100', true), 'toGet');
  assert.equal(partySide('0', true), 'clear');
});
test('the bar counts money, whatever its size, and copes with nothing yet', () => {
  assert.equal(sharePercent('800000', '1000000'), 80);
  assert.equal(sharePercent('0', '0'), 0);
  assert.equal(sharePercent('1', '3'), 33);
  assert.equal(sharePercent(PAST_SAFE, PAST_SAFE), 100);
  assert.equal(sharePercent('45035996273704965', PAST_SAFE), 49);
});
test('the lines add up only when they do, to the paisa, past 2^53', () => {
  const lines = [{ amountPaise: '5000' }, { amountPaise: '-7000' }];
  assert.equal(linesAddUp(lines, '-1000', '-3000'), true);
  assert.equal(linesAddUp(lines, '-1000', '-3001'), false);
  assert.equal(linesAddUp([], '0', '0'), true);
  assert.equal(linesAddUp([{ amountPaise: PAST_SAFE }], '1', '90071992547409932'), true);
  // A Number would call these equal.
  assert.equal(linesAddUp([{ amountPaise: PAST_SAFE }], '0', '90071992547409932'), false);
});
test('old means more than a day, by the clock it is given', () => {
  const now = '2026-11-05T12:00:00.000Z';
  assert.equal(isOld('2026-11-04T12:00:00.000Z', now), false);
  assert.equal(isOld('2026-11-04T11:59:59.000Z', now), true);
  assert.equal(isOld('2026-11-05T11:00:00.000Z', Date.parse(now)), false);
  assert.equal(isOld(null, now), false);
});
test('just now means under a minute, by the clock it is given', () => {
  const now = '2026-11-05T12:00:00.000Z';
  assert.equal(justNow('2026-11-05T11:59:30.000Z', now), true);
  assert.equal(justNow('2026-11-05T11:59:00.000Z', now), false);
});
test('each kind of line has its own plain words, in the catalogue', () => {
  const key = (reason: Parameters<typeof lineWord>[0]['reason'], note?: 'SIGNED') =>
    lineWord({ reason, note });
  assert.equal(key('TIMING'), 'owner.tally.line.TIMING');
  assert.equal(key('APP_ONLY'), 'owner.tally.line.APP_ONLY');
  assert.equal(key('TALLY_ONLY'), 'owner.tally.line.TALLY_ONLY');
  assert.equal(key('AMOUNT'), 'owner.tally.line.AMOUNT');
  assert.equal(key('OPENING'), 'owner.tally.line.OPENING');
  assert.equal(key('OPENING', 'SIGNED'), 'owner.tally.line.OPENING_SIGNED');
  assert.equal(
    lineWord({ reason: 'AMOUNT', note: 'WITHIN_TOLERANCE' }),
    'owner.tally.line.ROUND_OFF',
  );
  assert.equal(lineWord({ reason: 'OPENING', note: 'NOT_AGREED_YET' }), 'owner.tally.line.OPENING');
  for (const reason of ['TIMING', 'APP_ONLY', 'TALLY_ONLY', 'AMOUNT', 'OPENING'])
    assert.ok(isMessageKey(`owner.tally.reason.${reason}`), reason);
});
test('the Farq summary keeps a fixed order and drops zero and missing reasons', () => {
  assert.deepEqual(reasonLines({ AMOUNT: '10', TIMING: '-5', OPENING: '0' }), [
    { reason: 'TIMING', amountPaise: '-5' },
    { reason: 'AMOUNT', amountPaise: '10' },
  ]);
  assert.deepEqual(reasonLines(null), []);
  assert.deepEqual(reasonLines({}), []);
});
test('every PC state has words, and an unknown one says so', () => {
  const states = [
    'NEW',
    'PAIRED',
    'OK',
    'BUSY',
    'PC_ASLEEP',
    'PC_SILENT',
    'TALLY_CLOSED',
    'PORT_OFF',
    'NO_COMPANY',
    'COMPANY_MISSING',
    'BAD_ANSWER',
    'PAUSED',
    'SPOOL_FULL',
    'EDUCATIONAL',
    'REVOKED',
    'SOMETHING_NEW',
  ];
  for (const state of states) {
    const word = pcWord(state);
    assert.ok(en[word.tag], state);
    if (word.body) assert.ok(en[word.body], state);
  }
  assert.equal(pcWord('SOMETHING_NEW').tag, 'owner.tally.state.other');
});
test('a sleeping PC is never an alarm, and busy says nothing to an owner', () => {
  assert.equal(pcWord('PC_ASLEEP').tone, 'plain');
  assert.equal(pcWord('BUSY').tag, 'owner.tally.state.OK');
  assert.equal(pcWord('BUSY', true).tag, 'owner.tally.state.BUSY');
  assert.equal(pcWord('EDUCATIONAL').tone, 'bad');
  assert.equal(pcWord('PORT_OFF').setting, true);
});
test('green means the tie-out passed, and nothing else does', () => {
  assert.equal(tieWord({ status: 'OK', total: 3, failed: 0 }).tone, 'good');
  for (const status of ['FAILED', 'UNSETTLED', 'REWRITTEN', 'PENDING', undefined])
    assert.notEqual(tieWord({ status }).tone, 'good', String(status));
  assert.equal(tieWord({}).word, 'owner.tally.tie.PENDING');
});
test('the books are live only when each company in use has finished copying', () => {
  const primary = (phase: string) => ({ role: 'PRIMARY' as const, phase });
  assert.equal(booksState([]), 'NONE');
  assert.equal(booksState([{ role: 'PENDING', phase: 'MASTERS' }]), 'NONE');
  assert.equal(booksState([{ role: 'IGNORE', phase: 'LIVE' }]), 'NONE');
  assert.equal(booksState([primary('LIVE')]), 'LIVE');
  assert.equal(booksState([primary('LIVE'), primary('BACKFILL')]), 'COPYING');
  assert.equal(booksState([primary('LIVE'), { role: 'BRANCH_COPY', phase: 'MASTERS' }]), 'LIVE');
});
test('a company with no live PC needs a person', () => {
  const pc = (id: string, revoked = false) => ({ id, revoked }) as TallyPc;
  assert.equal(pcGone({ ownerDeviceId: 'a' }, [pc('a')]), false);
  assert.equal(pcGone({ ownerDeviceId: 'a' }, [pc('a', true), pc('b')]), true);
  assert.equal(pcGone({ ownerDeviceId: null }, [pc('b')]), true);
  assert.equal(pcGone({ ownerDeviceId: 'gone' }, []), true);
});
test('roles have words, and a version is written the way the API takes it', () => {
  for (const role of ['PENDING', 'PRIMARY', 'BRANCH_COPY', 'IGNORE'] as const)
    assert.ok(en[roleWord(role)], role);
  assert.equal(isVersion('1.2.0'), true);
  assert.equal(isVersion('1.2'), false);
  assert.equal(isVersion('1.2.0; rm'), false);
  assert.equal(isVersion('12345.1.1'), false);
});
test('the PC is told the server only, never a path, with the code as given', () => {
  assert.equal(
    pairCommand('00123456', 'https://api.example.test/api/v1'),
    '"%ProgramFiles%\\ShivBridge\\node.exe" "%ProgramFiles%\\ShivBridge\\app\\main.mjs" pair 00123456 --api https://api.example.test',
  );
});
test('stored bytes read as a person would say them', () => {
  assert.equal(bytesWord(10), '10 B');
  assert.equal(bytesWord(2048), '2 KB');
  assert.equal(bytesWord(3 * 1024 * 1024), '3.0 MB');
});
