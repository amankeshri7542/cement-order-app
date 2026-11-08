/**
 * What the desk is looking at (plan v4 02, section 3): every shop, one firm, or one shop. Chosen
 * in the top bar, remembered on this device, and read by pages through `useShopScope()`. The
 * server checks every read and write regardless; this only narrows what is shown.
 */
export type Scope =
  { kind: 'all' } | { kind: 'firm'; firmId: string } | { kind: 'shop'; shopId: string };

export const scopeStorageKey = 'shiv-desk-scope';
/** Before plan v4 B4a only a shop was remembered, under this key. */
export const legacyShopKey = 'shiv-desk-shop';

const id = /^[\w-]{1,100}$/;

/** A stored or chosen value back to a scope. Anything unknown is every shop. */
export function readScope(value: string | null | undefined): Scope {
  if (!value) return { kind: 'all' };
  const [kind, rest] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
  if (kind === 'shop' && id.test(rest)) return { kind: 'shop', shopId: rest };
  if (kind === 'firm' && id.test(rest)) return { kind: 'firm', firmId: rest };
  return { kind: 'all' };
}

export function writeScope(scope: Scope): string {
  return scope.kind === 'shop'
    ? `shop:${scope.shopId}`
    : scope.kind === 'firm'
      ? `firm:${scope.firmId}`
      : '';
}

/**
 * The scope this person may have: a shop or firm they cannot see falls back to every shop, so a
 * stale choice on a shared computer never shows an empty desk or asks for something refused.
 */
export function allowedScope(
  scope: Scope,
  shops: readonly { id: string }[],
  firms: readonly { id: string }[],
): Scope {
  if (scope.kind === 'shop')
    return shops.some((shop) => shop.id === scope.shopId) ? scope : { kind: 'all' };
  if (scope.kind === 'firm')
    return firms.length > 1 && firms.some((firm) => firm.id === scope.firmId)
      ? scope
      : { kind: 'all' };
  return scope;
}

/** The query a page sends with its reads: `locationId` for a shop, `firmId` for a firm. */
export function scopeParams(scope: Scope): Record<string, string> {
  return scope.kind === 'shop'
    ? { locationId: scope.shopId }
    : scope.kind === 'firm'
      ? { firmId: scope.firmId }
      : {};
}

/** The same as a query string to add to a path: '' or '?locationId=…' (or '&…' after a '?'). */
export function scopeQuery(scope: Scope, after: '?' | '&' = '?'): string {
  const params = new URLSearchParams(scopeParams(scope)).toString();
  return params ? `${after}${params}` : '';
}
