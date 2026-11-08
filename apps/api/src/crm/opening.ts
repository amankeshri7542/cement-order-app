import {
  Controller,
  Get,
  HttpException,
  Inject,
  Injectable,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import {
  canDo,
  istToday,
  khataViewSchema,
  openingApproveSchema,
  openingDraftSchema,
  reminderStopSchema,
} from '@shiv/shared';
import { z } from 'zod';
import { Db } from '../db';
import {
  AuthRequest,
  Can,
  Contract,
  errorCause,
  fail,
  hash,
  Input,
  MAIN_LOCATION,
  Self,
  Firm,
} from '../http';
import { activeFirm, firmsOf, MAIN_FIRM, requireCustomerVisible, requireFirm } from '../firms';
import { appendLedger, khataCustomer } from '../khata';
import { paginate } from '../pagination';
import { setStopped } from './customer-page';
import { dayStart, phoneFields, realCustomer, wire } from './common';
import { TallyNumbers } from './tally-numbers';

const rowResult = (customerId: string, status: 'SIGNED' | 'ALREADY', chosenPaise: number) => ({
  customerId,
  status,
  chosenPaise,
});

@Injectable()
export class OpeningSheet {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(TallyNumbers) private tally: TallyNumbers,
  ) {}

  /** Paper's figure goes in until an owner signs. Then this row is history, and cannot move. */
  async draft(
    input: z.infer<typeof openingDraftSchema>,
    actorId: string,
    seesTally: boolean,
    firms: 'ALL' | string[] = 'ALL',
  ) {
    if (input.asOf > istToday() || input.asOf < '2020-01-01')
      fail('INVALID_BUSINESS_DATE', 'Choose a valid date no later than today.');
    const locationId = input.locationId ?? MAIN_LOCATION;
    const number = seesTally
      ? (await this.tally.forCustomers([input.customerId])).get(input.customerId)
      : undefined;
    return this.db.atomic(async (tx) => {
      const customer = await tx.user.findFirst({
        where: { id: input.customerId, ...realCustomer },
        select: { id: true },
      });
      if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
      const shop = await tx.location.findFirst({
        where: { id: locationId, active: true },
        select: { id: true, firmId: true },
      });
      if (!shop) fail('INVALID_SHOP', 'That shop is not open.', 400);
      // Each firm's opening is its own: the one asked for, or the shop's.
      const firmId = input.firmId ? await activeFirm(tx, input.firmId) : shop.firmId;
      if (firms !== 'ALL' && !firms.includes(firmId))
        fail('FORBIDDEN', 'You do not have access to this firm’s khata.', 403);
      if (await tx.khataSignoff.findFirst({ where: { customerId: input.customerId, firmId } }))
        fail('ALREADY_SIGNED', 'This customer’s opening is already signed off.', 409);
      const figures = {
        locationId,
        asOf: input.asOf,
        paperPaise: input.paperPaise,
        note: input.note ?? '',
      };
      const key = { customerId_firmId: { customerId: input.customerId, firmId } };
      const was = await tx.khataOpeningDraft.findUnique({ where: key });
      // Sending the same figures again keeps the version, so an owner's page stays good.
      if (
        was &&
        was.locationId === figures.locationId &&
        was.asOf === figures.asOf &&
        was.paperPaise === figures.paperPaise &&
        was.note === figures.note
      )
        return this.draftView(was);
      const tallyFacts = {
        tallyPaise: number?.tallyPaise ? BigInt(number.tallyPaise) : null,
        tallyAsOf: number?.asOf ?? null,
      };
      const row = was
        ? await tx.khataOpeningDraft.update({
            where: key,
            data: { ...figures, ...tallyFacts, enteredById: actorId, version: { increment: 1 } },
          })
        : await tx.khataOpeningDraft.create({
            data: {
              customerId: input.customerId,
              firmId,
              ...figures,
              ...tallyFacts,
              enteredById: actorId,
            },
          });
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'KHATA_OPENING_DRAFTED',
          entityId: input.customerId,
          locationId,
          details: {
            asOf: input.asOf,
            paperPaise: input.paperPaise,
            version: row.version,
            firmId,
          },
        },
      });
      return this.draftView(row);
    });
  }

  draftView(row: Prisma.KhataOpeningDraftGetPayload<object>) {
    return {
      customerId: row.customerId,
      firmId: row.firmId,
      locationId: row.locationId,
      asOf: row.asOf,
      paperPaise: row.paperPaise,
      tallyPaise: wire(row.tallyPaise),
      tallyAsOf: row.tallyAsOf,
      note: row.note,
      version: row.version,
      enteredById: row.enteredById,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * One row of the sheet, in its own transaction, so one refused row leaves the rest signed. Writes
   * the opening entry and the sign-off together, and only an exact repeat of it is let through.
   */
  async sign(
    row: z.infer<typeof openingApproveSchema>['rows'][number],
    approverId: string,
    firms: 'ALL' | string[] = 'ALL',
  ) {
    const { customerId, chosenPaise, draftVersion } = row;
    return this.db.atomic(async (tx) => {
      await khataCustomer(tx, customerId);
      // The firm named on the row, or the customer's only draft. Two drafts need the row to say which.
      let firmId = row.firmId;
      if (!firmId) {
        const drafts = await tx.khataOpeningDraft.findMany({
          where: { customerId },
          select: { firmId: true },
        });
        if (drafts.length > 1) fail('FIRM_REQUIRED', 'Say which firm this opening is for.', 400);
        firmId = drafts[0]?.firmId ?? MAIN_FIRM;
      }
      if (firms !== 'ALL' && !firms.includes(firmId))
        fail('FORBIDDEN', 'You do not have access to this firm’s khata.', 403);
      const draft = await tx.khataOpeningDraft.findUnique({
        where: { customerId_firmId: { customerId, firmId } },
      });
      const previous = await tx.khataSignoff.findFirst({ where: { customerId, firmId } });
      if (previous) {
        const same = hash(JSON.stringify({ chosenPaise, draftVersion }));
        if (previous.requestHash !== same)
          fail('ALREADY_SIGNED', 'This customer’s opening is already signed off.', 409);
        return rowResult(customerId, 'ALREADY', previous.chosenPaise);
      }
      if (!draft)
        fail('OPENING_NOT_DRAFTED', 'Type the paper figure for this customer first.', 409);
      if (draft.version !== draftVersion)
        fail('DRAFT_CHANGED', 'This figure changed after you opened the sheet. Look again.', 409, {
          version: draft.version,
          paperPaise: draft.paperPaise,
        });
      if (chosenPaise !== draft.paperPaise && !row.reason)
        fail('REASON_NEEDED', 'Say why this differs from the paper figure.');
      const cutoff = dayStart(draft.asOf);
      // An earlier live entry would count this debt twice. Reverse it first, in plain sight.
      const earlier = await tx.customerLedgerEntry.count({
        where: {
          customerId,
          firmId,
          kind: { not: 'REVERSAL' },
          reversal: null,
          OR: [{ occurredAt: { lt: cutoff } }, { kind: 'OPENING_BALANCE' }],
        },
      });
      if (earlier)
        fail('ENTRIES_BEFORE_CUTOFF', 'This customer has entries from before the cut-off.', 409, {
          entries: earlier,
        });
      // Nothing owed moves no money, so there is no entry, only the owner's word.
      const entry = chosenPaise
        ? await appendLedger(tx, {
            locationId: draft.locationId,
            firmId,
            customerId,
            kind: 'OPENING_BALANCE',
            amountPaise: chosenPaise,
            actorId: approverId,
            note: `Purana hisaab ${draft.asOf} tak ka`,
            occurredAt: cutoff,
            idempotencyKey: `opening:${firmId}`,
            requestHash: hash(`opening:${customerId}:${firmId}`),
          })
        : null;
      await tx.khataSignoff.create({
        data: {
          customerId,
          firmId,
          locationId: draft.locationId,
          asOf: draft.asOf,
          paperPaise: draft.paperPaise,
          tallyPaise: draft.tallyPaise,
          chosenPaise,
          reason: row.reason ?? '',
          enteredById: draft.enteredById,
          approvedById: approverId,
          ledgerEntryId: entry?.id ?? null,
          requestHash: hash(JSON.stringify({ chosenPaise, draftVersion })),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: approverId,
          event: 'KHATA_SIGNED_OFF',
          entityId: customerId,
          locationId: draft.locationId,
          details: {
            asOf: draft.asOf,
            paperPaise: draft.paperPaise,
            chosenPaise,
            enteredById: draft.enteredById,
            firmId,
          },
        },
      });
      return rowResult(customerId, 'SIGNED', chosenPaise);
    });
  }
}

@ApiTags('Customer khata and CRM')
@Controller('admin')
export class OpeningSheetController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(OpeningSheet) private sheet: OpeningSheet,
    @Inject(TallyNumbers) private tally: TallyNumbers,
  ) {}

  /** Everyone with udhaar history, or with a row started, biggest first. Search finds the rest. */
  @Firm('own')
  @Can('khata.opening.draft')
  @Get('khata/opening-sheet')
  async list(@Query() query: Record<string, unknown>, @Req() req: AuthRequest) {
    const parsed = z
      .object({
        q: z.string().trim().max(100).default(''),
        status: z.enum(['pending', 'signed', 'all']).default('pending'),
        firmId: z.string().min(1).max(60).optional(),
      })
      .safeParse({ q: query.q, status: query.status, firmId: query.firmId || undefined });
    if (!parsed.success) fail('INVALID_FILTER', 'Check the filters.');
    const { q, status } = parsed.data;
    // The sheet is one firm's: the one asked for, or this person's first.
    const mine = firmsOf(req);
    const firmId = parsed.data.firmId ?? (mine === 'ALL' ? MAIN_FIRM : mine[0]);
    if (!firmId) fail('FORBIDDEN', 'You do not have access to any firm’s khata.', 403);
    requireFirm(req, firmId, 'khata.opening.draft');
    const page = paginate(
      { limit: query.limit, cursor: query.cursor },
      JSON.stringify({ list: 'opening-sheet', q, status, firmId }),
      'khataBalancePaise',
    );
    // Part of a number is a way to discover numbers, for anyone who may not see them.
    const seesPhone = canDo(req.access, 'customers.phone.read');
    const fields =
      seesPhone || /^\+91[6-9]\d{9}$/.test(q) ? ['name', 'phone', 'area'] : ['name', 'area'];
    const someone: Prisma.UserWhereInput = q
      ? { OR: fields.map((field) => ({ [field]: { contains: q, mode: 'insensitive' } })) }
      : {
          OR: [
            { ledgerEntries: { some: { firmId } } },
            { khataOpeningDrafts: { some: { firmId } } },
            { creditAllowed: true },
            { khataSignoffs: { some: { firmId } } },
          ],
        };
    const statusWhere: Prisma.UserWhereInput =
      status === 'pending'
        ? { khataSignoffs: { none: { firmId } } }
        : status === 'signed'
          ? { khataSignoffs: { some: { firmId } } }
          : {};
    const [rows, pending, signed] = await Promise.all([
      this.db.user.findMany({
        where: { ...realCustomer, AND: [someone, statusWhere, page.after] },
        orderBy: page.orderBy,
        take: page.take,
        select: {
          id: true,
          name: true,
          area: true,
          phone: true,
          khataBalancePaise: true,
          creditAllowed: true,
          khataViewOn: true,
          khataOpeningDrafts: { where: { firmId } },
          khataSignoffs: { where: { firmId }, take: 1 },
          firmBalances: { where: { firmId }, select: { balancePaise: true } },
        },
      }),
      this.db.user.count({
        where: { ...realCustomer, AND: [someone, { khataSignoffs: { none: { firmId } } }] },
      }),
      this.db.user.count({
        where: { ...realCustomer, AND: [someone, { khataSignoffs: { some: { firmId } } }] },
      }),
    ]);
    const finished = page.finish(rows);
    const seesTally = canDo(req.access, 'tally.numbers.view');
    const numbers = seesTally
      ? await this.tally.forCustomers(finished.items.map((row) => row.id))
      : new Map();
    return {
      ...finished,
      pending,
      signed,
      firmId,
      today: istToday(),
      items: finished.items.map((row) => {
        const signoff = row.khataSignoffs[0];
        const draft = row.khataOpeningDrafts[0];
        const tallyNow = numbers.get(row.id)?.tallyPaise ?? null;
        return {
          id: row.id,
          name: row.name,
          area: row.area,
          ...phoneFields(req, row.phone),
          // This firm's balance; the customer's total across firms stays beside it.
          appBalancePaise: row.firmBalances[0]?.balancePaise ?? 0,
          totalBalancePaise: row.khataBalancePaise,
          creditAllowed: row.creditAllowed,
          khataViewOn: row.khataViewOn,
          draft: draft ? this.sheet.draftView(draft) : null,
          ...(seesTally ? { tallyPaise: tallyNow } : {}),
          signoff: signoff
            ? {
                asOf: signoff.asOf,
                chosenPaise: signoff.chosenPaise,
                paperPaise: signoff.paperPaise,
                at: signoff.createdAt,
                reason: signoff.reason,
              }
            : null,
        };
      }),
    };
  }

  @Firm('own')
  @Can('khata.opening.draft')
  @Post('khata/opening-sheet')
  @Contract(openingDraftSchema)
  draft(
    @Input(openingDraftSchema) input: z.infer<typeof openingDraftSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.sheet.draft(
      input,
      req.user.id,
      canDo(req.access, 'tally.numbers.view'),
      firmsOf(req),
    );
  }

  /** Approve in batches. Each row stands alone, so the answer says what happened to each. */
  @Firm('own')
  @Can('khata.opening.approve')
  @Post('khata/opening-sheet/approve')
  @Contract(openingApproveSchema)
  async approve(
    @Input(openingApproveSchema) input: z.infer<typeof openingApproveSchema>,
    @Req() req: AuthRequest,
  ) {
    const results = [];
    for (const row of input.rows) {
      try {
        results.push(await this.sheet.sign(row, req.user.id, firmsOf(req)));
      } catch (error) {
        if (error instanceof HttpException) {
          const answer = error.getResponse() as { code?: string; details?: unknown };
          results.push({
            customerId: row.customerId,
            status: 'REFUSED' as const,
            code: answer.code ?? 'REQUEST_FAILED',
            ...(answer.details === undefined ? {} : { details: answer.details }),
          });
          continue;
        }
        console.error(
          JSON.stringify({
            event: 'OPENING_SIGN_FAILED',
            ...errorCause(error),
            timestamp: new Date().toISOString(),
          }),
        );
        results.push({
          customerId: row.customerId,
          status: 'REFUSED' as const,
          code: 'REQUEST_FAILED',
        });
      }
    }
    return {
      signed: results.filter((row) => row.status === 'SIGNED').length,
      already: results.filter((row) => row.status === 'ALREADY').length,
      refused: results.filter((row) => row.status === 'REFUSED').length,
      results,
    };
  }

  /**
   * The customer's own view of their udhaar. Off until an owner turns it on for them, and that needs
   * a signed opening: paper closes shop by shop, so a signature alone does not show it (plan 09).
   */
  @Firm('own')
  @Can('khata.opening.approve')
  @Put('customers/:id/khata-view')
  @Contract(khataViewSchema)
  view(
    @Param('id') id: string,
    @Input(khataViewSchema) input: z.infer<typeof khataViewSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      await requireCustomerVisible(tx, req, id);
      const customer = await tx.user.findFirst({
        where: { id, ...realCustomer },
        select: { khataViewOn: true },
      });
      if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
      if (input.on && !(await tx.khataSignoff.findFirst({ where: { customerId: id } })))
        fail('OPENING_NOT_SIGNED', 'Sign off this customer’s opening balance first.', 409);
      if (customer.khataViewOn !== input.on) {
        await tx.user.update({ where: { id }, data: { khataViewOn: input.on } });
        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            event: 'KHATA_VIEW_CHANGED',
            entityId: id,
            details: { on: input.on },
          },
        });
      }
      return { on: input.on };
    });
  }
}

