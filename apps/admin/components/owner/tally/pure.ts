import type { MessageKey } from '@shiv/i18n';
import { bookMoney } from '../crm/pure';
import type { CompanyRole, DifferenceLine, LineReason, TallyCompany, TallyPc } from './types';

const whole = (paise: string) => BigInt(paise);
const absolute = (value: bigint) => (value < BigInt(0) ? -value : value);

/** A whole amount, without its sign: the words beside it say which way it goes. */
export function plainMoney(paise: string) {
  return bookMoney(String(absolute(whole(paise))));
}

/** With its sign always shown, so a column of lines can be added by eye. */
export function signedMoney(paise: string) {
  const value = whole(paise);
  if (value === BigInt(0)) return bookMoney('0');
  return `${value < BigInt(0) ? '-' : '+'}${bookMoney(String(absolute(value)))}`;
}

/** A Tally amount read the khata's way round: Tally's debit is what the customer owes. */
export function asKhata(paise: string) {
  return String(-whole(paise));
}

export type Side = 'owes' | 'holds' | 'toPay' | 'toGet' | 'clear';
/** Tally keeps debit as negative, so a customer who owes is below zero, and a supplier above it. */
export function partySide(closingPaise: string, supplier = false): Side {
  const value = whole(closingPaise);
  if (value === BigInt(0)) return 'clear';
  if (supplier) return value > BigInt(0) ? 'toPay' : 'toGet';
  return value < BigInt(0) ? 'owes' : 'holds';
}

/** How much of the money is linked, for a bar. Worked out on whole numbers, and only a bar. */
export function sharePercent(partPaise: string, totalPaise: string) {
  const total = whole(totalPaise);
  if (total <= BigInt(0)) return 0;
  return Number((whole(partPaise) * BigInt(100)) / total);
}

/** Every line, plus what nobody can name, must make the difference exactly. */
export function linesAddUp(
  lines: readonly Pick<DifferenceLine, 'amountPaise'>[],
  unexplainedPaise: string,
  differencePaise: string,
) {
  const named = lines.reduce((sum, line) => sum + whole(line.amountPaise), BigInt(0));
  return named + whole(unexplainedPaise) === whole(differencePaise);
}

const DAY_MS = 24 * 3600000;
/** The same line the API draws for a customer's number: more than a day old is old. */
export function isOld(at: string | null, now: string | number) {
  if (!at) return false;
  const moment = typeof now === 'number' ? now : Date.parse(now);
  return moment - Date.parse(at) > DAY_MS;
}

/** "0 minute pehle" says nothing a person would say. The server's clock, not this device's. */
export function justNow(at: string, now: string) {
  return Date.parse(now) - Date.parse(at) < 60000;
}

export function lineWord(line: Pick<DifferenceLine, 'reason' | 'note'>): MessageKey {
  if (line.note === 'WITHIN_TOLERANCE') return 'owner.tally.line.ROUND_OFF';
  if (line.reason === 'OPENING' && line.note === 'SIGNED') return 'owner.tally.line.OPENING_SIGNED';
  return `owner.tally.line.${line.reason}`;
}

const reasonOrder: LineReason[] = ['OPENING', 'TIMING', 'APP_ONLY', 'TALLY_ONLY', 'AMOUNT'];
/** The Farq list's summary of a row, in a fixed order, leaving out what is not there. */
export function reasonLines(reasons: Partial<Record<LineReason, string>> | null) {
  return reasonOrder.flatMap((reason) => {
    const amount = reasons?.[reason];
    return amount && whole(amount) !== BigInt(0) ? [{ reason, amountPaise: amount }] : [];
  });
}

export const roleWord = (role: CompanyRole): MessageKey => `owner.tally.role.${role}`;

export type Tone = 'good' | 'look' | 'bad' | 'plain';
export type PcWord = {
  tag: MessageKey;
  tone: Tone;
  /** A line under the tag that needs no other facts. */
  body?: MessageKey;
  /** The two lines the accountant follows in Tally. */
  setting?: boolean;
};

/**
 * Plan 09's state table. BUSY says nothing to an owner, only the technical operator watches slow
 * times, and a PC asleep after closing is never an alarm.
 */
