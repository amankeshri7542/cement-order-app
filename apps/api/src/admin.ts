import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Db } from './db';
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
      this.db.payment.aggregate({
        where: { status: 'CAPTURED', updatedAt: { gte: today } },
        _sum: { amountPaise: true },
      }),
      this.db.order.count({ where: { status: { in: ['CONFIRMED', 'PREPARING'] } } }),
      this.db.payment.count({
        where: { status: 'PENDING', order: { status: { notIn: ['CANCELLED', 'REFUNDED'] } } },
      }),
      this.db.order.count({ where: { status: 'OUT_FOR_DELIVERY' } }),
      this.db.quote.count({ where: { status: 'REQUESTED' } }),
      this.db.product.findMany({
        where: { active: true, stock: { lt: 25 } },
        orderBy: { stock: 'asc' },
        take: 20,
      }),
      this.db.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { user: true, payment: true, items: true },
      }),
    ]);
    return {
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
  @Get('customers') customers() {
    return this.db.user.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        createdAt: true,
        _count: { select: { orders: true, quotes: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }
  @Get('customers/:id') async customer(@Param('id') id: string) {
    const user = await this.db.user.findUnique({
      where: { id },
      include: {
        addresses: true,
        orders: { orderBy: { createdAt: 'desc' }, take: 100 },
        _count: { select: { orders: true } },
      },
    });
    if (!user) fail('NOT_FOUND', 'Customer not found.', 404);
    return user;
  }
  @Get('audit') audit() {
    return this.db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }
}
