import { cache } from 'react';
import { z } from 'zod';
import { ApiError, productResponse, publicGet } from './api';

const shopResponse = z.object({
  contactApproved: z.boolean(),
  phone: z.string(),
  address: z.string(),
});
/**
 * The shop's approved public details; null when the store cannot be reached. Structured data is
 * a nicety, so the page waits at most two seconds for it rather than the usual ten. They change
 * only when the family approves new details, so one answer serves every visitor for ten minutes
 * (and the home page does not spend the API's per-address request budget on every view).
 */
export const readShop = cache(async () => {
  try {
    return await publicGet('/shop-content', shopResponse, AbortSignal.timeout(2000), 600);
  } catch {
    return null;
  }
});

// React cache deduplicates metadata and page reads within a request, never across visitors.
export const readProduct = cache(async (id: string) => {
  if (!id || id.length > 100) return { product: null, missing: true };
  try {
    return {
      product: await publicGet(`/products/${encodeURIComponent(id)}`, productResponse),
      missing: false,
    };
  } catch (error) {
    return { product: null, missing: error instanceof ApiError && error.status === 404 };
  }
});
