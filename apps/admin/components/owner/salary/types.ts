export type Worked = {
  earnedPaise: number;
  deductionsPaise: number;
  recoveryPaise: number;
  roundOffPaise: number;
  netPaise: number;
  roomPaise: number;
};
export type Facts = {
  daysPresent: number;
  daysLate: number;
  weeklyOffsWorked: number;
  missingOut: number;
};
export type Adjustment = {
  id: string;
  kind: 'ADDITION' | 'DEDUCTION' | 'RECOVERY_SET' | 'REVERSAL';
  amountPaise: number;
  reason: string;
  reversesId: string | null;
  live: boolean;
  at: string;
};
export type DraftLine = {
  userId: string;
  name: string;
  locked: false;
  monthlyPaise: number;
  line: Worked;
  advanceBalancePaise: number;
  adjustments: Adjustment[];
  facts: Facts;
  netPaise: number;
  paidPaise: number;
  wagesDuePaise: number;
};
export type Slip = Worked & {
  month: string;
  name: string;
  monthlyPaise: number;
  adjustments: { kind: string; amountPaise: number; reason: string }[];
  facts: Facts;
  advanceLeftPaise: number;
  lockedAt: string;
};
export type LockedLine = {
  userId: string;
  name: string;
  locked: true;
  slip: Slip;
  netPaise: number;
  paidPaise: number;
  wagesDuePaise: number;
};
export type PayLine = DraftLine | LockedLine;
export type RunMonth = {
  month: string;
  status: 'DRAFT' | 'LOCKED';
  lockedAt: string | null;
  over: boolean;
  openReviews: number;
  lines: PayLine[];
  noTerms: { userId: string; name: string }[];
};
export type LedgerItem = {
  id: string;
  account: 'WAGES' | 'ADVANCE';
  kind: string;
  amountPaise: number;
  balanceAfterPaise: number;
  month: string | null;
  channel: string;
  paidFrom: string;
  utr: string;
  note: string;
  reversesId: string | null;
  reversed: boolean;
  at: string;
  ack: 'GOT' | 'NOT_GOT' | null;
};
export type Ledger = {
  userId: string;
  advancePaise: number;
  wagesDuePaise: number;
  chainOk: boolean;
  items: LedgerItem[];
};
export type TermsRow = {
  userId: string;
  name: string;
  amountPaise: number | null;
  effectiveFrom: string | null;
  advancePaise: number;
  wagesDuePaise: number;
};
