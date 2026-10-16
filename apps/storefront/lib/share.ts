import { orderStatusText, type Language, type Order } from '@shiv/shared';
import { price } from './catalog';

export type ShareableOrder = Pick<
  Order,
  'number' | 'status' | 'deliveryFeePaise' | 'totalPaise'
> & {
  items: Pick<Order['items'][number], 'name' | 'quantity' | 'unit' | 'lineTotalPaise'>[];
};

/**
 * The order summary a customer forwards on WhatsApp, as the Android app shares it. It carries
 * no address, phone number or staff details: the chat may be forwarded beyond the family.
 */
export function orderShareText(order: ShareableOrder, language: Language): string {
  const hi = language === 'hi';
  return [
    hi
      ? 'शिव सीमेंट स्टोर — ऑर्डर सारांश (GST बिल नहीं)'
      : 'Shiv Cement Store — order summary (not a GST invoice)',
    `${hi ? 'ऑर्डर' : 'Order'} ${order.number}`,
    `${hi ? 'स्थिति' : 'Status'}: ${orderStatusText(order.status, language)}`,
    ...order.items.map(
      (item) => `${item.name} × ${item.quantity} ${item.unit} = ${price(item.lineTotalPaise)}`,
    ),
    `${hi ? 'डिलीवरी' : 'Delivery'}: ${price(order.deliveryFeePaise)}`,
    `${hi ? 'कुल' : 'Total'}: ${price(order.totalPaise)}`,
  ].join('\n');
}

/** wa.me without a number opens WhatsApp's own contact picker. */
export const whatsappShareUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
