import type { Prisma } from '@prisma/client';
import type { AuthRequest } from './http';
import { fail, forbid } from './http';

type Tx = Prisma.TransactionClient;

/** The firm every row belonged to before there were two (the migrations' first firm). */
export const MAIN_FIRM = 'firm_main';

/**
 * Two firms (plan v4, platform section 2). Every money row names its firm. Orders, galla and counter
 * sales take their shop's firm. Udhaar payments and adjustments take the firm the person picks,
 * because an owner at one shop can take another firm's due.
 */

/** The firm a shop belongs to. */
export async function firmOfLocation(tx: Pick<Tx, 'location'>, locationId: string) {
  const shop = await tx.location.findUnique({
    where: { id: locationId },
    select: { firmId: true },
  });
  if (!shop) fail('INVALID_SHOP', 'That shop does not exist.', 400);
  return shop.firmId;
}

/** A firm that exists and is open. Anything else is refused. */
export async function activeFirm(tx: Pick<Tx, 'firm'>, firmId: string) {
  const firm = await tx.firm.findFirst({
    where: { id: firmId, active: true },
    select: { id: true },
  });
  if (!firm) fail('INVALID_FIRM', 'Choose a firm that is open.', 400);
  return firm.id;
}

/**
 * The firm a plain udhaar payment goes to when nobody chose: the one this customer has owed
 * longest. Their oldest unpaid credit entry decides; with nothing owed, the firm with the largest due,
 * and if none, the given fallback (the shop's own firm).
 */
export async function oldestDueFirm(tx: Tx, customerId: string, fallback: string) {
  const owing = await tx.customerFirmBalance.findMany({
    where: { customerId, balancePaise: { gt: 0 } },
    select: { firmId: true, balancePaise: true },
  });
  if (!owing.length) return fallback;
  if (owing.length === 1) return owing[0]!.firmId;
  const oldest = await tx.customerLedgerEntry.findFirst({
    where: {
      customerId,
      firmId: { in: owing.map((row) => row.firmId) },
      amountPaise: { gt: 0 },
      reversal: null,
    },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { firmId: true },
  });
  return oldest?.firmId ?? owing.sort((a, b) => b.balancePaise - a.balancePaise)[0]!.firmId;
}

/** The firms this person may see the books of. */
export function firmsOf(req: Pick<AuthRequest, 'firms'>): 'ALL' | string[] {
  return req.firms ?? 'ALL';
}

/** Limits a query on a firm-owned table to this person's firms. Empty for anyone who sees all. */
export function firmWhere(req: Pick<AuthRequest, 'firms'>, column = 'firmId') {
  const firms = firmsOf(req);
  return firms === 'ALL' ? {} : { [column]: { in: firms } };
}

/** Refuses unless this person may see this firm's books. */
export function requireFirm(req: AuthRequest, firmId: string, permission = 'firm') {
  const firms = firmsOf(req);
  if (firms !== 'ALL' && !firms.includes(firmId)) forbid(req, permission);
}

/** A firm the person asked for, which must be one of theirs; otherwise all of theirs. */
export function firmAsked(req: AuthRequest, asked?: unknown) {
  if (typeof asked !== 'string' || !asked) return firmWhere(req);
  requireFirm(req, asked);
  return { firmId: asked };
}

/** Financial year in India time, April to March, such as 2026-27. */
export function financialYear(day: string) {
  const year = Number(day.slice(0, 4));
  const start = Number(day.slice(5, 7)) >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * The udhaar figures a credit order is checked against. When this firm has its own limit for the
 * customer, its limit and its balance count, and only its own unsent credit orders. Otherwise the
 * customer's own limit counts against everything they owe.
 */
export async function creditFigures(
  tx: Tx,
  customer: { id: string; creditLimitPaise: number | null; khataBalancePaise: number },
  firmId: string,
) {
  const firm = await tx.customerFirmBalance.findUnique({
    where: { customerId_firmId: { customerId: customer.id, firmId } },
    select: { balancePaise: true, creditLimitPaise: true },
  });
  if (firm?.creditLimitPaise != null)
    return {
      scope: 'FIRM' as const,
      limitPaise: firm.creditLimitPaise,
      balancePaise: firm.balancePaise,
      pendingWhere: { firmId },
    };
  return {
    scope: 'CUSTOMER' as const,
    limitPaise: customer.creditLimitPaise,
    balancePaise: customer.khataBalancePaise,
    pendingWhere: {},
  };
}

/**
 * Which customers a person limited to some firms may see: anyone who has bought from or owes one
 * of their firms, and anyone new who has done neither anywhere. A customer known only to another
 * firm is not there for them at all.
 */
export function customerFirmWhere(req: Pick<AuthRequest, 'firms'>): Prisma.UserWhereInput {
  const firms = firmsOf(req);
  if (firms === 'ALL') return {};
  return {
    OR: [
      { firmBalances: { some: { firmId: { in: firms } } } },
      { orders: { some: { firmId: { in: firms } } } },
      { AND: [{ firmBalances: { none: {} } }, { orders: { none: {} } }] },
    ],
  };
}

/**
 * The firms a list reads: the one chosen in the desk's top bar (which must be one of this
 * person's), or all of theirs. In the shape firmWhere, firmsOf and customerFirmWhere take.
 */
export function firmView(req: AuthRequest, asked?: unknown): Pick<AuthRequest, 'firms'> {
  if (typeof asked !== 'string' || !asked) return req;
  requireFirm(req, asked);
  return { firms: [asked] };
}

/** Firms by id with their names, for answers that show per firm and combined. */
export async function firmNames(tx: Pick<Tx, 'firm'>) {
  const firms = await tx.firm.findMany({
    select: { id: true, tradeName: true, legalName: true, active: true },
    orderBy: { createdAt: 'asc' },
  });
  return firms.map((firm) => ({
    id: firm.id,
    name: firm.tradeName || firm.legalName,
    active: firm.active,
  }));
}

/** Refuses, as not found, a customer this person's firms have never dealt with. */
export async function requireCustomerVisible(
  db: Pick<Tx, 'user'>,
  req: Pick<AuthRequest, 'firms'>,
  customerId: string,
) {
  if (firmsOf(req) === 'ALL') return;
  const seen = await db.user.count({ where: { id: customerId, ...customerFirmWhere(req) } });
  if (!seen) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
}
