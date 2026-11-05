// A small store read through selectors, with no dependency. A component subscribes to the one value
// it reads, so an Add re-renders that row and the list bar, not the screen (measured: the old single
// context re-rendered every row on every change). Plain logic, unit-tested under Node.

export type Store<T> = {
  get: () => T;
  set: (next: T | ((old: T) => T)) => void;
  patch: (part: Partial<T>) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createStore<T extends object>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const set: Store<T>['set'] = (next) => {
    const fresh = typeof next === 'function' ? (next as (old: T) => T)(value) : next;
    if (Object.is(fresh, value)) return;
    value = fresh;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => value,
    set,
    patch: (part) => set((old) => ({ ...old, ...part })),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
