/** What the CRM routes send. Fields a person may not see simply are not there, or are null. */
export type ReminderBlock = 'NO_PHONE' | 'STOPPED' | 'NOT_SIGNED' | 'NO_BALANCE';
export type FollowUpKind = 'PAYMENT' | 'ORDER' | 'CALLBACK' | 'OTHER';

export type Call = {
  id: string;
  customer: {
    id: string;
    name: string;
    area: string;
    phone: string | null;
    phoneMasked: string;
  };
  locationId: string;
  shopName: string;
  dueOn: string;
  overdueDays: number;
  kind: FollowUpKind;
  note: string;
  promisedPaise: number | null;
  paidSincePaise: number | null;
  promise: 'OPEN' | 'KEPT' | 'BROKEN' | null;
  assignee: { id: string; name: string } | null;
  snoozes: number;
  lastSnoozeReason: string | null;
  doneAt: string | null;
  signedOff: boolean;
  balancePaise: number | null;
  lastRemindedAt: string | null;
  reminderBlocked: ReminderBlock | null;
};
export type CallList = {
  today: string;
  items: Call[];
  truncated?: boolean;
  nextCursor: string | null;
};

export type TimelineRow = { id: string; at: string; actorName: string | null } & (
  | {
      kind: 'ORDER';
      number: string;
      status: string;
      totalPaise: number | null;
      shopName: string;
      site: string;
      firstItem: string;
      itemCount: number;
    }
  | {
      kind: 'KHATA';
      entryKind: string;
      amountPaise: number;
      balanceAfterPaise: number;
      note: string;
      channel: string;
      shopName: string;
      reversed: boolean;
      isReversal: boolean;
      orderNumber: string | null;
    }
  | { kind: 'NOTE'; body: string }
  | { kind: 'CONTACT'; contactKind: string; channel: string; purpose: string }
  | {
      kind: 'FOLLOWUP';
      followUpKind: FollowUpKind;
      dueOn: string;
      note: string;
      promisedPaise: number | null;
      assignee: { id: string; name: string } | null;
      shopName: string;
      snoozes: number;
      lastSnoozeReason: string | null;
      doneAt: string | null;
    }
);

export type CustomerFacts = {
  signoff:
    | { signed: false }
    | { signed: true; asOf: string; at: string; approvedBy: string; chosenPaise?: number };
  khataViewOn: boolean;
  reminders: { stopped: boolean; lastAt: string | null };
  lastOrder: { id: string; number: string; createdAt: string; status: string } | null;
  lastPayment: { at: string; amountPaise: number } | null;
  nextFollowUp: {
    id: string;
    dueOn: string;
    kind: FollowUpKind;
    promisedPaise: number | null;
  } | null;
  khata: {
    balancePaise: number;
    creditAllowed: boolean;
    limitPaise: number | null;
    oldestDue: { on: string; opening: boolean } | null;
  } | null;
  /** Only ever present for owners and the accountant. */
  tally?: {
    connected: boolean;
    number: {
      state: 'NOT_LINKED' | 'COPYING' | 'READY';
      tallyPaise: string | null;
      differencePaise: string | null;
      unexplainedPaise: string | null;
      asOf: string | null;
      stale: boolean;
      tieOut: string | null;
    } | null;
  };
};

export type CustomerRates = {
  group: { id: string; name: string; active: boolean } | null;
  rules: {
    id: string;
    kind: 'GROUP' | 'SPECIAL';
    appliesTo: string | null;
    valueType: 'RATE' | 'PERCENT_OFF' | 'AMOUNT_OFF';
    value: number;
    minQuantity: number;
    startsOn: string | null;
    endsOn: string | null;
    started: boolean;
  }[];
  lines: {
    productId: string;
    name: string;
    unit: string;
    listPaise: number;
    ratePaise: number;
    ruleKind: string | null;
  }[];
};

