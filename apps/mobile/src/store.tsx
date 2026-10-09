import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import EventSource from 'react-native-sse';
import * as SecureStore from 'expo-secure-store';
import type {
  Address,
  CartLine,
  Category,
  Order,
  Page,
  Product,
  StoreSettings,
  User,
} from '@shiv/shared';
import { API_URL, api, logout, message, restoreSession } from './api';
import { Language, translate } from './i18n';
export type Route = {
  screen:
    | 'Home'
    | 'Products'
    | 'Orders'
    | 'Account'
    | 'Cart'
    | 'Checkout'
    | 'Product'
    | 'Order'
    | 'Addresses'
    | 'Quotes'
    | 'QuoteRequest';
  id?: string;
  category?: string;
};
export type CheckoutDraft = {
  addressId: string;
  date: string;
  notes: string;
  paymentMethod: 'COD' | 'ONLINE';
};
export type QuoteDraft = {
  submitted?: boolean;
  lines: Record<string, number>;
  addressId: string;
  date: string;
  company: string;
  gstin: string;
  notes: string;
  idempotencyKey: string;
};
export type PendingCheckout = {
  reviewId: string;
  idempotencyKey: string;
  paymentMethod: 'COD' | 'ONLINE';
  totalPaise: number;
};
const newCheckout = (): CheckoutDraft => ({
  addressId: '',
  date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  notes: '',
  paymentMethod: 'COD',
});
const newQuote = (): QuoteDraft => ({
  lines: {},
  addressId: '',
  date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  company: '',
  gstin: '',
  notes: '',
  idempotencyKey: makeKey(),
});
// Request identifiers are not authentication secrets.
export function makeKey() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16);
    return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
}
export async function readSaved<T>(key: string): Promise<T | null> {
  const value =
    Platform.OS === 'web' ? localStorage.getItem(key) : await SecureStore.getItemAsync(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
export async function writeSaved(key: string, value: unknown) {
  if (Platform.OS === 'web') {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } else if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, JSON.stringify(value));
}
const protectedScreens = [
  'Cart',
  'Checkout',
  'Orders',
  'Order',
  'Addresses',
  'Quotes',
  'QuoteRequest',
];
const screens: Route['screen'][] = [
  'Home',
  'Products',
  'Orders',
  'Account',
  'Cart',
  'Checkout',
  'Product',
  'Order',
  'Addresses',
  'Quotes',
  'QuoteRequest',
];
function routeFromHash(): Route {
  if (Platform.OS !== 'web') return { screen: 'Home' };
  const [path, query] = location.hash.slice(1).split('?');
  const [screen, id] = (path || '').split('/').filter(Boolean);
  const found = screens.find((value) => value.toLowerCase() === screen);
  if (!found) return { screen: 'Home' };
  try {
    return {
      screen: found,
      ...(id ? { id: decodeURIComponent(id) } : {}),
      ...(query ? { category: new URLSearchParams(query).get('category') || undefined } : {}),
    };
  } catch {
    return { screen: 'Home' };
  }
}
function routeHash(next: Route) {
  return `#/${next.screen.toLowerCase()}${next.id ? `/${encodeURIComponent(next.id)}` : ''}${next.category ? `?category=${encodeURIComponent(next.category)}` : ''}`;
}
function useStoreValue() {
  const [route, setRoute] = useState<Route>({ screen: 'Home' });
  const [user, setUserState] = useState<User | null>(null);
  const userRef = useRef<User | null>(null);
  const [language, setLanguageState] = useState<Language>('en');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [cart, setCartState] = useState<CartLine[]>([]);
  const cartRef = useRef<CartLine[]>([]);
  // ponytail: one confirmed cart write per screen session; queue writes if measured latency warrants it.
  const cartWriting = useRef(false);
  const cartMutation = useRef(0);
  const [cartBusy, setCartBusy] = useState(false);
  function setCart(next: CartLine[]) {
    cartRef.current = next;
    setCartState(next);
  }
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loginVisible, setLoginVisible] = useState(false);
  const [toast, setToast] = useState('');
  const [checkoutDraft, setCheckoutDraft] = useState(newCheckout);
  const [quoteDraft, setQuoteDraft] = useState(newQuote);
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null);
  const [ordersById, setOrdersById] = useState<Record<string, Order>>({});
  const [draftsLoading, setDraftsLoading] = useState(false);
  const drafts = useRef({ checkout: checkoutDraft, quote: quoteDraft, pending: pendingCheckout });
  const storageTail = useRef<Promise<void>>(Promise.resolve());
  const routeRef = useRef(route);
  const routeHistory = useRef<Route[]>([]);
  const addressOrigin = useRef<Route | null>(null);
  const pendingRoute = useRef<Route | null>(null);
  const pendingAdd = useRef<{ productId: string; quantity: number; name: string } | null>(null);
  const screenRefresh = useRef<(() => Promise<void>) | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const languageTail = useRef<Promise<unknown>>(Promise.resolve());
  const catalogRequest = useRef(0);
  const accountRequest = useRef(0);
  function setUser(next: User | null) {
    if (next?.id !== userRef.current?.id) {
      accountRequest.current++;
      cartMutation.current++;
      cartWriting.current = false;
      setCartBusy(false);
      setCart([]);
      setAddresses([]);
      setOrdersById({});
      drafts.current = { checkout: newCheckout(), quote: newQuote(), pending: null };
      setCheckoutDraft(drafts.current.checkout);
      setQuoteDraft(drafts.current.quote);
      setPendingCheckout(null);
      setDraftsLoading(Boolean(next));
    }
    userRef.current = next;
    setUserState(next);
  }
  function persistDrafts() {
    const id = userRef.current?.id;
    if (!id) return Promise.resolve();
    const saved = JSON.stringify(drafts.current);
    storageTail.current = storageTail.current
      .catch(() => {})
      .then(() => writeSaved(`shiv_draft_${id}`, JSON.parse(saved)));
    return storageTail.current;
  }
  function updateCheckoutDraft(patch: Partial<CheckoutDraft>) {
    drafts.current.checkout = { ...drafts.current.checkout, ...patch };
    setCheckoutDraft(drafts.current.checkout);
    void persistDrafts().catch(() =>
      setToast('This device could not save your draft. Keep this page open.'),
    );
  }
  function updateQuoteDraft(patch: Partial<QuoteDraft>) {
    drafts.current.quote = { ...drafts.current.quote, ...patch };
    setQuoteDraft(drafts.current.quote);
    const saved = persistDrafts();
    void saved.catch(() => setToast('This device could not save your draft. Keep this page open.'));
    return saved;
  }
  async function savePendingCheckout(pending: PendingCheckout | null) {
    drafts.current.pending = pending;
    setPendingCheckout(pending);
    await persistDrafts();
  }
  function rememberOrder(order: Order) {
    setOrdersById((old) => ({ ...old, [order.id]: order }));
  }
  function resetQuoteDraft() {
    drafts.current.quote = newQuote();
    setQuoteDraft(drafts.current.quote);
    void persistDrafts().catch(() => setToast('Could not clear the saved draft.'));
  }
  function setLanguage(next: Language) {
    setLanguageState(next);
    void writeSaved('shiv_language', next).catch(() =>
      setToast('Could not save your language on this device.'),
    );
    const current = userRef.current;
    if (current) {
      languageTail.current = languageTail.current
        .catch(() => {})
        .then(() => {
          if (userRef.current?.id === current.id) return api('/me', 'PATCH', { language: next });
        })
        .catch(() =>
          setToast('Language saved on this device; account sync will retry after sign-in.'),
        );
    }
  }
  const showRoute = useCallback((next: Route, replace = false) => {
    if (routeHash(next) === routeHash(routeRef.current)) return;
    const previous = routeRef.current;
    if (!replace) routeHistory.current.push(routeRef.current);
    routeRef.current = next;
    setRoute(next);
    if (Platform.OS === 'web')
      history[replace ? 'replaceState' : 'pushState'](
        replace ? history.state : { shivBack: previous },
        '',
        routeHash(next),
      );
  }, []);
  const navigate = useCallback(
    (next: Route) => {
      if (protectedScreens.includes(next.screen) && !userRef.current) {
        pendingRoute.current = next;
        setLoginVisible(true);
        return;
      }
      if (next.screen === 'Addresses') addressOrigin.current = routeRef.current;
      showRoute(next);
    },
    [showRoute],
  );
  const goBack = useCallback(() => {
    if (Platform.OS === 'web' && (routeHistory.current.length || history.state?.shivBack)) {
      history.back();
      return;
    }
    const fallback: Route = {
      screen:
        routeRef.current.screen === 'Checkout'
          ? 'Cart'
          : routeRef.current.screen === 'Product'
            ? 'Products'
            : routeRef.current.screen === 'Order'
              ? 'Orders'
              : 'Home',
    };
    showRoute(routeHistory.current.pop() || fallback, true);
  }, [showRoute]);
  function openAddresses(id?: string) {
    navigate({ screen: 'Addresses', ...(id ? { id } : {}) });
  }
  function completeAddress(id: string) {
    const origin =
      addressOrigin.current ||
      (Platform.OS === 'web' ? (history.state?.shivBack as Route | undefined) : null);
    if (origin?.screen === 'Checkout') updateCheckoutDraft({ addressId: id });
    if (origin?.screen === 'QuoteRequest') updateQuoteDraft({ addressId: id });
    if (origin && ['Checkout', 'QuoteRequest'].includes(origin.screen)) goBack();
  }
  const registerRefresh = useCallback((callback: () => Promise<void>) => {
    screenRefresh.current = callback;
    return () => {
      if (screenRefresh.current === callback) screenRefresh.current = null;
    };
  }, []);
  const refreshCatalog = useCallback(async () => {
    const current = ++catalogRequest.current;
    try {
      const [p, c, st] = await Promise.all([
        api<Page<Product>>('/products?limit=8'),
        api<Category[]>('/categories'),
        api<StoreSettings>('/store'),
      ]);
      if (current !== catalogRequest.current) return;
      setProducts(p.items);
      setCategories(c);
      setSettings(st);
      setError('');
    } catch (e) {
      if (current === catalogRequest.current) setError(message(e));
    } finally {
      if (current === catalogRequest.current) setLoading(false);
    }
  }, []);
  const refreshAccount = useCallback(async () => {
    const current = ++accountRequest.current;
    if (!userRef.current) {
      setCart([]);
      setAddresses([]);
      return;
    }
    await Promise.all([
      api<CartLine[]>('/cart').then((lines) => {
        if (current === accountRequest.current && !cartWriting.current) setCart(lines);
      }),
      api<Address[]>('/me/addresses').then((saved) => {
        if (current === accountRequest.current) setAddresses(saved);
      }),
    ]);
  }, []);
  const refreshCurrent = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshCatalog(), refreshAccount(), screenRefresh.current?.()]);
    } catch (e) {
      setToast(message(e));
    } finally {
      setRefreshing(false);
    }
  }, [refreshCatalog, refreshAccount]);
  async function completeLogin(next: User) {
    setUser(next);
    const preferred = await readSaved<Language>('shiv_language').catch(() => null);
    if (userRef.current !== next) return;
    if (preferred === 'en' || preferred === 'hi') setLanguage(preferred);
    else setLanguageState(next.language);
    setLoginVisible(false);
    const destination = pendingRoute.current;
    pendingRoute.current = null;
    if (destination) showRoute(destination);
    const item = pendingAdd.current;
    pendingAdd.current = null;
    if (item) {
      try {
        if (await setQuantity(item.productId, item.quantity, true))
          setToast(`${item.name} added to cart`);
      } catch (e) {
        setToast(message(e));
      }
    }
  }
  useEffect(() => {
    void refreshCatalog();
    void readSaved<Language>('shiv_language')
      .then((saved) => {
        if (saved === 'hi' || saved === 'en') setLanguageState(saved);
      })
      .catch(() => {});
    void restoreSession()
      .then(async (u) => {
        if (u) await completeLogin(u);
        const initial = routeFromHash();
        if (!u && protectedScreens.includes(initial.screen)) {
          pendingRoute.current = initial;
          setLoginVisible(true);
        } else showRoute(initial, true);
      })
      .catch((e) => setToast(message(e)));
  }, [refreshCatalog, showRoute]);
  useEffect(() => {
    const id = user?.id;
    if (!id) return;
    let active = true;
    void readSaved<Partial<typeof drafts.current>>(`shiv_draft_${id}`)
      .then((saved) => {
        if (!active || userRef.current?.id !== id || !saved) return;
        drafts.current = {
          checkout: { ...newCheckout(), ...saved.checkout },
          quote: { ...newQuote(), ...saved.quote },
          pending: saved.pending || null,
        };
        setCheckoutDraft(drafts.current.checkout);
        setQuoteDraft(drafts.current.quote);
        setPendingCheckout(drafts.current.pending);
      })
      .catch(() => setToast('Could not restore the draft saved on this device.'))
      .finally(() => {
        if (active) setDraftsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const pop = () => {
      const next = routeFromHash();
      if (protectedScreens.includes(next.screen) && !userRef.current) {
        pendingRoute.current = next;
        setLoginVisible(true);
        return;
      }
      routeHistory.current.pop();
      routeRef.current = next;
      setRoute(next);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    void refreshAccount().catch((e) => setToast(message(e)));
  }, [refreshAccount, user?.id]);
  useEffect(() => {
    const source = new EventSource(`${API_URL}/events`);
    source.addEventListener('open', () => {
      void refreshCatalog();
      if (user) void refreshAccount().catch(() => {});
    });
    source.addEventListener('message', (event) => {
      if (event.data && !event.data.includes('HEARTBEAT')) {
        void refreshCatalog();
        if (user) void refreshAccount().catch(() => {});
      }
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshCurrent();
      }
    });
    return () => {
      source.close();
      sub.remove();
    };
  }, [refreshCatalog, refreshAccount, refreshCurrent, user]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const focus = () => void refreshCurrent();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refreshCurrent]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const requireUser = () => {
    if (!user) {
      setLoginVisible(true);
      return false;
    }
    return true;
  };
  async function mutateCart(
    ownerId: string,
    request: (isCurrent: () => boolean) => Promise<CartLine[]>,
  ) {
    if (ownerId !== userRef.current?.id) return false;
    if (cartWriting.current) throw new Error('Your cart is updating. Please wait.');
    const mutation = ++cartMutation.current;
    const isCurrent = () => mutation === cartMutation.current && ownerId === userRef.current?.id;
    accountRequest.current++;
    cartWriting.current = true;
    setCartBusy(true);
    try {
      const updated = await request(isCurrent);
      if (!isCurrent()) return false;
      accountRequest.current++;
      setCart(updated);
      return true;
    } finally {
      if (mutation === cartMutation.current) {
        accountRequest.current++;
        cartWriting.current = false;
        setCartBusy(false);
      }
    }
  }
  async function setQuantity(productId: string, quantity: number, addToSavedQuantity = false) {
    const ownerId = userRef.current?.id;
    if (!ownerId) {
      setLoginVisible(true);
      return false;
    }
    return mutateCart(ownerId, async (isCurrent) => {
      if (addToSavedQuantity) {
        const saved = await api<CartLine[]>('/cart');
        if (!isCurrent()) return [];
        quantity += saved.find((line) => line.productId === productId)?.quantity || 0;
      }
      return api<CartLine[]>('/cart/items', 'PUT', { productId, quantity });
    });
  }
  async function add(product: Product, quantity = product.minQuantity) {
    if (!user) {
      pendingAdd.current = { productId: product.id, quantity, name: product.name };
      setLoginVisible(true);
      return;
    }
    try {
      const applied = await setQuantity(
        product.id,
        (cartRef.current.find((i) => i.productId === product.id)?.quantity || 0) + quantity,
      );
      if (applied)
        setToast(language === 'hi' ? 'कार्ट में जोड़ दिया गया' : `${product.name} added to cart`);
    } catch (e) {
      setToast(message(e));
    }
  }
  async function signout() {
    try {
      await logout();
      await storageTail.current.catch(() => {});
      // Retain only reconciliation identifiers across sign-out; another user cannot load them.
      if (userRef.current)
        await writeSaved(
          `shiv_draft_${userRef.current.id}`,
          drafts.current.pending ? { pending: drafts.current.pending } : null,
        ).catch(() => {});
      pendingRoute.current = null;
      pendingAdd.current = null;
      routeHistory.current = [];
      addressOrigin.current = null;
      setUser(null);
      setCart([]);
      setAddresses([]);
      showRoute({ screen: 'Home' }, true);
    } catch (e) {
      setToast(message(e));
    }
  }
  const t = translate(language);
  return {
    route,
    navigate,
    goBack,
    openAddresses,
    completeAddress,
    completeLogin,
    checkoutDraft,
    updateCheckoutDraft,
    quoteDraft,
    updateQuoteDraft,
    resetQuoteDraft,
    pendingCheckout,
    savePendingCheckout,
    ordersById,
    rememberOrder,
    draftsLoading,
    registerRefresh,
    refreshCurrent,
    refreshing,
    user,
    setUser,
    language,
    setLanguage,
    t,
    products,
    categories,
    settings,
    cart,
    cartBusy,
    mutateCart,
    addresses,
    setAddresses,
    error,
    loading,
    refreshCatalog,
    refreshAccount,
    setQuantity,
    add,
    signout,
    requireUser,
    loginVisible,
    setLoginVisible,
    toast,
    setToast,
    isWeb: Platform.OS === 'web',
  };
}
const Store = createContext<ReturnType<typeof useStoreValue> | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  return <Store.Provider value={value}>{children}</Store.Provider>;
}
export function useStore() {
  const value = useContext(Store);
  if (!value) throw new Error('StoreProvider missing');
  return value;
}
