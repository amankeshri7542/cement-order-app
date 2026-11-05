import { AppState, Platform } from 'react-native';
import EventSource from 'react-native-sse';
import NetInfo from '@react-native-community/netinfo';
import { liveStream } from '../logic/live';
import { orderIdFromPush } from '../logic/nav-core';
import { listenForPushTaps } from '../platform/push';
import { API_URL, onSessionEnded, onStoreReached, setNetworkState } from './api';
import {
  forgetMyRates,
  loadSavedCatalog,
  loadSavedConfig,
  loadSavedRates,
  refreshCatalog,
  refreshConfig,
  refreshMyRates,
  refreshOffers,
} from './catalog';
import { forgetCheckout, loadCheckout } from './checkout';
import { forgetKhata, refreshKhata } from './khata';
import { adoptServerCart, clearList, loadList } from './list';
import { push } from './nav';
import { netStore } from './net';
import { forgetOrders, loadSavedOrders, refreshOrders, refreshReplies } from './orders';
import { currentUser, onAccountChange, requireSignIn, restore, sessionEnded } from './session';
import { forgetSites, loadSavedPincode, loadSavedSites, refreshSites } from './sites';
import { forgetConversation } from './ask';

/** Everything that belongs to the signed-in customer, read together. Each part fails on its own. */
export function refreshAccount() {
  if (!currentUser()) return;
  void refreshOrders();
  void refreshReplies();
  void refreshSites().catch(() => {});
  void refreshMyRates();
  void refreshKhata();
}
export function refreshEverything() {
  void refreshCatalog();
  void refreshOffers();
  refreshAccount();
}

let booted = false;
/** One start-up for the whole app. Its comments record real bugs; keep them. */
export function boot() {
  if (booted) return () => {};
  booted = true;
  const stops: (() => void)[] = [];

  // Nothing of the last person stays on screen when the account changes.
  stops.push(
    onAccountChange(({ user, before, why }) => {
      forgetOrders();
      forgetSites();
      forgetMyRates();
      forgetKhata();
      forgetCheckout(before, why === 'deleted');
      // The conversation goes when someone leaves, and stays for a guest who signs in.
      if (before) forgetConversation();
      // A shared phone: the list clears at sign-out, as the cart did.
      if (why === 'signOut' || why === 'deleted') clearList();
      if (!user) return;
      void loadSavedOrders(user.id);
      void loadSavedSites(user.id);
      void loadSavedRates(user.id);
      void loadCheckout(user.id);
      void adoptServerCart().catch(() => {});
      refreshAccount();
    }),
  );

  void loadList();
  void loadSavedPincode();
  void loadSavedConfig();
  void loadSavedCatalog();
  refreshEverything();
  void refreshConfig().catch(() => {});
  void restore().catch(() => {});

  onSessionEnded(sessionEnded);
  stops.push(() => onSessionEnded(null));

  // A push tap opens the order, also from a cold start. Sign-in comes first if it is needed. The
  // server still answers only for this customer's own orders.
  stops.push(
    listenForPushTaps((data) => {
      const id = orderIdFromPush(data);
      if (id) requireSignIn(() => push({ screen: 'order', id }));
    }),
  );

  // The live stream holds a connection only while the app is on screen.
  const live = liveStream(
    () => new EventSource(`${API_URL}/events`),
    () => {
      // Rates and order status can move on any event. An unchanged rate list costs a few bytes.
      void refreshCatalog();
      void refreshOrders();
      void refreshMyRates();
    },
  );
  live.start();
  stops.push(() => live.stop());
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      live.start();
      refreshEverything();
      void refreshConfig().catch(() => {});
    } else if (state === 'background') live.stop();
  });
  stops.push(() => appState.remove());

  // The phone's system says whether the network really reaches the internet (on old Androids that
  // falls back to a check of our own health URL, never a third party). The browser build only has
  // its online/offline events, so NetInfo's reachability check is off there.
  NetInfo.configure(
    Platform.OS === 'web'
      ? { reachabilityShouldRun: () => false }
      : {
          reachabilityUrl: `${API_URL}/health`,
          reachabilityMethod: 'GET',
          reachabilityTest: async (response) => response.status === 200,
        },
  );
  let wasUp = true;
  onStoreReached(() => {
    netStore.patch({ online: true });
    wasUp = true;
  });
  stops.push(() => onStoreReached(null));
  stops.push(
    NetInfo.addEventListener((state) => {
      const up =
        state.isConnected !== false &&
        (Platform.OS === 'web' || state.isInternetReachable !== false);
      setNetworkState(up);
      netStore.patch({ online: up });
      if (up && !wasUp) refreshEverything();
      wasUp = up;
    }),
  );
  return () => {
    booted = false;
    for (const stop of stops) stop();
  };
}
