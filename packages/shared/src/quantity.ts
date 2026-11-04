import type { Language } from './i18n';

// One copy of the selling rules the API enforces (apps/api/src/inventory.ts validateQuantity):
// a whole number, at least the minimum, a multiple of the step, and no more than allowed.
export type QuantityRules = { minQuantity: number; quantityStep: number };
export type QuantityProblem = 'whole' | 'minimum' | 'step' | 'maximum';
export const MAX_LINE_QUANTITY = 10000;

export function quantityProblem(
  product: QuantityRules,
  quantity: number,
  max: number = MAX_LINE_QUANTITY,
): QuantityProblem | null {
  if (!Number.isInteger(quantity)) return 'whole';
  if (quantity < product.minQuantity) return 'minimum';
  if (quantity % product.quantityStep !== 0) return 'step';
  if (quantity > max) return 'maximum';
  return null;
}
export const isValidQuantity = (product: QuantityRules, quantity: number, max?: number) =>
  quantityProblem(product, quantity, max) === null;

/** The largest valid quantity not above `limit` (stock or line cap), or 0 when none fits. */
export function maxOrderable(product: QuantityRules, limit: number) {
  const top =
    Math.floor(Math.min(limit, MAX_LINE_QUANTITY) / product.quantityStep) * product.quantityStep;
  return top >= product.minQuantity ? top : 0;
}
/** The first valid quantity at or above `value` (used to round a typed amount up). */
export function roundUpQuantity(product: QuantityRules, value: number) {
  const atLeastMinimum = Math.max(value, product.minQuantity);
  return Math.ceil(atLeastMinimum / product.quantityStep) * product.quantityStep;
}
export function stepUp(product: QuantityRules, value: number) {
  return roundUpQuantity(product, value + product.quantityStep);
}
/** One step down; 0 means "remove" once the minimum would be crossed. */
export function stepDown(product: QuantityRules, value: number) {
  const next = value - product.quantityStep;
  return next < product.minQuantity ? 0 : next;
}

export function quantityHint(product: QuantityRules, max: number, language: Language) {
  return language === 'hi'
    ? `न्यूनतम ${product.minQuantity}; ${product.quantityStep} के गुणक; अधिकतम ${max}।`
    : `Minimum ${product.minQuantity}; multiples of ${product.quantityStep}; maximum ${max}.`;
}
