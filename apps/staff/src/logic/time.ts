import type { MessageKey } from '@shiv/i18n';
import type { Tr } from './words';

const istOffsetMs = 5.5 * 3600000;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The server's time and where this phone's boot clock stood when it was read. The phone's own
 * clock is never used, because anyone can change it. Android's time-since-boot cannot be changed,
 * so server time can be carried forward by it, with no signal, until the next reboot.
 */
export type ClockBase = { serverMs: number; monoMs: number; boot: number };

/** Reads it at the middle of the request, so a slow network does not push the clock back. */
export function syncClock(
  serverNowIso: string,
  monoBefore: number,
  monoAfter: number,
  boot: number,
): ClockBase | null {
  const serverMs = Date.parse(serverNowIso);
  if (!Number.isFinite(serverMs)) return null;
  return { serverMs, monoMs: Math.round((monoBefore + monoAfter) / 2), boot };
}
/** Null means there is no time we can trust, and the screen says so rather than guessing. */
export function serverNow(base: ClockBase | null, mono: number, boot: number): number | null {
  if (!base || base.boot !== boot || mono < base.monoMs) return null;
  return base.serverMs + (mono - base.monoMs);
}

const ist = (ms: number) => new Date(ms + istOffsetMs);
const pad = (value: number) => String(value).padStart(2, '0');
/** The India calendar day, as the server counts it. */
export function istDay(ms: number) {
  const at = ist(ms);
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}
/** "9:02 AM", always in India time, whatever the phone is set to. */
export function timeText(at: number | string) {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  const when = ist(ms);
  const hours = when.getUTCHours();
  return `${hours % 12 || 12}:${pad(when.getUTCMinutes())} ${hours < 12 ? 'AM' : 'PM'}`;
}
/** "Mangal, 3 Nov" for a calendar day. */
export function dayText(day: string, tr: Tr) {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return `${tr(`staff.weekday.${weekday}` as MessageKey)}, ${date} ${months[month - 1]}`;
}
/** "3 Nov": a day in a sentence, where the weekday would only get in the way. */
export function shortDay(day: string) {
  const [, month, date] = day.split('-').map(Number) as [number, number, number];
  return `${date} ${months[month - 1]}`;
}
export const monthText = (month: string, tr: Tr) => {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return `${tr(`staff.month.${index - 1}` as MessageKey)} ${year}`;
};
/** "9 ghante 39 minute". */
export function hoursWords(minutes: number, tr: Tr) {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (!hours) return tr('staff.time.minutes', { minutes: rest });
  if (!rest) return tr('staff.time.hours', { hours });
  return tr('staff.time.hoursMinutes', { hours, minutes: rest });
}
