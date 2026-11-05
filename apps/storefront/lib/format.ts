// Small enough for any page: no zod, nothing from the shared package's root.
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const inrPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const IST = 'Asia/Kolkata';
const day = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'long' });
const dayYear = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const time = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const isoDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Rupees with Indian grouping: ₹1,11,690. Paise show only when there are any. Never for ₹0 rates. */
export function rupees(paise: number) {
  if (!Number.isSafeInteger(paise) || paise < 0)
    throw new Error('Rates must be nonnegative whole paise');
  return (paise % 100 ? inrPaise : inr).format(paise / 100);
}
const valid = (value: string | Date) => !Number.isNaN(new Date(value).getTime());
export const istDay = (value: string | Date) => isoDay.format(new Date(value));
export const isToday = (value: string | Date, now: Date = new Date()) =>
  valid(value) && istDay(value) === istDay(now);
/** "5 November", with the year only when it is not this year. */
export function dayText(value: string | Date, now: Date = new Date()) {
  if (!valid(value)) return '';
  const date = new Date(value);
  return (istDay(date).slice(0, 4) === istDay(now).slice(0, 4) ? day : dayYear).format(date);
}
/** "9:40 AM" in Patna, whatever the server's clock zone. */
export const timeText = (value: string | Date) =>
  valid(value)
    ? time.format(new Date(value)).replace(/\s*(am|pm)$/i, (_, m: string) => ` ${m.toUpperCase()}`)
    : '';
export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
