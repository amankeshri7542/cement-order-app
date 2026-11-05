import { Controller, Get, Inject, Injectable, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import {
  customerGroupSchema,
  customerGroupSetSchema,
  deliveryRateSchema,
  istToday,
  personRateCapSchema,
  priceRuleSchema,
  ratesAskSchema,
  ratesPublishSchema,
} from '@shiv/shared';
import { z } from 'zod';
import { ApprovalsService, askApproval } from './approvals';
import { Events } from './catalog';
import { Db } from './db';
import { atOrder, AuthRequest, Can, Contract, fail, Input, Public, Self } from './http';
import { activeRules, bigChange, priceFor } from './price-rules';

type Tx = Prisma.TransactionClient;
type Rates = z.infer<typeof ratesPublishSchema>;

@Injectable()
export class PricingService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Events) private events: Events,
    @Inject(ApprovalsService) approvals: ApprovalsService,
  ) {
    approvals.publishRates = (tx, payload, actorId) =>
      this.publishIn(
        tx,
        ratesPublishSchema.parse({
          ...(payload as object),
          // An owner read the request before saying yes.
          bigChangesChecked: true,
        }),
        actorId,
      );
  }

  /** One publish, one audit event, every rate live together. */
  async publishIn(tx: Tx, body: Rates, actorId: string) {
    const changed: { productId: string; priceVersion: number }[] = [];
    const now = new Date();
    const lines: { productId: string; from: number; to: number }[] = [];
    const big: string[] = [];
    for (const rate of body.rates) {
      const old = await tx.product.findUnique({ where: { id: rate.productId } });
      if (!old) fail('NOT_FOUND', 'One of those products is unavailable.', 404);
      if (old.version !== rate.expectedVersion)
        fail('CONFLICT', 'A rate changed. Refresh before saving.', 409, { productId: old.id });
      if (old.pricePaise === rate.pricePaise) continue;
      if (bigChange(old.pricePaise, rate.pricePaise)) big.push(old.id);
      const product = await tx.product.update({
        where: { id: old.id },
        data: {
          pricePaise: rate.pricePaise,
          version: { increment: 1 },
          priceVersion: { increment: 1 },
          priceUpdatedAt: now,
          priceCheckedAt: now,
        },
      });
      await tx.productPriceHistory.create({
        data: {
          productId: old.id,
          oldPricePaise: old.pricePaise,
          newPricePaise: rate.pricePaise,
          version: product.priceVersion,
          actorId,
        },
      });
      lines.push({ productId: old.id, from: old.pricePaise, to: rate.pricePaise });
      changed.push({ productId: old.id, priceVersion: product.priceVersion });
    }
    if (big.length && !body.bigChangesChecked)
      fail('BIG_RATE_CHANGE', 'Some rates moved a lot. Check the digits and confirm.', 409, {
        productIds: big,
      });
    await tx.auditLog.create({
      data: {
        actorId,
        event: 'RATES_PUBLISHED',
        entityId: 'rates',
        details: { lines },
      },
    });
    return changed;
  }

  async publish(body: Rates, actorId: string) {
    const changed = await this.db.atomic((tx) => this.publishIn(tx, body, actorId));
    for (const row of changed)
      this.events.publish({
        type: 'PRODUCT_PRICE_UPDATED',
        productId: row.productId,
        priceVersion: row.priceVersion,
      });
    return { changed: changed.length };
  }

  /** "Rate wahi hain": someone looked today, and nothing needs changing. */
  async reaffirm(actorId: string) {
    const now = new Date();
    await this.db.atomic(async (tx) => {
      await tx.product.updateMany({ where: { active: true }, data: { priceCheckedAt: now } });
      await tx.auditLog.create({
        data: { actorId, event: 'RATES_REAFFIRMED', entityId: 'rates', details: {} },
      });
    });
    return { checkedAt: now };
  }

  async rules(tx: Tx | Db = this.db) {
    return tx.priceRule.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        product: { select: { name: true } },
        category: { select: { name: true } },
        group: { select: { name: true } },
      },
    });
  }

  private async checkTargets(tx: Tx, rule: z.infer<typeof priceRuleSchema>) {
    if (rule.productId && !(await tx.product.findUnique({ where: { id: rule.productId } })))
      fail('NOT_FOUND', 'That product is not on the list.', 404);
    if (rule.categoryId && !(await tx.category.findUnique({ where: { id: rule.categoryId } })))
      fail('NOT_FOUND', 'That category is not on the list.', 404);
    if (rule.groupId && !(await tx.customerGroup.findUnique({ where: { id: rule.groupId } })))
      fail('NOT_FOUND', 'That group is not on the list.', 404);
    if (rule.customerId) {
      const customer = await tx.user.findUnique({
        where: { id: rule.customerId },
        select: { role: true, deletedAt: true },
      });
      if (!customer || customer.role !== 'CUSTOMER' || customer.deletedAt)
        fail('NOT_FOUND', 'That customer is not on the list.', 404);
    }
  }

  /** An amount off bigger than a rate would make it nothing, so it is refused on saving. */
  private async checkNotFree(tx: Tx, body: z.infer<typeof priceRuleSchema>) {
    if (body.valueType !== 'AMOUNT_OFF') return;
    const lowest = await tx.product.findFirst({
      where: {
        active: true,
        pricePaise: { lte: body.value },
        ...(body.productId ? { id: body.productId } : {}),
        ...(body.categoryId ? { categoryId: body.categoryId } : {}),
      },
      select: { id: true, name: true },
    });
    if (lowest)
      fail('RULE_TOO_BIG', 'This much off is more than the rate of an item it covers.', 400, {
        productId: lowest.id,
        name: lowest.name,
      });
  }

  async saveRule(id: string | null, body: z.infer<typeof priceRuleSchema>, actorId: string) {
    const { expectedVersion, ...rule } = body;
    return this.db.atomic(async (tx) => {
      await this.checkTargets(tx, body);
      await this.checkNotFree(tx, body);
      let saved;
      if (id) {
        const old = await tx.priceRule.findUnique({ where: { id } });
        if (!old) fail('NOT_FOUND', 'That rule is not here.', 404);
        if (old.version !== expectedVersion)
          fail('RULE_CHANGED', 'This rule changed. Look at it again.', 409);
        saved = await tx.priceRule.update({
          where: { id },
          data: { ...rule, version: { increment: 1 } },
        });
      } else saved = await tx.priceRule.create({ data: { ...rule, createdById: actorId } });
      await tx.auditLog.create({
        data: {
          actorId,
          event: id ? 'PRICE_RULE_CHANGED' : 'PRICE_RULE_ADDED',
          entityId: saved.id,
          details: {
            kind: rule.kind,
            productId: rule.productId,
            categoryId: rule.categoryId,
            minQuantity: rule.minQuantity,
            valueType: rule.valueType,
            value: rule.value,
            startsOn: rule.startsOn,
            endsOn: rule.endsOn,
            active: rule.active,
          },
        },
      });
      return saved;
    });
  }
}

