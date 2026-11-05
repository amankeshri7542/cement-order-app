import type { MessageKey } from '@shiv/i18n';
import { istDay, monthText, shortDay } from './time';
import { rupees } from './kaam';
import type { QueueEntry } from './queue';
import type { Tr } from './words';

export type PayPayment = {
  id: string;
  kind: 'PAID' | 'ADVANCE_GIVEN' | string;
  amountPaise: number;
  channel: string | null;
  month: string | null;
  at: string;
  ack: 'GOT' | 'NOT_GOT' | null;
};
export type MyPay = {
  monthlyPaise: number | null;
  advancePaise: number;
  wagesDuePaise: number;
  payments: PayPayment[];
  slips: { month: string; netPaise: number }[];
};
const ackPath = (id: string) => `staff/me/payments/${id}/ack`;

/** An answer still on the phone counts, so nobody is asked the same thing twice. */
export function answerOf(payment: PayPayment, queue: readonly QueueEntry[]) {
  const waiting = queue.find(
    (entry) => entry.kind === 'payAck' && entry.path === ackPath(payment.id),
  );
  return {
    answer: (waiting?.body.answer as PayPayment['ack'] | undefined) ?? payment.ack,
    waiting: Boolean(waiting),
  };
}
const channelWord = (channel: string | null, tr: Tr) => {
  const key = `staff.paisa.channel.${channel}` as MessageKey;
  return channel && ['CASH', 'UPI', 'BANK'].includes(channel) ? tr(key) : '';
};
const dayOf = (at: string) => shortDay(istDay(Date.parse(at)));

/** "2 Nov ko ₹13,856 UPI se bheja gaya. Mil gaya?" */
export const askWords = (payment: PayPayment, tr: Tr) =>
  tr(payment.kind === 'ADVANCE_GIVEN' ? 'staff.paisa.askAdvance' : 'staff.paisa.askPaid', {
    amount: rupees(payment.amountPaise),
    channel: channelWord(payment.channel, tr),
    day: dayOf(payment.at),
  });
export const rowWords = (payment: PayPayment, tr: Tr) =>
  tr(payment.kind === 'ADVANCE_GIVEN' ? 'staff.paisa.advanceRow' : 'staff.paisa.paidRow', {
    amount: rupees(payment.amountPaise),
    channel: channelWord(payment.channel, tr),
    day: dayOf(payment.at),
  });

/** Someone with no pay set yet has nothing wrong: the screen says so plainly. */
export const payIsEmpty = (pay: MyPay | null) =>
  !pay ||
  (pay.monthlyPaise === null &&
    !pay.advancePaise &&
    !pay.wagesDuePaise &&
    !pay.payments.length &&
    !pay.slips.length);

/** The oldest payment nobody has answered, or that was answered "not got" and may yet arrive. */
export function paymentToAsk(pay: MyPay | null, queue: readonly QueueEntry[]) {
  if (!pay) return null;
  const open = pay.payments.filter((row) => {
    const { answer } = answerOf(row, queue);
    return answer === null;
  });
  return open.at(-1) ?? null;
}

export type SlipLine = { label: string; amount: string; big?: boolean };
export type Slip = {
  month: string;
  name?: string;
  monthlyPaise: number;
  earnedPaise: number;
  deductionsPaise: number;
  recoveryPaise: number;
  roundOffPaise: number;
  netPaise: number;
  adjustments?: { kind: string; amountPaise: number; reason: string }[];
  advanceLeftPaise?: number;
  lockedAt?: string;
  facts?: { daysPresent?: number };
};
/** In plain words, top to bottom: Bana, Advance kata, Milega. Each cut carries its reason. */
export function slipLines(slip: Slip, tr: Tr): SlipLine[] {
  const lines: SlipLine[] = [];
  // A fact to read beside the figures. It moves no rupee by itself.
  const days = slip.facts?.daysPresent;
  // Salary and Bana are the same figure until something is added, so one line says it.
  const added = (slip.adjustments ?? []).some((row) => row.kind === 'ADDITION');
  if (added)
    lines.push({ label: tr('staff.paisa.slip.monthly'), amount: rupees(slip.monthlyPaise) });
  for (const row of slip.adjustments ?? [])
    if (row.kind === 'ADDITION')
      lines.push({
        label: `${tr('staff.paisa.slip.addition')}: ${row.reason}`,
        amount: rupees(row.amountPaise),
      });
  lines.push({ label: tr('staff.paisa.slip.earned'), amount: rupees(slip.earnedPaise) });
  for (const row of slip.adjustments ?? [])
    if (row.kind === 'DEDUCTION')
      lines.push({
        label: `${tr('staff.paisa.slip.deduction')}: ${row.reason}`,
        amount: `-${rupees(row.amountPaise)}`,
      });
  if (slip.recoveryPaise)
    lines.push({
      label: tr('staff.paisa.slip.recovery'),
      amount: `-${rupees(slip.recoveryPaise)}`,
    });
  if (slip.roundOffPaise)
    lines.push({ label: tr('staff.paisa.slip.roundOff'), amount: rupees(slip.roundOffPaise) });
  lines.push({ label: tr('staff.paisa.slip.net'), amount: rupees(slip.netPaise), big: true });
  if (slip.advanceLeftPaise)
    lines.push({
      label: tr('staff.paisa.slip.advanceLeft'),
      amount: rupees(slip.advanceLeftPaise),
    });
  if (typeof days === 'number')
    lines.push({ label: tr('staff.paisa.slip.daysPresent', { days }), amount: '' });
  return lines;
}
export const slipTitle = (month: string, tr: Tr) =>
  tr('staff.paisa.slipTitle', { month: monthText(month, tr) });
export const slipRow = (slip: { month: string; netPaise: number }, tr: Tr) =>
  tr('staff.paisa.slipRow', { month: monthText(slip.month, tr), amount: rupees(slip.netPaise) });
