import { Controller, Get, Inject, Injectable, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import {
  canDo,
  cashCountSchema,
  cashHandoverSchema,
  cashSettleSchema,
  distanceMeters,
  istToday,
  orderLoadSchema,
  stockReceiptSchema,
  stopDeliveredSchema,
  stopProblemSchema,
  tripCreateSchema,
  tripStartSchema,
} from '@shiv/shared';
import { z } from 'zod';
import { blindShops } from '../blind-count';
import { Events } from '../catalog';
import { Db } from '../db';
import {
  atOrder,
  AuthRequest,
  Can,
  Contract,
  fail,
  forbid,
  Input,
  requireAt,
  scoped,
  shopAsked,
  shopForAction,
  shopWhere,
} from '../http';
import { moveStock } from '../inventory';
import { OrdersService } from '../orders';
import { postCreditSale } from '../khata';
import { evidenceExists } from './evidence';
import { seal } from './secret';

type Tx = Prisma.TransactionClient;
const addressOf = (value: unknown) =>
  (value ?? {}) as {
    name?: string;
    phone?: string;
    line1?: string;
    area?: string;
    city?: string;
    landmark?: string;
    lat?: number;
    lng?: number;
  };

/** Done only when what was counted matches what the deliveries say was taken, or an owner settled. */
const handoverStatus = (counted: number | null, collected: number, settled: boolean) =>
  counted === null ? 'WAITING' : counted === collected || settled ? 'DONE' : 'DIFFERENT';

/** An order called off while on a trip has nothing to load or deliver, and holds nobody up. */
const stillGoing: Prisma.OrderWhereInput = {
  status: { notIn: ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'] },
};

/** Delivery problems in the words the order's own record already uses. */
const problemReason = {
  NO_ACCESS: 'INACCESSIBLE',
  CUSTOMER_ABSENT: 'UNAVAILABLE',
  SHORT_TAKEN: 'REFUSED',
  OTHER: 'UNAVAILABLE',
} as const;

@Injectable()
export class StaffJobs {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Events) private events: Events,
    @Inject(OrdersService) private orders: OrdersService,
  ) {}

  // ---- Loading ------------------------------------------------------------------------------

  /** The loader's list: material and count only. No rate, money or udhaar, ever. */
  async loads(req: AuthRequest) {
    const rows = await this.db.order.findMany({
      where: { status: { in: ['CONFIRMED', 'PREPARING'] }, ...shopWhere(req, 'stock.load') },
      include: {
        items: { select: { productId: true, name: true, unit: true, quantity: true } },
        loads: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { vehicle: true, billNumber: true, createdAt: true },
        },
        location: { select: { name: true } },
      },
      orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        deliveryDate: row.deliveryDate,
        shopName: row.location.name,
        area: addressOf(row.address).area ?? '',
        items: row.items,
        loaded: row.loads[0] ?? null,
      })),
    };
  }

  async load(orderId: string, body: z.infer<typeof orderLoadSchema>, req: AuthRequest) {
    const saved = await this.db.atomic(async (tx) => {
      const earlier = await tx.orderLoad.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      });
      if (earlier) {
        if (earlier.orderId !== orderId)
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return earlier;
      }
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          number: true,
          userId: true,
          totalPaise: true,
          status: true,
          locationId: true,
          payment: { select: { method: true } },
        },
      });
      if (!order) fail('ORDER_NOT_FOUND', 'Order not found.', 404);
      if (!['CONFIRMED', 'PREPARING'].includes(order.status))
        fail('ORDER_CHANGED', 'This order is not waiting to be loaded.', 409);
      await postCreditSale(tx, order, req.user.id);
      const row = await tx.orderLoad.create({
        data: {
          orderId,
          locationId: order.locationId,
          vehicle: body.vehicle ?? '',
          billNumber: body.billNumber ?? '',
          note: body.note ?? '',
          loadedById: req.user.id,
          idempotencyKey: body.idempotencyKey,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'ORDER_LOADED',
          entityId: orderId,
          locationId: order.locationId,
          details: { vehicle: row.vehicle },
        },
      });
      return row;
    });
    // Loading is the moment it starts being prepared. A retry finishes this if it did not.
    const order = await this.db.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (order?.status === 'CONFIRMED')
      await this.orders.changeStatus(orderId, 'PREPARING', req.user.id, 'Goods loaded.');
    return { id: saved.id, orderId, vehicle: saved.vehicle };
  }

  // ---- Goods in -----------------------------------------------------------------------------

  /** Direct, because waiting for a yes with a truck in the yard fails. Tonight's summary lists it. */
  async receipt(body: z.infer<typeof stockReceiptSchema>, req: AuthRequest) {
    requireAt(req, 'stock.receive', body.locationId);
    if (body.evidenceId) await evidenceExists(this.db, body.evidenceId, req.user.id);
    const saved = await this.db.atomic(async (tx) => {
      const earlier = await tx.stockReceipt.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      });
      if (earlier) {
        if (
          earlier.actorId !== req.user.id ||
          earlier.productId !== body.productId ||
          earlier.quantity !== body.quantity ||
          earlier.locationId !== body.locationId
        )
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return earlier;
      }
      const product = await tx.product.findUnique({
        where: { id: body.productId },
        select: { id: true },
      });
      if (!product) fail('NOT_FOUND', 'That item is not on the list.', 404);
      const movement = await moveStock(tx, {
        productId: body.productId,
        kind: 'PURCHASE_IN',
        quantity: body.quantity,
        actorId: req.user.id,
        reference: body.vehicle ?? '',
        note: `Truck from ${body.supplierName}`,
        idempotencyKey: `receipt:${body.idempotencyKey}`,
        locationId: body.locationId,
      });
      return tx.stockReceipt.create({
        data: {
          locationId: body.locationId,
          productId: body.productId,
          quantity: body.quantity,
          supplierName: body.supplierName,
          vehicle: body.vehicle ?? '',
          evidenceId: body.evidenceId ?? null,
          movementId: movement.id,
          actorId: req.user.id,
          idempotencyKey: body.idempotencyKey,
        },
      });
    });
    this.events.publish({ type: 'CATALOG_UPDATED', productId: body.productId });
    return { id: saved.id, quantity: saved.quantity };
  }

  // ---- Trips, from the desk -----------------------------------------------------------------

  async ready(locationId: string) {
    const rows = await this.db.order.findMany({
      where: {
        locationId,
        status: { in: ['CONFIRMED', 'PREPARING', 'DELIVERY_EXCEPTION'] },
        tripStops: { none: { trip: { status: { in: ['PLANNED', 'OUT'] } } } },
      },
      include: {
        items: { select: { name: true, unit: true, quantity: true } },
        loads: { take: 1, orderBy: { createdAt: 'desc' }, select: { vehicle: true } },
      },
      orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        deliveryDate: row.deliveryDate,
        area: addressOf(row.address).area ?? '',
        name: addressOf(row.address).name ?? '',
        items: row.items,
        loaded: Boolean(row.loads[0]),
      })),
    };
  }
  async drivers(locationId: string) {
    const rows = await this.db.staffMembership.findMany({
      where: { locationId, endedAt: null, role: { in: ['DRIVER', 'HELPER'] } },
      select: {
        role: true,
        user: { select: { id: true, name: true, deletedAt: true, staffPausedAt: true } },
      },
    });
    return {
      // Someone paused cannot take a trip, so they are not offered.
      items: rows
        .filter((row) => !row.user.deletedAt && !row.user.staffPausedAt)
        .map((row) => ({ id: row.user.id, name: row.user.name, role: row.role })),
    };
  }
  async createTrip(body: z.infer<typeof tripCreateSchema>, req: AuthRequest) {
    requireAt(req, 'trip.assign', body.locationId);
    return this.db.atomic(async (tx) => {
      const earlier = await tx.trip.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
        include: { stops: true },
      });
      if (earlier) {
        if (earlier.createdById !== req.user.id || earlier.locationId !== body.locationId)
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return { id: earlier.id, status: earlier.status };
      }
      const driver = await tx.staffMembership.findFirst({
        where: {
          userId: body.driverId,
          endedAt: null,
          locationId: body.locationId,
          role: 'DRIVER',
          user: { deletedAt: null, staffPausedAt: null },
        },
      });
      if (!driver) fail('NOT_ASSIGNED', 'This person does not drive for this shop.', 409);
      if (body.helperId) {
        const helper = await tx.staffMembership.findFirst({
          where: { userId: body.helperId, endedAt: null, locationId: body.locationId },
          select: { id: true },
        });
        if (!helper) fail('NOT_ASSIGNED', 'This helper is not at this shop.', 409);
      }
      const orders = await tx.order.findMany({
        where: { id: { in: body.orderIds } },
        select: { id: true, locationId: true, status: true },
      });
      if (
        orders.length !== body.orderIds.length ||
        orders.some(
          (row) =>
            row.locationId !== body.locationId ||
            !['CONFIRMED', 'PREPARING', 'DELIVERY_EXCEPTION'].includes(row.status),
        )
      )
        fail('ORDER_CHANGED', 'One of these orders cannot go on a trip now.', 409);
      const busy = await tx.tripStop.findFirst({
        where: {
          orderId: { in: body.orderIds },
          trip: { status: { in: ['PLANNED', 'OUT'] } },
        },
        select: { orderId: true },
      });
      if (busy) fail('ORDER_BUSY', 'One of these orders is already on a trip.', 409);
      const trip = await tx.trip.create({
        data: {
          locationId: body.locationId,
          driverId: body.driverId,
          helperId: body.helperId ?? null,
          vehicle: body.vehicle ?? '',
          createdById: req.user.id,
          idempotencyKey: body.idempotencyKey,
          stops: {
            create: body.orderIds.map((orderId, index) => ({ orderId, sequence: index + 1 })),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'TRIP_CREATED',
          entityId: trip.id,
          locationId: body.locationId,
          details: { driverId: body.driverId, stops: body.orderIds.length },
        },
      });
      return { id: trip.id, status: trip.status };
    });
  }
  async trips(req: AuthRequest, query: Record<string, string>) {
    const rows = await this.db.trip.findMany({
      where: {
        ...shopAsked(req, 'trip.assign', query.locationId),
        OR: [
          { status: { in: ['PLANNED', 'OUT'] } },
          { createdAt: { gte: new Date(`${istToday()}T00:00:00+05:30`) } },
        ],
      },
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          include: { order: { select: { number: true, status: true, address: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const people = await this.db.user.findMany({
      where: { id: { in: rows.map((row) => row.driverId) } },
      select: { id: true, name: true },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        vehicle: row.vehicle,
        locationId: row.locationId,
        driverName: people.find((person) => person.id === row.driverId)?.name ?? '',
        createdAt: row.createdAt,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        stops: row.stops.map((stop) => ({
          id: stop.id,
          status: stop.status,
          number: stop.order.number,
          orderStatus: stop.order.status,
          area: addressOf(stop.order.address).area ?? '',
          problem: stop.problem,
        })),
      })),
    };
  }
  async cancelTrip(id: string, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id } });
      if (!trip) fail('NOT_FOUND', 'That trip is not here.', 404);
      requireAt(req, 'trip.assign', trip.locationId);
      if (trip.status !== 'PLANNED') fail('TRIP_DONE', 'This trip has already started.', 409);
      await tx.trip.update({ where: { id }, data: { status: 'CANCELLED', endedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'TRIP_CANCELLED',
          entityId: id,
          locationId: trip.locationId,
          details: {},
        },
      });
      return { id, status: 'CANCELLED' };
    });
  }

  // ---- Trips, on the driver's phone ---------------------------------------------------------

  /** The whole trip at once, because signal is patchy. Never the customer's balance. */
  async myTrips(req: AuthRequest) {
    const rows = await this.db.trip.findMany({
      where: { driverId: req.user.id, status: { in: ['PLANNED', 'OUT'] } },
      include: {
        location: { select: { name: true } },
        stops: {
          orderBy: { sequence: 'asc' },
          include: {
            order: {
              select: {
                id: true,
                number: true,
                status: true,
                address: true,
                notes: true,
                items: { select: { name: true, unit: true, quantity: true } },
                payment: { select: { method: true, status: true, amountPaise: true } },
                loads: { take: 1, select: { id: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    return {
      serverNow: new Date(),
      items: rows.map((trip) => ({
        id: trip.id,
        status: trip.status,
        vehicle: trip.vehicle,
        shopName: trip.location.name,
        stops: trip.stops.map((stop) => {
          const address = addressOf(stop.order.address);
          const payment = stop.order.payment;
          const due = payment?.method === 'COD' && payment.status === 'PENDING';
          return {
            id: stop.id,
            sequence: stop.sequence,
            status: stop.status,
            orderId: stop.order.id,
            number: stop.order.number,
            orderStatus: stop.order.status,
            name: address.name ?? '',
            phone: address.phone ?? '',
            line1: address.line1 ?? '',
            area: address.area ?? '',
            landmark: address.landmark ?? '',
            lat: address.lat ?? null,
            lng: address.lng ?? null,
            notes: stop.order.notes,
            items: stop.order.items,
            loaded: stop.order.loads.length > 0,
            // One figure, or "udhaar": what to take, and nothing about what anyone owes.
            collectPaise: due ? payment.amountPaise : 0,
            onCredit: payment?.method === 'CREDIT',
          };
        }),
      })),
    };
  }

  private async myTrip(tx: Pick<Tx, 'trip'>, id: string, driverId: string) {
    const trip = await tx.trip.findUnique({ where: { id }, include: { stops: true } });
    if (!trip) fail('NOT_FOUND', 'That trip is not here.', 404);
    if (trip.driverId !== driverId) fail('NOT_YOUR_TRIP', 'This trip is someone else’s.', 403);
    return trip;
  }
  private async myStop(tx: Pick<Tx, 'tripStop'>, id: string, driverId: string) {
    const stop = await tx.tripStop.findUnique({
      where: { id },
      include: { trip: true },
    });
    if (!stop) fail('NOT_FOUND', 'That stop is not here.', 404);
    if (stop.trip.driverId !== driverId) fail('NOT_YOUR_TRIP', 'This trip is someone else’s.', 403);
    return stop;
  }

  /** "Maal nikal gaya". The customer's message goes when the server hears this, not before. */
  async startTrip(id: string, body: z.infer<typeof tripStartSchema>, req: AuthRequest) {
    const driverId = req.user.id;
    const trip = await this.db.atomic(async (tx) => {
      const found = await this.myTrip(tx, id, driverId);
      if (found.status === 'DONE' || found.status === 'CANCELLED')
        fail('TRIP_DONE', 'This trip is over.', 409);
      if (found.status === 'PLANNED') {
        const notLoaded = await tx.tripStop.count({
          where: { tripId: id, order: { loads: { none: {} }, ...stillGoing } },
        });
        if (notLoaded) fail('NOT_LOADED', 'Goods for this trip are not loaded yet.', 409);
        await tx.trip.update({ where: { id }, data: { status: 'OUT', startedAt: new Date() } });
        await tx.tripStop.updateMany({
          where: { tripId: id },
          data: { departedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            actorId: driverId,
            event: 'TRIP_STARTED',
            entityId: id,
            locationId: found.locationId,
            details: { claimedAgeMs: body.claimedAgeMs ?? null },
          },
        });
      }
      return found;
    });
    // One by one and safe to repeat, so a lost reply never sends a customer two messages.
    for (const stop of trip.stops) {
      // A stop with a problem stays that way: a repeated tap must not send it out again.
      if (stop.status !== 'PENDING') continue;
      const order = await this.db.order.findUnique({
        where: { id: stop.orderId },
        select: { status: true },
      });
      // An order that had a problem goes out again through its own record of what happened.
      if (order?.status === 'DELIVERY_EXCEPTION')
        await this.orders.delivery(
          stop.orderId,
          {
            action: 'RETRY',
            retryDate: istToday(),
            note: 'Going out again.',
            idempotencyKey: `retry:${stop.id}`,
          },
          driverId,
        );
      else if (order?.status === 'PREPARING')
        await this.orders.changeStatus(
          stop.orderId,
          'OUT_FOR_DELIVERY',
          driverId,
          'Left the shop.',
        );
      else if (order?.status === 'CONFIRMED') {
        await this.orders.changeStatus(stop.orderId, 'PREPARING', driverId, 'Goods loaded.');
        await this.orders.changeStatus(
          stop.orderId,
          'OUT_FOR_DELIVERY',
          driverId,
          'Left the shop.',
        );
      }
    }
    return { id, status: 'OUT' };
  }

  private async tripDoneIfFinished(tx: Tx, tripId: string) {
    const open = await tx.tripStop.count({
      where: { tripId, status: 'PENDING', order: stillGoing },
    });
    if (!open)
      await tx.trip.updateMany({
        where: { id: tripId, status: 'OUT' },
        data: { status: 'DONE', endedAt: new Date() },
      });
  }

  /** "Pahunch gaya". The customer's message is the real check: a false delivery gets a phone call. */
  async delivered(id: string, body: z.infer<typeof stopDeliveredSchema>, req: AuthRequest) {
    const driverId = req.user.id;
    if (!body.evidenceId && !body.skipReason)
      fail('INVALID_INPUT', 'Add a photo, or say why there is none.', 400);
    if (body.evidenceId) await evidenceExists(this.db, body.evidenceId, driverId);
    const stop = await this.db.atomic(async (tx) => {
      const found = await this.myStop(tx, id, driverId);
      const earlier = await tx.deliveryProof.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      });
      if (earlier) {
        if (earlier.tripStopId !== id || earlier.kind !== 'DELIVERED')
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return found;
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id: found.orderId },
        select: {
          status: true,
          locationId: true,
          address: true,
          payment: { select: { id: true, method: true, status: true, amountPaise: true } },
        },
      });
      if (order.status !== 'OUT_FOR_DELIVERY')
        fail('ORDER_CHANGED', 'This order is not out for delivery.', 409);
      // Delivered already, and the order never heard (a lost connection): finish that, take nothing.
      if (found.status === 'DELIVERED') return found;
      if (found.status !== 'PENDING' || found.trip.status !== 'OUT')
        fail('ORDER_CHANGED', 'This stop is not open on a trip that is out.', 409);
      const payment = order.payment;
      const due = payment?.method === 'COD' && payment.status === 'PENDING';
      if (payment?.method !== 'CREDIT' && payment?.status !== 'CAPTURED' && !due)
        fail('ORDER_CHANGED', 'Payment on this order needs a look first.', 409);
      if (due && !body.collected)
        fail('COLLECTION_NEEDED', 'Say how much you got for this delivery.', 400);
      if (!due && body.collected) fail('INVALID_INPUT', 'Nothing is due on this delivery.', 400);
      // UPI goes straight on the record with nobody counting it, so it cannot pass what was due.
      if (
        due &&
        body.collected?.channel === 'UPI' &&
        body.collected.amountPaise > payment!.amountPaise
      )
        fail('INVALID_INPUT', 'That is more than was due on this delivery.', 400);
      if (due && body.collected && payment) {
        // In the driver's hand, not the drawer. It joins the drawer when someone else counts it.
        await tx.driverCollection.create({
          data: {
            orderId: found.orderId,
            driverId,
            locationId: order.locationId,
            duePaise: payment.amountPaise,
            amountPaise: body.collected.amountPaise,
            channel: body.collected.channel,
            claimedAgeMs: body.claimedAgeMs ?? null,
            idempotencyKey: `collect:${body.idempotencyKey}`,
          },
        });
        // Less than was due leaves the rest owed, in the open on the payments list, until someone
        // takes it. Nothing here calls it paid, and the goods are still delivered.
        if (body.collected.amountPaise >= payment.amountPaise)
          await tx.payment.update({ where: { id: payment.id }, data: { status: 'CAPTURED' } });
        if (body.collected.channel === 'UPI')
          await tx.financialMovement.create({
            data: {
              paymentId: payment.id,
              locationId: order.locationId,
              kind: 'COLLECTION',
              channel: 'UPI',
              amountPaise: body.collected.amountPaise,
              actorId: driverId,
              counterParty: driverId,
            },
          });
      }
      const pin = addressOf(order.address);
      const hasFix = typeof body.lat === 'number' && typeof body.lng === 'number';
      await tx.deliveryProof.create({
        data: {
          orderId: found.orderId,
          tripStopId: id,
          kind: 'DELIVERED',
          claimedAgeMs: body.claimedAgeMs ?? null,
          distanceM:
            hasFix && typeof pin.lat === 'number' && typeof pin.lng === 'number'
              ? distanceMeters({ lat: body.lat!, lng: body.lng! }, { lat: pin.lat, lng: pin.lng })
              : null,
          accuracyM: hasFix && body.accuracyM !== undefined ? Math.round(body.accuracyM) : null,
          geoEnc: hasFix ? seal({ lat: body.lat, lng: body.lng }) : null,
          evidenceId: body.evidenceId ?? null,
          skipReason: body.skipReason ?? '',
          actorId: driverId,
          idempotencyKey: body.idempotencyKey,
        },
      });
      await tx.tripStop.update({
        where: { id },
        data: { status: 'DELIVERED', arrivedAt: new Date() },
      });
      await this.tripDoneIfFinished(tx, found.tripId);
      return found;
    });
    const order = await this.db.order.findUnique({
      where: { id: stop.orderId },
      select: { status: true },
    });
    if (order?.status === 'OUT_FOR_DELIVERY')
      await this.orders.changeStatus(stop.orderId, 'DELIVERED', driverId, 'Delivered by driver.');
    return { id, status: 'DELIVERED' };
  }

  async problem(id: string, body: z.infer<typeof stopProblemSchema>, req: AuthRequest) {
    const driverId = req.user.id;
    const stop = await this.db.atomic(async (tx) => {
      const found = await this.myStop(tx, id, driverId);
      const earlier = await tx.deliveryProof.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      });
      if (earlier) {
        if (earlier.tripStopId !== id || earlier.kind !== 'PROBLEM')
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return found;
      }
      // A delivered stop stays delivered: its money and its proof are on the record.
      if (found.status !== 'PENDING') fail('ORDER_CHANGED', 'This stop is already settled.', 409);
      await tx.deliveryProof.create({
        data: {
          orderId: found.orderId,
          tripStopId: id,
          kind: 'PROBLEM',
          claimedAgeMs: body.claimedAgeMs ?? null,
          accuracyM: body.accuracyM !== undefined ? Math.round(body.accuracyM) : null,
          geoEnc:
            typeof body.lat === 'number' && typeof body.lng === 'number'
              ? seal({ lat: body.lat, lng: body.lng })
              : null,
          actorId: driverId,
          idempotencyKey: body.idempotencyKey,
        },
      });
      await tx.tripStop.update({
        where: { id },
        data: { status: 'PROBLEM', problem: body.problem, arrivedAt: new Date() },
      });
      await this.tripDoneIfFinished(tx, found.tripId);
      return found;
    });
    const order = await this.db.order.findUnique({
      where: { id: stop.orderId },
      select: { status: true },
    });
    if (order?.status === 'OUT_FOR_DELIVERY')
      await this.orders.delivery(
        stop.orderId,
        {
          action: 'REPORT',
          reason: problemReason[body.problem],
          note: body.note?.trim() || body.problem,
          idempotencyKey: body.idempotencyKey,
        },
        driverId,
      );
    return { id, status: 'PROBLEM' };
  }

  // ---- The driver's cash --------------------------------------------------------------------

  async myCash(req: AuthRequest) {
    const driverId = req.user.id;
    const [held, steps, recorded] = await Promise.all([
      this.db.driverCollection.findMany({
        where: { driverId, channel: 'CASH', handoverKey: null },
        select: { id: true, orderId: true, amountPaise: true, serverAt: true },
        orderBy: { serverAt: 'asc' },
      }),
      this.db.cashHandover.findMany({
        where: { driverId, createdAt: { gte: new Date(Date.now() - 14 * 86400000) } },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      this.db.driverCollection.groupBy({
        by: ['handoverKey'],
        where: { driverId, handoverKey: { not: null } },
        _sum: { amountPaise: true },
      }),
    ]);
    const keys = [...new Set(steps.map((row) => row.handoverKey))];
    return {
      holdingPaise: held.reduce((sum, row) => sum + row.amountPaise, 0),
      collections: held.length,
      handovers: keys.map((key) => {
        const row = (step: string) =>
          steps.find((entry) => entry.handoverKey === key && entry.step === step);
        const offered = row('OFFERED');
        const counted = row('COUNTED');
        return {
          key,
          offeredPaise: offered?.amountPaise ?? 0,
          countedPaise: counted?.amountPaise ?? null,
          offeredAt: offered?.createdAt ?? null,
          status: handoverStatus(
            counted?.amountPaise ?? null,
            recorded.find((entry) => entry.handoverKey === key)?._sum.amountPaise ?? 0,
            Boolean(row('SETTLED')),
          ),
        };
      }),
    };
  }

  /** "Cashier ko de diya". The amount is the driver's word, until someone else has counted it. */
  async offerCash(body: z.infer<typeof cashHandoverSchema>, req: AuthRequest) {
    const driverId = req.user.id;
    return this.db.atomic(async (tx) => {
      const earlier = await tx.cashHandover.findUnique({
        where: { handoverKey_step: { handoverKey: body.handoverKey, step: 'OFFERED' } },
      });
      if (earlier) {
        if (earlier.driverId !== driverId || earlier.amountPaise !== body.amountPaise)
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return { key: earlier.handoverKey, status: 'WAITING' };
      }
      const held = await tx.driverCollection.findMany({
        where: { driverId, channel: 'CASH', handoverKey: null },
        orderBy: { serverAt: 'asc' },
      });
      if (!held.length) fail('NOTHING_TO_HAND_OVER', 'You have no cash to hand over.', 409);
      // One shop's drawer at a time; anything from another shop stays for its own handover.
      const locationId = held[0]!.locationId;
      const here = held.filter((row) => row.locationId === locationId);
      await tx.driverCollection.updateMany({
        where: { id: { in: here.map((row) => row.id) } },
        data: { handoverKey: body.handoverKey },
      });
      await tx.cashHandover.create({
        data: {
          handoverKey: body.handoverKey,
          step: 'OFFERED',
          locationId,
          driverId,
          amountPaise: body.amountPaise,
          actorId: driverId,
        },
      });
      return { key: body.handoverKey, status: 'WAITING' };
    });
  }

  // ---- The cash, at the drawer --------------------------------------------------------------

  async handovers(req: AuthRequest, query: Record<string, string>) {
    const shops = shopAsked(req, 'cash.count', query.locationId);
    const rows = await this.db.cashHandover.findMany({
      where: {
        ...shops,
        createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
      },
      orderBy: { createdAt: 'asc' },
      take: 300,
    });
    const keys = [...new Set(rows.map((row) => row.handoverKey))];
    const people = await this.db.user.findMany({
      where: { id: { in: [...new Set(rows.flatMap((row) => [row.driverId, row.actorId]))] } },
      select: { id: true, name: true },
    });
    const nameOf = (id: string | undefined) =>
      people.find((person) => person.id === id)?.name ?? '';
    const held = await this.db.driverCollection.groupBy({
      by: ['driverId'],
      where: {
        channel: 'CASH',
        handoverKey: null,
        ...shops,
      },
      _sum: { amountPaise: true },
    });
    const holders = await this.db.user.findMany({
      where: { id: { in: held.map((row) => row.driverId) } },
      select: { id: true, name: true },
    });
    const recorded = await this.db.driverCollection.groupBy({
      by: ['handoverKey'],
      where: { handoverKey: { in: keys } },
      _sum: { amountPaise: true },
    });
    return {
      withDrivers: held.map((row) => ({
        driverName: holders.find((person) => person.id === row.driverId)?.name ?? '',
        amountPaise: row._sum.amountPaise ?? 0,
      })),
      items: keys
        .map((key) => {
          const of = (step: string) =>
            rows.find((row) => row.handoverKey === key && row.step === step);
          const offered = of('OFFERED');
          const counted = of('COUNTED');
          const settled = of('SETTLED');
          return {
            key,
            locationId: offered?.locationId ?? counted?.locationId ?? '',
            driverId: offered?.driverId ?? '',
            driverName: nameOf(offered?.driverId),
            offeredPaise: offered?.amountPaise ?? 0,
            // What the deliveries say he took. Offering less must not quietly make it "equal".
            collectedPaise: recorded.find((row) => row.handoverKey === key)?._sum.amountPaise ?? 0,
            offeredAt: offered?.createdAt ?? null,
            countedPaise: counted?.amountPaise ?? null,
            countedByName: counted ? nameOf(counted.actorId) : null,
            countNote: counted?.note ?? '',
            settledNote: settled?.note ?? null,
            settledByName: settled ? nameOf(settled.actorId) : null,
            status: handoverStatus(
              counted?.amountPaise ?? null,
              recorded.find((row) => row.handoverKey === key)?._sum.amountPaise ?? 0,
              Boolean(settled),
            ),
          };
        })
        .reverse(),
    };
  }

  /** Two people, both named. If the figures differ both stay, until an owner settles it. */
  async countCash(key: string, body: z.infer<typeof cashCountSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const offered = await tx.cashHandover.findUnique({
        where: { handoverKey_step: { handoverKey: key, step: 'OFFERED' } },
      });
      if (!offered) fail('NOT_FOUND', 'That handover is not here.', 404);
      requireAt(req, 'cash.count', offered.locationId);
      if (offered.driverId === req.user.id)
        fail('SAME_PERSON', 'Someone else must count this.', 403);
      const counted = await tx.cashHandover.findUnique({
        where: { handoverKey_step: { handoverKey: key, step: 'COUNTED' } },
      });
      if (counted) {
        if (counted.amountPaise !== body.countedPaise)
          fail('HANDOVER_DONE', 'This was already counted.', 409);
        return { key, countedPaise: counted.amountPaise, duplicate: true };
      }
      await tx.cashHandover.create({
        data: {
          handoverKey: key,
          step: 'COUNTED',
          locationId: offered.locationId,
          driverId: offered.driverId,
          amountPaise: body.countedPaise,
          actorId: req.user.id,
          note: body.note ?? '',
        },
      });
      const collections = await tx.driverCollection.findMany({ where: { handoverKey: key } });
      const payments = await tx.payment.findMany({
        where: { orderId: { in: collections.map((row) => row.orderId) } },
        select: { id: true, orderId: true },
      });
      // The cash has now really entered this drawer, so this is when today's sheet sees it.
      let recorded = 0;
      for (const row of collections) {
        const paymentId = payments.find((payment) => payment.orderId === row.orderId)?.id;
        await tx.financialMovement.create({
          data: {
            ...(paymentId ? { paymentId } : {}),
            locationId: offered.locationId,
            kind: 'COLLECTION',
            channel: 'CASH',
            amountPaise: row.amountPaise,
            actorId: req.user.id,
            counterParty: offered.driverId,
          },
        });
        recorded += row.amountPaise;
      }
      // Amounts on the record are never negative, so short and over are two kinds.
      if (recorded !== body.countedPaise)
        await tx.financialMovement.create({
          data: {
            locationId: offered.locationId,
            kind: body.countedPaise < recorded ? 'HANDOVER_SHORT' : 'HANDOVER_OVER',
            channel: 'CASH',
            amountPaise: Math.abs(body.countedPaise - recorded),
            actorId: req.user.id,
            counterParty: offered.driverId,
          },
        });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'CASH_COUNTED',
          entityId: key,
          locationId: offered.locationId,
          details: { driverId: offered.driverId, same: recorded === body.countedPaise },
        },
      });
      return { key, countedPaise: body.countedPaise };
    });
  }

  async settleCash(key: string, body: z.infer<typeof cashSettleSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const counted = await tx.cashHandover.findUnique({
        where: { handoverKey_step: { handoverKey: key, step: 'COUNTED' } },
      });
      if (!counted) fail('NOT_FOUND', 'That handover has not been counted.', 404);
      if (!canDo(req.access, 'approvals.decide', counted.locationId))
        forbid(req, 'approvals.decide');
      const settled = await tx.cashHandover.findUnique({
        where: { handoverKey_step: { handoverKey: key, step: 'SETTLED' } },
      });
      if (settled) fail('ALREADY_DECIDED', 'This was already settled.', 409);
      await tx.cashHandover.create({
        data: {
          handoverKey: key,
          step: 'SETTLED',
          locationId: counted.locationId,
          driverId: counted.driverId,
          amountPaise: counted.amountPaise,
          actorId: req.user.id,
          note: body.note,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'CASH_SETTLED',
          entityId: key,
          locationId: counted.locationId,
          details: { driverId: counted.driverId },
        },
      });
      return { key, status: 'DONE' };
    });
  }
}

