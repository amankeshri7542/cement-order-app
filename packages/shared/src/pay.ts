import { z } from 'zod';

/**
 * Salary is a fixed monthly amount. Attendance is shown beside it as a fact and moves no rupee by
 * itself; an owner may add or take away with a reason. Whole paise throughout.
 */
export const maxDeductionPercent = 50;

export type PayInput = {
  monthlyPaise: number;
  additionsPaise: number;
  deductionsPaise: number;
  plannedRecoveryPaise: number;
  advanceBalancePaise: number;
};
export type PayWorked = {
  earnedPaise: number;
  deductionsPaise: number;
  recoveryPaise: number;
  roundOffPaise: number;
  netPaise: number;
  /** How much more could be taken before the limit on deductions. */
  roomPaise: number;
};

export function workOutPay(input: PayInput): PayWorked {
  const earnedPaise = input.monthlyPaise + input.additionsPaise;
  const cap = Math.floor((earnedPaise * maxDeductionPercent) / 100);
  const afterDeductions = Math.max(0, cap - input.deductionsPaise);
  // What cannot be recovered this month simply stays on the advance for next month.
  const recoveryPaise = Math.max(
    0,
    Math.min(input.plannedRecoveryPaise, input.advanceBalancePaise, afterDeductions),
  );
  const exact = earnedPaise - input.deductionsPaise - recoveryPaise;
  const netPaise = Math.round(exact / 100) * 100;
  return {
    earnedPaise,
    deductionsPaise: input.deductionsPaise,
    recoveryPaise,
    roundOffPaise: netPaise - exact,
    netPaise,
    roomPaise: Math.max(0, afterDeductions - recoveryPaise),
  };
}
/** The law's limit on what can be taken from one month's pay. */
export const deductionsAllowed = (earnedPaise: number, deductionsPaise: number) =>
  deductionsPaise * 100 <= earnedPaise * maxDeductionPercent;

const uuid = z.string().uuid();
const id = z.string().min(1).max(60);
const money = z.number().int().min(1).max(100_000_000);
const words = (max: number) => z.string().trim().max(max);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const payTermsSchema = z.strictObject({
  effectiveFrom: z.iso.date(),
  amountPaise: money,
});
export const payAdjustmentSchema = z.strictObject({
  userId: id,
  kind: z.enum(['ADDITION', 'DEDUCTION']),
  amountPaise: money,
  reason: words(200).min(2),
  idempotencyKey: uuid,
});
export const payAdjustmentReverseSchema = z.strictObject({ reason: words(200).min(2) });
export const payRecoverySchema = z.strictObject({
  userId: id,
  recoveryPaise: z.number().int().min(0).max(100_000_000),
  reason: words(200).min(2),
});
export const payLockSchema = z.strictObject({ confirm: z.literal(true) });
const moneyMoved = {
  channel: z.enum(['CASH', 'UPI']),
  paidFrom: z.enum(['GALLA', 'OWNER']),
  locationId: id.optional(),
  utr: words(40).optional(),
};
export const payPaymentSchema = z.strictObject({
  userId: id,
  amountPaise: money,
  ...moneyMoved,
  idempotencyKey: uuid,
});
export const advanceGiveSchema = z.strictObject({
  userId: id,
  amountPaise: money,
  recoveryPaise: z.number().int().min(0).max(100_000_000),
  ...moneyMoved,
  note: words(200).optional(),
  idempotencyKey: uuid,
});
export const advanceAskSchema = z.strictObject({
  userId: id,
  amountPaise: money,
  recoveryPaise: z.number().int().min(0).max(100_000_000),
  channel: z.enum(['CASH', 'UPI']).optional(),
  paidFrom: z.enum(['GALLA', 'OWNER']).optional(),
  locationId: id.optional(),
  note: words(200).optional(),
  idempotencyKey: uuid,
});
export const ledgerReverseEntrySchema = z.strictObject({
  reason: words(200).min(2),
  idempotencyKey: uuid,
});
export const paymentAckSchema = z.strictObject({ answer: z.enum(['GOT', 'NOT_GOT']) });
