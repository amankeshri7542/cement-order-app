import { addDays } from '@shiv/shared';

export type When = 'today' | 'tomorrow' | 'week' | 'pick';

/** Kal, Agle hafte, Tareekh chuno, as a date in India time. */
export function dayFor(when: When, picked: string, today: string) {
  if (when === 'today') return today;
  if (when === 'tomorrow') return addDays(today, 1);
  if (when === 'week') return addDays(today, 7);
  return picked;
}

const grouping = new Intl.NumberFormat('en-IN');
/**
 * Tally's money comes as a string because a supplier's dues can pass what a number holds safely in
 * paise, so it is never turned into one here. Whole rupees show no decimals.
 */
export function bookMoney(paise: string) {
  const value = BigInt(paise);
  const whole = value < 0n ? -value : value;
  const rupees = grouping.format(whole / 100n);
  const rest = whole % 100n;
  return `${value < 0n ? '-' : ''}₹${rupees}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}
