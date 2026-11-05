/** Stops go in the order chosen. Moving one past its neighbour swaps the two. */
export function moved<T>(list: readonly T[], index: number, step: -1 | 1): T[] {
  const next = [...list];
  const other = index + step;
  if (index < 0 || other < 0 || other >= list.length) return next;
  [next[index], next[other]] = [next[other]!, next[index]!];
  return next;
}
