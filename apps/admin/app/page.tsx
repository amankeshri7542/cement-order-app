'use client';
import { RateStudio } from '../components/rate-studio/studio';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellRing,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  IndianRupee,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
  Users,
  X,
} from 'lucide-react';
import {
  Category,
  Order,
  Page as PageResult,
  Product,
  Quote,
  StoreSettings,
  User,
  dateLabel,
  money,
  phoneDigits,
} from '@shiv/shared';
import { API_URL, ApiError, api } from '../lib/api';
import { LanguageProvider, useLanguage, useWords } from '../lib/i18n';
import { chime, registerWorker, setBadge } from '../lib/push';
import { Badge, Empty, Field, Modal, SectionTitle } from '../components/ui';
import { Products } from '../components/products';
import { Orders, OrdersTable } from '../components/orders';
import { Quotes } from '../components/quotes';
import { SecurityControls } from '../components/security-controls';
import { Settings } from '../components/settings';
import { MoneyReport } from '../components/money';
import { StaffAlerts, soundOn } from '../components/staff';
import { AuditHistory, CounterSale, DeliveryZones, StaffSessions } from '../components/operations';

type Tab =
  | 'More'
  | 'Overview'
  | 'Orders'
  | 'Products'
  | 'Money'
  | 'Rate Studio'
  | 'Bulk quotes'
  | 'Customers'
  | 'Staff & alerts'
  | 'Finance & settings'
  | 'Store activity';
type Customer = User & { createdAt: string; _count: { orders: number; quotes: number } };
type Dashboard = {
  todayOrders: number;
  todaySalesPaise: number;
  todayCounterSalesPaise: number;
  todayRefundsPaise: number;
  newWork: number;
  issues: number;
  pendingOrders: number;
  pendingPayments: number;
  pendingDeliveries: number;
  bulkRequests: number;
  lowStock: Product[];
  recentOrders: Order[];
};
type Words = (en: string, hi: string) => string;
// Every screen's name and one-line purpose, in both languages. The English names are also the
// screens' stable identifiers in links and tests.
const screens: Record<Tab, { hi: string; en: string; sub: [string, string] }> = {
  Overview: {
    en: 'Today',
    hi: 'आज',
    sub: ['Here’s what’s happening at your store today.', 'आज दुकान में क्या चल रहा है।'],
  },
  Orders: {
    en: 'Orders',
    hi: 'ऑर्डर',
    sub: ['From the first bag to the final delivery.', 'पहली बोरी से डिलीवरी तक।'],
  },
  Products: {
    en: 'Prices & stock',
    hi: 'भाव और स्टॉक',
    sub: ['Keep your prices current and your stock ready.', 'भाव ताज़ा रखें, स्टॉक तैयार रखें।'],
  },
  More: {
    en: 'More',
    hi: 'और',
    sub: [
      'Money, quotes, rates, people and store settings.',
      'हिसाब, थोक भाव, भाव सूची, लोग और सेटिंग।',
    ],
  },
  Money: {
    en: 'Money',
    hi: 'हिसाब',
    sub: [
      'Cash, UPI, counter sales and refunds for any days.',
      'किसी भी दिन का नकद, UPI, काउंटर बिक्री और वापसी।',
    ],
  },
  'Rate Studio': {
    en: 'Rate Studio',
    hi: 'भाव की सूची',
    sub: [
      'Review prices. Publish with confidence. Share your rates.',
      'भाव जाँचें, लागू करें, शेयर करें।',
    ],
  },
  'Bulk quotes': {
    en: 'Bulk quotes',
    hi: 'थोक भाव',
    sub: ['Better prices for bigger plans.', 'बड़े काम के लिए सही भाव।'],
  },
  Customers: {
    en: 'Customers',
    hi: 'ग्राहक',
    sub: ['The people building with you.', 'आपके साथ घर बनाने वाले लोग।'],
  },
  'Staff & alerts': {
    en: 'Staff & alerts',
    hi: 'स्टाफ़ और अलर्ट',
    sub: [
      'Who works the desk and how they hear about new work.',
      'कौन डेस्क चलाता है और नए काम की ख़बर कैसे मिलती है।',
    ],
  },
  'Finance & settings': {
    en: 'Finance & settings',
    hi: 'दुकान की सेटिंग',
    sub: [
      'Your store, your delivery charges, your controls.',
      'आपकी दुकान, आपका भाड़ा, आपके नियम।',
    ],
  },
  'Store activity': {
    en: 'Store activity',
    hi: 'दुकान का हिसाब-किताब',
    sub: [
      'A record of changes, decisions and staff actions.',
      'हर बदलाव, फ़ैसले और स्टाफ़ के काम का रिकॉर्ड।',
    ],
  },
};
const secondaryNavigation = [
  { label: 'Money', icon: IndianRupee },
  { label: 'Bulk quotes', icon: ClipboardList },
  { label: 'Rate Studio', icon: ClipboardList },
  { label: 'Customers', icon: Users },
  { label: 'Staff & alerts', icon: BellRing },
  { label: 'Finance & settings', icon: Settings2 },
  { label: 'Store activity', icon: Activity },
] as const;
const navigation = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Orders', icon: ShoppingBag },
  { label: 'Products', icon: Package },
  { label: 'More', icon: Menu },
] as const;
const routes: Record<Tab, string> = {
  Overview: 'today',
  Orders: 'orders',
  Products: 'prices-stock',
  More: 'more',
  Money: 'money',
  'Rate Studio': 'rate-studio',
  'Bulk quotes': 'quotes',
  Customers: 'customers',
  'Staff & alerts': 'staff',
  'Finance & settings': 'settings',
  'Store activity': 'activity',
};
const contractorText = (t: Words): Record<string, string> => ({
  NONE: t('Not requested', 'माँगा नहीं'),
  PENDING: t('Waiting for decision', 'फ़ैसला बाकी'),
  VERIFIED: t('Verified', 'सत्यापित'),
  REJECTED: t('Not verified', 'सत्यापित नहीं'),
});
type Connection = { kind: 'connecting' | 'checked' | 'problem'; at?: Date };