/** What a customer's own app may ask. Only ever their own row, and never a note, tag or Tally. */
@ApiTags('Account')
@Controller('me')
export class MyKhataController {
  constructor(@Inject(Db) private db: Db) {}

  @Self()
  @Get('khata')
  async khata(@Query() query: Record<string, string>, @Req() req: AuthRequest) {
    const page = paginate(query, `me-khata:${req.user.id}`);
    const me = await this.db.user.findFirst({
      where: { id: req.user.id, ...realCustomer },
      select: {
        khataBalancePaise: true,
        khataViewOn: true,
        remindersStoppedAt: true,
        khataSignoffs: { take: 1, select: { asOf: true } },
      },
    });
    const signoff = me?.khataSignoffs[0];
    // Nothing is said about why, or whether there is a balance: an unsigned customer sees nothing.
    if (!me?.khataViewOn || !signoff) return { available: false as const };
    const cutoff = dayStart(signoff.asOf);
    const rows = page.finish(
      await this.db.customerLedgerEntry.findMany({
        where: {
          customerId: req.user.id,
          occurredAt: { gte: cutoff },
          // What was cleared away before the opening is the shop's own housekeeping.
          NOT: { kind: 'REVERSAL', reverses: { occurredAt: { lt: cutoff } } },
          ...page.after,
        },
        orderBy: page.orderBy,
        take: page.take,
        select: {
          id: true,
          createdAt: true,
          kind: true,
          amountPaise: true,
          occurredAt: true,
          order: { select: { number: true } },
          financialMovement: { select: { channel: true } },
        },
      }),
    );
    return {
      available: true as const,
      balancePaise: me.khataBalancePaise,
      asOf: signoff.asOf,
      remindersStopped: Boolean(me.remindersStoppedAt),
      nextCursor: rows.nextCursor,
      entries: rows.items.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        amountPaise: entry.amountPaise,
        on: entry.occurredAt,
        orderNumber: entry.order?.number ?? null,
        channel: entry.financialMovement?.channel ?? '',
      })),
    };
  }

  /** A customer's own word about reminders. They may also change their mind. */
  @Self()
  @Put('reminders')
  @Contract(reminderStopSchema)
  reminders(
    @Input(reminderStopSchema) input: z.infer<typeof reminderStopSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const me = await tx.user.findUniqueOrThrow({
        where: { id: req.user.id },
        select: { remindersStoppedAt: true },
      });
      await setStopped(tx, req.user.id, input.stopped, me.remindersStoppedAt, req.user.id);
      return { stopped: input.stopped };
    });
  }
}
