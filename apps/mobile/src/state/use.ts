import { useSyncExternalStore } from 'react';
import type { Store } from '../logic/store-core';

/** Reads one value from a store. The selector must return a primitive or an existing object. */
export function useSelect<T, S>(store: Store<T>, select: (value: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
