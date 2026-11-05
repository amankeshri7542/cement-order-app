// The comparison is public catalogue ids kept for this tab only, so a reload keeps the choice.
export const COMPARE_KEY = 'shiv_compare_v2';
export const MAX_COMPARE = 3;
export function readCompare(): string[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(COMPARE_KEY) || '[]');
    return Array.isArray(raw)
      ? raw
          .filter((id): id is string => typeof id === 'string' && id.length <= 100)
          .slice(0, MAX_COMPARE)
      : [];
  } catch {
    return [];
  }
}
export function toggleCompare(id: string) {
  const now = readCompare();
  const next = now.includes(id)
    ? now.filter((item) => item !== id)
    : now.length < MAX_COMPARE
      ? [...now, id]
      : now;
  try {
    sessionStorage.setItem(COMPARE_KEY, JSON.stringify(next));
  } catch {
    /* Lasts for this page view only. */
  }
  return next;
}
