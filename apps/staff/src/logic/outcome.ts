import type { MessageKey } from '@shiv/i18n';
import type { Tr } from './words';
import { timeText, hoursWords } from './time';

/**
 * What a person sees after a scan, worked out in one place. Green: it counted. Amber: the time is
 * saved and someone will look, or just scan again. Red is only for when nothing at all was saved.
 */
export type Tone = 'ok' | 'amber' | 'red';
export type OutcomeAction = 'home' | 'rescan' | 'problem' | 'settings' | 'relink';
export type Outcome = {
  tone: Tone;
  title: string;
  lines: string[];
  actions: OutcomeAction[];
  /** Green holds, then goes back by itself. */
  autoReturn: boolean;
  icon: 'check' | 'clock' | 'alert';
};
export type PunchReply = {
  id?: string;
  kind: 'IN' | 'OUT' | string;
  result: 'GREEN' | 'GREEN_NOTE' | 'RETRY' | 'REVIEW' | null;
  reasons: string[];
  serverAt: string;
  lateMinutes?: number;
  replay?: boolean;
  already?: boolean;
  shopName?: string;
};

/** Three stale codes in a row is not a person being slow any more: offer the way through. */
export const retriesBeforeProblem = 3;

/** Plain words for why a person is looking. Never an accusation, and no word about cheating. */
const reviewLine: Record<string, MessageKey> = {
  FAR: 'staff.result.why.far',
  MOCKED: 'staff.result.why.check',
  LOCATION_OFF: 'staff.result.why.locationOff',
  APPROXIMATE: 'staff.result.why.approximate',
  OTHER_SHOP: 'staff.result.why.otherShop',
  IMPOSSIBLE_TRAVEL: 'staff.result.why.check',
  OFFLINE: 'staff.result.why.offline',
  OLD_QR: 'staff.result.why.oldQr',
  MANY_WEAK: 'staff.result.why.weak',
  NO_IN: 'staff.result.why.noIn',
};

export function punchOutcome(
  reply: PunchReply,
  tr: Tr,
  context: { retriesInARow?: number; arrivedAt?: string | null } = {},
): Outcome {
  const at = timeText(reply.serverAt);
  // A second arrival is not a mistake to scold. It says when the first was.
  if (reply.already)
    return {
      tone: 'ok',
      title: tr('staff.result.already', { time: at }),
      lines: [],
      actions: ['home'],
      autoReturn: true,
      icon: 'check',
    };
  if (reply.result === 'RETRY')
    return {
      tone: 'amber',
      title: tr('staff.result.oldQr'),
      lines: [tr('staff.result.oldQrLine')],
      actions:
        (context.retriesInARow ?? 1) >= retriesBeforeProblem ? ['rescan', 'problem'] : ['rescan'],
      autoReturn: false,
      icon: 'alert',
    };
  if (reply.result === 'REVIEW') {
    const why = reply.reasons.flatMap((reason) => {
      const key = reviewLine[reason];
      return key ? [key] : [];
    });
    const unique = [...new Set(why)].slice(0, 2).map((key) => tr(key));
    return {
      tone: 'amber',
      title: tr('staff.result.timeSaved', { time: at }),
      lines: [...unique, tr('staff.result.managerChecks')],
      actions: reply.reasons.includes('LOCATION_OFF') ? ['home', 'settings'] : ['home'],
      autoReturn: false,
      icon: 'clock',
    };
  }
  // Green, with or without a note. A weak position never bothers anyone.
  if (reply.kind === 'OUT') {
    const worked =
      context.arrivedAt && Date.parse(reply.serverAt) >= Date.parse(context.arrivedAt)
        ? Math.round((Date.parse(reply.serverAt) - Date.parse(context.arrivedAt)) / 60000)
        : null;
    return {
      tone: 'ok',
      title: tr('staff.result.leftDone', { time: at }),
      lines: worked === null ? [] : [tr('staff.result.worked', { time: hoursWords(worked, tr) })],
      actions: ['home'],
      autoReturn: true,
      icon: 'check',
    };
  }
  const late = reply.lateMinutes ?? 0;
  return {
    tone: 'ok',
    title: tr('staff.result.cameDone', { time: at }),
    lines: late > 0 ? [tr('staff.result.late', { minutes: late })] : [],
    actions: ['home'],
    autoReturn: true,
    icon: 'check',
  };
}

/** The phone kept it, and it will go by itself. Amber, because nothing was lost. */
export function savedOutcome(tr: Tr, kind: 'offline' | 'slow'): Outcome {
  return {
    tone: 'amber',
    title: tr('staff.result.savedTitle'),
    lines: [
      tr(kind === 'offline' ? 'staff.result.savedOffline' : 'staff.result.savedSlow'),
      tr('staff.result.notSent'),
    ],
    actions: ['home'],
    autoReturn: false,
    icon: 'clock',
  };
}

const refused: Record<string, { title: MessageKey; line?: MessageKey; action?: OutcomeAction }> = {
  BAD_QR: { title: 'staff.result.notOurQr', line: 'staff.result.notOurQrLine' },
  NOT_QR: { title: 'staff.result.notOurQr', line: 'staff.result.notOurQrLine' },
  ATTENDANCE_OFF: { title: 'staff.result.hazriOff', line: 'staff.result.hazriOffLine' },
  BAD_SIGNATURE: { title: 'staff.result.phoneNotProven', line: 'staff.result.nothingSaved' },
  NOT_LINKED: {
    title: 'staff.result.notLinked',
    line: 'staff.result.notLinkedLine',
    action: 'relink',
  },
  NOT_SAVED: { title: 'staff.result.notSaved', line: 'staff.result.nothingSaved' },
};
/** Red, because nothing was saved. Always with a way forward. */
export function refusedOutcome(code: string, tr: Tr): Outcome {
  const known = refused[code] ?? {
    title: 'staff.result.notSaved' as MessageKey,
    line: 'staff.result.nothingSaved' as MessageKey,
  };
  return {
    tone: 'red',
    title: tr(known.title),
    lines: known.line ? [tr(known.line)] : [],
    actions: known.action ? [known.action] : ['rescan', 'problem'],
    autoReturn: false,
    icon: 'alert',
  };
}

/** A server's refusal of a scan. Other codes (a bad form, say) still mean nothing was saved. */
export const isRefusal = (code: string, status?: number) =>
  status !== undefined &&
  status >= 400 &&
  status < 500 &&
  status !== 401 &&
  status !== 408 &&
  status !== 429 &&
  code !== 'NOTICE_NEEDED';
