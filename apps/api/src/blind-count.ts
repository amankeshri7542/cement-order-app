import type { Prisma } from '@prisma/client';
import { canDo, type Access } from '@shiv/shared';

type Reader = Pick<Prisma.TransactionClient, 'stockCount'>;

/**
 * Shops whose book figure is out of sight, from the moment a count starts until one is approved.
 * Asking for a recount keeps it hidden, or the next person could read the answer first.
 */
export async function shopsBeingCounted(db: Reader) {
  const latest = await db.stockCount.findMany({
    distinct: ['locationId'],
    orderBy: [{ locationId: 'asc' }, { createdAt: 'desc' }],
    select: { locationId: true, status: true },
  });
  return latest.filter((row) => row.status !== 'APPROVED').map((row) => row.locationId);
}

/** The shops this person may not read a figure for. Those who decide the count still may. */
export async function blindShops(db: Reader, access: Access) {
  const shops = await shopsBeingCounted(db);
  return new Set(shops.filter((id) => !canDo(access, 'approvals.decide', id)));
}

/** Items being counted anywhere, for what a customer sees. */
export async function itemsBeingCounted(
  db: Reader & Pick<Prisma.TransactionClient, 'stockCountLine'>,
) {
  const shops = await shopsBeingCounted(db);
  if (!shops.length) return new Set<string>();
  const lines = await db.stockCountLine.findMany({
    where: { count: { locationId: { in: shops }, status: { not: 'APPROVED' } } },
    distinct: ['productId'],
    select: { productId: true },
  });
  return new Set(lines.map((line) => line.productId));
}
