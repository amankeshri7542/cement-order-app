import { Controller, Get, Inject, Injectable, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import {
  advanceAskSchema,
  advanceGiveSchema,
  deductionsAllowed,
  istToday,
  ledgerReverseEntrySchema,
  monthSchema,
  payAdjustmentReverseSchema,
  payAdjustmentSchema,
  paymentAckSchema,
  payLockSchema,
  payPaymentSchema,
  payRecoverySchema,
  payTermsSchema,
  workOutPay,
} from '@shiv/shared';
import { t } from '@shiv/i18n';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApprovalsService, askApproval } from '../approvals';
import { Db } from '../db';
import {
  AuthRequest,
  Can,
  Contract,
  fail,
  Input,
  requireAt,
  scoped,
  Self,
  shopWhere,
} from '../http';

type Tx = Prisma.TransactionClient;
type Give = z.infer<typeof advanceGiveSchema>;

const monthEnd = (month: string) => {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
};
const monthStartAt = (month: string) => new Date(`${month}-01T00:00:00+05:30`);
const monthEndAt = (month: string) =>
  new Date(`${monthEnd(month)}T00:00:00+05:30`).getTime() + 86400000;
const checkedMonth = (month: string) => {
  const parsed = monthSchema.safeParse(month);
  if (!parsed.success) fail('BAD_DAY', 'Choose a month.');
  return parsed.data;
};

const ledgerFields = [
  'userId',
  'account',
  'kind',
  'amountPaise',
  'balanceAfterPaise',
  'month',
  'channel',
  'paidFrom',
  'locationId',
  'utr',
  'recoveryPaise',
  'reversesId',
  'idempotencyKey',
  'actorId',
  'approvedById',
  'serverAt',
  'note',
] as const;
type LedgerRow = Partial<Record<(typeof ledgerFields)[number], unknown>>;
const ledgerHash = (prevHash: string, seq: number, row: LedgerRow) =>
  createHash('sha256')
    .update(prevHash)
    .update(
      JSON.stringify([
        seq,
        ...ledgerFields.map((name) => {
          const value = row[name];
          return value instanceof Date ? value.toISOString() : (value ?? null);
        }),
      ]),
    )
    .digest('hex');
export const payStream = (userId: string) => `pay:${userId}`;

/** The first entry that no longer adds up, or null. Altered or missing rows break the chain. */
export function ledgerBrokenAt(
  rows: readonly (LedgerRow & { seq: number; prevHash: string; hash: string })[],
) {
  let prev = '';
  let seq = 1;
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (row.seq !== seq || row.prevHash !== prev || ledgerHash(prev, row.seq, row) !== row.hash)
      return seq;
    prev = row.hash;
    seq++;
  }
  return null;
}

