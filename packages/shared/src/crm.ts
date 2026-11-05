import { z } from 'zod';

/**
 * What the CRM routes and the desk agree on: request shapes, and the small pure rules that decide
 * what a person is shown. Plan 09 section 11. Nothing here sends anything, and nothing here scores
 * a customer: every list is built from plain facts a person can check.
 */

const DAY_MS = 86400000;
const JOINERS = [0x200c, 0x200d];

/** Control, direction-override and zero-width characters. Hindi keyboards need the two joiners. */
function hasHiddenCharacter(value: string, lines: boolean) {
  for (const character of value) {
    if (!/\p{C}/u.test(character)) continue;
    if (JOINERS.includes(character.codePointAt(0)!)) continue;
    if (lines && (character === '\n' || character === '\t')) continue;
    return true;
  }
  return false;
}
const words = (max: number, lines = false) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !hasHiddenCharacter(value, lines), 'Remove special characters');

/** A real calendar day: 2026-02-31 is refused rather than quietly becoming March. */
export function isRealDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value);
}
export function addDays(day: string, count: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}
/** Whole days from one day to a later one. Negative when `to` comes first. */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}
const indiaDay = z.string().refine(isRealDay, 'Choose a real date.');
const rowId = z.string().min(1).max(100);
const key = z.string().uuid();
/** The same range a khata balance may hold. A customer may hold an advance, so it can be below 0. */
const khataPaise = z.number().int().min(-2_000_000_000).max(2_000_000_000);

export const followUpKinds = ['PAYMENT', 'ORDER', 'CALLBACK', 'OTHER'] as const;
export type FollowUpKind = (typeof followUpKinds)[number];

export const followUpCreateSchema = z
  .strictObject({
    customerId: rowId,
    dueOn: indiaDay,
    kind: z.enum(followUpKinds),
    note: words(500, true).optional(),
    assigneeId: rowId.nullable().optional(),
    promisedPaise: z.number().int().min(1).max(2_000_000_000).optional(),
    // Needed only from someone who works at more than one shop.
    locationId: rowId.optional(),
    idempotencyKey: key,
  })
  .refine((input) => input.promisedPaise === undefined || input.kind === 'PAYMENT', {
    path: ['promisedPaise'],
    message: 'A promised amount belongs on a payment follow-up.',
  });

export const followUpChangeSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('DONE'), idempotencyKey: key }),
  z.strictObject({
    action: z.literal('SNOOZE'),
    dueOn: indiaDay,
    reason: words(200),
    idempotencyKey: key,
  }),
  z.strictObject({
    action: z.literal('ASSIGN'),
    assigneeId: rowId.nullable(),
    idempotencyKey: key,
  }),
]);

export const followUpListSchema = z.strictObject({
  view: z.enum(['due', 'upcoming', 'done']).default('due'),
  mine: z.enum(['1', '0']).default('0'),
  locationId: rowId.optional(),
  customerId: rowId.optional(),
  limit: z.string().max(4).optional(),
  cursor: z.string().max(2000).optional(),
});

export const reminderPurposes = ['PAYMENT', 'QUIET'] as const;
export type ReminderPurpose = (typeof reminderPurposes)[number];
export const reminderSchema = z.strictObject({
  purpose: z.enum(reminderPurposes).default('PAYMENT'),
  // Says which shop's call this is, for someone reminding from their list.
  followUpId: rowId.optional(),
  // A second reminder the same day needs a person to say they mean it.
  again: z.boolean().default(false),
  idempotencyKey: key,
});
export const reminderStopSchema = z.strictObject({ stopped: z.boolean() });

export const openingDraftSchema = z.strictObject({
  customerId: rowId,
  asOf: indiaDay,
  paperPaise: khataPaise,
  note: words(300).optional(),
  locationId: rowId.optional(),
});
export const openingApproveSchema = z.strictObject({
  rows: z
    .array(
      z.strictObject({
        customerId: rowId,
        // What the owner saw. A figure changed since then is refused for that row.
        draftVersion: z.number().int().min(1),
        chosenPaise: khataPaise,
        reason: words(200).optional(),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (rows) => new Set(rows.map((row) => row.customerId)).size === rows.length,
      'Each customer can appear once.',
    ),
});
export const khataViewSchema = z.strictObject({ on: z.boolean() });

// ---- Phone numbers ----------------------------------------------------------------------------
const INDIAN_MOBILE = /^\+91[6-9]\d{9}$/;
export const isCustomerPhone = (phone: string) => INDIAN_MOBILE.test(phone);
/** Enough to tell two people apart on a list, and not enough to ring them. */
export function maskPhone(phone: string) {
  return INDIAN_MOBILE.test(phone) ? `+91XXXXXXX${phone.slice(-3)}` : '';
}

// ---- One-tap reminders ------------------------------------------------------------------------
/** Whole rupees read better in a message: ₹1,25,000 and not ₹1,25,000.00. */
const rupeesInWords = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: paise % 100 ? 2 : 0,
    minimumFractionDigits: paise % 100 ? 2 : 0,
  }).format(paise / 100);
/**
 * A name goes into a message the shop sends from its own number, so it is cut short and stripped
 * of anything that could hide or reorder words, or turn into a link.
 */
