import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';
import type { TabKey } from './logic/kaam';

/**
 * Small on purpose: one tab showing, and a stack of screens over it. No router package, so a cold
 * start on a budget phone loads as little as possible. The hardware back button pops the stack.
 */
export type Route = { name: string; params?: Record<string, unknown> };
type Nav = {
  tab: TabKey;
  setTab(tab: TabKey): void;
  stack: Route[];
  push(name: string, params?: Record<string, unknown>): void;
  replace(name: string, params?: Record<string, unknown>): void;
  pop(): void;
  home(): void;
};
const NavContext = createContext<Nav | null>(null);
export function useNav() {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('No navigation here');
  return nav;
}
export function NavProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<TabKey>('hazri');
  const [stack, setStack] = useState<Route[]>([]);
  const nav = useMemo<Nav>(
    () => ({
      tab,
      stack,
      setTab: (next) => {
        setStack([]);
        setTab(next);
      },
      push: (name, params) => setStack((now) => [...now, { name, ...(params ? { params } : {}) }]),
      replace: (name, params) =>
        setStack((now) => [...now.slice(0, -1), { name, ...(params ? { params } : {}) }]),
      pop: () => setStack((now) => now.slice(0, -1)),
      home: () => setStack([]),
    }),
    [tab, stack],
  );
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length) {
        nav.pop();
        return true;
      }
      if (tab !== 'hazri') {
        nav.setTab('hazri');
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [nav, stack.length, tab]);
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}