type Entry = {
  userId: string;
  account: 'WAGES' | 'ADVANCE';
  kind: string;
  amountPaise: number;
  /** How the balance moves. Amounts on the record stay positive. */
  deltaPaise: number;
  month?: string | null;
  channel?: string;
  paidFrom?: string;
  locationId?: string | null;
  utr?: string;
  recoveryPaise?: number | null;
  reversesId?: string | null;
  idempotencyKey: string;
  actorId: string;
  approvedById?: string | null;
  note?: string;
};
async function appendLedger(tx: Tx, input: Entry) {
  const stream = payStream(input.userId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${stream}))`;
  const last = await tx.staffLedgerEntry.findFirst({
    where: { stream },
    orderBy: { seq: 'desc' },
    select: { seq: true, hash: true },
  });
  const lastInAccount = await tx.staffLedgerEntry.findFirst({
    where: { stream, account: input.account },
    orderBy: { seq: 'desc' },
    select: { balanceAfterPaise: true },
  });
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? '';
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const { deltaPaise, ...rest } = input;
  const row = {
    ...rest,
    month: input.month ?? null,
    channel: input.channel ?? '',
    paidFrom: input.paidFrom ?? '',
    locationId: input.locationId ?? null,
    utr: input.utr ?? '',
    recoveryPaise: input.recoveryPaise ?? null,
    reversesId: input.reversesId ?? null,
    approvedById: input.approvedById ?? null,
    note: input.note ?? '',
    balanceAfterPaise: (lastInAccount?.balanceAfterPaise ?? 0) + deltaPaise,
    serverAt: new Date(clock!.now.getTime()),
  };
  return tx.staffLedgerEntry.create({
    data: { ...row, stream, seq, prevHash, hash: ledgerHash(prevHash, seq, row) },
  });
}
async function balanceOf(tx: Pick<Tx, 'staffLedgerEntry'>, userId: string, account: string) {
  const last = await tx.staffLedgerEntry.findFirst({
    where: { stream: payStream(userId), account },
    orderBy: { seq: 'desc' },
    select: { balanceAfterPaise: true },
  });
  return last?.balanceAfterPaise ?? 0;
}

/** Money from the drawer shows there without a name; a payment from the owner's own account does not. */
async function drawerMovement(
  tx: Tx,
  kind: 'STAFF_PAY' | 'STAFF_ADVANCE' | 'STAFF_PAY_REVERSAL',
  amountPaise: number,
  locationId: string,
  actorId: string,
) {
  await tx.financialMovement.create({
    data: { kind, amountPaise, locationId, channel: 'CASH', actorId, counterParty: '' },
  });
}
async function checkDrawer(
  tx: Pick<Tx, 'location'>,
  body: { paidFrom: string; channel: string; locationId?: string | undefined },
) {
  if (body.paidFrom !== 'GALLA') return;
  if (body.channel !== 'CASH') fail('INVALID_INPUT', 'The drawer only pays out in cash.', 400);
  if (!body.locationId) fail('SHOP_NEEDED', 'Say which shop’s drawer this came from.', 400);
  const shop = await tx.location.findUnique({
    where: { id: body.locationId },
    select: { active: true },
  });
  if (!shop?.active) fail('INVALID_SHOP', 'That shop is not open on this system.', 400);
}

@Injectable()
export class Salary {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(ApprovalsService) approvals: ApprovalsService,
  ) {
    approvals.giveAdvance = (tx, payload, actorId, approvedById) =>
      this.giveIn(tx, payload as Give, actorId, approvedById);
  }

  // ---- Terms ------------------------------------------------------------------------------

  async setTerms(userId: string, body: z.infer<typeof payTermsSchema>, actorId: string) {
    if (userId === actorId) fail('OWN_RECORD', 'Someone else must set your own pay.', 403);
    return this.db.atomic(async (tx) => {
      const person = await tx.staffMembership.findFirst({
        where: { userId, endedAt: null },
        select: { id: true },
      });
      if (!person) fail('NOT_ASSIGNED', 'This person is not on the staff.', 404);
      // A month already locked keeps its figures, so nothing may be dated inside it.
      const locked = await tx.payRun.findFirst({
        where: { status: 'LOCKED', month: { gte: body.effectiveFrom.slice(0, 7) } },
        select: { month: true },
      });
      if (locked) fail('MONTH_LOCKED', 'That month is locked. Choose a later date.', 409);
      // A date that has come keeps its figure. A later row, or a line on the month, shows the change.
      const same = await tx.staffPayTerms.findUnique({
        where: { userId_effectiveFrom: { userId, effectiveFrom: body.effectiveFrom } },
        select: { amountPaise: true },
      });
      if (same && same.amountPaise !== body.amountPaise && body.effectiveFrom <= istToday())
        fail('PAY_TERMS_DATED', 'Pay from that date is already set. Use a later date.', 409);
      await tx.staffPayTerms.upsert({
        where: { userId_effectiveFrom: { userId, effectiveFrom: body.effectiveFrom } },
        create: { ...body, userId, createdById: actorId },
        update: { amountPaise: body.amountPaise, createdById: actorId },
      });
      // Ids only: amounts never sit in the activity log.
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'PAY_TERMS_CHANGED',
          entityId: userId,
          details: { effectiveFrom: body.effectiveFrom },
        },
      });
      return { ok: true };
    });
  }
  private async termsOn(tx: Pick<Tx, 'staffPayTerms'>, userId: string, day: string) {
    return tx.staffPayTerms.findFirst({
      where: { userId, effectiveFrom: { lte: day } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  // ---- The month --------------------------------------------------------------------------

  /** One person's figures for a month, as they stand right now. Nothing here is on the record yet. */
  private async workedFor(tx: Tx, userId: string, month: string, monthlyPaise: number) {
    const rows = await tx.payAdjustment.findMany({
      where: { month, userId },
      orderBy: { createdAt: 'asc' },
    });
    const reversed = new Set(rows.flatMap((row) => (row.reversesId ? [row.reversesId] : [])));
    const live = rows.filter((row) => !row.reversesId && !reversed.has(row.id));
    const sum = (kind: string) =>
      live.filter((row) => row.kind === kind).reduce((total, row) => total + row.amountPaise, 0);
    const recoverySet = live.filter((row) => row.kind === 'RECOVERY_SET').at(-1);
    const advanceBalancePaise = await balanceOf(tx, userId, 'ADVANCE');
    const given = await tx.staffLedgerEntry.findFirst({
      where: { stream: payStream(userId), kind: 'ADVANCE_GIVEN', recoveryPaise: { not: null } },
      orderBy: { seq: 'desc' },
      select: { recoveryPaise: true },
    });
    const line = workOutPay({
      monthlyPaise,
      additionsPaise: sum('ADDITION'),
      deductionsPaise: sum('DEDUCTION'),
      plannedRecoveryPaise: recoverySet ? recoverySet.amountPaise : (given?.recoveryPaise ?? 0),
      advanceBalancePaise,
    });
    const days = await tx.attendanceDay.findMany({
      where: { userId, day: { gte: `${month}-01`, lte: monthEnd(month) } },
      select: { status: true, lateMinutes: true, flags: true, firstInAt: true, minutes: true },
    });
    return {
      line,
      advanceBalancePaise,
      adjustments: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        amountPaise: row.amountPaise,
        reason: row.reason,
        reversesId: row.reversesId,
        live: live.includes(row),
        at: row.createdAt,
      })),
      // Facts beside the pay. None of them moves a rupee by itself.
      facts: {
        daysPresent: days.filter((row) => row.firstInAt).length,
        daysLate: days.filter((row) => row.lateMinutes > 0).length,
        weeklyOffsWorked: days.filter((row) => row.flags.includes('WORKED_WEEKLY_OFF')).length,
        missingOut: days.filter((row) => row.flags.includes('NO_OUT')).length,
      },
    };
  }

  private async people(tx: Pick<Tx, 'staffMembership' | 'user'>) {
    const members = await tx.staffMembership.findMany({
      where: { endedAt: null },
      select: { userId: true, role: true },
    });
    const ids = [...new Set(members.map((row) => row.userId))];
    const people = await tx.user.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    // Owners and the technical login draw no salary, so nobody needs to be told to set one.
    return people.map((person) => ({
      ...person,
      draws: members.some(
        (row) => row.userId === person.id && !['OWNER', 'TECH_OPERATOR'].includes(row.role),
      ),
    }));
  }

  async month(month: string) {
    checkedMonth(month);
    return this.db.$transaction(async (tx) => {
      const run = await tx.payRun.findUnique({ where: { month } });
      const people = await this.people(tx);
      const lines = [];
      const noTerms = [];
      for (const person of people) {
        const wagesDuePaise = await balanceOf(tx, person.id, 'WAGES');
        if (run?.status === 'LOCKED') {
          const frozen = await tx.payLine.findUnique({
            where: { payRunId_userId: { payRunId: run.id, userId: person.id } },
          });
          if (frozen) {
            lines.push({
              userId: person.id,
              name: person.name,
              locked: true,
              slip: frozen.slip,
              netPaise: frozen.netPaise,
              paidPaise: await this.paidIn(tx, person.id, month),
              wagesDuePaise,
            });
          }
          continue;
        }
        const terms = await this.termsOn(tx, person.id, monthEnd(month));
        if (!terms) {
          if (person.draws) noTerms.push({ userId: person.id, name: person.name });
          continue;
        }
        const worked = await this.workedFor(tx, person.id, month, terms.amountPaise);
        lines.push({
          userId: person.id,
          name: person.name,
          locked: false,
          monthlyPaise: terms.amountPaise,
          ...worked,
          netPaise: worked.line.netPaise,
          paidPaise: 0,
          wagesDuePaise,
        });
      }
      const openReviews = await tx.attendanceReview.count({
        where: {
          status: 'OPEN',
          createdAt: { gte: monthStartAt(month), lt: new Date(monthEndAt(month)) },
        },
      });
      return {
        month,
        status: run?.status ?? 'DRAFT',
        lockedAt: run?.lockedAt ?? null,
        over: month < istToday().slice(0, 7),
        openReviews,
        lines,
        noTerms,
      };
    });
  }
  private async paidIn(tx: Pick<Tx, 'staffLedgerEntry'>, userId: string, month: string) {
    const rows = await tx.staffLedgerEntry.findMany({
      where: { stream: payStream(userId), month, kind: 'PAID' },
      select: { id: true, amountPaise: true },
    });
    const reversed = await tx.staffLedgerEntry.findMany({
      where: { reversesId: { in: rows.map((row) => row.id) } },
      select: { reversesId: true },
    });
    return rows
      .filter((row) => !reversed.some((entry) => entry.reversesId === row.id))
      .reduce((sum, row) => sum + row.amountPaise, 0);
  }

  private async mustBeOpen(tx: Pick<Tx, 'payRun'>, month: string) {
    const run = await tx.payRun.findUnique({ where: { month } });
    if (run?.status === 'LOCKED')
      fail('MONTH_LOCKED', 'This month is locked. Add it to next month instead.', 409);
  }

  /** Every line has a reason. The limit on deductions is a hard refusal, not a warning. */
  async adjust(month: string, body: z.infer<typeof payAdjustmentSchema>, actorId: string) {
    checkedMonth(month);
    if (body.userId === actorId) fail('OWN_RECORD', 'Someone else must change your own pay.', 403);
    return this.db.atomic(async (tx) => {
      const earlier = await tx.payAdjustment.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      });
      if (earlier) {
        if (
          earlier.userId !== body.userId ||
          earlier.amountPaise !== body.amountPaise ||
          earlier.kind !== body.kind ||
          earlier.month !== month
        )
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return { id: earlier.id };
      }
      await this.mustBeOpen(tx, month);
      const terms = await this.termsOn(tx, body.userId, monthEnd(month));
      if (!terms) fail('NO_PAY_TERMS', 'Set this person’s pay first.', 409);
      const row = await tx.payAdjustment.create({ data: { ...body, month, actorId } });
      const { line } = await this.workedFor(tx, body.userId, month, terms.amountPaise);
      if (!deductionsAllowed(line.earnedPaise, line.deductionsPaise))
        fail('DEDUCTIONS_OVER_LIMIT', 'This takes more than half the month’s pay.', 400, {
          roomPaise: Math.floor(line.earnedPaise / 2),
        });
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'PAY_ADJUSTED',
          entityId: row.id,
          details: { month, userId: body.userId, kind: body.kind },
        },
      });
      return { id: row.id };
    });
  }
  async setRecovery(month: string, body: z.infer<typeof payRecoverySchema>, actorId: string) {
    checkedMonth(month);
    if (body.userId === actorId) fail('OWN_RECORD', 'Someone else must change your own pay.', 403);
    return this.db.atomic(async (tx) => {
      await this.mustBeOpen(tx, month);
      const row = await tx.payAdjustment.create({
        data: {
          month,
          userId: body.userId,
          kind: 'RECOVERY_SET',
          amountPaise: body.recoveryPaise,
          reason: body.reason,
          actorId,
          idempotencyKey: `recovery:${month}:${body.userId}:${Date.now()}`,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'PAY_RECOVERY_SET',
          entityId: row.id,
          details: { month, userId: body.userId },
        },
      });
      return { id: row.id };
    });
  }
  async reverseAdjustment(
    id: string,
    body: z.infer<typeof payAdjustmentReverseSchema>,
    actorId: string,
  ) {
    return this.db.atomic(async (tx) => {
      const row = await tx.payAdjustment.findUnique({ where: { id } });
      if (!row) fail('NOT_FOUND', 'That line is not here.', 404);
      if (row.userId === actorId) fail('OWN_RECORD', 'Someone else must change your own pay.', 403);
      await this.mustBeOpen(tx, row.month);
      if (row.reversesId) fail('REVERSED_ALREADY', 'This is itself a reversal.', 409);
      const already = await tx.payAdjustment.findUnique({ where: { reversesId: id } });
      if (already) fail('REVERSED_ALREADY', 'This was already taken back.', 409);
      await tx.payAdjustment.create({
        data: {
          month: row.month,
          userId: row.userId,
          kind: 'REVERSAL',
          amountPaise: row.amountPaise,
          reason: body.reason,
          actorId,
          reversesId: id,
          idempotencyKey: `reverse:${id}`,
        },
      });
      // Taking back an addition lowers what the limit on deductions is worked on.
      const terms = await this.termsOn(tx, row.userId, monthEnd(row.month));
      if (terms) {
        const { line } = await this.workedFor(tx, row.userId, row.month, terms.amountPaise);
        if (!deductionsAllowed(line.earnedPaise, line.deductionsPaise))
          fail('DEDUCTIONS_OVER_LIMIT', 'This takes more than half the month’s pay.', 400, {
            roomPaise: Math.floor(line.earnedPaise / 2),
          });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'PAY_ADJUSTMENT_REVERSED',
          entityId: id,
          details: { month: row.month, userId: row.userId },
        },
      });
      return { ok: true };
    });
  }

  /** "Yeh system ka hisaab hai. Pakka malik karta hai." Once locked, a month is never reopened. */
  async lock(month: string, actorId: string) {
    checkedMonth(month);
    if (month >= istToday().slice(0, 7))
      fail('MONTH_NOT_OVER', 'A month can be locked once it is over.', 409);
    return this.db.atomic(async (tx) => {
      const existing = await tx.payRun.findUnique({ where: { month } });
      if (existing?.status === 'LOCKED') fail('MONTH_LOCKED', 'This month is already locked.', 409);
      const open = await tx.attendanceReview.count({
        where: {
          status: 'OPEN',
          createdAt: { gte: monthStartAt(month), lt: new Date(monthEndAt(month)) },
        },
      });
      if (open)
        fail('REVIEWS_OPEN', 'Settle the hazri cards from this month first.', 409, { open });
      const run = await tx.payRun.upsert({
        where: { month },
        create: { month, status: 'LOCKED', lockedById: actorId, lockedAt: new Date() },
        update: { status: 'LOCKED', lockedById: actorId, lockedAt: new Date() },
      });
      const people = await this.people(tx);
      let count = 0;
      for (const person of people) {
        const terms = await this.termsOn(tx, person.id, monthEnd(month));
        if (!terms) continue;
        const worked = await this.workedFor(tx, person.id, month, terms.amountPaise);
        // The rate may have dropped since a deduction was written. A slip is never a minus.
        if (!deductionsAllowed(worked.line.earnedPaise, worked.line.deductionsPaise))
          fail('DEDUCTIONS_OVER_LIMIT', 'This takes more than half the month’s pay.', 409, {
            userId: person.id,
            roomPaise: Math.floor(worked.line.earnedPaise / 2),
          });
        const slip = {
          month,
          name: person.name,
          monthlyPaise: terms.amountPaise,
          ...worked.line,
          adjustments: worked.adjustments
            .filter((row) => row.live && row.kind !== 'RECOVERY_SET')
            .map((row) => ({ kind: row.kind, amountPaise: row.amountPaise, reason: row.reason })),
          facts: worked.facts,
          advanceLeftPaise: worked.advanceBalancePaise - worked.line.recoveryPaise,
          lockedAt: new Date().toISOString(),
        };
        const slipHash = createHash('sha256').update(JSON.stringify(slip)).digest('hex');
        await tx.payLine.create({
          data: {
            payRunId: run.id,
            userId: person.id,
            slip: slip as unknown as Prisma.InputJsonValue,
            slipHash,
            netPaise: worked.line.netPaise,
          },
        });
        await appendLedger(tx, {
          userId: person.id,
          account: 'WAGES',
          kind: 'EARNED',
          amountPaise: worked.line.netPaise,
          deltaPaise: worked.line.netPaise,
          month,
          idempotencyKey: `earned:${month}:${person.id}`,
          actorId,
        });
        if (worked.line.recoveryPaise)
          await appendLedger(tx, {
            userId: person.id,
            account: 'ADVANCE',
            kind: 'ADVANCE_RECOVERED',
            amountPaise: worked.line.recoveryPaise,
            deltaPaise: -worked.line.recoveryPaise,
            month,
            idempotencyKey: `recover:${month}:${person.id}`,
            actorId,
          });
        count++;
      }
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'PAY_MONTH_LOCKED',
          entityId: run.id,
          details: { month, people: count },
        },
      });
      return { month, status: 'LOCKED', people: count };
    });
  }

  /** A month's pay can be recorded only once its slip exists. */
  async pay(month: string, body: z.infer<typeof payPaymentSchema>, actorId: string) {
    checkedMonth(month);
    if (body.userId === actorId) fail('OWN_RECORD', 'Someone else must pay you.', 403);
    return this.db.atomic(async (tx) => {
      const earlier = await tx.staffLedgerEntry.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      });
      if (earlier) {
        if (
          earlier.userId !== body.userId ||
          earlier.amountPaise !== body.amountPaise ||
          earlier.kind !== 'PAID' ||
          earlier.month !== month
        )
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return { id: earlier.id };
      }
      const run = await tx.payRun.findUnique({ where: { month } });
      if (run?.status !== 'LOCKED')
        fail('MONTH_NOT_LOCKED', 'Lock this month before recording its pay.', 409);
      const line = await tx.payLine.findUnique({
        where: { payRunId_userId: { payRunId: run.id, userId: body.userId } },
      });
      if (!line) fail('NOT_FOUND', 'This person has no pay this month.', 404);
      await checkDrawer(tx, body);
      const due = await balanceOf(tx, body.userId, 'WAGES');
      if (body.amountPaise > due)
        fail('PAYING_TOO_MUCH', 'This is more than is owed. Use an advance for extra.', 409, {
          duePaise: due,
        });
      const entry = await appendLedger(tx, {
        userId: body.userId,
        account: 'WAGES',
        kind: 'PAID',
        amountPaise: body.amountPaise,
        deltaPaise: -body.amountPaise,
        month,
        channel: body.channel,
        paidFrom: body.paidFrom,
        locationId: body.locationId ?? null,
        utr: body.utr ?? '',
        idempotencyKey: body.idempotencyKey,
        actorId,
      });
      if (body.paidFrom === 'GALLA')
        await drawerMovement(tx, 'STAFF_PAY', body.amountPaise, body.locationId!, actorId);
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'PAY_RECORDED',
          entityId: entry.id,
          details: { month, userId: body.userId, channel: body.channel, paidFrom: body.paidFrom },
        },
      });
      return { id: entry.id };
    });
  }

  // ---- Advances ---------------------------------------------------------------------------

  private async giveIn(tx: Tx, body: Give, actorId: string, approvedById?: string) {
    const earlier = await tx.staffLedgerEntry.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
    });
    if (earlier) {
      if (
        earlier.userId !== body.userId ||
        earlier.amountPaise !== body.amountPaise ||
        earlier.kind !== 'ADVANCE_GIVEN'
      )
        fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
      return earlier;
    }
    if (body.userId === actorId) fail('OWN_REQUEST', 'Someone else must give you an advance.', 403);
    const person = await tx.staffMembership.findFirst({
      where: { userId: body.userId, endedAt: null },
      select: { id: true },
    });
    if (!person) fail('NOT_ASSIGNED', 'This person is not on the staff.', 404);
    await checkDrawer(tx, body);
    const entry = await appendLedger(tx, {
      userId: body.userId,
      account: 'ADVANCE',
      kind: 'ADVANCE_GIVEN',
      amountPaise: body.amountPaise,
      deltaPaise: body.amountPaise,
      channel: body.channel,
      paidFrom: body.paidFrom,
      locationId: body.locationId ?? null,
      utr: body.utr ?? '',
      recoveryPaise: body.recoveryPaise,
      idempotencyKey: body.idempotencyKey,
      actorId,
      approvedById: approvedById ?? actorId,
      note: body.note ?? '',
    });
    if (body.paidFrom === 'GALLA')
      await drawerMovement(tx, 'STAFF_ADVANCE', body.amountPaise, body.locationId!, actorId);
    await tx.auditLog.create({
      data: {
        actorId,
        event: 'ADVANCE_GIVEN',
        entityId: entry.id,
        details: { userId: body.userId, paidFrom: body.paidFrom },
      },
    });
    return entry;
  }
  async give(body: Give, actorId: string) {
    const entry = await this.db.atomic((tx) => this.giveIn(tx, body, actorId));
    return { id: entry.id };
  }
  /** A manager or cashier can ask. Only an owner says yes, through Manzoori. */
  async ask(body: z.infer<typeof advanceAskSchema>, req: AuthRequest) {
    if (body.userId === req.user.id) fail('OWN_REQUEST', 'Someone else must ask for you.', 403);
    return this.db.atomic(async (tx) => {
      const member = await tx.staffMembership.findFirst({
        where: { userId: body.userId, endedAt: null, locationId: { not: null } },
        select: { locationId: true },
      });
      if (!member?.locationId) fail('NOT_ASSIGNED', 'This person is not at a shop.', 404);
      requireAt(req, 'approvals.ask', member.locationId);
      // Asking for damage or a transfer is one thing. Asking for money needs the people who hold it.
      requireAt(req, 'cash.count', member.locationId);
      const paidFrom = body.paidFrom ?? 'OWNER';
      // Only a drawer the person asking handles, and the card shows the owner which one it is.
      const drawer = paidFrom === 'GALLA' ? (body.locationId ?? member.locationId) : null;
      if (drawer) requireAt(req, 'cash.count', drawer);
      const asked = await askApproval(tx, {
        kind: 'ADVANCE',
        locationId: drawer ?? member.locationId,
        amountPaise: body.amountPaise,
        payload: {
          ...body,
          channel: body.channel ?? 'CASH',
          paidFrom,
          ...(drawer ? { locationId: drawer } : {}),
        },
        requestedById: req.user.id,
        idempotencyKey: `advance:${body.idempotencyKey}`,
        ...(body.note ? { note: body.note } : {}),
      });
      return { id: asked.id, status: asked.status };
    });
  }

  /**
   * Whoever may ask for an advance has to say who it is for. A cashier has no other list of people,
   * so this gives names at their own shops, and nothing about anyone's pay.
   */
  async askable(req: AuthRequest) {
    const members = await this.db.staffMembership.findMany({
      where: { endedAt: null, locationId: { not: null }, ...shopWhere(req, 'cash.count') },
      select: { userId: true },
    });
    const items = await this.db.user.findMany({
      where: {
        id: { in: [...new Set(members.map((row) => row.userId))], not: req.user.id },
        deletedAt: null,
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { items };
  }

  /** A mistake gets an opposite entry with a reason, and both show. */
  async reverse(id: string, body: z.infer<typeof ledgerReverseEntrySchema>, actorId: string) {
    return this.db.atomic(async (tx) => {
      const earlier = await tx.staffLedgerEntry.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      });
      if (earlier) {
        if (earlier.reversesId !== id)
          fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return { id: earlier.id };
      }
      const entry = await tx.staffLedgerEntry.findUnique({ where: { id } });
      if (!entry) fail('NOT_FOUND', 'That entry is not here.', 404);
      if (!['PAID', 'ADVANCE_GIVEN'].includes(entry.kind))
        fail('INVALID_INPUT', 'Only a payment or an advance can be taken back here.', 400);
      if (entry.userId === actorId)
        fail('OWN_RECORD', 'Someone else must change your own pay.', 403);
      // What wages have already paid back cannot be un-given: that would leave a minus nobody owes.
      if (
        entry.kind === 'ADVANCE_GIVEN' &&
        (await balanceOf(tx, entry.userId, 'ADVANCE')) < entry.amountPaise
      )
        fail(
          'ADVANCE_RECOVERED',
          'Part of this has already come back from pay. Add it to next month instead.',
          409,
        );
      const taken = await tx.staffLedgerEntry.findUnique({ where: { reversesId: id } });
      if (taken) fail('REVERSED_ALREADY', 'This was already taken back.', 409);
      const back = await appendLedger(tx, {
        userId: entry.userId,
        account: entry.account as 'WAGES' | 'ADVANCE',
        kind: 'REVERSAL',
        amountPaise: entry.amountPaise,
        deltaPaise: entry.kind === 'PAID' ? entry.amountPaise : -entry.amountPaise,
        month: entry.month,
        reversesId: id,
        idempotencyKey: body.idempotencyKey,
        actorId,
        note: body.reason,
      });
      if (entry.paidFrom === 'GALLA' && entry.locationId)
        await drawerMovement(
          tx,
          'STAFF_PAY_REVERSAL',
          entry.amountPaise,
          entry.locationId,
          actorId,
        );
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'PAY_ENTRY_REVERSED',
          entityId: id,
          details: { userId: entry.userId, kind: entry.kind },
        },
      });
      return { id: back.id };
    });
  }

  async ledger(userId: string) {
    const rows = await this.db.staffLedgerEntry.findMany({
      where: { stream: payStream(userId) },
      orderBy: { seq: 'desc' },
      take: 100,
    });
    const acks = await this.db.paymentAck.findMany({
      where: { entryId: { in: rows.map((row) => row.id) } },
    });
    const all = await this.db.staffLedgerEntry.findMany({ where: { stream: payStream(userId) } });
    return {
      userId,
      advancePaise: await balanceOf(this.db, userId, 'ADVANCE'),
      wagesDuePaise: await balanceOf(this.db, userId, 'WAGES'),
      chainOk: ledgerBrokenAt(all) === null,
      items: rows.map((row) => ({
        id: row.id,
        account: row.account,
        kind: row.kind,
        amountPaise: row.amountPaise,
        balanceAfterPaise: row.balanceAfterPaise,
        month: row.month,
        channel: row.channel,
        paidFrom: row.paidFrom,
        utr: row.utr,
        note: row.note,
        reversesId: row.reversesId,
        reversed: rows.some((other) => other.reversesId === row.id),
        at: row.serverAt,
        ack: acks.find((ack) => ack.entryId === row.id)?.answer ?? null,
      })),
    };
  }
  async terms() {
    const people = await this.people(this.db as unknown as Tx);
    const today = istToday();
    const items = [];
    for (const person of people) {
      const terms = await this.termsOn(this.db, person.id, today);
      items.push({
        userId: person.id,
        name: person.name,
        amountPaise: terms?.amountPaise ?? null,
        effectiveFrom: terms?.effectiveFrom ?? null,
        advancePaise: await balanceOf(this.db, person.id, 'ADVANCE'),
        wagesDuePaise: await balanceOf(this.db, person.id, 'WAGES'),
      });
    }
    return { items };
  }
  async runs() {
    const rows = await this.db.payRun.findMany({
      orderBy: { month: 'desc' },
      take: 36,
      select: { month: true, status: true, lockedAt: true },
    });
    return { items: rows };
  }

  /** Spreadsheet of a locked month, for the accountant. */
  async csv(month: string) {
    checkedMonth(month);
    const run = await this.db.payRun.findUnique({
      where: { month },
      include: { lines: true },
    });
    if (run?.status !== 'LOCKED') fail('MONTH_NOT_LOCKED', 'Lock this month first.', 409);
    const cell = (value: string) => {
      // A name beginning like a formula must stay text, when opened in a spreadsheet.
      const safe = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
      return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
    };
    const rupees = (paise: number) => (paise / 100).toFixed(2);
    const rows = [
      ['Name', 'Monthly', 'Additions', 'Deductions', 'Advance recovered', 'Round off', 'Net'].join(
        ',',
      ),
      ...run.lines.map((row) => {
        const slip = row.slip as {
          name: string;
          monthlyPaise: number;
          earnedPaise: number;
          deductionsPaise: number;
          recoveryPaise: number;
          roundOffPaise: number;
          netPaise: number;
        };
        return [
          cell(slip.name),
          rupees(slip.monthlyPaise),
          rupees(slip.earnedPaise - slip.monthlyPaise),
          rupees(slip.deductionsPaise),
          rupees(slip.recoveryPaise),
          rupees(slip.roundOffPaise),
          rupees(slip.netPaise),
        ].join(',');
      }),
    ];
    return `\ufeff${rows.join('\n')}\n`;
  }

  // ---- A person's own -----------------------------------------------------------------------

  async mine(req: AuthRequest) {
    const userId = req.user.id;
    const [terms, advancePaise, wagesDuePaise, rows, lines] = await Promise.all([
      this.termsOn(this.db, userId, istToday()),
      balanceOf(this.db, userId, 'ADVANCE'),
      balanceOf(this.db, userId, 'WAGES'),
      this.db.staffLedgerEntry.findMany({
        where: { stream: payStream(userId), kind: { in: ['PAID', 'ADVANCE_GIVEN', 'REVERSAL'] } },
        orderBy: { seq: 'desc' },
        take: 24,
      }),
      this.db.payLine.findMany({
        where: { userId },
        select: { netPaise: true, payRun: { select: { month: true } } },
        orderBy: { payRun: { month: 'desc' } },
        take: 24,
      }),
    ]);
    const acks = await this.db.paymentAck.findMany({
      where: { entryId: { in: rows.map((row) => row.id) } },
    });
    const reversed = new Set(rows.flatMap((row) => (row.reversesId ? [row.reversesId] : [])));
    return {
      monthlyPaise: terms?.amountPaise ?? null,
      advancePaise,
      wagesDuePaise,
      payments: rows
        .filter((row) => row.kind !== 'REVERSAL' && !reversed.has(row.id))
        .map((row) => ({
          id: row.id,
          kind: row.kind,
          amountPaise: row.amountPaise,
          channel: row.channel,
          month: row.month,
          at: row.serverAt,
          ack: acks.find((ack) => ack.entryId === row.id)?.answer ?? null,
        })),
      slips: lines.map((line) => ({ month: line.payRun.month, netPaise: line.netPaise })),
    };
  }
  async mySlip(month: string, req: AuthRequest) {
    checkedMonth(month);
    const run = await this.db.payRun.findUnique({ where: { month } });
    const line = run
      ? await this.db.payLine.findUnique({
          where: { payRunId_userId: { payRunId: run.id, userId: req.user.id } },
        })
      : null;
    if (!line) fail('NOT_FOUND', 'There is no slip for this month.', 404);
    return { month, slip: line.slip };
  }
  /** "Mil gaya?" Both sides on the record. "Nahi mila" reaches the owners at once. */
  async ack(id: string, body: z.infer<typeof paymentAckSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const entry = await tx.staffLedgerEntry.findUnique({ where: { id } });
      if (!entry || !['PAID', 'ADVANCE_GIVEN'].includes(entry.kind))
        fail('NOT_FOUND', 'That payment is not here.', 404);
      if (entry.userId !== req.user.id) fail('NOT_YOUR_PAYMENT', 'This is not your payment.', 403);
      await tx.paymentAck.upsert({
        where: { entryId: id },
        create: { entryId: id, userId: req.user.id, answer: body.answer },
        update: { answer: body.answer, at: new Date() },
      });
      if (body.answer === 'NOT_GOT') {
        const owners = await tx.user.findMany({
          where: {
            role: 'ADMIN',
            deletedAt: null,
            staffPausedAt: null,
            staffMemberships: { some: { role: 'OWNER', endedAt: null } },
          },
          select: { id: true, language: true },
        });
        // No name or amount on a lock screen.
        await tx.notification.createMany({
          data: owners.map((owner) => ({
            userId: owner.id,
            dedupeKey: `pay-not-got:${id}:${owner.id}`,
            title: t('owner.salary.notGotTitle', {}, owner.language === 'en' ? 'en' : 'hi'),
            body: t('owner.salary.notGotBody', {}, owner.language === 'en' ? 'en' : 'hi'),
          })),
          skipDuplicates: true,
        });
      }
      return { id, answer: body.answer };
    });
  }
}

@ApiTags('Salary')
@Controller()
export class SalaryController {
  constructor(@Inject(Salary) private salary: Salary) {}

  @Can('staff.salary.read') @Get('admin/salary/terms') terms() {
    return this.salary.terms();
  }
  @Can('staff.salary.pay')
  @Put('admin/salary/terms/:id')
  @Contract(payTermsSchema)
  setTerms(
    @Param('id') id: string,
    @Input(payTermsSchema) body: z.infer<typeof payTermsSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.salary.setTerms(id, body, req.user.id);
  }
  @Can('staff.salary.read') @Get('admin/salary/runs') runs() {
    return this.salary.runs();
  }
  @Can('staff.salary.read') @Get('admin/salary/runs/:month') month(@Param('month') month: string) {
    return this.salary.month(month);
  }
  @Can('staff.salary.read') @Get('admin/salary/runs/:month/export.csv') async csv(
    @Param('month') month: string,
    @Res() res: Response,
  ) {
    // Read first: this checks the month, which then goes into a header.
    const sheet = await this.salary.csv(month);
    res
      .status(200)
      .type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="shiv-salary-${month}.csv"`)
      .send(sheet);
  }
  @Can('staff.salary.pay')
  @Post('admin/salary/runs/:month/adjustments')
  @Contract(payAdjustmentSchema)
  adjust(
    @Param('month') month: string,
    @Input(payAdjustmentSchema) body: z.infer<typeof payAdjustmentSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.salary.adjust(month, body, req.user.id);
  }
  @Can('staff.salary.pay')
  @Post('admin/salary/runs/:month/recovery')
  @Contract(payRecoverySchema)
  recovery(
    @Param('month') month: string,
    @Input(payRecoverySchema) body: z.infer<typeof payRecoverySchema>,
    @Req() req: AuthRequest,
  ) {
    return this.salary.setRecovery(month, body, req.user.id);
  }
  @Can('staff.salary.pay')
  @Post('admin/salary/adjustments/:id/reverse')
  @Contract(payAdjustmentReverseSchema)
  reverseAdjustment(
    @Param('id') id: string,
    @Input(payAdjustmentReverseSchema) body: z.infer<typeof payAdjustmentReverseSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.salary.reverseAdjustment(id, body, req.user.id);
  }
  @Can('staff.salary.pay')
  @Post('admin/salary/runs/:month/lock')
  @Contract(payLockSchema)
  lock(
    @Param('month') month: string,
    @Input(payLockSchema) _body: z.infer<typeof payLockSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.salary.lock(month, req.user.id);
  }
  @Can('staff.salary.pay')
  @Post('admin/salary/runs/:month/pay')
  @Contract(payPaymentSchema)
  pay(
    @Param('month') month: string,
    @Input(payPaymentSchema) body: z.infer<typeof payPaymentSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.salary.pay(month, body, req.user.id);
  }
  @Can('staff.salary.pay')
  @Post('admin/salary/advances')
  @Contract(advanceGiveSchema)
  give(@Input(advanceGiveSchema) body: z.infer<typeof advanceGiveSchema>, @Req() req: AuthRequest) {
    return this.salary.give(body, req.user.id);
  }
  @Can('cash.count', scoped) @Get('admin/salary/advances/people') askable(@Req() req: AuthRequest) {
    return this.salary.askable(req);
  }
  @Can('approvals.ask', scoped)
  @Post('admin/salary/advances/ask')
  @Contract(advanceAskSchema)
  ask(@Input(advanceAskSchema) body: z.infer<typeof advanceAskSchema>, @Req() req: AuthRequest) {
    return this.salary.ask(body, req);
  }
  @Can('staff.salary.read') @Get('admin/salary/people/:id') ledger(@Param('id') id: string) {
    return this.salary.ledger(id);
  }
  @Can('staff.salary.pay')
  @Post('admin/salary/ledger/:id/reverse')
  @Contract(ledgerReverseEntrySchema)
  reverse(
    @Param('id') id: string,
    @Input(ledgerReverseEntrySchema) body: z.infer<typeof ledgerReverseEntrySchema>,
    @Req() req: AuthRequest,
  ) {
    return this.salary.reverse(id, body, req.user.id);
  }
  @Self() @Get('staff/me/pay') mine(@Req() req: AuthRequest) {
    return this.salary.mine(req);
  }
  @Self() @Get('staff/me/slips/:month') slip(
    @Param('month') month: string,
    @Req() req: AuthRequest,
  ) {
    return this.salary.mySlip(month, req);
  }
  @Self()
  @Post('staff/me/payments/:id/ack')
  @Contract(paymentAckSchema)
  ack(
    @Param('id') id: string,
    @Input(paymentAckSchema) body: z.infer<typeof paymentAckSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.salary.ack(id, body, req);
  }
}
