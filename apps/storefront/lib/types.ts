export type Availability = 'IN_STOCK' | 'ON_REQUEST' | 'ASK_SHOP';
export type CatalogProduct = {
  id: string;
  name: string;
  brand: string;
  type: string;
  grade: string;
  unit: string;
  packSize: string;
  minQuantity: number;
  quantityStep: number;
  /** Null when the shop only brings the item in to order: never a ₹0. */
  pricePaise: number | null;
  availability: Availability;
  priceUpdatedAt: string;
  checkedAt: string;
  images: string[];
  description: string;
  recommendedUse: string;
  categorySlug: string;
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
/** ok: fresh. stale: the API is down and these are the last rates we saw. down: nothing to show. */
export type CatalogRead =
  { status: 'ok' | 'stale'; catalog: Catalog } | { status: 'down'; catalog: null };
export type Offer = {
  title: string;
  productId: string | null;
  categoryId: string | null;
  minQuantity: number;
  valueType: 'RATE' | 'PERCENT_OFF' | 'AMOUNT_OFF';
  value: number;
  endsOn: string;
};
export type Firm = {
  legalName: string;
  tradeName: string;
  gstin: string | null;
  complaintOfficerName: string;
  complaintOfficerPhone: string;
};
export type ShopFacts = {
  name: string;
  city: string;
  story: string;
  contactApproved: boolean;
  phone: string;
  whatsapp: string;
  address: string;
  hours: string;
  directionsUrl: string;
  family: { name: string; role: string; image: string }[];
  gallery: { title: string; image: string; alt: string }[];
  firm: Firm | null;
};
export type ClientConfig = { askEnabled: boolean; whatsappDeskLive: boolean };