@ApiTags('Stock jobs and trips')
@Controller()
export class StaffJobsController {
  constructor(
    @Inject(StaffJobs) private jobs: StaffJobs,
    @Inject(Db) private db: Db,
  ) {}

  @Can('stock.load', scoped) @Get('staff/stock/loads') loads(@Req() req: AuthRequest) {
    return this.jobs.loads(req);
  }
  @Can('stock.load', atOrder())
  @Post('staff/stock/loads/:id')
  @Contract(orderLoadSchema)
  load(
    @Param('id') id: string,
    @Input(orderLoadSchema) body: z.infer<typeof orderLoadSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.load(id, body, req);
  }
  @Can('stock.receive', scoped)
  @Post('staff/stock/receipts')
  @Contract(stockReceiptSchema)
  receipt(
    @Input(stockReceiptSchema) body: z.infer<typeof stockReceiptSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.receipt(body, req);
  }
  @Can('stock.read', scoped) @Get('staff/stock/blind') async blind(@Req() req: AuthRequest) {
    return { shops: [...(await blindShops(this.db, req.access))] };
  }

  @Can('trip.assign', scoped) @Get('admin/trips') trips(
    @Query() query: Record<string, string>,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.trips(req, query);
  }
  @Can('trip.assign', scoped) @Get('admin/trips/ready') ready(
    @Query('locationId') locationId: string,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.ready(shopForAction(req, 'trip.assign', locationId));
  }
  @Can('trip.assign', scoped) @Get('admin/trips/drivers') drivers(
    @Query('locationId') locationId: string,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.drivers(shopForAction(req, 'trip.assign', locationId));
  }
  @Can('trip.assign', scoped)
  @Post('admin/trips')
  @Contract(tripCreateSchema)
  createTrip(
    @Input(tripCreateSchema) body: z.infer<typeof tripCreateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.createTrip(body, req);
  }
  @Can('trip.assign', scoped) @Post('admin/trips/:id/cancel') cancelTrip(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.cancelTrip(id, req);
  }

