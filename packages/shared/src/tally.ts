/**
 * Tally, read-only. Shared by the API and the desk. Money from Tally is always a string on the wire
 * and BigInt in code, never a float: a supplier's dues can pass what a number holds safely in paise.
 */
import { z } from 'zod';

export const bridgeProtocol = 1;
/** The fixed list. The program on the shop PC knows these and nothing else. */
export const tallyReadNames = [
  'companies',
  'licence',
  'groups',
  'parties',
  'voucherTypes',
  'stockItems',
  'godowns',
  'vouchers',
  'voucherLines',
  'voucherStock',
  'voucherSweep',
] as const;
export type TallyReadName = (typeof tallyReadNames)[number];

/** What each read's F01, F02... mean, in order (plan 09 section 7). */
export const tallyColumns: Record<TallyReadName | 'count', readonly string[]> = {
  companies: ['guid', 'name', 'booksFrom', 'lastVoucherDate', 'altMstId', 'altVchId'],
  licence: ['major', 'minor', 'release', 'educational', 'licensed', 'silver', 'gold', 'editLog'],
  groups: ['guid', 'alterId', 'name', 'parent'],
  parties: [
    'guid',
    'masterId',
    'alterId',
    'name',
    'parent',
    'mobile',
    'phone',
    'gstin',
    'billWise',
    'opening',
    'closing',
  ],
  voucherTypes: ['guid', 'name', 'parent'],
  stockItems: ['guid', 'alterId', 'name', 'parent', 'baseUnits', 'closingQty', 'closingValue'],
  godowns: ['guid', 'name', 'parent'],
  vouchers: [
    'guid',
    'masterId',
    'alterId',
    'date',
    'type',
    'number',
    'party',
    'reference',
    'narration',
    'isOptional',
    'isCancelled',
  ],
  voucherLines: ['guid', 'ledger', 'amount'],
  voucherStock: ['guid', 'item', 'billedQty', 'rate', 'amount'],
  voucherSweep: ['guid', 'alterId', 'date'],
  count: ['count'],
};

export class TallyAmountError extends Error {}

/**
 * A Tally amount to paise, working on the text alone. Tolerates "(-)", Indian commas and Dr or Cr.
 * Debit is negative, as in plan 09's AMT(). Anything it cannot read exactly is refused, never rounded.
 */
export function tallyAmountToPaise(text: string): bigint {
  let value = text.replace(/[\s\u00A0]/g, '');
  if (!value) return BigInt(0);
  let side: 'Dr' | 'Cr' | null = null;
  const suffix = /(dr|cr)\.?$/i.exec(value);
  if (suffix) {
    side = suffix[1]!.toLowerCase() === 'dr' ? 'Dr' : 'Cr';
    value = value.slice(0, suffix.index);
  }
  let negative = false;
  if (value.startsWith('(-)')) {
    negative = true;
    value = value.slice(3);
  } else if (value.startsWith('-')) {
    negative = true;
    value = value.slice(1);
  } else if (value.startsWith('+')) value = value.slice(1);
  if (!/^(\d[\d,]*)?(\.\d*)?$/.test(value) || !/\d/.test(value) || value.endsWith(','))
    throw new TallyAmountError('Not an amount');
  const [whole = '', fraction = ''] = value.replaceAll(',', '').split('.');
  if (whole.length > 18) throw new TallyAmountError('Too large');
  if (fraction.length > 2 && /[^0]/.test(fraction.slice(2)))
    throw new TallyAmountError('More exact than a paisa');
  // A debit written with a minus and "Dr" could mean either thing, so it means neither.
  if (side && negative) throw new TallyAmountError('Two signs');
  const paise = BigInt(`${whole || '0'}${fraction.slice(0, 2).padEnd(2, '0')}`);
  return negative || side === 'Dr' ? -paise : paise;
}

/** App positive means the customer owes; Tally debit is negative. So the app's view is the opposite. */
export const tallyAppEquivalent = (closingPaise: bigint) => -closingPaise;

/** What a PC signs: the whole request, so nothing can be moved to another job or body. */
export const bridgeMessage = (
  method: string,
  path: string,
  time: string,
  seq: string,
  bodySha256: string,
) => [method, path, time, seq, bodySha256].join('\n');
export const bridgePairMessage = (code: string, publicKey: string) =>
  `bridge-pair|${code}|${publicKey}`;

const months = 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'.split(',');
/** 2026-04-01 becomes 1-Apr-2026, the form Tally's samples use. */
export function tallyDate(day: string) {
  const [year, month, date] = day.split('-');
  return `${Number(date)}-${months[Number(month) - 1]}-${year}`;
}
export const tallyDayNumber = (day: string) => day.replaceAll('-', '');
/** The financial year this India date falls in starts on 1 April. */
export function financialYearStart(day: string) {
  const year = Number(day.slice(0, 4));
  return `${Number(day.slice(5, 7)) >= 4 ? year : year - 1}-04-01`;
}
export function dayShift(day: string, by: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * 86400000).toISOString().slice(0, 10);
}

