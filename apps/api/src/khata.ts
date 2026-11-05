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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LedgerKind, Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  canDo,
  customerContactSchema,
  customerNoteSchema,
  customerUpdateSchema,
  istToday,
  khataBalance,
  khataPaymentSchema,
  ledgerEntrySchema,
  ledgerReverseSchema,
} from '@shiv/shared';
import { Db } from './db';
import {
  AuthRequest,
  Can,
  Contract,
  fail,
  hash,
  homeShop,
  Input,
  MAIN_LOCATION,
  requireAt,
} from './http';
import { paginate } from './pagination';
import { shownPhone } from './crm/common';

// All operations for one account touch this row, including idempotent replays.
// Serializable retries then see the latest balance and receipt together.
export async function khataCustomer(tx: Prisma.TransactionClient, id: string) {
  const customer = await tx.user.findFirst({
    where: { id, deletedAt: null, role: { not: 'ADMIN' } },
  });
  if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
  return tx.user.update({ where: { id }, data: { updatedAt: new Date() } });
}

export async function appendLedger(
  tx: Prisma.TransactionClient,
  input: {
    customerId: string;
    kind: LedgerKind;
    amountPaise: number;
    actorId: string;
    note: string;
    occurredAt: Date;
    idempotencyKey?: string;
    requestHash?: string;
    orderId?: string;
    financialMovementId?: string;
    reversesId?: string;
    locationId?: string;
  },
) {
  const customer = await khataCustomer(tx, input.customerId);
  let balanceAfterPaise: number;
  try {
    balanceAfterPaise = khataBalance(customer.khataBalancePaise, input.amountPaise);
  } catch {
    fail('KHATA_OVERFLOW', 'Khata balance exceeds the supported range.', 409);
  }
  const entry = await tx.customerLedgerEntry.create({ data: { ...input, balanceAfterPaise } });
  await tx.user.update({
    where: { id: customer.id },
    data: { khataBalancePaise: balanceAfterPaise },
  });
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      event: `KHATA_${input.kind}`,
      entityId: customer.id,
      details: {
        entryId: entry.id,
        amountPaise: input.amountPaise,
        balanceAfterPaise,
        orderId: input.orderId ?? null,
        reversesId: input.reversesId ?? null,
        financialMovementId: input.financialMovementId ?? null,
      },
    },
  });
  return entry;
}

/**
 * Udhaar is owed from the moment the goods leave (plan 10 conflict 8, and family question F3 can
 * overturn it): the first of being loaded, going out, or being delivered. The ledger's one entry per
 * order means every later step finds this one and adds nothing.
 */
export async function postCreditSale(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    number: string;
    userId: string;
    locationId: string;
    totalPaise: number;
    payment?: { method: string } | null;
  },
  actorId: string,
) {
  if (order.payment?.method !== 'CREDIT') return;
  if (
    await tx.customerLedgerEntry.findUnique({ where: { orderId: order.id }, select: { id: true } })
  )
    return;
  await appendLedger(tx, {
    locationId: order.locationId,
    customerId: order.userId,
    kind: 'SALE_ON_CREDIT',
    amountPaise: order.totalPaise,
    orderId: order.id,
    actorId,
    note: `Credit sale ${order.number}`,
    occurredAt: new Date(),
  });
}

/** The goods came back or never went, so the customer owes nothing for them. Happens only once. */
export async function reverseCreditSale(
  tx: Prisma.TransactionClient,
  orderId: string,
  actorId: string,
  note: string,
) {
  const sale = await tx.customerLedgerEntry.findUnique({
    where: { orderId },
    include: { reversal: { select: { id: true } } },
  });
  if (!sale || sale.kind !== 'SALE_ON_CREDIT' || sale.reversal) return;
  await appendLedger(tx, {
    locationId: sale.locationId,
    customerId: sale.customerId,
    kind: 'REVERSAL',
    amountPaise: -sale.amountPaise,
    actorId,
    note,
    occurredAt: new Date(),
    reversesId: sale.id,
    idempotencyKey: `sale-back:${sale.id}`,
    requestHash: hash(`sale-back:${sale.id}`),
  });
}

function businessTime(value?: string) {
  const time = value
    ? new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value)
    : new Date();
  if (!Number.isFinite(time.getTime()) || time > new Date())
    fail('INVALID_BUSINESS_DATE', 'Choose a valid date no later than today.');
  return time;
}

/** Whose drawer took this cash. Someone at two shops must say, or it lands in the wrong one. */
function drawerFor(req: AuthRequest, asked?: string) {
  if (asked) {
    requireAt(req, 'money.receive', asked);
    return asked;
  }
  const scope = req.access['money.receive'];
  if (Array.isArray(scope) && scope.length > 1)
    fail('SHOP_REQUIRED', 'Choose which shop took this money.', 400);
  return homeShop(req);
}

