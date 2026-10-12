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
import {
  guestIntentSchema,
  istToday,
  quantityProblem,
  toMergePayload,
  MAX_LINE_QUANTITY,
  type Address,
  type CartLine,
  type Category,
  type GuestIntent,
  type Language,
  type Order,
  type Page,
  type Product,
  type StoreSettings,
  type User,
} from '@shiv/shared';
import { API_URL, ApiError, api, logout, message, onSessionEnded, restoreSession } from './api';
import { tap } from './feedback';
export type { Language };
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
    | 'QuoteRequest'
    | 'Compare'
    | 'Assistant';
  id?: string;
  category?: string;
};
export const tabs = ['Home', 'Products', 'Cart', 'Orders', 'Account'] as const;
export type Tab = (typeof tabs)[number];
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
/** Guest materials frozen under an account while they are sent to its basket. */
export type MergeDraft = GuestIntent & { uncertain: boolean; problem?: string };
const addDays = (days: number) =>
  new Date(Date.parse(`${istToday()}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const newCheckout = (): CheckoutDraft => ({
  addressId: '',
  date: addDays(1),
  notes: '',
  paymentMethod: 'COD',
});
const newQuote = (): QuoteDraft => ({
  lines: {},
  addressId: '',
  date: addDays(7),
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
// Phone secure storage keeps values small, so a guest basket is saved as [id, quantity] pairs.
type SavedIntent = { key: string; lines: [string, number][] };
const packIntent = (intent: GuestIntent): SavedIntent => ({
  key: intent.key,
  lines: intent.lines.map((line) => [line.productId, line.quantity]),
});
function unpackIntent(saved: SavedIntent | null): GuestIntent | null {
  const parsed = guestIntentSchema.safeParse({
    key: saved?.key,
    lines: Array.isArray(saved?.lines)
      ? saved.lines.map(([productId, quantity]) => ({ productId, quantity }))
      : [],
  });
  return parsed.success ? parsed.data : null;
}
const guestKey = 'shiv_guest_basket';
const mergeKey = (userId: string) => `shiv_merge_${userId}`;
const emptyIntent = (): GuestIntent => ({ key: makeKey(), lines: [] });
const protectedScreens = ['Checkout', 'Orders', 'Order', 'Addresses', 'Quotes', 'QuoteRequest'];
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
  'Compare',
  'Assistant',
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
  // 'unset' asks the customer once, on first launch; Hindi is the default.
  const [language, setLanguageState] = useState<Language>('hi');
  const [languageState, setLanguageStatus] = useState<'loading' | 'unset' | 'set'>('loading');
  const languageRef = useRef<Language>('hi');
  const languageStatusRef = useRef(languageState);
  languageStatusRef.current = languageState;
  const [products, setProducts] = useState<Product[]>([]);
  const [knownProducts, setKnownProducts] = useState<Record<string, Product>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [cart, setCartState] = useState<CartLine[]>([]);
  const cartRef = useRef<CartLine[]>([]);
  const cartWriting = useRef(false);
  const cartMutation = useRef(0);
  const [cartBusy, setCartBusy] = useState(false);
  const [guest, setGuestState] = useState<GuestIntent>(emptyIntent);
  const guestRef = useRef<GuestIntent>(guest);
  const [mergeDraft, setMergeDraftState] = useState<MergeDraft | null>(null);
  const mergeRef = useRef<MergeDraft | null>(null);
  const merging = useRef(false);
  const [latestOrder, setLatestOrder] = useState<Order | null>(null);
  const [compare, setCompare] = useState<Product[]>([]);
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
  const screenRefresh = useRef<(() => Promise<void>) | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const languageTail = useRef<Promise<unknown>>(Promise.resolve());
  const catalogRequest = useRef(0);
  const accountRequest = useRef(0);
  const t = useCallback((en: string, hi: string) => (language === 'hi' ? hi : en), [language]);
  const say = useCallback((e: unknown) => message(e, languageRef.current), []);
  function remember(items: Product[]) {
    if (!items.length) return;
    setKnownProducts((old) => {
      const next = { ...old };
      for (const item of items) next[item.id] = item;
      return next;
    });
  }
  function setGuest(next: GuestIntent) {
    guestRef.current = next;
    setGuestState(next);
    return writeSaved(guestKey, next.lines.length ? packIntent(next) : null);
  }
  function setMergeDraft(ownerId: string, next: MergeDraft | null) {
    if (userRef.current?.id === ownerId) {
      mergeRef.current = next;
      setMergeDraftState(next);
    }
    return writeSaved(
      mergeKey(ownerId),
      next ? { ...packIntent(next), uncertain: next.uncertain, problem: next.problem } : null,
    );
  }
  function setUser(next: User | null) {
    if (next?.id !== userRef.current?.id) {
      accountRequest.current++;
      cartMutation.current++;
      cartWriting.current = false;
      setCartBusy(false);
      setCart([]);
      setAddresses([]);
      setOrdersById({});
      setLatestOrder(null);
      mergeRef.current = null;
      setMergeDraftState(null);
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
  const draftNotSaved = () =>
    setToast(
      languageRef.current === 'hi'
        ? 'यह फ़ोन आपका ड्राफ़्ट सहेज नहीं सका। यह पेज खुला रखें।'
        : 'This device could not save your draft. Keep this page open.',
    );
  function updateCheckoutDraft(patch: Partial<CheckoutDraft>) {
    drafts.current.checkout = { ...drafts.current.checkout, ...patch };
    setCheckoutDraft(drafts.current.checkout);
    void persistDrafts().catch(draftNotSaved);
  }
  function updateQuoteDraft(patch: Partial<QuoteDraft>) {
    drafts.current.quote = { ...drafts.current.quote, ...patch };
    setQuoteDraft(drafts.current.quote);
    const saved = persistDrafts();
    void saved.catch(draftNotSaved);
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
    void persistDrafts().catch(draftNotSaved);
  }
  function setLanguage(next: Language) {
    languageRef.current = next;
    setLanguageState(next);
    setLanguageStatus('set');
    void writeSaved('shiv_language', next).catch(() =>
      setToast(
        next === 'hi'
          ? 'भाषा इस फ़ोन पर सहेजी नहीं जा सकी।'
          : 'Could not save your language on this device.',
      ),
    );
    const current = userRef.current;
    if (current) {
      languageTail.current = languageTail.current
        .catch(() => {})
        .then(() => {
          if (userRef.current?.id === current.id) return api('/me', 'PATCH', { language: next });
        })
        .catch(() => {});
    }
  }
  const showRoute = useCallback((next: Route, replace = false) => {
    if (routeHash(next) === routeHash(routeRef.current)) return;
    const previous = routeRef.current;
    // A tab press starts a fresh history; Back from a tab goes Home.
    if ((tabs as readonly string[]).includes(next.screen) && !next.category)
      routeHistory.current = next.screen === 'Home' ? [] : [{ screen: 'Home' }];
    else if (!replace) routeHistory.current.push(routeRef.current);
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
  /** Returns false when there is nowhere to go back to (Android then leaves the app). */
  const goBack = useCallback(() => {
    if (Platform.OS === 'web' && (routeHistory.current.length || history.state?.shivBack)) {
      history.back();
      return true;
    }
    const previous = routeHistory.current.pop();
    if (!previous && routeRef.current.screen === 'Home') return false;
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
    const next = previous || fallback;
    routeRef.current = next;
    setRoute(next);
    return true;
  }, []);
  function openAddresses(id?: string) {
    navigate({ screen: 'Addresses', ...(id ? { id } : {}) });
  }
  function completeAddress(id: string) {
    const origin =
      addressOrigin.current ||
      (Platform.OS === 'web' ? (history.state?.shivBack as Route | undefined) : null);
    if (origin?.screen === 'Checkout' || origin?.screen === 'Cart')
      updateCheckoutDraft({ addressId: id });
    if (origin?.screen === 'QuoteRequest') updateQuoteDraft({ addressId: id });
    if (origin && ['Checkout', 'Cart', 'QuoteRequest'].includes(origin.screen)) goBack();
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
        // Enough for the rate board and the home shelf: in-stock items, cheapest first.
        api<Page<Product>>('/products?sort=price_asc&availability=in&limit=100'),
        api<Category[]>('/categories'),
        api<StoreSettings>('/store'),
      ]);
      if (current !== catalogRequest.current) return;
      setProducts(p.items);
      remember(p.items);
      setCategories(c);
      setSettings(st);
      setError('');
    } catch (e) {
      if (current === catalogRequest.current) setError(say(e));
    } finally {
      if (current === catalogRequest.current) setLoading(false);
    }
  }, [say]);
  const refreshAccount = useCallback(async () => {
    const current = ++accountRequest.current;
    if (!userRef.current) {
      setCart([]);
      setAddresses([]);
      return;
    }
    await Promise.all([
      api<CartLine[]>('/cart').then((lines) => {
        if (current === accountRequest.current && !cartWriting.current) {
          setCart(lines);
          remember(lines.map((line) => line.product));
        }
      }),
      api<Address[]>('/me/addresses').then((saved) => {
        if (current === accountRequest.current) setAddresses(saved);
      }),
      // The home screen's "latest order" card; optional, so failures stay quiet.
      api<Page<Order>>('/orders?limit=1')
        .then((page) => {
          if (current === accountRequest.current) setLatestOrder(page.items[0] || null);
        })
        .catch(() => {}),
    ]);
  }, []);
  const refreshCurrent = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshCatalog(), refreshAccount(), screenRefresh.current?.()]);
    } catch (e) {
      setToast(say(e));
    } finally {
      setRefreshing(false);
    }
  }, [refreshCatalog, refreshAccount, say]);
  /** Sends guest materials to the signed-in basket once; a lost reply is retried with the same key. */
  async function mergeGuest(retry = false) {
    const owner = userRef.current;
    if (!owner || owner.role === 'ADMIN' || merging.current) return;
    const draft = mergeRef.current;
    if (!draft?.lines.length || (!retry && draft.problem && !draft.uncertain)) return;
    merging.current = true;
    setCartBusy(true);
    cartWriting.current = true;
    try {
      await setMergeDraft(owner.id, { ...draft, uncertain: true, problem: undefined });
      const lines = await api<CartLine[]>('/cart/merge', 'POST', toMergePayload(draft));
      await setMergeDraft(owner.id, null);
      if (userRef.current?.id !== owner.id) return;
      setCart(lines);
      remember(lines.map((line) => line.product));
      setToast(
        languageRef.current === 'hi'
          ? 'आपकी चुनी सामग्री टोकरी में है।'
          : 'Your chosen materials are in your basket.',
      );
    } catch (e) {
      // A definite refusal (stock, quantity rules) can be edited; anything else stays uncertain.
      const definite =
        e instanceof ApiError &&
        !['NETWORK_ERROR', 'REQUEST_FAILED', 'IDEMPOTENCY_CONFLICT', 'ACCOUNT_CHANGED'].includes(
          e.code,
        ) &&
        e.code !== 'RATE_LIMITED';
      await setMergeDraft(owner.id, {
        ...draft,
        uncertain: !definite,
        problem: say(e),
      }).catch(() => {});
    } finally {
      merging.current = false;
      cartWriting.current = false;
      setCartBusy(false);
    }
  }
  function discardMerge() {
    const owner = userRef.current;
    if (owner) void setMergeDraft(owner.id, null).catch(() => {});
  }
  async function completeLogin(next: User) {
    setUser(next);
    if (languageStatusRef.current !== 'set') setLanguage(next.language === 'en' ? 'en' : 'hi');
    setLoginVisible(false);
    const raw = await readSaved<SavedIntent & { uncertain?: boolean; problem?: string }>(
      mergeKey(next.id),
    ).catch(() => null);
    if (userRef.current !== next) return;
    const saved = unpackIntent(raw);
    if (saved) {
      mergeRef.current = { ...saved, uncertain: raw?.uncertain !== false, problem: raw?.problem };
      setMergeDraftState(mergeRef.current);
    } else if (guestRef.current.lines.length && next.role !== 'ADMIN') {
      // Freeze the guest basket under this account before sending it.
      const draft = { ...guestRef.current, uncertain: true };
      await setMergeDraft(next.id, draft).catch(() => {});
      await setGuest(emptyIntent()).catch(() => {});
    }
    await mergeGuest();
    await refreshAccount().catch(() => {});
    const destination = pendingRoute.current;
    pendingRoute.current = null;
    if (destination) showRoute(destination);
  }
  useEffect(() => {
    void refreshCatalog();
    void readSaved<Language>('shiv_language')
      .then((saved) => {
        if (saved === 'hi' || saved === 'en') {
          languageRef.current = saved;
          setLanguageState(saved);
          setLanguageStatus('set');
        } else setLanguageStatus('unset');
      })
      .catch(() => setLanguageStatus('unset'));
    void readSaved<SavedIntent>(guestKey)
      .then((saved) => {
        const intent = unpackIntent(saved);
        if (intent && !userRef.current) {
          guestRef.current = intent;
          setGuestState(intent);
        }
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
      .catch((e) => setToast(say(e)));
  }, [refreshCatalog, showRoute]);
  useEffect(() => {
    onSessionEnded(() => {
      if (!userRef.current) return;
      setUser(null);
      setToast(
        languageRef.current === 'hi'
          ? 'आपका सत्र समाप्त हुआ। जारी रखने के लिए फिर साइन इन करें।'
          : 'Your session ended. Sign in again to continue.',
      );
    });
    return () => onSessionEnded(null);
  }, []);
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
        // A saved date in the past would only fail at review; move it to the default.
        if (drafts.current.checkout.date < istToday())
          drafts.current.checkout.date = newCheckout().date;
        setCheckoutDraft(drafts.current.checkout);
        setQuoteDraft(drafts.current.quote);
        setPendingCheckout(drafts.current.pending);
      })
      .catch(draftNotSaved)
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
    void refreshAccount().catch((e) => setToast(say(e)));
  }, [refreshAccount, user?.id, say]);
  // Guest basket lines need product details that may not be on the rate board.
  const missing = guest.lines
    .map((line) => line.productId)
    .filter((id) => !knownProducts[id])
    .sort()
    .join(',');
  useEffect(() => {
    if (!missing) return;
    let active = true;
    void Promise.allSettled(
      missing.split(',').map((id) => api<Product>(`/products/${encodeURIComponent(id)}`)),
    ).then((results) => {
      if (active)
        remember(
          results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
        );
    });
    return () => {
      active = false;
    };
  }, [missing]);
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
      if (state === 'active') void refreshCurrent();
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
  async function mutateCart(
    ownerId: string,
    request: (isCurrent: () => boolean) => Promise<CartLine[]>,
  ) {
    if (ownerId !== userRef.current?.id) return false;
    if (cartWriting.current)
      throw new Error(
        languageRef.current === 'hi'
          ? 'टोकरी अपडेट हो रही है। कृपया रुकें।'
          : 'Your basket is updating. Please wait.',
      );
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
  function quantityError(product: Product) {
    return languageRef.current === 'hi'
      ? `मात्रा कम से कम ${product.minQuantity}, ${product.quantityStep} के गुणक में, और स्टॉक के अंदर रखें।`
      : `Choose at least ${product.minQuantity}, in steps of ${product.quantityStep}, within stock.`;
  }
  /** Sets a basket quantity (0 removes). Guests keep their basket on the phone. */
  async function setQuantity(product: Product, quantity: number) {
    const owner = userRef.current;
    if (
      quantity &&
      quantityProblem(product, quantity, Math.min(product.stock, MAX_LINE_QUANTITY))
    ) {
      setToast(quantityError(product));
      return false;
    }
    if (!owner) {
      const lines = guestRef.current.lines.filter((line) => line.productId !== product.id);
      if (quantity) lines.push({ productId: product.id, quantity });
      if (lines.length > 50) {
        setToast(
          languageRef.current === 'hi'
            ? 'टोकरी में अधिकतम 50 सामग्री रख सकते हैं।'
            : 'A basket can hold 50 materials.',
        );
        return false;
      }
      remember([product]);
      await setGuest({ key: makeKey(), lines }).catch(() =>
        setToast(
          languageRef.current === 'hi'
            ? 'यह फ़ोन टोकरी सहेज नहीं सका।'
            : 'This device could not save your basket.',
        ),
      );
      return true;
    }
    return mutateCart(owner.id, () =>
      api<CartLine[]>('/cart/items', 'PUT', { productId: product.id, quantity }),
    );
  }
  async function add(product: Product, quantity = product.minQuantity) {
    const current = basketQuantity(product.id);
    try {
      const applied = await setQuantity(product, current + quantity);
      if (applied) {
        tap();
        setToast(
          languageRef.current === 'hi'
            ? `${product.name} टोकरी में जुड़ गया`
            : `${product.name} added to basket`,
        );
      }
      return applied;
    } catch (e) {
      setToast(say(e));
      return false;
    }
  }
  function basketQuantity(productId: string) {
    return userRef.current
      ? cartRef.current.find((line) => line.productId === productId)?.quantity || 0
      : guestRef.current.lines.find((line) => line.productId === productId)?.quantity || 0;
  }
  // One basket shape for guests and signed-in customers; guest prices are today's prices.
  const basket: CartLine[] = user
    ? cart
    : guest.lines.flatMap((line) => {
        const product = knownProducts[line.productId];
        return product
          ? [
              {
                productId: line.productId,
                quantity: line.quantity,
                seenPricePaise: product.pricePaise,
                seenPriceVersion: product.priceVersion,
                product,
              },
            ]
          : [];
      });
  const basketLoading = !user && guest.lines.length > basket.length;
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
      routeHistory.current = [];
      addressOrigin.current = null;
      setUser(null);
      setCart([]);
      setAddresses([]);
      showRoute({ screen: 'Home' }, true);
    } catch (e) {
      setToast(say(e));
    }
  }
  function toggleCompare(product: Product) {
    setCompare((old) =>
      old.some((item) => item.id === product.id)
        ? old.filter((item) => item.id !== product.id)
        : [...old.slice(-2), product],
    );
  }
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
    languageState,
    setLanguage,
    t,
    say,
    products,
    knownProducts,
    remember,
    categories,
    settings,
    cart,
    basket,
    basketLoading,
    basketQuantity,
    cartBusy,
    mutateCart,
    mergeDraft,
    mergeGuest,
    discardMerge,
    latestOrder,
    addresses,
    setAddresses,
    error,
    loading,
    refreshCatalog,
    refreshAccount,
    setQuantity,
    add,
    signout,
    loginVisible,
    setLoginVisible,
    toast,
    setToast,
    compare,
    toggleCompare,
    clearCompare: () => setCompare([]),
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
