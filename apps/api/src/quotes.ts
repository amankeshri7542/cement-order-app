import { clientIp, demand, requestBudget } from './abuse';
import { Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  quoteOfferSchema,
  quoteRequestSchema,
  quoteRespondSchema,
  storeQuoteRespondSchema,
  totals,
} from '@shiv/shared';
import { moveStock, validateQuantity } from './inventory';
import { paginate } from './pagination';
import { Db } from './db';
import { workInclude } from './owner-work';
import { Events } from './catalog';
import { Admin, AuthRequest, Contract, Input, fail, hash } from './http';
import { orderInclude, reference, validDelivery } from './orders';

@ApiTags('Bulk quotations')
@Controller()
export class QuotesController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Events) private events: Events,
  ) {}
  @Get('quotes') async list(@Req() req: AuthRequest, @Query() query: Record<string, string>) {
    const page = paginate(query, `quotes:${req.user.id}`);
    const quotes = await this.db.quote.findMany({
      where: { userId: req.user.id, ...page.after },
      include: {
        work: { include: workInclude },
        items: true,
        order: { select: { id: true, number: true } },
      },
      orderBy: page.orderBy,
      take: page.take,
    });
    return page.finish(
      quotes.map((q) => ({
        ...q,
        status:
          q.status === 'SENT' && q.validUntil && q.validUntil < new Date() ? 'EXPIRED' : q.status,
      })),
    );
  }
  @Post('quotes')
  @Contract(quoteRequestSchema)
  request(
    @Input(quoteRequestSchema) body: z.infer<typeof quoteRequestSchema>,
    @Req() req: AuthRequest,
  ) {
    if (new Set(body.items.map((i) => i.productId)).size !== body.items.length)
      fail('INVALID_INPUT', 'Each product can appear only once.');
    return this.db.atomic(async (tx) => {
      const requestHash = hash(JSON.stringify(body));
      if (body.idempotencyKey) {
        const previous = await tx.quote.findUnique({
          where: {
            userId_idempotencyKey: { userId: req.user.id, idempotencyKey: body.idempotencyKey },
          },
          include: {
            work: { include: workInclude },
            items: true,
            order: { select: { id: true, number: true } },
          },
        });
        if (previous) {
          if (previous.requestHash !== requestHash)
            fail(
              'IDEMPOTENCY_CONFLICT',
              'This request was already submitted with different details.',
              409,
            );
          return previous;
        }
      }
      await requestBudget(tx, 'quote', req.user.id, clientIp(req));
      await demand(tx, req.user.id, 'QUOTE');
      validDelivery(body.deliveryDate);
      const address = await tx.address.findFirst({
        where: { id: body.addressId, userId: req.user.id },
      });
      if (!address) fail('INVALID_ADDRESS', 'Choose a saved address.');
      const products = await tx.product.findMany({
        where: { id: { in: body.items.map((i) => i.productId) }, active: true },
      });
      if (products.length !== body.items.length)
        fail('NOT_FOUND', 'One or more products are unavailable.', 404);
      return tx.quote.create({
        data: {
          number: reference('QT'),
          idempotencyKey: body.idempotencyKey,
          requestHash,
          work: { create: {} },
          userId: req.user.id,
          address: JSON.parse(JSON.stringify(address)) as Prisma.InputJsonValue,
          deliveryDate: body.deliveryDate,
          company: body.company,
          gstin: body.gstin,
          notes: body.notes,
          items: {
            create: body.items.map((i) => {
              const p = products.find((p) => p.id === i.productId)!;
              validateQuantity(p, i.quantity);
              return { ...i, name: p.name, unit: p.unit, packSize: p.packSize };
            }),
          },
        },
        include: {
          work: { include: workInclude },
          items: true,
          order: { select: { id: true, number: true } },
        },
      });
    });
  }
  @Admin() @Get('admin/quotes') async all(@Query() query: Record<string, string>) {
    const status = z
      .enum(['REQUESTED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'])
      .optional()
      .parse(query.status);
    const page = paginate(query, `admin-quotes:${status || ''}`);
    const quotes = await this.db.quote.findMany({
      where: { ...page.after, ...(status ? { status } : {}) },
      include: {
        work: { include: workInclude },
        items: true,
        user: true,
        order: { select: { id: true, number: true } },
      },
      orderBy: page.orderBy,
      take: page.take,
    });
    return page.finish(
      quotes.map((q) => ({
        ...q,
        status:
          q.status === 'SENT' && q.validUntil && q.validUntil < new Date() ? 'EXPIRED' : q.status,
      })),
    );
  }
  @Admin()
  @Post('admin/quotes/:id/offer')
  @Contract(quoteOfferSchema)
  offer(
    @Param('id') id: string,
    @Input(quoteOfferSchema) body: z.infer<typeof quoteOfferSchema>,
    @Req() req: AuthRequest,
  ) {
    if (
      new Date(body.validUntil) <= new Date() ||
      new Date(body.validUntil).getTime() > Date.now() + 90 * 86400000
    )
      fail('INVALID_EXPIRY', 'Choose a quote expiry within 90 days.');
    return this.db.atomic(async (tx) => {
      const quote = await tx.quote.findUniqueOrThrow({
        where: { id },
        include: {
          work: { include: workInclude },
          items: true,
          order: { select: { id: true, number: true } },
        },
      });
      if (quote.revision !== body.expectedRevision || quote.order !== null)
        fail(
          'QUOTE_CHANGED',
          'Quote changed or was already converted. Refresh before editing.',
          409,
        );
      if (
        body.items.length !== quote.items.length ||
        new Set(body.items.map((i) => i.productId)).size !== body.items.length ||
        quote.items.some((i) => !body.items.find((x) => x.productId === i.productId))
      )
        fail('INVALID_INPUT', 'Price every requested product exactly once.');
      if (body.deliveryDate) validDelivery(body.deliveryDate);
      const currentProducts = await tx.product.findMany({
        where: { id: { in: quote.items.map((i) => i.productId) } },
      });
      const lines = quote.items.map((i) => ({
        ...i,
        packSize: currentProducts.find((p) => p.id === i.productId)!.packSize,
        name: currentProducts.find((p) => p.id === i.productId)!.name,
        unit: currentProducts.find((p) => p.id === i.productId)!.unit,
        pricePaise: body.items.find((x) => x.productId === i.productId)!.unitPricePaise,
      }));
      const total = totals(lines, body.deliveryFeePaise, null);
      for (const line of lines)
        await tx.quoteItem.update({
          where: { id: line.id },
          data: {
            unitPricePaise: line.pricePaise,
            name: line.name,
            unit: line.unit,
            packSize: line.packSize,
          },
        });
      const updated = await tx.quote.update({
        where: { id },
        data: {
          status: 'SENT',
          deliveryConfirmed: body.deliveryConfirmed,
          ...(body.deliveryDate ? { deliveryDate: body.deliveryDate } : {}),
          decisionSource: null,
          decisionActorId: null,
          decisionAt: null,
          decisionNote: '',
          revision: { increment: 1 },
          validUntil: new Date(body.validUntil),
          totalPaise: total.totalPaise,
          deliveryFeePaise: body.deliveryFeePaise,
          adminNote: body.note,
        },
        include: {
          work: { include: workInclude },
          items: true,
          order: { select: { id: true, number: true } },
        },
      });
      await tx.quoteRevision.create({
        data: {
          quoteId: id,
          revision: updated.revision,
          snapshot: JSON.parse(JSON.stringify(updated)) as Prisma.InputJsonValue,
          actorId: req.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'QUOTE_SENT',
          entityId: id,
          details: { revision: updated.revision, totalPaise: total.totalPaise },
        },
      });
      await tx.notification.create({
        data: {
          userId: quote.userId,
          title: 'Your bulk price is ready',
          body: `Open ${quote.number} to review your quotation.`,
        },
      });
      return updated;
    });
  }
  @Admin()
  @Post('admin/quotes/:id/convert')
  async convert(
    @Param('id') id: string,
    @Input(z.strictObject({ revision: z.number().int().min(1) })) body: { revision: number },
    @Req() req: AuthRequest,
  ) {
    const result = await this.db.atomic(async (tx) => {
      // Serialize conversion on the accepted quote itself before creating its unique order.
      await tx.quote.update({
        where: { id },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      const quote = await tx.quote.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: { productId: 'asc' } }, order: true },
      });
      if (quote.order) {
        if (quote.order.quoteRevision !== body.revision)
          fail('QUOTE_CHANGED', 'This quote revision does not match the converted order.', 409);
        return tx.order.findUniqueOrThrow({ where: { id: quote.order.id }, include: orderInclude });
      }
      if (
        quote.status !== 'ACCEPTED' ||
        quote.revision !== body.revision ||
        !quote.validUntil ||
        quote.validUntil < new Date()
      )
        fail(
          'QUOTE_CHANGED',
          'A current accepted revision is required. Send a new offer and obtain consent if terms changed.',
          409,
        );
      validDelivery(quote.deliveryDate);
      if (!quote.deliveryConfirmed)
        fail(
          'DELIVERY_CONFIRMATION_REQUIRED',
          'Send an offer with confirmed transport availability and agreed freight, then obtain customer consent.',
          409,
        );
      const customer = await tx.user.findUniqueOrThrow({ where: { id: quote.userId } });
      if (customer.deletedAt)
        fail('CUSTOMER_DELETED', 'This customer account has been removed.', 409);
      const lines = [];
      for (const line of quote.items) {
        const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
        if (
          product.unit !== line.unit ||
          product.name !== line.name ||
          product.packSize !== line.packSize
        )
          fail(
            'QUOTE_CHANGED',
            'Material or selling unit changed. Send a new offer and obtain customer consent.',
            409,
          );
        validateQuantity(product, line.quantity);
        if (!product.active || product.stock < line.quantity || !line.unitPricePaise)
          fail(
            'OUT_OF_STOCK',
            `${line.name}: confirm availability and obtain a new offer if terms change.`,
            409,
          );
        lines.push({
          productId: product.id,
          name: line.name,
          unit: line.unit,
          packSize: line.packSize,
          quantity: line.quantity,
          pricePaise: line.unitPricePaise,
          priceVersion: product.priceVersion,
          lineTotalPaise: line.unitPricePaise * line.quantity,
        });
      }
      const amounts = totals(lines, quote.deliveryFeePaise, null);
      if (amounts.totalPaise !== quote.totalPaise)
        fail('QUOTE_CHANGED', 'Agreed totals do not match. Send a new offer.', 409);
      const review = await tx.checkoutReview.create({
        data: {
          userId: quote.userId,
          expiresAt: new Date(),
          snapshot: JSON.parse(
            JSON.stringify({
              quoteId: id,
              revision: quote.revision,
              address: quote.address,
              items: lines,
              ...amounts,
            }),
          ),
        },
      });
      const order = await tx.order.create({
        data: {
          number: reference('SC'),
          userId: quote.userId,
          quoteId: id,
          quoteRevision: quote.revision,
          reviewId: review.id,
          idempotencyKey: `quote:${id}:${quote.revision}`,
          status: 'CONFIRMED',
          address: quote.address as Prisma.InputJsonValue,
          deliveryDate: quote.deliveryDate,
          notes: quote.notes,
          ...amounts,
          items: { create: lines },
          payment: { create: { method: 'COD', amountPaise: amounts.totalPaise } },
          work: { create: { assignedToId: req.user.id, acknowledgedAt: new Date() } },
          history: {
            create: {
              status: 'CONFIRMED',
              actorId: req.user.id,
              note: `Accepted quote ${quote.number}, revision ${quote.revision}; agreed freight confirmed.`,
            },
          },
        },
        include: orderInclude,
      });
      for (const line of lines)
        await moveStock(tx, {
          productId: line.productId,
          kind: 'ONLINE_ORDER',
          quantity: -line.quantity,
          actorId: req.user.id,
          reference: order.id,
          note: `Accepted quotation ${quote.number}`,
          idempotencyKey: `quote:${id}:${line.productId}`,
        });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'QUOTE_CONVERTED',
          entityId: id,
          details: {
            orderId: order.id,
            revision: quote.revision,
            totalPaise: amounts.totalPaise,
            decisionSource: quote.decisionSource,
          },
        },
      });
      await tx.notification.create({
        data: {
          userId: quote.userId,
          orderId: order.id,
          title: 'Bulk order confirmed',
          body: `${quote.number} is now ${order.number}. Agreed prices and freight retained.`,
        },
      });
      return order;
    });
    this.events.publish({ type: 'CATALOG_UPDATED' });
    return result;
  }

  @Post('quotes/:id/respond')
  @Contract(quoteRespondSchema)
  respond(
    @Param('id') id: string,
    @Input(quoteRespondSchema) body: z.infer<typeof quoteRespondSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.decide(id, body, req.user.id, req.user.id);
  }
  @Admin()
  @Post('admin/quotes/:id/respond')
  @Contract(storeQuoteRespondSchema)
  adminRespond(
    @Param('id') id: string,
    @Input(storeQuoteRespondSchema) body: z.infer<typeof storeQuoteRespondSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.decide(id, body, req.user.id, undefined, body.note);
  }
  private decide(
    id: string,
    body: z.infer<typeof quoteRespondSchema>,
    actorId: string,
    ownerId?: string,
    note = '',
  ) {
    return this.db.atomic(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id, ...(ownerId ? { userId: ownerId } : {}) },
      });
      if (!quote) fail('NOT_FOUND', 'Quote not found.', 404);
      if (quote.revision === body.revision && quote.status === body.status) return quote;
      if (
        quote.status !== 'SENT' ||
        quote.revision !== body.revision ||
        !quote.validUntil ||
        quote.validUntil < new Date()
      )
        fail('QUOTE_CHANGED', 'Quote changed or expired. Review the latest version.', 409);
      const updated = await tx.quote.update({
        where: { id },
        data: {
          status: body.status,
          decisionSource: ownerId ? 'CUSTOMER' : 'STORE_RECORDED',
          decisionActorId: actorId,
          decisionAt: new Date(),
          decisionNote: note,
        },
        include: {
          work: { include: workInclude },
          items: true,
          order: { select: { id: true, number: true } },
        },
      });
      await tx.ownerWork.upsert({
        where: { quoteId: id },
        create: { quoteId: id },
        update: { deliveredAt: null, nextAttemptAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          event: `QUOTE_${body.status}`,
          entityId: id,
          details: { revision: body.revision, byStore: !ownerId, note },
        },
      });
      return updated;
    });
  }
}
