import type { MessageKey } from '@shiv/i18n';
import { istToday } from '@shiv/shared';
import { rupeesToPaise } from '../../../lib/money';
import type { Adjustment, LedgerItem } from './types';

/** Cash above this to one person in a day is worth a word with the accountant. */
export const cashDayLimitPaise = 1_000_000;

export const paiseOf = (rupees: string) => {
  if (!rupees.trim()) return null;
  try {
    return rupeesToPaise(rupees);
  } catch {
    return null;
  }
};

export const currentMonth = (now = new Date()) => istToday(now).slice(0, 7);
/** The month before, which is the one an owner is usually here to finish. */
export function previousMonth(now = new Date()) {
  const [year, month] = currentMonth(now).split('-').map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}
/** This month and those before it, newest first. */
export function monthChoices(now = new Date(), count = 24) {
  const [year, month] = currentMonth(now).split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, back) => {
    const total = year * 12 + (month - 1) - back;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  });
}
export const monthName = (month: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-15T00:00:00Z`),
  );

/**
 * Cash already given to this person today, and what this entry would bring it to. A warning only:
 * the rule is for the accountant to read, and the person still gets paid.
 */
export function overCashLimit(
  amountPaise: number | null,
  channel: string,
  items: readonly Pick<
    LedgerItem,
    'kind' | 'channel' | 'amountPaise' | 'at' | 'reversed' | 'reversesId'
  >[],
  now = new Date(),
) {
  if (channel !== 'CASH' || !amountPaise) return false;
  const today = istToday(now);
  const already = items
    .filter(
      (row) =>
        ['PAID', 'ADVANCE_GIVEN'].includes(row.kind) &&
        row.channel === 'CASH' &&
        !row.reversed &&
        !row.reversesId &&
        istToday(new Date(row.at)) === today,
    )
    .reduce((sum, row) => sum + row.amountPaise, 0);
  return already + amountPaise > cashDayLimitPaise;
}

/**
 * What the person said about this month's pay. "Nahi mila" on any payment outranks everything, then
 * a payment they have not answered yet. Payments taken back no longer ask anything of anyone.
 */
export function paidAnswer(
  items: readonly Pick<LedgerItem, 'kind' | 'month' | 'reversed' | 'ack'>[],
  month: string,
): 'NOT_GOT' | 'GOT' | 'NONE' | null {
  const paid = items.filter((row) => row.kind === 'PAID' && row.month === month && !row.reversed);
  if (!paid.length) return null;
  if (paid.some((row) => row.ack === 'NOT_GOT')) return 'NOT_GOT';
  return paid.every((row) => row.ack === 'GOT') ? 'GOT' : 'NONE';
}

/** A line that was taken back stays on the page beside the entry that took it back. */
export function adjustmentRows(adjustments: readonly Adjustment[]) {
  const takenBack = new Map(
    adjustments.flatMap((row) => (row.reversesId ? [[row.reversesId, row] as const] : [])),
  );
  return adjustments
    .filter((row) => row.kind === 'ADDITION' || row.kind === 'DEDUCTION')
    .map((row) => ({ ...row, takenBack: takenBack.get(row.id) ?? null }));
}
/** The last word on this month's recovery, if an owner changed it. */
export const recoveryReason = (adjustments: readonly Adjustment[]) =>
  adjustments.filter((row) => row.kind === 'RECOVERY_SET' && row.live).at(-1)?.reason ?? '';

export const ledgerWords: Record<string, MessageKey> = {
  EARNED: 'owner.salary.entry.EARNED',
  PAID: 'owner.salary.entry.PAID',
  ADVANCE_GIVEN: 'owner.salary.entry.ADVANCE_GIVEN',
  ADVANCE_RECOVERED: 'owner.salary.entry.ADVANCE_RECOVERED',
  REVERSAL: 'owner.salary.entry.REVERSAL',
};

/** Where money came from, as one value for one dropdown: a shop's drawer, or the owner's account. */
export type PaidFrom = { paidFrom: 'GALLA' | 'OWNER'; locationId?: string };
export const sourceValue = (from: PaidFrom) =>
  from.paidFrom === 'GALLA' ? `GALLA:${from.locationId ?? ''}` : 'OWNER';
export function readSource(value: string): PaidFrom {
  return value.startsWith('GALLA:')
    ? { paidFrom: 'GALLA', locationId: value.slice('GALLA:'.length) }
    : { paidFrom: 'OWNER' };
}
