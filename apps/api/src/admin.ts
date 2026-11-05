import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { paginate } from './pagination';
import { Db } from './db';
import { blindShops } from './blind-count';
import { orderInclude, orderPerson } from './orders';
import { AuthRequest, Can, fail, forbid, scoped, shopAsked, shopWhere } from './http';
import { canDo } from '@shiv/shared';
import { shownPhone, withShownPhones } from './crm/common';
import { z } from 'zod';

/** The activity log's filters. A repeated or nested value is refused rather than guessed at. */
const auditFilter = z.object({
  actorId: z.string().trim().min(1).max(100).optional(),
  locationId: z.string().trim().min(1).max(100).optional(),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value);
    })
    .optional(),
});
/** Who acts when no person does. The desk gives each of these a name. */
const machineActors = ['system', 'whatsapp', 'website', 'razorpay', 'seed'];
/**
 * A moment for a raw query. Columns hold UTC with no zone, and a Date sent as it is gets compared
 * in the database session's zone, so on a server not set to UTC every comparison would be hours out.
 */
const moment = (date: Date) => Prisma.sql`${date.toISOString()}::text::timestamp`;

@ApiTags('Store administration')
@Controller('admin')
export class AdminController {
  constructor(@Inject(Db) private db: Db) {}
  @Can('dashboard.read', scoped) @Get('dashboard') async dashboard(@Req() req: AuthRequest) {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const today = new Date(`${day}T00:00:00+05:30`);
    const shop = shopAsked(req, 'dashboard.read', req.query.locationId);
    const blind = await blindShops(this.db, req.access);
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
      this.db.order.count({ where: { createdAt: { gte: today }, ...shop } }),
      this.db.financialMovement.aggregate({
        where: {
          kind: { in: ['COLLECTION', 'KHATA_PAYMENT', 'HANDOVER_OVER'] },
          occurredAt: { gte: today },
          ...shop,
        },
        _sum: { amountPaise: true },
      }),
      this.db.order.count({
        where: { status: { in: ['AWAITING_CONFIRMATION', 'CONFIRMED', 'PREPARING'] }, ...shop },
      }),
      this.db.payment.count({
        where: {
          status: 'PENDING',
          method: { not: 'CREDIT' },
          order: { status: { notIn: ['CANCELLED', 'REFUNDED'] }, ...shop },
        },
      }),
      this.db.order.count({ where: { status: 'OUT_FOR_DELIVERY', ...shop } }),
      this.db.quote.count({ where: { status: 'REQUESTED', ...shop } }),
      // One figure per shop for anyone limited to shops or being kept from one being counted. The
      // firm's total would tell them what no screen of theirs should.
      'locationId' in shop || blind.size
        ? this.db.stockLevel
            .findMany({
              where: {
                AND: [shop, { locationId: { notIn: [...blind] } }],
                quantity: { lte: this.db.stockLevel.fields.lowStockAt },
                product: { active: true },
              },
              orderBy: { quantity: 'asc' },
              take: 20,
              select: {
                locationId: true,
                quantity: true,
                lowStockAt: true,
                product: { select: { id: true, name: true, unit: true } },
              },
            })
            .then((rows) =>
              rows.map(({ product, quantity, ...level }) => ({
                ...product,
                ...level,
                stock: quantity,
              })),
            )
        : this.db.product.findMany({
            // Each product has its own "running low" level.
            where: { active: true, stock: { lte: this.db.product.fields.lowStockAt } },
            orderBy: { stock: 'asc' },
            take: 20,
          }),
      this.db.order.findMany({
        where: shop,
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { ...orderInclude, user: { select: orderPerson } },
      }),
    ]);
    const [counter, refunds, newWork, issues, short] = await Promise.all([
      this.db.financialMovement.aggregate({
        where: { kind: 'COUNTER_SALE', occurredAt: { gte: today }, ...shop },
        _sum: { amountPaise: true },
      }),
      this.db.financialMovement.aggregate({
        where: {
          kind: { in: ['REFUND', 'KHATA_PAYMENT_REVERSAL'] },
          occurredAt: { gte: today },
          ...shop,
        },
        _sum: { amountPaise: true },
      }),
      this.db.ownerWork.count({
        where: {
          acknowledgedAt: null,
          order: {
            status: { in: ['AWAITING_CONFIRMATION', 'CONFIRMED', 'PENDING_PAYMENT'] },
            ...shop,
          },
        },
      }),
      this.db.order.count({
        where: { status: { in: ['DELIVERY_EXCEPTION', 'REFUND_PENDING'] }, ...shop },
      }),
      // A driver's count that came up short never reached the drawer.
      this.db.financialMovement.aggregate({
        where: { kind: 'HANDOVER_SHORT', occurredAt: { gte: today }, ...shop },
        _sum: { amountPaise: true },
      }),
    ]);
    const [khataDue, creditSales, todayPhoneOrders] = await Promise.all([
      this.db.user.aggregate({
        // The whole firm's udhaar total is only for those who may read the udhaar list.
        where: {
          deletedAt: null,
          role: { not: 'ADMIN' },
          khataBalancePaise: { gt: 0 },
          ...(req.access['khata.read.list'] ? {} : { id: '' }),
        },
        _sum: { khataBalancePaise: true },
      }),
      this.db.customerLedgerEntry.aggregate({
        where: {
          occurredAt: { gte: today },
          ...shop,
          OR: [
            { kind: 'SALE_ON_CREDIT' },
            { kind: 'REVERSAL', reverses: { kind: 'SALE_ON_CREDIT' } },
          ],
        },
        _sum: { amountPaise: true },
      }),
      this.db.order.count({
        where: {
          source: { in: ['PHONE', 'WALK_IN', 'WHATSAPP'] },
          createdAt: { gte: today },
          ...shop,
        },
      }),
    ]);
    return {
      khataDuePaise: khataDue._sum.khataBalancePaise ?? 0,
      todayCreditSalesPaise: creditSales._sum.amountPaise ?? 0,
      todayPhoneOrders,
      newWork,
      issues,
      todayCounterSalesPaise: counter._sum.amountPaise || 0,
      todayRefundsPaise: refunds._sum.amountPaise || 0,
      profitPaise: null,
      todayOrders,
      todaySalesPaise: (sales._sum.amountPaise || 0) - (short._sum.amountPaise || 0),
      pendingOrders,
      pendingPayments,
      pendingDeliveries,
      bulkRequests,
      lowStock,
      recentOrders: recentOrders.map((row) => withShownPhones(req, row)),
    };
  }
  @Can('customers.read') @Get('customers') async customers(
    @Query() query: Record<string, string>,
    @Req() req: AuthRequest,
  ) {
    const parsed = z
      .object({
        q: z.string().trim().max(100).default(''),
        sort: z.enum(['recent', 'due']).default('recent'),
      })
      .safeParse(query);
    if (!parsed.success) fail('INVALID_FILTER', 'Check customer filters.');
    const { q, sort } = parsed.data;
    // Who owes what, across everyone, is the udhaar list. Without that right, a balance comes only
    // for the one customer whose full number was asked for.
    const seesAll = !!req.access['khata.read.list'];
    if (sort === 'due' && !seesAll) forbid(req, 'khata.read.list');
    const showBalance = seesAll || /^\+91[6-9]\d{9}$/.test(q);
    // Part of a number is a way to discover numbers, for anyone who may not see them.
    const seesPhone = canDo(req.access, 'customers.phone.read');
    const searched =
      seesPhone || /^\+91[6-9]\d{9}$/.test(q) ? ['name', 'phone', 'area'] : ['name', 'area'];
    const page = paginate(
      query,
      JSON.stringify({ list: 'customers', q, sort }),
      sort === 'due' ? 'khataBalancePaise' : 'createdAt',
    );
    // The accountant knows people by their Tally names. Only those who may see Tally search by them.
    const byLedger =
      q && req.access['tally.read']
        ? await this.db.tallyPartyLink.findMany({
            where: {
              status: 'LINKED',
              ledger: { name: { contains: q, mode: 'insensitive' }, deletedAt: null },
            },
            select: { userId: true },
            take: 50,
          })
        : [];
    const result = page.finish(
      await this.db.user.findMany({
        where: {
          deletedAt: null,
          role: { not: 'ADMIN' },
          phone: { not: 'walk-in:store' },
          AND: [
            page.after,
            q
              ? {
                  OR: [
                    ...searched.map((field) => ({
                      [field]: { contains: q, mode: 'insensitive' as const },
                    })),
                    { id: { in: byLedger.flatMap((row) => (row.userId ? [row.userId] : [])) } },
                  ],
                }
              : {},
          ],
        },
        select: {
          id: true,
          name: true,
          phone: true,
          role: true,
          contractorStatus: true,
          createdAt: true,
          khataBalancePaise: true,
          creditAllowed: true,
          creditLimitPaise: true,
          area: true,
          tags: true,
          lastOrderAt: true,
          notesCount: true,
          _count: { select: { orders: true, quotes: true } },
        },
        orderBy: page.orderBy,
        take: page.take,
      }),
    );
    return {
      ...result,
      items: result.items.map(({ khataBalancePaise, creditLimitPaise, phone, ...rest }) => {
        const customer = { ...rest, phone: shownPhone(req, phone) };
        return showBalance
          ? { ...customer, khataBalancePaise, creditLimitPaise, balancePaise: khataBalancePaise }
          : customer;
      }),
    };
  }
  @Can('customers.read') @Get('customers/:id') async customer(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    // Staff are not customers, and a shop's people see that shop's orders.
    const user = await this.db.user.findFirst({
      where: { id, role: { not: 'ADMIN' } },
      include: {
        addresses: true,
        orders: { where: shopWhere(req, 'orders.read'), orderBy: { createdAt: 'desc' }, take: 5 },
        _count: { select: { orders: true } },
      },
    });
    if (!user) fail('NOT_FOUND', 'Customer not found.', 404);
    // Their number, on their addresses and on their orders, is for those who may hold it.
    return {
      ...user,
      phone: shownPhone(req, user.phone),
      addresses: user.addresses.map((row) => ({ ...row, phone: shownPhone(req, row.phone) })),
      orders: user.orders.map((row) => {
        const address = row.address as { phone?: string } | null;
        return address?.phone
          ? { ...row, address: { ...address, phone: shownPhone(req, address.phone) } }
          : row;
      }),
      balancePaise: user.khataBalancePaise,
    };
  }
  @Can('audit.read') @Get('audit') async audit(
    @Query() query: Record<string, unknown>,
    @Req() req: AuthRequest,
  ) {
    const parsed = auditFilter.safeParse(query);
    if (!parsed.success) fail('INVALID_FILTER', 'Check the filters.');
    const { actorId, locationId, day } = parsed.data;
    const asked = shopAsked(req, 'audit.read', locationId).locationId;
    const shops = typeof asked === 'string' ? [asked] : asked?.in;
    const page = paginate(query, JSON.stringify({ list: 'audit', actorId, locationId, day }));
    const when = day
      ? {
          gte: new Date(`${day}T00:00:00+05:30`),
          lt: new Date(new Date(`${day}T00:00:00+05:30`).getTime() + 86400000),
        }
      : undefined;
    const rows = await this.db.auditLog.findMany({
      where: shops
        ? { id: { in: await this.auditIdsAt(shops, query.cursor, page.take, actorId, when) } }
        : {
            AND: [page.after, actorId ? { actorId } : {}, when ? { createdAt: when } : {}],
          },
      orderBy: page.orderBy,
      take: page.take,
    });
    // Names instead of IDs, so the activity log reads in plain language.
    const ids = [...new Set(rows.flatMap((row) => [row.actorId, row.entityId]))];
    const customer = { select: { name: true } };
    const [users, orders, quotes, products] = await Promise.all([
      this.db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, role: true },
      }),
      this.db.order.findMany({
        where: { id: { in: ids } },
        select: { id: true, number: true, locationId: true, user: customer },
      }),
      this.db.quote.findMany({
        where: { id: { in: ids } },
        select: { id: true, number: true, locationId: true, user: customer },
      }),
      this.db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ]);
    const labels = new Map<string, string>([
      ...users.map((u) => [u.id, u.name || (u.role === 'ADMIN' ? 'Staff' : 'Customer')] as const),
      ...orders.map((o) => [o.id, o.number] as const),
      ...quotes.map((q) => [q.id, q.number] as const),
      ...products.map((p) => [p.id, p.name] as const),
    ]);
    const sold = new Map([...orders, ...quotes].map((row) => [row.id, row]));
    // Older events carry no shop of their own, but the order or list they are about does.
    const shopOf = (row: { locationId: string | null; entityId: string }) =>
      row.locationId ?? sold.get(row.entityId)?.locationId ?? null;
    const shopIds = [...new Set(rows.map(shopOf).filter((id): id is string => !!id))];
    const names = new Map(
      (
        await this.db.location.findMany({
          where: { id: { in: shopIds } },
          select: { id: true, name: true },
        })
      ).map((shop) => [shop.id, shop.name]),
    );
    return page.finish(
      rows.map((row) => ({
        ...row,
        actorName:
          labels.get(row.actorId) ||
          (row.actorId === 'seed'
            ? 'Setup'
            : row.actorId.startsWith('bridge:')
              ? 'Tally computer'
              : ''),
        entityLabel: labels.get(row.entityId) || '',
        customerName: sold.get(row.entityId)?.user.name ?? '',
        shopName: names.get(shopOf(row) ?? '') ?? '',
      })),
    );
  }

  /** Staff and the machines that have acted, for the activity log's person filter. Former staff stay. */
  @Can('audit.read') @Get('audit/people') async auditPeople() {
    const [staff, machines] = await Promise.all([
      this.db.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.db.auditLog.findMany({
        where: { actorId: { in: machineActors } },
        distinct: ['actorId'],
        select: { actorId: true },
      }),
    ]);
    return { staff, machines: machines.map((row) => row.actorId) };
  }

  /**
   * One page of the log at these shops, newest first. An event belongs to a shop by its own shop,
   * or, when it has none, by the order or list it is about. The cursor is already checked by
   * paginate. Prisma cannot join AuditLog to orders, hence the query.
   */
  private async auditIdsAt(
    shops: string[],
    cursor: unknown,
    take: number,
    actorId?: string,
    when?: { gte: Date; lt: Date },
  ) {
    const after =
      typeof cursor === 'string'
        ? (JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { value: string; id: string })
        : null;
    const conditions = [
      Prisma.sql`(a."locationId" = ANY(${shops}) OR (a."locationId" IS NULL AND (
        EXISTS (SELECT 1 FROM "Order" o WHERE o.id = a."entityId" AND o."locationId" = ANY(${shops}))
        OR EXISTS (SELECT 1 FROM "Quote" q WHERE q.id = a."entityId" AND q."locationId" = ANY(${shops}))
      )))`,
      ...(actorId ? [Prisma.sql`a."actorId" = ${actorId}`] : []),
      ...(when
        ? [Prisma.sql`a."createdAt" >= ${moment(when.gte)} AND a."createdAt" < ${moment(when.lt)}`]
        : []),
      ...(after
        ? [
            Prisma.sql`(a."createdAt" < ${moment(new Date(after.value))}
              OR (a."createdAt" = ${moment(new Date(after.value))} AND a.id < ${after.id}))`,
          ]
        : []),
    ];
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM "AuditLog" a WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY a."createdAt" DESC, a.id DESC LIMIT ${take}`;
    return rows.map((row) => row.id);
  }
}
