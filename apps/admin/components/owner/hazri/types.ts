import type { DayStatus, StaffRole } from '@shiv/shared';

export type RosterRow = {
  userId: string;
  name: string;
  role: StaffRole;
  status: DayStatus;
  firstInAt: string | null;
  lastOutAt: string | null;
  minutes: number | null;
  lateMinutes: number;
  flags: string[];
  linked: boolean;
  noPhone: boolean;
};
export type Roster = { day: string; locationId: string; items: RosterRow[] };

export type DayEventRow = {
  id: string;
  kind: 'IN' | 'OUT' | 'MANUAL_IN' | 'MANUAL_OUT' | 'CORRECTION' | 'DECISION' | 'SIGNAL';
  serverAt: string;
  claimedAgeMs: number | null;
  result: string | null;
  reasons: string[];
  distanceM: number | null;
  accuracyM: number | null;
  mocked: boolean;
  reason: string;
  correctsKind: string | null;
  correctedAt: string | null;
  shopName: string;
  actorName: string;
  byHand: boolean;
  review: { status: string; note: string } | null;
};
export type PersonDayData = { userId: string; day: string; events: DayEventRow[] };
export type Proof = {
  chainOk: boolean;
  brokenAtSeq: number | null;
  nightCode: string | null;
};

export type ReviewCard = {
  id: string;
  kind: string;
  toOwner: boolean;
  createdAt: string;
  userId: string;
  name: string;
  shopName: string;
  locationId: string | null;
  punch: string;
  serverAt: string;
  claimedAgeMs: number | null;
  qrShownAt: string | null;
  reasons: string[];
  distanceM: number | null;
  accuracyM: number | null;
  mocked: boolean;
  note: string;
  evidenceId: string | null;
  position: { lat: number; lng: number } | null;
  weakThisMonth: number;
};
export type Reviews = { items: ReviewCard[]; count: number };

export type DeviceRequest = {
  id: string;
  kind: 'FIRST' | 'CHANGE';
  reason: string;
  createdAt: string;
  qrScannedAt: string | null;
  name: string;
  phone: string;
  model: string;
  oldModel: string | null;
  oldLastSeenAt: string | null;
};
export type StaffPhone = {
  id: string;
  name: string;
  phone: string;
  noPhone: boolean;
  phones: { userId: string; status: string; model: string; lastSeenAt: string | null }[];
};

export type NightSummary = {
  day: string;
  nightCode: string | null;
  reviewsOpen: number;
  phonesAsked: number;
  shops: { id: string; name: string; present: number; late: number; noOut: number }[];
  byHand: { name: string; by: string; kind: string; at: string }[];
  accepted: { name: string; by: string; note: string; at: string }[];
  corrections: {
    name: string;
    by: string;
    corrects: string | null;
    to: string | null;
    reason: string;
  }[];
  receipts: { name: string; quantity: number; supplierName: string; by: string }[];
  setupChanges: { event: string; by: string; shopName: string; positionChanged: boolean }[];
  scansOnManagerCode: { name: string; codeOf: string }[];
  collectionDifferences: { driver: string; duePaise: number; amountPaise: number }[];
  cashDifferences: {
    driver: string;
    offeredPaise: number;
    countedPaise: number;
    collectedPaise: number;
  }[];
};

export type ShopScreenRow = {
  id: string;
  locationId: string;
  label: string;
  status: string;
  lastSeenAt: string | null;
  pairingExpiresAt: string | null;
};
export type ShopSetup = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  radiusM: number;
  graceMinutes: number;
  attendanceOn: boolean;
  screens: ShopScreenRow[];
  handCodes?: ShopScreenRow[];
};

/** What the wall shows. The shop screen and "Yahan QR dikhao" read the same thing. */
export type WallData = {
  shopName: string;
  attendanceOn: boolean;
  qr: string;
  msLeft: number;
  serverNow: string;
  people: { name: string; firstInAt: string | null; lastOutAt: string | null }[];
};
