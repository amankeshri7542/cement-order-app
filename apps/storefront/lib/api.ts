import { categorySchema, productSchema, type Product } from '@shiv/shared';
import { z } from 'zod';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace(
  /\/$/,
  '',
);
const id = z.string().min(1).max(100);
export const categoryResponse = categorySchema.strip().extend({ id });
// Strip unknown fields at the public boundary before passing data into rendering or RSC props.
export const productResponse = productSchema.strip().extend({
  id,
  // Public records can lack an optional merchandising note even though new edits require one.
  recommendedUse: z.string().trim().max(500),
  category: categoryResponse,
  version: z.number().int().positive(),
  priceVersion: z.number().int().positive(),
  priceUpdatedAt: z.iso.datetime(),
});
export const pageResponse = z.object({
  items: z.array(productResponse).max(100),
  nextCursor: z.string().max(2000).nullable(),
});
export const categoriesResponse = z.array(categoryResponse);
export const brandsResponse = z.array(z.object({ brand: z.string().max(80) })).max(50);
const amount = z.number().int().nonnegative().max(100_000_000);
export const deliveryResponse = z
  .object({
    serviceable: z.boolean(),
    zone: z
      .object({
        name: z.string(),
        deliveryFeePaise: amount,
        minimumOrderPaise: amount,
        freeDeliveryAbovePaise: amount.nullable(),
        estimate: z.string(),
      })
      .nullable(),
  })
  .refine((value) => value.serviceable === (value.zone !== null));

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Catalogue request failed (${status})`);
  }
}

export async function publicGet<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    credentials: 'omit',
    signal: signal ?? AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new ApiError(response.status);
  return schema.parse(await response.json());
}

export function approvedPhoto(product: Product): string | null {
  const configured = process.env.NEXT_PUBLIC_ASSET_ORIGIN;
  if (!configured) return null;
  try {
    const allowed = new URL(configured);
    if (allowed.protocol !== 'https:') return null;
    return (
      product.images.find((value) => {
        const url = new URL(value);
        return (
          url.origin === allowed.origin &&
          !url.username &&
          !url.password &&
          /^\/products\/[a-f0-9-]{36}\.webp$/.test(url.pathname) &&
          !url.search &&
          !url.hash
        );
      }) ?? null
    );
  } catch {
    return null;
  }
}
