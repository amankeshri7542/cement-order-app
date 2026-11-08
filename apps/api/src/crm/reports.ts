import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import {
  addDays,
  canDo,
  csvRupees,
  csvText,
  daysBetween,
  isRealDay,
  istToday,
  promiseState,
  quietCheck,
  quietRule,
  reminderBlock,
} from '@shiv/shared';
import type { Response } from 'express';
import { Db } from '../db';
import { customerFirmWhere, firmAsked } from '../firms';
import { AuthRequest, Can, fail, Firm, scoped, shopAsked } from '../http';
import { paginate } from '../pagination';
import { moneyIn, moneyOut, notSold } from '../reports';
import {
  balanceShops,
  countOpen,
  dayStart,
  indiaDay,
  moment,
  monthRange,
  oldestDues,
  phoneFields,
  realCustomer,
  sendCsv,
  stoppedIds,
  wire,
} from './common';
import { TallyNumbers } from './tally-numbers';

const DAY_MS = 86400000;
/** Plan 09's list is a top 20. The spreadsheet takes everyone, up to a size a person can read. */
const VASOOLI_PAGE = 20;
const SHEET_LIMIT = 2000;
/** "Weekly, 10 rows at most": a list you finish beats a list you ignore. */
const QUIET_ROWS = 10;
/** Someone rung this recently does not need ringing again because a list said so. */
const QUIET_LEFT_ALONE_DAYS = 14;
const QUIET_CANDIDATES = 2000;
const QUIET_TAG = 'ghar-ban-gaya';

const vasooliFields = {
  id: true,
  name: true,
  phone: true,
  area: true,
  khataBalancePaise: true,
  creditLimitPaise: true,
  remindersStoppedAt: true,
} satisfies Prisma.UserSelect;

const shopIds = (shop: { locationId?: string | { in: string[] } }) =>
  typeof shop.locationId === 'string' ? [shop.locationId] : shop.locationId?.in;
/** The firms a firm filter names, for a raw query. None means every firm. */
const firmIdsOf = (firm: object) => {
  const named = (firm as { firmId?: string | { in: string[] } }).firmId;
  return typeof named === 'string' ? [named] : named?.in;
};

/**
 * The shop each customer's due counts under, within some firms: the shop of their last credit at
 * those firms. balanceShops does the same over every firm.
 */
export async function firmBalanceShops(
  db: Pick<Db, '$queryRaw'>,
  firms: readonly string[],
  ids: readonly string[],
) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.$queryRaw<{ customerId: string; locationId: string }[]>`
    SELECT DISTINCT ON (e."customerId") e."customerId", e."locationId"
    FROM "CustomerLedgerEntry" e
    WHERE e."amountPaise" > 0 AND e.kind <> 'REVERSAL'
      AND e."firmId" = ANY(${[...firms]}) AND e."customerId" = ANY(${[...ids]})
      AND NOT EXISTS (SELECT 1 FROM "CustomerLedgerEntry" r WHERE r."reversesId" = e.id)
    ORDER BY e."customerId", e."occurredAt" DESC, e.id DESC`;
  return new Map(rows.map((row) => [row.customerId, row.locationId]));
}

/**
 * oldestDues within some firms. Each firm's payments clear that firm's oldest debts, as each firm
 * keeps its own khata; the customer's oldest is the oldest over those firms.
 */
export async function firmOldestDues(
  db: Pick<Db, '$queryRaw'>,
  firms: readonly string[],
  ids: readonly string[],
) {
  if (!ids.length || !firms.length) return new Map<string, { on: string; opening: boolean }>();
  const rows = await db.$queryRaw<{ customerId: string; occurredAt: Date; kind: string }[]>`
    WITH debts AS (
      SELECT e."customerId", e."occurredAt", e.kind, b."balancePaise"::bigint AS balance,
        COALESCE(SUM(e."amountPaise"::bigint) OVER (
          PARTITION BY e."customerId", e."firmId" ORDER BY e."occurredAt" DESC, e.id DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0) AS newer
      FROM "CustomerLedgerEntry" e
      JOIN "CustomerFirmBalance" b ON b."customerId" = e."customerId" AND b."firmId" = e."firmId"
      WHERE e."amountPaise" > 0 AND b."balancePaise" > 0
        AND e."customerId" = ANY(${[...ids]}) AND e."firmId" = ANY(${[...firms]})
        AND NOT EXISTS (SELECT 1 FROM "CustomerLedgerEntry" r WHERE r."reversesId" = e.id)
    )
    SELECT DISTINCT ON ("customerId") "customerId", "occurredAt", kind::text AS kind
    FROM debts WHERE newer < balance
    ORDER BY "customerId", "occurredAt" ASC`;
  return new Map(
    rows.map((row) => [
      row.customerId,
      { on: indiaDay(row.occurredAt), opening: row.kind === 'OPENING_BALANCE' },
    ]),
  );
}

