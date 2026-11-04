import { money } from '@shiv/shared';
import { isMessageKey, type Language, type MessageKey, type Params } from '@shiv/i18n';

/** The arithmetic and words behind the Report page and the activity log. No React in here. */
export type Say = (key: MessageKey, params?: Params) => string;
export type Scale = { top: number; step: number; lines: number[] };
export type RangeName = '7' | '30' | 'month';
export type LogEntry = {
  actorId: string;
  event: string;
  details: { amountPaise?: unknown } | null;
  actorName: string;
  entityLabel: string;
  customerName: string;
};

/** A range of India days ending today: this many days, or from the 1st of this month. */
export function datesOf(name: RangeName, today: string) {
  if (name === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  const start = Date.parse(`${today}T00:00:00Z`) - (Number(name) - 1) * 86400000;
  return { from: new Date(start).toISOString().slice(0, 10), to: today };
}
/** Axis ticks as a shopkeeper says them: ₹2L, ₹50K, ₹1Cr. */
export function shortMoney(paise: number) {
  const rupees = paise / 100;
  if (!rupees) return '0';
  if (rupees >= 10000000) return `₹${rupees / 10000000}Cr`;
  if (rupees >= 100000) return `₹${rupees / 100000}L`;
  return `₹${rupees / 1000}K`;
}
/** Lines at each ₹1L, moving to a wider step only when that would make more than five lines. */
export function moneyScale(maxPaise: number): Scale {
  const rupees = Math.max(0, maxPaise) / 100;
  const ladder =
    rupees >= 100000
      ? [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].map((lakh) => lakh * 100000)
      : [1000, 2000, 5000, 10000, 20000, 50000];
  const rung = ladder.find((step) => rupees / step <= 5) ?? ladder.at(-1)!;
  const count = Math.max(1, Math.ceil(rupees / rung));
  return {
    top: count * rung * 100,
    step: rung * 100,
    lines: Array.from({ length: count + 1 }, (_, index) => index * rung * 100),
  };
}
/** The top of the time-to-confirm chart. Each rung halves to a round number for the middle line. */
export function minuteTop(longest: number) {
  return [10, 20, 30, 60, 120, 240, 480, 960, 1920].find((top) => top >= longest) ?? longest;
}
export function waitText(minutes: number, t: Say) {
  if (minutes < 1) return t('owner.reports.underMinute');
  const whole = Math.round(minutes);
  if (whole < 60) return t('owner.reports.minutes', { minutes: whole });
  return t('owner.reports.hours', { hours: Math.floor(whole / 60), minutes: whole % 60 });
}
/** Short enough for the side of a chart: "30 min", "2 ghante". */
export function tickText(minutes: number, t: Say) {
  if (!minutes) return '0';
  return minutes < 60
    ? t('owner.reports.minutes', { minutes })
    : t('owner.reports.hoursOnly', { hours: minutes / 60 });
}
/** Selling units in the desk's own words. The shared label turns them into Devanagari. */
export function unitWord(unit: string, language: Language) {
  return language === 'hi' ? unit.replace(/\bbags?\b/gi, 'bori') : unit;
}
/** Machines by name, and the API's word for someone with no name, in the desk's own words. */
export function nameOf(name: string, t: Say) {
  const key = `owner.activity.actor.${name}`;
  return isMessageKey(key) ? t(key) : name;
}
export function actorOf(entry: LogEntry, t: Say) {
  if (entry.actorName) return nameOf(entry.actorName, t);
  const machine = nameOf(entry.actorId, t);
  return machine === entry.actorId ? t('owner.activity.unknownPerson') : machine;
}
/** "Ramesh Yadav ka order pakka kiya, SC-2192": never the event's own name. */
export function sentence(entry: LogEntry, t: Say) {
  const key = `owner.activity.event.${entry.event}`;
  const paise = entry.details?.amountPaise;
  const said = isMessageKey(key)
    ? t(key, {
        who: entry.customerName || t('owner.activity.customer'),
        amount: typeof paise === 'number' ? money(Math.abs(paise)) : '',
      })
    : t('owner.activity.unknown');
  return entry.entityLabel ? `${said}, ${nameOf(entry.entityLabel, t)}` : said;
}
