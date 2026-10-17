// Cursor lists refresh their first page on focus and polls. Merging keeps "load more" pages.
export function mergePage<T extends { id: string }>(old: T[], page: T[], first: boolean): T[] {
  if (!first) return [...old, ...page.filter((item) => !old.some((prev) => prev.id === item.id))];
  const fresh = new Set(page.map((item) => item.id));
  return [...page, ...old.filter((item) => !fresh.has(item.id))];
}
