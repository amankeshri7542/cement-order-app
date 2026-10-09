import { z } from 'zod';

export const roles = ['CUSTOMER', 'CONTRACTOR', 'ADMIN'] as const;
export const orderStatuses = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'DELIVERY_EXCEPTION',
  'DELIVERED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;
export type Role = (typeof roles)[number];
export type OrderStatus = (typeof orderStatuses)[number];
export const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_EXCEPTION'],
  DELIVERY_EXCEPTION: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: ['REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
};
export const phoneSchema = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Enter a valid Indian mobile number');
const text = (max = 200) => z.string().trim().min(1).max(max);
const paise = z.number().int().min(0).max(100_000_000);
const id = z.string().min(1).max(100);
export const otpRequestSchema = z.strictObject({ phone: phoneSchema });
export const otpVerifySchema = z.strictObject({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/),
  adminPassword: z.string().min(12).max(200).optional(),
});
export const refreshSchema = z.strictObject({
  refreshToken: z.string().min(32).max(200).optional(),
});
export const profileSchema = z.strictObject({
  name: text(100).optional(),
  language: z.enum(['en', 'hi']),
  contractor: z.boolean().optional(),
});
export const addressSchema = z.strictObject({
  label: text(40),
  name: text(100),
  phone: phoneSchema,
  line1: text(250),
  area: text(120),
  city: text(100),
  state: z.literal('Bihar'),
  pincode: z.string().regex(/^\d{6}$/),
  landmark: z.string().trim().max(200).default(''),
});
export const cartItemSchema = z.strictObject({
  productId: id,
  quantity: z.number().int().min(0).max(10000),
});
export const checkoutSchema = z.strictObject({
  addressId: id,
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).default(''),
  paymentMethod: z.enum(['COD', 'ONLINE']),
});
export const placeOrderSchema = z.strictObject({ reviewId: id, idempotencyKey: z.string().uuid() });
export const productSchema = z.strictObject({
  packSize: z.string().trim().max(100).default(''),
  minQuantity: z.number().int().min(1).max(10000).default(1),
  quantityStep: z.number().int().min(1).max(10000).default(1),
  name: text(120),
  brand: text(80),
  categoryId: id,
  type: text(80),
  grade: text(40),
  unit: text(50),
  pricePaise: paise.refine((v) => v > 0),
  stock: z.number().int().min(0).max(1_000_000),
  active: z.boolean(),
  description: text(1500),
  recommendedUse: text(500),
  images: z.array(z.url().startsWith('https://')).max(6).default([]),
});
export const productUpdateSchema = productSchema.extend({
  expectedVersion: z.number().int().min(1),
});
export const categorySchema = z.strictObject({
  name: text(60),
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
});
export const settingsSchema = z.strictObject({
  phone: phoneSchema,
  deliveryFeePaise: paise,
  freeDeliveryAbovePaise: paise.nullable(),
  onlinePaymentsEnabled: z.boolean(),
  deliveryMessage: text(250),
  expectedVersion: z.number().int().min(1),
});
export const orderStatusSchema = z.strictObject({
  status: z.enum(orderStatuses),
  note: z.string().trim().max(500).default(''),
});
export const quoteRequestSchema = z.strictObject({
  idempotencyKey: z.string().uuid().optional(),
  items: z
    .array(z.strictObject({ productId: id, quantity: z.number().int().min(1).max(100000) }))
    .min(1)
    .max(50),
  addressId: id,
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  company: z.string().trim().max(150).default(''),
  gstin: z
    .string()
    .trim()
    .regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
    .default(''),
  notes: z.string().trim().max(1500).default(''),
});
export const quoteOfferSchema = z.strictObject({
  deliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  deliveryConfirmed: z.boolean().default(false),
  expectedRevision: z.number().int().min(0),
  items: z
    .array(z.strictObject({ productId: id, unitPricePaise: paise.refine((v) => v > 0) }))
    .min(1)
    .max(50),
  deliveryFeePaise: paise,
  validUntil: z.iso.datetime(),
  note: z.string().trim().max(1500).default(''),
});
export const quoteRespondSchema = z.strictObject({
  revision: z.number().int().min(1),
  status: z.enum(['ACCEPTED', 'REJECTED']),
});
export const paymentVerifySchema = z.strictObject({
  orderId: id,
  razorpayOrderId: text(100),
  razorpayPaymentId: text(100),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});
