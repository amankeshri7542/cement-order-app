import type { User } from '@shiv/shared';
import { dismissNotifications, pushKeys, refreshPushToken } from '../platform/push';
import { createStore } from '../logic/store-core';
import { w } from '../words';
import { api, cannotReach, clearLocalSession, logout, restoreSession } from './api';
import { clearCache, isPrivateKey } from './cache';
import { closeSheet, openSheet, resetNav } from './nav';
import { say } from './net';
import { readSaved, writeSaved } from './saved';
import { showToast } from './ui';

export const sessionStore = createStore<{ user: User | null; checked: boolean }>({
  user: null,
  checked: false,
});
export const currentUser = () => sessionStore.get().user;

export type AccountChange = {
  user: User | null;
  /** Who was here before, if anyone. */
  before: User | null;
  /** signOut and deleted empty the phone. An ended session keeps the list: it was only a list. */
  why: 'signIn' | 'signOut' | 'deleted' | 'ended';
};
/** Called when the person on this phone changes, so nothing of the last one stays on screen. */
const watchers = new Set<(change: AccountChange) => void>();
export function onAccountChange(listener: (change: AccountChange) => void) {
  watchers.add(listener);
  return () => {
    watchers.delete(listener);
  };
}
export function setUser(next: User | null, why: AccountChange['why'] = 'signIn') {
  const before = sessionStore.get().user;
  sessionStore.patch({ user: next, checked: true });
  if (before?.id !== next?.id)
    for (const watcher of [...watchers]) watcher({ user: next, before, why });
}

// Set while the saved sign-in could not be checked (no signal at launch). The phone keeps it and
// checks again on return to the app, on reconnect and before a signed-in screen.
let sessionUnknown = false;
let restoring: Promise<User | null | 'offline'> | null = null;
export function restore() {
  restoring ??= restoreSession()
    .then(async (found) => {
      sessionUnknown = found === 'offline';
      if (found === 'offline') sessionStore.patch({ checked: true });
      else if (found && !currentUser()) await completeLogin(found);
      else if (!found) {
        // Ended elsewhere, or the account was deleted: what this phone saved of them goes too.
        void clearCache(isPrivateKey);
        sessionStore.patch({ checked: true });
      }
      return found;
    })
    .finally(() => {
      restoring = null;
    });
  return restoring;
}
export const retryRestoreIfUnknown = () => {
  if (sessionUnknown) void restore().catch(() => {});
};

/** What to do once sign-in finishes: place the order, open the page they asked for. */
let afterSignIn: (() => void) | null = null;
/** Runs `then` for a signed-in customer; otherwise asks for sign-in at this moment, and only now. */
export function requireSignIn(then: () => void) {
  if (currentUser()) {
    then();
    return;
  }
  afterSignIn = then;
  if (sessionUnknown) {
    void restore()
      .then((found) => {
        if (found === 'offline') showToast(say(cannotReach()));
      })
      .catch((error) => showToast(say(error)));
    return;
  }
  openSheet({ sheet: 'sign-in' });
}
export const cancelSignIn = () => {
  afterSignIn = null;
};

export async function completeLogin(user: User) {
  sessionUnknown = false;
  setUser(user);
  closeSheet('sign-in');
  // Messages and notifications follow the app, which is in plain English.
  if (user.language !== 'en')
    void api('/me', 'PATCH', { language: 'en' })
      .then(() => {
        const current = currentUser();
        if (current?.id === user.id) sessionStore.patch({ user: { ...current, language: 'en' } });
      })
      .catch(() => {});
  // A customer who turned notifications on keeps getting them: the token can change over time.
  if (user.role !== 'ADMIN')
    void readSaved<boolean>(pushKeys.on(user.id)).then((chosen) => {
      if (chosen === true) void refreshPushToken();
    });
  const then = afterSignIn;
  afterSignIn = null;
  then?.();
}

export async function signOut() {
  // On a phone this forgets the session at once, even with no signal.
  await logout();
  void dismissNotifications();
  sessionUnknown = false;
  afterSignIn = null;
  await clearCache(isPrivateKey);
  setUser(null, 'signOut');
  resetNav();
}

/** After account deletion nothing of the account stays on the phone. */
export async function forgetAccount() {
  const id = currentUser()?.id;
  await clearLocalSession();
  afterSignIn = null;
  await clearCache(isPrivateKey);
  if (id)
    await Promise.all([
      writeSaved(pushKeys.asked(id), null),
      writeSaved(pushKeys.on(id), null),
    ]).catch(() => {});
  setUser(null, 'deleted');
  resetNav();
}

export function sessionEnded() {
  if (!currentUser()) return;
  void clearCache(isPrivateKey);
  setUser(null, 'ended');
  showToast(w('session.ended'));
}
