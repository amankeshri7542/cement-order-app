import { z } from 'zod';
import { staffRoles } from './permissions';
import { t as translate, isMessageKey } from '@shiv/i18n';

export const roles = ['CUSTOMER', 'CONTRACTOR', 'ADMIN'] as const;
export const orderStatuses = [
  'PENDING_PAYMENT',
  'AWAITING_CONFIRMATION',
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
  PENDING_PAYMENT: ['AWAITING_CONFIRMATION', 'CANCELLED'],
  // Only Pakka karo moves an order on from here, and that is its own route.
  AWAITING_CONFIRMATION: ['CANCELLED'],
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
// Letters, digits, punctuation, spaces (and new lines and tabs where asked) only: no control,
// direction-override or zero-width characters that could disguise a name or number on the owner's
// screen. The zero-width joiner and non-joiner (U+200C, U+200D) stay allowed: Hindi keyboards type
// them to choose a half-letter form, as in क्या (क्, U+200D, या).
const plainText = (max: number, lines = false) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !(lines ? /[^\P{C}\n\t\u200C\u200D]/u : /[^\P{C}\u200C\u200D]/u).test(value),
      'Remove special characters',
    );
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
  // Staff rights apply only to desk sessions, so the customer apps say which they are.
  surface: z.enum(['CUSTOMER', 'DESK']).optional(),
});
export const refreshSchema = z.strictObject({
  refreshToken: z.string().min(32).max(200).optional(),
});
export const profileSchema = z.strictObject({
  name: plainText(100).optional(),
  language: z.enum(['en', 'hi']),
  contractor: z.boolean().optional(),
});
// Address text is shown to the owner and goes into the shop's WhatsApp alerts, so it is held to
// plain text like an enquiry.
export const addressSchema = z
  .strictObject({
    label: plainText(40),
    name: plainText(100),
    phone: phoneSchema,
    line1: plainText(250),
    area: plainText(120),
    city: plainText(100),
    state: z.literal('Bihar'),
    pincode: z.string().regex(/^\d{6}$/),
    landmark: z
      .string()
      .trim()
      .max(200)
      .refine((value) => !/[^\P{C}\u200C\u200D]/u.test(value), 'Remove special characters')
      .default(''),
    // A map pin, set only by the customer's "I am at the site" tap. Both or neither; null clears it.
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
  })
  .refine((address) => (address.lat == null) === (address.lng == null), {
    message: 'A map pin needs both its numbers.',
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
export const checkoutLineSchema = z.strictObject({
  productId: id,
  quantity: z.number().int().min(1).max(10000),
  // What the phone showed. Only decides whether "Rate changed" is said; it never sets a price.
  seenPricePaise: z.number().int().min(0).max(2000000000).optional(),
});
export const checkoutSchema = z
  .strictObject({
    addressId: id,
    deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().trim().max(500).default(''),
    paymentMethod: z.enum(['COD', 'ONLINE']),
    // The list on the phone. Left out means the old way: the server's cart.
    lines: z
      .array(checkoutLineSchema)
      .min(1)
      .max(50)
      .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, {
        message: 'Each product must appear only once.',
      })
      .optional(),
    // The customer's own earlier order. For measuring and for "Rate changed"; never for pricing.
    repeatOfOrderId: id.optional(),
  })
  .refine((body) => !body.repeatOfOrderId || Boolean(body.lines), {
    message: 'A repeat needs its lines.',
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
  listPricePaise?: number;
  ruleId?: string | null;
  ruleKind?: string | null;
  priceVersion: number;
  lineTotalPaise: number;
};
export type ReviewLeftOut = {
  productId: string;
  /** NOT_SOLD: gone from the list. QUANTITY: breaks its pack rule. ASK_SHOP: not that many now. */
  reason: 'NOT_SOLD' | 'QUANTITY' | 'ASK_SHOP';
  minQuantity?: number;
  quantityStep?: number;
};
export type CheckoutReview = {
  id: string;
  expiresAt: string;
  items: ReviewLine[];
  subtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  changes: { name: string; oldPricePaise: number; newPricePaise: number; productId?: string }[];
  /** Set when the review came from the phone's list: placing it leaves the cart alone. */
  fromLines?: boolean;
  repeatOfOrderId?: string;
  /** Lines left out of the total, with a reason and never a stock figure. */
  unavailable?: ReviewLeftOut[];
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
  /** Desk only. What a driver said they took at the door; null until they have. */
  driverCollectedPaise?: number | null;
  locationId?: string;
  version?: number;
  confirmedAt?: string | null;
  decisionHoldUntil?: string | null;
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
  locationId?: string;
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
  locationId: z.string().min(1).max(60).optional(),
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
  // Area names for a new site's form. A pincode left out keeps the name it has.
  areas: z.record(z.string().regex(/^[1-9]\d{5}$/), z.string().trim().max(120)).optional(),
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

export * from './pricing';
export * from './attendance';
export * from './pay';
export * from './tally';
export * from './crm';
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
export * from './advisor';
export * from './whatsapp-text';
export * from './estimates';
export * from './glossary';

export const orderSources = ['APP', 'WEB', 'PHONE', 'WALK_IN', 'QUOTE', 'WHATSAPP'] as const;
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
    locationId: z.string().min(1).max(60).optional(),
    customerPhone: phoneSchema.optional(),
    customerName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^\r\n]*$/, 'A name is one line.')
      .optional(),
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
  // Whose drawer took the cash. Needed from anyone working at more than one shop.
  locationId: z.string().min(1).max(60).optional(),
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

/** A question from the website's Contact page. `website` is a honeypot that people never fill. */
export const webEnquirySchema = z.strictObject({
  name: plainText(80),
  phone: phoneSchema,
  pincode: z
    .string()
    .regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode')
    .optional(),
  interest: plainText(200).optional(),
  message: plainText(1000, true),
  language: z.enum(['hi', 'en']).default('hi'),
  website: z.string().max(500).optional(),
});
export type WebEnquiryInput = z.infer<typeof webEnquirySchema>;

export function khataBalance(balancePaise: number, amountPaise: number): number {
  const next = balancePaise + amountPaise;
  if (
    ![balancePaise, amountPaise, next].every(Number.isSafeInteger) ||
    Math.abs(next) > 2_000_000_000
  )
    throw new Error('Khata balance exceeds the supported range.');
  return next;
}

export * from './permissions';

const personName = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .refine((value) => !/[<>]/.test(value), 'Use letters only.');
const shopIds = z.array(z.string().min(1).max(60)).max(20);
const stepUpPassphrase = z.string().min(1).max(200).optional();
export const staffUserCreateSchema = z.strictObject({
  name: personName,
  phone: phoneSchema,
  role: z.enum(staffRoles),
  locationIds: shopIds.default([]),
  passphrase: stepUpPassphrase,
});
export const staffUserUpdateSchema = z.strictObject({
  name: personName.optional(),
  role: z.enum(staffRoles).optional(),
  locationIds: shopIds.optional(),
  passphrase: stepUpPassphrase,
});
export const staffActionSchema = z.strictObject({ passphrase: stepUpPassphrase });
export const passphraseSetSchema = z.strictObject({
  current: z.string().min(1).max(200).optional(),
  next: z.string().min(12).max(200),
});
const shopName = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .refine((value) => !/[<>]/.test(value), 'Use letters and numbers only.');
export const locationCreateSchema = z.strictObject({ name: shopName });
export const locationUpdateSchema = z.strictObject({
  name: shopName.optional(),
  active: z.boolean().optional(),
  managerRateCapPercent: z.number().int().min(0).max(50).optional(),
});
// My people: who may order on a customer's account. Name and number only.
export const personSchema = z.strictObject({ phone: phoneSchema, name: plainText(100) });
export type Person = { id: string; phone: string; name: string; createdAt: string };
export const pushAckSchema = z.strictObject({ token: z.string().min(20).max(100) });

/** One word for customers, never a count or a shop. */
export type Availability = 'IN_STOCK' | 'ON_REQUEST' | 'ASK_SHOP';
export function availabilityOf(product: {
  stock: number;
  sourcing?: string;
  stockMode?: string;
  stockLevels?: { isOn: boolean }[];
}): Availability {
  if (product.sourcing === 'ON_REQUEST') return 'ON_REQUEST';
  if (product.stockMode === 'AVAILABILITY')
    return product.stockLevels?.some((level) => level.isOn) ? 'IN_STOCK' : 'ASK_SHOP';
  return product.stock > 0 ? 'IN_STOCK' : 'ASK_SHOP';
}

// ---- Pakka karo ------------------------------------------------------------------------------
const orderLineChange = z.strictObject({
  productId: id,
  quantity: z.number().int().min(1).max(10000),
  // Left out means the rate stays as it is.
  pricePaise: paise.refine((value) => value > 0).optional(),
});
export const rateChangeReasons = [
  'REGULAR_CUSTOMER',
  'BIG_ORDER',
  'MATCHING_RATE',
  'GOODS_ISSUE',
  'OTHER',
] as const;
export const orderChangesSchema = z.strictObject({
  lines: z
    .array(orderLineChange)
    .min(1)
    .max(50)
    .refine(
      (lines) => new Set(lines.map((line) => line.productId)).size === lines.length,
      'Each product must appear only once.',
    ),
  deliveryFeePaise: paise.optional(),
  deliveryDate: z.iso.date().optional(),
  paymentMethod: z.enum(['COD', 'CREDIT']).optional(),
  locationId: z.string().min(1).max(60).optional(),
  // "Maal hai, stock theek karo": an owner saying the goods are there though the count is short.
  stockFixes: z.array(id).max(50).default([]),
  overrideLimit: z.boolean().default(false),
  // From a short list, as the activity log can never be edited and must hold no one's words.
  reason: z.enum(rateChangeReasons).optional(),
});
export type OrderChanges = z.infer<typeof orderChangesSchema>;
const decisionFields = {
  expectedVersion: z.number().int().min(1),
  decisionKey: z.string().uuid(),
};
export const orderConfirmSchema = z.strictObject({
  ...decisionFields,
  changes: orderChangesSchema.optional(),
});
export const refusalReasons = [
  'OUT_OF_STOCK',
  'NO_DELIVERY',
  'RATE_DIFFERENT',
  'NO_CREDIT',
  'OTHER',
] as const;
export type RefusalReason = (typeof refusalReasons)[number];
const refusalNote = z.string().trim().max(200);
export const orderRefuseSchema = z
  .strictObject({
    ...decisionFields,
    reason: z.enum(refusalReasons),
    note: refusalNote.optional(),
  })
  .refine((input) => input.reason !== 'OTHER' || !!input.note, {
    path: ['note'],
    message: 'Write what to tell the customer.',
  });
export const orderUndoSchema = z.strictObject({ expectedVersion: z.number().int().min(1) });
export const orderPreviewSchema = z.strictObject({
  decision: z.enum(['CONFIRM', 'REFUSE']),
  reason: z.enum(refusalReasons).optional(),
  note: refusalNote.optional(),
  changes: orderChangesSchema.optional(),
});
export const pushActionSchema = z.strictObject({ token: z.string().min(20).max(100) });

// ---- Daam aur offer -------------------------------------------------------------------------
const rupeeRate = paise.refine((value) => value > 0);
export const ratesPublishSchema = z.strictObject({
  rates: z
    .array(
      z.strictObject({
        productId: id,
        expectedVersion: z.number().int().min(1),
        pricePaise: rupeeRate,
      }),
    )
    .min(1)
    .max(500)
    .refine(
      (rates) => new Set(rates.map((rate) => rate.productId)).size === rates.length,
      'Each product must appear only once.',
    ),
  // A big jump is usually a slipped digit, so it has to be meant.
  bigChangesChecked: z.boolean().default(false),
  note: plainText(200).optional(),
});
export const ratesAskSchema = ratesPublishSchema.safeExtend({ idempotencyKey: z.string().uuid() });
export const bigRateChangePercent = 25;
export const customerGroupSchema = z.strictObject({
  name: plainText(40),
  active: z.boolean().default(true),
});
export const customerGroupSetSchema = z.strictObject({ groupId: id.nullable() });
const ruleDay = z.iso.date().nullable().default(null);
export const priceRuleSchema = z
  .strictObject({
    kind: z.enum(['SLAB', 'GROUP', 'SPECIAL', 'OFFER']),
    title: z.string().trim().max(60).default(''),
    productId: id.nullable().default(null),
    categoryId: id.nullable().default(null),
    minQuantity: z.number().int().min(1).max(1_000_000).default(1),
    groupId: id.nullable().default(null),
    customerId: id.nullable().default(null),
    valueType: z.enum(['RATE', 'PERCENT_OFF', 'AMOUNT_OFF']),
    value: z.number().int().min(1).max(100_000_000),
    startsOn: ruleDay,
    endsOn: ruleDay,
    active: z.boolean().default(true),
    stacks: z.boolean().default(false),
    isPublic: z.boolean().default(false),
    expectedVersion: z.number().int().min(1).optional(),
  })
  .superRefine((rule, context) => {
    const problem = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });
    if (rule.productId && rule.categoryId)
      problem('categoryId', 'Choose a product or a category, not both.');
    if (rule.valueType === 'RATE' && !rule.productId)
      problem('productId', 'A fixed rate is for one product.');
    if (rule.valueType === 'PERCENT_OFF' && rule.value > 9000)
      problem('value', 'A discount can be at most 90%.');
    if (rule.kind === 'SLAB' && rule.minQuantity < 2)
      problem('minQuantity', 'A slab starts at 2 or more.');
    if (rule.kind === 'SLAB' && !rule.productId && !rule.categoryId)
      problem('productId', 'A slab is for a product or a category.');
    if (rule.kind === 'GROUP' ? !rule.groupId : Boolean(rule.groupId))
      problem('groupId', 'A group rate names a group, and nothing else does.');
    if (rule.kind === 'SPECIAL' ? !rule.customerId : Boolean(rule.customerId))
      problem('customerId', 'A special rate names one customer, and nothing else does.');
    if (rule.kind === 'SPECIAL' && !rule.endsOn)
      problem('endsOn', 'A special rate needs an end date.');
    if (rule.kind === 'OFFER' && !(rule.startsOn && rule.endsOn))
      problem('endsOn', 'An offer needs a start and an end date.');
    if (rule.startsOn && rule.endsOn && rule.startsOn > rule.endsOn)
      problem('endsOn', 'The end date is before the start date.');
    if (rule.isPublic && rule.kind !== 'OFFER') problem('isPublic', 'Only offers can be public.');
    if (rule.stacks && rule.kind !== 'OFFER') problem('stacks', 'Only offers can add on top.');
  });
