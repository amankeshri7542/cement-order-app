import { t } from '@shiv/i18n';
import type { Language as SiteLanguage } from './i18n';

/**
 * The website and the customer app pass 'en' or 'hi'; the desk and the staff app pass their own
 * language, where Hinglish is 'hinglish' (plan v4 B2). 'hi' is Devanagari everywhere. Digits are
 * Latin in every language; month, weekday and age words come from the catalogue, so every engine
 * (server render, WebKit, Android's Hermes) prints the same words.
 */
type Language = SiteLanguage | 'hinglish';

// All shop dates are Patna time. A fixed 24-hour time avoids day-period differences between engines.
const ZONE = 'Asia/Kolkata';
const parts = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  timeZone: ZONE,
});
/** Day, month (1 to 12) and year of a moment, in Patna. */
function patna(value: string | Date) {
  const got = Object.fromEntries(
    parts.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  return { day: Number(got.day), month: Number(got.month), year: Number(got.year) };
}
const month = (value: number, language: Language) =>
  t(`date.month.${value}` as 'date.month.1', {}, language);

/** "16 Oct 2026", "16 अक्तू॰ 2026". */
export function dateLabel(value: string | Date, language: Language): string {
  const { day, month: m, year } = patna(value);
  return `${day} ${month(m, language)} ${year}`;
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

const noon = (day: string) => new Date(`${day}T12:00:00+05:30`);
/** "Thu" / "Guruvar" / "गुरुवार" for a YYYY-MM-DD delivery day. */
export function weekdayLabel(day: string, language: Language): string {
  return t(`date.weekday.${noon(day).getUTCDay()}` as 'date.weekday.0', {}, language);
}
/** "16 Oct" for a YYYY-MM-DD delivery day. */
export function shortDayLabel(day: string, language: Language): string {
  const { day: d, month: m } = patna(noon(day));
  return `${d} ${month(m, language)}`;
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
/** "15 min", "2 ghante", "3 दिन": age for owner queues and order cards. */
export function ageLabel(since: string | Date, language: Language, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60000));
  if (minutes < 60) return t('date.age.minutes', { count: minutes }, language);
  if (minutes < 1440) return t('date.age.hours', { count: Math.floor(minutes / 60) }, language);
  return t('date.age.days', { count: Math.floor(minutes / 1440) }, language);
}
