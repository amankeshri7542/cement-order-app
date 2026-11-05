import { Controller, Get, Inject, Injectable, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { gallaCloseSchema, gallaEntrySchema, istToday } from '@shiv/shared';
import { z } from 'zod';
import { Db } from './db';
import { AuthRequest, Can, Contract, fail, Input, requireAt, scoped, shopForAction } from './http';

type Tx = Prisma.TransactionClient;
const cash = (channel: string) => channel === 'CASH' || channel === '';
// Money in is positive and money back out negative, as each row is written.
const cashIn = ['COUNTER_SALE', 'COLLECTION', 'HANDOVER_OVER'];
const dayRange = (day: string) => {
  const from = new Date(`${day}T00:00:00+05:30`);
  return { from, to: new Date(from.getTime() + 86400000) };
};

type CloseRows = Prisma.DayCloseGetPayload<object>[];
/** Every row of a day's close, oldest first. */
const closeRows = (tx: Pick<Tx, 'dayClose'>, locationId: string, day: string) =>
  tx.dayClose.findMany({ where: { locationId, day }, orderBy: { createdAt: 'asc' } });
/** The latest close of a day, as a correction replaces the row before it. */
const currentOf = (rows: CloseRows) => {
  const replaced = new Set(rows.map((row) => row.supersedesId));
  return rows.filter((row) => !replaced.has(row.id)).at(-1) ?? null;
};
/** Where a day stopped: when it was first closed, or midnight if that was done the day after. */
const endOf = (day: string, rows: CloseRows) => {
  const { to } = dayRange(day);
  const first = rows[0];
  return first && first.createdAt < to ? first.createdAt : to;
};

@Injectable()
export class GallaService {
  constructor(@Inject(Db) private db: Db) {}

  /**
   * What should be in the drawer, worked out only from what is on record. It runs from the last
   * close, not from midnight: cash taken after an early close, or on a day nobody closed, is still
   * in a drawer and has to be in someone's figure.
   */
  async sheet(tx: Tx, locationId: string, day: string) {
    const last = await tx.dayClose.findFirst({
      where: { locationId, day: { lt: day } },
      orderBy: { day: 'desc' },
      select: { day: true },
    });
    const lastRows = last ? await closeRows(tx, locationId, last.day) : [];
    const opening = currentOf(lastRows)?.countedPaise ?? 0;
    const from = last ? endOf(last.day, lastRows) : dayRange(day).from;
    const to = endOf(day, await closeRows(tx, locationId, day));
    const money = await tx.financialMovement.findMany({
      where: { locationId, occurredAt: { gte: from, lt: to } },
      select: { kind: true, amountPaise: true, channel: true },
    });
    const sum = (test: (row: (typeof money)[number]) => boolean) =>
      money.filter(test).reduce((total, row) => total + row.amountPaise, 0);
    // A driver's count that came up short never reached the drawer, whatever the orders say.
    const sales =
      sum((row) => cashIn.includes(row.kind) && cash(row.channel)) -
      sum((row) => row.kind === 'HANDOVER_SHORT' && cash(row.channel));
    const refunds = sum((row) => row.kind === 'REFUND' && cash(row.channel));
    const udhaar =
      sum((row) => row.kind === 'KHATA_PAYMENT' && cash(row.channel)) -
      sum((row) => row.kind === 'KHATA_PAYMENT_REVERSAL' && cash(row.channel));
    // Shown without a name: a cashier sees that staff were paid, not who, or how much each.
    const staffPaid =
      sum((row) => ['STAFF_PAY', 'STAFF_ADVANCE'].includes(row.kind)) -
      sum((row) => row.kind === 'STAFF_PAY_REVERSAL');
    const entries = await tx.gallaEntry.findMany({
      where: { locationId, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: 'asc' },
    });
    const paidIn = entries
      .filter((row) => row.kind === 'PAID_IN')
      .reduce((total, row) => total + row.amountPaise, 0);
    const paidOut = entries
      .filter((row) => row.kind === 'PAID_OUT')
      .reduce((total, row) => total + row.amountPaise, 0);
    const expectedPaise = opening + sales + udhaar + paidIn - refunds - paidOut - staffPaid;
    return {
      day,
      locationId,
      opening,
      sales,
      udhaar,
      refunds,
      paidIn,
      paidOut,
      staffPaid,
      expectedPaise,
      entries,
      // True when this sheet also holds a day or more that nobody closed.
      carried: from < dayRange(day).from,
    };
  }

  async read(locationId: string, day: string, actorId: string) {
    if (!z.iso.date().safeParse(day).success || day > istToday())
      fail('BAD_DAY', 'Choose today or an earlier day.');
    const sheet = await this.db.$transaction((tx) => this.sheet(tx, locationId, day));
    const rows = await closeRows(this.db, locationId, day);
    const close = currentOf(rows);
    const people = await this.db.user.findMany({
      where: { id: { in: rows.map((row) => row.closedById) } },
      select: { id: true, name: true },
    });
    const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? '';
    return {
      ...sheet,
      close: close && {
        ...close,
        closedByName: nameOf(close.closedById),
        // Two people: nobody can quietly fix their own shortage.
        canCorrect: close.closedById !== actorId,
      },
      // What this replaced stays in view. A shortage does not vanish by being corrected.
      history: rows
        .filter((row) => row.id !== close?.id)
        .map((row) => ({
          id: row.id,
          countedPaise: row.countedPaise,
          differencePaise: row.differencePaise,
          reason: row.reason,
          createdAt: row.createdAt,
          closedByName: nameOf(row.closedById),
        })),
    };
  }

  async addEntry(body: z.infer<typeof gallaEntrySchema>, req: AuthRequest) {
    requireAt(req, 'galla.close', body.locationId);
    const day = istToday();
    return this.db.atomic(async (tx) => {
      const earlier = await tx.gallaEntry.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      });
      if (earlier) {
        if (
          earlier.actorId !== req.user.id ||
          earlier.amountPaise !== body.amountPaise ||
          earlier.kind !== body.kind ||
          earlier.locationId !== body.locationId
        )
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return earlier;
      }
      if ((await closeRows(tx, body.locationId, day)).length)
        fail('DAY_CLOSED', 'Today is already closed at this shop.', 409);
      const entry = await tx.gallaEntry.create({
        data: { ...body, day, actorId: req.user.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: body.kind === 'PAID_OUT' ? 'GALLA_PAID_OUT' : 'GALLA_PAID_IN',
          entityId: entry.id,
          locationId: body.locationId,
          details: { amountPaise: body.amountPaise, day },
        },
      });
      return entry;
    });
  }

  /** The server's figure is the only "expected". A difference needs a reason, and stays visible. */
  async close(body: z.infer<typeof gallaCloseSchema>, req: AuthRequest) {
    requireAt(req, 'galla.close', body.locationId);
    if (body.day > istToday()) fail('BAD_DAY', 'Choose today or an earlier day.');
    return this.db.atomic(async (tx) => {
      const sheet = await this.sheet(tx, body.locationId, body.day);
      const current = currentOf(await closeRows(tx, body.locationId, body.day));
      if (current && current.id !== body.supersedesId)
        fail('DAY_CLOSED', 'This day is already closed. Correct it instead.', 409);
      if (body.supersedesId && !current)
        fail('DAY_NOT_CLOSED', 'That day has no close to correct.', 409);
      if (current?.closedById === req.user.id)
        fail('SAME_PERSON', 'Someone else must correct what you closed.', 403);
      if (!current) {
        // The drawer runs from one close to the next, so an earlier day cannot open up behind one.
        const later = await tx.dayClose.findFirst({
          where: { locationId: body.locationId, day: { gt: body.day } },
          select: { id: true },
        });
        if (later) fail('DAY_ORDER', 'A later day is already closed at this shop.', 409);
      }
      const differencePaise = body.countedPaise - sheet.expectedPaise;
      if ((differencePaise || body.supersedesId) && !body.reason)
        fail('REASON_NEEDED', 'Write why, so the owners can see it.', 400);
      const row = await tx.dayClose.create({
        data: {
          locationId: body.locationId,
          day: body.day,
          expectedPaise: sheet.expectedPaise,
          countedPaise: body.countedPaise,
          differencePaise,
          reason: body.reason ?? '',
          closedById: req.user.id,
          ...(body.supersedesId ? { supersedesId: body.supersedesId } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: body.supersedesId ? 'GALLA_CLOSE_CORRECTED' : 'GALLA_CLOSED',
          entityId: row.id,
          locationId: body.locationId,
          details: { day: body.day, expectedPaise: sheet.expectedPaise, differencePaise },
        },
      });
      return row;
    });
  }
}

@ApiTags('Galla')
@Controller('admin/galla')
export class GallaController {
  constructor(@Inject(GallaService) private galla: GallaService) {}

  @Can('galla.read', scoped) @Get() read(
    @Query() query: Record<string, string>,
    @Req() req: AuthRequest,
  ) {
    return this.galla.read(
      shopForAction(req, 'galla.read', query.locationId),
      query.day || istToday(),
      req.user.id,
    );
  }
  @Can('galla.close', scoped)
  @Post('entries')
  @Contract(gallaEntrySchema)
  entry(@Input(gallaEntrySchema) body: z.infer<typeof gallaEntrySchema>, @Req() req: AuthRequest) {
    return this.galla.addEntry(body, req);
  }
  @Can('galla.close', scoped)
  @Post('close')
  @Contract(gallaCloseSchema)
  close(@Input(gallaCloseSchema) body: z.infer<typeof gallaCloseSchema>, @Req() req: AuthRequest) {
    return this.galla.close(body, req);
  }
}
