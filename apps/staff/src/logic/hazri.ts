import type { QueueEntry } from './queue';
import { istDay } from './time';

export type Today = {
  serverNow: string;
  day: string;
  user: { id: string; name: string };
  noticeVersion: number;
  noticeAccepted: boolean;
  roles: string[];
  shops: { id: string; name: string }[];
  access: string[];
  schedule: { startMinute: number; endMinute: number; weeklyOffs: number[] } | null;
  next: 'IN' | 'OUT';
  arrivedAt: string | null;
  shopName: string | null;
  status: 'ABSENT' | 'PRESENT' | 'REVIEW' | 'WEEKLY_OFF';
  firstInAt: string | null;
  lastOutAt: string | null;
  minutes: number | null;
  lateMinutes: number;
  flags: string[];
  openReviews: number;
};

export type HazriStatus = 'none' | 'in' | 'done' | 'review' | 'waiting';
export type HazriView = {
  next: 'IN' | 'OUT';
  status: HazriStatus;
  firstInAt: string | null;
  lastOutAt: string | null;
  minutes: number | null;
  lateMinutes: number;
  /** Saved on this phone, not yet at the server. */
  waiting: number;
  /** The day the screen shows is an old one, because there has been no signal since. */
  stale: boolean;
  shopName: string | null;
};

const pendingKinds = (entry: QueueEntry) => entry.kind === 'punch' || entry.kind === 'problem';

/**
 * Where this person stands, from the last answer plus anything still on the phone. A scan waiting
 * to be sent still moves them on: someone who scanned in offline must be able to scan out offline.
 */
export function hazriView(
  today: Today | null,
  nowMs: number | null,
  queue: readonly QueueEntry[],
): HazriView {
  const waitingScans = queue.filter(pendingKinds);
  const nowDay = nowMs === null ? null : istDay(nowMs);
  // Yesterday's answer says nothing about today, so a new day starts clean.
  const staleDay = Boolean(today && nowDay && today.day !== nowDay);
  const base = today && !staleDay ? today : null;
  let next: 'IN' | 'OUT' = base?.next ?? 'IN';
  for (const entry of waitingScans)
    if (entry.kind === 'punch') {
      const kind = entry.body.kind === 'OUT' ? 'OUT' : 'IN';
      next = kind === 'IN' ? 'OUT' : 'IN';
    }
  const firstInAt = base?.firstInAt ?? null;
  const lastOutAt = base?.lastOutAt ?? null;
  let status: HazriStatus = 'none';
  if (waitingScans.length) status = 'waiting';
  // Only today's day counts: an open question about last week is not today's hazri.
  else if (base?.status === 'REVIEW') status = 'review';
  else if (next === 'OUT') status = 'in';
  else if (lastOutAt) status = 'done';
  return {
    next,
    status,
    firstInAt,
    lastOutAt,
    minutes: base?.minutes ?? null,
    lateMinutes: base?.lateMinutes ?? 0,
    waiting: waitingScans.length,
    stale: staleDay,
    shopName: base?.shopName ?? null,
  };
}
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
