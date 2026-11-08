import { summarizeDay, type DayEvent } from '@shiv/shared';
import { eventHash } from '../../../src/staff/chain';
import type { Bulk } from '../bulk';
import { dayRange, istInstant, weekday } from '../calendar';
import type { SeedContext } from '../context';
import type { Rng } from '../rng';
import type { SeedStaff } from './people';

export type MonthFacts = {
  daysPresent: number;
  daysLate: number;
  weeklyOffsWorked: number;
  missingOut: number;
};

const GRACE_MINUTES = 10;

/**
 * Hazri for everyone but the owners: scans in and out at their shop, some lateness, a few absent
 * days, the odd missing out-scan and a few marks by hand. Each person's events form the same hash
 * chain the API writes, and each day row comes from the API's own `summarizeDay`.
 * Returns the month facts the salary slips print.
 */
export async function seedAttendance(
  ctx: SeedContext,
  bulk: Bulk,
  rng: Rng,
  staff: readonly SeedStaff[],
  now: Date,
) {
  const facts = new Map<string, MonthFacts>();
  const days = dayRange(ctx.firstDay, ctx.today);
  const manager = (shop: string | null) =>
    staff.find((s) => s.role === 'MANAGER' && s.locationId === shop)?.id ?? ctx.actors.owner;
  for (const person of staff) {
    if (person.role === 'OWNER' || !person.locationId) continue;
    let seq = 0;
    let prevHash = '';
    const schedule = {
      startMinute: person.startMinute,
      endMinute: person.endMinute,
      breakMinutes: 60,
      weeklyOffs: [person.weeklyOff],
    };
    for (const day of days) {
      const off = weekday(day) === person.weeklyOff;
      const absent = !off && rng.chance(0.03);
      const worksOff = off && rng.chance(0.05);
      const events: DayEvent[] = [];
      if ((!off && !absent) || worksOff) {
        const late = rng.chance(person.lateness);
        const inMinute = person.startMinute + (late ? rng.int(12, 55) : rng.int(-15, 8));
        const outMinute = person.endMinute + rng.int(-10, 35);
        const byHand = rng.chance(0.02);
        const noOut = rng.chance(0.015);
        const marks: [kind: 'IN' | 'OUT' | 'MANUAL_IN' | 'MANUAL_OUT', minute: number][] = [
          [byHand ? 'MANUAL_IN' : 'IN', inMinute],
        ];
        if (!noOut) marks.push([byHand ? 'MANUAL_OUT' : 'OUT', outMinute]);
        for (const [kind, minute] of marks) {
          const at = istInstant(day, Math.floor(minute / 60), minute % 60);
          if (at > now) continue;
          seq++;
          const manual = kind.startsWith('MANUAL');
          const row = {
            userId: person.id,
            kind,
            actorId: manual ? manager(person.locationId) : person.id,
            locationId: person.locationId,
            captureId: `demo-cap-${person.id}-${seq}`,
            appVersion: manual ? null : '1.4.0',
            deviceId: manual ? null : `demo-device-${person.id}`,
            reasons: manual ? ['BY_HAND'] : [],
            result: 'GREEN' as const,
            reason: manual ? 'Phone was not working' : '',
            serverAt: at,
          };
          const hash = eventHash(prevHash, seq, row);
          const id = `demo-att-${person.id}-${seq}`;
          await bulk.add('AttendanceEvent', {
            id,
            ...row,
            stream: `att:${person.id}`,
            seq,
            prevHash,
            hash,
          });
          prevHash = hash;
          events.push({
            id,
            kind,
            serverAt: at,
            locationId: person.locationId,
            result: 'GREEN',
            review: null,
          });
        }
      }
      if (day === ctx.today && !events.length) continue;
      const summary = summarizeDay(day, events, schedule, GRACE_MINUTES);
      await bulk.add('AttendanceDay', {
        userId: person.id,
        day,
        ...summary,
        updatedAt: summary.lastOutAt ?? summary.firstInAt ?? istInstant(day, 20, 0),
      });
      const key = `${person.id}|${day.slice(0, 7)}`;
      const f = facts.get(key) ?? {
        daysPresent: 0,
        daysLate: 0,
        weeklyOffsWorked: 0,
        missingOut: 0,
      };
      if (summary.firstInAt) f.daysPresent++;
      if (summary.lateMinutes > 0) f.daysLate++;
      if (summary.flags.includes('WORKED_WEEKLY_OFF')) f.weeklyOffsWorked++;
      if (summary.flags.includes('NO_OUT')) f.missingOut++;
      facts.set(key, f);
    }
  }
  return facts;
}
