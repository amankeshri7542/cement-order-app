import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deductionsAllowed, workOutPay } from './pay';

const base = {
  monthlyPaise: 1_500_000,
  additionsPaise: 0,
  deductionsPaise: 0,
  plannedRecoveryPaise: 0,
  advanceBalancePaise: 0,
};
describe('a month’s pay', () => {
  test('is the fixed amount, with nothing taken for being late or away', () => {
    const line = workOutPay(base);
    assert.equal(line.earnedPaise, 1_500_000);
    assert.equal(line.netPaise, 1_500_000);
    assert.equal(line.roundOffPaise, 0);
  });
  test('additions and deductions, each by an owner, count in full', () => {
    const line = workOutPay({ ...base, additionsPaise: 100_000, deductionsPaise: 50_000 });
    assert.equal(line.earnedPaise, 1_600_000);
    assert.equal(line.netPaise, 1_550_000);
  });
  test('an advance is recovered as planned', () => {
    const line = workOutPay({
      ...base,
      plannedRecoveryPaise: 200_000,
      advanceBalancePaise: 500_000,
    });
    assert.equal(line.recoveryPaise, 200_000);
    assert.equal(line.netPaise, 1_300_000);
  });
  test('never more than is still owed on the advance', () => {
    const line = workOutPay({
      ...base,
      plannedRecoveryPaise: 200_000,
      advanceBalancePaise: 50_000,
    });
    assert.equal(line.recoveryPaise, 50_000);
  });
  test('together, never more than half the month: the rest waits for next month', () => {
    const line = workOutPay({
      ...base,
      deductionsPaise: 600_000,
      plannedRecoveryPaise: 500_000,
      advanceBalancePaise: 900_000,
    });
    assert.equal(line.recoveryPaise, 150_000);
    assert.equal(line.roomPaise, 0);
    assert.equal(line.netPaise, 750_000);
  });
  test('nothing recovered when deductions already reach the limit', () => {
    const line = workOutPay({
      ...base,
      deductionsPaise: 750_000,
      plannedRecoveryPaise: 100_000,
      advanceBalancePaise: 100_000,
    });
    assert.equal(line.recoveryPaise, 0);
  });
  test('pay rounds to the rupee, with the line shown', () => {
    const line = workOutPay({ ...base, additionsPaise: 40 });
    assert.equal(line.netPaise, 1_500_000);
    assert.equal(line.roundOffPaise, -40);
    const up = workOutPay({ ...base, additionsPaise: 60 });
    assert.equal(up.netPaise, 1_500_100);
    assert.equal(up.roundOffPaise, 40);
  });
  test('figures stay whole', () => {
    for (const monthlyPaise of [1, 3, 99, 1_333_333, 7_777_777]) {
      const line = workOutPay({
        ...base,
        monthlyPaise,
        plannedRecoveryPaise: 12345,
        advanceBalancePaise: 99999,
      });
      for (const value of Object.values(line)) assert.ok(Number.isInteger(value));
    }
  });
});
describe('the limit on deductions', () => {
  test('half is allowed, a paisa more is not', () => {
    assert.equal(deductionsAllowed(1000, 500), true);
    assert.equal(deductionsAllowed(1000, 501), false);
  });
});
