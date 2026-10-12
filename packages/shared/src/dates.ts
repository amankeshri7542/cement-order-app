import type { Language } from './i18n';

// All shop dates are Patna time. Hindi uses hi-IN formatting; a fixed 24-hour time avoids
// day-period differences between engines (server render, WebKit, Android's Hermes).
const ZONE = 'Asia/Kolkata';

export function dateLabel(value: string | Date, language: Language): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: ZONE,
  }).format(new Date(value));
}
export function timeLabel(value: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: ZONE,
  }).format(new Date(value));
}
/** Calendar days (YYYY-MM-DD) without shifting across time zones; anything else as received. */
export function dayLabel(value: string, language: Language): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? dateLabel(`${value}T00:00:00+05:30`, language) : value;
}
export function momentLabel(value: string, language: Language): string {
  return `${dateLabel(value, language)} · ${timeLabel(value)}`;
}

/** Today's calendar date in Patna as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
}
/** Delivery dates a customer can pick: `leadDays` from today, for `count` days. */
export function deliveryDateOptions(now: Date = new Date(), leadDays = 1, count = 14): string[] {
  const start = new Date(`${istToday(now)}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start.getTime() + (leadDays + index) * 86400000);
    return day.toISOString().slice(0, 10);
  });
}
/** "2 घंटे / 3 दिन" style age for owner queues and order cards. */
export function ageLabel(since: string | Date, language: Language, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60000));
  const [value, unit] =
    minutes < 60
      ? [minutes, language === 'hi' ? 'मिनट' : 'min']
      : minutes < 1440
        ? [Math.floor(minutes / 60), language === 'hi' ? 'घंटे' : 'h']
        : [Math.floor(minutes / 1440), language === 'hi' ? 'दिन' : 'd'];
  return language === 'hi' ? `${value} ${unit}` : `${value}${unit === 'min' ? ' min' : unit}`;
}
