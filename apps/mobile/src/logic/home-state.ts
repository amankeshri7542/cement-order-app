import type { Address, Order, User } from '@shiv/shared';

// One function decides Home; there is no contractor flag or onboarding flag. Plain logic, unit-tested
// under Node.

export type HomeShape = 'new' | 'repeat';

/**
 * "new" until the first order. A signed-in customer whose orders are not known yet is treated as
 * "repeat", so a regular never sees a beginner's Home flash on a slow connection.
 */
export function homeState({
  user,
  ordersKnown,
  latestOrder,
}: {
  user: Pick<User, 'id'> | null;
  ordersKnown: boolean;
  latestOrder: Pick<Order, 'id'> | null;
}): HomeShape {
  if (!user) return 'new';
  if (latestOrder || !ordersKnown) return 'repeat';
  return 'new';
}

type SiteCopy = Partial<Pick<Address, 'id' | 'label' | 'pincode' | 'area'>>;
const siteOf = (order: Pick<Order, 'address'>) => order.address as unknown as SiteCopy | null;

export type OtherSite = { siteId: string; label: string; order: Order };

/**
 * The last order at each other site, newest first and at most 3, so the rates stay near the top.
 * Phone and counter orders carry no saved site id, so they are not grouped.
 */
export function otherSites(orders: Order[], max = 3): OtherSite[] {
  const latestSite = orders[0] ? siteOf(orders[0])?.id : undefined;
  const seen = new Set<string>(latestSite ? [latestSite] : []);
  const rows: OtherSite[] = [];
  for (const order of orders.slice(1)) {
    const site = siteOf(order);
    if (!site?.id || seen.has(site.id) || order.status === 'CANCELLED') continue;
    seen.add(site.id);
    rows.push({ siteId: site.id, label: site.label || site.area || '', order });
    if (rows.length >= max) break;
  }
  return rows;
}

/** The latest order's lines, in words. */
export const orderLines = (order: Pick<Order, 'items'>) =>
  order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ');
