import { roundUpQuantity, type QuantityRules } from './quantity';

/**
 * Plain arithmetic from sizes the customer types. No model does these sums. Nothing here gives a
 * slab, column, beam, footing, concrete or steel quantity for a part of a building, and nothing
 * ever should: those go to an engineer (plan 08 section 8).
 *
 * Every coefficient needs a signature. While `signedOff` is null, or a value is unknown, the
 * customer gets NOT_AVAILABLE and "Not available yet". Local brick sizes come from the family, so
 * no brick figure is written here until they and an engineer give one.
 */
export type SignOff = { by: string; on: string } | null;
export type Coefficient = { value: number | null; signedOff: SignOff };

export const estimateNote = 'Estimate. Check with your mason before buying.';

export const brickCoefficients = {
  bricksPerCubicFoot: { value: null, signedOff: null } as Coefficient,
  wastePercent: { value: null, signedOff: null } as Coefficient,
};
export const sariyaCoefficients = {
  // Weight of round steel in kg per metre is d squared over 162, d in mm.
  weightDivisor: { value: 162, signedOff: null } as Coefficient,
};

const usable = (coefficient: Coefficient): coefficient is { value: number; signedOff: SignOff } =>
  coefficient.value !== null && coefficient.signedOff !== null;

export type EstimateKind = 'BRICKS' | 'SARIYA_WEIGHT';
export type EstimateResult =
  | { kind: EstimateKind; status: 'NOT_AVAILABLE'; inputs: Record<string, number>; note: string }
  | { kind: EstimateKind; status: 'INVALID'; problem: string; inputs: Record<string, number> }
  | {
      kind: 'BRICKS';
      status: 'OK';
      inputs: Record<string, number>;
      assumptions: { bricksPerCubicFoot: number; wastePercent: number };
      result: { bricks: number; bricksWithWaste: number };
      note: string;
    }
  | {
      kind: 'SARIYA_WEIGHT';
      status: 'OK';
      inputs: Record<string, number>;
      assumptions: { weightDivisor: number };
      result: { kgPerMetre: number; totalKg: number };
      note: string;
    };

const inRange = (value: number, low: number, high: number) =>
  Number.isFinite(value) && value > low && value <= high;

/** Rounds up, so a float a hair above a whole number does not buy one brick more than it should. */
const ceil = (value: number) => Math.ceil(Number(value.toFixed(6)));

export type WallSize = {
  lengthFt: number;
  heightFt: number;
  thicknessInch: number;
  openingsSqFt?: number;
};

/** How many bricks a wall of this size takes. The wall's thickness is the customer's own. */
export function bricksForWall(
  wall: WallSize,
  coefficients: typeof brickCoefficients = brickCoefficients,
): EstimateResult {
  const openings = wall.openingsSqFt ?? 0;
  const inputs = {
    lengthFt: wall.lengthFt,
    heightFt: wall.heightFt,
    thicknessInch: wall.thicknessInch,
    openingsSqFt: openings,
  };
  const invalid = (problem: string) => ({
    kind: 'BRICKS' as const,
    status: 'INVALID' as const,
    problem,
    inputs,
  });
  if (!inRange(wall.lengthFt, 0, 1000) || !inRange(wall.heightFt, 0, 100))
    return invalid('The wall size looks wrong.');
  if (![4.5, 9].includes(wall.thicknessInch)) return invalid('Choose a 4.5 inch or 9 inch wall.');
  if (!Number.isFinite(openings) || openings < 0)
    return invalid('The door and window size looks wrong.');
  const area = wall.lengthFt * wall.heightFt;
  if (openings >= area) return invalid('The doors and windows are bigger than the wall.');
  const { bricksPerCubicFoot, wastePercent } = coefficients;
  if (!usable(bricksPerCubicFoot) || !usable(wastePercent))
    return { kind: 'BRICKS', status: 'NOT_AVAILABLE', inputs, note: estimateNote };
  const cubicFeet = ((area - openings) * wall.thicknessInch) / 12;
  const bricks = ceil(cubicFeet * bricksPerCubicFoot.value);
  return {
    kind: 'BRICKS',
    status: 'OK',
    inputs,
    assumptions: {
      bricksPerCubicFoot: bricksPerCubicFoot.value,
      wastePercent: wastePercent.value,
    },
    result: { bricks, bricksWithWaste: ceil((bricks * (100 + wastePercent.value)) / 100) },
    note: estimateNote,
  };
}

export type SariyaPiece = { diameterMm: number; lengthM: number; rods?: number };

/**
 * What this much sariya should weigh, to check a load on the kanta, using the customer's own
 * diameter. It is a weight check, never a quantity for a slab or any other part of a building.
 */
export function sariyaWeight(
  piece: SariyaPiece,
  coefficients: typeof sariyaCoefficients = sariyaCoefficients,
): EstimateResult {
  const rods = piece.rods ?? 1;
  const inputs = { diameterMm: piece.diameterMm, lengthM: piece.lengthM, rods };
  const invalid = (problem: string) => ({
    kind: 'SARIYA_WEIGHT' as const,
    status: 'INVALID' as const,
    problem,
    inputs,
  });
  if (!inRange(piece.diameterMm, 0, 60)) return invalid('The diameter looks wrong.');
  if (!inRange(piece.lengthM, 0, 100000)) return invalid('The length looks wrong.');
  if (!Number.isInteger(rods) || rods < 1 || rods > 100000)
    return invalid('The number of rods looks wrong.');
  const { weightDivisor } = coefficients;
  if (!usable(weightDivisor))
    return { kind: 'SARIYA_WEIGHT', status: 'NOT_AVAILABLE', inputs, note: estimateNote };
  const perMetre = (piece.diameterMm * piece.diameterMm) / weightDivisor.value;
  return {
    kind: 'SARIYA_WEIGHT',
    status: 'OK',
    inputs,
    assumptions: { weightDivisor: weightDivisor.value },
    result: {
      kgPerMetre: Number(perMetre.toFixed(3)),
      totalKg: Number((perMetre * piece.lengthM * rods).toFixed(2)),
    },
    note: estimateNote,
  };
}

/** What a quantity costs at the catalogue's rate. Whole paise only, never a float on money. */
export function estimateLine(
  quantity: number,
  product: QuantityRules & { pricePaise: number },
): { quantity: number; totalPaise: number } {
  const rounded = roundUpQuantity(product, Math.ceil(quantity));
  return { quantity: rounded, totalPaise: rounded * product.pricePaise };
}

/** Decision 32: one rate for every sum in this project. */
export const RUPEES_PER_DOLLAR = 95;

/** What a limit in rupees is in micro dollars, rounded down so it can never be overrun. */
export const rupeesToMicroUsd = (rupees: number) =>
  Math.floor((rupees * 1_000_000) / RUPEES_PER_DOLLAR);

/** What a spend in micro dollars is in whole paise, rounded up so a report never understates it. */
export const microUsdToPaise = (microUsd: number) =>
  Math.ceil((microUsd * RUPEES_PER_DOLLAR) / 10_000);
