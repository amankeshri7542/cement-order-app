import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { paginate } from './pagination';
import { Db } from './db';
import { orderInclude } from './orders';
import { Admin, fail } from './http';

@ApiTags('Store administration')
@Admin()
@Controller('admin')
export class AdminController {
  constructor(@Inject(Db) private db: Db) {}
  @Get('dashboard') async dashboard() {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const today = new Date(`${day}T00:00:00+05:30`);
    const [
      todayOrders,
      sales,
      pendingOrders,
      pendingPayments,
      pendingDeliveries,
      bulkRequests,
      lowStock,
      recentOrders,
    ] = await Promise.all([
      this.db.order.count({ where: { createdAt: { gte: today } } }),
      this.db.financialMovement.aggregate({
        where: { kind: 'COLLECTION', occurredAt: { gte: today } },
        _sum: { amountPaise: true },
      }),
      this.db.order.count({ where: { status: { in: ['CONFIRMED', 'PREPARING'] } } }),
      this.db.payment.count({
        where: { status: 'PENDING', order: { status: { notIn: ['CANCELLED', 'REFUNDED'] } } },
      }),
      this.db.order.count({ where: { status: 'OUT_FOR_DELIVERY' } }),
      this.db.quote.count({ where: { status: 'REQUESTED' } }),
      this.db.product.findMany({
        // Each product has its own "running low" level.
        where: { active: true, stock: { lte: this.db.product.fields.lowStockAt } },
        orderBy: { stock: 'asc' },
        take: 20,
      }),
      this.db.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { ...orderInclude, user: true },
      }),
    ]);
    const [counter, refunds, newWork, issues] = await Promise.all([
      this.db.financialMovement.aggregate({
        where: { kind: 'COUNTER_SALE', occurredAt: { gte: today } },
        _sum: { amountPaise: true },
      }),
      this.db.financialMovement.aggregate({
        where: { kind: 'REFUND', occurredAt: { gte: today } },
        _sum: { amountPaise: true },
      }),
      this.db.ownerWork.count({
        where: {
          acknowledgedAt: null,
          order: { status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
        },
      }),
      this.db.order.count({ where: { status: { in: ['DELIVERY_EXCEPTION', 'REFUND_PENDING'] } } }),
    ]);
    return {
      newWork,
      issues,
      todayCounterSalesPaise: counter._sum.amountPaise || 0,
      todayRefundsPaise: refunds._sum.amountPaise || 0,
      profitPaise: null,
      todayOrders,
      todaySalesPaise: sales._sum.amountPaise || 0,
      pendingOrders,
      pendingPayments,
      pendingDeliveries,
      bulkRequests,
      lowStock,
      recentOrders,
    };
  }
  @Get('customers') async customers(@Query() query: Record<string, string>) {
    const page = paginate(query, 'customers');
    return page.finish(
      await this.db.user.findMany({
        // Shop staff are listed on the Staff screen, not as customers.
        where: { deletedAt: null, role: { not: 'ADMIN' }, ...page.after },
        select: {
          id: true,
          name: true,
          phone: true,
          role: true,
          contractorStatus: true,
          createdAt: true,
          _count: { select: { orders: true, quotes: true } },
        },
        orderBy: page.orderBy,
        take: page.take,
      }),
    );
  }
  @Get('customers/:id') async customer(@Param('id') id: string) {
    const user = await this.db.user.findUnique({
      where: { id },
      include: {
        addresses: true,
        orders: { orderBy: { createdAt: 'desc' }, take: 5 },
        _count: { select: { orders: true } },
      },
    });
    if (!user) fail('NOT_FOUND', 'Customer not found.', 404);
    return user;
  }
  @Get('audit') async audit(@Query() query: Record<string, string>) {
    const page = paginate(query, 'audit');
    const rows = await this.db.auditLog.findMany({
      where: page.after,
      orderBy: page.orderBy,
      take: page.take,
    });
    // Names instead of IDs, so the activity log reads in plain language.
    const ids = [...new Set(rows.flatMap((row) => [row.actorId, row.entityId]))];
    const [users, orders, quotes, products] = await Promise.all([
      this.db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, role: true },
      }),
      this.db.order.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } }),
      this.db.quote.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } }),
      this.db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ]);
    const labels = new Map<string, string>([
      ...users.map((u) => [u.id, u.name || (u.role === 'ADMIN' ? 'Staff' : 'Customer')] as const),
      ...orders.map((o) => [o.id, o.number] as const),
      ...quotes.map((q) => [q.id, q.number] as const),
      ...products.map((p) => [p.id, p.name] as const),
    ]);
    return page.finish(
      rows.map((row) => ({
        ...row,
        actorName: labels.get(row.actorId) || (row.actorId === 'seed' ? 'Setup' : ''),
        entityLabel: labels.get(row.entityId) || '',
      })),
    );
  }
}
