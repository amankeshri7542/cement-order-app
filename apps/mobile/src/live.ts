// Keeps the store's live update stream open across network drops and app switches. Plain logic
// with no React Native imports, so it is unit-tested under Node (test/live.test.mjs).

/** Waits before reopening after a drop: quick at first, then calmer so a dead network costs little. */
export const reconnectDelays = [2000, 5000, 15000, 30000];
/** The store sends a heartbeat every 25 s; this long with nothing means the stream silently died. */
export const silenceLimit = 60000;
/** A burst of store events (an order rush, a rate edit) causes one refresh, not one per event. */
export const refreshDelay = 1500;

type LiveEvent = { type: string; data?: string | null };
export type LiveSource = {
  addEventListener(type: 'open' | 'message' | 'error', listener: (event: LiveEvent) => void): void;
  close(): void;
};

export function liveStream(connect: () => LiveSource, refresh: () => void) {
  let source: LiveSource | null = null;
  let failures = 0;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    // Not reset by later events, so a steady trickle still refreshes every 1.5 s at most.
    pending ??= setTimeout(() => {
      pending = undefined;
      refresh();
    }, refreshDelay);
  }
  function alive() {
    clearTimeout(watchdog);
    watchdog = setTimeout(drop, silenceLimit);
  }
  function drop() {
    const old = source;
    source = null;
    clearTimeout(watchdog);
    // Closed on the next tick: the library may still be inside its own error handling.
    if (old) setTimeout(() => old.close(), 0);
    clearTimeout(reconnect);
    reconnect = setTimeout(open, reconnectDelays[Math.min(failures++, reconnectDelays.length - 1)]);
  }
  function open() {
    reconnect = undefined;
    const current = connect();
    source = current;
    alive();
    current.addEventListener('open', () => {
      if (source !== current) return;
      failures = 0;
      alive();
      // Catch up on anything missed while the stream was closed.
      schedule();
    });
    current.addEventListener('message', (event) => {
      if (source !== current) return;
      alive();
      if (event.data && !event.data.includes('HEARTBEAT')) schedule();
    });
    current.addEventListener('error', () => {
      if (source === current) drop();
    });
  }
  return {
    /** Opens the stream, or reopens it now if it is waiting to retry. */
    start() {
      if (source) return;
      clearTimeout(reconnect);
      failures = 0;
      open();
    },
    /** Closes the stream (the app went to the background or unmounted). */
    stop() {
      clearTimeout(reconnect);
      clearTimeout(watchdog);
      clearTimeout(pending);
      reconnect = watchdog = pending = undefined;
      source?.close();
      source = null;
    },
  };
}
