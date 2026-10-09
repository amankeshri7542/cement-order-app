import { z } from 'zod';
const short = (max = 200) => z.string().trim().max(max);
const nullable = (max = 200) => short(max).nullable();
const paise = z.number().int().min(1).max(100_000_000);
export const extractedRateSchema = z.strictObject({
  brand: nullable(80),
  product: nullable(120),
  category: nullable(80),
  size: nullable(80),
  specification: nullable(160),
  price: nullable(50),
  unit: nullable(80),
  weight: nullable(80),
  effectiveDate: nullable(40),
  deliveryNotes: nullable(300),
  confidence: z.number().min(0).max(1),
  sourceText: z.string().max(1500),
  sourceReference: z.string().max(120),
});
export const rateExtractionSchema = z.strictObject({ rows: z.array(extractedRateSchema).max(100) });
export type ExtractedRate = z.infer<typeof extractedRateSchema>;
export type RateExtraction = z.infer<typeof rateExtractionSchema>;
export const rateBatchCreateSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  sourceType: z.enum(['MANUAL', 'IMAGE', 'ADJUSTMENT']),
  idempotencyKey: z.string().uuid(),
});
export const rateRowEditSchema = z.strictObject({
  id: z.string().max(100).optional(),
  productId: z.string().min(1).max(100).nullable(),
  label: short(120),
  brand: short(80),
  specification: short(160),
  unit: short(80),
  weight: short(80),
  proposedPricePaise: paise.nullable(),
  included: z.boolean(),
  reviewed: z.boolean(),
  acknowledged: z.boolean(),
  note: short(500),
  rememberAlias: z.boolean(),
  refreshBaseline: z.boolean().default(false),
  expectedProductVersion: z.number().int().min(1).nullable().optional(),
});
export const rateBatchSaveSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  title: z.string().trim().min(1).max(120),
  items: z.array(rateRowEditSchema).max(100),
});
export const rateVersionSchema = z.strictObject({ expectedVersion: z.number().int().min(1) });
export const ratePublishSchema = rateVersionSchema.extend({ confirmation: z.literal('PUBLISH') });
export const rateAdjustmentSchema = rateVersionSchema.extend({
  productIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  kind: z.enum(['FIXED', 'PERCENT']),
  direction: z.enum(['INCREASE', 'DECREASE']),
  amount: z.number().int().min(1).max(100_000_000), // Paise for fixed; basis points for percent.
});
export const rateCardSchema = z.strictObject({
  format: z.enum(['STATUS', 'SQUARE', 'SHEET']),
  template: z.enum(['COUNTER', 'BULLETIN']),
  heading: z.string().trim().min(1).max(80),
  deliveryMessage: short(160),
  contactLabel: short(40),
  promotionalCopy: short(160),
  confirmed: z.literal(true),
});
export type RateRowEdit = z.infer<typeof rateRowEditSchema>;
export type RateIssue = { code: string; message: string; blocking: boolean };
export type RateItem = RateRowEdit & {
  id: string;
  position: number;
  expectedProductVersion: number | null;
  oldPricePaise: number | null;
  confidence: number | null;
  matchMethod: string;
  extracted: ExtractedRate | null;
  product: {
    id: string;
    name: string;
    brand: string;
    grade: string;
    type: string;
    unit: string;
    packSize: string;
    pricePaise: number;
    version: number;
    priceVersion: number;
    active: boolean;
  } | null;
  issues: RateIssue[];
  publishedPricePaise: number | null;
  publishedProduct: Record<string, unknown> | null;
};
export type RateBatch = {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  version: number;
  stage: string;
  errorCode: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  createdBy: string;
  publishedAt: string | null;
  publishedBy: string | null;
  publishedByName?: string | null;
  source: {
    id: string;
    fileName: string;
    contentType: string;
    size: number;
    sha256: string;
    ocrText: string | null;
    ocr: unknown;
  } | null;
  extraction: RateExtraction | null;
  usage: unknown;
  items: RateItem[];
  cards: RateCard[];
  issues: RateIssue[];
};
export type RateCard = {
  id: string;
  batchId: string;
  format: string;
  template: string;
  createdAt: string;
  snapshot: {
    heading: string;
    deliveryMessage: string;
    promotionalCopy: string;
    contactLabel: string;
    phone: string;
    whatsapp: string;
    publishedAt: string;
    items: RateCardItem[];
  };
};
export type RateCardItem = {
  name: string;
  brand: string;
  specification: string;
  unit: string;
  pricePaise: number;
};
