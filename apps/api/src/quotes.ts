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
import { validateQuantity } from './inventory';
import { paginate } from './pagination';
import { Db } from './db';
import { Admin, AuthRequest, Contract, Input, fail } from './http';
import { reference, validDelivery } from './orders';

@ApiTags('Bulk quotations')
@Controller()
export class QuotesController {
  constructor(@Inject(Db) private db: Db) {}
  @Get('quotes') async list(@Req() req: AuthRequest, @Query() query: Record<string, string>) {
    const page = paginate(query, `quotes:${req.user.id}`);
    const quotes = await this.db.quote.findMany({
      where: { userId: req.user.id, ...page.after },
      include: { items: true },
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
    validDelivery(body.deliveryDate);
    if (new Set(body.items.map((i) => i.productId)).size !== body.items.length)
      fail('INVALID_INPUT', 'Each product can appear only once.');
    return this.db.atomic(async (tx) => {
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
              return { ...i, name: p.name, unit: p.unit };
            }),
          },
        },
        include: { items: true },
      });
    });
  }
  @Admin() @Get('admin/quotes') async all(@Query() query: Record<string, string>) {
    const page = paginate(query, 'admin-quotes');
    const quotes = await this.db.quote.findMany({
      where: page.after,
      include: { items: true, user: true },
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
      const quote = await tx.quote.findUniqueOrThrow({ where: { id }, include: { items: true } });
      if (quote.revision !== body.expectedRevision || quote.status === 'ACCEPTED')
        fail(
          'QUOTE_CHANGED',
          'Quote changed or was already accepted. Refresh before editing.',
          409,
        );
      if (
        body.items.length !== quote.items.length ||
        new Set(body.items.map((i) => i.productId)).size !== body.items.length ||
        quote.items.some((i) => !body.items.find((x) => x.productId === i.productId))
      )
        fail('INVALID_INPUT', 'Price every requested product exactly once.');
      const lines = quote.items.map((i) => ({
        ...i,
        pricePaise: body.items.find((x) => x.productId === i.productId)!.unitPricePaise,
      }));
      const total = totals(lines, body.deliveryFeePaise, null);
      for (const line of lines)
        await tx.quoteItem.update({
          where: { id: line.id },
          data: { unitPricePaise: line.pricePaise },
        });
      const updated = await tx.quote.update({
        where: { id },
        data: {
          status: 'SENT',
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
        include: { items: true },
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
        include: { items: true },
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
