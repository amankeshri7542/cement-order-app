'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CartLine, User } from '@shiv/shared';
import { ASK_DEVICE_KEY } from '../../lib/ask-words';
import { customerApi, CustomerError, errorText } from '../../lib/customer-api';
import { list, SIGNED_IN_KEY } from '../../lib/list-store';

export function saved<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') as T | null;
  } catch {
    return null;
  }
}
// A failed save throws so the caller can stop before sending a request it could not keep for
// recovery. Clearing never throws: it runs after the server confirmed the result.
export function persist(key: string, value: unknown) {
  if (value !== null) localStorage.setItem(key, JSON.stringify(value));
  else
    try {
      localStorage.removeItem(key);
    } catch {
      /* A stale record is replayed safely by its idempotency key. */
    }
}
/**
 * Sign-out removes this account's private drafts (notes, company, GSTIN, lists) from the browser.
 * The shiv_pending_* recovery records stay, so a lost order or rate request can still be recovered
 * after signing back in.
 */
function forgetDrafts(id: string) {
  // The last two are from the old site, and may still be on a phone.
  for (const key of ['checkout', 'quote_draft', 'quote_intent', 'guest_merge'])
    persist(`shiv_${key}_${id}`, null);
}
/** Cross-tab signals and other hints whose loss must never interrupt sign-in or sign-out. */
function remember(key: string, value: unknown) {
  try {
    persist(key, value);
  } catch {
    /* Other tabs notice on their next focus check instead. */
  }
}
/** Tells public pages they may ask for this customer's own rates. A guest's page never asks. */
function markSignedIn(user: User | null) {
  try {
    if (user && user.role !== 'ADMIN') localStorage.setItem(SIGNED_IN_KEY, '1');
    else localStorage.removeItem(SIGNED_IN_KEY);
  } catch {
    /* The public rate shows instead. */
  }
}

