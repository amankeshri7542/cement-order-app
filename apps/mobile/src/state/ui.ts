import { createStore } from '../logic/store-core';

export type Toast = { text: string; undo?: () => void; id: number };
export const uiStore = createStore<{ toast: Toast | null }>({ toast: null });

let counter = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
/** One short message at a time. It clears by itself; an Undo stays a little longer. */
export function showToast(text: string, undo?: () => void) {
  clearTimeout(timer);
  uiStore.set({ toast: { text, undo, id: ++counter } });
  timer = setTimeout(() => uiStore.set({ toast: null }), undo ? 6000 : 4000);
}
export function hideToast() {
  clearTimeout(timer);
  uiStore.set({ toast: null });
}