@Injectable()
export class KhataService {
  constructor(@Inject(Db) private db: Db) {}

  async record(
    customerId: string,
    input: z.infer<typeof ledgerEntrySchema> & {
      channel?: 'CASH' | 'UPI';
    },
    actorId: string,
    payment: boolean,
    locationId: string = MAIN_LOCATION,
  ) {
    const requestHash = hash(
      JSON.stringify({ ...input, operation: payment ? 'PAYMENT' : 'ADJUST' }),
    );
    return this.db.atomic(async (tx) => {
      const customer = await khataCustomer(tx, customerId);
      const previous = await tx.customerLedgerEntry.findUnique({
        where: {
          customerId_idempotencyKey: { customerId, idempotencyKey: input.idempotencyKey },
        },
      });
      if (previous) {
        if (previous.requestHash !== requestHash)
          fail(
            'IDEMPOTENCY_CONFLICT',
            'This key was already used for a different khata entry.',
            409,
          );
        return previous;
      }
      const occurredAt = businessTime(input.occurredAt);
      // The signed opening is where this customer's book starts. Nothing can be slipped in before it.
      const signoff = await tx.khataSignoff.findFirst({
        where: { customerId },
        select: { asOf: true },
      });
      if (signoff && occurredAt < new Date(`${signoff.asOf}T00:00:00+05:30`))
        fail('BEFORE_SIGNOFF', 'This date is before the signed opening balance.', 409);
      // An opening balance comes only from the signed opening sheet, never from a first entry.
      const kind = payment ? 'PAYMENT_RECEIVED' : 'ADJUSTMENT';
      const financial = payment
        ? await tx.financialMovement.create({
            data: {
              kind: 'KHATA_PAYMENT',
              locationId,
              amountPaise: input.amountPaise,
              actorId,
              // The ledger keeps the business date. Cash entered a drawer now, whatever the date
              // says, or a back-dated receipt would land in a day already closed.
              occurredAt: (input.channel ?? 'CASH') === 'CASH' ? new Date() : occurredAt,
              channel: input.channel ?? 'CASH',
              counterParty: customerId,
            },
          })
        : undefined;
      // A payment may leave an advance balance; credit permission is needed for sales only.
      return appendLedger(tx, {
        locationId,
        customerId: customer.id,
        kind,
        amountPaise: payment ? -input.amountPaise : input.amountPaise,
        actorId,
        occurredAt,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        financialMovementId: financial?.id,
      });
    });
  }

  async reverse(
    customerId: string,
    entryId: string,
    input: z.infer<typeof ledgerReverseSchema>,
    actorId: string,
  ) {
    const requestHash = hash(JSON.stringify({ ...input, entryId, operation: 'REVERSE' }));
    return this.db.atomic(async (tx) => {
      await khataCustomer(tx, customerId);
      const previous = await tx.customerLedgerEntry.findUnique({
        where: {
          customerId_idempotencyKey: { customerId, idempotencyKey: input.idempotencyKey },
        },
      });
      if (previous) {
        if (previous.requestHash !== requestHash)
          fail(
            'IDEMPOTENCY_CONFLICT',
            'This key was already used for a different khata entry.',
            409,
          );
        return previous;
      }
      const original = await tx.customerLedgerEntry.findFirst({
        where: { id: entryId, customerId },
        include: { reversal: true, financialMovement: true },
      });
      if (!original) fail('ENTRY_NOT_FOUND', 'Khata entry not found.', 404);
      if (original.kind === 'REVERSAL' || original.reversal)
        fail(
          'INVALID_REVERSAL',
          'An entry can be reversed once; a reversal cannot be reversed.',
          409,
        );
      // What an owner signed is where this book starts, and it can never be signed again.
      if (
        await tx.khataSignoff.findFirst({ where: { ledgerEntryId: entryId }, select: { id: true } })
      )
        fail('INVALID_REVERSAL', 'A signed opening stays. Correct it with an adjustment.', 409);
      const occurredAt = new Date();
      const financial = original.financialMovement
        ? await tx.financialMovement.create({
            data: {
              kind: 'KHATA_PAYMENT_REVERSAL',
              locationId: original.financialMovement.locationId,
              amountPaise: original.financialMovement.amountPaise,
              channel: original.financialMovement.channel,
              actorId,
              occurredAt,
              counterParty: customerId,
            },
          })
        : undefined;
      return appendLedger(tx, {
        locationId: original.locationId,
        customerId,
        kind: 'REVERSAL',
        amountPaise: -original.amountPaise,
        actorId,
        occurredAt,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        reversesId: entryId,
        financialMovementId: financial?.id,
      });
    });
  }

