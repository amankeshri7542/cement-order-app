import 'server-only';
import { cache } from 'react';
import { z } from 'zod';
import { API_URL } from './api';
import type { CatalogRead, ClientConfig, Offer, ShopFacts } from './types';

/**
 * One read feeds every public page, so visitors never reach the API: the whole site costs it about
 * a request a minute at any traffic. /api/revalidate clears this on a price change; if that call is
 * lost, the time limit catches it, and checkout re-prices regardless.
 */
const ttl = () =>
  Number(process.env.CATALOG_TTL_SECONDS) || (process.env.NODE_ENV === 'production' ? 60 : 5);
const TIMEOUT_MS = 2500;
export const catalogTag = 'catalog';

const productSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(200),
  brand: z.string().max(100),
  type: z.string().max(100),
  grade: z.string().max(60),
  unit: z.string().max(60),
  packSize: z.string().max(100),
  minQuantity: z.number().int().positive(),
  quantityStep: z.number().int().positive(),
  pricePaise: z.number().int().positive().nullable(),
  availability: z.enum(['IN_STOCK', 'ON_REQUEST', 'ASK_SHOP']),
  priceUpdatedAt: z.string(),
  checkedAt: z.string(),
  images: z.array(z.string()).max(6),
  description: z.string().max(2000),
  recommendedUse: z.string().max(600),
  categorySlug: z.string().max(60),
  searchTerms: z.array(z.string()).max(200).default([]),
});
const catalogSchema = z.object({
  products: z.array(productSchema).max(500),
  categories: z.array(z.object({ id: z.string(), name: z.string(), slug: z.string() })).max(100),
  ratesCheckedAt: z.string().nullable(),
  sampleRates: z.boolean(),
  generatedAt: z.string(),
});
const offersSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().max(200),
        productId: z.string().nullable(),
        categoryId: z.string().nullable(),
        minQuantity: z
          .number()
          .int()
          .nullable()
          .transform((value) => value ?? 1),
        valueType: z.enum(['RATE', 'PERCENT_OFF', 'AMOUNT_OFF']),
        value: z.number().int().nonnegative(),
        endsOn: z.string(),
      }),
    )
    .max(50),
});
const shopSchema = z.object({
  name: z.string(),
  city: z.string(),
  story: z.string(),
  contactApproved: z.boolean(),
  phone: z.string(),
  whatsapp: z.string(),
  address: z.string(),
  hours: z.string(),
  directionsUrl: z.string(),
  family: z.array(z.object({ name: z.string(), role: z.string(), image: z.string() })),
  gallery: z.array(z.object({ title: z.string(), image: z.string(), alt: z.string() })),
  firm: z
    .object({
      legalName: z.string(),
      tradeName: z.string(),
      gstin: z.string().nullable(),
      complaintOfficerName: z.string(),
      complaintOfficerPhone: z.string(),
    })
    .nullable(),
});
const configSchema = z.object({
  askEnabled: z.boolean().optional(),
  whatsappDeskLive: z.boolean().optional(),
});

async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    next: { revalidate: ttl(), tags: [catalogTag] },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Public read failed (${response.status})`);
  return schema.parse(await response.json());
}
function logFailure(path: string, error: unknown) {
  console.warn(
    JSON.stringify({
      event: 'PUBLIC_READ_FAILED',
      path,
      errorType: error instanceof Error ? error.constructor.name : 'Unknown',
    }),
  );
}

// The last good answers, for this one server. When the API is down people still see rates, with
// the time beside them, and never a ₹0 or an error page.
let lastCatalog: z.infer<typeof catalogSchema> | null = null;
export const readCatalog = cache(async (): Promise<CatalogRead> => {
  try {
    lastCatalog = await get('/public/catalog', catalogSchema);
    return { status: 'ok', catalog: lastCatalog };
  } catch (error) {
    logFailure('/public/catalog', error);
    return lastCatalog
      ? { status: 'stale', catalog: lastCatalog }
      : { status: 'down', catalog: null };
  }
});

let lastOffers: Offer[] = [];
export const readOffers = cache(async (): Promise<Offer[]> => {
  try {
    lastOffers = (await get('/public/offers', offersSchema)).items;
  } catch (error) {
    logFailure('/public/offers', error);
  }
  return lastOffers;
});

const unknownShop: ShopFacts = {
  name: 'Shiv Cement Store',
  city: 'Patna, Bihar',
  story: '',
  contactApproved: false,
  phone: '',
  whatsapp: '',
  address: '',
  hours: '',
  directionsUrl: '',
  family: [],
  gallery: [],
  firm: null,
};
let lastShop: ShopFacts | null = null;
/** The shop's approved facts. With the API down, the last known ones or just the name and city. */
export const readShop = cache(async (): Promise<ShopFacts> => {
  try {
    lastShop = await get('/public/shop', shopSchema);
  } catch (error) {
    logFailure('/public/shop', error);
  }
  return lastShop ?? unknownShop;
});

let lastConfig: ClientConfig = { askEnabled: false, whatsappDeskLive: false };
export const readClientConfig = cache(async (): Promise<ClientConfig> => {
  try {
    const config = await get('/client-config', configSchema);
    lastConfig = {
      askEnabled: Boolean(config.askEnabled),
      whatsappDeskLive: Boolean(config.whatsappDeskLive),
    };
  } catch (error) {
    logFailure('/client-config', error);
  }
  return lastConfig;
});

// The guide. Only articles an engineer has signed come from the API: until then this list is empty.
const guideItem = z.object({
  slug: z.string().max(120),
  title: z.string().max(200),
  summary: z.string().max(400),
  stages: z.array(z.string()).max(20),
  materials: z.array(z.string()).max(20),
  checkedOn: z.string().nullable(),
});
const guideList = z.object({ items: z.array(guideItem).max(200) });
const guidePage = guideItem.extend({
  sections: z
    .array(
      z.object({
        id: z.string().max(120),
        heading: z.string().max(200),
        blocks: z.array(z.string().max(4000)),
      }),
    )
    .max(30),
  relatedQuestions: z.array(z.string().max(200)).max(10),
  standardsMentioned: z.array(z.string().max(80)).max(20),
});
export type GuideListItem = z.infer<typeof guideItem> & { draft?: boolean };
export type GuidePage = z.infer<typeof guidePage> & { draft?: boolean };
let lastGuide: GuideListItem[] = [];
export const readGuide = cache(async (): Promise<GuideListItem[]> => {
  try {
    lastGuide = (await get('/guide', guideList)).items;
  } catch (error) {
    logFailure('/guide', error);
  }
  return lastGuide;
});
export const readGuidePage = cache(async (slug: string): Promise<GuidePage | null> => {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  try {
    return await get(`/guide/${slug}`, guidePage);
  } catch {
    return null;
  }
});

/** The WhatsApp number as digits for wa.me, only when approved and a real Indian mobile number. */
export const whatsappNumber = (shop: ShopFacts) =>
  shop.contactApproved && /^\+91[6-9]\d{9}$/.test(shop.whatsapp) ? shop.whatsapp.slice(1) : '';
export const phoneNumber = (shop: ShopFacts) =>
  shop.contactApproved && /^\+91[6-9]\d{9}$/.test(shop.phone) ? shop.phone : '';