export const uploadSchema = z.strictObject({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z
    .number()
    .int()
    .min(1)
    .max(5 * 1024 * 1024),
});
export const deviceSchema = z.strictObject({
  token: z.string().min(20).max(4096),
  platform: z.enum(['android', 'ios']),
});

export type AddressInput = z.infer<typeof addressSchema>;
export type Address = AddressInput & { id: string };
export type User = {
  id: string;
  phone: string;
  name: string;
  role: Role;
  language: 'en' | 'hi';
  contractorStatus?: string;
  deletedAt?: string | null;
};
export type Category = { id: string; name: string; slug: string };
export type Product = z.infer<typeof productSchema> & {
  id: string;
  category: Category;
  priceVersion: number;
  version: number;
  priceUpdatedAt: string;
};
export type StoreSettings = Omit<z.infer<typeof settingsSchema>, 'expectedVersion'> & {
  version: number;
  onlinePaymentsAvailable: boolean;
  storeName: string;
};
export type CartLine = {
  productId: string;
  quantity: number;
  seenPricePaise: number;
  seenPriceVersion: number;
  product: Product;
};
export type ReviewLine = {
  packSize?: string;
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  pricePaise: number;
  priceVersion: number;
  lineTotalPaise: number;
};
export type CheckoutReview = {
  id: string;
  expiresAt: string;
  items: ReviewLine[];
  subtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  changes: { name: string; oldPricePaise: number; newPricePaise: number }[];
  address: Address;
  deliveryDate: string;
  notes: string;
  paymentMethod: 'COD' | 'ONLINE';
  settingsVersion: number;
  deliveryZoneId: string;
  deliveryZoneVersion: number;
  deliveryEstimate: string;
};
export type Payment = {
  initializationStartedAt?: string | null;
  status: 'PENDING' | 'CAPTURED' | 'REFUND_PENDING' | 'REFUNDED';
  method: 'COD' | 'ONLINE';
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
};
export type Order = {
  quoteId?: string | null;
  quoteRevision?: number | null;
  work?: OwnerWork | null;
  deliveryAttempts?: DeliveryAttempt[];
  id: string;
  number: string;
  userId: string;
  status: OrderStatus;
  createdAt: string;
  deliveryDate: string;
  notes: string;
  address: Address;
  items: ReviewLine[];
  subtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  payment: Payment;
  history: { id: string; status: OrderStatus; note: string; createdAt: string }[];
  user?: User;
};
export type Quote = {
  work?: OwnerWork | null;
  deliveryConfirmed?: boolean;
  order?: { id: string; number: string } | null;
  decisionSource?: string | null;
  decisionNote?: string;
  decisionAt?: string | null;
  id: string;
  number: string;
  status: 'REQUESTED' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  revision: number;
  company: string;
  gstin: string;
  notes: string;
  adminNote: string;
  address: Address;
  deliveryDate: string;
  validUntil: string | null;
  createdAt: string;
  items: {
    packSize?: string;
    productId: string;
    name: string;
    quantity: number;
    unit: string;
    unitPricePaise: number | null;
  }[];
  totalPaise: number | null;
  deliveryFeePaise: number;
  user?: User;
};

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
export const money = (value: number) => inr.format(value / 100);
export const statusLabel = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (v) => v.toUpperCase());
export function totals(
  lines: { pricePaise: number; quantity: number }[],
  deliveryFeePaise: number,
  freeAbove: number | null,
) {
  if (
    !Number.isSafeInteger(deliveryFeePaise) ||
    deliveryFeePaise < 0 ||
    (freeAbove !== null && (!Number.isSafeInteger(freeAbove) || freeAbove < 0))
  )
    throw new Error('Invalid delivery policy');
  const subtotalPaise = lines.reduce((sum, line) => {
    if (
      !Number.isSafeInteger(line.pricePaise) ||
      line.pricePaise < 0 ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1
    )
      throw new Error('Invalid order line');
    const next = sum + line.pricePaise * line.quantity;
    if (!Number.isSafeInteger(next) || next > 2_000_000_000)
      throw new Error('Order exceeds supported total');
    return next;
  }, 0);
  const fee = freeAbove !== null && subtotalPaise >= freeAbove ? 0 : deliveryFeePaise;
  if (subtotalPaise + fee > 2_000_000_000) throw new Error('Order exceeds supported total');
  return { subtotalPaise, deliveryFeePaise: fee, totalPaise: subtotalPaise + fee };
}