@ApiTags('Daam aur offer')
@Controller()
export class PricingController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(PricingService) private pricing: PricingService,
  ) {}

  // ---- Aaj ke rate ----------------------------------------------------------------------------
  @Can('rates.read') @Get('admin/rates') async rates() {
    const products = await this.db.product.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        brand: true,
        unit: true,
        version: true,
        pricePaise: true,
        priceUpdatedAt: true,
        priceCheckedAt: true,
        categoryId: true,
        category: { select: { name: true } },
      },
      orderBy: [{ categoryId: 'asc' }, { brand: 'asc' }, { name: 'asc' }],
      take: 500,
    });
    const latest = products.reduce<Date | null>((last, row) => {
      const seen = row.priceCheckedAt ?? row.priceUpdatedAt;
      return !last || seen > last ? seen : last;
    }, null);
    return { items: products, checkedAt: latest };
  }
  @Can('rates.read') @Get('admin/rates/:id/history') history(@Param('id') id: string) {
    return this.db.productPriceHistory.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
  }
  @Can('rates.publish')
  @Post('admin/rates/publish')
  @Contract(ratesPublishSchema)
  publish(
    @Input(ratesPublishSchema) body: z.infer<typeof ratesPublishSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.pricing.publish(body, req.user.id);
  }
  @Can('rates.publish') @Post('admin/rates/reaffirm') reaffirm(@Req() req: AuthRequest) {
    return this.pricing.reaffirm(req.user.id);
  }
  /** A manager asks. Their rates go live only when an owner says yes. */
  @Can('rates.ask')
  @Post('admin/rates/ask')
  @Contract(ratesAskSchema)
  ask(@Input(ratesAskSchema) body: z.infer<typeof ratesAskSchema>, @Req() req: AuthRequest) {
    const { idempotencyKey, ...rates } = body;
    return this.db.atomic((tx) =>
      askApproval(tx, {
        kind: 'RATE_CHANGE',
        locationId: null,
        amountPaise: null,
        payload: rates as unknown as Prisma.InputJsonValue,
        requestedById: req.user.id,
        idempotencyKey: `rates:${idempotencyKey}`,
        ...(body.note ? { note: body.note } : {}),
      }),
    );
  }

  // ---- Slabs, group and special rates, offers -------------------------------------------------
  @Can('pricing.edit') @Get('admin/pricing/rules') rules() {
    return this.pricing.rules();
  }
  @Can('pricing.edit')
  @Post('admin/pricing/rules')
  @Contract(priceRuleSchema)
  addRule(@Input(priceRuleSchema) body: z.infer<typeof priceRuleSchema>, @Req() req: AuthRequest) {
    return this.pricing.saveRule(null, body, req.user.id);
  }
  @Can('pricing.edit')
  @Patch('admin/pricing/rules/:id')
  @Contract(priceRuleSchema)
  changeRule(
    @Param('id') id: string,
    @Input(priceRuleSchema) body: z.infer<typeof priceRuleSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.pricing.saveRule(id, body, req.user.id);
  }

  // ---- Customer groups ------------------------------------------------------------------------
  @Can('pricing.edit') @Get('admin/pricing/groups') async groups() {
    const groups = await this.db.customerGroup.findMany({
      include: { _count: { select: { customers: true } } },
      orderBy: { name: 'asc' },
    });
    return groups.map(({ _count, ...group }) => ({ ...group, customers: _count.customers }));
  }
  private async saveGroup(
    id: string | null,
    body: z.infer<typeof customerGroupSchema>,
    actor: string,
  ) {
    return this.db.atomic(async (tx) => {
      const same = await tx.customerGroup.findUnique({ where: { name: body.name } });
      if (same && same.id !== id)
        fail('GROUP_TAKEN', 'A group with this name already exists.', 409);
      if (id && !(await tx.customerGroup.findUnique({ where: { id } })))
        fail('NOT_FOUND', 'That group is not here.', 404);
      const group = id
        ? await tx.customerGroup.update({ where: { id }, data: body })
        : await tx.customerGroup.create({ data: { ...body, createdById: actor } });
      await tx.auditLog.create({
        data: {
          actorId: actor,
          event: 'CUSTOMER_GROUP_SAVED',
          entityId: group.id,
          details: { name: group.name, active: group.active },
        },
      });
      return group;
    });
  }
  @Can('pricing.edit')
  @Post('admin/pricing/groups')
  @Contract(customerGroupSchema)
  addGroup(
    @Input(customerGroupSchema) body: z.infer<typeof customerGroupSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.saveGroup(null, body, req.user.id);
  }
  @Can('pricing.edit')
  @Patch('admin/pricing/groups/:id')
  @Contract(customerGroupSchema)
  changeGroup(
    @Param('id') id: string,
    @Input(customerGroupSchema) body: z.infer<typeof customerGroupSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.saveGroup(id, body, req.user.id);
  }
  /** A person moves a customer. The system only ever suggests. */
  @Can('pricing.edit')
  @Put('admin/pricing/customers/:id/group')
  @Contract(customerGroupSetSchema)
  async setGroup(
    @Param('id') id: string,
    @Input(customerGroupSetSchema) body: z.infer<typeof customerGroupSetSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const customer = await tx.user.findUnique({ where: { id } });
      if (!customer || customer.role !== 'CUSTOMER' || customer.deletedAt)
        fail('NOT_FOUND', 'That customer is not on the list.', 404);
      if (body.groupId) {
        const group = await tx.customerGroup.findUnique({ where: { id: body.groupId } });
        if (!group?.active) fail('NOT_FOUND', 'That group is not on the list.', 404);
      }
      await tx.user.update({ where: { id }, data: { customerGroupId: body.groupId } });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'CUSTOMER_GROUP_SET',
          entityId: id,
          details: { groupId: body.groupId },
        },
      });
      return { id, groupId: body.groupId };
    });
  }
  /** Who has been ordering regularly, for an owner to decide. It never moves anyone by itself. */
  @Can('pricing.edit') @Get('admin/pricing/suggestions') async suggestions() {
    const rows = await this.db.order.groupBy({
      by: ['userId'],
      where: {
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
        user: { customerGroupId: null, role: 'CUSTOMER' },
      },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
      having: { userId: { _count: { gte: 3 } } },
      orderBy: { _count: { userId: 'desc' } },
      take: 50,
    });
    const people = await this.db.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
      select: { id: true, name: true, phone: true },
    });
    return rows.map((row) => ({
      customerId: row.userId,
      name: people.find((person) => person.id === row.userId)?.name ?? '',
      phone: people.find((person) => person.id === row.userId)?.phone ?? '',
      orders: row._count._all,
      firstOrderAt: row._min.createdAt,
      lastOrderAt: row._max.createdAt,
    }));
  }

  // ---- Bhada ---------------------------------------------------------------------------------
  @Can('delivery.read') @Get('admin/pricing/delivery-rates') deliveryRates() {
    return this.db.deliveryRate.findMany({ orderBy: [{ zoneId: 'asc' }, { vehicle: 'asc' }] });
  }
  @Can('delivery.edit')
  @Put('admin/pricing/delivery-rates')
  @Contract(deliveryRateSchema)
  saveDeliveryRate(
    @Input(deliveryRateSchema) body: z.infer<typeof deliveryRateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      if (!(await tx.deliveryZone.findUnique({ where: { id: body.zoneId } })))
        fail('NOT_FOUND', 'That area is not on the list.', 404);
      const rate = await tx.deliveryRate.upsert({
        where: { zoneId_vehicle: { zoneId: body.zoneId, vehicle: body.vehicle } },
        create: body,
        update: { feePaise: body.feePaise, active: body.active },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'DELIVERY_RATE_SAVED',
          entityId: rate.id,
          details: { zoneId: body.zoneId, feePaise: body.feePaise, active: body.active },
        },
      });
      return rate;
    });
  }
  /** Bhada to suggest on a card, from the order's own area. Only a person picks it. */
  @Can('orders.confirm', atOrder()) @Get('admin/inbox/:id/bhada') async bhada(
    @Param('id') id: string,
  ) {
    const order = await this.db.order.findUnique({
      where: { id },
      select: { address: true },
    });
    const pincode = (order?.address as { pincode?: string } | null)?.pincode ?? '';
    const entry = pincode
      ? await this.db.deliveryPincode.findUnique({ where: { pincode }, select: { zoneId: true } })
      : null;
    if (!entry) return { items: [] };
    return {
      items: await this.db.deliveryRate.findMany({
        where: { zoneId: entry.zoneId, active: true },
        select: { vehicle: true, feePaise: true },
        orderBy: { feePaise: 'asc' },
      }),
    };
  }

  // ---- Limits -------------------------------------------------------------------------------
  @Can('pricing.edit') @Get('admin/pricing/limits') async limits() {
    const [shops, people, store] = await Promise.all([
      this.db.location.findMany({
        where: { active: true },
        select: { id: true, name: true, managerRateCapPercent: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.user.findMany({
        where: {
          role: 'ADMIN',
          deletedAt: null,
          staffMemberships: { some: { role: 'MANAGER', endedAt: null } },
        },
        select: {
          id: true,
          name: true,
          rateCapPercent: true,
          staffMemberships: {
            where: { role: 'MANAGER', endedAt: null },
            select: { locationId: true },
          },
        },
      }),
      this.db.storeSettings.findUnique({
        where: { id: 'store' },
        select: { onlinePaymentsEnabled: true },
      }),
    ]);
    return {
      shops,
      people: people.map((person) => ({
        id: person.id,
        name: person.name,
        rateCapPercent: person.rateCapPercent,
        shopIds: person.staffMemberships.map((row) => row.locationId),
      })),
      onlinePaymentsEnabled: store?.onlinePaymentsEnabled ?? false,
    };
  }
  @Can('pricing.edit')
  @Put('admin/pricing/people/:id/rate-cap')
  @Contract(personRateCapSchema)
  async personCap(
    @Param('id') id: string,
    @Input(personRateCapSchema) body: z.infer<typeof personRateCapSchema>,
    @Req() req: AuthRequest,
  ) {
    if (id === req.user.id) fail('FORBIDDEN', 'Nobody sets their own limit.', 403);
    return this.db.atomic(async (tx) => {
      const person = await tx.user.findUnique({ where: { id }, select: { role: true } });
      if (person?.role !== 'ADMIN') fail('NOT_FOUND', 'That person is not on the staff.', 404);
      await tx.user.update({ where: { id }, data: { rateCapPercent: body.rateCapPercent } });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'RATE_CAP_CHANGED',
          entityId: id,
          details: { rateCapPercent: body.rateCapPercent },
        },
      });
      return { id, rateCapPercent: body.rateCapPercent };
    });
  }

  // ---- What customers and the public may see --------------------------------------------------
  /** A signed-in customer's own rates. Only theirs, and never how the rule was set. */
  @Self() @Get('me/rates') async myRates(@Req() req: AuthRequest) {
    const [buyer, products, rules] = await Promise.all([
      this.db.user.findUniqueOrThrow({
        where: { id: req.user.id },
        select: { customerGroupId: true },
      }),
      this.db.product.findMany({
        // An item with no public rate has none here either: it is the shop's to give.
        where: { active: true, sourcing: { not: 'ON_REQUEST' } },
        select: { id: true, categoryId: true, pricePaise: true, minQuantity: true },
        take: 500,
      }),
      activeRules(this.db),
    ]);
    return products.map((product) => ({
      productId: product.id,
      listPaise: product.pricePaise,
      yourPaise: priceFor(product, product.minQuantity, req.user.id, buyer.customerGroupId, rules)
        .pricePaise,
    }));
  }
  /** Offers the owners chose to show. Nothing about any customer or group. */
  @Public() @Get('public/offers') async offers() {
    const today = istToday();
    const rows = await this.db.priceRule.findMany({
      where: {
        kind: 'OFFER',
        active: true,
        isPublic: true,
        startsOn: { lte: today },
        endsOn: { gte: today },
      },
      select: {
        title: true,
        productId: true,
        categoryId: true,
        minQuantity: true,
        valueType: true,
        value: true,
        endsOn: true,
      },
      take: 50,
    });
    return { items: rows };
  }
}
