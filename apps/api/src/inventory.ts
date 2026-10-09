import { InventoryKind, Prisma } from '@prisma/client';
import { fail } from './http';

// Stock is the available balance; online reservations leave it immediately.
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
  },
) {
  const prior = await tx.inventoryMovement.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (prior) {
    if (
      prior.productId !== input.productId ||
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
  const changed = await tx.product.updateMany({
    where: {
      id: input.productId,
      stock: input.quantity < 0 ? { gte: -input.quantity } : { lte: 1_000_000 - input.quantity },
    },
    data: { stock: { increment: input.quantity }, version: { increment: 1 } },
  });
  if (!changed.count)
    fail(
      'STOCK_CONFLICT',
      'Insufficient stock or stock exceeds the supported balance. Refresh and try again.',
      409,
    );
  const product = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
  return tx.inventoryMovement.create({ data: { ...input, balanceAfter: product.stock } });
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
