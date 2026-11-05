import {
  dayShift,
  financialYearStart,
  tallyDate,
  tallyDayNumber,
  type TallyReadName,
} from '@shiv/shared';

export type ReadSpec = {
  read: TallyReadName;
  count?: boolean;
  params: Record<string, string | string[]>;
};
export type JobPlan = {
  kind: 'MASTERS' | 'BASELINE' | 'WINDOW' | 'DELTA' | 'SWEEP';
  reads: ReadSpec[];
  params: Record<string, string | number | boolean>;
};
export type PlanCompany = {
  name: string;
  booksFrom: string | null;
  lastVoucherDate: string | null;
  phase: string;
  copyFrom: string | null;
  backfillCursor: string | null;
  backfillWindowDays: number;
  lastSweepOn: string | null;
  altMstId: bigint;
  altVchId: bigint;
  wmMstId: bigint;
  wmVchId: bigint;
  marksChangedAt: Date | null;
  marksFirstChangedAt: Date | null;
  failures: number;
  lastFailureAt: Date | null;
};

/** Bounded reads, so a long day's changes can never become one huge request to a busy Tally. */
export const deltaWindow = BigInt(500);
const quietMs = 5 * 60000;
const quietAtMostMs = 15 * 60000;
/** A failing read waits a little, then longer: Tally is often cured by a restart, not by asking again. */
export const failureBackoffMs = (failures: number) =>
  failures >= 3 ? 10 * 60000 : failures * 60000;

const parties = (base: Record<string, string>, toDate?: string): ReadSpec[] =>
  ['Sundry Debtors', 'Sundry Creditors'].map((group) => ({
    read: 'parties' as const,
    count: true,
    params: { ...base, group, ...(toDate ? { toDate } : {}) },
  }));

export const copyFromFor = (company: Pick<PlanCompany, 'booksFrom'>, today: string) => {
  const start = financialYearStart(today);
  return company.booksFrom && company.booksFrom > start ? company.booksFrom : start;
};

/** The one next job for a company, or nothing. Tally's quiet moments decide, not a timer. */
export function planJob(
  company: PlanCompany,
  copyTypes: string[],
  today: string,
  now: Date,
): JobPlan | null {
  if (company.failures && company.lastFailureAt) {
    const since = now.getTime() - company.lastFailureAt.getTime();
    if (since < failureBackoffMs(company.failures)) return null;
  }
  const copyFrom = company.copyFrom ?? copyFromFor(company, today);
  const base = {
    company: company.name,
    fromDate: tallyDate(
      company.booksFrom && company.booksFrom < copyFrom ? company.booksFrom : copyFrom,
    ),
    toDate: tallyDate(today),
  };
  const masters = (): JobPlan => ({
    kind: 'MASTERS',
    params: { mstUpto: String(company.altMstId), vchAt: String(company.altVchId) },
    reads: [
      { read: 'groups', count: true, params: base },
      ...parties(base),
      { read: 'voucherTypes', count: true, params: base },
      { read: 'stockItems', count: true, params: base },
      { read: 'godowns', count: true, params: base },
    ],
  });
  // Nothing about vouchers can be asked for until we know which voucher types are safe to copy.
  if (company.phase === 'MASTERS' || !copyTypes.length) return masters();
  if (company.phase === 'BASELINE') {
    const useOpening = Boolean(company.booksFrom && company.booksFrom >= copyFrom);
    return {
      kind: 'BASELINE',
      params: { copyFrom, useOpening, vchAt: String(company.altVchId) },
      reads: parties(base, useOpening ? undefined : tallyDate(dayShift(copyFrom, -1))),
    };
  }
  const voucherReads = (window: Record<string, string>): ReadSpec[] => [
    { read: 'vouchers', count: true, params: { ...base, ...window, types: copyTypes } },
    { read: 'voucherLines', params: { ...base, ...window, types: copyTypes } },
    { read: 'voucherStock', params: { ...base, ...window, types: copyTypes } },
  ];
  if (company.phase === 'BACKFILL') {
    const to = company.backfillCursor ?? today;
    const earliest = dayShift(to, 1 - company.backfillWindowDays);
    const from = earliest < copyFrom ? copyFrom : earliest;
    return {
      kind: 'WINDOW',
      params: { from, to, copyFrom },
      reads: voucherReads({ dayFrom: tallyDayNumber(from), dayTo: tallyDayNumber(to) }),
    };
  }
  // Live. The first sync of each day looks for deletes, which leave no other mark in Tally.
  if (company.lastSweepOn !== today) {
    return {
      kind: 'SWEEP',
      params: { from: copyFrom, to: today, vchAt: String(company.altVchId) },
      reads: [
        {
          read: 'voucherSweep',
          count: true,
          params: { ...base, dayFrom: tallyDayNumber(copyFrom), dayTo: tallyDayNumber(today) },
        },
        ...parties(base),
      ],
    };
  }
  const quiet =
    (company.marksChangedAt && now.getTime() - company.marksChangedAt.getTime() >= quietMs) ||
    (company.marksFirstChangedAt &&
      now.getTime() - company.marksFirstChangedAt.getTime() >= quietAtMostMs);
  if (company.altMstId > company.wmMstId && quiet) return masters();
  if (company.altVchId > company.wmVchId && quiet) {
    const after = company.wmVchId;
    const furthest = after + deltaWindow;
    const upto = company.altVchId < furthest ? company.altVchId : furthest;
    const last = upto === company.altVchId;
    return {
      kind: 'DELTA',
      params: { after: String(after), upto: String(upto), last, vchAt: String(company.altVchId) },
      reads: [
        ...voucherReads({ after: String(after), upto: String(upto) }),
        ...(last ? parties(base) : []),
      ],
    };
  }
  return null;
}
