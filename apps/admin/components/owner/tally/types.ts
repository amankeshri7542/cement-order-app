/** What the Tally routes send. All money from Tally is a string, as it can pass 2^53 in paise. */
export type CompanyRole = 'PENDING' | 'PRIMARY' | 'BRANCH_COPY' | 'IGNORE';

export type TallyPc = {
  id: string;
  name: string;
  locationId: string | null;
  state: string;
  stateSince: string;
  lastHeartbeatAt: string | null;
  lastGoodAt: string | null;
  lastWakeAt: string | null;
  version: string;
  targetVersion: string | null;
  os: string;
  paused: boolean;
  revoked: boolean;
  caps: {
    diskFreeMb?: number;
    updateFailed?: string;
    releaseChangedOn?: string;
    claimedElsewhere?: number;
    slowMs?: number;
  } | null;
};

export type TallyCompany = {
  id: string;
  name: string;
  role: CompanyRole;
  ownerDeviceId: string | null;
  firmId: string | null;
  booksFrom: string | null;
  lastVoucherDate: string | null;
  copyFrom: string | null;
  phase: string;
  copiedPercent: number;
  copiedBackTo: string | null;
  freshAt: string | null;
  vouchers: number;
  tieOut: { status?: string; total?: number; failed?: number; at?: string };
  failures: number;
  lastError: string | null;
  rewrittenAt: string | null;
  sameNameAsId: string | null;
};

export type TallyJob = {
  id: string;
  deviceId: string;
  companyId: string;
  kind: string;
  status: string;
  error: string | null;
  createdAt: string;
  uploadedAt: string | null;
  finishedAt: string | null;
};

export type TallyStatus = {
  serverNow: string;
  connected: boolean;
  devices: TallyPc[];
  companies: TallyCompany[];
  /** Only with tally.health: the owners' and the technical operator's view. */
  jobs?: TallyJob[];
  storedParts?: number;
  storedBytes?: number;
};

export type PartySuggestion = {
  userId: string;
  name: string;
  /** Masked for anyone who may not hold a customer's number. */
  phone: string;
  area: string;
  by: 'PHONE' | 'GSTIN' | 'NAME';
  score: number;
};

export type Party = {
  id: string;
  companyId: string;
  company: string;
  name: string;
  group: string;
  /** Tally's own ledger phones. */
  phones: string[];
  gstin: string | null;
  closingPaise: string | null;
  asOf: string | null;
  tieOutOk: boolean | null;
  status: 'LINKED' | 'UNLINKED' | 'NOT_CUSTOMER';
  method: string | null;
  confirmedAt: string | null;
  customer: { id: string; name: string; phone: string } | null;
  suggestions: PartySuggestion[];
};

export type PartyList = {
  items: Party[];
  nextSkip: number | null;
  progress: {
    linkedPaise: string;
    totalPaise: string;
    linkedParties: number;
    totalParties: number;
  };
};

export type LineReason = 'TIMING' | 'APP_ONLY' | 'TALLY_ONLY' | 'AMOUNT' | 'OPENING';

export type DifferenceLine = {
  reason: LineReason;
  amountPaise: string;
  entryId?: string;
  voucherId?: string;
  on?: string;
  label?: string;
  note?: 'NOT_AGREED_YET' | 'SIGNED' | 'WITHIN_TOLERANCE';
};

export type NumbersParty = {
  ledgerId: string;
  name: string;
  companyId: string;
  company: string;
  closingPaise: string | null;
  asOf: string | null;
  tieOutOk: boolean | null;
  tieOutGapPaise: string | null;
  deleted: boolean;
};

export type StandingMatch = {
  id: string;
  entryId: string;
  voucherId: string;
  amountPaise: string;
  on: string | null;
  label: string;
  voucherGone: boolean;
  at: string;
};

export type VoucherChange = {
  id: string;
  reason: 'CHANGED';
  kind: 'ALTERED' | 'DELETED' | 'RESTORED';
  voucherId: string;
  oldAmountPaise: string | null;
  newAmountPaise: string | null;
  detectedAt: string;
};

export type CustomerNumbers =
  | {
      customerId: string;
      khataPaise: number;
      state: 'NOT_LINKED';
      tally: null;
      parties: NumbersParty[];
    }
  | {
      customerId: string;
      khataPaise: number;
      state: 'COPYING' | 'READY';
      tally: {
        closingPaise: string;
        appEquivalentPaise: string;
        asOf: string | null;
        stale: boolean;
        tieOut: 'OK' | 'FAILED' | 'PENDING' | 'REWRITTEN';
        copying: boolean;
        /** Null while the copy is being made: plan 09 holds it back. */
        differencePaise: string | null;
        unexplainedPaise?: string;
      };
      parties: NumbersParty[];
      lines: DifferenceLine[];
      suggestions: { entryId: string; voucherId: string; amountPaise: string }[];
      changes: VoucherChange[];
      matches: StandingMatch[];
    };

export type DifferenceRow = {
  customerId: string;
  name: string;
  phone: string;
  appPaise: number;
  tallyPaise: string | null;
  differencePaise: string | null;
  unexplainedPaise: string | null;
  reasons: Partial<Record<LineReason, string>> | null;
  tallyAsOf: string | null;
  computedAt: string;
};

export type DifferenceList = { items: DifferenceRow[]; nextSkip: number | null };