export type Reminder = {
  purpose: 'PAYMENT' | 'QUIET';
  blocked: ReminderBlock | null;
  allowed: boolean;
  text: string | null;
  url: string | null;
  phone: string | null;
  phoneMasked: string;
  lastRemindedAt: string | null;
  remindedToday: boolean;
  warnDifference?: boolean;
};

export type Shaam = {
  day: string;
  moneyIn: {
    cashPaise: number;
    upiPaise: number;
    onlinePaise: number;
    otherPaise: number;
    totalPaise: number;
  };
  udhaarGivenPaise: number;
  udhaarReceivedPaise: number;
  orders: number;
  galla: { shops: number; closed: number; differencePaise: number };
};
export type VasooliRow = {
  id: string;
  name: string;
  area: string;
  phone: string | null;
  phoneMasked: string;
  balancePaise: number;
  limitPaise: number | null;
  oldestDueOn: string | null;
  ageDays: number | null;
  fromOpening: boolean;
  lastPaymentOn: string | null;
  lastPaymentPaise: number | null;
  lastRemindedAt: string | null;
  promise: {
    followUpId: string;
    dueOn: string;
    promisedPaise: number | null;
    state: 'OPEN' | 'KEPT' | 'BROKEN' | null;
  } | null;
  reminderBlocked: ReminderBlock | null;
};
export type Vasooli = {
  today: string;
  nextCursor: string | null;
  totalDuePaise: number;
  customersWithDue: number;
  unsigned: { customers: number };
  items: VasooliRow[];
};
export type QuietRow = {
  id: string;
  name: string;
  area: string;
  phone: string | null;
  phoneMasked: string;
  orders: number;
  lastOrderOn: string;
  quietDays: number;
  usualGapDays: number | null;
  yearPaise: number | null;
  lastMaterial: string;
  lastQuantity: number | null;
  lastUnit: string;
  lastRatePaise: number | null;
  site: string;
  reminderBlocked: ReminderBlock | null;
};
export type Quiet = {
  today: string;
  total: number;
  rule: { minOrders: number; minQuietDays: number; timesUsualGap: number };
  items: QuietRow[];
};
export type Mahine = {
  month: string;
  materials: {
    productId: string;
    name: string;
    unit: string;
    quantity: number;
    totalPaise: number;
  }[];
  topCustomers: {
    id: string;
    name: string;
    phone: string | null;
    phoneMasked: string;
    totalPaise: number;
    orders: number;
  }[];
  appSalesPaise: number;
  udhaar: {
    startPaise: number;
    endPaise: number;
    givenPaise: number;
    receivedPaise: number;
    otherPaise: number;
  };
  tally?:
    | { connected: false }
    | {
        connected: true;
        salesPaise: string | null;
        suppliers: { totalPaise: string | null; asOf: string | null };
      };
};
export type Suppliers =
  | { connected: false; items: [] }
  | {
      connected: true;
      totalPaise: string | null;
      asOf: string | null;
      truncated: boolean;
      items: {
        id: string;
        name: string;
        payablePaise: string | null;
        asOf: string | null;
        tiedOut: boolean | null;
        lastPurchaseOn: string | null;
        lastPaymentOn: string | null;
      }[];
    };

export type OpeningRow = {
  id: string;
  name: string;
  area: string;
  phone: string | null;
  phoneMasked: string;
  appBalancePaise: number;
  creditAllowed: boolean;
  khataViewOn: boolean;
  draft: {
    customerId: string;
    locationId: string;
    asOf: string;
    paperPaise: number;
    tallyPaise: string | null;
    tallyAsOf: string | null;
    note: string;
    version: number;
  } | null;
  tallyPaise?: string | null;
  signoff: {
    asOf: string;
    chosenPaise: number;
    paperPaise: number | null;
    at: string;
    reason: string;
  } | null;
};
export type OpeningSheet = {
  items: OpeningRow[];
  nextCursor: string | null;
  pending: number;
  signed: number;
  today: string;
};
