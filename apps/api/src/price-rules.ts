import type { Prisma } from '@prisma/client';
import {
  bigRateChangePercent,
  istToday,
  priceLine,
  type Access,
  type PriceRuleInput,
} from '@shiv/shared';
import { fail } from './http';

/** The rules that could apply now. Each one is checked again for the line it is used on. */
export async function activeRules(tx: Pick<Prisma.TransactionClient, 'priceRule'>) {
  const today = istToday();
  return (await tx.priceRule.findMany({
    where: {
      active: true,
      AND: [
        { OR: [{ endsOn: null }, { endsOn: { gte: today } }] },
        // A group switched off takes its rates with it.
        { OR: [{ groupId: null }, { group: { active: true } }] },
      ],
    },
    take: 5000,
  })) as unknown as PriceRuleInput[];
}

/** One line's rate, for this customer, today in India. */
export function priceFor(
  product: { id: string; categoryId: string; pricePaise: number },
  quantity: number,
  customerId: string | null,
  groupId: string | null,
  rules: readonly PriceRuleInput[],
  listPaise = product.pricePaise,
) {
  return priceLine({
    listPaise,
    quantity,
    productId: product.id,
    categoryId: product.categoryId,
    customerId,
    groupId,
    day: istToday(),
    rules,
  });
}

/** A rate that moved by this much is more often a slipped digit than a decision. */
export const bigChange = (from: number, to: number) =>
  Math.abs(to - from) * 100 >= from * bigRateChangePercent;

/** A person's own limit comes before the shop's. Owners, who hold it everywhere, have none. */
export function capFloor(listPaise: number, capPercent: number) {
  return Math.ceil((listPaise * (100 - capPercent)) / 100);
}

/** The check for a rate typed anywhere that is not the confirm sheet: counter sales and quotes. */
export async function checkHandRate(
  tx: Pick<Prisma.TransactionClient, 'user' | 'location'>,
  access: Access,
  actorId: string,
  locationId: string,
  listPaise: number,
  pricePaise: number,
) {
  if (access['orders.rate.change'] === 'ALL') return;
  if (pricePaise > listPaise)
    fail('RATE_ABOVE_LIST', 'A rate above the list needs an owner.', 403, { listPaise });
  const [person, shop] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { rateCapPercent: true } }),
    tx.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { managerRateCapPercent: true },
    }),
  ]);
  const capPercent = person.rateCapPercent ?? shop.managerRateCapPercent;
  const floorPaise = capFloor(listPaise, capPercent);
  if (pricePaise < floorPaise)
    fail('RATE_CAP', 'This rate is below what you may give. Ask an owner.', 403, {
      floorPaise,
      capPercent,
    });
}
