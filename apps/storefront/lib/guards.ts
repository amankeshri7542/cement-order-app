// Small checks for what comes back out of this browser's storage, and for a form before sending it.
// The server validates everything again; these only stop obvious mistakes without loading zod.
const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length <= limit;

export type PendingOrder = { reviewId: string; idempotencyKey: string };
export function isPendingOrder(value: unknown): value is PendingOrder {
  const row = value as PendingOrder | null;
  return Boolean(
    row &&
    text(row.reviewId, 100) &&
    row.reviewId &&
    text(row.idempotencyKey, 100) &&
    row.idempotencyKey,
  );
}

export type QuoteDraft = {
  addressId: string;
  date: string;
  company: string;
  gstin: string;
  notes: string;
};
export function isQuoteDraft(value: unknown): value is QuoteDraft {
  const row = value as QuoteDraft | null;
  return Boolean(
    row &&
    text(row.addressId, 100) &&
    text(row.date, 20) &&
    text(row.company, 150) &&
    text(row.gstin, 15) &&
    text(row.notes, 1500),
  );
}

export type QuoteRequest = {
  idempotencyKey: string;
  items: { productId: string; quantity: number }[];
  addressId: string;
  deliveryDate: string;
  company: string;
  gstin: string;
  notes: string;
};
export function isQuoteRequest(value: unknown): value is QuoteRequest {
  const row = value as QuoteRequest | null;
  return Boolean(
    row &&
    text(row.idempotencyKey, 100) &&
    row.idempotencyKey &&
    Array.isArray(row.items) &&
    row.items.length > 0 &&
    row.items.length <= 50 &&
    row.items.every(
      (item) =>
        item &&
        text(item.productId, 100) &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity <= 100000,
    ) &&
    text(row.addressId, 100) &&
    text(row.deliveryDate, 20) &&
    text(row.company, 150) &&
    text(row.gstin, 15) &&
    text(row.notes, 1500),
  );
}

// No control or direction-override characters that could disguise a name on the shop's screen.
const plain = (value: string, limit: number) => {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= limit && !/[^\P{C}\u200C\u200D]/u.test(trimmed);
};
export const goodName = (value: string) => plain(value, 100);
export function goodAddress(form: {
  label: string;
  name: string;
  phone: string;
  line1: string;
  area: string;
  city: string;
  pincode: string;
}) {
  return (
    plain(form.label, 40) &&
    plain(form.name, 100) &&
    /^\+91[6-9]\d{9}$/.test(form.phone) &&
    plain(form.line1, 250) &&
    plain(form.area, 120) &&
    plain(form.city, 100) &&
    /^\d{6}$/.test(form.pincode)
  );
}
