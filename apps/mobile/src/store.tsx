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
import type { Address, CartLine, Category, Page, Product, StoreSettings, User } from '@shiv/shared';
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
function useStoreValue() {
  const [route, setRoute] = useState<Route>({ screen: 'Home' });
  const [user, setUser] = useState<User | null>(null);
  const [language, setLanguage] = useState<Language>('en');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loginVisible, setLoginVisible] = useState(false);
  const [toast, setToast] = useState('');
  const catalogRequest = useRef(0);
  const accountRequest = useRef(0);
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
    if (!user) {
      setCart([]);
      setAddresses([]);
      return;
    }
    const [c, a] = await Promise.all([api<CartLine[]>('/cart'), api<Address[]>('/me/addresses')]);
    if (current !== accountRequest.current) return;
    setCart(c);
    setAddresses(a);
  }, [user]);
  useEffect(() => {
    void refreshCatalog();
    void restoreSession().then((u) => {
      setUser(u);
      if (u) setLanguage(u.language);
    });
  }, [refreshCatalog]);
  useEffect(() => {
    void refreshAccount().catch((e) => setToast(message(e)));
  }, [refreshAccount]);
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
        void refreshCatalog();
        if (user) void refreshAccount().catch(() => {});
      }
    });
    return () => {
      source.close();
      sub.remove();
    };
  }, [refreshCatalog, refreshAccount, user]);
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
  async function setQuantity(productId: string, quantity: number) {
    if (!requireUser()) return;
    setCart(await api<CartLine[]>('/cart/items', 'PUT', { productId, quantity }));
  }
  async function add(product: Product, quantity = product.minQuantity) {
    if (!requireUser()) return;
    try {
      await setQuantity(
        product.id,
        (cart.find((i) => i.productId === product.id)?.quantity || 0) + quantity,
      );
      setToast(language === 'hi' ? 'कार्ट में जोड़ दिया गया' : `${product.name} added to cart`);
    } catch (e) {
      setToast(message(e));
    }
  }
  async function signout() {
    try {
      await logout();
      setUser(null);
      setCart([]);
      setAddresses([]);
      setRoute({ screen: 'Home' });
    } catch (e) {
      setToast(message(e));
    }
  }
  function navigate(next: Route) {
    if (
      ['Cart', 'Checkout', 'Orders', 'Order', 'Addresses', 'Quotes', 'QuoteRequest'].includes(
        next.screen,
      ) &&
      !requireUser()
    )
      return;
    setRoute(next);
  }
  const t = translate(language);
  return {
    route,
    navigate,
    user,
    setUser,
    language,
    setLanguage,
    t,
    products,
    categories,
    settings,
    cart,
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
