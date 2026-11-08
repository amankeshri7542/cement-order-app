/**
 * Formatting and small decisions the kit makes, kept free of React so they are tested directly.
 * Digits are Latin with Indian grouping in every language (PRODUCT.md, Languages).
 */

const exactInr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const wholeInr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/**
 * ₹ with Indian grouping. `exact` keeps paise (galla, bills, khata); otherwise whole rupees,
 * rounded half away from zero, so ₹1,234.50 reads ₹1,235 (DESIGN.md, numbers you can read across).
 * The minus is a real minus sign, which screen readers say and which lines up in tabular figures.
 */
export function formatMoney(paise: number, exact = false): string {
  if (!Number.isFinite(paise)) return '';
  const negative = paise < 0;
  const size = Math.abs(paise);
  const text = exact ? exactInr.format(size / 100) : wholeInr.format(Math.round(size / 100));
  return negative && (exact ? size > 0 : Math.round(size / 100) > 0) ? `−${text}` : text;
}

/** 1,250 or 12.5, with the unit as stored: bori, kg, cft, trolley. */
export function formatQty(value: number, unit?: string): string {
  if (!Number.isFinite(value)) return '';
  const text = value < 0 ? `−${grouped.format(-value)}` : grouped.format(value);
  return unit ? `${text} ${unit}` : text;
}

/** Plain grouped count for pager and chips: 1,240. */
export function formatCount(value: number): string {
  return grouped.format(Math.max(0, Math.trunc(value)));
}

/**
 * What someone typed in rupees, as whole paise, or null when it is not an amount. Accepts Indian
 * grouping commas and a ₹ sign, at most two decimals, and nothing above ₹2 crore (the API's limit).
 */
export function parseRupees(typed: string, allowNegative = false): number | null {
  const text = typed.replace(/[₹,\s]/g, '').replace('−', '-');
  const pattern = allowNegative ? /^-?\d+(?:\.\d{0,2})?$/ : /^\d+(?:\.\d{0,2})?$/;
  if (!pattern.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise > 2_000_000_000) return null;
  return negative ? -paise : paise;
}

/** Paise back to what goes in a rupee field: 1234.5 → "1234.50", whole rupees without decimals. */
export function rupeesText(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return '';
  const negative = paise < 0;
  const size = Math.abs(paise);
  const text = size % 100 ? (size / 100).toFixed(2) : String(size / 100);
  return negative ? `-${text}` : text;
}

/** The change shown on a KPI tile, as a direction and a share: +12% or −3%. */
export function changeOf(now: number, before: number | null | undefined) {
  if (before === null || before === undefined || !Number.isFinite(before) || before === 0)
    return null;
  const share = Math.round(((now - before) / Math.abs(before)) * 100);
  return {
    direction: share > 0 ? 'up' : share < 0 ? 'down' : 'same',
    share: Math.abs(share),
  } as const;
}

/** Calendar days in Patna, as YYYY-MM-DD, `offset` days from `day`. */
export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  return new Date(date.getTime() + offset * 86400000).toISOString().slice(0, 10);
}

/** The points of a sparkline in a 0..width × 0..height box, top is high. */
export function sparkPoints(values: readonly number[], width: number, height: number): string {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return '';
  const low = Math.min(...clean);
  const high = Math.max(...clean);
  const span = high - low || 1;
  return clean
    .map((value, index) => {
      const x = (index / (clean.length - 1)) * width;
      const y = height - ((value - low) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** The pager's numbers: rows from and to (1-based), or nothing when the page is empty. */
export function pageRange(offset: number, shown: number) {
  if (shown <= 0) return null;
  return { from: offset + 1, to: offset + shown };
}

/**
 * Which row the keyboard moves to. Arrow keys step, PageUp and PageDown jump a screen, Home and End
 * go to the ends. Anything else leaves the row where it is.
 */
export function moveRow(key: string, current: number, count: number, page = 10): number {
  if (count <= 0) return -1;
  const at = current < 0 ? -1 : Math.min(current, count - 1);
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, at + 1);
    case 'ArrowUp':
      return at <= 0 ? 0 : at - 1;
    case 'PageDown':
      return Math.min(count - 1, Math.max(0, at) + page);
    case 'PageUp':
      return Math.max(0, at - page);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return at;
  }
}

/** The options a Combobox shows for what was typed: name match first, then anywhere in the text. */
export function matchOptions<T extends { label: string; hint?: string }>(
  options: readonly T[],
  query: string,
  limit = 50,
): T[] {
  const typed = query.trim().toLowerCase();
  if (!typed) return options.slice(0, limit);
  const starts: T[] = [];
  const contains: T[] = [];
  for (const option of options) {
    const label = option.label.toLowerCase();
    if (label.startsWith(typed)) starts.push(option);
    else if (label.includes(typed) || option.hint?.toLowerCase().includes(typed))
      contains.push(option);
  }
  return [...starts, ...contains].slice(0, limit);
}
