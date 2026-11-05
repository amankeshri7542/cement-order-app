import { MAX_QUANTITY, nextUp } from './quantity-steps';

// Your list: a small array on the phone, for everyone. Add never waits for a network and works with
// no signal. It is only a list: nothing about it is an order until the server has reviewed it.
// Plain logic, unit-tested under Node.

export type ListLine = {
  productId: string;
  quantity: number;
  /** The rate on screen when it was added, so the panel can say "Rate changed". */
  seenPricePaise?: number;
};
export const MAX_LINES = 50;

type Pack = { id: string; minQuantity: number; quantityStep: number };

/** Adds one pack, or one more step of what is already there. Null when the list is full. */
export function addLine(lines: ListLine[], product: Pack, seenPricePaise?: number | null) {
  const found = lines.find((line) => line.productId === product.id);
  if (found)
    return lines.map((line) =>
      line === found
        ? { ...line, quantity: nextUp(line.quantity, product.minQuantity, product.quantityStep) }
        : line,
    );
  if (lines.length >= MAX_LINES) return null;
  return [
    ...lines,
    {
      productId: product.id,
      quantity: product.minQuantity,
      ...(seenPricePaise == null ? {} : { seenPricePaise }),
    },
  ];
}

/** Sets a quantity; 0 takes the line off. A line not on the list is added, up to the limit. */
export function setLine(lines: ListLine[], productId: string, quantity: number) {
  if (quantity <= 0) return lines.filter((line) => line.productId !== productId);
  const found = lines.some((line) => line.productId === productId);
  if (found)
    return lines.map((line) => (line.productId === productId ? { ...line, quantity } : line));
  return lines.length >= MAX_LINES ? lines : [...lines, { productId, quantity }];
}

/** Puts a removed line back where it was. */
export function restoreLine(lines: ListLine[], line: ListLine, index: number) {
  if (lines.some((item) => item.productId === line.productId)) return lines;
  const next = [...lines];
  next.splice(Math.min(index, next.length), 0, line);
  return next.slice(0, MAX_LINES);
}

/** The lines that were placed come off; what could not be sold stays on the list. */
export function withoutPlaced(
  lines: ListLine[],
  placed: { productId: string; quantity: number }[],
) {
  const done = new Map(placed.map((line) => [line.productId, line.quantity]));
  return lines.filter((line) => done.get(line.productId) !== line.quantity);
}

/** A saved list as read back from the phone's storage, trusting nothing about its shape. */
export function cleanSaved(saved: unknown): ListLine[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  const lines: ListLine[] = [];
  for (const item of saved) {
    const { productId, quantity, seenPricePaise } = (item ?? {}) as Partial<ListLine>;
    if (typeof productId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(productId)) continue;
    if (!Number.isInteger(quantity) || quantity! < 1 || quantity! > MAX_QUANTITY) continue;
    if (seen.has(productId) || lines.length >= MAX_LINES) continue;
    seen.add(productId);
    lines.push({
      productId,
      quantity: quantity!,
      ...(Number.isInteger(seenPricePaise) && seenPricePaise! >= 0 ? { seenPricePaise } : {}),
    });
  }
  return lines;
}

export const lineCount = (lines: ListLine[]) => lines.length;

/**
 * The total as the phone can work it out at once. Lines with no known rate are left out, and `whole`
 * says so; the panel asks the server before anything can be placed.
 */
export function roughTotal(lines: ListLine[], rateOf: (id: string) => number | null | undefined) {
  let totalPaise = 0;
  let whole = true;
  for (const line of lines) {
    const rate = rateOf(line.productId);
    if (rate == null) whole = false;
    else totalPaise += rate * line.quantity;
  }
  return { totalPaise, whole };
}

/** Quantities keyed by product, so a row reads its own in one step. */
export const quantities = (lines: ListLine[]) =>
  Object.fromEntries(lines.map((line) => [line.productId, line.quantity]));
