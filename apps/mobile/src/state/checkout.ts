import type { CheckoutReview, Order } from '@shiv/shared';
import { isCheckoutRefusal, istToday } from '@shiv/shared';
import { dayAfter } from '../logic/panel-core';
import { createStore } from '../logic/store-core';
import { ApiError, api } from './api';
import { takePlaced } from './list';
import { rememberOrder, refreshOrders } from './orders';
import { readSaved, writeSaved } from './saved';
import { currentUser } from './session';

export type Pending = {
  reviewId: string;
  idempotencyKey: string;
  totalPaise: number;
  /** Set when these lines came off the customer's list, so they come off once it is placed. */
  fromList?: { productId: string; quantity: number }[];
};
type Draft = { addressId: string; date: string; notes: string };

const newDraft = (): Draft => ({ addressId: '', date: dayAfter(istToday()), notes: '' });
export const checkoutStore = createStore<{
  draft: Draft;
  pending: Pending | null;
  loaded: boolean;
  /** The site chosen in the open panel. A repeat never moves the customer's usual site. */
  panelSite: string | null;
}>({
  draft: newDraft(),
  pending: null,
  loaded: false,
  panelSite: null,
});

const keyFor = (id: string) => `shiv_draft_${id}`;
let tail: Promise<unknown> = Promise.resolve();
function save() {
  const id = currentUser()?.id;
  if (!id) return Promise.resolve();
  const { draft, pending } = checkoutStore.get();
  tail = tail.catch(() => {}).then(() => writeSaved(keyFor(id), { draft, pending }));
  return tail;
}

/** A saved request from before is read back for this person alone. */
export async function loadCheckout(userId: string) {
  const saved = await readSaved<{ draft?: Partial<Draft>; pending?: Pending | null }>(
    keyFor(userId),
  );
  if (currentUser()?.id !== userId) return;
  const draft = { ...newDraft(), ...saved?.draft };
  // A saved day in the past would only fail at review; move it to the default.
  if (draft.date <= istToday()) draft.date = newDraft().date;
  checkoutStore.patch({ draft, pending: saved?.pending ?? null, loaded: true });
}
/**
 * The person changed. Only what is needed to check a request still unknown stays on the phone, under
 * their own id, where another person cannot read it; a deleted account leaves nothing at all.
 */
export function forgetCheckout(before: { id: string } | null, wipe = false) {
  const { pending } = checkoutStore.get();
  if (before)
    tail = tail
      .catch(() => {})
      .then(() => writeSaved(keyFor(before.id), pending && !wipe ? { pending } : null))
      .catch(() => {});
  checkoutStore.set({ draft: newDraft(), pending: null, loaded: false, panelSite: null });
}
export function updateDraft(part: Partial<Draft>) {
  checkoutStore.patch({ draft: { ...checkoutStore.get().draft, ...part } });
  void save().catch(() => {});
}

export type PlaceResult =
  | { kind: 'placed'; order: Order }
  /** The shop refused it: nothing was placed, and the customer sees why and a new total. */
  | { kind: 'refused'; error: ApiError }
  /** The reply was lost. The same key is kept; checking cannot make a second order. */
  | { kind: 'unknown'; error: unknown };

async function send(submission: Pending): Promise<PlaceResult> {
  try {
    const order = await api<Order>('/orders', 'POST', {
      reviewId: submission.reviewId,
      idempotencyKey: submission.idempotencyKey,
    });
    rememberOrder(order);
    checkoutStore.patch({ pending: null });
    if (submission.fromList) takePlaced(submission.fromList);
    void save().catch(() => {});
    void refreshOrders();
    return { kind: 'placed', order };
  } catch (error) {
    if (error instanceof ApiError && isCheckoutRefusal(error.code)) {
      checkoutStore.patch({ pending: null });
      await save().catch(() => {});
      return { kind: 'refused', error };
    }
    return { kind: 'unknown', error };
  }
}

/**
 * Exactly once: the request and its key are saved on the phone before anything is sent, so a
 * connection lost as Place is tapped can be checked with the same key and never makes a second order.
 */
export async function placeReviewed(
  review: Pick<CheckoutReview, 'id' | 'totalPaise'>,
  key: string,
  fromList?: { productId: string; quantity: number }[],
): Promise<PlaceResult> {
  const { pending } = checkoutStore.get();
  // An earlier request not yet known is checked first; a new one never goes over it.
  if (pending) return send(pending);
  const submission: Pending = {
    reviewId: review.id,
    idempotencyKey: key,
    totalPaise: review.totalPaise,
    ...(fromList ? { fromList } : {}),
  };
  checkoutStore.patch({ pending: submission });
  try {
    await save();
  } catch (error) {
    // Unsaved means unsafe: nothing has been sent, so nothing can be lost.
    checkoutStore.patch({ pending: null });
    return { kind: 'unknown', error };
  }
  return send(submission);
}

/** "Not sure this reached us. Check." Sends the same request; it cannot make a second order. */
export async function checkPending(): Promise<PlaceResult | null> {
  const { pending } = checkoutStore.get();
  return pending ? send(pending) : null;
}