  async summary() {
    return this.db.atomic(async (tx) => {
      const totals = await tx.user.aggregate({
        where: {
          deletedAt: null,
          role: { not: 'ADMIN' },
          khataBalancePaise: { gt: 0 },
        },
        _sum: { khataBalancePaise: true },
        _count: true,
      });
      const cutoff = new Date(`${istToday()}T00:00:00+05:30`);
      cutoff.setTime(cutoff.getTime() - 30 * 86400000);
      // FIFO aging: later payments/credits pay down the oldest debt first.
      const overdue30d = await tx.$queryRaw<
        {
          id: string;
          name: string;
          phone: string;
          balancePaise: number;
          overduePaise: number;
        }[]
      >`SELECT u.id, u.name, u.phone, u."khataBalancePaise" AS "balancePaise",
        LEAST(u."khataBalancePaise", SUM(CASE WHEN e."occurredAt" < ${cutoff.toISOString()}::timestamp
          OR e."amountPaise" < 0 OR e.kind = 'OPENING_BALANCE' THEN e."amountPaise" ELSE 0 END))::integer AS "overduePaise"
        FROM "User" u JOIN "CustomerLedgerEntry" e ON e."customerId" = u.id
        WHERE u."deletedAt" IS NULL AND u.role <> 'ADMIN' AND u."khataBalancePaise" > 0
        GROUP BY u.id HAVING SUM(CASE WHEN e."occurredAt" < ${cutoff.toISOString()}::timestamp
          OR e."amountPaise" < 0 OR e.kind = 'OPENING_BALANCE' THEN e."amountPaise" ELSE 0 END) > 0
        ORDER BY "overduePaise" DESC, u.id`;
      return {
        totalDuePaise: totals._sum.khataBalancePaise ?? 0,
        customersWithDue: totals._count,
        overdue30d,
      };
    });
  }

  async checkBalances() {
    const drift = await this.db.atomic(
      (tx) => tx.$queryRaw<
        {
          customerId: string;
          cachedPaise: number;
          actualPaise: string;
        }[]
      >`SELECT u.id AS "customerId", u."khataBalancePaise" AS "cachedPaise",
        COALESCE(SUM(e."amountPaise"), 0)::text AS "actualPaise"
      FROM "User" u LEFT JOIN "CustomerLedgerEntry" e ON e."customerId" = u.id
      GROUP BY u.id HAVING u."khataBalancePaise" <> COALESCE(SUM(e."amountPaise"), 0)`,
    );
    for (const row of drift)
      console.error(
        JSON.stringify({ event: 'KHATA_DRIFT', ...row, timestamp: new Date().toISOString() }),
      );
    return { checked: true, drift: drift.length };
  }
}

