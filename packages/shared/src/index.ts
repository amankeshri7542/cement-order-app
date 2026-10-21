import { z } from 'zod';
import { t as translate, isMessageKey } from '@shiv/i18n';

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
/**
 * The ten-digit part of an Indian mobile as typed, pasted or autofilled: "+91 98765 43210",
 * "098765-43210" and "(0091) 98765 43210" all become "9876543210". A prefix is dropped only
 * once a digit follows, so typing "+91" by hand is not erased mid-entry.
 */
export function localPhone(value: string) {
  return value
    .replace(/[\s().-]/g, '')
    .replace(/^(?:\+91|0091)(?=\d)/, '')
    .replace(/^91(?=[6-9]\d{9}$)/, '')
    .replace(/^0(?=[6-9])/, '');
}
/** For digits-only phone fields with a fixed +91 label: never keeps the first ten of twelve. */
export function phoneDigits(value: string) {
  return localPhone(value).replace(/\D/g, '').slice(0, 10);
}
const text = (max = 200) => z.string().trim().min(1).max(max);
const paise = z.number().int().min(0).max(100_000_000);
const id = z.string().min(1).max(100);
// An optional translation: blank clears it (null), leaving the field out keeps the saved text.
// A preprocess rather than a transform, so the API contract still renders as JSON Schema.
const translation = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );
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
export const cartMergeSchema = z.strictObject({
  idempotencyKey: z.string().uuid(),
  items: z
    .array(cartItemSchema.extend({ quantity: z.number().int().min(1).max(10000) }))
    .min(1)
    .max(50)
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, {
      message: 'Each product must appear only once.',
    }),
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
  // Hindi name and description, shown to Hindi readers when set (see productName).
  nameHi: translation(120),
  brand: text(80),
  categoryId: id,
  type: text(80),
  grade: text(40),
  unit: text(50),
  pricePaise: paise.refine((v) => v > 0),
  stock: z.number().int().min(0).max(1_000_000),
  // "Running low" at or below this many units (each material has its own level).
  lowStockAt: z.number().int().min(0).max(1_000_000).default(25),
  active: z.boolean(),
  description: text(1500),
  descriptionHi: translation(1500),
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
  // Unloading, floors, vehicle and time window, shown to the customer with the offer.
  deliveryTerms: z.string().trim().max(500).default(''),
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
// `lowStockAt` is an owner setting: staff endpoints include it, customer responses never do.
export type Product = Omit<z.infer<typeof productSchema>, 'lowStockAt'> & {
  lowStockAt?: number;
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
  method: 'COD' | 'ONLINE' | 'CREDIT';
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
};
export type Order = {
  source?: OrderSource;
  createdById?: string | null;
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
  deliveryTerms?: string;
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
export const statusLabel = (value: string, language: 'hi' | 'en' = 'hi') => {
  const key = `status.${value}`;
  return isMessageKey(key) ? translate(key, {}, language) : value;
};
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
  // Counter sales only: the agreed price per unit (list price when absent), how it was paid,
  // and who bought.
  unitPricePaise: paise.refine((v) => v > 0).optional(),
  channel: z.enum(['CASH', 'UPI']).optional(),
  counterParty: z.string().trim().max(120).optional(),
});
/** Recording cash-on-delivery money: how it was paid at the site. */
export const collectionSchema = z.strictObject({
  channel: z.enum(['CASH', 'UPI']).optional(),
});
/** Staff names and roles shown on the desk; creating a staff login stays a terminal command. */
export const staffUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  staffTitle: z.string().trim().max(60).default(''),
  whatsappAlerts: z.boolean().default(false),
});
/** A browser's Web Push subscription for owner-desk alerts. */
export const pushSubscriptionSchema = z.strictObject({
  endpoint: z.url().startsWith('https://').max(1000),
  keys: z.strictObject({
    p256dh: z.string().min(16).max(200),
    auth: z.string().min(8).max(100),
  }),
});
/** Money report range, inclusive calendar days in India time. */
export const reportRangeSchema = z
  .strictObject({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((range) => range.from <= range.to, 'The start date must be on or before the end date.')
  .refine(
    (range) => Date.parse(range.to) - Date.parse(range.from) <= 366 * 86400000,
    'Choose a range of up to one year.',
  );
export type MoneyReport = {
  creditSalesPaise: number;
  creditPaymentsPaise: number;
  topCustomers: { id: string; name: string; phone: string; totalPaise: number; orders: number }[];
  from: string;
  to: string;
  orders: { placed: number; valuePaise: number; delivered: number; cancelled: number };
  collections: {
    cashPaise: number;
    upiPaise: number;
    onlinePaise: number;
    unrecordedPaise: number;
  };
  counter: { sales: number; cashPaise: number; upiPaise: number; unrecordedPaise: number };
  refundsPaise: number;
  netPaise: number;
  pendingCash: { orders: number; amountPaise: number };
  quotes: { requested: number; sent: number; accepted: number; rejected: number; expired: number };
  days: {
    date: string;
    orders: number;
    collectedPaise: number;
    counterPaise: number;
    refundsPaise: number;
  }[];
};
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
  // Unloading, floors, vehicle and time window for this area.
  terms: z.string().trim().max(500).default(''),
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
export * from './i18n';
export * from './labels';
export * from './product-text';
export * from './errors';
export * from './quantity';
export * from './dates';
export * from './rates';
export * from './theme';
export * from './cart';
export * from './client';
export * from './first-run';
export * from './otp';

export const orderSources = ['APP', 'WEB', 'PHONE', 'WALK_IN', 'QUOTE'] as const;
export type OrderSource = (typeof orderSources)[number];
export const ledgerKinds = [
  'SALE_ON_CREDIT',
  'PAYMENT_RECEIVED',
  'OPENING_BALANCE',
  'ADJUSTMENT',
  'REVERSAL',
] as const;
export type LedgerKind = (typeof ledgerKinds)[number];

const amount = z.number().int().min(-2_000_000_000).max(2_000_000_000);
const note = z.string().trim().min(1).max(500);
const occurredAt = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

export const phoneOrderSchema = z
  .strictObject({
    customerPhone: phoneSchema.optional(),
    customerName: z.string().trim().min(1).max(100).optional(),
    source: z.enum(['PHONE', 'WALK_IN']).default('PHONE'),
    items: z
      .array(
        z.strictObject({
          productId: z.string().min(1).max(100),
          quantity: z.number().int().min(1).max(10000),
        }),
      )
      .min(1)
      .max(50)
      .refine(
        (items) => new Set(items.map((i) => i.productId)).size === items.length,
        'Each product must appear only once.',
      ),
    address: addressSchema.optional(),
    deliveryDate: z.union([z.iso.date(), z.literal('today')]),
    paymentMethod: z.enum(['COD', 'CREDIT']),
    notes: z.string().trim().max(500).default(''),
    idempotencyKey: z.string().uuid(),
    overrideLimit: z.boolean().default(false),
  })
  .refine((input) => input.source === 'WALK_IN' || !!input.address, {
    path: ['address'],
    message: 'A delivery address is required for phone orders.',
  })
  .refine(
    (input) =>
      !!input.customerPhone || (input.source === 'WALK_IN' && input.paymentMethod === 'COD'),
    {
      path: ['customerPhone'],
      message: 'A customer phone is required for delivery and credit.',
    },
  );

export const ledgerEntrySchema = z.strictObject({
  amountPaise: amount.refine((value) => value !== 0, 'Amount must not be zero.'),
  occurredAt: occurredAt.optional(),
  note,
  idempotencyKey: z.string().uuid(),
});
export const khataPaymentSchema = ledgerEntrySchema.extend({
  amountPaise: amount.refine((value) => value > 0, 'Payment must be positive.'),
  channel: z.enum(['CASH', 'UPI']).default('CASH'),
});
export const ledgerReverseSchema = z.strictObject({ note, idempotencyKey: z.string().uuid() });
export const customerUpdateSchema = z
  .strictObject({
    creditAllowed: z.boolean().optional(),
    creditLimitPaise: amount.nonnegative().nullable().optional(),
    area: z.string().trim().max(120).optional(),
    tags: z
      .array(z.string().trim().min(1).max(40))
      .max(20)
      .refine((tags) => new Set(tags).size === tags.length, 'Tags must be unique.')
      .optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Supply at least one customer field.');
export const customerNoteSchema = z.strictObject({ body: z.string().trim().min(1).max(2000) });
export const customerContactSchema = z.strictObject({
  channel: z.enum(['CALL', 'WHATSAPP']),
  purpose: z.string().trim().min(1).max(500),
});

export function khataBalance(balancePaise: number, amountPaise: number): number {
  const next = balancePaise + amountPaise;
  if (
    ![balancePaise, amountPaise, next].every(Number.isSafeInteger) ||
    Math.abs(next) > 2_000_000_000
  )
    throw new Error('Khata balance exceeds the supported range.');
  return next;
}
