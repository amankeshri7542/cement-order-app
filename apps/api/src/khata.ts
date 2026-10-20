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
import { Admin, AuthRequest, Contract, Input, fail, hash } from './http';
import { paginate } from './pagination';

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

function businessTime(value?: string) {
  const time = value
    ? new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value)
    : new Date();
  if (!Number.isFinite(time.getTime()) || time > new Date())
    fail('INVALID_BUSINESS_DATE', 'Choose a valid date no later than today.');
  return time;
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
      const kind = payment
        ? 'PAYMENT_RECEIVED'
        : (await tx.customerLedgerEntry.count({ where: { customerId } }))
          ? 'ADJUSTMENT'
          : 'OPENING_BALANCE';
      const financial = payment
        ? await tx.financialMovement.create({
            data: {
              kind: 'KHATA_PAYMENT',
              amountPaise: input.amountPaise,
              actorId,
              occurredAt,
              channel: input.channel ?? 'CASH',
              counterParty: customerId,
            },
          })
        : undefined;
      // A payment may leave an advance balance; credit permission is needed for sales only.
      return appendLedger(tx, {
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
      const occurredAt = new Date();
      const financial = original.financialMovement
        ? await tx.financialMovement.create({
            data: {
              kind: 'KHATA_PAYMENT_REVERSAL',
              amountPaise: original.financialMovement.amountPaise,
              channel: original.financialMovement.channel,
              actorId,
              occurredAt,
              counterParty: customerId,
            },
          })
        : undefined;
      return appendLedger(tx, {
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
        LEAST(u."khataBalancePaise", SUM(CASE WHEN e."occurredAt" < ${cutoff}
          OR e."amountPaise" < 0 THEN e."amountPaise" ELSE 0 END))::integer AS "overduePaise"
        FROM "User" u JOIN "CustomerLedgerEntry" e ON e."customerId" = u.id
        WHERE u."deletedAt" IS NULL AND u.role <> 'ADMIN' AND u."khataBalancePaise" > 0
        GROUP BY u.id HAVING SUM(CASE WHEN e."occurredAt" < ${cutoff}
          OR e."amountPaise" < 0 THEN e."amountPaise" ELSE 0 END) > 0
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
@Admin()
@Controller('admin')
export class KhataController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(KhataService) private khata: KhataService,
  ) {}

  @Get('customers/:id/khata')
  ledger(@Param('id') id: string, @Query() query: Record<string, string>) {
    const page = paginate(query, `khata:${id}`);
    return this.db.atomic(async (tx) => {
      const customer = await tx.user.findFirst({
        where: { id, deletedAt: null, role: { not: 'ADMIN' } },
      });
      if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
      const entries = page.finish(
        await tx.customerLedgerEntry.findMany({
          where: { customerId: id, ...page.after },
          include: { reversal: { select: { id: true } } },
          orderBy: page.orderBy,
          take: page.take,
        }),
      );
      return {
        balancePaise: customer.khataBalancePaise,
        creditAllowed: customer.creditAllowed,
        creditLimitPaise: customer.creditLimitPaise,
        entries,
      };
    });
  }

  @Post('customers/:id/khata/payment')
  @Contract(khataPaymentSchema)
  payment(
    @Param('id') id: string,
    @Input(khataPaymentSchema) input: z.infer<typeof khataPaymentSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.khata.record(id, input, req.user.id, true);
  }
  @Post('customers/:id/khata/adjust')
  @Contract(ledgerEntrySchema)
  adjust(
    @Param('id') id: string,
    @Input(ledgerEntrySchema) input: z.infer<typeof ledgerEntrySchema>,
    @Req() req: AuthRequest,
  ) {
    return this.khata.record(id, input, req.user.id, false);
  }
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
  @Get('khata/summary') summary() {
    return this.khata.summary();
  }

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
              area: customer.area,
              tags: customer.tags,
            },
            after: input,
          },
        },
      });
      return { ...updated, balancePaise: updated.khataBalancePaise };
    });
  }

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
        data: { customerId: id, actorId: req.user.id, ...input },
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
