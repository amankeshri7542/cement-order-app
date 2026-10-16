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
// Notes the server writes itself, so they can be shown in Hindi. Notes typed by staff are shown
// as written.
const systemNotes: Record<string, string> = {
  'Cash on delivery order placed.': 'डिलीवरी पर भुगतान वाला ऑर्डर आया।',
  'Stock reserved for 30 minutes while awaiting payment.':
    'भुगतान के इंतज़ार में स्टॉक 30 मिनट के लिए रोका गया।',
  'Cancelled; refund requires store action.': 'रद्द; पैसा लौटाने का काम दुकान को करना है।',
  'Full refund verified by Razorpay.': 'Razorpay ने पूरा पैसा लौटाने की पुष्टि की।',
  'Cash refund recorded by store staff.': 'दुकान ने नकद लौटाना दर्ज किया।',
  'UPI refund recorded by store staff.': 'दुकान ने UPI से पैसा लौटाना दर्ज किया।',
};
/**
 * The note to show under an order-history step. Older orders stored a generic
 * "Order out_for_delivery." note that only repeats the status in code form; it is hidden.
 */
export function historyNote(note: string | null | undefined, language: Language): string {
  if (!note || /^Order [a-z_]+\.$/.test(note)) return '';
  if (language === 'en') return note;
  const quote = /^Accepted quote (\S+), revision (\d+); agreed freight confirmed\.$/.exec(note);
  if (quote) return `थोक भाव ${quote[1]} (संशोधन ${quote[2]}) मंज़ूर; तय भाड़ा पक्का।`;
  return systemNotes[note] ?? note;
}
