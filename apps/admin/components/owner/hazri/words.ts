import type { Language, MessageKey } from '@shiv/i18n';
import {
  istToday,
  momentLabel,
  offlineAfterMs,
  timeLabel,
  type attendanceProblems,
  type DayStatus,
  type PunchReason,
} from '@shiv/shared';

type Problem = (typeof attendanceProblems)[number];
/** Every code a scan or a card can carry. A new one fails the type check until it has words. */
export type ReasonCode = PunchReason | 'QUERY' | 'BY_HAND' | `PROBLEM_${Problem}`;

const why: Record<ReasonCode, MessageKey> = {
  MOCKED: 'owner.hazri.why.MOCKED',
  LOCATION_OFF: 'owner.hazri.why.LOCATION_OFF',
  APPROXIMATE: 'owner.hazri.why.APPROXIMATE',
  FAR: 'owner.hazri.why.FAR',
  OTHER_SHOP: 'owner.hazri.why.OTHER_SHOP',
  IMPOSSIBLE_TRAVEL: 'owner.hazri.why.IMPOSSIBLE_TRAVEL',
  OFFLINE: 'owner.hazri.why.OFFLINE',
  OLD_QR: 'owner.hazri.why.OLD_QR',
  MANY_WEAK: 'owner.hazri.why.MANY_WEAK',
  WEAK_FIX: 'owner.hazri.why.WEAK_FIX',
  NO_PIN: 'owner.hazri.why.NO_PIN',
  NO_IN: 'owner.hazri.why.NO_IN',
  TIME_MISMATCH: 'owner.hazri.why.TIME_MISMATCH',
  QUERY: 'owner.hazri.why.QUERY',
  BY_HAND: 'owner.hazri.why.BY_HAND',
  PROBLEM_NO_QR: 'owner.hazri.why.PROBLEM_NO_QR',
  PROBLEM_QR_WONT_SCAN: 'owner.hazri.why.PROBLEM_QR_WONT_SCAN',
  PROBLEM_NO_LOCATION: 'owner.hazri.why.PROBLEM_NO_LOCATION',
  PROBLEM_WORKING_OUTSIDE: 'owner.hazri.why.PROBLEM_WORKING_OUTSIDE',
};
export const reasonCodes = Object.keys(why) as ReasonCode[];

export type Line = { key: MessageKey; params?: Record<string, string | number> };
type Facts = {
  serverAt: string;
  claimedAgeMs: number | null;
  qrShownAt?: string | null;
  reasons: readonly string[];
  distanceM: number | null;
};

