import { Platform } from 'react-native';
import {
  backFrom,
  closeSheet as closed,
  hashFromNav,
  navFromHash,
  openSheet as opened,
  openTab as tabbed,
  pushRoute,
  startNav,
  type Route,
  type SheetRoute,
  type Tab,
} from '../logic/nav-core';
import { createStore } from '../logic/store-core';

export const navStore = createStore(
  Platform.OS === 'web' && typeof location !== 'undefined'
    ? navFromHash(location.hash)
    : startNav(),
);

// The browser test build keeps its address in step, so a link opens the same place and Back works.
function syncAddress(replace = false) {
  if (Platform.OS !== 'web') return;
  const hash = hashFromNav(navStore.get());
  if (hash === location.hash || (hash === '#/' && !location.hash)) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', hash);
}
if (Platform.OS === 'web')
  window.addEventListener('popstate', () => {
    navStore.set({ ...navFromHash(location.hash), sheets: [] });
  });

export const goToTab = (tab: Tab) => {
  navStore.set((nav) => tabbed(nav, tab));
  syncAddress();
};
export const push = (route: Route) => {
  navStore.set((nav) => pushRoute(nav, route));
  syncAddress();
};
export const openSheet = (sheet: SheetRoute) => navStore.set((nav) => opened(nav, sheet));
export const closeSheet = (sheet?: SheetRoute['sheet']) =>
  navStore.set((nav) => closed(nav, sheet));

/** False when there is nowhere to go back to, and Android may leave the app. */
export function back(): boolean {
  const next = backFrom(navStore.get());
  if (!next) return false;
  navStore.set(next);
  syncAddress(true);
  return true;
}
/** Everything open goes: used when the account changes. */
export function resetNav() {
  navStore.set(startNav());
  syncAddress(true);
}
