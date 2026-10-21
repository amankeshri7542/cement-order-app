// How long ago something was saved, in words, for the "saved prices" notice. Plain logic with no
// React Native imports, so it is unit-tested under Node (test/age.test.mjs).

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

/** Saved lists older than this are not shown: prices that old would mislead. */
export const cacheMaxAge = 14 * day;

export const isFresh = (savedAt: number, now: number, maxAge = cacheMaxAge) =>
  Number.isFinite(savedAt) && savedAt <= now + minute && now - savedAt <= maxAge;

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", in English or Hindi. */
export function savedAge(savedAt: number, now: number, language: 'en' | 'hi'): string {
  const elapsed = Math.max(0, now - savedAt);
  const [count, en, hi]: [number, [string, string], string] =
    elapsed < minute
      ? [0, ['just now', 'just now'], 'अभी']
      : elapsed < hour
        ? [Math.floor(elapsed / minute), ['minute', 'minutes'], 'मिनट']
        : elapsed < day
          ? [Math.floor(elapsed / hour), ['hour', 'hours'], 'घंटे']
          : [Math.floor(elapsed / day), ['day', 'days'], 'दिन'];
  if (count === 0) return language === 'hi' ? hi : en[0];
  return language === 'hi' ? `${count} ${hi} पहले` : `${count} ${count === 1 ? en[0] : en[1]} ago`;
}
