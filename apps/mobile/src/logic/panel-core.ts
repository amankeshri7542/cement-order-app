import type { CheckoutReview, Order, ReviewLeftOut } from '@shiv/shared';
import type { ListLine } from './list-core';

// The panel's decisions as plain data. Plain logic, unit-tested under Node.

/** A review lasts 5 minutes on the server; an open panel asks again before that. */
export const REVIEW_REFRESH_MS = 4 * 60 * 1000;
/** The stepper settles for this long before the server is asked. */
export const REVIEW_WAIT_MS = 600;
/** Waits this long before saying the network is slow. */
export const SLOW_AFTER_MS = 8000;
/** The same lines to the same site within this window earns one quiet line. */
export const SAME_ORDER_WINDOW_MS = 2 * 60 * 60 * 1000;

/** A new request id, kept until its result is known. Request ids are not secrets. */
export function makeKey(random: () => number = Math.random) {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const n = Math.floor(random() * 16);
    return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
}

/** Which lines a review answers for. Rates are the server's, so they are not part of this. */
export const linesKey = (lines: Pick<ListLine, 'productId' | 'quantity'>[]) =>
  [...lines]
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .map((line) => `${line.productId}:${line.quantity}`)
    .join(',');

/** What a review is for: lines, site and day. A note or anything else does not change a total. */
export const reviewKey = (lines: ListLine[], addressId: string, deliveryDate: string, notes = '') =>
  `${linesKey(lines)}|${addressId}|${deliveryDate}|${notes}`;

/** An old order's lines. Nothing is carried over from its rates. */
export const repeatLines = (order: Pick<Order, 'items'>): ListLine[] =>
  order.items.map((item) => ({ productId: item.productId, quantity: item.quantity }));

/** The day after today, by the shop's calendar. */
export const dayAfter = (today: string) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

type SiteRef = { id: string; lastUsedAt?: string | Date | null };
/**
 * Which site the panel opens on: the one asked for if it still exists, else the last used. Someone
 * with no site gets none, and the sites sheet opens first.
 */
export function chooseSite(sites: SiteRef[], wanted?: string | null) {
  if (wanted && sites.some((site) => site.id === wanted)) return wanted;
  return sites[0]?.id ?? '';
}

/**
 * Which site a repeat opens on: the old order's. If that site is gone or was never saved (phone and
 * counter orders), it opens on none, because two taps must never send goods to another site.
 */
export function repeatSite(sites: SiteRef[], chosen: string | null, oldSite?: string) {
  if (chosen && sites.some((site) => site.id === chosen)) return chosen;
  return oldSite && sites.some((site) => site.id === oldSite) ? oldSite : '';
}

/** The review that may be placed: it answers for exactly what is on screen. */
export function placeable(
  review: Pick<CheckoutReview, 'id' | 'expiresAt'> | null,
  reviewedKey: string,
  currentKey: string,
  now: number,
) {
  if (!review || reviewedKey !== currentKey) return false;
  return Date.parse(review.expiresAt) > now;
}

/** "You ordered this at 10:31 AM": the same lines to the same site, recently. It never stops anyone. */
export function orderedRecently(
  lines: ListLine[],
  addressId: string,
  orders: Order[],
  now: number,
): Order | null {
  const wanted = linesKey(lines);
  if (!wanted) return null;
  return (
    orders.find((order) => {
      if (order.status === 'CANCELLED') return false;
      if (now - Date.parse(order.createdAt) > SAME_ORDER_WINDOW_MS) return false;
      const site = (order.address as unknown as { id?: string } | null)?.id;
      if (site !== addressId) return false;
      return linesKey(order.items) === wanted;
    }) ?? null
  );
}

export type LeftOutWord = 'notSold' | 'quantity' | 'askShop';
export const leftOutWord = (reason: ReviewLeftOut['reason']): LeftOutWord =>
  reason === 'NOT_SOLD' ? 'notSold' : reason === 'QUANTITY' ? 'quantity' : 'askShop';

/** A refusal that leaves the customer's choice open: a new total, or a change to the list. */
export const refusalMeansLook = (code: string | undefined) =>
  code === 'PRICE_CHANGED' || code === 'REVIEW_EXPIRED' || code === 'CART_CHANGED';
