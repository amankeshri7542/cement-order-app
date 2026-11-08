/*
 * What was opened lately from the top bar's search, per person on this computer. Only a name and
 * an address are kept: no number, no balance, nothing that is not on the screen it opens. A
 * stored list that is not in this shape (old, tampered) is ignored.
 */
export type Recent = { href: string; label: string; group: 'customers' | 'orders' | 'products' };

const recentKey = (userId: string) => `shiv-desk-recent:${userId}`;
const recentHref = /^\/(customers|orders)\/[\w-]{1,100}$|^\/stock\?product=[\w-]{1,100}$/;
export function readRecent(userId: string): Recent[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(recentKey(userId)) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(
        (row): row is Recent =>
          !!row &&
          typeof row.href === 'string' &&
          recentHref.test(row.href) &&
          typeof row.label === 'string' &&
          row.label.length <= 120 &&
          ['customers', 'orders', 'products'].includes(row.group),
      )
      .slice(0, 6);
  } catch {
    return [];
  }
}
export function remember(userId: string, item: Recent) {
  try {
    const row = { ...item, label: item.label.slice(0, 120) };
    const next = [row, ...readRecent(userId).filter((row) => row.href !== item.href)].slice(0, 6);
    localStorage.setItem(recentKey(userId), JSON.stringify(next));
  } catch {
    // Private windows and full storage only lose the list.
  }
}
