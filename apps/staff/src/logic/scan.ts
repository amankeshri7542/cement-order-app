import { isShopQr } from './capture';

/**
 * One scan, from the camera opening to the answer. The camera fires many times a second for the
 * same code, and an offline scan can be answered long after the screen has moved on, so this one
 * place decides what each event means. Anything that does not fit the current step is ignored.
 */
export type ScanState =
  | { step: 'looking'; retries: number }
  | { step: 'saving'; qr: string; retries: number }
  | { step: 'sending'; captureId: string; qr: string; retries: number }
  | { step: 'shown'; captureId: string | null; shown: ScanShown; retries: number };
export type ScanShown =
  | { kind: 'answered'; reply: unknown }
  | { kind: 'saved'; why: 'offline' | 'slow' }
  | { kind: 'refused'; code: string };

export type ScanEvent =
  | { type: 'CODE'; text: string }
  | { type: 'SAVED'; captureId: string }
  | { type: 'SAVE_FAILED' }
  | { type: 'ANSWER'; captureId: string; reply: unknown; result: string | null }
  | { type: 'REFUSED'; captureId: string; code: string }
  | { type: 'NO_SIGNAL'; captureId: string }
  | { type: 'TIMER'; captureId: string }
  | { type: 'AGAIN' };

export const scanStart: ScanState = { step: 'looking', retries: 0 };
/** How long a slow network may keep someone waiting before the phone says it has kept the scan. */
export const slowAfterMs = 8000;

export function scanStep(state: ScanState, event: ScanEvent): ScanState {
  switch (event.type) {
    case 'CODE':
      // The lock: only the first read counts. Everything after it waits for AGAIN.
      if (state.step !== 'looking') return state;
      if (!isShopQr(event.text))
        return {
          step: 'shown',
          captureId: null,
          shown: { kind: 'refused', code: 'NOT_QR' },
          retries: state.retries,
        };
      return { step: 'saving', qr: event.text, retries: state.retries };
    case 'SAVED':
      if (state.step !== 'saving') return state;
      return {
        step: 'sending',
        captureId: event.captureId,
        qr: state.qr,
        retries: state.retries,
      };
    case 'SAVE_FAILED':
      if (state.step !== 'saving' && state.step !== 'sending') return state;
      return {
        step: 'shown',
        captureId: null,
        shown: { kind: 'refused', code: 'NOT_SAVED' },
        retries: state.retries,
      };
    case 'ANSWER': {
      if (!mine(state, event.captureId)) return state;
      // Stale codes count up in a row; any other answer ends the run.
      const retries = event.result === 'RETRY' ? state.retries + 1 : 0;
      return {
        step: 'shown',
        captureId: event.captureId,
        shown: { kind: 'answered', reply: event.reply },
        retries,
      };
    }
    case 'REFUSED':
      if (!mine(state, event.captureId)) return state;
      return {
        step: 'shown',
        captureId: event.captureId,
        shown: { kind: 'refused', code: event.code },
        retries: state.retries,
      };
    case 'NO_SIGNAL':
      if (state.step !== 'sending' || state.captureId !== event.captureId) return state;
      return {
        step: 'shown',
        captureId: event.captureId,
        shown: { kind: 'saved', why: 'offline' },
        retries: state.retries,
      };
    case 'TIMER':
      if (state.step !== 'sending' || state.captureId !== event.captureId) return state;
      return {
        step: 'shown',
        captureId: event.captureId,
        shown: { kind: 'saved', why: 'slow' },
        retries: state.retries,
      };
    case 'AGAIN':
      return { step: 'looking', retries: state.retries };
  }
}
/**
 * The answer to the scan on this screen. It may arrive after "saved" was already showing, and then
 * it replaces it: the person should see what really happened.
 */
function mine(state: ScanState, captureId: string) {
  if (state.step === 'sending') return state.captureId === captureId;
  return state.step === 'shown' && state.captureId === captureId && state.shown.kind === 'saved';
}
export const scanLocked = (state: ScanState) => state.step !== 'looking';
