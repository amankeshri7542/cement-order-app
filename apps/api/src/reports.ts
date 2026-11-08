import { Controller, Get, Inject, Query, Res, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrderSource, Prisma } from '@prisma/client';
import type { Response } from 'express';
import { istToday, reportRangeSchema, type MoneyReport } from '@shiv/shared';
import { Db } from './db';
import { AuthRequest, Can, fail, Firm, scoped, shopAsked, shopWhere } from './http';
import { firmAsked } from './firms';
import { shownPhone } from './crm/common';

const day = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
const rupees = (paise: number) => (paise / 100).toFixed(2);
const DAY_MS = 86400000;

/** Money in and out of the shop, the same way the money report adds it up. */
export const moneyIn = ['COLLECTION', 'KHATA_PAYMENT', 'COUNTER_SALE', 'HANDOVER_OVER'];
export const moneyOut = ['REFUND', 'KHATA_PAYMENT_REVERSAL', 'HANDOVER_SHORT'];
/** Orders no one has agreed to yet, or that are gone, bring in no money. */
export const notSold = [
  'PENDING_PAYMENT',
  'AWAITING_CONFIRMATION',
  'CANCELLED',
  'REFUNDED',
  'REFUND_PENDING',
] as const;
/** These are made by a person at the shop, so they are confirmed the moment they exist. */
const bornConfirmed = ['PHONE', 'WALK_IN', 'QUOTE', 'WHATSAPP'] as const;
/** How many items get their own bar. The rest join under one lighter bar. */
const ITEM_BARS = 5;

// The family has not given each shop's hours yet (plan 01, question 9), and Location has no field
// for them. Staff work 8-9 AM to 6-7 PM, so the wait is counted from 8 AM to 7 PM, India time.
const OPENS_AT = 8 * 60;
const CLOSES_AT = 19 * 60;
const IST_OFFSET = 330;

/** The minutes between two moments that fall inside shop hours: a night order waits only from 8 AM. */
export function shopMinutes(from: Date, to: Date) {
  const openUpTo = (at: Date) => {
    const minute = at.getTime() / 60000 + IST_OFFSET;
    const whole = Math.floor(minute / 1440);
    const today = Math.min(Math.max(minute - whole * 1440 - OPENS_AT, 0), CLOSES_AT - OPENS_AT);
    return whole * (CLOSES_AT - OPENS_AT) + today;
  };
  return Math.max(0, openUpTo(to) - openUpTo(from));
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
/** The days of a range, India time, from its first day to its last. */
function daysOf(start: Date, end: Date) {
  const dates: string[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS)
    dates.push(day(new Date(t + 6 * 3600000)));
  return dates;
}
function rangeOf(query: Record<string, unknown>) {
  const parsed = reportRangeSchema.safeParse({ from: query.from, to: query.to });
  if (!parsed.success)
    fail('INVALID_INPUT', parsed.error.issues[0]?.message || 'Choose a valid date range.');
  const { from, to } = parsed.data;
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + DAY_MS);
  return { from, to, start, end };
}
/**
 * The shop's money for any range of days (India time): what was ordered, what was collected
 * and how (cash, UPI, online), counter sales, refunds, cash still to collect and quotes.
 * Collections are not profit: purchase costs are not tracked.
 */
@ApiTags('Store administration')
@Controller('admin/reports')
export class ReportsController {
  constructor(@Inject(Db) private db: Db) {}