function plainName(name: string) {
  let kept = '';
  for (const character of name)
    if (!/\p{C}/u.test(character) && !/[<>[\]{}*_~`|\\]/.test(character)) kept += character;
  return kept
    .replace(/\s+/g, ' ')
    .replace(/(?:https?:\/\/|www\.)\S*/gi, '')
    .trim()
    .slice(0, 40)
    .trim();
}
export function reminderText(input: { name: string; balancePaise: number; shop: string }) {
  const name = plainName(input.name);
  return `Namaste${name ? ` ${name} ji` : ''}, ${input.shop} ke khate mein ${rupeesInWords(input.balancePaise)} baaki hai. Kab tak de payenge, bata dijiye. Dhanyavaad.`;
}
export function quietText(input: { name: string; shop: string }) {
  const name = plainName(input.name);
  return `Namaste${name ? ` ${name} ji` : ''}, ${input.shop} se. Bahut din se aapka order nahi aaya. Kuch chahiye ho to bataiye. Dhanyavaad.`;
}
export type ReminderBlock = 'NO_PHONE' | 'STOPPED' | 'NOT_SIGNED' | 'NO_BALANCE';
/**
 * Why no reminder may go out. A stop request beats everything. A payment reminder also needs a
 * signed opening and something actually owed: a wrong one costs a relationship.
 */
export function reminderBlock(input: {
  purpose: ReminderPurpose;
  stopped: boolean;
  signed: boolean;
  balancePaise: number;
  phone: string;
}): ReminderBlock | null {
  if (!INDIAN_MOBILE.test(input.phone)) return 'NO_PHONE';
  if (input.stopped) return 'STOPPED';
  if (input.purpose === 'QUIET') return null;
  if (!input.signed) return 'NOT_SIGNED';
  return input.balancePaise > 0 ? null : 'NO_BALANCE';
}
/** Opens WhatsApp with the words filled in. A person reads them and presses send, or does not. */
export function whatsappLink(phone: string, text: string) {
  if (!INDIAN_MOBILE.test(phone)) return null;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`;
}

// ---- Promises ---------------------------------------------------------------------------------
export type PromiseState = 'OPEN' | 'KEPT' | 'BROKEN';
/**
 * Whether a promise to pay has been kept, from what has actually come in since it was made. Nobody
 * gets called about a promise they have already kept.
 */
export function promiseState(input: {
  promisedPaise: number | null;
  paidSincePaise: number;
  dueOn: string;
  today: string;
}): PromiseState | null {
  if (input.promisedPaise === null) return null;
  if (input.paidSincePaise >= input.promisedPaise) return 'KEPT';
  return input.dueOn < input.today ? 'BROKEN' : 'OPEN';
}

// ---- Chup grahak ------------------------------------------------------------------------------
/**
 * The rule, in numbers a person can argue with. Plan 09 calls them a guess, to be tried for four
 * weeks. Someone is quiet when they have ordered at least `minOrders` times in the past year and
 * have now gone both `minQuietDays` and `timesUsualGap` times their own usual gap without one.
 */
export const quietRule = { minOrders: 3, windowDays: 365, minQuietDays: 45, timesUsualGap: 2 };

export function quietCheck(orderDays: readonly string[], today: string) {
  const from = addDays(today, -quietRule.windowDays);
  const within = orderDays.filter((day) => day >= from && day <= today);
  const days = [...new Set(within)].sort();
  if (within.length < quietRule.minOrders || !days.length) return null;
  const gaps = days.slice(1).map((day, index) => daysBetween(days[index]!, day));
  const sorted = [...gaps].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const usualGapDays = !sorted.length
    ? null
    : sorted.length % 2
      ? sorted[middle]!
      : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
  const lastOrderOn = days.at(-1)!;
  const quietDays = daysBetween(lastOrderOn, today);
  const thresholdDays = Math.max(
    quietRule.minQuietDays,
    (usualGapDays ?? 0) * quietRule.timesUsualGap,
  );
  return {
    orders: within.length,
    lastOrderOn,
    quietDays,
    usualGapDays,
    thresholdDays,
    quiet: quietDays >= thresholdDays,
  };
}

// ---- Spreadsheets -----------------------------------------------------------------------------
/**
 * A spreadsheet runs a cell that starts with one of these as a formula, and a customer chooses their
 * own name. Includes the full-width forms some versions of Excel also accept.
 */
const FORMULA_START = /^[=+\-@＝＋－＠]/;
/** A customer's or staff member's words, made safe for a cell. Numbers we made ourselves skip this. */
export function csvText(value: string) {
  let clean = '';
  for (const character of value.replace(/[\r\n\t]+/g, ' ')) {
    if (!/\p{C}/u.test(character) || JOINERS.includes(character.codePointAt(0)!))
      clean += character;
  }
  const guarded = FORMULA_START.test(clean.trimStart()) ? `'${clean}` : clean;
  // Always quoted, so a semicolon in a name cannot start a new cell in a semicolon-separated locale.
  return `"${guarded.replaceAll('"', '""')}"`;
}
/** A number for a money column, two places, never guarded: only this code ever writes it. */
export const csvRupees = (paise: number | bigint) => {
  const value = BigInt(paise);
  const whole = value < 0n ? -value : value;
  const fraction = String(whole % 100n).padStart(2, '0');
  return `${value < 0n ? '-' : ''}${whole / 100n}.${fraction}`;
};
/** UTF-8 with a byte-order mark, so Excel shows Hindi and the rupee sign correctly. */
export function csvDocument(rows: readonly (readonly string[])[]) {
  return `${String.fromCharCode(0xfeff)}${rows.map((row) => row.join(',')).join('\r\n')}\r\n`;
}
