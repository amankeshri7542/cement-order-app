import { z } from 'zod';

/**
 * The attendance rules, in one place and with no outside dependencies. The QR proves presence and
 * location only cross-checks it, so an honest person under a tin roof is never turned away. A scan
 * is written down whatever happens; the worst a scan can do is ask a person to look.
 */

/** A new code every 20 seconds. Long enough for a slow connection, too short to send to a friend. */
export const qrStepSeconds = 20;
export const qrStepsBack = 2;
export const qrStepsAhead = 1;
/** Words the person read and accepted when linking their phone. Raise this if the notice changes. */
export const staffNoticeVersion = 1;
export const radiusLimits = { min: 50, max: 300, standard: 100 } as const;
/** Beyond this the phone is guessing, so it is treated as having no position at all. */
export const weakFixAccuracyM = 500;
const plausibleMarginM = 50;
/** A scan carried this long before reaching the server was taken offline. */
export const offlineAfterMs = 120_000;
/** A weak fix now and then is fine. This many in a week and someone should look. */
export const weakFixesBeforeReview = 3;
export const weakFixWindowDays = 7;
/** Faster than any truck in Patna: two scans implying this speed are looked at. */
const impossibleKmPerHour = 120;
export const reviewEscalatesAfterMs = 48 * 3600000;
export const geoRetentionDays = 400;

export const qrCounter = (epochMs: number) => Math.floor(epochMs / 1000 / qrStepSeconds);
/** When a code was on the wall. Unlike a phone's word, this cannot be made up. */
export const qrShownAt = (counter: number) => counter * qrStepSeconds * 1000;
export const qrFresh = (counter: number, epochMs: number) => {
  const now = qrCounter(epochMs);
  return counter >= now - qrStepsBack && counter <= now + qrStepsAhead;
};
/** How much of this code's life is left, for the bar on the shop screen. */
export const qrMsLeft = (epochMs: number) =>
  qrStepSeconds * 1000 - (epochMs % (qrStepSeconds * 1000));

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

export type Place = 'INSIDE' | 'PLAUSIBLE' | 'FAR' | 'NO_FIX';
/** GPS gives a guess with a margin, so the margin counts in the person's favour. */
export function placeOf(
  distanceM: number | null,
  accuracyM: number | null,
  radiusM: number,
): Place {
  if (distanceM === null || accuracyM === null || accuracyM > weakFixAccuracyM) return 'NO_FIX';
  if (distanceM <= radiusM) return 'INSIDE';
  if (distanceM - accuracyM <= radiusM + plausibleMarginM) return 'PLAUSIBLE';
  return 'FAR';
}

export const locationStates = ['OK', 'NO_FIX', 'DENIED', 'GPS_OFF', 'APPROXIMATE'] as const;
export type LocationState = (typeof locationStates)[number];

export type PunchResult = 'GREEN' | 'GREEN_NOTE' | 'RETRY' | 'REVIEW';
export type PunchReason =
  | 'MOCKED'
  | 'LOCATION_OFF'
  | 'APPROXIMATE'
  | 'FAR'
  | 'OTHER_SHOP'
  | 'IMPOSSIBLE_TRAVEL'
  | 'OFFLINE'
  | 'OLD_QR'
  | 'MANY_WEAK'
  | 'WEAK_FIX'
  | 'NO_PIN'
  | 'NO_IN'
  | 'TIME_MISMATCH';

export function punchVerdict(input: {
  qrFresh: boolean;
  place: Place;
  location: LocationState;
  mocked: boolean;
  assignedHere: boolean;
  offline: boolean;
  impossibleTravel: boolean;
  weakFixesThisWeek: number;
  /** The shop's position has not been taken yet, so there is nothing to compare with. */
  noPin: boolean;
}): { result: PunchResult; reasons: PunchReason[] } {
  const review: PunchReason[] = [];
  const near = input.place === 'INSIDE' || input.place === 'PLAUSIBLE';
  if (input.mocked) review.push('MOCKED');
  if (input.location === 'DENIED' || input.location === 'GPS_OFF') review.push('LOCATION_OFF');
  if (input.location === 'APPROXIMATE') review.push('APPROXIMATE');
  if (input.place === 'FAR') review.push('FAR');
  if (!input.assignedHere) review.push('OTHER_SHOP');
  if (input.impossibleTravel) review.push('IMPOSSIBLE_TRAVEL');
  if (input.offline) review.push('OFFLINE');
  if (!input.qrFresh && !near && !input.noPin) review.push('OLD_QR');
  const weak = !input.noPin && input.place === 'NO_FIX' && input.location === 'NO_FIX';
  if (weak && input.weakFixesThisWeek >= weakFixesBeforeReview) review.push('MANY_WEAK');
  if (review.length) return { result: 'REVIEW', reasons: review };
  // Usually a slow connection. Nobody is bothered; they just scan again.
  if (!input.qrFresh) return { result: 'RETRY', reasons: ['OLD_QR'] };
  if (input.noPin) return { result: 'GREEN_NOTE', reasons: ['NO_PIN'] };
  if (weak) return { result: 'GREEN_NOTE', reasons: ['WEAK_FIX'] };
  return { result: 'GREEN', reasons: [] };
}

