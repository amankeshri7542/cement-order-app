import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  brickCoefficients,
  bricksForWall,
  estimateLine,
  estimateNote,
  microUsdToPaise,
  RUPEES_PER_DOLLAR,
  rupeesToMicroUsd,
  sariyaCoefficients,
  sariyaWeight,
} from './estimates';

// These vectors are worked by hand, on test-only figures. No real coefficient is signed yet. The
// engineer works the real ones by hand and signs them before any customer sees a sum.
const testBricks = {
  bricksPerCubicFoot: { value: 10, signedOff: { by: 'TEST', on: '2026-11-05' } },
  wastePercent: { value: 5, signedOff: { by: 'TEST', on: '2026-11-05' } },
};
const testSariya = { weightDivisor: { value: 162, signedOff: { by: 'TEST', on: '2026-11-05' } } };

describe('nothing is sold on an unsigned figure', () => {
  test('the shipped coefficients carry no signature', () => {
    assert.equal(brickCoefficients.bricksPerCubicFoot.signedOff, null);
    assert.equal(brickCoefficients.wastePercent.signedOff, null);
    assert.equal(sariyaCoefficients.weightDivisor.signedOff, null);
  });
  test('no brick figure is written down at all until the family and an engineer give one', () => {
    assert.equal(brickCoefficients.bricksPerCubicFoot.value, null);
    assert.equal(brickCoefficients.wastePercent.value, null);
  });
  test('so the customer gets "not available yet", with their sizes shown back', () => {
    const wall = bricksForWall({ lengthFt: 30, heightFt: 10, thicknessInch: 9 });
    assert.equal(wall.status, 'NOT_AVAILABLE');
    assert.deepEqual(wall.inputs, {
      lengthFt: 30,
      heightFt: 10,
      thicknessInch: 9,
      openingsSqFt: 0,
    });
    assert.equal(sariyaWeight({ diameterMm: 12, lengthM: 12 }).status, 'NOT_AVAILABLE');
  });
  test('a figure with a value and no signature still does not count', () => {
    const unsigned = {
      bricksPerCubicFoot: { value: 10, signedOff: null },
      wastePercent: { value: 5, signedOff: { by: 'TEST', on: '2026-11-05' } },
    };
    assert.equal(
      bricksForWall({ lengthFt: 30, heightFt: 10, thicknessInch: 9 }, unsigned).status,
      'NOT_AVAILABLE',
    );
  });
});

describe('bricks for a wall', () => {
  test('a 30 by 10 foot, 9 inch wall: 225 cubic feet at 10 a cubic foot, 5% waste', () => {
    const wall = bricksForWall({ lengthFt: 30, heightFt: 10, thicknessInch: 9 }, testBricks);
    assert.equal(wall.status, 'OK');
    if (wall.status === 'OK' && wall.kind === 'BRICKS') {
      assert.equal(wall.result.bricks, 2250);
      assert.equal(wall.result.bricksWithWaste, 2363);
      assert.equal(wall.note, estimateNote);
      assert.deepEqual(wall.assumptions, { bricksPerCubicFoot: 10, wastePercent: 5 });
    }
  });
  test('a 4.5 inch wall with a door taken out: (100 - 21) x 4.5 / 12 = 29.625 cubic feet', () => {
    const wall = bricksForWall(
      { lengthFt: 10, heightFt: 10, thicknessInch: 4.5, openingsSqFt: 21 },
      testBricks,
    );
    if (wall.status !== 'OK' || wall.kind !== 'BRICKS') assert.fail(wall.status);
    assert.equal(wall.result.bricks, 297);
    assert.equal(wall.result.bricksWithWaste, 312);
  });
  test('rounds up, and is not pushed over by a float', () => {
    const exact = bricksForWall({ lengthFt: 12, heightFt: 10, thicknessInch: 9 }, testBricks);
    if (exact.status !== 'OK' || exact.kind !== 'BRICKS') assert.fail(exact.status);
    assert.equal(exact.result.bricks, 900);
  });
  for (const [name, wall] of [
    ['zero length', { lengthFt: 0, heightFt: 10, thicknessInch: 9 }],
    ['negative height', { lengthFt: 10, heightFt: -1, thicknessInch: 9 }],
    ['a thickness we do not offer', { lengthFt: 10, heightFt: 10, thicknessInch: 12 }],
    ['not a number', { lengthFt: Number.NaN, heightFt: 10, thicknessInch: 9 }],
    ['absurdly long', { lengthFt: 100000, heightFt: 10, thicknessInch: 9 }],
    [
      'doors bigger than the wall',
      { lengthFt: 10, heightFt: 10, thicknessInch: 9, openingsSqFt: 100 },
    ],
    ['negative openings', { lengthFt: 10, heightFt: 10, thicknessInch: 9, openingsSqFt: -5 }],
  ] as const)
    test(`refuses ${name}`, () => {
      assert.equal(bricksForWall(wall, testBricks).status, 'INVALID');
      assert.equal(bricksForWall(wall).status, 'INVALID');
    });
});