  async money(
    query: Record<string, string>,
    shop: { locationId?: { in: string[] } } = {},
    /** The firms counted: money belongs to a firm, whichever shop took it. */
    firm: { firmId?: string | { in: string[] } } = {},
  ): Promise<MoneyReport> {
    const parsed = reportRangeSchema.safeParse({ from: query.from, to: query.to });
    if (!parsed.success)
      fail('INVALID_INPUT', parsed.error.issues[0]?.message || 'Choose a valid date range.');
    const { from, to } = parsed.data;
    const start = new Date(`${from}T00:00:00+05:30`);
    const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86400000);
    const range = { gte: start, lt: end };
    const [orders, movements, pending, quotes, creditSales] = await Promise.all([
      this.db.order.findMany({
        where: { createdAt: range, ...shop, ...firm },
        select: {
          createdAt: true,
          totalPaise: true,
          status: true,
          user: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.db.financialMovement.findMany({
        where: { occurredAt: range, ...shop, ...firm },
        select: { kind: true, channel: true, amountPaise: true, occurredAt: true },
      }),
      this.db.payment.findMany({
        where: {
          method: 'COD',
          status: 'PENDING',
          order: {
            ...shop,
            ...firm,
            status: {
              in: [
                'AWAITING_CONFIRMATION',
                'CONFIRMED',
                'PREPARING',
                'OUT_FOR_DELIVERY',
                'DELIVERY_EXCEPTION',
                // Delivered with part still owed, because the driver got less than was due.
                'DELIVERED',
              ],
            },
          },
        },
        select: { orderId: true, amountPaise: true },
      }),
      this.db.quote.groupBy({ by: ['status'], where: { createdAt: range, ...shop }, _count: true }),
      this.db.customerLedgerEntry.aggregate({
        where: {
          occurredAt: range,
          ...shop,
          ...firm,
          OR: [
            { kind: 'SALE_ON_CREDIT' },
            { kind: 'REVERSAL', reverses: { kind: 'SALE_ON_CREDIT' } },
          ],
        },
        _sum: { amountPaise: true },
      }),
    ]);
    // What a driver took at the door is not still to collect.
    const atTheDoor = await this.db.driverCollection.aggregate({
      where: { orderId: { in: pending.map((row) => row.orderId) } },
      _sum: { amountPaise: true },
    });
    const creditPaymentsPaise = movements.reduce(
      (total, movement) =>
        total +
        (movement.kind === 'KHATA_PAYMENT'
          ? movement.amountPaise
          : movement.kind === 'KHATA_PAYMENT_REVERSAL'
            ? -movement.amountPaise
            : 0),
      0,
    );
    // Khata receipts and reversals contribute to the same cash report.
    for (const movement of movements) {
      if (movement.kind === 'KHATA_PAYMENT') movement.kind = 'COLLECTION';
      if (movement.kind === 'KHATA_PAYMENT_REVERSAL') movement.kind = 'REFUND';
      // A driver's cash joined at what was counted, so the report and the drawer say the same.
      if (movement.kind === 'HANDOVER_OVER') movement.kind = 'COLLECTION';
      if (movement.kind === 'HANDOVER_SHORT') {
        movement.kind = 'COLLECTION';
        movement.amountPaise = -movement.amountPaise;
      }
    }
    const sum = (kind: string, channel?: string) =>
      movements
        .filter((m) => m.kind === kind && (channel === undefined || m.channel === channel))
        .reduce((total, m) => total + m.amountPaise, 0);
    const collections = {
      cashPaise: sum('COLLECTION', 'CASH'),
      upiPaise: sum('COLLECTION', 'UPI'),
      onlinePaise: sum('COLLECTION', 'ONLINE'),
      unrecordedPaise: sum('COLLECTION', ''),
    };
    const counter = {
      sales: movements.filter((m) => m.kind === 'COUNTER_SALE').length,
      cashPaise: sum('COUNTER_SALE', 'CASH'),
      upiPaise: sum('COUNTER_SALE', 'UPI'),
      unrecordedPaise: sum('COUNTER_SALE', ''),
    };
    const refundsPaise = sum('REFUND');
    const days = new Map<string, MoneyReport['days'][number]>();
    for (let t = start.getTime(); t < end.getTime(); t += 86400000) {
      const date = day(new Date(t + 6 * 3600000));
      days.set(date, { date, orders: 0, collectedPaise: 0, counterPaise: 0, refundsPaise: 0 });
    }
    const customers = new Map<string, MoneyReport['topCustomers'][number]>();
    for (const order of orders) {
      const row = days.get(day(order.createdAt));
      if (row) row.orders++;
      if (
        !['CANCELLED', 'REFUNDED', 'REFUND_PENDING'].includes(order.status) &&
        order.user.phone !== 'walk-in:store'
      ) {
        const customer = customers.get(order.user.id) || {
          ...order.user,
          totalPaise: 0,
          orders: 0,
        };
        customer.totalPaise += order.totalPaise;
        customer.orders++;
        customers.set(customer.id, customer);
      }
    }
    for (const m of movements) {
      const row = days.get(day(m.occurredAt));
      if (!row) continue;
      if (m.kind === 'COLLECTION') row.collectedPaise += m.amountPaise;
      if (m.kind === 'COUNTER_SALE') row.counterPaise += m.amountPaise;
      if (m.kind === 'REFUND') row.refundsPaise += m.amountPaise;
    }
    const quoteCount = (status: string) =>
      quotes.find((quote) => quote.status === status)?._count || 0;
    return {
      from,
      to,
      orders: {
        placed: orders.length,
        valuePaise: orders
          .filter((o) => !['CANCELLED', 'REFUNDED', 'REFUND_PENDING'].includes(o.status))
          .reduce((total, o) => total + o.totalPaise, 0),
        delivered: orders.filter((o) => o.status === 'DELIVERED').length,
        cancelled: orders.filter((o) =>
          ['CANCELLED', 'REFUNDED', 'REFUND_PENDING'].includes(o.status),
        ).length,
      },
      collections,
      counter,
      refundsPaise,
      creditSalesPaise: creditSales._sum.amountPaise ?? 0,
      creditPaymentsPaise,
      topCustomers: [...customers.values()]
        .sort((a, b) => b.totalPaise - a.totalPaise || a.id.localeCompare(b.id))
        .slice(0, 10),
      netPaise: sum('COLLECTION') + sum('COUNTER_SALE') - refundsPaise,
      pendingCash: {
        orders: pending.length,
        amountPaise:
          pending.reduce((sum, row) => sum + row.amountPaise, 0) -
          (atTheDoor._sum.amountPaise ?? 0),
      },
      quotes: {
        requested: quoteCount('REQUESTED'),
        sent: quoteCount('SENT'),
        accepted: quoteCount('ACCEPTED'),
        rejected: quoteCount('REJECTED'),
        expired: quoteCount('EXPIRED'),
      },
      days: [...days.values()],
    };
  }

  @Firm('own')
  @Can('reports.read', scoped)
  @Get('money')
  async report(@Query() query: Record<string, string>, @Req() req: AuthRequest) {
    return this.withNumbersShown(
      await this.money(query, shopWhere(req, 'reports.read'), firmAsked(req, query.firmId)),
      req,
    );
  }

  private withNumbersShown(report: MoneyReport, req: AuthRequest): MoneyReport {
    return {
      ...report,
      topCustomers: report.topCustomers.map((row) => ({
        ...row,
        phone: shownPhone(req, row.phone),
      })),
    };
  }

  /** The numbers behind the Report page's charts. Reads only. Money figures are never profit. */
  @Firm('own')
  @Can('reports.read', scoped)
  @Get('trends')
  async trends(@Query() query: Record<string, unknown>, @Req() req: AuthRequest) {
    const shop = shopAsked(req, 'reports.read', query.locationId);
    const firm = firmAsked(req, query.firmId);
    const { from, to, start, end } = rangeOf(query);
    const range = { gte: start, lt: end };
    const [locations, movements, itemRows, sourceRows, tapped, firstOrder, firstMoney] =
      await Promise.all([
        this.db.location.findMany({
          where: shop.locationId ? { id: shop.locationId } : {},
          select: { id: true, name: true, active: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        this.db.financialMovement.findMany({
          where: { occurredAt: range, kind: { in: [...moneyIn, ...moneyOut] }, ...shop, ...firm },
          select: { locationId: true, kind: true, amountPaise: true, occurredAt: true },
        }),
        this.db.orderItem.groupBy({
          by: ['productId', 'unit'],
          where: { order: { createdAt: range, status: { notIn: [...notSold] }, ...shop, ...firm } },
          _sum: { lineTotalPaise: true, quantity: true },
        }),
        this.db.order.groupBy({
          by: ['source'],
          where: { createdAt: range, ...shop, ...firm },
          _count: { _all: true },
        }),
        this.db.order.findMany({
          where: { confirmedAt: range, source: { notIn: [...bornConfirmed] }, ...shop, ...firm },
          select: { createdAt: true, confirmedAt: true },
        }),
        this.db.order.aggregate({ where: { ...shop, ...firm }, _min: { createdAt: true } }),
        this.db.financialMovement.aggregate({
          where: { ...shop, ...firm },
          _min: { occurredAt: true },
        }),
      ]);

    const dates = daysOf(start, end);
    const perShop = new Map<string, Map<string, number>>();
    for (const m of movements) {
      const days = perShop.get(m.locationId) ?? new Map<string, number>();
      const date = day(m.occurredAt);
      const signed = moneyOut.includes(m.kind) ? -m.amountPaise : m.amountPaise;
      days.set(date, (days.get(date) ?? 0) + signed);
      perShop.set(m.locationId, days);
    }
    const shops = locations
      // A closed shop stays on the chart only for the days it took money.
      .filter((location) => location.active || perShop.has(location.id))
      .map((location) => {
        const days = dates.map((date) => ({
          date,
          moneyInPaise: perShop.get(location.id)?.get(date) ?? 0,
        }));
        return {
          id: location.id,
          name: location.name,
          totalPaise: days.reduce((sum, row) => sum + row.moneyInPaise, 0),
          days,
        };
      });

    const products = await this.db.product.findMany({
      where: { id: { in: itemRows.map((row) => row.productId) } },
      select: { id: true, name: true },
    });
    const ranked = itemRows
      .map((row) => ({
        productId: row.productId,
        name: products.find((product) => product.id === row.productId)?.name ?? '',
        unit: row.unit,
        // Bori, kg and cu ft cannot be added together, so each line keeps its own unit.
        quantity: row._sum.quantity ?? 0,
        totalPaise: row._sum.lineTotalPaise ?? 0,
      }))
      .filter((row) => row.totalPaise > 0)
      .sort((a, b) => b.totalPaise - a.totalPaise || a.name.localeCompare(b.name));
    const rest = ranked.slice(ITEM_BARS);

    const sources = Object.values(OrderSource)
      .map((source) => ({
        source,
        orders: sourceRows.find((row) => row.source === source)?._count._all ?? 0,
      }))
      .sort((a, b) => b.orders - a.orders || a.source.localeCompare(b.source));

    const waits = new Map<string, number[]>();
    for (const order of tapped) {
      const minutes = shopMinutes(order.createdAt, order.confirmedAt!);
      // Asked and answered outside shop hours: there was no shop wait to measure.
      if (minutes <= 0) continue;
      const date = day(order.confirmedAt!);
      waits.set(date, [...(waits.get(date) ?? []), minutes]);
    }
    const today = istToday();
    const firsts = [firstOrder._min.createdAt, firstMoney._min.occurredAt].filter(
      (value): value is Date => !!value,
    );
    const firstDay = firsts.length
      ? day(new Date(Math.min(...firsts.map((value) => value.getTime()))))
      : null;
    const historyDays = firstDay
      ? Math.max(0, (Date.parse(today) - Date.parse(firstDay)) / DAY_MS) + 1
      : 0;
    return {
      from,
      to,
      today,
      historyDays,
      shops,
      items: ranked.slice(0, ITEM_BARS),
      otherItems: {
        products: new Set(rest.map((row) => row.productId)).size,
        totalPaise: rest.reduce((sum, row) => sum + row.totalPaise, 0),
      },
      sources,
      confirm: dates.map((date) => {
        const minutes = waits.get(date);
        return {
          date,
          orders: minutes?.length ?? 0,
          medianMinutes: minutes ? Math.round(median(minutes) * 10) / 10 : null,
        };
      }),
    };
  }

  /**
   * How old the udhaar is today. Payments clear the oldest debt first, as on the khata summary, so
   * what is still owed is always the newest debts. Each debt stays with the shop that gave it: a
   * shop's people see only theirs, even when a payment landed at another shop.
   */
  @Firm('own')
  @Can('reports.read', scoped)
  @Get('udhaar-age')
  async udhaarAge(@Query() query: Record<string, unknown>, @Req() req: AuthRequest) {
    const asked = shopAsked(req, 'reports.read', query.locationId).locationId;
    const ids = typeof asked === 'string' ? [asked] : asked?.in;
    // Each firm's debts age on their own: a payment to one firm never ages the other's.
    const firm = firmAsked(req, query.firmId).firmId;
    const firms = typeof firm === 'string' ? [firm] : firm?.in;
    const midnight = new Date(`${istToday()}T00:00:00+05:30`).getTime();
    // Columns hold UTC with no zone. A Date sent as it is would be compared in the database
    // session's zone, so on a server not set to UTC each step would be hours out.
    const [d30, d60, d90] = [30, 60, 90].map(
      (days) => Prisma.sql`${new Date(midnight - days * DAY_MS).toISOString()}::text::timestamp`,
    );
    const rows = await this.db.$queryRaw<{ step: number; paise: bigint }[]>`
      WITH debts AS (
        SELECT e."locationId", e."occurredAt", e.kind, e."amountPaise"::bigint AS amount,
          b."balancePaise"::bigint AS balance,
          COALESCE(SUM(e."amountPaise"::bigint) OVER (
            PARTITION BY e."customerId", e."firmId" ORDER BY e."occurredAt" DESC, e.id DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS newer
        FROM "CustomerLedgerEntry" e JOIN "User" u ON u.id = e."customerId"
        JOIN (SELECT "customerId", "firmId", SUM("amountPaise")::bigint AS "balancePaise"
              FROM "CustomerLedgerEntry" GROUP BY 1, 2) b
          ON b."customerId" = e."customerId" AND b."firmId" = e."firmId"
        WHERE e."amountPaise" > 0 AND b."balancePaise" > 0
          AND u."deletedAt" IS NULL AND u.role <> 'ADMIN'
          ${firms ? Prisma.sql`AND e."firmId" = ANY(${firms})` : Prisma.empty}
      )
      SELECT (CASE WHEN kind = 'OPENING_BALANCE' THEN 3 WHEN "occurredAt" >= ${d30} THEN 0
        WHEN "occurredAt" >= ${d60} THEN 1
        WHEN "occurredAt" >= ${d90} THEN 2 ELSE 3 END)::int AS step,
        SUM(LEAST(amount, balance - newer))::bigint AS paise
      FROM debts
      WHERE newer < balance
        ${ids ? Prisma.sql`AND "locationId" = ANY(${ids})` : Prisma.empty}
      GROUP BY 1`;
    const steps = (['0-30', '31-60', '61-90', '90+'] as const).map((step, index) => ({
      step,
      paise: Number(rows.find((row) => row.step === index)?.paise ?? 0),
    }));
    return { totalPaise: steps.reduce((sum, row) => sum + row.paise, 0), steps };
  }

  /** The same report as a spreadsheet (UTF-8 with BOM so Excel shows Hindi and ₹ correctly). */
  @Firm('own')
  @Can('reports.read', scoped)
  @Get(['money.csv', 'export'])
  async csv(@Query() query: Record<string, string>, @Res() res: Response, @Req() req: AuthRequest) {
    const r = this.withNumbersShown(
      await this.money(query, shopWhere(req, 'reports.read'), firmAsked(req, query.firmId)),
      req,
    );
    const customerText = (value: string) => (/^\s*[=+\-@]/.test(value) ? `'${value}` : value);
    const lines = [
      ['Date', 'Orders', 'Collected (₹)', 'Counter (₹)', 'Refunds (₹)'],
      ...r.days.map((d) => [
        d.date,
        String(d.orders),
        rupees(d.collectedPaise),
        rupees(d.counterPaise),
        rupees(d.refundsPaise),
      ]),
      [],
      ['Totals', `${r.from} – ${r.to}`],
      ['Cash collected', rupees(r.collections.cashPaise)],
      ['UPI collected', rupees(r.collections.upiPaise)],
      ['Online', rupees(r.collections.onlinePaise)],
      ['Method not recorded', rupees(r.collections.unrecordedPaise)],
      ['Counter cash', rupees(r.counter.cashPaise)],
      ['Counter UPI', rupees(r.counter.upiPaise)],
      ['Refunds', rupees(r.refundsPaise)],
      ['Net collected', rupees(r.netPaise)],
      ['Credit given (₹)', rupees(r.creditSalesPaise)],
      ['Credit paid back (₹)', rupees(r.creditPaymentsPaise)],
      [
        'Cash still to collect',
        rupees(r.pendingCash.amountPaise),
        `${r.pendingCash.orders} orders`,
      ],
      ['Quotes accepted', String(r.quotes.accepted)],
      ['Quotes rejected', String(r.quotes.rejected)],
      [],
      ['Top customers', 'Mobile', 'Sales (₹)', 'Orders'],
      ...r.topCustomers.map((customer) => [
        customerText(customer.name),
        customerText(customer.phone),
        rupees(customer.totalPaise),
        String(customer.orders),
      ]),
    ];
    const cell = (value: string) =>
      /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
    res
      .status(200)
      .type('text/csv; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="shiv-money-${r.from}-to-${r.to}.csv"`,
      )
      .send(`\uFEFF${lines.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`);
  }
}
