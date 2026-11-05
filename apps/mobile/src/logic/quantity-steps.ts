// How a stepper moves. Plain logic, unit-tested under Node.
export const MAX_QUANTITY = 10000;

/** The next quantity up, keeping to the pack rule. */
export function nextUp(value: number, min: number, step: number) {
  const up = Math.max(min, (Math.floor(value / step) + 1) * step);
  return up > MAX_QUANTITY ? value : up;
}

/** The next quantity down; below the smallest allowed it means take it off the list (0). */
export function nextDown(value: number, min: number, step: number) {
  const down = (Math.ceil(value / step) - 1) * step;
  return down < min ? 0 : down;
}

/** What was typed, as a quantity: 0 takes it off, null means it breaks the pack rule. */
export function parseTyped(text: string, min: number, step: number): number | null {
  if (!/^\d+$/.test(text)) return null;
  const typed = Number(text);
  if (typed === 0) return 0;
  if (typed < min || typed > MAX_QUANTITY || typed % step !== 0) return null;
  return typed;
}
