import type { PrismaClient } from '@prisma/client';

type Row = Record<string, unknown>;
/** Counts come back as bigint and sums of bigint as Decimal; dates and names stay text. */
const num = (v: unknown): unknown => {
  if (typeof v === 'bigint') return Number(v);
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) return Number(String(v));
  return v;
};

/**
 * Golden figures, computed by SQL from what was written. UI tests and the Saathi evals read them
 * (`seed-manifest.json`), so a page or an answer can be checked against the database's own sums.
 * Only seeded values go in: no timings and no "now", so the same seed gives the same manifest.
 */
export async function buildManifest(
  db: PrismaClient,
  meta: { size: string; seed: number; today: string; batchId: string },
) {
  const one = async (sql: string) => {
    const [row] = await db.$queryRawUnsafe<Row[]>(sql);
    return Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, num(v)]));
  };
  const many = async (sql: string, keyName: string) => {
    const rows = await db.$queryRawUnsafe<Row[]>(sql);
    return Object.fromEntries(
      rows.map((row) => {
        const { [keyName]: key, ...rest } = row;
        const values = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, num(v)]));
        return [String(key), Object.keys(values).length === 1 ? Object.values(values)[0] : values];
      }),
    );
  };
  const today = meta.today.replace(/[^0-9-]/g, '');
  const counts = await one(`SELECT
      (SELECT count(*) FROM "Product") AS products,
      (SELECT count(*) FROM "User" WHERE role <> 'ADMIN') AS customers,
      (SELECT count(*) FROM "User" WHERE role = 'ADMIN') AS staff,
      (SELECT count(*) FROM "Order") AS orders,
      (SELECT count(*) FROM "OrderItem") AS "orderLines",
      (SELECT count(*) FROM "CustomerLedgerEntry") AS "ledgerEntries",
      (SELECT count(*) FROM "FinancialMovement") AS "moneyRows",
      (SELECT count(*) FROM "InventoryMovement") AS "stockMovements",
      (SELECT count(*) FROM "StockTransfer") AS transfers,
      (SELECT count(*) FROM "DayClose") AS "gallaCloses",
      (SELECT count(*) FROM "AttendanceDay") AS "attendanceDays",
      (SELECT count(*) FROM "PayLine") AS "payLines",
      (SELECT count(*) FROM "WaThread") AS "waThreads",
      (SELECT count(*) FROM "WaDraft" WHERE status = 'OPEN') AS "waOpenCards"`);
  const udhaar = await one(`SELECT
      count(*) FILTER (WHERE "khataBalancePaise" > 0) AS "customersOwing",
      COALESCE(sum("khataBalancePaise") FILTER (WHERE "khataBalancePaise" > 0), 0) AS "totalOwedPaise",
      COALESCE(max("khataBalancePaise"), 0) AS "largestBalancePaise"
    FROM "User" WHERE role <> 'ADMIN'`);
  const udhaarByFirm = await many(
    `SELECT "firmId" AS k, count(*) FILTER (WHERE "balancePaise" > 0) AS "customersOwing",
            COALESCE(sum("balancePaise") FILTER (WHERE "balancePaise" > 0), 0) AS "totalOwedPaise"
       FROM "CustomerFirmBalance" GROUP BY 1 ORDER BY 1`,
    'k',
  );
  const crossFirmPayments = await one(`SELECT count(*) AS n FROM "FinancialMovement" f
      JOIN "Location" l ON l.id = f."locationId" WHERE f.kind = 'KHATA_PAYMENT' AND f."firmId" <> l."firmId"`);
  const ordersByStatus = await many(
    `SELECT status::text AS k, count(*) AS n FROM "Order" GROUP BY 1 ORDER BY 1`,
    'k',
  );
  const ordersBySource = await many(
    `SELECT source::text AS k, count(*) AS n FROM "Order" GROUP BY 1 ORDER BY 1`,
    'k',
  );
  const todayByShop = await many(
    `SELECT o."locationId" AS k, count(*) AS orders, sum(o."totalPaise") AS "orderValuePaise"
       FROM "Order" o
      WHERE (o."createdAt" + interval '330 minutes')::date = DATE '${today}' AND o.status <> 'CANCELLED'
      GROUP BY 1 ORDER BY 1`,
    'k',
  );
  const collectedToday = await many(
    `SELECT "locationId" AS k, sum("amountPaise") AS n FROM "FinancialMovement"
      WHERE ("occurredAt" + interval '330 minutes')::date = DATE '${today}' AND kind IN ('COLLECTION', 'COUNTER_SALE', 'KHATA_PAYMENT')
      GROUP BY 1 ORDER BY 1`,
    'k',
  );
  const stock = await many(
    `SELECT s."locationId" AS k, count(*) AS lines, sum(s.quantity::bigint * p."pricePaise") AS "valuePaise",
            count(*) FILTER (WHERE s.quantity < s."lowStockAt") AS "lowLines"
       FROM "StockLevel" s JOIN "Product" p ON p.id = s."productId" GROUP BY 1 ORDER BY 1`,
    'k',
  );
  const lastClose = await many(
    `SELECT DISTINCT ON ("locationId") "locationId" AS k, day::text AS day, "expectedPaise" AS expected, "countedPaise" AS counted
       FROM "DayClose" ORDER BY "locationId", day DESC`,
    'k',
  );
  const topProducts = await db.$queryRawUnsafe<Row[]>(
    `SELECT i."productId" AS id, sum(i.quantity) AS quantity, sum(i."lineTotalPaise") AS "valuePaise"
       FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId" WHERE o.status <> 'CANCELLED'
      GROUP BY 1 ORDER BY 3 DESC, 1 LIMIT 10`,
  );
  return {
    ...meta,
    counts,
    udhaar,
    udhaarByFirm,
    crossFirmPayments: crossFirmPayments.n,
    ordersByStatus,
    ordersBySource,
    lastDay: { byShop: todayByShop, collectedPaise: collectedToday },
    stock,
    lastClose,
    topProducts: topProducts.map((r) => ({
      id: String(r.id),
      quantity: num(r.quantity),
      valuePaise: num(r.valuePaise),
    })),
  };
}
