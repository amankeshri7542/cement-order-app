import { cache } from 'react';
import { ApiError, productResponse, publicGet } from './api';

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
