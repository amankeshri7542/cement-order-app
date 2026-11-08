import type { QueryKey } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import type { Scope } from '../scope';

/*
 * The desk's typed endpoint layer (plan v4, 02 section 6). One definition per API call: where it
 * lives, the shared schema its answer must match, and which part of the top bar's shop or firm it
 * takes. Pages call these instead of building URLs, so a page cannot forget the scope and an answer
 * in the wrong shape is caught here rather than half-drawn on screen.
 */

export type Params = Record<string, string | number | undefined | null>;
/** A shared zod schema, as far as the desk needs one. The desk itself does not depend on zod. */
export type Schema<T> = {
  safeParse(
    data: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: unknown[] } };
};
/**
 * Which part of the top bar's choice an endpoint takes:
 * - `shop`: the shop, or the firm, as `locationId` or `firmId`;
 * - `firm`: the firm only, with a chosen shop standing for its firm (customers are per firm);
 * - `none`: nothing; the endpoint is not about shops.
 */
export type ScopeKind = 'shop' | 'firm' | 'none';

export type Endpoint<T, P extends Params> = {
  /** The start of every query key for this call; refresh rules invalidate by it. */
  key: readonly string[];
  path: string;
  schema: Schema<T>;
  scope: ScopeKind;
  url(params: P): string;
  fetch(params: P): Promise<T>;
};

/** Parameters as a query string: sorted, empty values left out, so equal filters give one URL. */
export function queryString(params: Params) {
  const search = new URLSearchParams();
  for (const name of Object.keys(params).sort()) {
    const value = params[name];
    if (value === undefined || value === null || value === '') continue;
    search.set(name, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** The answer, checked against its schema. A wrong shape is a server error to the person. */
export function readAnswer<T>(schema: Schema<T>, data: unknown, path: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  if (process.env.NODE_ENV !== 'production')
    console.error(`Unexpected answer from ${path}`, parsed.error.issues.slice(0, 5));
  throw new ApiError(
    'BAD_RESPONSE',
    'The store server answered in an unexpected shape.',
    'error.server',
  );
}

export function endpoint<T, P extends Params = Params>(definition: {
  key: readonly string[];
  path: string;
  schema: Schema<T>;
  scope: ScopeKind;
}): Endpoint<T, P> {
  const url = (params: P) => definition.path + queryString(params);
  return {
    ...definition,
    url,
    fetch: async (params) =>
      readAnswer(definition.schema, await api<unknown>(url(params)), definition.path),
  };
}

/**
 * The parameters an endpoint sends for the top bar's choice. For a per-firm endpoint, a chosen
 * shop stands for its firm.
 */
export function scopeFor(
  kind: ScopeKind,
  scope: Scope,
  shops: readonly { id: string; firmId?: string }[],
): Params {
  if (kind === 'none' || scope.kind === 'all') return {};
  if (kind === 'shop')
    return scope.kind === 'shop' ? { locationId: scope.shopId } : { firmId: scope.firmId };
  if (scope.kind === 'firm') return { firmId: scope.firmId };
  const firmId = shops.find((shop) => shop.id === scope.shopId)?.firmId;
  return firmId ? { firmId } : {};
}

/** The query key for one call: the endpoint's key, then its parameters in a fixed order. */
export function keyFor(endpoint: { key: readonly string[] }, params: Params): QueryKey {
  return [...endpoint.key, queryString(params)];
}
