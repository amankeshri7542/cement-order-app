import { InventoryKind, Prisma } from '@prisma/client';
import { totals } from '@shiv/shared';
import { fail, MAIN_LOCATION } from './http';

// Stock is the available balance; online reservations leave it immediately. A movement leaves
// Product.version alone: stock has its own ledger, and owner edits or Rate Studio reviews taken
// before an order must still save.
export async function moveStock(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    kind: InventoryKind;
    quantity: number;
    actorId: string;
    reference: string;
    note: string;
    idempotencyKey: string;
    locationId?: string;
  },
) {
  const locationId = input.locationId ?? MAIN_LOCATION;
  const prior = await tx.inventoryMovement.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (prior) {
    if (
      prior.productId !== input.productId ||
      prior.locationId !== locationId ||
      prior.kind !== input.kind ||
      prior.quantity !== input.quantity ||
      prior.actorId !== input.actorId ||
      prior.reference !== input.reference ||
      prior.note !== input.note
    )
      fail(
        'IDEMPOTENCY_CONFLICT',
        'This stock request was already used for a different movement.',
        409,
      );
    return prior;
  }
  const shop = await tx.location.findUnique({
    where: { id: locationId },
    select: { active: true },
  });
  if (!shop?.active) fail('INVALID_SHOP', 'That shop is not open on this system.', 400);
  // The Product row's total and this shop's level move together; the bridge trigger stands aside.
  await tx.$executeRaw`SELECT set_config('shiv.stock_direct', 'on', true)`;
  const conflict = () =>
    fail(
      'STOCK_CONFLICT',
      'Insufficient stock or stock exceeds the supported balance. Refresh and try again.',
      409,
    );
  const level = await tx.stockLevel.updateMany({
    where: {
      productId: input.productId,
      locationId,
      quantity: input.quantity < 0 ? { gte: -input.quantity } : { lte: 1_000_000 - input.quantity },
    },
    data: { quantity: { increment: input.quantity } },
  });
  if (!level.count) {
    // A product first stocked here has no level yet.
    if (input.quantity < 0) conflict();
    const exists = await tx.stockLevel.findUnique({
      where: { productId_locationId: { productId: input.productId, locationId } },
      select: { quantity: true },
    });
    if (exists) conflict();
    await tx.stockLevel.create({
      data: { productId: input.productId, locationId, quantity: input.quantity },
    });
  }
  const changed = await tx.product.updateMany({
    where: {
      id: input.productId,
      stock: input.quantity < 0 ? { gte: -input.quantity } : { lte: 1_000_000 - input.quantity },
    },
    data: { stock: { increment: input.quantity } },
  });
  await tx.$executeRaw`SELECT set_config('shiv.stock_direct', 'off', true)`;
  if (!changed.count) conflict();
  const after = await tx.stockLevel.findUniqueOrThrow({
    where: { productId_locationId: { productId: input.productId, locationId } },
    select: { quantity: true },
  });
  return tx.inventoryMovement.create({
    data: { ...input, locationId, balanceAfter: after.quantity },
  });
}

/** Whether the product's stock ever stood at this balance, before or after a ledger entry. */
export async function pastBalance(tx: Prisma.TransactionClient, productId: string, stock: number) {
  const rows = await tx.$queryRaw<unknown[]>`
    SELECT 1 FROM "InventoryMovement"
    WHERE "productId" = ${productId}
      AND ("balanceAfter" = ${stock} OR "balanceAfter" - "quantity" = ${stock})
    LIMIT 1`;
  return rows.length > 0;
}

/** Shared totals, with an order beyond the supported amount refused as a 409 instead of a 500. */
export function orderTotals(...args: Parameters<typeof totals>) {
  try {
    return totals(...args);
  } catch (error) {
    if (error instanceof Error && error.message === 'Order exceeds supported total')
      fail(
        'ORDER_TOO_LARGE',
        'This order is larger than the shop can accept online. Split it or call the shop.',
        409,
      );
    throw error;
  }
}

export function validateQuantity(
  product: { minQuantity: number; quantityStep: number; name: string },
  quantity: number,
) {
  if (quantity < product.minQuantity || quantity % product.quantityStep !== 0)
    fail(
      'INVALID_QUANTITY',
      `${product.name}: minimum ${product.minQuantity}, in multiples of ${product.quantityStep}.`,
    );
}

export async function deliveryFor(
  tx: Prisma.TransactionClient,
  pincode: string,
  subtotalPaise: number,
) {
  const entry = await tx.deliveryPincode.findUnique({
    where: { pincode },
    include: { zone: true },
  });
  if (!entry?.zone.active)
    fail(
      'NOT_SERVICEABLE',
      'Delivery is not available for this pincode. Call the store for transport options.',
      409,
    );
  if (subtotalPaise < entry.zone.minimumOrderPaise)
    fail(
      'DELIVERY_MINIMUM',
      `Minimum order for this area is ₹${(entry.zone.minimumOrderPaise / 100).toFixed(2)}.`,
      409,
    );
  return entry.zone;
}