/** Two scans at different shops closer together than the road allows. */
export function impossibleTravel(
  last: { at: number; lat: number; lng: number } | null,
  next: { at: number; lat: number; lng: number } | null,
) {
  if (!last || !next) return false;
  const hours = Math.max(next.at - last.at, 1) / 3600000;
  const km = distanceMeters(last, next) / 1000;
  return km > 1 && km / hours > impossibleKmPerHour;
}

export type DayEvent = {
  id: string;
  kind: 'IN' | 'OUT' | 'MANUAL_IN' | 'MANUAL_OUT' | 'CORRECTION' | 'DECISION' | 'SIGNAL';
  serverAt: Date;
  locationId: string | null;
  result: PunchResult | null;
  /** How its review ended, where it had one. Open still counts: the time was written down. */
  review: 'OPEN' | 'ACCEPTED' | 'REJECTED' | null;
  correctsKind?: string | null;
  correctedAt?: Date | null;
};
export type DaySchedule = {
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  weeklyOffs: number[];
};
export type DayStatus = 'ABSENT' | 'PRESENT' | 'REVIEW' | 'WEEKLY_OFF';
export type DaySummary = {
  firstInAt: Date | null;
  lastOutAt: Date | null;
  minutes: number | null;
  lateMinutes: number;
  status: DayStatus;
  flags: string[];
  locationIds: string[];
};

