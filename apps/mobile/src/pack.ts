import { unitLabel, type Language, type Product } from '@shiv/shared';

// Plain words for what a customer buys, in place of the shop's "minimum 10, in steps of 10".
//
// The shop types its units as it likes: "bag", "50 kg bag", "kg · 12 mm", "100 cu ft",
// "1,000 bricks". Only a unit that is a single container word can be turned into a true sentence
// ("1 bag = 50 kg", "At least 10 bags"); anything else is left to say what it says.

const containers = [
  'bag',
  'bundle',
  'trolley',
  'piece',
  'pc',
  'box',
  'carton',
  'roll',
  'sheet',
  'packet',
  'pack',
  'drum',
  'can',
  'bucket',
];
/** The container word a unit is, in its singular form ("Pieces" → "piece"), or null. */
function containerWord(unit: string) {
  const word = unit.trim().toLowerCase();
  return containers.find((c) => word === c || word === `${c}s` || word === `${c}es`) ?? null;
}
const isContainer = (unit: string) => containerWord(unit) !== null;

/** "bag" → "bags", "box" → "boxes"; one of anything stays as it is. */
function plural(unit: string, count: number) {
  const base = containerWord(unit) ?? unit.trim();
  if (count === 1) return base;
  return /(x|ch|sh)$/.test(base) ? `${base}es` : `${base}s`;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What one container holds: "1 bag = 50 kg". Empty unless the unit is a container word and the
 * pack size describes what is inside it. A pack size that already ends with the unit ("50 kg bag"
 * sold per "bag") is not said twice; one that names the unit elsewhere, or is only a number,
 * would make a wrong sentence, so it says nothing.
 */
export function packLine(product: Pick<Product, 'unit' | 'packSize'>, language: Language) {
  const size = product.packSize?.trim();
  const unit = product.unit.trim();
  if (!size || !isContainer(unit)) return '';
  const word = escape(unit);
  const inside = size.replace(new RegExp(`\\s*\\b${word}s?\\s*$`, 'i'), '').trim();
  const repeats = new RegExp(`\\b${word}s?\\b`, 'i').test(inside);
  if (!inside || repeats || !/[A-Za-z\u0905-\u0939]/.test(inside)) return '';
  return `1 ${unitLabel(unit, language)} = ${unitLabel(inside, language)}`;
}

/**
 * The ordering rule in plain words; empty when any whole number can be ordered. The unit is named
 * only when it is a container word, so a phrase unit never becomes "12 mms".
 */
export function orderRule(
  product: Pick<Product, 'unit' | 'minQuantity' | 'quantityStep'>,
  language: Language,
) {
  const { minQuantity: min, quantityStep: step } = product;
  if (min <= 1 && step <= 1) return '';
  const named = isContainer(product.unit);
  if (language === 'hi') {
    const unit = named ? ` ${unitLabel(product.unit.trim(), 'hi')}` : '';
    return `कम से कम ${min}${unit}${step > 1 ? `, ${step}-${step} की गिनती में` : ''}`;
  }
  const unit = named ? ` ${plural(product.unit, min)}` : '';
  return `At least ${min}${unit}${step > 1 ? `, in lots of ${step}` : ''}`;
}