export default function Page() {
  const [session, setSession] = useState(0);
  return (
    <LanguageProvider>
      <StoreDesk key={session} recoverSession={() => setSession((value) => value + 1)} />
    </LanguageProvider>
  );
}

function LanguageSwitch() {
  const { language, setLanguage } = useLanguage();
  return (
    <button
      className="secondary"
      aria-label={language === 'hi' ? 'Switch to English' : 'हिन्दी में देखें'}
      onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
    >
      {language === 'hi' ? 'English' : 'हिन्दी'}
    </button>
  );
}

function StoreDesk({ recoverSession }: { recoverSession: () => void }) {
  const { t, language, error: say } = useWords();
  const name = (tab: Tab) => (language === 'hi' ? screens[tab].hi : screens[tab].en);
  const discardRates = () =>
    window.confirm(t('Discard unsaved rate sheet edits?', 'भाव सूची के बिना सहेजे बदलाव हटाएँ?'));
  const discardQuote = () =>
    window.confirm(t('Discard unsaved quotation edits?', 'बिना भेजे भाव के बदलाव हटाएँ?'));
  const refreshSequence = useRef(0);
  const refreshing = useRef(false);
  const loadingMore = useRef(false);
  const pageSizes = useRef<Record<string, number>>({});
  const querySnapshot = useRef({ order: '', product: '', low: false });
  const lastNewWork = useRef<number | null>(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [quoteRequestedOnly, setQuoteRequestedOnly] = useState(false);
  const [connection, setConnection] = useState<Connection>({ kind: 'connecting' });
  // The live update stream is tracked apart from polling: a successful poll does not mean the
  // stream is back.
  const [liveDown, setLiveDown] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('Overview');
  const [rateDirty, setRateDirtyState] = useState(false);
  const rateDirtyRef = useRef(false);
  const activeHash = useRef('');
  const setRateDirty = useCallback((value: boolean) => {
    rateDirtyRef.current = value;
    setRateDirtyState(value);
  }, []);
  const [quoteDirty, setQuoteDirtyState] = useState(false);
  const quoteDirtyRef = useRef(false);
  const setQuoteDirty = useCallback((value: boolean) => {
    quoteDirtyRef.current = value;
    setQuoteDirtyState(value);
  }, []);
  // Confirm texts used inside the route listener, which is attached once.
  const confirmRef = useRef({ discardRates, discardQuote });
  confirmRef.current = { discardRates, discardQuote };
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [orderQuery, setOrderQuery] = useState('');
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  // The toast: a confirmation, or a failure shown as an alert rather than with a tick.
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const notice = useCallback(
    (text: string, error = false) => setMessage(text ? { text, error } : null),
    [],
  );
  // A failed sign-in check that was not the server saying "signed out" (an outage, a deploy).
  const [sessionUnknown, setSessionUnknown] = useState(false);
  // The raw failure is kept so its text follows a language switch.
  const [failure, setFailure] = useState<unknown>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [counterSale, setCounterSale] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [customer, setCustomer] = useState<
    | (Customer & {
        addresses: { id: string; line1: string; city: string; pincode: string }[];
        orders: Order[];
      })
    | null
  >(null);
  const navigate = useCallback((value: Tab, queue = '', order: string | null = null) => {
    const params = new URLSearchParams();
    if (queue) params.set('queue', queue);
    if (order) params.set('order', order);
    window.location.hash = `${routes[value]}${params.size ? '?' + params.toString() : ''}`;
    setTab(value);
    setSelectedOrder(order);
    setNavOpen(false);
    if (value === 'Orders') setOrderQuery(queue ? `queue=${encodeURIComponent(queue)}` : '');
    setLowStockOnly(value === 'Products' && queue === 'low-stock');
    setQuoteRequestedOnly(value === 'Bulk quotes' && queue === 'requested');
  }, []);
  useEffect(() => {
    const readRoute = () => {
      const [path, search = ''] = window.location.hash.slice(1).split('?');
      const current =
        (Object.keys(routes) as Tab[]).find((key) => routes[key] === path) || 'Overview';
      if (rateDirtyRef.current && current !== 'Rate Studio') {
        if (!confirmRef.current.discardRates()) {
          window.history.replaceState(null, '', activeHash.current || '#rate-studio');
          return;
        }
        setRateDirty(false);
      }
      if (quoteDirtyRef.current && current !== 'Bulk quotes') {
        if (!confirmRef.current.discardQuote()) {
          window.history.replaceState(null, '', activeHash.current || '#quotes');
          return;
        }
        setQuoteDirty(false);
      }
      activeHash.current = window.location.hash || '#today';
      const params = new URLSearchParams(search);
      const order = params.get('order');
      params.delete('order');
      setTab(current);
      setSelectedOrder(current === 'Orders' ? order : null);
      setNavOpen(false);
      if (current === 'Orders') setOrderQuery(params.toString());
      setLowStockOnly(current === 'Products' && params.get('queue') === 'low-stock');
      setQuoteRequestedOnly(current === 'Bulk quotes' && params.get('queue') === 'requested');
    };
    readRoute();
    window.addEventListener('hashchange', readRoute);
    return () => window.removeEventListener('hashchange', readRoute);
  }, [setRateDirty, setQuoteDirty]);
  const filterOrders = useCallback(
    (query: string) => {
      setOrderQuery(query);
      const params = new URLSearchParams(query);
      if (selectedOrder) params.set('order', selectedOrder);
      window.history.replaceState(null, '', `#orders${params.size ? '?' + params.toString() : ''}`);
    },
    [selectedOrder],
  );
  const checkSession = useCallback(
    () =>
      api<User>('/me')
        .then((me) => {
          setUser(me);
          setSessionUnknown(false);
        })
        // Only the server saying so means signed out; staff with a valid session must not be
        // sent to the sign-in form (and to request codes) while the server is unreachable.
        .catch((e) => setSessionUnknown(!(e instanceof ApiError && e.code === 'UNAUTHORIZED')))
        .finally(() => setChecking(false)),
    [],
  );
  useEffect(() => {
    void checkSession();
  }, [checkSession]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), message.error ? 10000 : 6000);
    return () => clearTimeout(id);
  }, [message]);
  const refresh = useCallback(
    async (quiet = false) => {
      if (user?.role !== 'ADMIN' || (quiet && (refreshing.current || loadingMore.current))) return;
      const sequence = ++refreshSequence.current;
      refreshing.current = true;
      if (!quiet) setBusy(true);
      if (querySnapshot.current.order !== orderQuery) pageSizes.current.Orders = 0;
      if (
        querySnapshot.current.product !== productQuery ||
        querySnapshot.current.low !== lowStockOnly
      )
        pageSizes.current.Products = 0;
      querySnapshot.current = { order: orderQuery, product: productQuery, low: lowStockOnly };
      async function list<T>(path: string, key: string): Promise<PageResult<T>> {
        let page = await api<PageResult<T>>(path);
        const items = [...page.items];
        while (page.nextCursor && items.length < (pageSizes.current[key] || 0)) {
          page = await api<PageResult<T>>(
            `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(page.nextCursor)}`,
          );
          items.push(...page.items);
        }
        return { items, nextCursor: page.nextCursor };
      }
      const results = await Promise.allSettled([
        api<Dashboard>('/admin/dashboard'),
        list<Order>(`/admin/orders?${orderQuery}`, 'Orders'),
        list<Product>(
          `/admin/products?${productQuery}${lowStockOnly ? '&lowStock=true' : ''}`,
          'Products',
        ),
        api<Category[]>('/categories'),
        list<Quote>(`/admin/quotes${quoteRequestedOnly ? '?status=REQUESTED' : ''}`, 'Bulk quotes'),
        list<Customer>('/admin/customers', 'Customers'),
        api<StoreSettings>('/store'),
      ]);
      if (sequence !== refreshSequence.current) return;
      const [d, o, p, c, q, u, settingsResult] = results;
      if (d.status === 'fulfilled') setDashboard(d.value);
      if (o.status === 'fulfilled') setOrders(o.value.items);
      if (p.status === 'fulfilled') setProducts(p.value.items);
      if (c.status === 'fulfilled') setCategories(c.value);
      if (q.status === 'fulfilled') setQuotes(q.value.items);
      if (u.status === 'fulfilled') setCustomers(u.value.items);
      if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value);
      for (const [key, result] of [
        ['Orders', o],
        ['Products', p],
        ['Bulk quotes', q],
        ['Customers', u],
      ] as const) {
        if (result.status === 'fulfilled') {
          pageSizes.current[key] = result.value.items.length;
          setCursors((old) => ({ ...old, [key]: result.value.nextCursor }));
        }
      }
      const failed = results.find((result) => result.status === 'rejected');
      setSessionExpired(
        results.some(
          (result) =>
            result.status === 'rejected' &&
            result.reason instanceof ApiError &&
            result.reason.code === 'UNAUTHORIZED',
        ),
      );
      setFailure(failed?.status === 'rejected' ? failed.reason : null);
      setConnection(failed ? { kind: 'problem' } : { kind: 'checked', at: new Date() });
      refreshing.current = false;
      setBusy(false);
    },
    [user, productQuery, orderQuery, lowStockOnly, quoteRequestedOnly],
  );
  // The live stream and polling call the latest refresh through a ref, so a new search or
  // filter does not close and reopen the stream.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    const update = () => {
      if (document.visibilityState === 'visible') void refreshRef.current(true);
    };
    let source: EventSource;
    let retry = 0;
    let delay = 5000;
    const connect = () => {
      source = new EventSource(`${API_URL}/admin/events`, { withCredentials: true });
      source.onopen = () => {
        delay = 5000;
        setLiveDown(false);
        update();
      };
      source.onmessage = update;
      source.onerror = () => {
        setLiveDown(true);
        // Browsers retry a dropped stream themselves, but Safari gives up for good when the
        // first attempt fails; reconnect in that case (after 5 s, then every 15 s like polling).
        if (source.readyState === EventSource.CLOSED) {
          window.clearTimeout(retry);
          retry = window.setTimeout(connect, delay);
          delay = 15000;
        }
      };
    };
    connect();
    // A push alert reaching an open desk refreshes it at once.
    const pushed = (event: MessageEvent) => {
      if (event.data?.type === 'shiv-owner-push') update();
    };
    void registerWorker()?.catch(() => {});
    navigator.serviceWorker?.addEventListener('message', pushed);
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    const timer = window.setInterval(update, 15000);
    return () => {
      source.close();
      window.clearTimeout(retry);
      window.clearInterval(timer);
      navigator.serviceWorker?.removeEventListener('message', pushed);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [user?.role]);
  // A bell and the home-screen badge when new work arrives while the desk is open.
  useEffect(() => {
    if (!dashboard) return;
    const count = dashboard.newWork;
    if (lastNewWork.current !== null && count > lastNewWork.current && soundOn()) chime();
    lastNewWork.current = count;
    setBadge(count);
  }, [dashboard]);
  async function more() {
    if (!cursors[tab] || busy || loadingMore.current) return;
    loadingMore.current = true;
    const sequence = refreshSequence.current;
    setBusy(true);
    try {
      const path =
        tab === 'Products'
          ? `/admin/products?${productQuery}${lowStockOnly ? '&lowStock=true' : ''}&`
          : tab === 'Orders'
            ? `/admin/orders?${orderQuery}&`
            : tab === 'Bulk quotes'
              ? `/admin/quotes?${quoteRequestedOnly ? 'status=REQUESTED&' : ''}`
              : '/admin/customers?';
      const page = await api<PageResult<Order | Product | Quote | Customer>>(
        `${path}cursor=${encodeURIComponent(cursors[tab]!)}`,
      );
      if (sequence !== refreshSequence.current) return;
      if (tab === 'Products') setProducts((old) => [...old, ...(page.items as Product[])]);
      if (tab === 'Orders') setOrders((old) => [...old, ...(page.items as Order[])]);
      if (tab === 'Bulk quotes') setQuotes((old) => [...old, ...(page.items as Quote[])]);
      if (tab === 'Customers') setCustomers((old) => [...old, ...(page.items as Customer[])]);
      pageSizes.current[tab] = (pageSizes.current[tab] || 0) + page.items.length;
      setCursors((old) => ({ ...old, [tab]: page.nextCursor }));
    } catch (e) {
      setFailure(e);
      setSessionExpired(e instanceof ApiError && e.code === 'UNAUTHORIZED');
    } finally {
      loadingMore.current = false;
      setBusy(false);
    }
  }
  if (checking)
    return (
      <div className="loading-page">
        <span className="stamp" aria-hidden="true">
          शिव
        </span>
        <p>{t('Opening your store desk…', 'दुकान डेस्क खुल रहा है…')}</p>
      </div>
    );
  if (sessionUnknown)
    return (
      <div className="loading-page" role="alert">
        <span className="stamp" aria-hidden="true">
          शिव
        </span>
        <p>
          {t(
            'Could not check sign-in. Check the connection, then try again.',
            'साइन इन की जाँच नहीं हो सकी। इंटरनेट जाँचें, फिर कोशिश करें।',
          )}
        </p>
        <button
          className="primary"
          onClick={() => {
            setChecking(true);
            void checkSession();
          }}
        >
          {t('Try again', 'फिर कोशिश करें')}
        </button>
        <LanguageSwitch />
      </div>
    );
  if (!user || user.role !== 'ADMIN') return <Login onLogin={setUser} forbidden={Boolean(user)} />;
  const destination = navigation.some((item) => item.label === tab) ? tab : 'More';
  const leaveEdits = (value: Tab) => {
    if (value === tab) return true;
    if (rateDirty && !discardRates()) return false;
    if (quoteDirty && !discardQuote()) return false;
    setRateDirty(false);
    setQuoteDirty(false);
    return true;
  };
  const changeTab = (value: Tab) => {
    if (leaveEdits(value)) navigate(value);
  };
  const go = (value: Tab, queue: string) => {
    if (leaveEdits(value)) navigate(value, queue);
  };
  const openOrder = (id: string) => {
    if (rateDirty && !discardRates()) return;
    if (quoteDirty && !discardQuote()) return;
    setRateDirty(false);
    setQuoteDirty(false);
    navigate('Orders', new URLSearchParams(orderQuery).get('queue') || '', id);
  };
  const connectionText = {
    connecting: t('Connecting…', 'जुड़ रहे हैं…'),
    checked: t(
      `Queue checked · ${connection.at?.toLocaleTimeString('en-IN') || ''}`,
      `काम जाँचा · ${connection.at?.toLocaleTimeString('hi-IN') || ''}`,
    ),
    problem: t(
      'Connection problem · saved screen kept; retrying',
      'संपर्क में दिक्कत · पुरानी स्क्रीन दिख रही है; फिर कोशिश जारी',
    ),
    interrupted: t(
      'Live connection interrupted · checking every 15 seconds',
      'लाइव संपर्क टूटा · हर 15 सेकंड में जाँच',
    ),
  }[connection.kind === 'checked' && liveDown ? 'interrupted' : connection.kind];
  const contractor = contractorText(t);
  return (
    <div className="shell">
      <aside id="store-navigation" className={`sidebar ${navOpen ? 'open' : ''}`}>
        <a href="/" className="brand">
          <span className="stamp" aria-hidden="true">
            शिव
          </span>
          <span className="brand-name">
            {t('Shiv Cement Store', 'शिव सीमेंट स्टोर')}
            <small>{t('Store desk · ledger', 'दुकान डेस्क · बही-खाता')}</small>
          </span>
        </a>
        <nav aria-label={t('Main navigation', 'मुख्य मेनू')}>
          {navigation.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={destination === label ? 'active' : ''}
              onClick={() => changeTab(label)}
            >
              <Icon size={19} />
              {name(label)}
              {label === 'Orders' && dashboard && dashboard.pendingOrders > 0 && (
                <span className="nav-count">{dashboard.pendingOrders}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="service-area">
            <span className="live-dot" />
            <span>{t('Serving Patna & Bihar', 'पटना और बिहार में सेवा')}</span>
          </div>
          <div className="admin-user">
            <span className="avatar">SC</span>
            <div>
              <strong>{user.name || t('Store owner', 'दुकान मालिक')}</strong>
              <small>{t('Staff', 'स्टाफ़')}</small>
            </div>
            <button
              className="icon-button"
              aria-label={t('Sign out', 'साइन आउट')}
              onClick={async () => {
                if (
                  !window.confirm(t('Sign out of the store desk?', 'दुकान डेस्क से साइन आउट करें?'))
                )
                  return;
                try {
                  await api('/auth/logout', 'POST', {});
                  setBadge(0);
                  setUser(null);
                } catch (e) {
                  notice(say(e), true);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {navOpen && (
        <button
          className="nav-scrim"
          aria-label={t('Close menu', 'मेनू बंद करें')}
          onClick={() => setNavOpen(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label={t('Open menu', 'मेनू खोलें')}
              aria-expanded={navOpen}
              aria-controls="store-navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={22} />
            </button>
            <span className="stamp topbar-stamp" aria-hidden="true">
              शिव
            </span>
            <span>{t('Store desk', 'दुकान डेस्क')}</span>
            <ChevronRight size={14} />
            <b>{name(tab)}</b>
          </div>
          <div className="topbar-actions">
            <LanguageSwitch />
            <span className="date-label">{dateLabel(new Date(), language)}</span>
            <button
              className="icon-button"
              aria-label={t('Refresh data', 'नया डेटा लाएँ')}
              disabled={busy}
              onClick={() => {
                window.dispatchEvent(new Event('shiv-owner-refresh'));
                void refresh();
              }}
            >
              <RefreshCw size={18} className={busy ? 'spin' : ''} />
            </button>
            <button
              className="icon-button"
              aria-label={t('View pending orders', 'बाकी ऑर्डर देखें')}
              onClick={() => changeTab('Orders')}
            >
              <Bell size={19} />
            </button>
          </div>
        </header>
        <main>
          {tab !== 'Rate Studio' && (
            <div className="page-heading">
              <div>
                <h1>{name(tab)}</h1>
                <p>{t(...screens[tab].sub)}</p>
              </div>
              {tab === 'Overview' && (
                <button className="primary" onClick={() => changeTab('Orders')}>
                  {t('Manage orders', 'ऑर्डर सँभालें')}
                  <ArrowUpRight size={17} />
                </button>
              )}
            </div>
          )}
          <p className="hint" role="status">
            {connectionText}
          </p>
          {Boolean(failure) && (
            <div className="error" role="alert">
              {say(failure)}{' '}
              <button
                className="text-button"
                onClick={() => {
                  if (!sessionExpired) return void refresh();
                  if (rateDirty && !discardRates()) return;
                  if (quoteDirty && !discardQuote()) return;
                  recoverSession();
                }}
              >
                {sessionExpired
                  ? t('Sign in again', 'फिर साइन इन करें')
                  : t('Try again', 'फिर कोशिश करें')}
              </button>
            </div>
          )}
          {!dashboard && busy ? (
            <div className="skeleton-grid">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton" />
              ))}
            </div>
          ) : tab === 'Overview' && dashboard ? (
            <>
              <section className="owner-queue-tabs" aria-label={t("Today's work", 'आज का काम')}>
                <button className="primary" onClick={() => navigate('Orders', 'new')}>
                  {t('New work', 'नया काम')} · {dashboard.newWork}
                </button>
                <button className="secondary" onClick={() => navigate('Orders', 'dispatch')}>
                  {t('Dispatch due', 'भेजना है')} · {dashboard.pendingOrders}
                </button>
                <button className="secondary" onClick={() => navigate('Orders', 'payments')}>
                  {t('Money to confirm', 'पैसा लेना है')} · {dashboard.pendingPayments}
                </button>
                <button className="secondary" onClick={() => navigate('Orders', 'issues')}>
                  {t('Unresolved issues', 'समस्या')} · {dashboard.issues}
                </button>
                <button className="secondary" onClick={() => navigate('Bulk quotes', 'requested')}>
                  {t('New quotations', 'नये थोक अनुरोध')} · {dashboard.bulkRequests}
                </button>
              </section>
              <section className="quick-actions" aria-label={t('Quick actions', 'तुरंत काम')}>
                <button className="secondary" onClick={() => setCounterSale(true)}>
                  <Store size={19} /> {t('Counter sale', 'काउंटर बिक्री')}
                </button>
                <button className="secondary" onClick={() => changeTab('Money')}>
                  <IndianRupee size={19} /> {t('Today’s money', 'आज का हिसाब')}
                </button>
                <button className="secondary" onClick={() => go('Products', 'low-stock')}>
                  <Package size={19} /> {t('Low stock', 'कम स्टॉक')} · {dashboard.lowStock.length}
                </button>
              </section>
              <section
                className="stats-grid"
                aria-label={t("Today's store metrics", 'आज के आँकड़े')}
              >
                {[
                  {
                    label: t('App collections', 'आज की वसूली'),
                    value: money(dashboard.todaySalesPaise),
                    note: t(
                      'Cash/UPI received + verified online payments',
                      'मिला नकद/UPI + जाँचा ऑनलाइन भुगतान',
                    ),
                  },
                  {
                    label: t('Today’s orders', 'आज के ऑर्डर'),
                    value: String(dashboard.todayOrders).padStart(2, '0'),
                    note: t(
                      `${dashboard.pendingOrders} awaiting fulfilment`,
                      `${dashboard.pendingOrders} भेजना बाकी`,
                    ),
                  },
                  {
                    label: t('Out for delivery', 'रास्ते में'),
                    value: String(dashboard.pendingDeliveries).padStart(2, '0'),
                    note: t('On their way to your customers', 'ग्राहकों तक जा रहे हैं'),
                  },
                  {
                    label: t('Bulk requests', 'थोक अनुरोध'),
                    value: String(dashboard.bulkRequests).padStart(2, '0'),
                    note: t('Ready for your best offer', 'आपके भाव का इंतज़ार'),
                  },
                ].map(({ label, value, note }) => (
                  <article className="stat-card" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>{note}</small>
                  </article>
                ))}
              </section>
              <section
                className="panel padded"
                aria-label={t('Collection breakdown', 'वसूली का ब्योरा')}
              >
                <p>
                  {t('Counter collections', 'काउंटर बिक्री')}:{' '}
                  <strong>{money(dashboard.todayCounterSalesPaise)}</strong> ·{' '}
                  {t('Refunds returned', 'लौटाया पैसा')}:{' '}
                  <strong>{money(dashboard.todayRefundsPaise)}</strong> ·{' '}
                  {t('Net collected', 'कुल मिला')}:{' '}
                  <strong>
                    {money(
                      dashboard.todaySalesPaise +
                        dashboard.todayCounterSalesPaise -
                        dashboard.todayRefundsPaise,
                    )}
                  </strong>
                </p>
                <small>
                  {t(
                    'By business event time (India). Collections are not profit; purchase costs are not tracked. Older counter entries without recorded amounts are excluded.',
                    'भारतीय समय से। वसूली मुनाफ़ा नहीं है; ख़रीद की लागत दर्ज नहीं होती। बिना रकम वाली पुरानी काउंटर एंट्री शामिल नहीं।',
                  )}
                </small>
              </section>
              <div className="overview-grid">
                <section className="panel">
                  <SectionTitle
                    title={t('Recent orders', 'हाल के ऑर्डर')}
                    sub={t('Your latest orders, all in one place.', 'आपके नए ऑर्डर, एक जगह।')}
                    action={t('View all', 'सब देखें')}
                    onAction={() => changeTab('Orders')}
                  />
                  <OrdersTable orders={dashboard.recentOrders} select={openOrder} />
                </section>
                <aside className="form-stack">
                  <section className="panel padded">
                    <div className="section-title compact">
                      <h2>{t('Needs attention', 'ध्यान दें')}</h2>
                      <Activity size={18} />
                    </div>
                    <button className="attention" onClick={() => navigate('Orders', 'payments')}>
                      <span className="attention-icon">
                        <IndianRupee size={18} />
                      </span>
                      <span>
                        <strong>{t('Payments pending', 'पैसा बाकी')}</strong>
                        <small>
                          {t(
                            `${dashboard.pendingPayments} orders to follow up`,
                            `${dashboard.pendingPayments} ऑर्डर का पैसा लेना है`,
                          )}
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                    <button className="attention" onClick={() => navigate('Products', 'low-stock')}>
                      <span className="attention-icon amber">
                        <Package size={18} />
                      </span>
                      <span>
                        <strong>{t('Running low', 'स्टॉक कम')}</strong>
                        <small>
                          {t(
                            `${dashboard.lowStock.length} products at or below their alert level`,
                            `${dashboard.lowStock.length} सामग्री चेतावनी स्तर पर या नीचे`,
                          )}
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                    <button
                      className="attention"
                      onClick={() => navigate('Bulk quotes', 'requested')}
                    >
                      <span className="attention-icon green">
                        <ClipboardList size={18} />
                      </span>
                      <span>
                        <strong>{t('Bulk quotations', 'थोक भाव')}</strong>
                        <small>
                          {t(
                            `${dashboard.bulkRequests} requests awaiting prices`,
                            `${dashboard.bulkRequests} अनुरोध भाव के इंतज़ार में`,
                          )}
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  </section>
                  <section className="delivery-card">
                    <Truck size={25} />
                    <h3>{t('Delivery, your way.', 'डिलीवरी, आपके हिसाब से।')}</h3>
                    <p>
                      {t(
                        'Set delivery areas, charges and terms that work for your store and your customers.',
                        'डिलीवरी क्षेत्र, भाड़ा और शर्तें अपनी दुकान और ग्राहकों के हिसाब से तय करें।',
                      )}
                    </p>
                    <button className="text-button" onClick={() => changeTab('Finance & settings')}>
                      {t('Manage delivery fees', 'भाड़ा सँभालें')}
                      <ArrowRight size={16} />
                    </button>
                  </section>
                </aside>
              </div>
            </>
          ) : null}
          {tab === 'More' && (
            <section className="owner-more-grid">
              {secondaryNavigation.map(({ label, icon: Icon }) => (
                <button className="secondary" key={label} onClick={() => changeTab(label)}>
                  <Icon size={20} />
                  {name(label)}
                </button>
              ))}
            </section>
          )}
          {tab === 'Products' && lowStockOnly && (
            <p className="notice">
              {t('Products at or below their low-stock alert', 'कम स्टॉक वाली सामग्री')}{' '}
              <button className="text-button" onClick={() => navigate('Products')}>
                {t('Show all products', 'सारी सामग्री दिखाएँ')}
              </button>
            </p>
          )}
          {tab === 'Bulk quotes' && quoteRequestedOnly && (
            <p className="notice">
              {t('Requested quotations', 'नये थोक अनुरोध')}{' '}
              <button className="text-button" onClick={() => navigate('Bulk quotes')}>
                {t('Show all quotes', 'सारे भाव दिखाएँ')}
              </button>
            </p>
          )}
          {tab === 'Money' && <MoneyReport />}
          {tab === 'Staff & alerts' && <StaffAlerts me={user.id} />}
          {tab === 'Rate Studio' && (
            <RateStudio
              categories={categories}
              refresh={refresh}
              notice={notice}
              onDirtyChange={setRateDirty}
            />
          )}
          {tab === 'Products' && (
            <Products
              onFilter={setProductQuery}
              products={products}
              categories={categories}
              refresh={refresh}
              notice={notice}
            />
          )}
          {tab === 'Orders' && (
            <Orders
              onFilter={filterOrders}
              query={orderQuery}
              onQueue={(queue) => navigate('Orders', queue)}
              orders={orders}
              refresh={refresh}
              notice={notice}
              selectedId={selectedOrder}
              setSelectedId={(id) => {
                setSelectedOrder(id);
                const params = new URLSearchParams(orderQuery);
                if (id) params.set('order', id);
                window.location.hash = `orders${params.size ? '?' + params.toString() : ''}`;
              }}
            />
          )}
          {tab === 'Bulk quotes' && (
            <Quotes
              quotes={quotes}
              refresh={refresh}
              notice={notice}
              onDirtyChange={setQuoteDirty}
            />
          )}
          {tab === 'Finance & settings' && settings && (
            <>
              <DeliveryZones />
              <StaffSessions />
              <SecurityControls />
              <Settings settings={settings} refresh={refresh} notice={notice} />
            </>
          )}
          {tab === 'Customers' && (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Customer', 'ग्राहक')}</th>
                    <th>{t('Phone', 'फ़ोन')}</th>
                    <th>{t('Type', 'प्रकार')}</th>
                    <th>{t('Orders', 'ऑर्डर')}</th>
                    <th>{t('Joined', 'जुड़े')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name || t('New customer', 'नया ग्राहक')}</strong>
                      </td>
                      <td>{c.phone}</td>
                      <td>
                        <Badge value={c.role} />
                      </td>
                      <td>{c._count.orders}</td>
                      <td>{dateLabel(c.createdAt, language)}</td>
                      <td>
                        <button
                          className="text-button"
                          aria-label={`${t('View', 'देखें')} ${c.name || c.phone}`}
                          onClick={async () => {
                            try {
                              setCustomer(await api(`/admin/customers/${c.id}`));
                            } catch (e) {
                              notice(say(e), true);
                            }
                          }}
                        >
                          {t('View', 'देखें')}
                          <ArrowUpRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!customers.length && (
                <Empty
                  title={t('Your community starts here', 'आपके ग्राहक यहाँ दिखेंगे')}
                  body={t(
                    'Customers appear here after they sign in.',
                    'ग्राहक साइन इन करने के बाद यहाँ आते हैं।',
                  )}
                />
              )}
            </div>
          )}
          {tab === 'Store activity' && <AuditHistory />}
          {cursors[tab] && (
            <button className="secondary load-more" disabled={busy} onClick={() => void more()}>
              {busy ? t('Loading…', 'लोड हो रहा है…') : t('Load more', 'और दिखाएँ')}
            </button>
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={14} />{' '}
              {t('Your store. Built on trust.', 'आपकी दुकान। भरोसे पर बनी।')}
            </span>
            <span>{t('Shiv Cement Store · Patna, Bihar', 'शिव सीमेंट स्टोर · पटना, बिहार')}</span>
          </footer>
        </main>
      </div>
      <nav className="owner-bottom-nav" aria-label={t('Phone navigation', 'फ़ोन मेनू')}>
        {navigation.map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={destination === label ? 'active' : ''}
            aria-current={destination === label ? 'page' : undefined}
            onClick={() => changeTab(label)}
          >
            <Icon size={21} />
            <span>{name(label)}</span>
          </button>
        ))}
      </nav>
      {message && (
        <div
          className={message.error ? 'toast toast-error' : 'toast'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.error ? <CircleAlert size={18} /> : <Check size={18} />}
          {message.text}
          <button
            aria-label={t('Dismiss notification', 'सूचना हटाएँ')}
            onClick={() => setMessage(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {counterSale && (
        <CounterSale
          close={() => setCounterSale(false)}
          done={async (text) => {
            setCounterSale(false);
            notice(text);
            window.dispatchEvent(new Event('shiv-owner-refresh'));
            await refresh();
          }}
        />
      )}
      {customer && (
        <Modal
          title={customer.name || t('Customer details', 'ग्राहक की जानकारी')}
          close={() => setCustomer(null)}
        >
          <div className="form-stack">
            <p>
              {customer.phone} ·{' '}
              {t(`${customer._count.orders} orders`, `${customer._count.orders} ऑर्डर`)}
            </p>
            <h3>
              {t('Contractor verification', 'ठेकेदार सत्यापन')} ·{' '}
              {contractor[customer.contractorStatus || 'NONE'] || customer.contractorStatus}
            </h3>
            <p>
              {t(
                'Verification records a store decision only. It does not grant credit or special prices.',
                'सत्यापन सिर्फ़ दुकान का फ़ैसला दर्ज करता है। इससे उधार या ख़ास भाव नहीं मिलता।',
              )}
            </p>
            {customer.contractorStatus !== 'NONE' && customer.role !== 'ADMIN' && (
              <form
                className="form-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  try {
                    await api(`/admin/customers/${customer.id}/contractor`, 'PATCH', {
                      status: f.get('status'),
                      note: f.get('note'),
                    });
                    setCustomer(await api(`/admin/customers/${customer.id}`));
                    await refresh();
                    notice(t('Contractor verification recorded', 'ठेकेदार सत्यापन दर्ज'));
                  } catch (err) {
                    notice(say(err), true);
                  }
                }}
              >
                <Field label={t('Decision', 'फ़ैसला')}>
                  <select name="status">
                    <option value="VERIFIED">
                      {t('Verify contractor', 'ठेकेदार सत्यापित करें')}
                    </option>
                    <option value="REJECTED">
                      {t('Reject / revoke verification', 'अस्वीकार / सत्यापन हटाएँ')}
                    </option>
                  </select>
                </Field>
                <Field label={t('Verification evidence / reason', 'सबूत / कारण')}>
                  <input name="note" required maxLength={500} />
                </Field>
                <button className="primary">{t('Record verification', 'फ़ैसला दर्ज करें')}</button>
              </form>
            )}
            <h3>{t('Saved addresses', 'सहेजे पते')}</h3>
            {customer.addresses.map((a) => (
              <p key={a.id}>
                {a.line1}, {a.city} {a.pincode}
              </p>
            ))}
            <h3>{t('Five most recent orders', 'हाल के पाँच ऑर्डर')}</h3>
            {customer.orders.map((o) => (
              <button
                className="line-item"
                key={o.id}
                onClick={() => {
                  setCustomer(null);
                  openOrder(o.id);
                }}
              >
                <strong>{o.number}</strong>
                <span>{money(o.totalPaise)}</span>
                <Badge value={o.status} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
function Login({ onLogin, forbidden }: { onLogin: (u: User) => void; forbidden: boolean }) {
  const { t, error: say } = useWords();
  const noAccess = t(
    'This account does not have store staff access. Ask the owner to grant access.',
    'इस खाते को दुकान डेस्क की अनुमति नहीं है। मालिक से अनुमति माँगें।',
  );
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState(forbidden ? noAccess : '');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!sent) {
        const r = await api<{ devCode?: string }>('/auth/otp/request', 'POST', {
          phone: `+91${phone}`,
        });
        setSent(true);
        setDevCode(r.devCode || '');
      } else {
        const r = await api<{ user: User }>('/auth/otp/verify', 'POST', {
          phone: `+91${phone}`,
          code,
          ...(adminPassword ? { adminPassword } : {}),
        });
        if (r.user.role !== 'ADMIN') {
          await api('/auth/logout', 'POST', {});
          setError(noAccess);
          setSent(false);
        } else onLogin(r.user);
      }
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <a className="brand" href="/">
          <span className="stamp" aria-hidden="true">
            शिव
          </span>
          <span className="brand-name">
            {t('Shiv Cement Store', 'शिव सीमेंट स्टोर')}
            <small>{t('Store desk · ledger', 'दुकान डेस्क · बही-खाता')}</small>
          </span>
        </a>
        <div>
          <h1>{t('Good foundations. Great business.', 'मज़बूत नींव। बढ़िया कारोबार।')}</h1>
          <p>
            {t(
              'Everything you need to keep Bihar building, all in one place.',
              'बिहार को बनाते रहने के लिए सब कुछ, एक जगह।',
            )}
          </p>
        </div>
        <small>{t('Serving Patna & Bihar', 'पटना और बिहार में सेवा')}</small>
      </section>
      <section className="login-form">
        <div>
          <div className="login-language">
            <LanguageSwitch />
          </div>
          <h2>{t('Welcome back.', 'नमस्ते।')}</h2>
          <p className="muted">
            {t('Sign in to manage your store.', 'दुकान सँभालने के लिए साइन इन करें।')}
          </p>
          <form onSubmit={submit} className="form-stack">
            <Field label={t('Staff mobile number', 'स्टाफ़ का मोबाइल नंबर')}>
              <div className="phone-input">
                <span>+91</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={phone}
                  disabled={sent}
                  onChange={(e) => setPhone(phoneDigits(e.target.value))}
                  required
                  pattern="[6-9][0-9]{9}"
                  aria-label={t('Staff mobile number', 'स्टाफ़ का मोबाइल नंबर')}
                />
              </div>
            </Field>
            {sent && (
              <Field label={t('6-digit verification code', '6 अंकों का कोड')}>
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  pattern="[0-9]{6}"
                  required
                  aria-label={t('Verification code', 'कोड')}
                />
              </Field>
            )}
            {sent && (
              <Field label={t('Staff passphrase', 'स्टाफ़ पासफ़्रेज़')}>
                <input
                  aria-label={t('Staff passphrase', 'स्टाफ़ पासफ़्रेज़')}
                  type="password"
                  autoComplete="current-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  minLength={12}
                />
              </Field>
            )}
            {devCode && (
              <p className="warning">
                {t('Local development · code', 'लोकल जाँच · कोड')} <strong>{devCode}</strong>
                <br />
                {t('No SMS was sent.', 'कोई SMS नहीं भेजा गया।')}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy
                ? t('Please wait…', 'रुकिए…')
                : sent
                  ? t('Open store desk', 'दुकान डेस्क खोलें')
                  : t('Get verification code', 'कोड भेजें')}
              <ArrowRight size={18} />
            </button>
            {sent && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setSent(false);
                  setCode('');
                  setDevCode('');
                }}
              >
                {t('Use another number', 'दूसरा नंबर डालें')}
              </button>
            )}
          </form>
          <p className="login-security">
            <ShieldCheck size={16} />
            {t(
              'Only authorised store staff can sign in.',
              'सिर्फ़ दुकान का अधिकृत स्टाफ़ साइन इन कर सकता है।',
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