function useCommerceValue() {
  const [user, setUser] = useState<User | null>(null);
  const identity = useRef<User | null>(null);
  const generation = useRef(0);
  const [ready, setReady] = useState(false);
  // True when the sign-in check failed for a reason other than "signed out" (offline, outage).
  const [sessionUnknown, setSessionUnknown] = useState(false);
  const sessionUnknownRef = useRef(false);
  const markSessionUnknown = (value: boolean) => {
    sessionUnknownRef.current = value;
    setSessionUnknown(value);
  };
  const [cart, setCart] = useState<CartLine[]>([]);
  const cartRef = useRef<CartLine[]>([]);
  const [busy, setBusy] = useState(false);
  const writes = useRef(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const sessionRequest = useRef(0);
  useEffect(() => {
    if (!message) return;
    // Status confirmations clear themselves; errors stay until dismissed or resolved.
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  const showError = useCallback((e: unknown) => setError(errorText(e)), []);
  const updateCart = (lines: CartLine[]) => {
    cartRef.current = lines;
    setCart(lines);
  };
  const identify = useCallback((next: User | null) => {
    if (identity.current?.id !== next?.id) {
      generation.current++;
      writes.current++;
      updateCart([]);
      setError('');
      setMessage('');
    }
    identity.current = next;
    markSignedIn(next);
    setUser(next);
  }, []);
  const refresh = useCallback(async () => {
    const current = generation.current;
    const mutation = writes.current;
    const session = await customerApi<{ user: User }>('/auth/session');
    if (current !== generation.current) return;
    identify(session.user);
    const id = session.user.id;
    const epoch = generation.current;
    if (session.user.role === 'ADMIN') return;
    const lines = await customerApi<CartLine[]>('/cart', 'GET', undefined, id);
    if (epoch === generation.current && mutation === writes.current) updateCart(lines);
  }, [identify]);
  const restore = useCallback(async () => {
    const attempt = ++sessionRequest.current;
    const epoch = generation.current;
    try {
      let session: { user: User };
      try {
        session = await customerApi('/auth/session');
      } catch (e) {
        if (!(e instanceof CustomerError) || e.status !== 401) throw e;
        session = await customerApi('/auth/refresh', 'POST', {});
      }
      if (attempt !== sessionRequest.current || epoch !== generation.current) return;
      identify(session.user);
      if (sessionUnknownRef.current) setError('');
      markSessionUnknown(false);
      if (session.user.role !== 'ADMIN') await refresh();
    } catch (e) {
      if (attempt !== sessionRequest.current || epoch !== generation.current) return;
      if (e instanceof CustomerError && e.status === 401) {
        if (sessionUnknownRef.current) setError('');
        markSessionUnknown(false);
        identify(null);
      } else if (!identity.current) {
        markSessionUnknown(true);
        // A guest has not asked for anything yet; explain what still works instead of a raw failure.
        setError(
          'Your sign-in could not be checked just now. You can keep browsing; it is checked again when you return to this page.',
        );
      } else showError(e);
    } finally {
      setReady(true);
    }
  }, [identify, refresh, showError]);
  useEffect(() => {
    void restore();
    const expired = (event: Event) => {
      const accountId = (event as CustomEvent<{ accountId?: string }>).detail?.accountId;
      if (accountId && accountId !== identity.current?.id) return;
      identify(null);
      setError('Your session ended. Your saved requests can be recovered after sign-in.');
    };
    const focus = () => {
      if (document.visibilityState === 'visible') void restore();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === 'shiv_account_signal') {
        identify(null);
        void restore();
      }
    };
    window.addEventListener('shiv-session-expired', expired);
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('shiv-session-expired', expired);
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', focus);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('storage', storage);
    };
  }, [restore, identify]);
  async function signedIn(next: User) {
    identify(next);
    remember('shiv_account_signal', crypto.randomUUID());
    await refresh().catch(showError);
  }
  async function signout() {
    setBusy(true);
    try {
      await customerApi('/auth/logout', 'POST', {});
      const owner = identity.current?.id;
      identify(null);
      if (owner) forgetDrafts(owner);
      // A shared phone: the next person starts with an empty list and their own Ask limit.
      list.forget();
      localStorage.removeItem(ASK_DEVICE_KEY);
      remember('shiv_account_signal', crypto.randomUUID());
      setMessage('Signed out.');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  return {
    user,
    ready,
    sessionUnknown,
    retrySession: restore,
    cart,
    busy,
    setBusy,
    message,
    error,
    setError,
    showError,
    setMessage,
    refresh,
    signedIn,
    signout,
    /** The cart as the server holds it now, for this account only. */
    readCart: async (id: string) => {
      const lines = await customerApi<CartLine[]>('/cart', 'GET', undefined, id);
      if (identity.current?.id === id) updateCart(lines);
      return lines;
    },
    /** Sets one line to an absolute quantity. Sending it twice changes nothing. */
    setCartLine: async (id: string, productId: string, quantity: number) => {
      writes.current++;
      const lines = await customerApi<CartLine[]>(
        '/cart/items',
        'PUT',
        { productId, quantity },
        id,
      );
      if (identity.current?.id === id) updateCart(lines);
      return lines;
    },
    currentAccount: () => identity.current?.id,
  };
}
const Commerce = createContext<ReturnType<typeof useCommerceValue> | null>(null);
export function CommerceProvider({ children }: { children: ReactNode }) {
  const value = useCommerceValue();
  return <Commerce.Provider value={value}>{children}</Commerce.Provider>;
}
export function useCommerce() {
  const value = useContext(Commerce);
  if (!value) throw new Error('Commerce provider missing');
  return value;
}

// Rendered in the page flow below the header so an error never hides navigation.
export function CommerceAlert() {
  const c = useCommerce();
  if (!c.error) return null;
  return (
    <div className="commerce-alert" role="alert">
      <span>{c.error}</span>
      <button onClick={() => c.setError('')} aria-label="Dismiss message">
        ×
      </button>
    </div>
  );
}
export function CommerceFeedback() {
  const c = useCommerce();
  if (!c.message) return null;
  return (
    <div className="feedback" role="status" key={c.message}>
      {c.message}
      <button onClick={() => c.setMessage('')} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  );
}
