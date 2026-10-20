import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { reportRangeSchema, type MoneyReport } from '@shiv/shared';
import { Db } from './db';
import { Admin, fail } from './http';

const day = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
const rupees = (paise: number) => (paise / 100).toFixed(2);

/**
 * The shop's money for any range of days (India time): what was ordered, what was collected
 * and how (cash, UPI, online), counter sales, refunds, cash still to collect and quotes.
 * Collections are not profit: purchase costs are not tracked.
 */
@ApiTags('Store administration')
@Admin()
@Controller('admin/reports')
export class ReportsController {
  constructor(@Inject(Db) private db: Db) {}

  async money(query: Record<string, string>): Promise<MoneyReport> {
    const parsed = reportRangeSchema.safeParse({ from: query.from, to: query.to });
    if (!parsed.success)
      fail('INVALID_INPUT', parsed.error.issues[0]?.message || 'Choose a valid date range.');
    const { from, to } = parsed.data;
    const start = new Date(`${from}T00:00:00+05:30`);
    const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86400000);
    const range = { gte: start, lt: end };
    const [orders, movements, pending, quotes, creditSales] = await Promise.all([
      this.db.order.findMany({
        where: { createdAt: range },
        select: {
          createdAt: true,
          totalPaise: true,
          status: true,
          user: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.db.financialMovement.findMany({
        where: { occurredAt: range },
        select: { kind: true, channel: true, amountPaise: true, occurredAt: true },
      }),
      this.db.payment.aggregate({
        where: {
          method: 'COD',
          status: 'PENDING',
          order: {
            status: { in: ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERY_EXCEPTION'] },
          },
        },
        _count: true,
        _sum: { amountPaise: true },
      }),
      this.db.quote.groupBy({ by: ['status'], where: { createdAt: range }, _count: true }),
      this.db.customerLedgerEntry.aggregate({
        where: {
          occurredAt: range,
          OR: [
            { kind: 'SALE_ON_CREDIT' },
            { kind: 'REVERSAL', reverses: { kind: 'SALE_ON_CREDIT' } },
          ],
        },
        _sum: { amountPaise: true },
      }),
    ]);
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
      pendingCash: { orders: pending._count, amountPaise: pending._sum.amountPaise || 0 },
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

  @Get('money') report(@Query() query: Record<string, string>) {
    return this.money(query);
  }

  /** The same report as a spreadsheet (UTF-8 with BOM so Excel shows Hindi and ₹ correctly). */
  @Get(['money.csv', 'export']) async csv(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const r = await this.money(query);
    const customerText = (value: string) => (/^\s*[=+\-@]/.test(value) ? `'${value}` : value);
    const lines = [
      [
        'तारीख / Date',
        'ऑर्डर / Orders',
        'वसूली / Collected (₹)',
        'काउंटर / Counter (₹)',
        'वापसी / Refunds (₹)',
      ],
      ...r.days.map((d) => [
        d.date,
        String(d.orders),
        rupees(d.collectedPaise),
        rupees(d.counterPaise),
        rupees(d.refundsPaise),
      ]),
      [],
      ['कुल / Totals', `${r.from} – ${r.to}`],
      ['नकद / Cash collected', rupees(r.collections.cashPaise)],
      ['UPI collected', rupees(r.collections.upiPaise)],
      ['ऑनलाइन / Online', rupees(r.collections.onlinePaise)],
      ['तरीका दर्ज नहीं / Method not recorded', rupees(r.collections.unrecordedPaise)],
      ['काउंटर नकद / Counter cash', rupees(r.counter.cashPaise)],
      ['काउंटर UPI / Counter UPI', rupees(r.counter.upiPaise)],
      ['वापसी / Refunds', rupees(r.refundsPaise)],
      ['शुद्ध वसूली / Net collected', rupees(r.netPaise)],
      ['उधार दिया (₹)', rupees(r.creditSalesPaise)],
      ['उधार वापस मिला (₹)', rupees(r.creditPaymentsPaise)],
      [
        'बाकी नकद / Cash still to collect',
        rupees(r.pendingCash.amountPaise),
        `${r.pendingCash.orders} orders`,
      ],
      ['थोक भाव स्वीकार / Quotes accepted', String(r.quotes.accepted)],
      ['थोक भाव अस्वीकार / Quotes rejected', String(r.quotes.rejected)],
      [],
      ['टॉप ग्राहक', 'मोबाइल', 'बिक्री (₹)', 'ऑर्डर'],
      ...r.topCustomers.map((customer) => [
        customerText(customer.name),
        customerText(customer.phone),
        rupees(customer.totalPaise),
        String(customer.orders),
      ]),
    ];
    const cell = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
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
