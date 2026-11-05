import QRCode from 'qrcode';
import { ApiError } from '../../../lib/api';
import type { WallData } from './types';

/** Asks for the next code just after this one's life ends, and never sooner than a breath apart. */
export const nextFetchIn = (msLeft: number) =>
  Math.max(Number.isFinite(msLeft) ? msLeft + 150 : 0, 500);
/** While the server cannot be reached, keeps trying without flooding it. */
export const troubleRetryMs = 5000;

export const screenGone = (error: unknown) =>
  error instanceof ApiError && (error.code === 'SCREEN_REVOKED' || error.code === 'UNAUTHORIZED');

/**
 * Keeps one wall fresh: exactly one request at a time, the next timed from what the server said is
 * left on this code. Being told the screen was turned off ends the loop; anything else is a bad
 * connection, and it keeps trying, so the shop never has to come and press anything.
 */
export function startCodeLoop(options: {
  load: () => Promise<WallData>;
  onWall: (wall: WallData) => void;
  onTrouble: (error: unknown) => void;
  onGone: (error: unknown) => void;
  isGone?: (error: unknown) => boolean;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}) {
  const {
    load,
    onWall,
    onTrouble,
    onGone,
    isGone = screenGone,
    setTimer = (run, ms) => setTimeout(run, ms),
    clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  } = options;
  let stopped = false;
  let busy = false;
  let timer: unknown = null;
  const wait = (ms: number) => {
    clearTimer(timer);
    timer = setTimer(() => void run(), ms);
  };
  const run = async () => {
    if (stopped || busy) return;
    busy = true;
    clearTimer(timer);
    try {
      const wall = await load();
      if (stopped) return;
      onWall(wall);
      wait(nextFetchIn(wall.msLeft));
    } catch (error) {
      if (stopped) return;
      if (isGone(error)) {
        stopped = true;
        onGone(error);
        return;
      }
      onTrouble(error);
      wait(troubleRetryMs);
    } finally {
      busy = false;
    }
  };
  void run();
  return {
    /** The tab woke up or the internet came back: look now, and do not wait for the timer. */
    poke: () => void run(),
    stop: () => {
      stopped = true;
      clearTimer(timer);
    },
  };
}

/** Big squares a budget camera reads from a metre away: alphanumeric mode, medium correction. */
export function qrSymbol(text: string) {
  return QRCode.create([{ data: text, mode: 'alphanumeric' }], { errorCorrectionLevel: 'M' });
}
/** The QR as one SVG path with a clear margin of four squares, so the page holds no injected HTML. */
export function qrPath(text: string) {
  const { modules } = qrSymbol(text);
  const margin = 4;
  let path = '';
  for (let y = 0; y < modules.size; y++) {
    let x = 0;
    while (x < modules.size) {
      if (!modules.get(y, x)) {
        x++;
        continue;
      }
      const from = x;
      while (x < modules.size && modules.get(y, x)) x++;
      path += `M${from + margin} ${y + margin}h${x - from}v1h-${x - from}z`;
    }
  }
  return { path, box: modules.size + margin * 2, size: modules.size };
}