@ApiTags('Customer khata and CRM')
@Controller('admin')
export class KhataController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(KhataService) private khata: KhataService,
  ) {}

  @Can('khata.read.one')
  @Get('customers/:id/khata')
  ledger(@Param('id') id: string, @Query() query: Record<string, string>, @Req() req: AuthRequest) {
    const page = paginate(query, `khata:${id}`);
    return this.db.atomic(async (tx) => {
      const customer = await tx.user.findFirst({
        where: { id, deletedAt: null, role: { not: 'ADMIN' } },
      });
      if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
      const entries = page.finish(
        await tx.customerLedgerEntry.findMany({
          where: { customerId: id, ...page.after },
          include: {
            reversal: { select: { id: true } },
            order: { select: { locationId: true } },
            reverses: { select: { order: { select: { locationId: true } } } },
          },
          orderBy: page.orderBy,
          take: page.take,
        }),
      );
      const signoff = await tx.khataSignoff.findFirst({
        where: { customerId: id },
        select: { asOf: true, chosenPaise: true, createdAt: true },
      });
      return {
        balancePaise: customer.khataBalancePaise,
        creditAllowed: customer.creditAllowed,
        creditLimitPaise: customer.creditLimitPaise,
        signoff,
        // The balance belongs to the whole firm. An order's note names the order, which stays with
        // the shop that took it.
        entries: {
          ...entries,
          items: entries.items.map(({ order, reverses, ...row }) => {
            // Taking a sale back names the same order, so it stays with the same shop.
            const sale = order ?? reverses?.order;
            return sale && !canDo(req.access, 'orders.read', sale.locationId)
              ? { ...row, note: '', orderId: null }
              : row;
          }),
        },
      };
    });
  }

  @Can('khata.payment')
  @Post('customers/:id/khata/payment')
  @Contract(khataPaymentSchema)
  payment(
    @Param('id') id: string,
    @Input(khataPaymentSchema) input: z.infer<typeof khataPaymentSchema>,
    @Req() req: AuthRequest,
  ) {
    const { locationId: asked, ...entry } = input;
    return this.khata.record(id, entry, req.user.id, true, drawerFor(req, asked));
  }
  @Can('khata.adjust')
  @Post('customers/:id/khata/adjust')
  @Contract(ledgerEntrySchema)
  adjust(
    @Param('id') id: string,
    @Input(ledgerEntrySchema) input: z.infer<typeof ledgerEntrySchema>,
    @Req() req: AuthRequest,
  ) {
    return this.khata.record(id, input, req.user.id, false, homeShop(req));
  }
  @Can('khata.reverse')
  @Post('customers/:id/khata/reverse/:entryId')
  @Contract(ledgerReverseSchema)
  reverse(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Input(ledgerReverseSchema) input: z.infer<typeof ledgerReverseSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.khata.reverse(id, entryId, input, req.user.id);
  }
  @Can('khata.read.list') @Get('khata/summary') async summary(@Req() req: AuthRequest) {
    const summary = await this.khata.summary();
    return {
      ...summary,
      overdue30d: summary.overdue30d.map((row) => ({ ...row, phone: shownPhone(req, row.phone) })),
    };
  }

  @Can('khata.credit.set')
  @Patch('customers/:id')
  @Contract(customerUpdateSchema)
  update(
    @Param('id') id: string,
    @Input(customerUpdateSchema) input: z.infer<typeof customerUpdateSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const customer = await khataCustomer(tx, id);
      const next = { ...customer, ...input };
      if (next.creditAllowed && next.creditLimitPaise === null)
        fail('CREDIT_LIMIT_REQUIRED', 'Set a credit limit before enabling credit.');
      // Sales cannot go in before the opening they sit on top of. It may be a signed nothing.
      if (
        input.creditAllowed &&
        !customer.creditAllowed &&
        !(await tx.khataSignoff.findFirst({ where: { customerId: id }, select: { id: true } }))
      )
        fail('OPENING_NOT_SIGNED', 'Sign off this customer’s opening balance first.', 409);
      const updated = await tx.user.update({ where: { id }, data: input });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'CUSTOMER_UPDATED',
          entityId: id,
          details: {
            before: {
              creditAllowed: customer.creditAllowed,
              creditLimitPaise: customer.creditLimitPaise,
            },
            after: {
              ...(input.creditAllowed === undefined ? {} : { creditAllowed: input.creditAllowed }),
              ...(input.creditLimitPaise === undefined
                ? {}
                : { creditLimitPaise: input.creditLimitPaise }),
            },
          },
        },
      });
      return { ...updated, balancePaise: updated.khataBalancePaise };
    });
  }

  @Can('customers.note')
  @Post('customers/:id/notes')
  @Contract(customerNoteSchema)
  note(
    @Param('id') id: string,
    @Input(customerNoteSchema) input: z.infer<typeof customerNoteSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      await khataCustomer(tx, id);
      const note = await tx.customerNote.create({
        data: { customerId: id, actorId: req.user.id, ...input },
      });
      await tx.user.update({ where: { id }, data: { notesCount: { increment: 1 } } });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'CUSTOMER_NOTE_ADDED',
          entityId: id,
          details: { noteId: note.id },
        },
      });
      return note;
    });
  }
  @Can('customers.read')
  @Get('customers/:id/notes')
  async notes(@Param('id') id: string, @Query() query: Record<string, string>) {
    if (!(await this.db.user.findFirst({ where: { id, deletedAt: null, role: { not: 'ADMIN' } } })))
      fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
    const page = paginate(query, `customer-notes:${id}`);
    return page.finish(
      await this.db.customerNote.findMany({
        where: { customerId: id, ...page.after },
        orderBy: page.orderBy,
        take: page.take,
      }),
    );
  }
  @Can('customers.note')
  @Post('customers/:id/contacts')
  @Contract(customerContactSchema)
  contact(
    @Param('id') id: string,
    @Input(customerContactSchema) input: z.infer<typeof customerContactSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      await khataCustomer(tx, id);
      const contact = await tx.customerContact.create({
        data: {
          customerId: id,
          actorId: req.user.id,
          ...input,
          kind: input.channel === 'CALL' ? 'CALL' : 'MESSAGE',
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'CUSTOMER_CONTACTED',
          entityId: id,
          details: { contactId: contact.id, channel: input.channel },
        },
      });
      return contact;
    });
  }
}
