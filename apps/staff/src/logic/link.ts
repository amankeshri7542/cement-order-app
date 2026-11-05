import { localPhone } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';

export type LinkState = {
  device: { id: string; status: string };
  request: {
    kind: 'FIRST' | 'CHANGE';
    status: string;
    qrScannedAt: string | null;
    createdAt: string;
  } | null;
  noticeVersion: number;
  noticeAccepted: boolean;
  user: { id: string; name: string };
};

export type LinkStage = 'NOTICE' | 'WAITING' | 'NEW_PHONE' | 'READY';
/** The notice comes first for everyone. A hazri cannot go in until it has been read. */
export function linkStage(link: LinkState): LinkStage {
  if (!link.noticeAccepted) return 'NOTICE';
  if (link.device.status === 'ACTIVE') return 'READY';
  return link.request?.kind === 'CHANGE' ? 'NEW_PHONE' : 'WAITING';
}

/** "+91" and ten digits, or nothing. Exactly what the server will accept. */
export function fullPhone(typed: string): string | null {
  // Exactly ten: cutting a longer one short could send someone else the code.
  const digits = localPhone(typed).replace(/\D/g, '');
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}
export const validCode = (code: string) => /^\d{6}$/.test(code);

/** A cut-off phone is told the same thing whether it was refused or stopped; the app knows which. */
export const revokedScreen = (wasWaiting: boolean) => (wasWaiting ? 'REFUSED' : 'CUT_OFF');

const signInErrors: Record<string, MessageKey> = {
  RATE_LIMITED: 'staff.link.errRateLimit',
  OTP_UNAVAILABLE: 'staff.link.errUnavailable',
  INVALID_OTP: 'staff.link.errCode',
  NOT_STAFF: 'staff.link.errNotStaff',
  DEVICE_TAKEN: 'staff.link.errTaken',
  BAD_SIGNATURE: 'staff.link.errPhone',
  INVALID_INPUT: 'staff.link.errNumber',
  NETWORK: 'staff.common.noSignal',
};
export const signInError = (code: string): MessageKey =>
  signInErrors[code] ?? 'staff.common.tryAgain';
/** An OTP limit means waiting, not trying harder, so no retry button is offered during it. */
export const mustWait = (code: string) => code === 'RATE_LIMITED' || code === 'OTP_UNAVAILABLE';
