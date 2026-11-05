import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, TallyCompany, TallySyncJob } from '@prisma/client';
import {
  dayShift,
  istToday,
  phoneDigits,
  tallyAmountToPaise,
  tallyBaseType,
  TallyAmountError,
} from '@shiv/shared';
import { createHash } from 'node:crypto';
import { Db } from '../db';
import { errorCause } from '../http';
import { readAnswer, readSmall, TallyAnswerError, type Row } from './parse';
import { TallyParts } from './parts';
import type { ReadSpec } from './plan';

type Tx = Prisma.TransactionClient;
type ReadReport = {
  index: number;
  parts: { seq: number; sha256: string }[];
  bytes: number;
  tookMs: number;
  readAt: number;
  counts?: string[];
};
export type JobReport = { reads: ReadReport[]; marksAfter?: string };

/** A check failed. The rows are not applied, the watermark stays, and the job simply repeats. */
export class TallyRefusal extends Error {
  constructor(readonly problem: string) {
    super(problem);
  }
}
const FAILED_PARTS_KEPT_MS = 30 * 86400000;
const WINDOW_TOO_MANY = 2000;
const WINDOW_TOO_SLOW_MS = 20000;
/** A short read below this share of what we hold is refused (plan 09), once we hold enough to judge. */
const SHORT_READ_SHARE = 0.9;
const SHORT_READ_FROM = 20;
const ORDER_NUMBER = /\bSC-\d{4}-[0-9A-F]{8}\b/;

const id = (text: string) => {
  if (!text) throw new TallyRefusal('BAD_ROW');
  return text;
};
const count = (text: string) => {
  if (!text) return BigInt(0);
  if (!/^\d{1,18}$/.test(text)) throw new TallyRefusal('BAD_ROW');
  return BigInt(text);
};
const money = (text: string) => {
  try {
    return tallyAmountToPaise(text);
  } catch (error) {
    if (error instanceof TallyAmountError) throw new TallyRefusal('BAD_AMOUNT');
    throw error;
  }
};
const dayOf = (text: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new TallyRefusal('BAD_DATE');
  return text;
};
const yes = (text: string) => /^(yes|true|1)$/i.test(text);
const phones = (...values: string[]) => [
  ...new Set(
    values
      .flatMap((value) => value.split(/[,/;]/))
      .map((value) => phoneDigits(value))
      .filter((value) => /^[6-9]\d{9}$/.test(value))
      .map((value) => `+91${value}`),
  ),
];
const sumBig = (values: bigint[]) => values.reduce((total, value) => total + value, BigInt(0));
const clamp = (at: number, from: Date, to: Date) =>
  new Date(Math.min(Math.max(at || to.getTime(), from.getTime()), to.getTime()));