export type Page<T> = { items: T[]; nextCursor: string | null };
export type OwnerWork = {
  id: string;
  orderId: string | null;
  quoteId: string | null;
  assignedTo?: Pick<User, 'id' | 'name' | 'phone'> | null;
  technicalOwner?: Pick<User, 'id' | 'name' | 'phone'> | null;
  acknowledgedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  attempts: number;
  lastError: string | null;
};
export type DeliveryAttempt = {
  id: string;
  action: string;
  reason: string | null;
  note: string;
  retryDate: string | null;
  createdAt: string;
};
export const deliveryActionSchema = z.strictObject({
  action: z.enum(['REPORT', 'RETRY', 'RETURN']),
  reason: z.enum(['UNAVAILABLE', 'REFUSED', 'INACCESSIBLE']).optional(),
  note: text(500),
  retryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  items: z
    .array(
      z.strictObject({
        productId: id,
        sellableQuantity: z.number().int().min(0).max(100000),
        damagedQuantity: z.number().int().min(0).max(100000),
      }),
    )
    .max(50)
    .optional(),
  idempotencyKey: z.string().uuid(),
});
export const inventorySchema = z.strictObject({
  kind: z.enum(['PURCHASE_IN', 'WALK_IN_SALE', 'RETURN', 'DAMAGE', 'MANUAL_ADJUSTMENT']),
  quantity: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((v) => v !== 0),
  note: text(500),
  reference: z.string().trim().max(100).default(''),
  idempotencyKey: z.string().uuid(),
});
export type InventoryMovement = {
  id: string;
  productId: string;
  kind: string;
  quantity: number;
  balanceAfter: number;
  actorId: string;
  reference: string;
  note: string;
  createdAt: string;
};
export const deliveryZoneSchema = z.strictObject({
  name: text(100),
  active: z.boolean(),
  deliveryFeePaise: paise,
  minimumOrderPaise: paise,
  freeDeliveryAbovePaise: paise.nullable(),
  estimate: text(200),
  pincodes: z
    .array(z.string().regex(/^[1-9]\d{5}$/))
    .min(1)
    .max(500)
    .refine((v) => new Set(v).size === v.length, 'Duplicate pincodes'),
  expectedVersion: z.number().int().min(1).optional(),
});
export type DeliveryZone = Omit<
  z.infer<typeof deliveryZoneSchema>,
  'pincodes' | 'expectedVersion'
> & { id: string; version: number; pincodes: { pincode: string }[] };
export const contractorDecisionSchema = z.strictObject({
  status: z.enum(['VERIFIED', 'REJECTED']),
  note: text(500),
});
export const deletionSchema = z.strictObject({ confirmation: z.literal('DELETE') });
export const storeQuoteRespondSchema = quoteRespondSchema.extend({ note: text(500) });
export type SessionInfo = {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
  deviceCount: number;
};

export * from './rate-studio';
