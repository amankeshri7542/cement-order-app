import { Prisma } from '@prisma/client';
import { canDo, csvDocument, maskPhone } from '@shiv/shared';
import type { Response } from 'express';
import { Db } from '../db';
import { AuthRequest, fail } from '../http';

export type Tx = Prisma.TransactionClient;
/** The name that goes out in a message. Decision 52: legal name unchanged, short name for people. */
export const SHOP_NAME = 'Shiv Cement';

/** Someone who can be called. Not staff, not a closed account, not the counter's walk-in row. */
export const realCustomer = {
  deletedAt: null,
  role: { not: 'ADMIN' as const },
  phone: { not: 'walk-in:store' },
} satisfies Prisma.UserWhereInput;

const indiaDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
export const indiaDay = (date: Date) => indiaDayFormat.format(date);
export const dayStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
/**
 * A moment for a raw query. Columns hold UTC with no zone, and a Date sent as it is gets compared
 * in the database session's zone, so on a server not set to UTC every comparison would be hours out.
 */
export const moment = (date: Date) => Prisma.sql`${date.toISOString()}::text::timestamp`;

/** A number only for those who may hold it. Everyone gets enough to tell two people apart. */
export function phoneFields(req: AuthRequest, phone: string) {
  return {
    phone: canDo(req.access, 'customers.phone.read') ? phone : null,
    phoneMasked: maskPhone(phone),
  };
}

/** The same rule for older routes, whose screens expect one string to show. */
export const shownPhone = (req: AuthRequest, phone: string) =>
  canDo(req.access, 'customers.phone.read') ? phone : maskPhone(phone);

/** An order or quote as this person may see it: the number is on the person and on the address. */
export function withShownPhones<T extends { user: { phone: string }; address: unknown }>(
  req: AuthRequest,
  row: T,
): T {
  if (canDo(req.access, 'customers.phone.read')) return row;
  const address = row.address as { phone?: string } | null;
  return {
    ...row,
    user: { ...row.user, phone: maskPhone(row.user.phone) },
    ...(address?.phone ? { address: { ...address, phone: maskPhone(address.phone) } } : {}),
  };
}

/** Money from Tally can pass what JSON numbers hold safely. Plan 09: strings on the wire. */
export const wire = (value: bigint | null | undefined) =>
  value === null || value === undefined ? null : value.toString();

/**
 * One customer has one balance, but a shop's people should see only their own (plan 05 section
 * 4.11): the whole balance counts under the shop that last gave this customer credit.
 */
export async function balanceShops(db: Pick<Db, '$queryRaw'>, ids?: readonly string[]) {
  const rows = await db.$queryRaw<{ customerId: string; locationId: string }[]>`
    SELECT DISTINCT ON (e."customerId") e."customerId", e."locationId"
    FROM "CustomerLedgerEntry" e
    WHERE e."amountPaise" > 0 AND e.kind <> 'REVERSAL'
      AND NOT EXISTS (SELECT 1 FROM "CustomerLedgerEntry" r WHERE r."reversesId" = e.id)
      ${ids ? Prisma.sql`AND e."customerId" = ANY(${[...ids]})` : Prisma.empty}
    ORDER BY e."customerId", e."occurredAt" DESC, e.id DESC`;
  return new Map(rows.map((row) => [row.customerId, row.locationId]));
}

/**
 * Whose debt is oldest, with payments clearing the oldest first, as on the khata summary and the
 * age chart. A reversed sale is no debt. An opening balance is old by nature, however recent its
 * cut-off date, so a person can tell it apart from a sale made that day.
 */
export async function oldestDues(db: Pick<Db, '$queryRaw'>, ids: readonly string[]) {
  if (!ids.length) return new Map<string, { on: string; opening: boolean }>();
  const rows = await db.$queryRaw<{ customerId: string; occurredAt: Date; kind: string }[]>`
    WITH debts AS (
      SELECT e."customerId", e."occurredAt", e.kind, u."khataBalancePaise"::bigint AS balance,
        COALESCE(SUM(e."amountPaise"::bigint) OVER (
          PARTITION BY e."customerId" ORDER BY e."occurredAt" DESC, e.id DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0) AS newer
      FROM "CustomerLedgerEntry" e JOIN "User" u ON u.id = e."customerId"
      WHERE e."amountPaise" > 0 AND u."khataBalancePaise" > 0
        AND e."customerId" = ANY(${[...ids]})
        AND NOT EXISTS (SELECT 1 FROM "CustomerLedgerEntry" r WHERE r."reversesId" = e.id)
    )
    SELECT DISTINCT ON ("customerId") "customerId", "occurredAt", kind::text AS kind
    FROM debts WHERE newer < balance
    ORDER BY "customerId", "occurredAt" ASC`;
  return new Map(
    rows.map((row) => [
      row.customerId,
      { on: indiaDay(row.occurredAt), opening: row.kind === 'OPENING_BALANCE' },
    ]),
  );
}

/**
 * Who has asked not to be messaged: recorded by a person or by the customer, or typed as STOP on the
 * shop's WhatsApp. A person may still call them.
 */
export async function stoppedIds(
  db: Pick<Db, 'waThread'>,
  customers: readonly { id: string; phone: string; remindersStoppedAt: Date | null }[],
) {
  const stopped = new Set(customers.filter((c) => c.remindersStoppedAt).map((c) => c.id));
  if (!customers.length) return stopped;
  const threads = await db.waThread.findMany({
    where: {
      aiMode: 'OPTED_OUT',
      OR: [
        { userId: { in: customers.map((customer) => customer.id) } },
        { phone: { in: customers.map((customer) => customer.phone) } },
      ],
    },
    select: { userId: true, phone: true },
  });
  for (const customer of customers)
    if (threads.some((row) => row.userId === customer.id || row.phone === customer.phone))
      stopped.add(customer.id);
  return stopped;
}

/** A report nobody opens gets deleted, so opens are counted. Counting never stops a report. */
export function countOpen(db: Db, report: string, req: AuthRequest, day: string) {
  void db.reportOpen
    .upsert({
      where: { report_day_userId: { report, day, userId: req.user.id } },
      create: { report, day, userId: req.user.id },
      update: { opens: { increment: 1 } },
    })
    .catch(() => undefined);
}

export function sendCsv(res: Response, filename: string, rows: readonly (readonly string[])[]) {
  res
    .status(200)
    .type('text/csv; charset=utf-8')
    .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    .setHeader('Cache-Control', 'no-store')
    .send(csvDocument(rows));
}

/** The range a month covers in India. A month that has not started is not a month to report. */
export function monthRange(month: string, today: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > today.slice(0, 7))
    fail('BAD_MONTH', 'Choose a month that has started.');
  const [year, number] = month.split('-').map(Number) as [number, number];
  const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
  return { start: dayStart(`${month}-01`), end: dayStart(`${next}-01`) };
}
