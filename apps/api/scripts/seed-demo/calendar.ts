/** Days and seasons for the demo history. All days are India dates (YYYY-MM-DD). */

const DAY = 86_400_000;
const IST_OFFSET = 330 * 60_000;

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

export function dayRange(first: string, last: string): string[] {
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

export function istToday(now = Date.now()): string {
  return new Date(now + IST_OFFSET).toISOString().slice(0, 10);
}

/** An instant on an India day, at hour:minute India time. */
export function istInstant(day: string, hour: number, minute = 0): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET + (hour * 60 + minute) * 60_000);
}

export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** A month offset: '2026-11-08' minus 6 months gives '2026-05-09' (the day after, to make 6 full months). */
export function monthsBefore(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return addDays(d.toISOString().slice(0, 10), 1);
}

// Approximate festival days, when the shop is quiet or shut. Diwali, Chhath and Holi move each year.
const festivals: Record<string, number> = {
  '2023-03-08': 0.1,
  '2023-11-12': 0.1,
  '2023-11-19': 0.15,
  '2023-11-20': 0.3,
  '2024-03-25': 0.1,
  '2024-11-01': 0.1,
  '2024-11-07': 0.15,
  '2024-11-08': 0.3,
  '2025-03-14': 0.1,
  '2025-10-20': 0.1,
  '2025-10-27': 0.15,
  '2025-10-28': 0.3,
  '2026-03-04': 0.1,
  '2026-11-08': 0.1,
  '2026-11-15': 0.15,
  '2026-11-16': 0.3,
  '2027-03-22': 0.1,
};

// Building season peaks January to May; the monsoon (July to September) is slow.
const monthFactor = [1.25, 1.35, 1.4, 1.35, 1.2, 0.95, 0.6, 0.55, 0.65, 0.9, 0.85, 1.05];

/** How busy a day is, around 1.0 for an ordinary day. Sunday is a short day. */
export function busyness(day: string): number {
  const month = Number(day.slice(5, 7)) - 1;
  const sunday = weekday(day) === 0 ? 0.45 : 1;
  return monthFactor[month]! * sunday * (festivals[day] ?? 1);
}