export const deliveryRateSchema = z.strictObject({
  zoneId: id,
  vehicle: plainText(40),
  feePaise: paise,
  active: z.boolean().default(true),
});
export const personRateCapSchema = z.strictObject({
  rateCapPercent: z.number().int().min(0).max(50).nullable(),
});

// ---- Stock between and inside shops ---------------------------------------------------------
const stockQuantity = z.number().int().min(1).max(1_000_000);
const shopId = z.string().min(1).max(60);
export const stockTransferSchema = z.strictObject({
  fromLocationId: shopId,
  toLocationId: shopId,
  lines: z
    .array(z.strictObject({ productId: id, quantity: stockQuantity }))
    .min(1)
    .max(100)
    .refine(
      (lines) => new Set(lines.map((line) => line.productId)).size === lines.length,
      'Each product must appear only once.',
    ),
  vehicle: plainText(40).optional(),
  carrierName: plainText(60).optional(),
  note: plainText(200).optional(),
  idempotencyKey: z.string().uuid(),
});
export const stockReceiveSchema = z.strictObject({
  lines: z
    .array(z.strictObject({ productId: id, receivedQty: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(100),
});
export const stockCountStartSchema = z.strictObject({
  locationId: shopId,
  // Left out means every counted product at this shop.
  productIds: z.array(id).min(1).max(500).optional(),
  opening: z.boolean().default(false),
});
export const stockCountLineSchema = z.strictObject({
  productId: id,
  countedQty: z.number().int().min(0).max(1_000_000),
});
export const stockDamageSchema = z.strictObject({
  locationId: shopId,
  productId: id,
  quantity: stockQuantity,
  note: plainText(200),
  evidenceId: id.optional(),
  idempotencyKey: z.string().uuid(),
});
export const approvalDecideSchema = z.strictObject({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: plainText(200).optional(),
  // Set only when the card said out loud that this passes a customer's udhaar limit.
  overrideLimit: z.boolean().optional(),
});
export const orderAskOwnerSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  changes: orderChangesSchema,
  note: plainText(200).optional(),
  idempotencyKey: z.string().uuid(),
});
const dayString = z.iso.date();
export const gallaEntrySchema = z.strictObject({
  locationId: shopId,
  kind: z.enum(['PAID_IN', 'PAID_OUT']),
  amountPaise: paise.refine((value) => value > 0),
  reason: plainText(200),
  idempotencyKey: z.string().uuid(),
});
export const gallaCloseSchema = z.strictObject({
  locationId: shopId,
  day: dayString,
  countedPaise: paise,
  reason: plainText(200).optional(),
  // A correction names the close it replaces.
  supersedesId: id.optional(),
});
/** Days a shop runs without a stock surprise before its numbers are trusted (master plan). */
export const cleanDaysTarget = 7;

// ---- Reading the shop's WhatsApp silently ----------------------------------------------------
export const waReviews = ['RIGHT', 'WRONG_INTENT', 'WRONG_LINES', 'SHOULD_BE_SILENT'] as const;
export const waReviewSchema = z.strictObject({ review: z.enum(waReviews) });
export const waThreadModeSchema = z.strictObject({ aiMode: z.enum(['AUTO', 'OFF']) });
export const waThreadCreateSchema = z.strictObject({
  phone: phoneSchema,
  savedName: plainText(60).optional(),
});
export const waPauseSchema = z.strictObject({ paused: z.boolean() });
export const waTrySchema = z.strictObject({ text: z.string().trim().min(1).max(2000) });
export const waAliasSchema = z.strictObject({ productId: id, alias: plainText(60) });
// ---- WhatsApp replies, cards and the paste box -------------------------------------------------
/** Who may hear from the AI. A move up is one step, by an owner, past the readiness check. */
export const waStages = ['OFF', 'TEST_NUMBERS', 'KNOWN_CUSTOMERS', 'EVERYONE'] as const;
export type WaStage = (typeof waStages)[number];
export const waTestNumbersMax = 5;
export const waStageMoveSchema = z.strictObject({
  from: z.enum(waStages),
  to: z.enum(waStages),
});
export const waReplySettingsSchema = z
  .strictObject({
    testNumbers: z
      .array(phoneSchema)
      .max(waTestNumbersMax)
      .refine((list) => new Set(list).size === list.length, 'Each number once.')
      .optional(),
    // Decision 8: 30 to 60 minutes after Papa types.
    quietMinutes: z.number().int().min(30).max(60).optional(),
    nightFromHour: z.number().int().min(0).max(23).optional(),
    nightToHour: z.number().int().min(0).max(23).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Nothing to change.');
/** Paying is a person's call on the card: now, at delivery, or on a customer's udhaar. */
export const waPayWhens = ['UNSET', 'PAID_NOW', 'AT_DELIVERY', 'UDHAAR'] as const;
export type WaPayWhen = (typeof waPayWhens)[number];
// Longer than the 2,000 kept, so a long paste is cut and flagged rather than refused.
export const waPasteSchema = z.strictObject({
  text: z.string().trim().min(1).max(20000),
  idempotencyKey: z.string().uuid(),
  phone: phoneSchema.optional(),
  name: plainText(60).optional(),
  locationId: id.optional(),
});
const waDraftLineSchema = z.strictObject({
  // The customer's own words for this line, kept when a person corrects it.
  rawText: z.string().trim().max(200).optional(),
  productId: id.nullable(),
  quantity: z.number().int().min(1).max(10000).nullable(),
  unitWord: plainText(30).nullable().optional(),
  // Picked from the family's list: the server works out quantity from these two, never the model.
  loadSizeId: id.optional(),
  loadCount: z.number().int().min(1).max(100).optional(),
});
export const waDraftEditSchema = z
  .strictObject({
    expectedVersion: z.number().int().min(1),
    lines: z.array(waDraftLineSchema).max(20).optional(),
    placeText: z.string().trim().max(120).optional(),
    pincode: z
      .string()
      .regex(/^\d{6}$/)
      .nullable()
      .optional(),
    fulfilment: z.enum(['PICKUP', 'DELIVERY', 'UNKNOWN']).optional(),
    deliveryDate: z.iso.date().nullable().optional(),
    orderedByName: z.string().trim().max(60).optional(),
    orderedByPhone: phoneSchema.nullable().optional(),
    payWhen: z.enum(waPayWhens).optional(),
    // Found by number, as the person at the desk knows it. Empty clears it.
    payerPhone: phoneSchema.nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 1, 'Nothing to change.');
export const waDraftConfirmSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  // The list rate each line showed when tapped, by version, so a rate moved since is caught.
  priceVersions: z.record(z.string().max(100), z.number().int().min(0)),
});
export const waDraftRefuseSchema = z
  .strictObject({
    expectedVersion: z.number().int().min(1),
    reason: z.enum(refusalReasons),
    note: z.string().trim().max(120).optional(),
  })
  .refine((input) => input.reason !== 'OTHER' || !!input.note, {
    path: ['note'],
    message: 'Write what to tell the customer.',
  });
export const waLoadSizeSchema = z.strictObject({
  productId: id,
  label: plainText(40),
  quantity: z.number().int().min(1).max(100000),
});
export const waLoadSizeChangeSchema = z
  .strictObject({
    label: plainText(40).optional(),
    quantity: z.number().int().min(1).max(100000).optional(),
    active: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Nothing to change.');
/** The paper tally is copied in at baseline and at weeks 2, 4 and 8 (plan 07 section 9). */
export const waTallyPeriods = ['BASELINE', 'WEEK_2', 'WEEK_4', 'WEEK_8'] as const;
export type WaTallyPeriod = (typeof waTallyPeriods)[number];
export const waTallySchema = z.strictObject({
  days: z.number().int().min(1).max(31).default(3),
  calls: z.number().int().min(0).max(100000),
  orders: z.number().int().min(0).max(100000),
});
/** What the reader must reach on real messages before it may answer anyone (master plan). */
export const waGate = {
  reviewed: 200,
  intentPercent: 95,
  greenPercent: 98,
  allBandsPercent: 85,
  silentMissPercent: 90,
  personalWindow: 100,
} as const;

/** One order as the shop sees it on the confirm card. */
export type InboxCard = {
  id: string;
  number: string;
  status: OrderStatus;
  version: number;
  source: string;
  createdAt: string;
  deliveryDate: string;
  notes: string;
  locationId: string;
  shopName: string;
  customer: {
    id: string;
    name: string;
    phone: string;
    orders: number;
    balancePaise: number | null;
    creditAllowed: boolean;
    creditLimitPaise: number | null;
  };
  area: string;
  addressLine: string;
  lines: {
    id: string;
    productId: string;
    name: string;
    unit: string;
    packSize: string;
    quantity: number;
    pricePaise: number;
    listPricePaise: number;
    lineTotalPaise: number;
    /** What this shop holds beyond this order's own hold. */
    /** Null while this shop is being counted and this person does not decide the count. */
    stockHere: number | null;
    /** What the list says today. The customer keeps the rate they ordered at. */
    currentListPricePaise: number;
  }[];
  subtotalPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  paymentMethod: string;
  paid: boolean;
  /** Nothing needs reading: fit for one tap from a notification. */
  clean: boolean;
  blockers: ('DATE_PASSED' | 'PRODUCT_OFF')[];
  can: {
    confirm: boolean;
    refuse: boolean;
    change: boolean;
    rate: boolean;
    credit: boolean;
    override: boolean;
  };
  rateCapPercent: number | null;
  decided: {
    status: OrderStatus;
    byId: string | null;
    byName: string;
    at: string;
    holdUntil: string | null;
  } | null;
  serverNow: string;
};
