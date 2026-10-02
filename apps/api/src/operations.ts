import { Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  contractorDecisionSchema,
  deletionSchema,
  deliveryZoneSchema,
  inventorySchema,
} from '@shiv/shared';
import { Db } from './db';
import { Admin, AuthRequest, Contract, Input, Public, fail } from './http';
import { Events } from './catalog';
import { moveStock } from './inventory';
import { paginate } from './pagination';

@Controller()
export class OperationsController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Events) private events: Events,
  ) {}

  @Admin()
  @Get('admin/products/:id/movements')
  async movements(@Param('id') id: string, @Query() query: Record<string, string>) {
    const page = paginate(query, `stock:${id}`);
    return page.finish(
      await this.db.inventoryMovement.findMany({
        where: { productId: id, ...page.after },
        orderBy: page.orderBy,
        take: page.take,
      }),
    );
  }
  @Admin()
  @Post('admin/products/:id/movements')
  @Contract(inventorySchema)
  async movement(
    @Param('id') id: string,
    @Input(inventorySchema) body: z.infer<typeof inventorySchema>,
    @Req() req: AuthRequest,
  ) {
    if (body.kind !== 'MANUAL_ADJUSTMENT' && body.quantity < 1)
      fail('INVALID_QUANTITY', 'Enter a positive quantity.');
    const quantity = ['WALK_IN_SALE', 'DAMAGE'].includes(body.kind)
      ? -body.quantity
      : body.quantity;
    const result = await this.db.atomic((tx) =>
      moveStock(tx, { ...body, quantity, productId: id, actorId: req.user.id }),
    );
    this.events.publish({ type: 'CATALOG_UPDATED', productId: id });
    return result;
  }
  @Public()
  @Get('delivery/:pincode')
  async serviceability(@Param('pincode') pincode: string) {
    if (!/^[1-9]\d{5}$/.test(pincode)) fail('INVALID_PINCODE', 'Enter a six-digit pincode.');
    const entry = await this.db.deliveryPincode.findUnique({
      where: { pincode },
      include: { zone: true },
    });
    return {
      serviceable: Boolean(entry?.zone.active),
      zone: entry?.zone.active ? entry.zone : null,
    };
  }
  @Admin()
  @Get('admin/delivery-zones')
  zones() {
    return this.db.deliveryZone.findMany({
      include: { pincodes: { orderBy: { pincode: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }
  @Admin()
  @Post('admin/delivery-zones')
  @Contract(deliveryZoneSchema)
  createZone(
    @Input(deliveryZoneSchema) body: z.infer<typeof deliveryZoneSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.saveZone(null, body, req.user.id);
  }
  @Admin()
  @Patch('admin/delivery-zones/:id')
  @Contract(deliveryZoneSchema)
  updateZone(
    @Param('id') id: string,
    @Input(deliveryZoneSchema) body: z.infer<typeof deliveryZoneSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.saveZone(id, body, req.user.id);
  }
  async saveZone(id: string | null, body: z.infer<typeof deliveryZoneSchema>, actorId: string) {
    const { pincodes, expectedVersion, ...data } = body;
    const zone = await this.db.atomic(async (tx) => {
      if (id) {
        const changed = await tx.deliveryZone.updateMany({
          where: { id, version: expectedVersion ?? -1 },
          data: { ...data, version: { increment: 1 } },
        });
        if (!changed.count) fail('CONFLICT', 'Delivery zone changed. Refresh before saving.', 409);
        await tx.deliveryPincode.deleteMany({ where: { zoneId: id } });
      }
      const saved = id
        ? await tx.deliveryZone.findUniqueOrThrow({ where: { id } })
        : await tx.deliveryZone.create({ data });
      await tx.deliveryPincode.createMany({
        data: pincodes.map((pincode) => ({ pincode, zoneId: saved.id })),
      });
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'DELIVERY_ZONE_UPDATED',
          entityId: saved.id,
          details: { ...data, pincodes, version: saved.version },
        },
      });
      return tx.deliveryZone.findUniqueOrThrow({
        where: { id: saved.id },
        include: { pincodes: true },
      });
    });
    this.events.publish({ type: 'STORE_UPDATED' });
    return zone;
  }
  @Admin()
  @Patch('admin/customers/:id/contractor')
  @Contract(contractorDecisionSchema)
  contractor(
    @Param('id') id: string,
    @Input(contractorDecisionSchema) body: z.infer<typeof contractorDecisionSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id } });
      if (user.deletedAt || user.role === 'ADMIN' || user.contractorStatus === 'NONE')
        fail('INVALID_CONTRACTOR', 'Customer must request verification first.');
      const updated = await tx.user.update({
        where: { id },
        data: {
          contractorStatus: body.status,
          role: body.status === 'VERIFIED' ? 'CONTRACTOR' : 'CUSTOMER',
        },
      });
      await tx.auditLog.create({
        data: { actorId: req.user.id, event: 'CONTRACTOR_REVIEWED', entityId: id, details: body },
      });
      return updated;
    });
  }
  @Post('me/delete')
  @Contract(deletionSchema)
  async deleteAccount(
    @Input(deletionSchema) _body: z.infer<typeof deletionSchema>,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role === 'ADMIN')
      fail('STAFF_ACCOUNT', 'Contact the store owner to close a staff account.', 403);
    await this.db.atomic(async (tx) => {
      const active = await tx.order.count({
        where: { userId: req.user.id, status: { notIn: ['DELIVERED', 'CANCELLED', 'REFUNDED'] } },
      });
      if (active)
        fail(
          'ACTIVE_ORDERS',
          'Complete or cancel open orders and refunds before deleting your account. Contact the store for help.',
          409,
        );
      const where = { userId: req.user.id };
      const orders = await tx.order.findMany({ where, select: { id: true } });
      const quotes = await tx.quote.findMany({ where, select: { id: true } });
      await tx.orderStatusHistory.updateMany({
        where: { orderId: { in: orders.map((o) => o.id) } },
        data: { note: '' },
      });
      await tx.auditLog.updateMany({
        where: {
          OR: [
            { actorId: req.user.id },
            {
              entityId: {
                in: [req.user.id, ...orders.map((o) => o.id), ...quotes.map((q) => q.id)],
              },
            },
          ],
        },
        data: { details: { personalDataRemoved: true } },
      });
      await tx.session.deleteMany({ where });
      await tx.device.deleteMany({ where });
      await tx.address.deleteMany({ where });
      await tx.cartItem.deleteMany({ where });
      await tx.notification.deleteMany({ where });
      await tx.checkoutReview.updateMany({ where, data: { snapshot: { deleted: true } } });
      await tx.order.updateMany({
        where,
        data: {
          address: {
            name: 'Deleted customer',
            phone: '',
            line1: '',
            area: '',
            city: '',
            state: '',
            pincode: '',
            landmark: '',
          },
          notes: '',
        },
      });
      await tx.quoteRevision.updateMany({
        where: { quote: where },
        data: { snapshot: { deleted: true } },
      });
      await tx.quote.updateMany({
        where,
        data: {
          address: { deleted: true },
          company: '',
          gstin: '',
          notes: '',
          adminNote: '',
          decisionNote: '',
        },
      });
      await tx.otpChallenge.deleteMany({ where: { phone: req.user.phone } });
      await tx.user.update({
        where: { id: req.user.id },
        data: {
          phone: `deleted:${req.user.id}`,
          name: 'Deleted customer',
          role: 'CUSTOMER',
          contractorStatus: 'NONE',
          deletedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'ACCOUNT_DELETED',
          entityId: req.user.id,
          details: { retained: 'De-identified order/payment and audit records' },
        },
      });
    });
    return { ok: true };
  }
}
