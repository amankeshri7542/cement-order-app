import {
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import {
  accessFor,
  addDays,
  canDo,
  csvRupees,
  csvText,
  daysBetween,
  followUpChangeSchema,
  followUpCreateSchema,
  followUpListSchema,
  istToday,
  promiseState,
  reminderBlock,
  type StaffRole,
} from '@shiv/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { Db } from '../db';
import { customerFirmWhere, firmsOf, firmWhere, requireCustomerVisible } from '../firms';
import {
  atFollowUp,
  AuthRequest,
  Can,
  Contract,
  fail,
  Firm,
  hash,
  Input,
  requireAt,
  scoped,
  shopAsked,
  shopForAction,
} from '../http';
import { paginate } from '../pagination';
import { countOpen, phoneFields, realCustomer, sendCsv, stoppedIds, type Tx } from './common';

/** Far enough for any promise a customer makes. Further is a slipped digit. */
const MAX_DAYS_AHEAD = 366;
/** A day's calls fit on a page. More than this means nobody is working the list. */
const DUE_LIMIT = 300;

/** What a row carries, with the customer's balance and sign-off read at this person's firms. */
const shownFor = (req: Pick<AuthRequest, 'firms'>) =>
  ({
    customer: {
      select: {
        id: true,
        name: true,
        phone: true,
        area: true,
        khataBalancePaise: true,
        remindersStoppedAt: true,
        khataSignoffs: { where: firmWhere(req), select: { id: true }, take: 1 },
        firmBalances: { where: firmWhere(req), select: { firmId: true, balancePaise: true } },
      },
    },
    assignee: { select: { id: true, name: true } },
    location: { select: { name: true } },
    events: {
      where: { action: 'SNOOZED' },
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: 1,
      select: { reason: true },
    },
  }) satisfies Prisma.FollowUpInclude;
type Shown = Prisma.FollowUpGetPayload<{ include: ReturnType<typeof shownFor> }>;

/** A customer's due as this person may see it: the total over their firms. */
const dueOf = (req: Pick<AuthRequest, 'firms'>, customer: Shown['customer']) =>
  firmsOf(req) === 'ALL'
    ? customer.khataBalancePaise
    : customer.firmBalances.reduce((total, row) => total + row.balancePaise, 0);

@Injectable()
export class FollowUps {
  constructor(@Inject(Db) private db: Db) {}

  /** Only someone who works here, and is not paused or gone, can be given a shop's call. */
  private async assignable(tx: Tx, assigneeId: string, locationId: string) {
    const person = await tx.user.findFirst({
      where: { id: assigneeId, role: 'ADMIN', deletedAt: null, staffPausedAt: null },
      select: {
        staffMemberships: {
          where: { endedAt: null },
          select: { role: true, locationId: true },
        },
      },
    });
    const access = accessFor(
      (person?.staffMemberships ?? []).map((row) => ({
        role: row.role as StaffRole,
        locationId: row.locationId,
      })),
    );
    if (!canDo(access, 'crm.followups', locationId))
      fail('INVALID_ASSIGNEE', 'That person cannot take this shop’s calls.', 400);
  }

  async create(input: z.infer<typeof followUpCreateSchema>, req: AuthRequest) {
    const locationId = shopForAction(req, 'crm.followups', input.locationId);
    const today = istToday();
    if (input.dueOn < today || daysBetween(today, input.dueOn) > MAX_DAYS_AHEAD)
      fail('INVALID_DUE_DATE', 'Choose today or a day within the next year.');
    const assigneeId = input.assigneeId ?? null;
    if (assigneeId && assigneeId !== req.user.id)
      requireAt(req, 'crm.followups.assign', locationId);
    const requestHash = hash(
      JSON.stringify({
        customerId: input.customerId,
        dueOn: input.dueOn,
        kind: input.kind,
        note: input.note ?? '',
        assigneeId,
        promisedPaise: input.promisedPaise ?? null,
        locationId,
      }),
    );
    const row = await this.db.atomic(async (tx) => {
      // Another firm's customer is not found, as one who does not exist. Asked before the replay,
      // so a reused key cannot read back a call for someone else's customer.
      await requireCustomerVisible(tx, req, input.customerId);
      const previous = await tx.followUp.findUnique({
        where: {
          customerId_idempotencyKey: {
            customerId: input.customerId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (previous) {
        if (previous.requestHash !== requestHash)
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return previous;
      }
      const customer = await tx.user.findFirst({
        where: { id: input.customerId, ...realCustomer },
        select: { id: true },
      });
      if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
      const shop = await tx.location.findFirst({
        where: { id: locationId, active: true },
        select: { id: true },
      });
      if (!shop) fail('INVALID_SHOP', 'That shop is not open.', 400);
      if (assigneeId) await this.assignable(tx, assigneeId, locationId);
      // Two people writing the same call for the same day make one call, not two rings.
      const same = await tx.followUp.findFirst({
        where: {
          customerId: input.customerId,
          locationId,
          kind: input.kind,
          dueOn: input.dueOn,
          doneAt: null,
        },
      });
      if (same) return same;
      const made = await tx.followUp.create({
        data: {
          customerId: input.customerId,
          locationId,
          dueOn: input.dueOn,
          kind: input.kind,
          note: input.note ?? '',
          assigneeId,
          promisedPaise: input.promisedPaise ?? null,
          createdById: req.user.id,
          idempotencyKey: input.idempotencyKey,
          requestHash,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'FOLLOWUP_CREATED',
          entityId: input.customerId,
          locationId,
          details: {
            followUpId: made.id,
            kind: input.kind,
            dueOn: input.dueOn,
            assigneeId,
            promisedPaise: input.promisedPaise ?? null,
          },
        },
      });
      return made;
    });
    return this.one(row.id, req);
  }

  async change(id: string, input: z.infer<typeof followUpChangeSchema>, req: AuthRequest) {
    const { idempotencyKey, ...rest } = input;
    const requestHash = hash(JSON.stringify(rest));
    await this.db.atomic(async (tx) => {
      const row = await tx.followUp.findUnique({ where: { id } });
      if (!row) fail('FOLLOWUP_NOT_FOUND', 'That call is not on the list.', 404);
      // Asked again here: the guard read the shop outside this transaction.
      requireAt(req, 'crm.followups', row.locationId);
      // A call at this firm's shop for a customer it never dealt with is not on its list.
      await requireCustomerVisible(tx, req, row.customerId).catch(() =>
        fail('FOLLOWUP_NOT_FOUND', 'That call is not on the list.', 404),
      );
      const earlier = await tx.followUpEvent.findUnique({
        where: { followUpId_idempotencyKey: { followUpId: id, idempotencyKey } },
      });
      if (earlier) {
        if (earlier.requestHash !== requestHash)
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return;
      }
      const event = { followUpId: id, actorId: req.user.id, idempotencyKey, requestHash };
      if (input.action === 'DONE') {
        // Done is done: a second person's tap says the same thing and changes nothing.
        if (row.doneAt) return;
        await tx.followUp.update({
          where: { id },
          data: { doneAt: new Date(), doneById: req.user.id },
        });
        await tx.followUpEvent.create({ data: { ...event, action: 'DONE' } });
        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            event: 'FOLLOWUP_DONE',
            entityId: row.customerId,
            locationId: row.locationId,
            details: { followUpId: id },
          },
        });
        return;
      }
      if (row.doneAt) fail('FOLLOWUP_DONE', 'This call is already done.', 409);
      if (input.action === 'SNOOZE') {
        const today = istToday();
        if (
          input.dueOn <= today ||
          input.dueOn === row.dueOn ||
          input.dueOn > addDays(today, MAX_DAYS_AHEAD)
        )
          fail('INVALID_DUE_DATE', 'Choose a later day within the next year.');
        await tx.followUp.update({
          where: { id },
          data: { dueOn: input.dueOn, snoozes: { increment: 1 } },
        });
        await tx.followUpEvent.create({
          data: {
            ...event,
            action: 'SNOOZED',
            fromDueOn: row.dueOn,
            toDueOn: input.dueOn,
            reason: input.reason,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            event: 'FOLLOWUP_SNOOZED',
            entityId: row.customerId,
            locationId: row.locationId,
            details: { followUpId: id, fromDueOn: row.dueOn, toDueOn: input.dueOn },
          },
        });
        return;
      }
      requireAt(req, 'crm.followups.assign', row.locationId);
      if (input.assigneeId === row.assigneeId) return;
      if (input.assigneeId) await this.assignable(tx, input.assigneeId, row.locationId);
      await tx.followUp.update({ where: { id }, data: { assigneeId: input.assigneeId } });
      await tx.followUpEvent.create({
        data: {
          ...event,
          action: 'ASSIGNED',
          fromAssigneeId: row.assigneeId,
          toAssigneeId: input.assigneeId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'FOLLOWUP_ASSIGNED',
          entityId: row.customerId,
          locationId: row.locationId,
          details: { followUpId: id, from: row.assigneeId, to: input.assigneeId },
        },
      });
    });
    return this.one(id, req);
  }

  private async one(id: string, req: AuthRequest) {
    const row = await this.db.followUp.findUniqueOrThrow({
      where: { id },
      include: shownFor(req),
    });
    const [view] = await this.views([row], req, istToday());
    return view!;
  }

  /** What has come in from each customer since their promise was written, net of reversals. */
  private async paidSince(rows: readonly Shown[], req: AuthRequest) {
    const promises = rows.filter((row) => row.promisedPaise !== null);
    const paid = new Map<string, number>();
    if (!promises.length) return paid;
    const from = new Date(Math.min(...promises.map((row) => row.createdAt.getTime())));
    const entries = await this.db.customerLedgerEntry.findMany({
      where: {
        customerId: { in: [...new Set(promises.map((row) => row.customerId))] },
        createdAt: { gte: from },
        // What was paid to another firm keeps nobody's promise here.
        ...firmWhere(req),
        OR: [
          { kind: 'PAYMENT_RECEIVED' },
          { kind: 'REVERSAL', reverses: { kind: 'PAYMENT_RECEIVED' } },
        ],
      },
      select: { customerId: true, amountPaise: true, createdAt: true },
    });
    for (const row of promises)
      paid.set(
        row.id,
        entries
          .filter(
            (entry) => entry.customerId === row.customerId && entry.createdAt >= row.createdAt,
          )
          .reduce((sum, entry) => sum - entry.amountPaise, 0),
      );
    return paid;
  }

  /** Each person's view of a row, built field by field. A balance only once it is signed. */
  private async views(rows: readonly Shown[], req: AuthRequest, today: string) {
    const [paid, stopped] = await Promise.all([
      this.paidSince(rows, req),
      stoppedIds(
        this.db,
        rows.map((row) => row.customer),
      ),
    ]);
    const reminded = await this.db.customerContact.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: [...new Set(rows.map((row) => row.customerId))] },
        kind: 'REMINDER',
      },
      _max: { createdAt: true },
    });
    const seesBalance = canDo(req.access, 'khata.read.one');
    return rows.map((row) => {
      const signed = row.customer.khataSignoffs.length > 0;
      const paidSincePaise = paid.get(row.id) ?? 0;
      return {
        id: row.id,
        customer: {
          id: row.customer.id,
          name: row.customer.name,
          area: row.customer.area,
          ...phoneFields(req, row.customer.phone),
        },
        locationId: row.locationId,
        shopName: row.location.name,
        dueOn: row.dueOn,
        overdueDays: Math.max(0, daysBetween(row.dueOn, today)),
        kind: row.kind,
        note: row.note,
        promisedPaise: row.promisedPaise,
        paidSincePaise: row.promisedPaise === null ? null : paidSincePaise,
        promise: promiseState({
          promisedPaise: row.promisedPaise,
          paidSincePaise,
          dueOn: row.dueOn,
          today,
        }),
        assignee: row.assignee,
        snoozes: row.snoozes,
        lastSnoozeReason: row.events[0]?.reason ?? null,
        doneAt: row.doneAt,
        createdAt: row.createdAt,
        signedOff: signed,
        balancePaise: signed && seesBalance ? dueOf(req, row.customer) : null,
        lastRemindedAt:
          reminded.find((item) => item.customerId === row.customerId)?._max.createdAt ?? null,
        reminderBlocked: reminderBlock({
          purpose: 'PAYMENT',
          stopped: stopped.has(row.customerId),
          signed,
          balancePaise: dueOf(req, row.customer),
          phone: row.customer.phone,
        }),
      };
    });
  }

  /** Who can be given a call at this shop. Names only, for the people choosing. */
  async people(locationId: unknown, req: AuthRequest) {
    if (typeof locationId !== 'string' || !locationId)
      fail('SHOP_REQUIRED', 'Choose which shop this is for.', 400);
    requireAt(req, 'crm.followups.assign', locationId);
    const rows = await this.db.user.findMany({
      where: {
        role: 'ADMIN',
        deletedAt: null,
        staffPausedAt: null,
        staffMemberships: { some: { endedAt: null } },
      },
      select: {
        id: true,
        name: true,
        staffMemberships: { where: { endedAt: null }, select: { role: true, locationId: true } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return {
      items: rows
        .filter((person) =>
          canDo(
            accessFor(
              person.staffMemberships.map((row) => ({
                role: row.role as StaffRole,
                locationId: row.locationId,
              })),
            ),
            'crm.followups',
            locationId,
          ),
        )
        .map(({ id, name }) => ({ id, name })),
    };
  }

  /** Aaj ke call: broken promises first, then the longest overdue, and a kept promise last. */
  async due(query: Record<string, unknown>, req: AuthRequest) {
    const { locationId, mine, customerId } = this.filter(query);
    const today = istToday();
    const rows = await this.db.followUp.findMany({
      where: {
        ...shopAsked(req, 'crm.followups.read', locationId),
        customer: { ...realCustomer, ...customerFirmWhere(req) },
        doneAt: null,
        dueOn: { lte: today },
        ...(mine === '1' ? { assigneeId: req.user.id } : {}),
        ...(customerId ? { customerId } : {}),
      },
      orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
      take: DUE_LIMIT + 1,
      include: shownFor(req),
    });
    const rank = (promise: string | null) =>
      promise === 'BROKEN' ? 0 : promise === 'KEPT' ? 2 : 1;
    const items = (await this.views(rows.slice(0, DUE_LIMIT), req, today)).sort(
      (a, b) =>
        rank(a.promise) - rank(b.promise) ||
        a.dueOn.localeCompare(b.dueOn) ||
        a.id.localeCompare(b.id),
    );
    return { today, items, truncated: rows.length > DUE_LIMIT, nextCursor: null };
  }

  private filter(query: Record<string, unknown>) {
    const parsed = followUpListSchema.safeParse(query);
    if (!parsed.success) fail('INVALID_FILTER', 'Check the filters.');
    return parsed.data;
  }

  async list(query: Record<string, unknown>, req: AuthRequest) {
    const { view, locationId, mine, customerId } = this.filter(query);
    if (view === 'due') return this.due(query, req);
    const today = istToday();
    const where = {
      ...shopAsked(req, 'crm.followups.read', locationId),
      customer: { ...realCustomer, ...customerFirmWhere(req) },
      ...(mine === '1' ? { assigneeId: req.user.id } : {}),
      ...(customerId ? { customerId } : {}),
    } satisfies Prisma.FollowUpWhereInput;
    const page =
      view === 'upcoming'
        ? paginate(
            query,
            `followups:upcoming:${mine}:${locationId ?? ''}:${customerId ?? ''}`,
            'dueOn',
            'asc',
          )
        : paginate(query, `followups:done:${mine}:${locationId ?? ''}:${customerId ?? ''}`);
    const rows = page.finish(
      await this.db.followUp.findMany({
        where:
          view === 'upcoming'
            ? { ...where, doneAt: null, dueOn: { gt: today }, ...page.after }
            : { ...where, doneAt: { not: null }, ...page.after },
        orderBy: page.orderBy,
        take: page.take,
        include: shownFor(req),
      }),
    );
    return { today, ...rows, items: await this.views(rows.items, req, today) };
  }
}

@ApiTags('Customer khata and CRM')
@Controller('admin')
export class FollowUpsController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(FollowUps) private followUps: FollowUps,
  ) {}

  @Firm('own')
  @Can('crm.followups.read', scoped)
  @Get('followups')
  list(@Query() query: Record<string, unknown>, @Req() req: AuthRequest) {
    if ((query.view ?? 'due') === 'due') countOpen(this.db, 'aaj-ke-call', req, istToday());
    return this.followUps.list(query, req);
  }

  @Can('crm.followups.assign', scoped)
  @Get('followups/people')
  people(@Query('locationId') locationId: unknown, @Req() req: AuthRequest) {
    return this.followUps.people(locationId, req);
  }

  @Firm('own')
  @Can('crm.followups', scoped)
  @Post('followups')
  @Contract(followUpCreateSchema)
  create(
    @Input(followUpCreateSchema) input: z.infer<typeof followUpCreateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.followUps.create(input, req);
  }

  @Firm('own')
  @Can('crm.followups', atFollowUp())
  @Patch('followups/:id')
  @Contract(followUpChangeSchema)
  change(
    @Param('id') id: string,
    @Input(followUpChangeSchema) input: z.infer<typeof followUpChangeSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.followUps.change(id, input, req);
  }

  /** Aaj ke call as a spreadsheet. The same rows the person sees, numbers hidden the same way. */
  @Firm('own')
  @Can('crm.followups.read', scoped)
  @Get('reports/aaj-ke-call.csv')
  async csv(
    @Query() query: Record<string, unknown>,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const { today, items } = await this.followUps.due(query, req);
    countOpen(this.db, 'aaj-ke-call', req, today);
    sendCsv(res, `shiv-aaj-ke-call-${today}.csv`, [
      [
        'Customer',
        'Mobile',
        'Area',
        'Shop',
        'Due',
        'Kind',
        'Promised (₹)',
        'Promise',
        'Balance (₹)',
        'Assigned',
        'Note',
      ].map(csvText),
      ...items.map((row) => [
        csvText(row.customer.name),
        csvText(row.customer.phone ?? row.customer.phoneMasked),
        csvText(row.customer.area),
        csvText(row.shopName),
        row.dueOn,
        row.kind,
        row.promisedPaise === null ? '' : csvRupees(row.promisedPaise),
        row.promise ?? '',
        row.balancePaise === null ? '' : csvRupees(row.balancePaise),
        csvText(row.assignee?.name ?? ''),
        csvText(row.note),
      ]),
    ]);
  }
}
