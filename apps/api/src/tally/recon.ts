import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { tallyAppEquivalent } from '@shiv/shared';
import { Db } from '../db';
import { fail } from '../http';

/** Staff words for "how old": a Tally number older than this carries a warning, never a guess. */
const STALE_MS = 24 * 3600000;
const TIMING_DAYS = 7;
/** Tally's round-off (plan 09 question A6). Until the accountant says otherwise. */
const TOLERANCE_PAISE = BigInt(100);
const SUGGEST_DAYS = 3;
const big = (value: bigint | number | null | undefined) =>
  value === null || value === undefined ? null : String(value);
const dayStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
const istDay = (at: Date) => new Date(at.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
const absolute = (value: bigint) => (value < BigInt(0) ? -value : value);

/** A page of a list. Whatever the address bar says, these reach the database as small whole numbers. */
export function listWindow(query: Record<string, unknown>) {
  const whole = (value: unknown, fallback: number, top: number) => {
    const number = typeof value === 'string' && /^\d{1,7}$/.test(value) ? Number(value) : fallback;
    return Math.min(number, top);
  };
  return { take: Math.max(whole(query.limit, 24, 100), 1), skip: whole(query.skip, 0, 1000000) };
}

/**
 * Which part of a customer one comparison covers. A firm: that firm's khata against the Tally
 * companies mapped to it. Unmapped: the khata of every firm not named, against companies not yet
 * mapped to any firm. Left out: the whole customer, as before there were two firms.
 */
export type ReconPart = { firmId: string } | { unmapped: string[] };

export type DifferenceLine = {
  reason: 'TIMING' | 'APP_ONLY' | 'TALLY_ONLY' | 'AMOUNT' | 'OPENING';
  amountPaise: string;
  entryId?: string;
  voucherId?: string;
  on?: string;
  label?: string;
  note?: string;
};

/** Whether a Tally company of this firm (null: not mapped yet) is in this part of the customer. */
function inPart(part: ReconPart | undefined, firmId: string | null) {
  if (!part) return true;
  return 'firmId' in part ? firmId === part.firmId : firmId === null;
}

@Injectable()
export class TallyRecon {
  constructor(@Inject(Db) private db: Db) {}

  /**
   * Both numbers for one customer, and every line of the difference we can name. Neither number is
   * ever corrected from the other: difference = khata - (-Tally closing), then the named lines, and
   * whatever is left is `unexplained`, which only the mirror's own gap can produce.
   */
  async numbers(customerId: string, now = new Date(), part?: ReconPart) {
    const customer = await this.db.user.findFirst({
      where: { id: customerId, deletedAt: null, role: { not: 'ADMIN' } },
      select: {
        id: true,
        khataBalancePaise: true,
        firmBalances: { select: { firmId: true, balancePaise: true } },
      },
    });
    if (!customer) fail('CUSTOMER_NOT_FOUND', 'Customer not found.', 404);
    const links = await this.db.tallyPartyLink.findMany({
      where: { userId: customerId, status: 'LINKED' },
      include: { ledger: { include: { company: true } } },
    });
    // Tally sync copies and ignored files are not the books, so they never reach a total.
    const live = links.filter(
      (link) => link.ledger.company.role === 'PRIMARY' && inPart(part, link.ledger.company.firmId),
    );
    const firmPaise = (wanted: (firmId: string) => boolean) =>
      customer.firmBalances
        .filter((row) => wanted(row.firmId))
        .reduce((total, row) => total + row.balancePaise, 0);
    const khataPaise = !part
      ? customer.khataBalancePaise
      : 'firmId' in part
        ? firmPaise((firmId) => firmId === part.firmId)
        : customer.khataBalancePaise - firmPaise((firmId) => part.unmapped.includes(firmId));
    if (!live.length)
      return { customerId, khataPaise, state: 'NOT_LINKED' as const, tally: null, parties: [] };
    const parties = live.map(({ ledger }) => ({
      ledgerId: ledger.id,
      name: ledger.name,
      companyId: ledger.companyId,
      company: ledger.company.name,
      closingPaise: big(ledger.closingPaise),
      asOf: ledger.company.freshAt ?? ledger.closingAsOf,
      tieOutOk: ledger.tieOutOk,
      tieOutGapPaise: big(ledger.tieOutGapPaise),
      deleted: Boolean(ledger.deletedAt),
    }));
    const closing = live.reduce(
      (total, { ledger }) => total + (ledger.closingPaise ?? BigInt(0)),
      BigInt(0),
    );
    const times = parties.map((row) => row.asOf).filter((at): at is Date => Boolean(at));
    const asOf = times.length ? new Date(Math.min(...times.map((at) => at.getTime()))) : null;
    const phases = new Set(live.map(({ ledger }) => ledger.company.phase));
    const rewritten = live.some(({ ledger }) => ledger.company.rewrittenAt);
    const copying = !phases.has('LIVE') || phases.size > 1;
    const stale = !asOf || now.getTime() - asOf.getTime() > STALE_MS;
    const tieOut = rewritten
      ? ('REWRITTEN' as const)
      : parties.some((row) => row.tieOutOk === false)
        ? ('FAILED' as const)
        : parties.every((row) => row.tieOutOk === true)
          ? ('OK' as const)
          : ('PENDING' as const);
    const appEquivalent = tallyAppEquivalent(closing);
    const difference = BigInt(khataPaise) - appEquivalent;
    const tally = {
      closingPaise: String(closing),
      appEquivalentPaise: String(appEquivalent),
      asOf,
      stale,
      tieOut,
      copying,
      differencePaise: String(difference),
    };
    // Plan 09: differences stay hidden until the copy is finished, as they would only mislead.
    if (copying)
      return {
        customerId,
        khataPaise,
        state: 'COPYING' as const,
        tally: { ...tally, differencePaise: null },
        parties,
        lines: [],
        suggestions: [],
        changes: [],
        matches: [],
      };
    const explained = await this.explain(customerId, live, now, part);
    const named = explained.lines.reduce(
      (total, line) => total + BigInt(line.amountPaise),
      BigInt(0),
    );
    return {
      customerId,
      khataPaise,
      state: 'READY' as const,
      tally: { ...tally, unexplainedPaise: String(difference - named) },
      parties,
      lines: explained.lines,
      suggestions: explained.suggestions,
      changes: explained.changes,
      matches: explained.matches,
    };
  }

  private async explain(
    customerId: string,
    links: {
      guid: string;
      companyId: string;
      ledger: {
        baselinePaise: bigint | null;
        openingPaise: bigint | null;
        company: { copyFrom: string | null };
      };
    }[],
    now: Date,
    part?: ReconPart,
  ) {
    const firmRows = !part
      ? {}
      : 'firmId' in part
        ? { firmId: part.firmId }
        : { firmId: { notIn: part.unmapped } };
    // Our copy starts at one date per company; before it we hold only Tally's balance on that day.
    const copyFrom =
      links.map((link) => link.ledger.company.copyFrom ?? '').sort()[0] || '9999-12-31';
    const entries = await this.db.customerLedgerEntry.findMany({
      where: { customerId, ...firmRows },
      select: {
        id: true,
        amountPaise: true,
        occurredAt: true,
        reversesId: true,
        kind: true,
        order: { select: { number: true } },
      },
      orderBy: { occurredAt: 'asc' },
    });
    // A signed opening is where the khata begins. Tally's bills from before it are already inside
    // that figure, so they roll up into one opening line and are not chased one by one.
    const signoff = await this.db.khataSignoff.findFirst({
      where: { customerId, ...firmRows },
      select: { asOf: true, ledgerEntryId: true },
    });
    const agreedFrom = signoff && signoff.asOf > copyFrom ? signoff.asOf : copyFrom;
    const start = dayStart(agreedFrom);
    const isOpening = (row: { id: string }) => row.id === signoff?.ledgerEntryId;
    const before = entries.filter((row) => row.occurredAt < start || isOpening(row));
    const since = entries.filter((row) => row.occurredAt >= start && !isOpening(row));
    const vouchers = await this.db.tallyVoucher.findMany({
      where: {
        deletedAt: null,
        isCancelled: false,
        isOptional: false,
        date: { gte: copyFrom, lte: istDay(now) },
        OR: links.map((link) => ({
          companyId: link.companyId,
          lines: { some: { ledgerGuid: link.guid } },
        })),
      },
      select: {
        id: true,
        companyId: true,
        date: true,
        number: true,
        type: true,
        orderRef: true,
        reference: true,
        lines: {
          where: { ledgerGuid: { in: links.map((link) => link.guid) } },
          select: { amountPaise: true },
        },
      },
    });
    const money = new Map(
      vouchers.map((row) => [
        row.id,
        row.lines.reduce((total, line) => total + line.amountPaise, BigInt(0)),
      ]),
    );
    // What a person has already said. A later row can undo an earlier one, and that is all.
    const matchRows = await this.db.khataVoucherMatch.findMany({
      where: { voucherId: { in: vouchers.map((row) => row.id) } },
      orderBy: { createdAt: 'asc' },
    });
    const undone = new Set(matchRows.map((row) => row.undoesId).filter(Boolean));
    const byPerson = matchRows.filter((row) => !row.undoesId && !undone.has(row.id));
    const voucherOfEntry = new Map(byPerson.map((row) => [row.entryId, row.voucherId]));
    // Then order numbers on bills, which are a fact and need no person.
    const byRef = new Map(
      vouchers.filter((row) => row.orderRef).map((row) => [row.orderRef!, row.id]),
    );
    for (const entry of since) {
      const voucherId = entry.order ? byRef.get(entry.order.number) : undefined;
      if (voucherId && !voucherOfEntry.has(entry.id)) voucherOfEntry.set(entry.id, voucherId);
    }
    const lines: DifferenceLine[] = [];
    const matchedVouchers = new Map<string, bigint>();
    const unmatched: typeof since = [];
    // An entry and its reversal cancel out, with nothing to chase in either book, unless one of them
    // is already matched to a voucher.
    const sinceIds = new Set(since.map((row) => row.id));
    const reversed = new Set(
      since
        .filter(
          (row) =>
            row.reversesId &&
            sinceIds.has(row.reversesId) &&
            !voucherOfEntry.has(row.id) &&
            !voucherOfEntry.has(row.reversesId),
        )
        .flatMap((row) => [row.id, row.reversesId!]),
    );
    for (const entry of since) {
      const voucherId = voucherOfEntry.get(entry.id);
      if (voucherId) {
        matchedVouchers.set(
          voucherId,
          (matchedVouchers.get(voucherId) ?? BigInt(0)) + BigInt(entry.amountPaise),
        );
      } else if (!reversed.has(entry.id)) unmatched.push(entry);
    }
    const startingKhata = before.reduce((total, row) => total + BigInt(row.amountPaise), BigInt(0));
    // The tie-out baseline of a party first seen after the start is what Tally opened it with.
    const baseline = links.reduce(
      (total, link) => total + (link.ledger.baselinePaise ?? link.ledger.openingPaise ?? BigInt(0)),
      BigInt(0),
    );
    const weekAgo = now.getTime() - TIMING_DAYS * 86400000;
    for (const entry of unmatched)
      lines.push({
        reason: entry.occurredAt.getTime() >= weekAgo ? 'TIMING' : 'APP_ONLY',
        amountPaise: String(entry.amountPaise),
        entryId: entry.id,
        on: istDay(entry.occurredAt),
        label: entry.order?.number ?? entry.kind,
      });
    const suggestions: { entryId: string; voucherId: string; amountPaise: string }[] = [];
    const openVouchers = vouchers.filter((row) => !matchedVouchers.has(row.id));
    let rolledUp = BigInt(0);
    for (const voucher of vouchers) {
      const held = money.get(voucher.id)!;
      const asApp = tallyAppEquivalent(held);
      const matched = matchedVouchers.get(voucher.id);
      if (matched === undefined && voucher.date < agreedFrom) {
        rolledUp += held;
      } else if (matched === undefined) {
        // It raises what Tally says they owe, so it lowers the difference: hence the plain line amount.
        lines.push({
          reason: 'TALLY_ONLY',
          amountPaise: String(held),
          voucherId: voucher.id,
          on: voucher.date,
          label: voucher.number || voucher.type,
        });
      } else if (matched !== asApp) {
        lines.push({
          reason: 'AMOUNT',
          amountPaise: String(matched - asApp),
          voucherId: voucher.id,
          on: voucher.date,
          label: voucher.number || voucher.type,
          ...(absolute(matched - asApp) <= TOLERANCE_PAISE ? { note: 'WITHIN_TOLERANCE' } : {}),
        });
      }
    }
    // Worked out last, as it holds Tally's rolled-up bills. Once signed, a person has seen this gap.
    const opening = startingKhata - tallyAppEquivalent(baseline + rolledUp);
    if (opening !== BigInt(0))
      lines.unshift({
        reason: 'OPENING',
        amountPaise: String(opening),
        on: agreedFrom,
        note: signoff ? 'SIGNED' : 'NOT_AGREED_YET',
      });
    // Same party, same amount, within three days, and only one candidate on each side. A suggestion
    // only: a person accepts it. Many-to-one is always a person.
    const closeBy = (one: string, other: string) =>
      Math.abs(Date.parse(`${one}T00:00:00Z`) - Date.parse(`${other}T00:00:00Z`)) <=
      SUGGEST_DAYS * 86400000;
    const sameMoney = (voucherId: string, amount: number) =>
      absolute(tallyAppEquivalent(money.get(voucherId)!) - BigInt(amount)) <= TOLERANCE_PAISE;
    for (const entry of unmatched) {
      const day = istDay(entry.occurredAt);
      const candidates = openVouchers.filter(
        (voucher) => closeBy(voucher.date, day) && sameMoney(voucher.id, entry.amountPaise),
      );
      if (candidates.length !== 1) continue;
      const voucher = candidates[0]!;
      const rivals = unmatched.filter(
        (other) =>
          closeBy(voucher.date, istDay(other.occurredAt)) &&
          sameMoney(voucher.id, other.amountPaise),
      );
      if (rivals.length === 1)
        suggestions.push({
          entryId: entry.id,
          voucherId: voucher.id,
          amountPaise: String(entry.amountPaise),
        });
    }
    // A fact for a person to look at. Its money is already on the lines above, so it adds nothing.
    const changes = await this.db.tallyVoucherChange.findMany({
      where: {
        voucherId: { in: [...matchedVouchers.keys()] },
      },
      orderBy: { detectedAt: 'desc' },
      take: 50,
    });
    const deleted = await this.db.tallyVoucherChange.findMany({
      where: {
        kind: 'DELETED',
        voucherId: {
          in: (
            await this.db.tallyVoucher.findMany({
              where: {
                deletedAt: { not: null },
                OR: links.map((link) => ({ companyId: link.companyId, partyGuid: link.guid })),
              },
              select: { id: true },
              take: 200,
            })
          ).map((row) => row.id),
        },
      },
      orderBy: { detectedAt: 'desc' },
      take: 50,
    });
    // What a person can still take back. Listed by entry, since a match whose voucher Tally has since
    // deleted is out of the sums above yet still blocks a new match until it is undone.
    const entryMatches = await this.db.khataVoucherMatch.findMany({
      where: { entryId: { in: entries.map((row) => row.id) } },
      orderBy: { createdAt: 'asc' },
    });
    const entryUndone = new Set(entryMatches.map((row) => row.undoesId).filter(Boolean));
    const standing = entryMatches.filter((row) => !row.undoesId && !entryUndone.has(row.id));
    const standingVouchers = await this.db.tallyVoucher.findMany({
      where: { id: { in: standing.map((row) => row.voucherId) } },
      select: { id: true, date: true, number: true, type: true, deletedAt: true },
    });
    const matches = standing.map((row) => {
      const voucher = standingVouchers.find((item) => item.id === row.voucherId);
      return {
        id: row.id,
        entryId: row.entryId,
        voucherId: row.voucherId,
        amountPaise: String(row.amountPaise),
        on: voucher?.date ?? null,
        label: voucher ? voucher.number || voucher.type : '',
        voucherGone: !voucher || Boolean(voucher.deletedAt),
        at: row.createdAt,
      };
    });
    return {
      lines,
      suggestions,
      matches,
      changes: [...changes, ...deleted].map((row) => ({
        id: row.id,
        reason: 'CHANGED' as const,
        kind: row.kind,
        voucherId: row.voucherId,
        oldAmountPaise: big(row.oldAmountPaise),
        newAmountPaise: big(row.newAmountPaise),
        detectedAt: row.detectedAt,
      })),
    };
  }

  /** The worker's pass: everyone linked to a company whose mirror moved gets their sums done again. */
  async runDue(limit = 5000) {
    const companies = await this.db.tallyCompany.findMany({
      where: { reconDue: true },
      select: { id: true },
    });
    if (!companies.length) return 0;
    const ids = companies.map((row) => row.id);
    const links = await this.db.tallyPartyLink.findMany({
      where: { companyId: { in: ids }, status: 'LINKED', userId: { not: null } },
      select: { userId: true },
      distinct: ['userId'],
      take: limit,
    });
    for (const { userId } of links) await this.refresh(userId!);
    await this.db.tallyCompany.updateMany({
      where: { id: { in: ids } },
      data: { reconDue: false },
    });
    return links.length;
  }

  /**
   * One row per firm whose Tally company is mapped, comparing that firm's khata with that company.
   * Companies not mapped yet keep the row with no firm, against the khata of the other firms, so a
   * shop with one firm and no mapping works as it always did.
   */
  async refresh(customerId: string) {
    const links = await this.db.tallyPartyLink.findMany({
      where: { userId: customerId, status: 'LINKED', ledger: { company: { role: 'PRIMARY' } } },
      select: { ledger: { select: { company: { select: { firmId: true } } } } },
    });
    const mapped = [...new Set(links.flatMap((link) => link.ledger.company.firmId ?? []))].sort();
    const unmapped = links.some((link) => !link.ledger.company.firmId);
    const parts: [string, ReconPart | undefined][] = [
      ...mapped.map((firmId): [string, ReconPart] => [firmId, { firmId }]),
      ...(unmapped || !mapped.length
        ? [
            ['', mapped.length ? { unmapped: mapped } : undefined] as [
              string,
              ReconPart | undefined,
            ],
          ]
        : []),
    ];
    const kept: string[] = [];
    for (const [firmId, part] of parts)
      if (await this.write(customerId, firmId, part)) kept.push(firmId);
    // A firm whose company was unmapped, or a link undone, leaves no line behind.
    await this.db.khataRecon
      .deleteMany({ where: { customerId, firmId: { notIn: kept } } })
      .catch(() => undefined);
  }

  /** Works out one comparison and keeps it. False when there is nothing to compare. */
  private async write(customerId: string, firmId: string, part: ReconPart | undefined) {
    const result = await this.numbers(customerId, new Date(), part).catch(() => null);
    const now = new Date();
    if (!result?.tally) return false;
    const reasons: Record<string, string> = {};
    for (const line of (result as { lines?: DifferenceLine[] }).lines ?? [])
      reasons[line.reason] = String(BigInt(reasons[line.reason] ?? '0') + BigInt(line.amountPaise));
    const tally = result.tally as typeof result.tally & { unexplainedPaise?: string };
    const row = {
      appPaise: result.khataPaise,
      tallyPaise: BigInt(tally.appEquivalentPaise),
      differencePaise: tally.differencePaise === null ? null : BigInt(tally.differencePaise),
      unexplainedPaise: tally.unexplainedPaise ? BigInt(tally.unexplainedPaise) : null,
      reasons: reasons as Prisma.InputJsonValue,
      tallyAsOf: tally.asOf,
      computedAt: now,
    };
    await this.db.khataRecon.upsert({
      where: { customerId_firmId: { customerId, firmId } },
      create: { customerId, firmId, ...row },
      update: row,
    });
    return true;
  }

  /** The Farq list: biggest unexplained first, then biggest difference. Whole numbers, with their time. */
  async differences(query: Record<string, unknown>, firms?: readonly string[]) {
    const { take, skip } = listWindow(query);
    // Someone limited to some firms sees only their firms' lines, and only their firms' books count.
    const inFirms = firms ? Prisma.sql`AND r."firmId" = ANY(${[...firms]})` : Prisma.empty;
    const rows = await this.db.$queryRaw<
      {
        customerId: string;
        firmId: string;
        name: string;
        phone: string;
        appPaise: number;
        tallyPaise: bigint | null;
        differencePaise: bigint | null;
        unexplainedPaise: bigint | null;
        reasons: unknown;
        tallyAsOf: Date | null;
        computedAt: Date;
      }[]
    >`
      SELECT r."customerId", r."firmId", u.name, u.phone, r."appPaise", r."tallyPaise", r."differencePaise",
        r."unexplainedPaise", r.reasons, r."tallyAsOf", r."computedAt"
      FROM "KhataRecon" r JOIN "User" u ON u.id = r."customerId"
      WHERE u."deletedAt" IS NULL AND COALESCE(r."differencePaise", 0) <> 0 ${inFirms}
        -- These rows wait for the worker, and neither of these may. Only books in use reach the list,
        -- and plan 09 hides differences until each of the customer's copies has finished. A firm's
        -- row asks only of that firm's companies.
        AND EXISTS (
          SELECT 1 FROM "TallyPartyLink" k JOIN "TallyCompany" c ON c.id = k."companyId"
          WHERE k."userId" = r."customerId" AND k.status = 'LINKED' AND c.role = 'PRIMARY'
            AND (r."firmId" = '' OR c."firmId" = r."firmId"))
        AND NOT EXISTS (
          SELECT 1 FROM "TallyPartyLink" k JOIN "TallyCompany" c ON c.id = k."companyId"
          WHERE k."userId" = r."customerId" AND k.status = 'LINKED' AND c.role = 'PRIMARY'
            AND c.phase <> 'LIVE' AND (r."firmId" = '' OR c."firmId" = r."firmId"))
      ORDER BY ABS(COALESCE(r."unexplainedPaise", 0)) DESC, ABS(COALESCE(r."differencePaise", 0)) DESC,
        r."customerId"
      LIMIT ${take + 1} OFFSET ${skip}`;
    return {
      items: rows.slice(0, take).map((row) => ({
        ...row,
        tallyPaise: big(row.tallyPaise),
        differencePaise: big(row.differencePaise),
        unexplainedPaise: big(row.unexplainedPaise),
      })),
      nextSkip: rows.length > take ? skip + take : null,
    };
  }
}