  @Can('trip.drive', scoped) @Get('staff/trips/mine') myTrips(@Req() req: AuthRequest) {
    return this.jobs.myTrips(req);
  }
  @Can('trip.drive', scoped)
  @Post('staff/trips/:id/start')
  @Contract(tripStartSchema)
  start(
    @Param('id') id: string,
    @Input(tripStartSchema) body: z.infer<typeof tripStartSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.startTrip(id, body, req);
  }
  @Can('trip.drive', scoped)
  @Post('staff/stops/:id/delivered')
  @Contract(stopDeliveredSchema)
  delivered(
    @Param('id') id: string,
    @Input(stopDeliveredSchema) body: z.infer<typeof stopDeliveredSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.delivered(id, body, req);
  }
  @Can('trip.drive', scoped)
  @Post('staff/stops/:id/problem')
  @Contract(stopProblemSchema)
  problem(
    @Param('id') id: string,
    @Input(stopProblemSchema) body: z.infer<typeof stopProblemSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.problem(id, body, req);
  }
  @Can('trip.drive', scoped) @Get('staff/cash') cash(@Req() req: AuthRequest) {
    return this.jobs.myCash(req);
  }
  @Can('trip.drive', scoped)
  @Post('staff/cash/handover')
  @Contract(cashHandoverSchema)
  offer(
    @Input(cashHandoverSchema) body: z.infer<typeof cashHandoverSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.offerCash(body, req);
  }
  @Can('cash.count', scoped) @Get('admin/galla/handovers') handovers(
    @Query() query: Record<string, string>,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.handovers(req, query);
  }
  @Can('cash.count', scoped)
  @Post('admin/galla/handovers/:key/count')
  @Contract(cashCountSchema)
  count(
    @Param('key') key: string,
    @Input(cashCountSchema) body: z.infer<typeof cashCountSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.countCash(key, body, req);
  }
  @Can('approvals.decide', scoped)
  @Post('admin/galla/handovers/:key/settle')
  @Contract(cashSettleSchema)
  settle(
    @Param('key') key: string,
    @Input(cashSettleSchema) body: z.infer<typeof cashSettleSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.jobs.settleCash(key, body, req);
  }
}
