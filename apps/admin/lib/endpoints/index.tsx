'use client';
import { useInfiniteQuery, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import type { Page } from '@shiv/shared';
import { useOwner } from '../owner';
import { keyFor, scopeFor, type Endpoint, type Params } from './core';

export * from './core';
export * from './lists';
export * from './search';

/**
 * One list, page by page, as the list contract describes (plan v4, 09 section 3): the filters and
 * the top bar's shop or firm go in the request and the key, and "more" asks for the next cursor.
 * The first page shows the previous answer while a new filter loads, so the list does not jump.
 */
export function useList<T, P extends Params>(
  list: Endpoint<Page<T>, P & { cursor?: string }>,
  filters: P,
  options: { enabled?: boolean } = {},
) {
  const { scope, shops } = useOwner();
  const params = { ...filters, ...scopeFor(list.scope, scope, shops) } as P;
  return useInfiniteQuery<Page<T>, Error, InfiniteData<Page<T>>, QueryKey, string | null>({
    queryKey: keyFor(list, params),
    initialPageParam: null,
    placeholderData: (previous) => previous,
    enabled: options.enabled ?? true,
    queryFn: ({ pageParam }) =>
      list.fetch({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
