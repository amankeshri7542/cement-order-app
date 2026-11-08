import { z } from 'zod';

/*
 * Response shapes for the endpoints the desk's lists and Saathi read (plan v4, 09 section 7). The
 * API names them with @Returns next to @Contract, tests check real answers against them, and the
 * desk's endpoint layer (apps/admin/lib/endpoints) reads its data through them. Not every
 * endpoint: each rebuilt page adds its own.
 */
const id = z.string().min(1).max(200);
const moment = z.iso.datetime();
const paise = z.number().int();

/** One page of a list: the rows and where the next page starts. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

// ---- Search ---------------------------------------------------------------------------------
export const searchGroups = ['customers', 'orders', 'products'] as const;
export type SearchGroup = (typeof searchGroups)[number];

export const searchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(100),
  /** One group only, for a picker. */
  only: z.enum(searchGroups).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  locationId: id.optional(),
  firmId: id.optional(),
});

export const searchCustomerSchema = z.strictObject({
  id,
  name: z.string(),
  /** Masked unless this person may hold numbers. */
  phone: z.string(),
  area: z.string(),
  /** Only for those who may see who owes what (khata.read.list). */
  balancePaise: paise.nullable(),
});
export const searchOrderSchema = z.strictObject({
  id,
  number: z.string(),
  status: z.string(),
  locationId: id,
  createdAt: moment,
  /** Who it is for and what it is worth, only where this person may see the order's money. */
  customerName: z.string().nullable(),
  totalPaise: paise.nullable(),
});
export const searchProductSchema = z.strictObject({
  id,
  name: z.string(),
  brand: z.string(),
  unit: z.string(),
  stockMode: z.enum(['COUNTED', 'AVAILABILITY']),
  /** Per shop this person may see stock at. A heap of balu has no count, only on or off. */
  stock: z.array(
    z.strictObject({
      locationId: id,
      quantity: z.number().int().nullable(),
      low: z.boolean(),
    }),
  ),
});
/** A group is missing when this person may not read it, and empty when nothing matched. */
export const searchResponseSchema = z.strictObject({
  query: z.string(),
  customers: z.array(searchCustomerSchema).max(20).optional(),
  orders: z.array(searchOrderSchema).max(20).optional(),
  products: z.array(searchProductSchema).max(20).optional(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type SearchCustomer = z.infer<typeof searchCustomerSchema>;
export type SearchOrder = z.infer<typeof searchOrderSchema>;
export type SearchProductHit = z.infer<typeof searchProductSchema>;

// ---- Lists the desk reads through useList ---------------------------------------------------
/** A row of the customer list. Money and numbers follow the same rules as in search. */
export const customerRowSchema = z.looseObject({
  id,
  name: z.string(),
  phone: z.string(),
  area: z.string(),
  tags: z.array(z.string()),
  createdAt: moment,
  lastOrderAt: moment.nullable(),
  notesCount: z.number().int(),
  balancePaise: paise.optional(),
});
export const customerPageSchema = pageOf(customerRowSchema);

/** A row of the order list. Someone who may only load goods gets no money and no customer. */
export const orderRowSchema = z.looseObject({
  id,
  number: z.string(),
  status: z.string(),
  locationId: id,
  source: z.string(),
  deliveryDate: z.string(),
  createdAt: moment,
  items: z.array(z.looseObject({ id, name: z.string(), unit: z.string(), quantity: z.number() })),
  totalPaise: paise.optional(),
  user: z.looseObject({ id, name: z.string(), phone: z.string() }).optional(),
});
export const orderPageSchema = pageOf(orderRowSchema);