@Injectable()
export class TallyIngest {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(TallyParts) private parts: TallyParts,
  ) {}

  /** The worker's bulk lane. One job at a time per company, and a crash leaves the job to pick up. */
  async runDue(limit = 5) {
    await this.db.tallySyncJob.updateMany({
      where: { status: 'INGESTING', leaseUntil: { lt: new Date() } },
      data: { status: 'UPLOADED', leaseUntil: null },
    });
    let done = 0;
    for (; done < limit; done++) {
      const next = await this.db.tallySyncJob.findFirst({
        where: { status: 'UPLOADED' },
        orderBy: { uploadedAt: 'asc' },
      });
      if (!next) break;
      const claimed = await this.db.tallySyncJob.updateMany({
        where: { id: next.id, status: 'UPLOADED' },
        data: { status: 'INGESTING', leaseUntil: new Date(Date.now() + 10 * 60000) },
      });
      if (!claimed.count) continue;
      await this.process(next);
    }
    return done;
  }

  private async *partsOf(jobId: string, read: ReadReport) {
    for (const { seq, sha256 } of [...read.parts].sort((a, b) => a.seq - b.seq)) {
      const chunk = await this.db.tallyChunk.findUnique({ where: { jobId_seq: { jobId, seq } } });
      if (!chunk || chunk.sha256 !== sha256) throw new TallyRefusal('PART_MISSING');
      const bytes = await this.parts.get(chunk.storageKey);
      if (createHash('sha256').update(bytes).digest('hex') !== sha256)
        throw new TallyRefusal('PART_CHANGED');
      yield bytes;
    }
  }

  private async checkedCount(read: ReadReport) {
    if (!read.counts || read.counts.length !== 2) throw new TallyRefusal('COUNT_MISSING');
    const [first, second] = await Promise.all(read.counts.map((text) => readSmall('count', text)));
    const left = first?.[0]?.count ?? '';
    const right = second?.[0]?.count ?? '';
    if (!/^\d{1,12}$/.test(left)) throw new TallyRefusal('COUNT_MISSING');
    // Asked again until two answers agree: Tally can answer short under load.
    if (left !== right) throw new TallyRefusal('COUNT_UNSTABLE');
    return Number(left);
  }

  private async process(job: TallySyncJob) {
    try {
      const reads = job.reads as ReadSpec[];
      const report = job.report as JobReport;
      const answers: Row[][] = [];
      const counted: (number | null)[] = [];
      for (const [index, spec] of reads.entries()) {
        const read = report.reads.find((entry) => entry.index === index);
        if (!read) throw new TallyRefusal('PART_MISSING');
        const expected = spec.count ? await this.checkedCount(read) : null;
        const rows = await readAnswer(spec.read, this.partsOf(job.id, read));
        answers.push(rows);
        counted.push(expected);
      }
      const marksAfter = report.marksAfter ? await readSmall('companies', report.marksAfter) : null;
      const asOf = clamp(
        Math.max(...report.reads.map((read) => read.readAt)),
        job.createdAt,
        job.uploadedAt ?? new Date(),
      );
      const tookMs = Math.max(0, ...report.reads.map((read) => read.tookMs));
      const result = await this.db.$transaction(
        async (tx) => {
          const [locked] = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM "TallyCompany" WHERE id = ${job.companyId} FOR UPDATE`;
          if (!locked) throw new TallyRefusal('COMPANY_GONE');
          const company = await tx.tallyCompany.findUniqueOrThrow({ where: { id: job.companyId } });
          // Cut off while the worker was on its way to this job.
          const device = await tx.tallyDevice.findUnique({
            where: { id: job.deviceId },
            select: { revokedAt: true },
          });
          if (!device || device.revokedAt) throw new TallyRefusal('DEVICE_REVOKED');
          // Moved to another PC or set aside while this was reading: the answer is no longer wanted.
          if (company.ownerDeviceId !== job.deviceId) throw new TallyRefusal('NOT_OWNER');
          if (company.role !== 'PRIMARY') throw new TallyRefusal('NOT_PRIMARY');
          // Asked and answered for a company the PC no longer has open: this answer is someone else's.
          if (marksAfter && !marksAfter.some((row) => row.guid === company.guid))
            throw new TallyRefusal('COMPANY_MISSING');
          const params = job.params as Record<string, string | number | boolean>;
          const applied =
            job.kind === 'MASTERS'
              ? await this.applyMasters(tx, company, reads, answers, counted, params, asOf)
              : job.kind === 'BASELINE'
                ? await this.applyBaseline(tx, company, answers, counted, params)
                : job.kind === 'WINDOW'
                  ? await this.applyWindow(tx, company, answers, counted, params, tookMs)
                  : job.kind === 'DELTA'
                    ? await this.applyDelta(tx, company, answers, counted, params, asOf)
                    : await this.applySweep(tx, company, answers, counted, params, asOf);
          await this.judge(tx, company.id, job, marksAfter, applied.judge);
          await tx.tallyCompany.update({
            where: { id: company.id },
            data: { failures: 0, lastError: null, lastFailureAt: null, reconDue: true },
          });
          await tx.tallySyncJob.update({
            where: { id: job.id },
            data: {
              status: 'APPLIED',
              result: applied.stats,
              finishedAt: new Date(),
              leaseUntil: null,
            },
          });
          return applied.stats;
        },
        { timeout: 180000, maxWait: 10000 },
      );
      await this.db.tallyChunk.updateMany({
        where: { jobId: job.id },
        data: { parsedAt: new Date() },
      });
      return result;
    } catch (error) {
      const known = error instanceof TallyRefusal || error instanceof TallyAnswerError;
      const problem = known ? error.problem : 'INGEST_ERROR';
      if (!known)
        console.error(
          JSON.stringify({
            event: 'TALLY_INGEST_FAILED',
            jobId: job.id,
            ...errorCause(error),
            timestamp: new Date().toISOString(),
          }),
        );
      await this.db.tallySyncJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: problem, finishedAt: new Date(), leaseUntil: null },
      });
      await this.db.tallyCompany.update({
        where: { id: job.companyId },
        data: { failures: { increment: 1 }, lastError: problem, lastFailureAt: new Date() },
      });
      // Kept longer when parsing failed, so the reason can still be looked at.
      await this.db.tallyChunk.updateMany({
        where: { jobId: job.id },
        data: { expiresAt: new Date(Date.now() + FAILED_PARTS_KEPT_MS) },
      });
      return null;
    }
  }

  // ---- Masters ---------------------------------------------------------------------------------

  private partyRow(row: Row) {
    const gstin = row.gstin?.toUpperCase() ?? '';
    return {
      guid: id(row.guid ?? ''),
      masterId: row.masterId || null,
      alterId: count(row.alterId ?? ''),
      name: id(row.name ?? ''),
      parent: row.parent ?? '',
      phones: phones(row.mobile ?? '', row.phone ?? ''),
      gstin: /^[0-9A-Z]{15}$/.test(gstin) ? gstin : null,
      billWise: yes(row.billWise ?? ''),
      openingPaise: money(row.opening ?? ''),
      closingPaise: money(row.closing ?? ''),
    };
  }

  /** One full read of one class of party: refuse it if it is short, then upsert, then soft-delete. */
  private async applyParties(
    tx: Tx,
    company: TallyCompany,
    className: 'DEBTOR' | 'CREDITOR',
    rows: Row[],
    expected: number | null,
    asOf: Date,
    extra?: { baselineFrom: 'closing' | 'opening'; baselineOn: string },
  ) {
    if (expected !== null && expected !== rows.length) throw new TallyRefusal('COUNT_SHORT');
    const parsed = rows.map((row) => this.partyRow(row));
    const seen = new Set(parsed.map((row) => row.guid));
    if (seen.size !== parsed.length) throw new TallyRefusal('BAD_ROW');
    const held = await tx.tallyLedger.findMany({
      where: { companyId: company.id, class: className, deletedAt: null },
      select: { guid: true },
    });
    if (held.length >= SHORT_READ_FROM && parsed.length < held.length * SHORT_READ_SHARE)
      throw new TallyRefusal('SHORT_READ');
    for (const row of parsed) {
      const data = {
        masterId: row.masterId,
        alterId: row.alterId,
        name: row.name,
        parent: row.parent,
        class: className,
        phones: row.phones,
        gstin: row.gstin,
        billWise: row.billWise,
        openingPaise: row.openingPaise,
        deletedAt: null,
        // During the baseline read the "closing" is the old date's balance, not today's.
        ...(extra
          ? {
              baselinePaise: extra.baselineFrom === 'closing' ? row.closingPaise : row.openingPaise,
              baselineOn: extra.baselineOn,
            }
          : { closingPaise: row.closingPaise, closingAsOf: asOf }),
      };
      await tx.tallyLedger.upsert({
        where: { companyId_guid: { companyId: company.id, guid: row.guid } },
        // A party that first appears after the baseline owes only what Tally opened it with.
        create: {
          companyId: company.id,
          guid: row.guid,
          ...data,
          ...(extra ? {} : { baselinePaise: row.openingPaise, baselineOn: 'OPENING' }),
        },
        update: data,
      });
    }
    const gone = held.filter((row) => !seen.has(row.guid)).map((row) => row.guid);
    if (gone.length)
      await tx.tallyLedger.updateMany({
        where: { companyId: company.id, guid: { in: gone } },
        data: { deletedAt: new Date() },
      });
    return parsed.length;
  }

  /** A line read before its ledger was known finds it now, by the name it was written with. */
  private async resolveLines(tx: Tx, companyId: string) {
    await tx.$executeRaw`
      UPDATE "TallyVoucherLine" li SET "ledgerGuid" = l.guid
      FROM "TallyVoucher" v, "TallyLedger" l
      WHERE li."voucherId" = v.id AND v."companyId" = ${companyId} AND li."ledgerGuid" IS NULL
        AND l."companyId" = ${companyId} AND l.name = li."ledgerName" AND l."deletedAt" IS NULL`;
  }

  private async applyMasters(
    tx: Tx,
    company: TallyCompany,
    reads: ReadSpec[],
    answers: Row[][],
    counted: (number | null)[],
    params: Record<string, string | number | boolean>,
    asOf: Date,
  ) {
    const stats: Record<string, number> = {};
    for (const [index, spec] of reads.entries()) {
      const rows = answers[index]!;
      const expected = counted[index] ?? null;
      if (expected !== null && expected !== rows.length) throw new TallyRefusal('COUNT_SHORT');
      if (spec.read === 'parties') {
        const className = spec.params.group === 'Sundry Creditors' ? 'CREDITOR' : 'DEBTOR';
        stats[className] = await this.applyParties(tx, company, className, rows, expected, asOf);
      } else if (spec.read === 'groups') {
        for (const row of rows) {
          const guid = id(row.guid ?? '');
          const data = {
            alterId: count(row.alterId ?? ''),
            name: id(row.name ?? ''),
            parent: row.parent ?? '',
          };
          await tx.tallyGroup.upsert({
            where: { companyId_guid: { companyId: company.id, guid } },
            create: { companyId: company.id, guid, ...data },
            update: data,
          });
        }
        stats.groups = rows.length;
      } else if (spec.read === 'voucherTypes') {
        const parentOf = new Map(rows.map((row) => [row.name ?? '', row.parent ?? '']));
        for (const row of rows) {
          const guid = id(row.guid ?? '');
          const name = id(row.name ?? '');
          const data = { name, parent: row.parent ?? '', baseType: tallyBaseType(name, parentOf) };
          await tx.tallyVoucherType.upsert({
            where: { companyId_guid: { companyId: company.id, guid } },
            create: { companyId: company.id, guid, ...data },
            update: data,
          });
        }
        stats.voucherTypes = rows.length;
      } else if (spec.read === 'stockItems') {
        for (const row of rows) {
          const guid = id(row.guid ?? '');
          const data = {
            alterId: count(row.alterId ?? ''),
            name: id(row.name ?? ''),
            parent: row.parent ?? '',
            baseUnits: row.baseUnits ?? '',
            closingQtyText: row.closingQty ?? '',
            closingValuePaise: money(row.closingValue ?? ''),
            asOf,
            deletedAt: null,
          };
          await tx.tallyStockItem.upsert({
            where: { companyId_guid: { companyId: company.id, guid } },
            create: { companyId: company.id, guid, ...data },
            update: data,
          });
        }
        stats.stockItems = rows.length;
      } else if (spec.read === 'godowns') {
        for (const row of rows) {
          const guid = id(row.guid ?? '');
          const data = { name: id(row.name ?? ''), parent: row.parent ?? '' };
          await tx.tallyGodown.upsert({
            where: { companyId_guid: { companyId: company.id, guid } },
            create: { companyId: company.id, guid, ...data },
            update: data,
          });
        }
        stats.godowns = rows.length;
      }
    }
    await this.resolveLines(tx, company.id);
    const mstUpto = BigInt(String(params.mstUpto ?? '0'));
    await tx.tallyCompany.update({
      where: { id: company.id },
      data: {
        wmMstId: mstUpto,
        ...(company.phase === 'MASTERS' ? { phase: 'BASELINE' } : {}),
        ...(mstUpto >= company.altMstId && company.altVchId <= company.wmVchId
          ? { marksChangedAt: null, marksFirstChangedAt: null }
          : {}),
      },
    });
    return { stats, judge: company.phase === 'LIVE' };
  }

  private async applyBaseline(
    tx: Tx,
    company: TallyCompany,
    answers: Row[][],
    counted: (number | null)[],
    params: Record<string, string | number | boolean>,
  ) {
    const copyFrom = String(params.copyFrom);
    const extra = {
      baselineFrom: params.useOpening ? ('opening' as const) : ('closing' as const),
      baselineOn: copyFrom,
    };
    const stats = {
      DEBTOR: await this.applyParties(
        tx,
        company,
        'DEBTOR',
        answers[0] ?? [],
        counted[0] ?? null,
        new Date(),
        extra,
      ),
      CREDITOR: await this.applyParties(
        tx,
        company,
        'CREDITOR',
        answers[1] ?? [],
        counted[1] ?? null,
        new Date(),
        extra,
      ),
    };
    await tx.tallyCompany.update({
      where: { id: company.id },
      data: {
        phase: 'BACKFILL',
        copyFrom,
        backfillCursor: istToday(),
        // Anything altered while the backfill runs is caught by the delta that follows it.
        wmVchId: BigInt(String(params.vchAt ?? '0')),
      },
    });
    return { stats, judge: false };
  }

  // ---- Vouchers --------------------------------------------------------------------------------

  /**
   * Applies vouchers with every check on them first. A held voucher is only replaced by one at least
   * as new, so a replayed or late answer can never undo a newer one, and lines are replaced whole.
   */
  private async applyVouchers(
    tx: Tx,
    company: TallyCompany,
    rawVouchers: Row[],
    rawLines: Row[],
    rawItems: Row[],
    inScope: (row: Row) => boolean,
    expected: number | null,
  ) {
    const scoped = rawVouchers.filter(inScope);
    if (expected !== null && expected !== rawVouchers.length && expected !== scoped.length)
      throw new TallyRefusal('COUNT_SHORT');
    const types = await tx.tallyVoucherType.findMany({
      where: { companyId: company.id },
      select: { name: true, baseType: true },
    });
    const baseOf = new Map(types.map((row) => [row.name, row.baseType]));
    // The filter was the PC's to run. Payroll and anything else not on the list stops here as well.
    const vouchers = scoped.filter((row) => baseOf.get(row.type ?? ''));
    const skipped = scoped.length - vouchers.length;
    const lines = new Map<string, { ledger: string; amount: bigint }[]>();
    for (const row of rawLines) {
      const guid = id(row.guid ?? '');
      const list = lines.get(guid) ?? [];
      list.push({ ledger: id(row.ledger ?? ''), amount: money(row.amount ?? '') });
      lines.set(guid, list);
    }
    const items = new Map<string, Row[]>();
    for (const row of rawItems) {
      const guid = id(row.guid ?? '');
      const list = items.get(guid) ?? [];
      list.push(row);
      items.set(guid, list);
    }
    for (const row of vouchers) {
      id(row.guid ?? '');
      dayOf(row.date ?? '');
      if (yes(row.isCancelled ?? '')) continue;
      const own = lines.get(row.guid!);
      // A voucher that does not net to zero, or came with no lines, means a short answer.
      if (!own?.length) throw new TallyRefusal('LINES_SHORT');
      if (sumBig(own.map((line) => line.amount)) !== BigInt(0))
        throw new TallyRefusal('NOT_BALANCED');
    }
    const ledgers = await tx.tallyLedger.findMany({
      where: { companyId: company.id },
      select: { guid: true, name: true, deletedAt: true },
    });
    const byName = new Map(ledgers.map((row) => [row.name, row.guid]));
    const held = await tx.tallyVoucher.findMany({
      where: { companyId: company.id, guid: { in: vouchers.map((row) => row.guid!) } },
      select: { id: true, guid: true, alterId: true, partyAmountPaise: true, deletedAt: true },
    });
    const heldBy = new Map(held.map((row) => [row.guid, row]));
    const replace: string[] = [];
    const lineRows: Prisma.TallyVoucherLineCreateManyInput[] = [];
    const itemRows: Prisma.TallyVoucherItemCreateManyInput[] = [];
    let applied = 0;
    let older = 0;
    for (const row of vouchers) {
      const guid = row.guid!;
      const alterId = count(row.alterId ?? '');
      const prior = heldBy.get(guid);
      if (prior && alterId < prior.alterId && !company.rewrittenAt) {
        older++;
        continue;
      }
      const cancelled = yes(row.isCancelled ?? '');
      const own = cancelled ? [] : (lines.get(guid) ?? []);
      const ownItems = cancelled ? [] : (items.get(guid) ?? []);
      const partyLine =
        own.find((line) => line.ledger === row.party && byName.has(line.ledger)) ??
        own.find((line) => byName.has(line.ledger));
      const keep = Boolean(partyLine || ownItems.length);
      const reference = keep ? (row.reference ?? '') : '';
      const orderRef = keep
        ? (ORDER_NUMBER.exec(`${row.reference ?? ''} ${row.narration ?? ''}`)?.[0] ?? null)
        : null;
      // A voucher with no party and no goods (rent, say) is none of our business: its id and no more.
      const data = {
        masterId: row.masterId || null,
        alterId,
        date: row.date!,
        type: keep ? row.type! : '',
        baseType: keep ? baseOf.get(row.type!)! : '',
        number: keep ? (row.number ?? '') : '',
        party: keep ? (row.party ?? '') : '',
        partyGuid: partyLine ? (byName.get(partyLine.ledger) ?? null) : null,
        reference,
        orderRef,
        partyAmountPaise: partyLine?.amount ?? null,
        isOptional: yes(row.isOptional ?? ''),
        isCancelled: cancelled,
        deletedAt: null,
      };
      const saved = await tx.tallyVoucher.upsert({
        where: { companyId_guid: { companyId: company.id, guid } },
        create: { companyId: company.id, guid, ...data },
        update: data,
        select: { id: true },
      });
      if (prior && prior.deletedAt)
        await tx.tallyVoucherChange.create({
          data: {
            companyId: company.id,
            voucherId: saved.id,
            kind: 'RESTORED',
            oldAlterId: prior.alterId,
            newAlterId: alterId,
            newAmountPaise: data.partyAmountPaise,
          },
        });
      else if (prior && alterId !== prior.alterId)
        await tx.tallyVoucherChange.create({
          data: {
            companyId: company.id,
            voucherId: saved.id,
            kind: 'ALTERED',
            oldAlterId: prior.alterId,
            newAlterId: alterId,
            oldAmountPaise: prior.partyAmountPaise,
            newAmountPaise: data.partyAmountPaise,
          },
        });
      replace.push(saved.id);
      if (keep) {
        for (const line of own)
          lineRows.push({
            voucherId: saved.id,
            ledgerGuid: byName.get(line.ledger) ?? null,
            ledgerName: line.ledger,
            amountPaise: line.amount,
          });
        for (const item of ownItems)
          itemRows.push({
            voucherId: saved.id,
            stockItemName: id(item.item ?? ''),
            billedQtyText: item.billedQty ?? '',
            rateText: item.rate ?? '',
            amountPaise: money(item.amount ?? ''),
          });
      }
      applied++;
    }
    if (replace.length) {
      await tx.tallyVoucherLine.deleteMany({ where: { voucherId: { in: replace } } });
      await tx.tallyVoucherItem.deleteMany({ where: { voucherId: { in: replace } } });
      if (lineRows.length) await tx.tallyVoucherLine.createMany({ data: lineRows });
      if (itemRows.length) await tx.tallyVoucherItem.createMany({ data: itemRows });
    }
    return { applied, older, skipped, outOfWindow: rawVouchers.length - scoped.length };
  }

  private async applyWindow(
    tx: Tx,
    company: TallyCompany,
    answers: Row[][],
    counted: (number | null)[],
    params: Record<string, string | number | boolean>,
    tookMs: number,
  ) {
    const from = String(params.from);
    const to = String(params.to);
    const copyFrom = String(params.copyFrom);
    const stats = await this.applyVouchers(
      tx,
      company,
      answers[0] ?? [],
      answers[1] ?? [],
      answers[2] ?? [],
      // Plan 09: Tally has been seen to ignore dates, so they are filtered again here.
      (row) => (row.date ?? '') >= from && (row.date ?? '') <= to,
      counted[0] ?? null,
    );
    const slow = stats.applied > WINDOW_TOO_MANY || tookMs > WINDOW_TOO_SLOW_MS;
    const next = dayShift(from, -1);
    const done = from <= copyFrom;
    await tx.tallyCompany.update({
      where: { id: company.id },
      data: {
        backfillCursor: done ? null : next,
        backfillWindowDays: slow
          ? Math.max(1, Math.floor(company.backfillWindowDays / 2))
          : company.backfillWindowDays,
        ...(done ? { phase: 'LIVE', lastSweepOn: null } : {}),
      },
    });
    return { stats, judge: false };
  }

  private async applyDelta(
    tx: Tx,
    company: TallyCompany,
    answers: Row[][],
    counted: (number | null)[],
    params: Record<string, string | number | boolean>,
    asOf: Date,
  ) {
    const after = BigInt(String(params.after));
    const upto = BigInt(String(params.upto));
    const stats: Record<string, number> = await this.applyVouchers(
      tx,
      company,
      answers[0] ?? [],
      answers[1] ?? [],
      answers[2] ?? [],
      (row) => {
        const alterId = count(row.alterId ?? '');
        return alterId > after && alterId <= upto;
      },
      counted[0] ?? null,
    );
    if (params.last) {
      await this.applyParties(tx, company, 'DEBTOR', answers[3] ?? [], counted[3] ?? null, asOf);
      await this.applyParties(tx, company, 'CREDITOR', answers[4] ?? [], counted[4] ?? null, asOf);
    }
    await this.resolveLines(tx, company.id);
    const caughtUp = upto >= company.altVchId;
    await tx.tallyCompany.update({
      where: { id: company.id },
      data: {
        wmVchId: upto,
        ...(caughtUp ? { marksChangedAt: null, marksFirstChangedAt: null } : {}),
      },
    });
    return { stats, judge: Boolean(params.last) };
  }

  /** Deletes leave no mark in Tally, so once a day every voucher id is read and compared. */
  private async applySweep(
    tx: Tx,
    company: TallyCompany,
    answers: Row[][],
    counted: (number | null)[],
    params: Record<string, string | number | boolean>,
    asOf: Date,
  ) {
    const from = String(params.from);
    const to = String(params.to);
    const raw = answers[0] ?? [];
    const rows = raw.filter((row) => (row.date ?? '') >= from && (row.date ?? '') <= to);
    const expected = counted[0] ?? null;
    if (expected !== null && expected !== raw.length && expected !== rows.length)
      throw new TallyRefusal('COUNT_SHORT');
    for (const row of rows) id(row.guid ?? '');
    const held = await tx.tallyVoucher.findMany({
      where: { companyId: company.id, deletedAt: null, date: { gte: from, lte: to } },
      select: { id: true, guid: true, alterId: true, partyAmountPaise: true },
    });
    if (held.length >= SHORT_READ_FROM && rows.length < held.length * SHORT_READ_SHARE)
      throw new TallyRefusal('SHORT_READ');
    // The list must reach the last voucher Tally says it has, or the answer was cut short.
    const lastDate = company.lastVoucherDate;
    if (lastDate && lastDate >= from && lastDate <= to) {
      const newest = rows.reduce((max, row) => ((row.date ?? '') > max ? row.date! : max), '');
      if (newest < lastDate) throw new TallyRefusal('SHORT_READ');
    }
    const seen = new Set(rows.map((row) => row.guid));
    const gone = held.filter((row) => !seen.has(row.guid));
    const now = new Date();
    for (const voucher of gone) {
      await tx.tallyVoucher.update({ where: { id: voucher.id }, data: { deletedAt: now } });
      await tx.tallyVoucherChange.create({
        data: {
          companyId: company.id,
          voucherId: voucher.id,
          kind: 'DELETED',
          oldAlterId: voucher.alterId,
          oldAmountPaise: voucher.partyAmountPaise,
        },
      });
    }
    await this.applyParties(tx, company, 'DEBTOR', answers[1] ?? [], counted[1] ?? null, asOf);
    await this.applyParties(tx, company, 'CREDITOR', answers[2] ?? [], counted[2] ?? null, asOf);
    await tx.tallyCompany.update({
      where: { id: company.id },
      data: { lastSweepOn: to },
    });
    return { stats: { seen: rows.length, deleted: gone.length }, judge: true };
  }

  // ---- The proof -------------------------------------------------------------------------------

  /**
   * After each sync, for every party: baseline + mirrored lines = Tally's closing, to the paisa. If the
   * accountant typed something while we read, the answer cannot be judged yet, so it is not.
   */
  private async judge(
    tx: Tx,
    companyId: string,
    job: TallySyncJob,
    marksAfter: Row[] | null,
    wanted: boolean,
  ) {
    if (!wanted) return;
    const company = await tx.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    const params = job.params as Record<string, string | number | boolean>;
    const moved = marksAfter?.find((row) => row.guid === company.guid);
    const unsettled =
      !moved ||
      company.wmVchId < company.altVchId ||
      count(moved.altVchId ?? '') !== company.wmVchId ||
      (params.vchAt !== undefined && String(params.vchAt) !== String(company.wmVchId));
    const at = new Date();
    if (unsettled) {
      await tx.tallyCompany.update({
        where: { id: companyId },
        data: { tieOut: { status: 'UNSETTLED', at: at.toISOString() }, tieOutAt: at },
      });
      return;
    }
    const today = istToday();
    const copyFrom = company.copyFrom ?? today;
    const sums = await tx.$queryRaw<{ guid: string; total: string }[]>`
      SELECT li."ledgerGuid" AS guid, SUM(li."amountPaise")::text AS total
      FROM "TallyVoucherLine" li JOIN "TallyVoucher" v ON v.id = li."voucherId"
      WHERE v."companyId" = ${companyId} AND v."deletedAt" IS NULL AND NOT v."isOptional"
        AND NOT v."isCancelled" AND v."date" >= ${copyFrom} AND v."date" <= ${today}
        AND li."ledgerGuid" IS NOT NULL
      GROUP BY li."ledgerGuid"`;
    const lineTotals = new Map(sums.map((row) => [row.guid, BigInt(row.total)]));
    const ledgers = await tx.tallyLedger.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        guid: true,
        baselinePaise: true,
        openingPaise: true,
        closingPaise: true,
        tieOutOk: true,
        tieOutGapPaise: true,
      },
    });
    let failed = 0;
    for (const ledger of ledgers) {
      const start = ledger.baselinePaise ?? ledger.openingPaise ?? BigInt(0);
      const gap =
        (ledger.closingPaise ?? BigInt(0)) - (start + (lineTotals.get(ledger.guid) ?? BigInt(0)));
      const ok = gap === BigInt(0);
      if (!ok) failed++;
      if (ledger.tieOutOk !== ok || ledger.tieOutGapPaise !== gap)
        await tx.tallyLedger.update({
          where: { id: ledger.id },
          data: { tieOutOk: ok, tieOutGapPaise: gap },
        });
    }
    const status = failed ? 'FAILED' : 'OK';
    // One re-read a day to see whether the gap was ours. After that it stays visible until fixed.
    const reread = failed && company.lastRereadOn !== today && company.phase === 'LIVE';
    await tx.tallyCompany.update({
      where: { id: companyId },
      data: {
        tieOut: { status, total: ledgers.length, failed, at: at.toISOString() },
        tieOutAt: at,
        ...(status === 'OK' ? { rewrittenAt: null, freshAt: at } : {}),
        ...(reread
          ? {
              phase: 'BACKFILL',
              backfillCursor: today,
              backfillWindowDays: 7,
              lastRereadOn: today,
              lastSweepOn: null,
            }
          : {}),
      },
    });
  }
}
