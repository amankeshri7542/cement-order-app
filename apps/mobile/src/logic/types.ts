import type { Availability } from '@shiv/shared';

/** One product as GET /public/catalog gives it: public facts only, never a stock count. */
export type CatalogProduct = {
  id: string;
  name: string;
  brand: string;
  type: string;
  grade: string;
  unit: string;
  packSize?: string | null;
  minQuantity: number;
  quantityStep: number;
  /** Null when the shop only gets the item to order: no public rate. */
  pricePaise: number | null;
  availability: Availability;
  priceUpdatedAt: string;
  checkedAt: string;
  images: string[];
  description: string;
  recommendedUse: string;
  categorySlug: string;
  /** Words people search for; matched, never shown. */
  searchTerms: string[];
};

export type CatalogCategory = { id: string; name: string; slug: string };

export type Catalog = {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  ratesCheckedAt: string | null;
  sampleRates: boolean;
  generatedAt: string;
};

/** GET /me/rates: this customer's own rate beside the list rate. */
export type MyRate = { productId: string; listPaise: number; yourPaise: number };

/** GET /public/offers: what the owners chose to show. */
export type Offer = {
  title: string;
  productId: string | null;
  categoryId: string | null;
  minQuantity: number;
  valueType: string;
  value: number;
  endsOn: string;
};

/** GET /me/khata, once an owner has signed off this customer's opening balance. */
export type Khata =
  | { available: false }
  | {
      available: true;
      balancePaise: number;
      asOf: string;
      remindersStopped: boolean;
      nextCursor: string | null;
      entries: {
        id: string;
        kind: string;
        amountPaise: number;
        on: string;
        orderNumber: string | null;
        channel: string;
      }[];
    };
