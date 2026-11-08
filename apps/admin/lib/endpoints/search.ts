import { searchResponseSchema, type SearchGroup, type SearchResponse } from '@shiv/shared';
import { endpoint } from './core';

/** The top bar's search: customers, orders and goods, a few of each, each on its own permission. */
export const searchEndpoint = endpoint<
  SearchResponse,
  { q: string; only?: SearchGroup; limit?: number; locationId?: string; firmId?: string }
>({ key: ['search'], path: '/admin/search', schema: searchResponseSchema, scope: 'shop' });
