import type { Order, Page, Quote } from '@shiv/shared';
import { createStore } from '../logic/store-core';
import { api, getWithRetry } from './api';
import { cacheKeys, readCache, writeCache } from './cache';
import { say } from './net';
import { currentUser } from './session';

type OrdersState = {
  items: Order[];
  /** Whether this account's orders were read at least once. */
  known: boolean;
  savedAt: number | null;
  nextCursor: string | null;
  loading: boolean;
  error: string;
  byId: Record<string, Order>;
  replies: Quote[];
};
const empty = (): OrdersState => ({
  items: [],
  known: false,
  savedAt: null,
  nextCursor: null,
  loading: false,
  error: '',
  byId: {},
  replies: [],
});
export const ordersStore = createStore<OrdersState>(empty());

const indexed = (old: Record<string, Order>, orders: Order[]) => ({
  ...old,
  ...Object.fromEntries(orders.map((order) => [order.id, order])),
});
export function rememberOrder(order: Order) {
  ordersStore.set((old) => ({
    ...old,
    byId: indexed(old.byId, [order]),
    items: old.items.some((item) => item.id === order.id)
      ? old.items.map((item) => (item.id === order.id ? order : item))
      : [order, ...old.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  }));
}

let request = 0;
/** One read of 24 orders feeds Home and Orders, kept in the cache that already exists. */
export async function refreshOrders() {
  const user = currentUser();
  if (!user) return;
  const current = ++request;
  ordersStore.patch({ loading: true });
  try {
    const page = await getWithRetry<Page<Order>>('/orders?limit=24');
    if (current !== request || currentUser()?.id !== user.id) return;
    void writeCache(cacheKeys.orders(user.id), page.items);
    ordersStore.set((old) => ({
      ...old,
      items: page.items,
      byId: indexed(old.byId, page.items),
      nextCursor: page.nextCursor,
      known: true,
      savedAt: null,
      loading: false,
      error: '',
    }));
  } catch (error) {
    if (current === request) ordersStore.patch({ loading: false, error: say(error) });
  }
}
export async function loadMoreOrders() {
  const { nextCursor } = ordersStore.get();
  if (!nextCursor) return;
  try {
    const page = await api<Page<Order>>(
      `/orders?limit=24&cursor=${encodeURIComponent(nextCursor)}`,
    );
    ordersStore.set((old) => ({
      ...old,
      items: [...new Map([...old.items, ...page.items].map((order) => [order.id, order])).values()],
      byId: indexed(old.byId, page.items),
      nextCursor: page.nextCursor,
    }));
  } catch (error) {
    ordersStore.patch({ error: say(error) });
  }
}
/** Saved orders draw the repeat Home at once, on any connection. */
export async function loadSavedOrders(userId: string) {
  const saved = await readCache<Order[]>(cacheKeys.orders(userId));
  if (currentUser()?.id !== userId || ordersStore.get().known) return;
  if (!Array.isArray(saved?.data)) return;
  ordersStore.set((old) => ({
    ...old,
    items: saved.data,
    byId: indexed(old.byId, saved.data),
    savedAt: saved.savedAt,
    known: saved.data.length > 0,
  }));
}
export const forgetOrders = () => {
  request++;
  ordersStore.set(empty());
};

/** Lists sent to the shop and its replies. They live at the top of Orders until answered. */
export async function refreshReplies() {
  if (!currentUser()) return;
  try {
    const page = await getWithRetry<Page<Quote>>('/quotes?limit=24');
    ordersStore.patch({ replies: page.items });
  } catch {
    // Orders still show; the next refresh tries again.
  }
}
