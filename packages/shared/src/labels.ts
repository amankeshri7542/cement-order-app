import type { OrderStatus } from './index';
import { pick, type Bilingual, type Language } from './i18n';

// Every order status must have customer-facing text in both languages (compile-time check).
export const orderStatusLabels: Record<OrderStatus, Bilingual> = {
  PENDING_PAYMENT: ['Payment pending', 'भुगतान बाकी'],
  CONFIRMED: ['Confirmed', 'पक्का हुआ'],
  PREPARING: ['Preparing', 'तैयारी हो रही है'],
  OUT_FOR_DELIVERY: ['Out for delivery', 'डिलीवरी के लिए निकला'],
  DELIVERY_EXCEPTION: ['Delivery needs attention', 'डिलीवरी पर ध्यान चाहिए'],
  DELIVERED: ['Delivered', 'डिलीवरी हो गई'],
  CANCELLED: ['Cancelled', 'रद्द'],
  REFUND_PENDING: ['Refund pending', 'वापसी बाकी'],
  REFUNDED: ['Refunded', 'राशि वापस'],
};

export const quoteStatuses = ['REQUESTED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
export type QuoteStatus = (typeof quoteStatuses)[number];
export const quoteStatusLabels: Record<QuoteStatus, Bilingual> = {
  REQUESTED: ['Requested · awaiting shop', 'अनुरोध · दुकान का जवाब बाकी'],
  SENT: ['Offer ready for review', 'प्रस्ताव जाँच के लिए तैयार'],
  ACCEPTED: ['Accepted · awaiting conversion', 'स्वीकार · ऑर्डर बनना बाकी'],
  REJECTED: ['Rejected', 'अस्वीकार'],
  EXPIRED: ['Expired', 'समय समाप्त'],
};

export const paymentStatuses = ['PENDING', 'CAPTURED', 'REFUND_PENDING', 'REFUNDED'] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];
export const paymentStatusLabels: Record<PaymentStatus, Bilingual> = {
  PENDING: ['Not paid yet', 'भुगतान बाकी'],
  CAPTURED: ['Paid', 'भुगतान हो गया'],
  REFUND_PENDING: ['Refund pending', 'वापसी बाकी'],
  REFUNDED: ['Refunded', 'राशि वापस'],
};
export function paymentStatusText(status: string, language: Language): string {
  const label = paymentStatusLabels[status as PaymentStatus];
  return label ? pick(language, label) : status;
}

/** Customer-facing status text; unknown values are shown as received rather than hidden. */
export function orderStatusText(status: string, language: Language): string {
  const label = orderStatusLabels[status as OrderStatus];
  return label ? pick(language, label) : status;
}
export function quoteStatusText(status: string, language: Language): string {
  const label = quoteStatusLabels[status as QuoteStatus];
  return label ? pick(language, label) : status;
}
