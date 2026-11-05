// The one list. Kept in this browser, with no sign-in, no zod and no API call: only /list asks the
// server anything. Adding never says no, because a refusal here could reveal how much the shop has.
export type ListLine = {
  /** Product id. */
  i: string;
  /** Name. */
  n: string;
  /** Unit in plain words: "a bori (50 kg)". */
  u: string;
  /** Minimum and step. */
  m: number;
  s: number;
  /** Rate in paise when added. Null for an item with no public rate. */
  r: number | null;
  /** Product page. */
  h: string;
  /** Quantity. */
  q: number;
};
export type ListInput = Omit<ListLine, 'q'>;
export type ListHint = { owner: string; lines: Record<string, number> };
export type ListState = { lines: ListLine[]; hint: ListHint | null };

export const MAX_LINES = 50;
export const MAX_QTY = 10000;
const KEY = 'shiv_list_v1';
const EMPTY: ListState = { lines: [], hint: null };

const whole = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;
const shortText = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= limit;
/** Only a page on this site: stored data must never become a javascript: or outside link. */
const ownPath = (value: unknown): value is string =>
  typeof value === 'string' && /^\/(materials\/[a-z0-9_-]+|products)\/[a-zA-Z0-9_-]+$/.test(value);

/** Whatever was stored, or sent by a tampered page: bad lines drop out, good ones stay. */
export function validInput(raw: unknown): ListInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (
    !shortText(value.i, 100) ||
    !shortText(value.n, 200) ||
    !shortText(value.u, 100) ||
    !whole(value.m, 1, MAX_QTY) ||
    !whole(value.s, 1, MAX_QTY) ||
    !(value.r === null || whole(value.r, 1, 2_000_000_000)) ||
    !ownPath(value.h)
  )
    return null;
  return { i: value.i, n: value.n, u: value.u, m: value.m, s: value.s, r: value.r, h: value.h };
}
export function parseState(text: string | null): ListState {
  if (!text) return EMPTY;
  try {
    const raw = JSON.parse(text) as { lines?: unknown; hint?: unknown };
    const seen = new Set<string>();
    const lines: ListLine[] = [];
    for (const item of Array.isArray(raw.lines) ? raw.lines : []) {
      const input = validInput(item);
      if (!input) continue;
      const qty = (item as { q?: unknown }).q;
      if (!whole(qty, 1, MAX_QTY) || seen.has(input.i)) continue;
      seen.add(input.i);
      if (lines.length < MAX_LINES) lines.push({ ...input, q: qty });
    }
    const hint = raw.hint as ListHint | null | undefined;
    const goodHint =
      hint &&
      typeof hint.owner === 'string' &&
      hint.lines &&
      typeof hint.lines === 'object' &&
      Object.values(hint.lines).every((value) => whole(value, 0, MAX_QTY))
        ? { owner: hint.owner, lines: hint.lines }
        : null;
    return lines.length || goodHint ? { lines, hint: goodHint } : EMPTY;
  } catch {
    return EMPTY;
  }
}

// Same rules as the API (apps/api/src/inventory.ts): at least the minimum, a multiple of the step.
export function roundUp(line: Pick<ListLine, 'm' | 's'>, value: number) {
  return Math.ceil(Math.max(value, line.m) / line.s) * line.s;
}
export const stepUp = (line: Pick<ListLine, 'm' | 's'>, value: number) =>
  Math.min(roundUp(line, value + line.s), Math.floor(MAX_QTY / line.s) * line.s);
/** 0 means take the line off the list. */
export function stepDown(line: Pick<ListLine, 'm' | 's'>, value: number) {
  const next = value - line.s;
  return next < line.m ? 0 : next;
}