const istMinutes = (at: Date) => {
  const ist = new Date(at.getTime() + 5.5 * 3600000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
};
const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** Late, overtime and the rest are worked out from events and move no money by themselves. */
export function summarizeDay(
  day: string,
  events: readonly DayEvent[],
  schedule: DaySchedule | null,
  graceMinutes: number,
): DaySummary {
  const flags = new Set<string>();
  const counted = [...events]
    .sort((a, b) => a.serverAt.getTime() - b.serverAt.getTime())
    .filter((event) => event.result !== 'RETRY' && event.review !== 'REJECTED');
  const pairs: { in: Date; out: Date | null }[] = [];
  const locationIds = new Set<string>();
  for (const event of counted) {
    if (event.review === 'OPEN') flags.add('REVIEW_OPEN');
    if (event.result === 'GREEN_NOTE') flags.add('NOTE');
    if (event.kind === 'IN' || event.kind === 'MANUAL_IN') {
      if (event.locationId) locationIds.add(event.locationId);
      if (event.kind === 'MANUAL_IN') flags.add('MANUAL');
      const open = pairs.at(-1);
      if (!open || open.out) pairs.push({ in: event.serverAt, out: null });
    }
    if (event.kind === 'OUT' || event.kind === 'MANUAL_OUT') {
      if (event.kind === 'MANUAL_OUT') flags.add('MANUAL');
      const open = pairs.at(-1);
      if (open && !open.out) open.out = event.serverAt;
    }
  }
  // A correction replaces the time it names, and both stay on the record.
  for (const event of counted) {
    if (event.kind !== 'CORRECTION' || !event.correctedAt) continue;
    flags.add('CORRECTED');
    if (event.correctsKind === 'IN') {
      if (pairs[0]) pairs[0].in = event.correctedAt;
      else pairs.push({ in: event.correctedAt, out: null });
    }
    if (event.correctsKind === 'OUT') {
      const last = pairs.at(-1);
      if (last) last.out = event.correctedAt;
      else pairs.push({ in: event.correctedAt, out: event.correctedAt });
    }
  }
  const off = schedule?.weeklyOffs.includes(weekdayOf(day)) ?? false;
  if (off && pairs.length) flags.add('WORKED_WEEKLY_OFF');
  if (!pairs.length)
    return {
      firstInAt: null,
      lastOutAt: null,
      minutes: null,
      lateMinutes: 0,
      status: off ? 'WEEKLY_OFF' : flags.has('REVIEW_OPEN') ? 'REVIEW' : 'ABSENT',
      flags: [...flags],
      locationIds: [...locationIds],
    };
  const missingOut = pairs.some((pair) => !pair.out);
  if (missingOut) flags.add('NO_OUT');
  const firstInAt = pairs[0]!.in;
  const late =
    schedule && !off
      ? istMinutes(firstInAt) - (schedule.startMinute + Math.max(graceMinutes, 0))
      : 0;
  return {
    firstInAt,
    lastOutAt: missingOut ? null : (pairs.at(-1)!.out ?? null),
    minutes: missingOut
      ? null
      : pairs.reduce(
          (sum, pair) => sum + Math.round((pair.out!.getTime() - pair.in.getTime()) / 60000),
          0,
        ),
    // Late counts from the shift's start, and the grace only decides whether it counts at all.
    lateMinutes: late > 0 ? late + Math.max(graceMinutes, 0) : 0,
    status: flags.has('REVIEW_OPEN') ? 'REVIEW' : 'PRESENT',
    flags: [...flags],
    locationIds: [...locationIds],
  };
}

/** The exact words a phone signs for a scan, so nobody can change a figure on the way. */
export function punchMessage(punch: {
  captureId: string;
  qr: string;
  kind: string;
  lat?: number | null | undefined;
  lng?: number | null | undefined;
  accuracyM?: number | null | undefined;
  mocked?: boolean | undefined;
  location: string;
  claimedAgeMs?: number | undefined;
  bootCount?: number | undefined;
}) {
  return [
    'punch',
    punch.captureId,
    punch.qr,
    punch.kind,
    punch.lat ?? '',
    punch.lng ?? '',
    punch.accuracyM ?? '',
    punch.mocked ? 1 : 0,
    punch.location,
    punch.claimedAgeMs ?? 0,
    punch.bootCount ?? 0,
  ].join('|');
}

const uuid = z.string().uuid();
const id = z.string().min(1).max(60);
const words = (max: number) => z.string().trim().max(max);
const signature = z.string().min(16).max(400);
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const position = {
  lat: latitude.optional(),
  lng: longitude.optional(),
  accuracyM: z.number().min(0).max(100000).optional(),
};
const qrText = z
  .string()
  .max(80)
  .regex(/^[A-Z0-9.]+$/, 'This is not a shop code.');

export const staffVerifySchema = z.strictObject({
  phone: z.string().min(10).max(16),
  code: z.string().regex(/^\d{4,8}$/),
  publicKey: z.string().min(64).max(400),
  /** Signs `link-verify|<phone>|<code>`, proving this phone really holds the key it names. */
  signature,
  model: words(80).default(''),
  sdk: z.number().int().min(0).max(100).default(0),
  reason: words(200).optional(),
});
export const staffRenewSchema = z.strictObject({
  refreshToken: z.string().min(20).max(200),
  nonce: z.string().min(8).max(120),
  signature,
});
export const staffQrProofSchema = z.strictObject({ qr: qrText, signature });
export const staffNoticeSchema = z.strictObject({ version: z.number().int().min(1) });
export const attendancePunchSchema = z.strictObject({
  captureId: uuid,
  qr: qrText,
  kind: z.enum(['IN', 'OUT']),
  ...position,
  mocked: z.boolean().default(false),
  location: z.enum(locationStates),
  claimedAgeMs: z
    .number()
    .int()
    .min(0)
    .max(14 * 86400000)
    .optional(),
  bootCount: z.number().int().min(0).max(1_000_000).optional(),
  appVersion: words(40).optional(),
  signature,
});
export const attendanceProblems = [
  'NO_QR',
  'QR_WONT_SCAN',
  'NO_LOCATION',
  'WORKING_OUTSIDE',
] as const;
export const attendanceProblemSchema = z.strictObject({
  captureId: uuid,
  problem: z.enum(attendanceProblems),
  kind: z.enum(['IN', 'OUT']),
  locationId: id.optional(),
  ...position,
  note: words(200).optional(),
  evidenceId: id.optional(),
  claimedAgeMs: z
    .number()
    .int()
    .min(0)
    .max(14 * 86400000)
    .optional(),
});
export const attendanceQuerySchema = z.strictObject({
  day: z.iso.date(),
  note: words(300).min(2),
});
export const reviewDecideSchema = z.strictObject({
  decision: z.enum(['ACCEPT', 'REJECT', 'TO_OWNER']),
  note: words(200).optional(),
});
export const reviewBulkSchema = z.strictObject({
  ids: z.array(id).min(1).max(100),
  note: words(200).min(2),
});
export const attendanceManualSchema = z.strictObject({
  userId: id,
  kind: z.enum(['MANUAL_IN', 'MANUAL_OUT']),
  locationId: id,
  note: words(200).optional(),
  idempotencyKey: uuid,
});
export const attendanceCorrectionSchema = z.strictObject({
  userId: id,
  day: z.iso.date(),
  corrects: z.enum(['IN', 'OUT']),
  /** Minutes after midnight, India time, on that day. */
  minute: z.number().int().min(0).max(1439),
  reason: words(200).min(2),
  idempotencyKey: uuid,
});
export const deviceDecideSchema = z.strictObject({
  decision: z.enum(['APPROVE', 'REFUSE']),
  note: words(200).optional(),
});
export const shopSetupSchema = z.strictObject({
  lat: latitude.nullable().optional(),
  lng: longitude.nullable().optional(),
  radiusM: z.number().int().min(radiusLimits.min).max(radiusLimits.max).optional(),
  graceMinutes: z.number().int().min(0).max(120).optional(),
  attendanceOn: z.boolean().optional(),
});
export const screenPairSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
export const screenCreateSchema = z.strictObject({
  locationId: id,
  label: words(40).optional(),
});
export const staffScheduleSchema = z
  .strictObject({
    effectiveFrom: z.iso.date(),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    breakMinutes: z.number().int().min(0).max(300).default(60),
    weeklyOffs: z.array(z.number().int().min(0).max(6)).max(7).default([0]),
  })
  .refine((row) => row.endMinute > row.startMinute, 'The shift must end after it starts.');
export const staffNoPhoneSchema = z.strictObject({ noPhone: z.boolean() });

// Stock jobs and trips
export const orderLoadSchema = z.strictObject({
  vehicle: words(30).optional(),
  billNumber: words(40).optional(),
  note: words(200).optional(),
  idempotencyKey: uuid,
});
export const stockReceiptSchema = z.strictObject({
  locationId: id,
  productId: id,
  quantity: z.number().int().min(1).max(100000),
  supplierName: words(80).min(1),
  vehicle: words(30).optional(),
  evidenceId: id.optional(),
  idempotencyKey: uuid,
});
export const tripCreateSchema = z.strictObject({
  locationId: id,
  driverId: id,
  helperId: id.optional(),
  vehicle: words(30).optional(),
  orderIds: z
    .array(id)
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, 'Each order only once.'),
  idempotencyKey: uuid,
});
export const tripStartSchema = z.strictObject({
  idempotencyKey: uuid,
  ...position,
  claimedAgeMs: z
    .number()
    .int()
    .min(0)
    .max(14 * 86400000)
    .optional(),
});
const collected = z.strictObject({
  amountPaise: z.number().int().min(0).max(1_000_000_000),
  channel: z.enum(['CASH', 'UPI']),
});
export const stopDeliveredSchema = z.strictObject({
  idempotencyKey: uuid,
  ...position,
  claimedAgeMs: z
    .number()
    .int()
    .min(0)
    .max(14 * 86400000)
    .optional(),
  evidenceId: id.optional(),
  skipReason: words(120).optional(),
  collected: collected.optional(),
});
export const stopProblems = ['NO_ACCESS', 'CUSTOMER_ABSENT', 'SHORT_TAKEN', 'OTHER'] as const;
export const stopProblemSchema = z.strictObject({
  idempotencyKey: uuid,
  problem: z.enum(stopProblems),
  note: words(200).optional(),
  ...position,
  claimedAgeMs: z
    .number()
    .int()
    .min(0)
    .max(14 * 86400000)
    .optional(),
});
export const cashHandoverSchema = z.strictObject({
  amountPaise: z.number().int().min(1).max(1_000_000_000),
  handoverKey: uuid,
});
export const cashCountSchema = z.strictObject({
  countedPaise: z.number().int().min(0).max(1_000_000_000),
  note: words(200).optional(),
});
export const cashSettleSchema = z.strictObject({ note: words(200).min(2) });