export const distanceText = (metres: number) =>
  metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1)} km`;

/** Scanned without internet: its age on the phone made it past the point a slow network explains. */
export const wasOffline = (claimedAgeMs: number | null) => (claimedAgeMs ?? 0) > offlineAfterMs;
export const takenAt = (serverAt: string, claimedAgeMs: number | null) =>
  new Date(new Date(serverAt).getTime() - (claimedAgeMs ?? 0)).toISOString();

/** The time alone when it is the same day as the other one, and the date too when it is not. */
export function stamp(value: string, beside: string, language: Language) {
  return istToday(new Date(value)) === istToday(new Date(beside))
    ? timeLabel(value)
    : momentLabel(value, language);
}

/**
 * What the checks saw, as sentences. Facts only: a person reads these and decides, and nothing here
 * calls anyone anything. A code with no words says "have a look" rather than ever showing the code.
 */
export function reasonLines(facts: Facts, language: Language): Line[] {
  const lines: Line[] = [];
  const known = new Set<string>(reasonCodes);
  for (const reason of facts.reasons) {
    if (reason === 'FAR') {
      if (facts.distanceM === null) lines.push({ key: why.FAR });
      else
        lines.push({
          key: facts.reasons.includes('OLD_QR')
            ? 'owner.hazri.why.farOldQr'
            : 'owner.hazri.why.farFresh',
          params: { distance: distanceText(facts.distanceM) },
        });
    } else if (reason === 'OFFLINE' && wasOffline(facts.claimedAgeMs)) {
      const taken = takenAt(facts.serverAt, facts.claimedAgeMs);
      lines.push({
        key: 'owner.hazri.why.offlineTimes',
        params: {
          taken: stamp(taken, facts.serverAt, language),
          server: stamp(facts.serverAt, taken, language),
        },
      });
    } else if (known.has(reason)) lines.push({ key: why[reason as ReasonCode] });
    else lines.push({ key: 'owner.hazri.why.other' });
  }
  const qrAt = facts.qrShownAt;
  if (qrAt && (facts.reasons.includes('TIME_MISMATCH') || facts.reasons.includes('OLD_QR')))
    lines.push({
      key: 'owner.hazri.why.qrAt',
      params: { time: stamp(qrAt, facts.serverAt, language) },
    });
  return [...new Map(lines.map((line) => [line.key, line])).values()];
}

const flags: Record<string, MessageKey> = {
  REVIEW_OPEN: 'owner.hazri.flag.REVIEW_OPEN',
  NOTE: 'owner.hazri.flag.NOTE',
  MANUAL: 'owner.hazri.flag.MANUAL',
  CORRECTED: 'owner.hazri.flag.CORRECTED',
  NO_OUT: 'owner.hazri.flag.NO_OUT',
  WORKED_WEEKLY_OFF: 'owner.hazri.flag.WORKED_WEEKLY_OFF',
};
export const flagCodes = Object.keys(flags);
/** Today "no way out yet" only means they are still at work. By tomorrow it is worth a word. */
export function flagKey(flag: string, isToday: boolean): MessageKey | null {
  if (flag === 'NO_OUT' && isToday) return 'owner.hazri.flag.stillHere';
  return Object.hasOwn(flags, flag) ? flags[flag]! : null;
}

export const statusKey: Record<DayStatus, MessageKey> = {
  PRESENT: 'owner.hazri.status.PRESENT',
  REVIEW: 'owner.hazri.status.REVIEW',
  ABSENT: 'owner.hazri.status.ABSENT',
  WEEKLY_OFF: 'owner.hazri.status.WEEKLY_OFF',
};

export const eventKey: Record<string, MessageKey> = {
  IN: 'owner.hazri.event.IN',
  OUT: 'owner.hazri.event.OUT',
  MANUAL_IN: 'owner.hazri.event.MANUAL_IN',
  MANUAL_OUT: 'owner.hazri.event.MANUAL_OUT',
  CORRECTION: 'owner.hazri.event.CORRECTION',
  DECISION: 'owner.hazri.event.DECISION',
  SIGNAL: 'owner.hazri.event.SIGNAL',
};

export const hoursOf = (minutes: number) => ({
  hours: Math.floor(minutes / 60),
  minutes: minutes % 60,
});

/** "09:30" to minutes after midnight. Anything else is not a time. */
export function minuteOf(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
/** Minutes after midnight, for a time box. The box stops at 23:59, and a shift may end at midnight. */
export const timeOf = (minute: number) => {
  const held = Math.min(Math.max(minute, 0), 1439);
  return `${String(Math.floor(held / 60)).padStart(2, '0')}:${String(held % 60).padStart(2, '0')}`;
};
export const istMinute = (value: string | Date) => {
  const ist = new Date(new Date(value).getTime() + 5.5 * 3600000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
};

/**
 * Why a correction cannot be sent: it may not be in the future, and going home may not come before
 * arriving. The record would keep the nonsense for good, because nothing on it is ever erased.
 */
export function correctionProblem(input: {
  corrects: 'IN' | 'OUT';
  minute: number | null;
  day: string;
  now: Date;
  firstInAt: string | null;
  lastOutAt: string | null;
}): MessageKey | null {
  const { corrects, minute, day, now, firstInAt, lastOutAt } = input;
  if (minute === null) return 'owner.hazri.fix.needTime';
  if (day > istToday(now)) return 'owner.hazri.fix.future';
  if (day === istToday(now) && minute > istMinute(now)) return 'owner.hazri.fix.future';
  if (corrects === 'OUT' && firstInAt && minute < istMinute(firstInAt))
    return 'owner.hazri.fix.outBeforeIn';
  if (corrects === 'IN' && lastOutAt && minute > istMinute(lastOutAt))
    return 'owner.hazri.fix.inAfterOut';
  return null;
}

/** When the record says someone came and went, with any correction of those times counted in. */
export function dayBounds(
  events: readonly {
    kind: string;
    serverAt: string;
    result: string | null;
    correctsKind: string | null;
    correctedAt: string | null;
    review: { status: string } | null;
  }[],
) {
  const counted = events.filter(
    (event) => event.result !== 'RETRY' && event.review?.status !== 'REJECTED',
  );
  const corrected = (kind: 'IN' | 'OUT') =>
    counted.filter((event) => event.kind === 'CORRECTION' && event.correctsKind === kind).at(-1)
      ?.correctedAt ?? null;
  return {
    firstInAt:
      corrected('IN') ??
      counted.find((event) => event.kind === 'IN' || event.kind === 'MANUAL_IN')?.serverAt ??
      null,
    lastOutAt:
      corrected('OUT') ??
      counted.filter((event) => event.kind === 'OUT' || event.kind === 'MANUAL_OUT').at(-1)
        ?.serverAt ??
      null,
  };
}