/**
 * Voucher kinds the mirror copies. Payroll never goes on this list, whatever a type is called.
 * Everything else in a company's list is copied only if its parents lead to one of these.
 */
export const tallyBaseTypes = [
  'Sales',
  'Purchase',
  'Receipt',
  'Payment',
  'Credit Note',
  'Debit Note',
  'Journal',
] as const;
/** Walks a voucher type's parents to where they end. Empty means this type is not copied. */
export function tallyBaseType(name: string, parentOf: ReadonlyMap<string, string>) {
  const seen = new Set<string>();
  let at = name;
  while (!seen.has(at)) {
    seen.add(at);
    if ((tallyBaseTypes as readonly string[]).includes(at)) return at;
    const parent = parentOf.get(at);
    if (!parent || parent === at) return '';
    at = parent;
  }
  return '';
}

export const bridgeReportedStates = [
  'OK',
  'TALLY_CLOSED',
  'PORT_OFF',
  'BUSY',
  'BAD_ANSWER',
  'PAUSED',
  'SPOOL_FULL',
] as const;
export const bridgeFinishErrors = [
  'TALLY_CLOSED',
  'BUSY',
  'TOO_BIG',
  'CUT_OFF',
  'BAD_ANSWER',
  'COUNT_UNSTABLE',
  'SPOOL_FULL',
  'BAD_JOB',
  'AGENT_ERROR',
] as const;

const base64 = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[A-Za-z0-9+/=]*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

const agentVersion = z
  .string()
  .max(40)
  .regex(/^[\w.-]*$/)
  .default('');
export const bridgePairSchema = z.object({
  code: z.string().regex(/^\d{8}$/),
  publicKey: base64(200).min(40),
  proof: base64(200).min(40),
  version: agentVersion,
  os: z.string().max(120).default(''),
});
export const bridgeHeartbeatSchema = z.object({
  state: z.enum(bridgeReportedStates),
  version: agentVersion,
  os: z.string().max(120).default(''),
  woke: z.boolean().default(false),
  caps: z
    .object({
      diskFreeMb: z.number().int().min(0).optional(),
      ramMb: z.number().int().min(0).optional(),
      spoolMb: z.number().int().min(0).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      updateFailed: z.string().max(40).optional(),
      slowMs: z.number().int().min(0).optional(),
    })
    .default({}),
  // The answers to reads 1 and 2, gzipped, untouched: the server does all the reading.
  probe: z
    .object({
      companies: base64(350000),
      licence: base64(350000).optional(),
      list: base64(350000).optional(),
    })
    .optional(),
});
export const bridgeFinishSchema = z.object({
  error: z.enum(bridgeFinishErrors).optional(),
  reads: z
    .array(
      z.object({
        index: z.number().int().min(0).max(32),
        parts: z.array(z.object({ seq: z.number().int().min(0).max(4095), sha256 })).max(4096),
        bytes: z.number().int().min(0),
        tookMs: z.number().int().min(0),
        readAt: z.number().int().min(0),
        counts: z
          .array(
            z
              .string()
              .max(2000)
              .regex(/^[A-Za-z0-9+/=]*$/),
          )
          .max(2)
          .optional(),
      }),
    )
    .max(32)
    .default([]),
  marksAfter: base64(350000).optional(),
});

export const tallyDevicePairSchema = z.object({
  name: z.string().trim().min(1).max(80),
  locationId: z.string().min(1).max(100).optional(),
});
export const tallyPauseSchema = z.object({
  paused: z.boolean(),
  deviceId: z.string().min(1).max(100).optional(),
});
export const tallyDeviceUpdateSchema = z.object({
  version: z
    .string()
    .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/)
    .nullable(),
});
export const tallyCompanyRoleSchema = z.object({
  role: z.enum(['PENDING', 'PRIMARY', 'BRANCH_COPY', 'IGNORE']).optional(),
  firmId: z.string().min(1).max(100).nullable().optional(),
  ownerDeviceId: z.string().min(1).max(100).optional(),
});
export const tallyLinkSchema = z
  .object({
    userId: z.string().min(1).max(100).optional(),
    phone: z
      .string()
      .regex(/^\+91[6-9]\d{9}$/)
      .optional(),
    name: z.string().trim().min(1).max(120).optional(),
    method: z.enum(['PHONE', 'GSTIN', 'NAME', 'TYPED']).default('TYPED'),
    score: z.number().int().min(0).max(100).optional(),
  })
  .refine((value) => Boolean(value.userId) !== Boolean(value.phone), {
    message: 'Choose a customer or type a phone, not both.',
  });
export const tallyMatchesSchema = z.object({
  items: z
    .array(z.object({ entryId: z.string().min(1).max(100), voucherId: z.string().min(1).max(100) }))
    .min(1)
    .max(100),
});
export const tallyReleaseSchema = z.object({
  version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
  manifest: z.string().min(2).max(20000),
  signature: base64(200).min(40),
  files: z.record(z.string().regex(/^[a-z0-9-]{1,60}\.mjs$/), base64(5_000_000)),
});
