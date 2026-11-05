import type { Order } from '@shiv/shared';
import { orderStatusText } from '@shiv/shared/src/labels';
import { price } from './display';

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
export function orderShareText(order: ShareableOrder): string {
  return [
    'Shiv Cement Store: order summary (not a GST invoice)',
    `Order ${order.number}`,
    `Status: ${orderStatusText(order.status, 'en')}`,
    ...order.items.map(
      (item) => `${item.name} × ${item.quantity} ${item.unit} = ${price(item.lineTotalPaise)}`,
    ),
    `Delivery: ${price(order.deliveryFeePaise)}`,
    `Total: ${price(order.totalPaise)}`,
  ].join('\n');
}

/** wa.me without a number opens WhatsApp's own contact picker. */
export const whatsappShareUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
