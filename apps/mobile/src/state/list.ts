import { tap } from '../platform/haptics';
import {
  addLine,
  cleanSaved,
  quantities,
  restoreLine,
  roughTotal,
  setLine,
  withoutPlaced,
  type ListLine,
} from '../logic/list-core';
import { rateToShow } from '../logic/rates';
import { createStore } from '../logic/store-core';
import type { CatalogProduct } from '../logic/types';
import { w } from '../words';
import { api } from './api';
import { catalogStore } from './catalog';
import { readSaved, writeSaved } from './saved';
import { showToast } from './ui';

const listKey = 'shiv_list_v1';

/** One value per row, so an Add re-renders that row and the bar and nothing else. */
export const listStore = createStore<{
  lines: ListLine[];
  quantity: Record<string, number>;
  loaded: boolean;
}>({ lines: [], quantity: {}, loaded: false });

let tail: Promise<unknown> = Promise.resolve();
function commit(lines: ListLine[]) {
  listStore.patch({ lines, quantity: quantities(lines) });
  // Written in order, so a fast thumb never leaves an older list on the phone.
  tail = tail
    .catch(() => {})
    .then(() => writeSaved(listKey, lines.length ? lines : null))
    .catch(() => showToast(w('list.notSaved')));
}

let reading: Promise<void> | null = null;
export const loadList = () => (reading ??= readList());
async function readList() {
  const lines = cleanSaved(await readSaved(listKey));
  // Anything already added while storage was being read stays.
  const added = listStore.get().lines;
  listStore.patch({
    lines: added.length ? added : lines,
    quantity: quantities(added.length ? added : lines),
    loaded: true,
  });
}

/** Add never waits for a network and works with no signal. */
export function addToList(product: CatalogProduct) {
  const mine = catalogStore.get().myRates[product.id];
  const next = addLine(listStore.get().lines, product, rateToShow(product, mine).paise);
  if (!next) {
    showToast(w('list.full'));
    return;
  }
  tap();
  commit(next);
}

export function setQuantity(productId: string, quantity: number) {
  commit(setLine(listStore.get().lines, productId, quantity));
}

/** Takes a line off, with a moment to change your mind. */
export function removeFromList(productId: string) {
  const lines = listStore.get().lines;
  const index = lines.findIndex((line) => line.productId === productId);
  const line = lines[index];
  if (!line) return;
  commit(lines.filter((item) => item !== line));
  showToast(w('list.removed'), () => commit(restoreLine(listStore.get().lines, line, index)));
}

export const clearList = () => commit([]);
export const takePlaced = (placed: { productId: string; quantity: number }[]) =>
  commit(withoutPlaced(listStore.get().lines, placed));

/**
 * At sign-in: if this phone has no list and the website left one on the account, the phone takes
 * those lines and empties the server's copy. A list on the phone is never mixed with it.
 */
export async function adoptServerCart() {
  await loadList();
  if (listStore.get().lines.length) return;
  const cart = await api<{ productId: string; quantity: number }[]>('/cart');
  if (!cart.length || listStore.get().lines.length) return;
  commit(cleanSaved(cart.map(({ productId, quantity }) => ({ productId, quantity }))));
  await Promise.all(
    cart.map(({ productId }) => api('/cart/items', 'PUT', { productId, quantity: 0 })),
  );
}

/** The bar's numbers, worked out from the rates on this phone. */
export function listSummary(lines: ListLine[]) {
  const { byId, myRates } = catalogStore.get();
  return roughTotal(lines, (id) => {
    const product = byId[id];
    return product ? rateToShow(product, myRates[id]).paise : null;
  });
}
