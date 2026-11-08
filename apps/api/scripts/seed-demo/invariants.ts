import type { PrismaClient } from '@prisma/client';
import { GallaService } from '../../src/galla';
import { brokenAt } from '../../src/staff/chain';
import { ledgerBrokenAt } from '../../src/staff/pay';

type Count = { n: bigint | number }[];
const n = (rows: Count) => Number(rows[0]?.n ?? 0);

/**
 * The checks every seed must pass, or it fails loudly. They use the same rules the API uses:
 * balances are the sums of their rows, every running balance is its row's running sum, the galla
 * sheet the desk shows matches each evening's close, and every hash chain is unbroken.
 */
export async function checkInvariants(db: PrismaClient) {
  const failures: string[] = [];
  const check = async (label: string, sql: string) => {
    const bad = n(await db.$queryRawUnsafe<Count>(sql));
    if (bad) failures.push(`${label}: ${bad}`);
  };

  await check(
    'khata balance differs from its ledger',
    `SELECT count(*) AS n FROM "User" u LEFT JOIN (SELECT "customerId", sum("amountPaise") AS s FROM "CustomerLedgerEntry" GROUP BY 1) l ON l."customerId" = u.id
     WHERE u."khataBalancePaise" <> COALESCE(l.s, 0)`,
  );
  await check(
    'ledger running balance is off',
    `SELECT count(*) AS n FROM (SELECT "balanceAfterPaise" AS b, sum("amountPaise") OVER (PARTITION BY "customerId" ORDER BY "occurredAt", length(id), id) AS s FROM "CustomerLedgerEntry") x WHERE b <> s`,
  );
  await check(
    'stock level differs from its movements',
    `SELECT count(*) AS n FROM "StockLevel" s FULL JOIN (SELECT "productId", "locationId", sum(quantity) AS q FROM "InventoryMovement" GROUP BY 1, 2) m
       ON m."productId" = s."productId" AND m."locationId" = s."locationId"
     WHERE COALESCE(s.quantity, 0) <> COALESCE(m.q, 0)`,
  );
  await check(
    'movement running balance is off',
    `SELECT count(*) AS n FROM (SELECT "balanceAfter" AS b, sum(quantity) OVER (PARTITION BY "productId", "locationId" ORDER BY "createdAt", length(id), id) AS s FROM "InventoryMovement") x WHERE b <> s`,
  );
  await check(
    'product total differs from its shops',
    `SELECT count(*) AS n FROM "Product" p LEFT JOIN (SELECT "productId", sum(quantity) AS q FROM "StockLevel" GROUP BY 1) s ON s."productId" = p.id
     WHERE p.stock <> COALESCE(s.q, 0)`,
  );
  await check(
    'order subtotal differs from its lines',
    `SELECT count(*) AS n FROM "Order" o JOIN (SELECT "orderId", sum("lineTotalPaise") AS s FROM "OrderItem" GROUP BY 1) i ON i."orderId" = o.id
     WHERE o."subtotalPaise" <> i.s`,
  );
  await check(
    'delivered cash order without its collection',
    `SELECT count(*) AS n FROM "Order" o JOIN "Payment" p ON p."orderId" = o.id
     WHERE o.status = 'DELIVERED' AND p.method = 'COD' AND NOT EXISTS (SELECT 1 FROM "FinancialMovement" f WHERE f."paymentId" = p.id AND f.kind = 'COLLECTION')`,
  );
  await check(
    'credit order out of the shop without its khata entry',
    `SELECT count(*) AS n FROM "Order" o JOIN "Payment" p ON p."orderId" = o.id
     WHERE o.status IN ('OUT_FOR_DELIVERY', 'DELIVERED') AND p.method = 'CREDIT' AND NOT EXISTS (SELECT 1 FROM "CustomerLedgerEntry" l WHERE l."orderId" = o.id)`,
  );
  await check(
    'order alert still waiting to be sent',
    `SELECT count(*) AS n FROM "OwnerWork" WHERE "deliveredAt" IS NULL`,
  );

  // The galla sheet the desk shows, for every closed day, against the close written that evening.
  const galla = new GallaService(db as never);
  const closes = await db.dayClose.findMany({
    select: { locationId: true, day: true, expectedPaise: true },
    orderBy: [{ locationId: 'asc' }, { day: 'asc' }],
  });
  let gallaOff = 0;
  for (const close of closes) {
    const sheet = await galla.sheet(db as never, close.locationId, close.day);
    if (sheet.expectedPaise !== close.expectedPaise) {
      gallaOff++;
      if (gallaOff <= 3)
        failures.push(
          `galla ${close.locationId} ${close.day}: sheet ${sheet.expectedPaise}, close ${close.expectedPaise}`,
        );
    }
  }
  if (gallaOff > 3) failures.push(`galla days off in all: ${gallaOff}`);

  // Hash chains, person by person.
  const events = await db.attendanceEvent.findMany({
    orderBy: [{ userId: 'asc' }, { seq: 'asc' }],
  });
  const ledger = await db.staffLedgerEntry.findMany({
    orderBy: [{ userId: 'asc' }, { seq: 'asc' }],
  });
  const group = <T extends { userId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.userId);
      if (list) list.push(row);
      else map.set(row.userId, [row]);
    }
    return map;
  };
  for (const [userId, rows] of group(events))
    if (brokenAt(rows) !== null) failures.push(`attendance chain broken for ${userId}`);
  for (const [userId, rows] of group(ledger))
    if (ledgerBrokenAt(rows) !== null) failures.push(`pay ledger chain broken for ${userId}`);

  return {
    failures,
    gallaDays: closes.length,
    chains: { attendance: events.length, pay: ledger.length },
  };
}
