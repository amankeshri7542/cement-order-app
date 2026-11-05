import type { MessageKey } from '@shiv/i18n';
import type { Tr } from './words';
import { timeText } from './time';

export type MonthDay = {
  day: string;
  status: 'ABSENT' | 'PRESENT' | 'REVIEW' | 'WEEKLY_OFF';
  firstInAt: string | null;
  lastOutAt: string | null;
  minutes: number | null;
  lateMinutes: number;
  flags: string[];
};
export type DayMark = 'present' | 'late' | 'absent' | 'review' | 'off' | 'none';
/** Every mark has its own shape as well as its colour, so nobody needs to tell colours apart. */
export function markFor(row: MonthDay | undefined, day: string, today: string, offs: number[]) {
  if (day > today) return 'none' as DayMark;
  if (!row) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (offs.includes(weekday)) return 'off' as DayMark;
    return (day === today ? 'none' : 'absent') as DayMark;
  }
  if (row.status === 'WEEKLY_OFF') return 'off' as DayMark;
  if (row.status === 'REVIEW') return 'review' as DayMark;
  if (row.status === 'PRESENT') return (row.lateMinutes > 0 ? 'late' : 'present') as DayMark;
  return (day === today ? 'none' : 'absent') as DayMark;
}

export type Cell = { day: string; date: number; mark: DayMark; corrected: boolean } | null;
/** Weeks start on Sunday, with blanks before the 1st. */
export function monthGrid(month: string, rows: MonthDay[], today: string, offs: number[]): Cell[] {
  const [year, index] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(year, index - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const cells: Cell[] = Array.from({ length: first }, () => null);
  for (let date = 1; date <= length; date++) {
    const day = `${month}-${String(date).padStart(2, '0')}`;
    const row = rows.find((entry) => entry.day === day);
    cells.push({
      day,
      date,
      mark: markFor(row, day, today, offs),
      corrected: row?.flags.includes('CORRECTED') ?? false,
    });
  }
  return cells;
}
export const emptyMonth = (rows: MonthDay[]) => rows.length === 0;
export function shiftMonth(month: string, by: number) {
  const [year, index] = month.split('-').map(Number) as [number, number];
  const at = new Date(Date.UTC(year, index - 1 + by, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

export type DayEventRow = {
  id: string;
  kind: string;
  serverAt: string;
  claimedAgeMs: number | null;
  result: string | null;
  reasons: string[];
  reason: string;
  correctsKind: string | null;
  correctedAt: string | null;
  shopName: string;
  actorName: string;
  byHand: boolean;
  review: { status: string; note: string } | null;
};
export type DayLine = {
  id: string;
  title: string;
  detail: string[];
  tone: 'ok' | 'amber' | 'plain';
};

const offlineMs = 120_000;
const statusWord: Record<string, MessageKey> = {
  OPEN: 'staff.record.reviewOpen',
  ACCEPTED: 'staff.record.reviewAccepted',
  REJECTED: 'staff.record.reviewRejected',
};
/** One day in plain words: each scan, and every change with who made it. */
export function dayLines(events: DayEventRow[], tr: Tr): DayLine[] {
  const lines: DayLine[] = [];
  for (const event of events) {
    const at = timeText(event.serverAt);
    // A stale code the person simply scanned again counts for nothing.
    if (event.result === 'RETRY') continue;
    const detail: string[] = [];
    if (event.shopName) detail.push(event.shopName);
    if ((event.claimedAgeMs ?? 0) > offlineMs)
      detail.push(
        tr('staff.record.taken', {
          time: timeText(Date.parse(event.serverAt) - event.claimedAgeMs!),
        }),
      );
    switch (event.kind) {
      case 'IN':
      case 'OUT': {
        const key = event.kind === 'IN' ? 'staff.record.came' : 'staff.record.left';
        if (event.review) {
          const word = statusWord[event.review.status];
          if (word) detail.push(tr(word));
          if (event.review.note) detail.push(event.review.note);
        }
        lines.push({
          id: event.id,
          title: tr(key, { time: at }),
          detail,
          tone:
            event.review?.status === 'OPEN' || event.review?.status === 'REJECTED' ? 'amber' : 'ok',
        });
        break;
      }
      case 'MANUAL_IN':
      case 'MANUAL_OUT':
        lines.push({
          id: event.id,
          title: tr(event.kind === 'MANUAL_IN' ? 'staff.record.came' : 'staff.record.left', {
            time: at,
          }),
          detail: [tr('staff.record.byHand', { name: event.actorName }), ...detail],
          tone: 'ok',
        });
        break;
      case 'CORRECTION':
        lines.push({
          id: event.id,
          title: tr('staff.record.corrected', { name: event.actorName }),
          detail: [
            event.correctedAt
              ? tr(event.correctsKind === 'OUT' ? 'staff.record.left' : 'staff.record.came', {
                  time: timeText(event.correctedAt),
                })
              : '',
            event.reason ? tr('staff.record.because', { reason: event.reason }) : '',
          ].filter(Boolean),
          tone: 'plain',
        });
        break;
      case 'DECISION': {
        const accepted = event.reasons.includes('ACCEPTED');
        lines.push({
          id: event.id,
          title: tr(accepted ? 'staff.record.decidedYes' : 'staff.record.decidedNo', {
            name: event.actorName,
            time: at,
          }),
          detail: event.reason ? [tr('staff.record.because', { reason: event.reason })] : [],
          tone: 'plain',
        });
        break;
      }
      case 'SIGNAL':
        lines.push({
          id: event.id,
          title: tr('staff.record.youAsked', { time: at }),
          detail: event.reason ? [event.reason] : [],
          tone: 'plain',
        });
        break;
      default:
        break;
    }
  }
  return lines;
}