let state: ListState | null = null;
const listeners = new Set<() => void>();
const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
function read(): ListState {
  if (state) return state;
  if (typeof window === 'undefined') return EMPTY;
  try {
    state = parseState(storage()?.getItem(KEY) ?? null);
  } catch {
    state = EMPTY;
  }
  return state;
}
function write(next: ListState) {
  state = next;
  try {
    // A phone with full or blocked storage keeps the list for this visit.
    if (next.lines.length || next.hint) storage()?.setItem(KEY, JSON.stringify(next));
    else storage()?.removeItem(KEY);
  } catch {
    /* Nothing to do. */
  }
  listeners.forEach((listener) => listener());
}
export const list = {
  snapshot: read,
  server: () => EMPTY,
  subscribe(listener: () => void) {
    if (!listeners.size && typeof window !== 'undefined')
      window.addEventListener('storage', onStorage);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size && typeof window !== 'undefined')
        window.removeEventListener('storage', onStorage);
    };
  },
  quantityOf: (id: string) => read().lines.find((line) => line.i === id)?.q ?? 0,
  /** Sets one line. 0 removes it. Returns false only when the list already holds 50 lines. */
  set(input: ListInput, quantity: number) {
    const current = read();
    const others = current.lines.filter((line) => line.i !== input.i);
    if (quantity <= 0) {
      write({ ...current, lines: others });
      return true;
    }
    const existing = current.lines.find((line) => line.i === input.i);
    if (!existing && current.lines.length >= MAX_LINES) return false;
    const q = Math.min(roundUp(input, quantity), MAX_QTY);
    const line = { ...input, q };
    write({
      ...current,
      lines: existing
        ? current.lines.map((item) => (item.i === input.i ? line : item))
        : [...current.lines, line],
    });
    return true;
  },
  add(input: ListInput) {
    return list.set(input, list.quantityOf(input.i) || input.m);
  },
  /** Add's second tap takes it off again, as the button says "Added". */
  toggle(input: ListInput) {
    return list.quantityOf(input.i) ? list.set(input, 0) : list.add(input);
  },
  step(input: ListInput, direction: 1 | -1) {
    const now = list.quantityOf(input.i);
    return list.set(input, direction > 0 ? stepUp(input, now) : stepDown(input, now));
  },
  replace(lines: ListLine[], hint: ListHint | null) {
    write({ lines, hint });
  },
  clear() {
    write({ lines: [], hint: read().hint ? { ...read().hint!, lines: {} } : null });
  },
  /** On signing out: this person's list and hint leave a shared phone. */
  forget() {
    write(EMPTY);
  },
};
function onStorage(event: StorageEvent) {
  if (event.key !== KEY && event.key !== null) return;
  state = null;
  listeners.forEach((listener) => listener());
}

/**
 * Joins this browser's list with the account's cart, without double counting.
 * Only quantities the customer can see count: a line on the cart this browser has never seen
 * (added on another phone) joins the list; a line this browser synced and the customer then took
 * off stays off. The result says exactly what to send with PUT /cart/items, which is absolute.
 */
export function reconcile(
  local: ListLine[],
  hint: ListHint | null,
  owner: string,
  cart: { id: string; quantity: number; input: ListInput }[],
) {
  const known = hint && hint.owner === owner ? hint.lines : {};
  const lines = [...local];
  for (const row of cart) {
    if (lines.some((line) => line.i === row.id) || row.id in known) continue;
    if (lines.length < MAX_LINES) lines.push({ ...row.input, q: row.quantity });
  }
  const puts: { productId: string; quantity: number }[] = [];
  for (const line of lines) {
    const onCart = cart.find((row) => row.id === line.i)?.quantity ?? 0;
    if (onCart !== line.q) puts.push({ productId: line.i, quantity: line.q });
  }
  for (const row of cart)
    if (!lines.some((line) => line.i === row.id)) puts.push({ productId: row.id, quantity: 0 });
  return { lines, puts };
}

/**
 * Lines a request just asked about, taken off a list. A line changed or added since the request was
 * first sent stays, so recovering a lost answer never costs the customer a list built since.
 */
export function withoutAsked(lines: ListLine[], asked: { productId: string; quantity: number }[]) {
  return lines.filter(
    (line) => !asked.some((item) => item.productId === line.i && item.quantity === line.q),
  );
}

/** The first tap is never lost: the inline head script queues taps until this runs. */
export type QueuedTap = { line: string | null; step: number | null };
export const readLine = (text: string | null): ListInput | null => {
  try {
    return validInput(JSON.parse(text ?? 'null'));
  } catch {
    return null;
  }
};
export function drain(queue: QueuedTap[]) {
  let done = 0;
  for (const tap of queue.splice(0)) {
    const input = readLine(tap.line);
    if (!input) continue;
    if (tap.step === null) list.add(input);
    else list.step(input, tap.step > 0 ? 1 : -1);
    done++;
  }
  return done;
}
/** A stored sign-in hint decides if a public page may ask for this customer's own rates. */
export const SIGNED_IN_KEY = 'shiv_signed_in_v1';