export function pcWord(state: string, technical = false): PcWord {
  switch (state) {
    case 'OK':
      return { tag: 'owner.tally.state.OK', tone: 'good' };
    case 'BUSY':
      return technical
        ? { tag: 'owner.tally.state.BUSY', tone: 'look' }
        : { tag: 'owner.tally.state.OK', tone: 'good' };
    case 'NEW':
    case 'PAIRED':
      return {
        tag: 'owner.tally.state.PAIRED',
        tone: 'look',
        body: 'owner.tally.state.PAIREDBody',
      };
    case 'PC_ASLEEP':
      return { tag: 'owner.tally.state.PC_ASLEEP', tone: 'plain' };
    case 'PC_SILENT':
      return { tag: 'owner.tally.state.PC_SILENT', tone: 'look' };
    case 'TALLY_CLOSED':
      return {
        tag: 'owner.tally.state.TALLY_CLOSED',
        tone: 'look',
        body: 'owner.tally.state.TALLY_CLOSEDBody',
      };
    case 'PORT_OFF':
      return {
        tag: 'owner.tally.state.PORT_OFF',
        tone: 'look',
        body: 'owner.tally.state.PORT_OFFBody',
        setting: true,
      };
    case 'NO_COMPANY':
      return {
        tag: 'owner.tally.state.NO_COMPANY',
        tone: 'look',
        body: 'owner.tally.state.NO_COMPANYBody',
      };
    case 'COMPANY_MISSING':
      return { tag: 'owner.tally.state.NO_COMPANY', tone: 'look' };
    case 'BAD_ANSWER':
      return {
        tag: 'owner.tally.state.BAD_ANSWER',
        tone: 'look',
        body: 'owner.tally.state.BAD_ANSWERBody',
      };
    case 'PAUSED':
      return {
        tag: 'owner.tally.state.PAUSED',
        tone: 'look',
        body: 'owner.tally.state.PAUSEDBody',
      };
    case 'SPOOL_FULL':
      return {
        tag: 'owner.tally.state.SPOOL_FULL',
        tone: 'look',
        body: 'owner.tally.state.SPOOL_FULLBody',
      };
    case 'EDUCATIONAL':
      return {
        tag: 'owner.tally.state.EDUCATIONAL',
        tone: 'bad',
        body: 'owner.tally.state.EDUCATIONALBody',
      };
    case 'REVOKED':
      return { tag: 'owner.tally.state.REVOKED', tone: 'plain' };
    default:
      return { tag: 'owner.tally.state.other', tone: 'plain' };
  }
}

export function tieWord(tieOut: TallyCompany['tieOut']): { word: MessageKey; tone: Tone } {
  switch (tieOut.status) {
    case 'OK':
      return { word: 'owner.tally.tie.OK', tone: 'good' };
    case 'FAILED':
      return { word: 'owner.tally.tie.FAILED', tone: 'bad' };
    case 'UNSETTLED':
      return { word: 'owner.tally.tie.UNSETTLED', tone: 'plain' };
    case 'REWRITTEN':
      return { word: 'owner.tally.tie.REWRITTEN', tone: 'look' };
    default:
      return { word: 'owner.tally.tie.PENDING', tone: 'plain' };
  }
}

/** Whether the books are all set aside, or only still being copied. Decides what Farq can say. */
export function booksState(companies: readonly Pick<TallyCompany, 'role' | 'phase'>[]) {
  const books = companies.filter((company) => company.role === 'PRIMARY');
  if (!books.length) return 'NONE' as const;
  return books.some((company) => company.phase !== 'LIVE')
    ? ('COPYING' as const)
    : ('LIVE' as const);
}

/** The company's PC is gone when nobody live is left holding it, which only a person can fix. */
export function pcGone(company: Pick<TallyCompany, 'ownerDeviceId'>, pcs: readonly TallyPc[]) {
  return !pcs.some((pc) => pc.id === company.ownerDeviceId && !pc.revoked);
}

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export const isVersion = (value: string) => VERSION.test(value);

/** The one exact command for the PC. The code goes in only for the moment it is on screen. */
export const pairCommand = (code: string, apiUrl: string) =>
  `"%ProgramFiles%\\ShivBridge\\node.exe" "%ProgramFiles%\\ShivBridge\\app\\main.mjs" pair ${code} --api ${new URL(apiUrl).origin}`;

export function bytesWord(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