describe('the weight of sariya, for checking a load on the kanta', () => {
  test('12 mm is 144 / 162 kg a metre', () => {
    const piece = sariyaWeight({ diameterMm: 12, lengthM: 1 }, testSariya);
    if (piece.status !== 'OK' || piece.kind !== 'SARIYA_WEIGHT') assert.fail(piece.status);
    assert.equal(piece.result.kgPerMetre, 0.889);
  });
  test('10 rods of 16 mm, 12 m long: 256 / 162 x 120 = 189.63 kg', () => {
    const load = sariyaWeight({ diameterMm: 16, lengthM: 12, rods: 10 }, testSariya);
    if (load.status !== 'OK' || load.kind !== 'SARIYA_WEIGHT') assert.fail(load.status);
    assert.equal(load.result.totalKg, 189.63);
  });
  for (const [name, piece] of [
    ['a zero diameter', { diameterMm: 0, lengthM: 1 }],
    ['a huge diameter', { diameterMm: 500, lengthM: 1 }],
    ['a negative length', { diameterMm: 12, lengthM: -1 }],
    ['part of a rod', { diameterMm: 12, lengthM: 1, rods: 1.5 }],
    ['no rods', { diameterMm: 12, lengthM: 1, rods: 0 }],
  ] as const)
    test(`refuses ${name}`, () => {
      assert.equal(sariyaWeight(piece, testSariya).status, 'INVALID');
    });
  test('nothing here takes a slab, a column or an area', () => {
    const keys = Object.keys(sariyaWeight({ diameterMm: 12, lengthM: 1 }).inputs).sort();
    assert.deepEqual(keys, ['diameterMm', 'lengthM', 'rods']);
  });
});

describe('what a quantity costs', () => {
  const rules = { minQuantity: 5, quantityStep: 5, pricePaise: 41000 };
  test('rounds up to what the shop sells, in whole paise', () => {
    assert.deepEqual(estimateLine(7, rules), { quantity: 10, totalPaise: 410000 });
    assert.deepEqual(estimateLine(2, rules), { quantity: 5, totalPaise: 205000 });
    assert.deepEqual(estimateLine(7.2, rules), { quantity: 10, totalPaise: 410000 });
  });
  test('stays a whole number, with no float on money', () => {
    assert.ok(
      Number.isInteger(
        estimateLine(3333, { minQuantity: 1, quantityStep: 1, pricePaise: 12345 }).totalPaise,
      ),
    );
  });
});

describe('₹95 to the dollar (decision 32)', () => {
  test('is the one rate', () => {
    assert.equal(RUPEES_PER_DOLLAR, 95);
  });
  test('₹300 a month and ₹10 a day, rounded down so they cannot be overrun', () => {
    assert.equal(rupeesToMicroUsd(300), 3_157_894);
    assert.equal(rupeesToMicroUsd(10), 105_263);
    assert.ok((rupeesToMicroUsd(300) * 95) / 1_000_000 <= 300);
  });
  test('spend reads in paise, rounded up so a report never understates it', () => {
    assert.equal(microUsdToPaise(1_000_000), 9500);
    assert.equal(microUsdToPaise(1), 1);
    assert.equal(microUsdToPaise(0), 0);
    assert.equal(microUsdToPaise(105_263), 1000);
    assert.equal(microUsdToPaise(3_157_894), 30000);
  });
});
