import { Inject, Injectable } from '@nestjs/common';
import { Db } from '../db';
import { TallyRecon } from '../tally/recon';
import { wire } from './common';

/**
 * Everything the CRM asks of the Tally mirror comes through this one class, so a change in how the
 * Tally side keeps its numbers touches only this file. Callers must already hold
 * tally.numbers.view: owners and the accountant, never a customer, and never a shop's people.
 */
@Injectable()
export class TallyNumbers {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(TallyRecon) private recon: TallyRecon,
  ) {}

  /** One customer's two numbers, worked out now by the Tally side, in the khata's sign. */
  async forCustomer(id: string) {
    const result = await this.recon.numbers(id);
    if (!result.tally)
      return {
        state: 'NOT_LINKED' as const,
        tallyPaise: null,
        differencePaise: null,
        unexplainedPaise: null,
        asOf: null,
        stale: false,
        tieOut: null,
      };
    const tally = result.tally as typeof result.tally & { unexplainedPaise?: string };
    return {
      state: result.state,
      tallyPaise: tally.appEquivalentPaise,
      // Plan 09: differences stay hidden until the copy is finished, as they would only mislead.
      differencePaise: result.state === 'READY' ? tally.differencePaise : null,
      unexplainedPaise: result.state === 'READY' ? (tally.unexplainedPaise ?? null) : null,
      asOf: tally.asOf,
      stale: tally.stale,
      tieOut: tally.tieOut,
    };
  }

  /** The worker's last sum for many customers at once, for a sheet of rows. In the khata's sign. */
  async forCustomers(ids: readonly string[]) {
    if (!ids.length) return new Map<string, TallyCustomerNumber>();
    const rows = await this.db.khataRecon.findMany({ where: { customerId: { in: [...ids] } } });
    return new Map(
      rows
        .filter((row) => row.tallyPaise !== null)
        .map((row) => [
          row.customerId,
          {
            tallyPaise: wire(row.tallyPaise),
            differencePaise: wire(row.differencePaise),
            unexplainedPaise: wire(row.unexplainedPaise),
            asOf: row.tallyAsOf,
          },
        ]),
    );
  }

  /** Whether any company's copy has reported yet. Nothing to show means "Tally abhi juda nahi". */
  async connected() {
    return (await this.db.tallyCompany.count({ where: { role: 'PRIMARY' } })) > 0;
  }

  /**
   * Supplier baaki, largest first. A creditor's closing is credit, which the mirror keeps as a
   * positive number. Bills and due dates wait on the Tally side reading Bills Payable.
   */
  async suppliers(limit = 200) {
    const rows = await this.db.tallyLedger.findMany({
      where: {
        class: 'CREDITOR',
        deletedAt: null,
        closingPaise: { gt: 0 },
        company: { role: 'PRIMARY' },
      },
      select: {
        id: true,
        name: true,
        closingPaise: true,
        closingAsOf: true,
        tieOutOk: true,
        companyId: true,
        guid: true,
      },
      orderBy: [{ closingPaise: 'desc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const shown = rows.slice(0, limit);
    const total = await this.db.tallyLedger.aggregate({
      where: {
        class: 'CREDITOR',
        deletedAt: null,
        closingPaise: { gt: 0 },
        company: { role: 'PRIMARY' },
      },
      _sum: { closingPaise: true },
      _max: { closingAsOf: true },
    });
    const latest = await this.db.tallyVoucher.groupBy({
      by: ['companyId', 'partyGuid', 'baseType'],
      where: {
        partyGuid: { in: shown.map((row) => row.guid) },
        baseType: { in: ['Purchase', 'Payment'] },
        deletedAt: null,
        isCancelled: false,
        isOptional: false,
      },
      _max: { date: true },
    });
    const lastOf = (row: (typeof shown)[number], baseType: string) =>
      latest.find(
        (item) =>
          item.companyId === row.companyId &&
          item.partyGuid === row.guid &&
          item.baseType === baseType,
      )?._max.date ?? null;
    return {
      totalPaise: wire(total._sum.closingPaise),
      asOf: total._max.closingAsOf,
      truncated: rows.length > limit,
      items: shown.map((row) => ({
        id: row.id,
        name: row.name,
        payablePaise: wire(row.closingPaise),
        asOf: row.closingAsOf,
        tiedOut: row.tieOutOk,
        lastPurchaseOn: lastOf(row, 'Purchase'),
        lastPaymentOn: lastOf(row, 'Payment'),
      })),
    };
  }

  /** The books' sales for a stretch of days, summed from the mirror, to set beside the app's. */
  async salesBetween(fromDay: string, toDay: string) {
    const rows = await this.db.$queryRaw<{ paise: bigint | null }[]>`
      SELECT SUM(ABS(v."partyAmountPaise"))::bigint AS paise
      FROM "TallyVoucher" v JOIN "TallyCompany" c ON c.id = v."companyId"
      WHERE c.role = 'PRIMARY' AND v."deletedAt" IS NULL
        AND v."isOptional" = false AND v."isCancelled" = false
        AND v."baseType" = 'Sales' AND v.date >= ${fromDay} AND v.date <= ${toDay}`;
    return wire(rows[0]?.paise ?? null);
  }

  /** Customers the books say bought since this day, though the app has no order: counter sales. */
  async soldSince(ids: readonly string[], day: string) {
    if (!ids.length) return new Set<string>();
    const rows = await this.db.$queryRaw<{ userId: string }[]>`
      SELECT DISTINCT k."userId"
      FROM "TallyPartyLink" k
      JOIN "TallyVoucher" v ON v."companyId" = k."companyId" AND v."partyGuid" = k.guid
      JOIN "TallyCompany" c ON c.id = k."companyId"
      WHERE k."userId" = ANY(${[...ids]}) AND k.status = 'LINKED' AND c.role = 'PRIMARY'
        AND v."deletedAt" IS NULL AND v."isCancelled" = false AND v."isOptional" = false
        AND v."baseType" = 'Sales' AND v.date >= ${day}`;
    return new Set(rows.map((row) => row.userId));
  }
}

export type TallyCustomerNumber = {
  tallyPaise: string | null;
  differencePaise: string | null;
  unexplainedPaise: string | null;
  asOf: Date | null;
};