@ApiTags('Customer khata and CRM')
@Controller('admin')
export class CrmReportsController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(TallyNumbers) private tally: TallyNumbers,
  ) {}

  // ---- Shaam ka hisaab --------------------------------------------------------------------------
  private async evening(query: Record<string, unknown>, req: AuthRequest) {
    const today = istToday();
    const day = typeof query.day === 'string' ? query.day : today;
    if (!isRealDay(day) || day > today) fail('BAD_DAY', 'Choose a day that has happened.');
    const shop = shopAsked(req, 'reports.read', query.locationId);
    // Money is the firm's, not the shop's: one firm's due can be paid at the other firm's shop.
    const firm = firmAsked(req, query.firmId);
    const firms = firmIdsOf(firm);
    const start = dayStart(day);
    const range = { gte: start, lt: new Date(start.getTime() + DAY_MS) };
    const ids = shopIds(shop);
    const firmShops = firms ? { firmId: { in: firms } } : {};
    const [moves, given, placed, closes, shops] = await Promise.all([
      this.db.financialMovement.findMany({
        where: { occurredAt: range, kind: { in: [...moneyIn, ...moneyOut] }, ...shop, ...firm },
        select: { kind: true, channel: true, amountPaise: true },
      }),
      this.db.customerLedgerEntry.aggregate({
        where: {
          occurredAt: range,
          ...shop,
          ...firm,
          OR: [
            { kind: 'SALE_ON_CREDIT' },
            { kind: 'REVERSAL', reverses: { kind: 'SALE_ON_CREDIT' } },
          ],
        },
        _sum: { amountPaise: true },
      }),
      this.db.order.count({ where: { createdAt: range, ...shop, ...firm } }),
      // The galla is a shop's, so a firm's galla is its own shops'.
      this.db.dayClose.findMany({
        where: { day, ...shop, ...(firms ? { location: firmShops } : {}) },
        select: { id: true, locationId: true, differencePaise: true, supersedesId: true },
      }),
      this.db.location.findMany({
        where: { active: true, ...(ids ? { id: { in: ids } } : {}), ...firmShops },
        select: { id: true },
      }),
    ]);
    const signed = (row: { kind: string; amountPaise: number }) =>
      moneyOut.includes(row.kind) ? -row.amountPaise : row.amountPaise;
    const channel = (name: string) =>
      moves.filter((row) => row.channel === name).reduce((sum, row) => sum + signed(row), 0);
    const totalPaise = moves.reduce((sum, row) => sum + signed(row), 0);
    const cashPaise = channel('CASH');
    const upiPaise = channel('UPI');
    const onlinePaise = channel('ONLINE');
    const replaced = new Set(closes.map((row) => row.supersedesId));
    const current = closes.filter((row) => !replaced.has(row.id));
    return {
      day,
      moneyIn: {
        cashPaise,
        upiPaise,
        onlinePaise,
        otherPaise: totalPaise - cashPaise - upiPaise - onlinePaise,
        totalPaise,
      },
      udhaarGivenPaise: given._sum.amountPaise ?? 0,
      udhaarReceivedPaise: moves
        .filter((row) => row.kind.startsWith('KHATA_PAYMENT'))
        .reduce((sum, row) => sum + signed(row), 0),
      orders: placed,
      galla: {
        shops: shops.length,
        closed: new Set(current.map((row) => row.locationId)).size,
        differencePaise: current.reduce((sum, row) => sum + row.differencePaise, 0),
      },
    };
  }

  @Firm('own')
  @Can('reports.read', scoped)
  @Get('reports/shaam')
  shaam(@Query() query: Record<string, unknown>, @Req() req: AuthRequest) {
    countOpen(this.db, 'shaam', req, istToday());
    return this.evening(query, req);
  }

  @Firm('own')
  @Can('reports.read', scoped)
  @Get('reports/shaam.csv')
  async shaamCsv(
    @Query() query: Record<string, unknown>,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const r = await this.evening(query, req);
    countOpen(this.db, 'shaam', req, istToday());
    sendCsv(res, `shiv-shaam-ka-hisaab-${r.day}.csv`, [
      ['Shaam ka hisaab', r.day].map(csvText),
      [csvText('Cash in (₹)'), csvRupees(r.moneyIn.cashPaise)],
      [csvText('UPI in (₹)'), csvRupees(r.moneyIn.upiPaise)],
      [csvText('Online in (₹)'), csvRupees(r.moneyIn.onlinePaise)],
      [csvText('Other in (₹)'), csvRupees(r.moneyIn.otherPaise)],
      [csvText('Total in (₹)'), csvRupees(r.moneyIn.totalPaise)],
      [csvText('Udhaar given (₹)'), csvRupees(r.udhaarGivenPaise)],
      [csvText('Udhaar received (₹)'), csvRupees(r.udhaarReceivedPaise)],
      [csvText('Orders'), String(r.orders)],
      [csvText('Shops closed'), `${r.galla.closed}`, csvText('of'), `${r.galla.shops}`],
      [csvText('Galla difference (₹)'), csvRupees(r.galla.differencePaise)],
    ]);
  }

  // ---- Vasooli list -----------------------------------------------------------------------------
  /**
   * Who to chase, biggest first, and only balances an owner has signed: a person rings from this
   * list, and a wrong number costs a relationship. Unsigned customers are counted, not listed.
   */
  private async vasooli(query: Record<string, unknown>, req: AuthRequest, wholeList: boolean) {
    const shop = shopAsked(req, 'crm.vasooli.read', query.locationId);
    const ids = shopIds(shop);
    // Someone limited to some firms, or anyone asking for one, gets those firms' dues only.
    const firms = firmIdsOf(firmAsked(req, query.firmId));
    const today = istToday();
    const page = paginate(
      wholeList ? {} : { limit: query.limit ?? String(VASOOLI_PAGE), cursor: query.cursor },
      `vasooli:${JSON.stringify(ids ?? [])}${firms ? `:${firms.join(',')}` : ''}`,
      'khataBalancePaise',
    );
    const { finished, totalDuePaise, customersWithDue, unsignedCustomers } = firms
      ? await this.vasooliAtFirms(firms, ids, page, query.cursor, wholeList)
      : await this.vasooliAll(ids, page, wholeList);
    const customerIds = finished.items.map((row) => row.id);
    const [oldest, stopped, paid, reminded, promises] = await Promise.all([
      firms ? firmOldestDues(this.db, firms, customerIds) : oldestDues(this.db, customerIds),
      stoppedIds(this.db, finished.items),
      this.db.customerLedgerEntry.findMany({
        where: {
          customerId: { in: customerIds },
          kind: 'PAYMENT_RECEIVED',
          reversal: null,
          ...(firms ? { firmId: { in: firms } } : {}),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { customerId: true, occurredAt: true, amountPaise: true, createdAt: true },
      }),
      this.db.customerContact.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, kind: 'REMINDER' },
        _max: { createdAt: true },
      }),
      this.db.followUp.findMany({
        where: {
          customerId: { in: customerIds },
          ...(ids ? { locationId: { in: ids } } : {}),
          ...(firms ? { location: { firmId: { in: firms } } } : {}),
          doneAt: null,
          kind: 'PAYMENT',
          promisedPaise: { not: null },
        },
        orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
        select: { id: true, customerId: true, dueOn: true, promisedPaise: true, createdAt: true },
      }),
    ]);
    return {
      today,
      nextCursor: finished.nextCursor,
      totalDuePaise,
      customersWithDue,
      // Enough to say "12 grahak: purana hisaab pakka karna baaki", and no more.
      unsigned: { customers: unsignedCustomers },
      items: finished.items.map((row) => {
        const due = oldest.get(row.id) ?? null;
        const last = paid.find((entry) => entry.customerId === row.id);
        const promise = promises.find((item) => item.customerId === row.id);
        const paidSince = promise
          ? paid
              .filter(
                (entry) => entry.customerId === row.id && entry.createdAt >= promise.createdAt,
              )
              .reduce((sum, entry) => sum - entry.amountPaise, 0)
          : 0;
        return {
          id: row.id,
          name: row.name,
          area: row.area,
          ...phoneFields(req, row.phone),
          balancePaise: row.khataBalancePaise,
          limitPaise: row.creditLimitPaise,
          oldestDueOn: due?.on ?? null,
          ageDays: due ? Math.max(0, daysBetween(due.on, today)) : null,
          fromOpening: due?.opening ?? false,
          lastPaymentOn: last ? indiaDay(last.occurredAt) : null,
          lastPaymentPaise: last ? -last.amountPaise : null,
          lastRemindedAt:
            reminded.find((item) => item.customerId === row.id)?._max.createdAt ?? null,
          promise: promise
            ? {
                followUpId: promise.id,
                dueOn: promise.dueOn,
                promisedPaise: promise.promisedPaise,
                state: promiseState({
                  promisedPaise: promise.promisedPaise,
                  paidSincePaise: paidSince,
                  dueOn: promise.dueOn,
                  today,
                }),
              }
            : null,
          reminderBlocked: reminderBlock({
            purpose: 'PAYMENT',
            stopped: stopped.has(row.id),
            signed: true,
            balancePaise: row.khataBalancePaise,
            phone: row.phone,
          }),
        };
      }),
    };
  }

  /** Every firm: each customer's one balance, under the shop that last gave them credit. */
  private async vasooliAll(
    ids: string[] | undefined,
    page: ReturnType<typeof paginate>,
    wholeList: boolean,
  ) {
    const owing = { ...realCustomer, khataBalancePaise: { gt: 0 } } satisfies Prisma.UserWhereInput;
    // Each balance counts under the shop that last gave credit, so the shops add up to the firm.
    const inShop = ids
      ? [...(await balanceShops(this.db)).entries()]
          .filter(([, locationId]) => ids.includes(locationId))
          .map(([customerId]) => customerId)
      : null;
    const scoped_ = inShop ? { id: { in: inShop } } : {};
    const signed = { ...owing, ...scoped_, khataSignoffs: { some: {} } };
    const [rows, totals, unsigned] = await Promise.all([
      this.db.user.findMany({
        where: { ...signed, ...page.after },
        orderBy: page.orderBy,
        take: wholeList ? SHEET_LIMIT : page.take,
        select: vasooliFields,
      }),
      this.db.user.aggregate({ where: signed, _sum: { khataBalancePaise: true }, _count: true }),
      this.db.user.aggregate({
        where: { ...owing, ...scoped_, khataSignoffs: { none: {} } },
        _count: true,
      }),
    ]);
    return {
      finished: wholeList ? { items: rows, nextCursor: null } : page.finish(rows),
      totalDuePaise: totals._sum.khataBalancePaise ?? 0,
      customersWithDue: totals._count,
      unsignedCustomers: unsigned._count,
    };
  }

  /**
   * Some firms: each customer's due is the total over those firms, under the shop of their last
   * credit at them, and signed when one of those firms has signed it. Sorted here, since the total
   * is not a column; the cursor is the same as on the whole list.
   */
  private async vasooliAtFirms(
    firms: string[],
    ids: string[] | undefined,
    page: ReturnType<typeof paginate>,
    cursor: unknown,
    wholeList: boolean,
  ) {
    const sums = await this.db.customerFirmBalance.groupBy({
      by: ['customerId'],
      where: { firmId: { in: firms }, customer: realCustomer },
      _sum: { balancePaise: true },
      having: { balancePaise: { _sum: { gt: 0 } } },
    });
    let owing = sums.map((row) => ({ id: row.customerId, paise: row._sum.balancePaise ?? 0 }));
    if (ids) {
      const shops = await firmBalanceShops(
        this.db,
        firms,
        owing.map((row) => row.id),
      );
      owing = owing.filter((row) => ids.includes(shops.get(row.id) ?? ''));
    }
    const signoffs = await this.db.khataSignoff.findMany({
      where: { firmId: { in: firms }, customerId: { in: owing.map((row) => row.id) } },
      select: { customerId: true },
    });
    const isSigned = new Set(signoffs.map((row) => row.customerId));
    const signed = owing
      .filter((row) => isSigned.has(row.id))
      .sort((a, b) => b.paise - a.paise || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    // paginate has already checked this cursor and its number.
    const after =
      !wholeList && typeof cursor === 'string' && cursor
        ? (JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { value: number; id: string })
        : null;
    const wanted = signed
      .filter(
        (row) =>
          !after || row.paise < after.value || (row.paise === after.value && row.id < after.id),
      )
      .slice(0, wholeList ? SHEET_LIMIT : page.take);
    const people = await this.db.user.findMany({
      where: { id: { in: wanted.map((row) => row.id) } },
      select: vasooliFields,
    });
    const rows = wanted.flatMap((row) => {
      const person = people.find((item) => item.id === row.id);
      return person ? [{ ...person, khataBalancePaise: row.paise }] : [];
    });
    return {
      finished: wholeList ? { items: rows, nextCursor: null } : page.finish(rows),
      totalDuePaise: signed.reduce((sum, row) => sum + row.paise, 0),
      customersWithDue: signed.length,
      unsignedCustomers: owing.length - signed.length,
    };
  }

  @Firm('own')
  @Can('crm.vasooli.read', scoped)
  @Get('reports/vasooli')
  vasooliList(@Query() query: Record<string, unknown>, @Req() req: AuthRequest) {
    countOpen(this.db, 'vasooli', req, istToday());
    return this.vasooli(query, req, false);
  }

  @Firm('own')
  @Can('crm.vasooli.read', scoped)
  @Get('reports/vasooli.csv')
  async vasooliCsv(
    @Query() query: Record<string, unknown>,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const r = await this.vasooli({ locationId: query.locationId, firmId: query.firmId }, req, true);
    countOpen(this.db, 'vasooli', req, r.today);
    sendCsv(res, `shiv-vasooli-${r.today}.csv`, [
      [
        'Customer',
        'Mobile',
        'Area',
        'Balance (₹)',
        'Limit (₹)',
        'Oldest due',
        'Age (days)',
        'Last paid',
        'Last paid (₹)',
        'Promise date',
        'Promised (₹)',
        'Promise',
      ].map(csvText),
      ...r.items.map((row) => [
        csvText(row.name),
        csvText(row.phone ?? row.phoneMasked),
        csvText(row.area),
        csvRupees(row.balancePaise),
        row.limitPaise === null ? '' : csvRupees(row.limitPaise),
        row.oldestDueOn ?? '',
        row.ageDays === null ? '' : String(row.ageDays),
        row.lastPaymentOn ?? '',
        row.lastPaymentPaise === null ? '' : csvRupees(row.lastPaymentPaise),
        row.promise?.dueOn ?? '',
        row.promise?.promisedPaise ? csvRupees(row.promise.promisedPaise) : '',
        row.promise?.state ?? '',
      ]),
    ]);
  }

  // ---- Chup grahak ------------------------------------------------------------------------------
  /**
   * Regulars who have gone quiet by their own measure: facts a person can check, with no score.
   * Anyone already being looked after (an open call, a recent contact, a sale in the books) is left
   * alone, so the same ten names do not come back every week.
   */
  private async quiet(query: Record<string, unknown>, req: AuthRequest, limit: number) {
    const shop = shopAsked(req, 'crm.dormant.read', query.locationId);
    const ids = shopIds(shop);
    // Quiet at these firms: only their orders count, and only customers they know are listed.
    const firm = firmAsked(req, query.firmId);
    const today = istToday();
    const yearAgo = dayStart(addDays(today, -quietRule.windowDays));
    const candidates = await this.db.user.findMany({
      where: {
        ...realCustomer,
        ...customerFirmWhere(req),
        NOT: { tags: { has: QUIET_TAG } },
        lastOrderAt: { gte: yearAgo, lt: dayStart(addDays(today, -quietRule.minQuietDays + 1)) },
        followUps: { none: { doneAt: null } },
        customerContacts: {
          none: { createdAt: { gte: dayStart(addDays(today, -QUIET_LEFT_ALONE_DAYS)) } },
        },
      },
      orderBy: [{ lastOrderAt: 'desc' }, { id: 'desc' }],
      take: QUIET_CANDIDATES,
      select: { id: true, name: true, phone: true, area: true, remindersStoppedAt: true },
    });
    const orders = await this.db.order.findMany({
      where: {
        userId: { in: candidates.map((row) => row.id) },
        createdAt: { gte: yearAgo },
        status: { notIn: [...notSold] },
        ...firm,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        createdAt: true,
        totalPaise: true,
        locationId: true,
        address: true,
        items: {
          select: { name: true, unit: true, pricePaise: true, quantity: true },
          orderBy: { lineTotalPaise: 'desc' },
          take: 1,
        },
      },
    });
    const seesMoney = (locationId: string) => canDo(req.access, 'orders.read.money', locationId);
    const byPerson = new Map<string, typeof orders>();
    for (const order of orders)
      byPerson.set(order.userId, [...(byPerson.get(order.userId) ?? []), order]);
    const facts = candidates.flatMap((person) => {
      const mine = byPerson.get(person.id) ?? [];
      const last = mine[0];
      if (!last || (ids && !ids.includes(last.locationId))) return [];
      const check = quietCheck(
        mine.map((order) => indiaDay(order.createdAt)),
        today,
      );
      if (!check?.quiet) return [];
      // What they spent at a shop this person does not see stays with that shop.
      const seen = mine.filter((order) => seesMoney(order.locationId));
      return [{ person, last, check, yearPaise: seen.reduce((sum, o) => sum + o.totalPaise, 0) }];
    });
    // A sale in the books means they are not quiet, only not in the app.
    const soldInBooks = await this.tally.soldSince(
      facts.map((row) => row.person.id),
      addDays(today, -quietRule.minQuietDays),
    );
    const open = facts.filter((row) => !soldInBooks.has(row.person.id));
    const stopped = await stoppedIds(
      this.db,
      open.map((row) => row.person),
    );
    return {
      today,
      rule: quietRule,
      total: open.length,
      items: open
        // Whoever spent most comes first. The figure is on the row, so anyone can check the order.
        .sort(
          (a, b) =>
            b.yearPaise - a.yearPaise ||
            b.check.quietDays - a.check.quietDays ||
            a.person.id.localeCompare(b.person.id),
        )
        .slice(0, limit)
        .map(({ person, last, check, yearPaise }) => {
          const line = last.items[0];
          return {
            id: person.id,
            name: person.name,
            area: person.area,
            ...phoneFields(req, person.phone),
            orders: check.orders,
            lastOrderOn: check.lastOrderOn,
            quietDays: check.quietDays,
            usualGapDays: check.usualGapDays,
            yearPaise: seesMoney(last.locationId) ? yearPaise : null,
            lastMaterial: line?.name ?? '',
            lastQuantity: line?.quantity ?? null,
            lastUnit: line?.unit ?? '',
            lastRatePaise: line && seesMoney(last.locationId) ? line.pricePaise : null,
            site: ((last.address as { area?: string } | null)?.area ?? '') as string,
            reminderBlocked: reminderBlock({
              purpose: 'QUIET',
              stopped: stopped.has(person.id),
              signed: false,
              balancePaise: 0,
              phone: person.phone,
            }),
          };
        }),
    };
  }

  @Firm('own')
  @Can('crm.dormant.read', scoped)
  @Get('crm/dormant')
  dormant(@Query() query: Record<string, unknown>, @Req() req: AuthRequest) {
    countOpen(this.db, 'chup-grahak', req, istToday());
    return this.quiet(query, req, QUIET_ROWS);
  }

  @Firm('own')
  @Can('crm.dormant.read', scoped)
  @Get('reports/chup-grahak.csv')
  async dormantCsv(
    @Query() query: Record<string, unknown>,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const r = await this.quiet(query, req, QUIET_ROWS);
    countOpen(this.db, 'chup-grahak', req, r.today);
    sendCsv(res, `shiv-chup-grahak-${r.today}.csv`, [
      [
        'Customer',
        'Mobile',
        'Area',
        'Orders in a year',
        'Last order',
        'Days quiet',
        'Usual gap (days)',
        'Spent in a year (₹)',
        'Last material',
        'Last rate (₹)',
        'Site',
      ].map(csvText),
      ...r.items.map((row) => [
        csvText(row.name),
        csvText(row.phone ?? row.phoneMasked),
        csvText(row.area),
        String(row.orders),
        row.lastOrderOn,
        String(row.quietDays),
        row.usualGapDays === null ? '' : String(row.usualGapDays),
        row.yearPaise === null ? '' : csvRupees(row.yearPaise),
        csvText(row.lastMaterial),
        row.lastRatePaise === null ? '' : csvRupees(row.lastRatePaise),
        csvText(row.site),
      ]),
    ]);
  }

  // ---- Mahine ka saar ---------------------------------------------------------------------------
  /**
   * What customers owed at a moment. At one shop, each balance counts under its last credit shop.
   * Within some firms, only those firms' entries count, both for the balance and for the shop.
   */
  private async dueAt(when: Date, ids?: string[], firms?: string[]) {
    const at = moment(when);
    const inFirms = firms ? Prisma.sql`AND e."firmId" = ANY(${firms})` : Prisma.empty;
    const rows = await this.db.$queryRaw<{ paise: bigint | null }[]>`
      WITH balances AS (
        SELECT e."customerId", SUM(e."amountPaise"::bigint) AS paise
        FROM "CustomerLedgerEntry" e WHERE e."occurredAt" < ${at} ${inFirms} GROUP BY 1
      ),
      shops AS (
        SELECT DISTINCT ON (e."customerId") e."customerId", e."locationId"
        FROM "CustomerLedgerEntry" e
        WHERE e."occurredAt" < ${at} AND e."amountPaise" > 0 AND e.kind <> 'REVERSAL' ${inFirms}
          AND NOT EXISTS (SELECT 1 FROM "CustomerLedgerEntry" r
            WHERE r."reversesId" = e.id AND r."occurredAt" < ${at})
        ORDER BY e."customerId", e."occurredAt" DESC, e.id DESC
      )
      SELECT SUM(b.paise)::bigint AS paise
      FROM balances b LEFT JOIN shops s ON s."customerId" = b."customerId"
      WHERE b.paise > 0
        ${ids ? Prisma.sql`AND s."locationId" = ANY(${ids})` : Prisma.empty}`;
    return Number(rows[0]?.paise ?? 0);
  }

  private async month(query: Record<string, unknown>, req: AuthRequest) {
    const today = istToday();
    const month = typeof query.month === 'string' ? query.month : today.slice(0, 7);
    const { start, end } = monthRange(month, today);
    const shop = shopAsked(req, 'reports.read', query.locationId);
    const ids = shopIds(shop);
    const firm = firmAsked(req, query.firmId);
    const firms = firmIdsOf(firm);
    const range = { gte: start, lt: end };
    const sold = { createdAt: range, status: { notIn: [...notSold] }, ...shop, ...firm };
    const [lines, orders, given, moves, startDue, endDue] = await Promise.all([
      this.db.orderItem.groupBy({
        by: ['productId', 'unit'],
        where: { order: sold },
        _sum: { lineTotalPaise: true, quantity: true },
      }),
      this.db.order.findMany({
        where: sold,
        select: {
          totalPaise: true,
          user: { select: { id: true, name: true, phone: true, role: true } },
        },
      }),
      this.db.customerLedgerEntry.aggregate({
        where: {
          occurredAt: range,
          ...shop,
          ...firm,
          OR: [
            { kind: 'SALE_ON_CREDIT' },
            { kind: 'REVERSAL', reverses: { kind: 'SALE_ON_CREDIT' } },
          ],
        },
        _sum: { amountPaise: true },
      }),
      this.db.financialMovement.findMany({
        where: {
          occurredAt: range,
          kind: { in: ['KHATA_PAYMENT', 'KHATA_PAYMENT_REVERSAL'] },
          ...shop,
          ...firm,
        },
        select: { kind: true, amountPaise: true },
      }),
      this.dueAt(start, ids, firms),
      this.dueAt(end, ids, firms),
    ]);
    const products = await this.db.product.findMany({
      where: { id: { in: lines.map((row) => row.productId) } },
      select: { id: true, name: true },
    });
    const totals = new Map<
      string,
      { id: string; name: string; phone: string; totalPaise: number; orders: number }
    >();
    for (const order of orders) {
      if (order.user.phone === 'walk-in:store') continue;
      const row = totals.get(order.user.id) ?? { ...order.user, totalPaise: 0, orders: 0 };
      row.totalPaise += order.totalPaise;
      row.orders++;
      totals.set(order.user.id, row);
    }
    const seesBooks = canDo(req.access, 'tally.numbers.view');
    const givenPaise = given._sum.amountPaise ?? 0;
    const receivedPaise = moves.reduce(
      (sum, row) => sum + (row.kind === 'KHATA_PAYMENT' ? row.amountPaise : -row.amountPaise),
      0,
    );
    const last = addDays(`${month}-01`, 31).slice(0, 7);
    return {
      month,
      materials: lines
        .map((row) => ({
          productId: row.productId,
          name: products.find((product) => product.id === row.productId)?.name ?? '',
          unit: row.unit,
          quantity: row._sum.quantity ?? 0,
          totalPaise: row._sum.lineTotalPaise ?? 0,
        }))
        .sort((a, b) => b.totalPaise - a.totalPaise || a.name.localeCompare(b.name)),
      topCustomers: [...totals.values()]
        .sort((a, b) => b.totalPaise - a.totalPaise || a.id.localeCompare(b.id))
        .slice(0, 10)
        .map((row) => ({
          id: row.id,
          name: row.name,
          ...phoneFields(req, row.phone),
          totalPaise: row.totalPaise,
          orders: row.orders,
        })),
      appSalesPaise: orders.reduce((sum, order) => sum + order.totalPaise, 0),
      udhaar: {
        startPaise: startDue,
        endPaise: endDue,
        givenPaise,
        receivedPaise,
        // Signed openings, corrections and balances moving between shops, so the column adds up.
        otherPaise: endDue - startDue - givenPaise + receivedPaise,
      },
      // The word Tally reaches only those who may see its numbers.
      ...(seesBooks
        ? {
            tally: await this.booksFor(month, last, firms),
          }
        : {}),
    };
  }

  private async booksFor(month: string, nextMonth: string, firms?: string[]) {
    const lastDay = addDays(`${nextMonth}-01`, -1);
    if (firms) {
      const companies = await this.firmCompanies(firms);
      if (!companies.length) return { connected: false as const };
      const [sales, suppliers] = await Promise.all([
        this.db.$queryRaw<{ paise: bigint | null }[]>`
          SELECT SUM(ABS(v."partyAmountPaise"))::bigint AS paise
          FROM "TallyVoucher" v
          WHERE v."companyId" = ANY(${companies}) AND v."deletedAt" IS NULL
            AND v."isOptional" = false AND v."isCancelled" = false
            AND v."baseType" = 'Sales' AND v.date >= ${`${month}-01`} AND v.date <= ${lastDay}`,
        this.firmSuppliers(companies, 1),
      ]);
      return {
        connected: true as const,
        salesPaise: wire(sales[0]?.paise ?? null),
        suppliers: { totalPaise: suppliers.totalPaise, asOf: suppliers.asOf },
      };
    }
    if (!(await this.tally.connected())) return { connected: false as const };
    const suppliers = await this.tally.suppliers(1);
    return {
      connected: true as const,
      salesPaise: await this.tally.salesBetween(`${month}-01`, lastDay),
      suppliers: { totalPaise: suppliers.totalPaise, asOf: suppliers.asOf },
    };
  }

  /**
   * The Tally companies keeping these firms' books. One not mapped to a firm yet could be anyone's,
   * so it counts only for someone who sees every firm, through TallyNumbers.
   */
  private async firmCompanies(firms: string[]) {
    const rows = await this.db.tallyCompany.findMany({
      where: { role: 'PRIMARY', firmId: { in: firms } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * TallyNumbers.suppliers, within some companies. Kept here only until that class can take a list
   * of companies itself.
   */
  private async firmSuppliers(companies: string[], limit = 200) {
    const where = {
      class: 'CREDITOR',
      deletedAt: null,
      closingPaise: { gt: 0 },
      companyId: { in: companies },
    } satisfies Prisma.TallyLedgerWhereInput;
    const [rows, total] = await Promise.all([
      this.db.tallyLedger.findMany({
        where,
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
      }),
      this.db.tallyLedger.aggregate({
        where,
        _sum: { closingPaise: true },
        _max: { closingAsOf: true },
      }),
    ]);
    const shown = rows.slice(0, limit);
    const latest = await this.db.tallyVoucher.groupBy({
      by: ['companyId', 'partyGuid', 'baseType'],
      where: {
        companyId: { in: companies },
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

  @Firm('own')
  @Can('reports.read', scoped)
  @Get('reports/mahine')
  mahine(@Query() query: Record<string, unknown>, @Req() req: AuthRequest) {
    countOpen(this.db, 'mahine', req, istToday());
    return this.month(query, req);
  }

  @Firm('own')
  @Can('reports.read', scoped)
  @Get('reports/mahine.csv')
  async mahineCsv(
    @Query() query: Record<string, unknown>,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const r = await this.month(query, req);
    countOpen(this.db, 'mahine', req, istToday());
    sendCsv(res, `shiv-mahine-ka-saar-${r.month}.csv`, [
      ['Mahine ka saar', r.month].map(csvText),
      [],
      ['Material', 'Unit', 'Quantity', 'Sales (₹)'].map(csvText),
      ...r.materials.map((row) => [
        csvText(row.name),
        csvText(row.unit),
        String(row.quantity),
        csvRupees(row.totalPaise),
      ]),
      [],
      ['Top customers', 'Mobile', 'Sales (₹)', 'Orders'].map(csvText),
      ...r.topCustomers.map((row) => [
        csvText(row.name),
        csvText(row.phone ?? row.phoneMasked),
        csvRupees(row.totalPaise),
        String(row.orders),
      ]),
      [],
      [csvText('App sales (₹)'), csvRupees(r.appSalesPaise)],
      [csvText('Udhaar at start (₹)'), csvRupees(r.udhaar.startPaise)],
      [csvText('Udhaar given (₹)'), csvRupees(r.udhaar.givenPaise)],
      [csvText('Udhaar received (₹)'), csvRupees(r.udhaar.receivedPaise)],
      [csvText('Openings and corrections (₹)'), csvRupees(r.udhaar.otherPaise)],
      [csvText('Udhaar at end (₹)'), csvRupees(r.udhaar.endPaise)],
      ...(r.tally?.connected
        ? [
            [
              csvText('Tally sales (₹)'),
              r.tally.salesPaise ? csvRupees(BigInt(r.tally.salesPaise)) : '',
            ],
            [
              csvText('Supplier dues (₹)'),
              r.tally.suppliers.totalPaise ? csvRupees(BigInt(r.tally.suppliers.totalPaise)) : '',
            ],
          ]
        : []),
    ]);
  }

  // ---- Supplier baaki ---------------------------------------------------------------------------
  /**
   * Read-only, from the books, for owners and the accountant. The app keeps no supplier ledger.
   * Someone limited to some firms, or anyone asking for one, reads only those firms' companies.
   */
  @Firm('own')
  @Can('tally.numbers.view')
  @Get('tally/suppliers')
  async suppliers(@Query() query: Record<string, unknown>, @Req() req: AuthRequest) {
    const firms = firmIdsOf(firmAsked(req, query.firmId));
    if (firms) {
      const companies = await this.firmCompanies(firms);
      if (!companies.length) return { connected: false as const, items: [] };
      return { connected: true as const, ...(await this.firmSuppliers(companies)) };
    }
    if (!(await this.tally.connected())) return { connected: false as const, items: [] };
    return { connected: true as const, ...(await this.tally.suppliers()) };
  }

  // ---- Who opens what ---------------------------------------------------------------------------
  /**
   * Plan 09: measure opens, and delete any report nobody opens in 30 days. Counts of opens per
   * report and nothing else: no money, customer or shop of either firm.
   */
  @Firm('none')
  @Can('audit.read')
  @Get('reports/opens')
  async opens() {
    const since = addDays(istToday(), -30);
    const rows = await this.db.reportOpen.groupBy({
      by: ['report'],
      where: { day: { gte: since } },
      _sum: { opens: true },
      _max: { day: true },
    });
    return {
      since,
      reports: ['shaam', 'vasooli', 'aaj-ke-call', 'chup-grahak', 'mahine'].map((report) => {
        const row = rows.find((item) => item.report === report);
        return { report, opens: row?._sum.opens ?? 0, lastOpenedOn: row?._max.day ?? null };
      }),
    };
  }
}
