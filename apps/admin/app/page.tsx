'use client';
import { RateStudio } from '../components/rate-studio/studio';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  Check,
  ChevronRight,
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
  money,
} from '@shiv/shared';
import { API_URL, ApiError, api, errorMessage } from '../lib/api';
import { Badge, Empty, Field, Modal, SectionTitle } from '../components/ui';
import { Products } from '../components/products';
import { Orders, OrdersTable } from '../components/orders';
import { Quotes } from '../components/quotes';
import { SecurityControls } from '../components/security-controls';
import { Settings } from '../components/settings';
import { DeliveryZones, StaffSessions, AuditHistory } from '../components/operations';

type Tab =
  | 'More'
  | 'Overview'
  | 'Orders'
  | 'Products'
  | 'Rate Studio'
  | 'Bulk quotes'
  | 'Customers'
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
const secondaryNavigation = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Orders', icon: ShoppingBag },
  { label: 'Products', icon: Package },
  { label: 'Rate Studio', icon: ClipboardList },
  { label: 'Bulk quotes', icon: ClipboardList },
  { label: 'Customers', icon: Users },
  { label: 'Finance & settings', icon: Settings2 },
  { label: 'Store activity', icon: Activity },
] as const;
const navigation = [
  { label: 'Overview', hi: 'आज', en: 'Today', icon: LayoutDashboard },
  { label: 'Orders', hi: 'ऑर्डर', en: 'Orders', icon: ShoppingBag },
  { label: 'Products', hi: 'भाव और स्टॉक', en: 'Prices & stock', icon: Package },
  { label: 'More', hi: 'और', en: 'More', icon: Menu },
] as const;
const routes: Record<Tab, string> = {
  Overview: 'today',
  Orders: 'orders',
  Products: 'prices-stock',
  More: 'more',
  'Rate Studio': 'rate-studio',
  'Bulk quotes': 'quotes',
  Customers: 'customers',
  'Finance & settings': 'settings',
  'Store activity': 'activity',
};
export default function Page() {
  const [session, setSession] = useState(0);
  return <StoreDesk key={session} recoverSession={() => setSession((value) => value + 1)} />;
}

function StoreDesk({ recoverSession }: { recoverSession: () => void }) {
  const refreshSequence = useRef(0);
  const refreshing = useRef(false);
  const loadingMore = useRef(false);
  const pageSizes = useRef<Record<string, number>>({});
  const querySnapshot = useRef({ order: '', product: '', low: false });
  const [language, setLanguage] = useState<'hi' | 'en'>('hi');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [quoteRequestedOnly, setQuoteRequestedOnly] = useState(false);
  const [connection, setConnection] = useState('Connecting…');
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
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
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
    try {
      setLanguage(localStorage.getItem('shiv-owner-language') === 'en' ? 'en' : 'hi');
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
    const readRoute = () => {
      const [path, search = ''] = window.location.hash.slice(1).split('?');
      const current =
        (Object.keys(routes) as Tab[]).find((key) => routes[key] === path) || 'Overview';
      if (rateDirtyRef.current && current !== 'Rate Studio') {
        if (!window.confirm('Discard unsaved rate sheet edits?')) {
          window.history.replaceState(null, '', activeHash.current || '#rate-studio');
          return;
        }
        setRateDirty(false);
      }
      if (quoteDirtyRef.current && current !== 'Bulk quotes') {
        if (!window.confirm('Discard unsaved quotation edits? / बिना भेजे बदलाव हटाएँ?')) {
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
  }, []);
  const filterOrders = useCallback(
    (query: string) => {
      setOrderQuery(query);
      const params = new URLSearchParams(query);
      if (selectedOrder) params.set('order', selectedOrder);
      window.history.replaceState(null, '', `#orders${params.size ? '?' + params.toString() : ''}`);
    },
    [selectedOrder],
  );
  useEffect(() => {
    api<User>('/me')
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(''), 6000);
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
      setError(failed?.status === 'rejected' ? errorMessage(failed.reason) : '');
      setConnection(
        failed
          ? 'Connection problem · saved screen kept; retrying'
          : 'Queue checked · ' + new Date().toLocaleTimeString('en-IN'),
      );
      refreshing.current = false;
      setBusy(false);
    },
    [user, productQuery, orderQuery, lowStockOnly, quoteRequestedOnly],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    const update = () => {
      if (document.visibilityState === 'visible') void refresh(true);
    };
    const source = new EventSource(`${API_URL}/admin/events`, { withCredentials: true });
    source.onopen = update;
    source.onmessage = update;
    source.onerror = () => setConnection('Live connection interrupted · checking every 15 seconds');
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    const timer = window.setInterval(update, 15000);
    return () => {
      source.close();
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [refresh, user?.role]);
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
      setError(errorMessage(e));
      setSessionExpired(e instanceof ApiError && e.code === 'UNAUTHORIZED');
    } finally {
      loadingMore.current = false;
      setBusy(false);
    }
  }
  if (checking)
    return (
      <div className="loading-page">
        <Building2 size={36} />
        <p>Opening your store desk…</p>
      </div>
    );
  if (!user || user.role !== 'ADMIN') return <Login onLogin={setUser} forbidden={Boolean(user)} />;
  const destination = navigation.some((item) => item.label === tab) ? tab : 'More';
  const currentLabel = navigation.find((item) => item.label === tab);
  const changeTab = (value: Tab) => {
    if (value !== tab && rateDirty && !window.confirm('Discard unsaved rate sheet edits?')) return;
    if (
      value !== tab &&
      quoteDirty &&
      !window.confirm('Discard unsaved quotation edits? / बिना भेजे बदलाव हटाएँ?')
    )
      return;
    if (value !== tab) {
      setRateDirty(false);
      setQuoteDirty(false);
    }
    navigate(value);
  };
  const openOrder = (id: string) => {
    if (rateDirty && !window.confirm('Discard unsaved rate sheet edits?')) return;
    if (quoteDirty && !window.confirm('Discard unsaved quotation edits? / बिना भेजे बदलाव हटाएँ?'))
      return;
    setRateDirty(false);
    setQuoteDirty(false);
    navigate('Orders', new URLSearchParams(orderQuery).get('queue') || '', id);
  };
  return (
    <div className="shell">
      <aside id="store-navigation" className={`sidebar ${navOpen ? 'open' : ''}`}>
        <a href="/" className="brand">
          <span className="brand-icon">
            <Building2 size={25} />
          </span>
          <span>
            SHIV<span>CEMENT STORE</span>
          </span>
        </a>
        <div className="workspace-label">
          STORE DESK <span>ADMIN</span>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(({ label, hi, en, icon: Icon }) => (
            <button
              key={label}
              className={destination === label ? 'active' : ''}
              onClick={() => changeTab(label)}
            >
              <Icon size={19} />
              {language === 'hi' ? `${hi} / ${en}` : en}
              {label === 'Orders' && dashboard && dashboard.pendingOrders > 0 && (
                <span className="nav-count">{dashboard.pendingOrders}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="service-area">
            <span className="live-dot" />
            <span>Serving Patna & Bihar</span>
          </div>
          <div className="admin-user">
            <span className="avatar">SC</span>
            <div>
              <strong>{user.name || 'Store owner'}</strong>
              <small>Administrator</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await api('/auth/logout', 'POST', {});
                  setUser(null);
                } catch (e) {
                  setMessage(errorMessage(e));
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {navOpen && (
        <button className="nav-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open menu"
              aria-expanded={navOpen}
              aria-controls="store-navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={22} />
            </button>
            <span>Store desk</span>
            <ChevronRight size={14} />
            <b>{tab}</b>
          </div>
          <div className="topbar-actions">
            <button
              className="secondary"
              aria-label="Switch owner language"
              onClick={() => {
                const next = language === 'hi' ? 'en' : 'hi';
                setLanguage(next);
                try {
                  localStorage.setItem('shiv-owner-language', next);
                } catch {
                  /* Keep this visit usable when browser storage is disabled. */
                }
              }}
            >
              {language === 'hi' ? 'English' : 'हिन्दी'}
            </button>
            <span className="date-label">
              {new Date().toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                timeZone: 'Asia/Kolkata',
              })}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh data"
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
              aria-label="View pending orders"
              onClick={() => changeTab('Orders')}
            >
              <Bell size={19} />
            </button>
            <span className="avatar small">SC</span>
          </div>
        </header>
        <main>
          {tab !== 'Rate Studio' && (
            <div className="page-heading">
              <div>
                <span className="eyebrow">SHIV CEMENT STORE</span>
                <h1>
                  {currentLabel
                    ? language === 'hi'
                      ? `${currentLabel.hi} / ${currentLabel.en}`
                      : currentLabel.en
                    : tab}
                </h1>
                <p>
                  {
                    {
                      More: 'Quotations, pricing tools, people and store settings.',
                      Overview: 'Here’s what’s happening at your store today.',
                      Orders: 'From the first bag to the final delivery.',
                      Products: 'Keep your prices current and your stock ready.',
                      'Bulk quotes': 'Better prices for bigger plans.',
                      Customers: 'The people building with you.',
                      'Finance & settings': 'Your store, your delivery charges, your controls.',
                      'Rate Studio': 'Review prices. Publish with confidence. Share your rates.',
                      'Store activity': 'A record of changes, decisions and staff actions.',
                    }[tab]
                  }
                </p>
              </div>
              {tab === 'Overview' && (
                <button className="primary" onClick={() => changeTab('Orders')}>
                  Manage orders
                  <ArrowUpRight size={17} />
                </button>
              )}
            </div>
          )}
          <p className="hint" role="status">
            {connection}
          </p>
          {error && (
            <div className="error" role="alert">
              {error}{' '}
              <button
                className="text-button"
                onClick={() => {
                  if (!sessionExpired) return void refresh();
                  if (rateDirty && !window.confirm('Discard unsaved rate sheet edits?')) return;
                  if (
                    quoteDirty &&
                    !window.confirm('Discard unsaved quotation edits? / बिना भेजे बदलाव हटाएँ?')
                  )
                    return;
                  recoverSession();
                }}
              >
                {sessionExpired ? 'फिर साइन इन करें / Sign in again' : 'Try again'}
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
              <section className="owner-queue-tabs" aria-label="Today's work">
                <button className="primary" onClick={() => navigate('Orders', 'new')}>
                  नया काम / New work · {dashboard.newWork}
                </button>
                <button className="secondary" onClick={() => navigate('Orders', 'dispatch')}>
                  भेजना है / Dispatch due · {dashboard.pendingOrders}
                </button>
                <button className="secondary" onClick={() => navigate('Orders', 'payments')}>
                  पैसा लेना है / Money to confirm · {dashboard.pendingPayments}
                </button>
                <button className="secondary" onClick={() => navigate('Orders', 'issues')}>
                  समस्या / Unresolved issues · {dashboard.issues}
                </button>
                <button className="secondary" onClick={() => navigate('Bulk quotes', 'requested')}>
                  थोक अनुरोध / New quotations · {dashboard.bulkRequests}
                </button>
              </section>
              <section className="stats-grid" aria-label="Today's store metrics">
                {[
                  {
                    label: 'आज की वसूली / App collections',
                    value: money(dashboard.todaySalesPaise),
                    note: 'Cash received + verified online payments',
                    icon: IndianRupee,
                  },
                  {
                    label: 'Today’s orders',
                    value: String(dashboard.todayOrders).padStart(2, '0'),
                    note: `${dashboard.pendingOrders} awaiting fulfilment`,
                    icon: ShoppingBag,
                  },
                  {
                    label: 'Out for delivery',
                    value: String(dashboard.pendingDeliveries).padStart(2, '0'),
                    note: 'On their way to your customers',
                    icon: Truck,
                  },
                  {
                    label: 'Bulk requests',
                    value: String(dashboard.bulkRequests).padStart(2, '0'),
                    note: 'Ready for your best offer',
                    icon: ClipboardList,
                  },
                ].map(({ label, value, note, icon: Icon }) => (
                  <article className="stat-card" key={label}>
                    <div>
                      <span>{label}</span>
                      <Icon size={19} />
                    </div>
                    <strong>{value}</strong>
                    <small>{note}</small>
                  </article>
                ))}
              </section>
              <section className="panel padded" aria-label="Collection breakdown">
                <p>
                  काउंटर बिक्री / Counter collections:{' '}
                  <strong>{money(dashboard.todayCounterSalesPaise)}</strong> · रिफंड / Refunds
                  returned: <strong>{money(dashboard.todayRefundsPaise)}</strong> · Net collected:{' '}
                  <strong>
                    {money(
                      dashboard.todaySalesPaise +
                        dashboard.todayCounterSalesPaise -
                        dashboard.todayRefundsPaise,
                    )}
                  </strong>
                </p>
                <small>
                  By business event time (India). Collections are not profit; purchase costs are not
                  tracked. Older counter entries without recorded amounts are excluded.
                </small>
              </section>
              <div className="overview-grid">
                <section className="panel">
                  <SectionTitle
                    title="Recent orders"
                    sub="Your latest orders, all in one place."
                    action="View all"
                    onAction={() => changeTab('Orders')}
                  />
                  <OrdersTable orders={dashboard.recentOrders} select={openOrder} />
                </section>
                <aside className="form-stack">
                  <section className="panel padded">
                    <div className="section-title compact">
                      <h2>Needs attention</h2>
                      <Activity size={18} />
                    </div>
                    <button className="attention" onClick={() => navigate('Orders', 'payments')}>
                      <span className="attention-icon">
                        <IndianRupee size={18} />
                      </span>
                      <span>
                        <strong>Payments pending</strong>
                        <small>{dashboard.pendingPayments} orders to follow up</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                    <button className="attention" onClick={() => navigate('Products', 'low-stock')}>
                      <span className="attention-icon amber">
                        <Package size={18} />
                      </span>
                      <span>
                        <strong>Running low</strong>
                        <small>{dashboard.lowStock.length} products below 25 units</small>
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
                        <strong>Bulk quotations</strong>
                        <small>{dashboard.bulkRequests} requests awaiting prices</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  </section>
                  <section className="delivery-card">
                    <Truck size={25} />
                    <h3>Delivery, your way.</h3>
                    <p>Set a delivery charge that works for your store and your customers.</p>
                    <button className="text-button" onClick={() => changeTab('Finance & settings')}>
                      Manage delivery fees
                      <ArrowRight size={16} />
                    </button>
                  </section>
                </aside>
              </div>
            </>
          ) : null}
          {tab === 'More' && (
            <section className="owner-more-grid">
              {secondaryNavigation
                .filter(({ label }) => !['Overview', 'Orders', 'Products'].includes(label))
                .map(({ label, icon: Icon }) => (
                  <button className="secondary" key={label} onClick={() => changeTab(label)}>
                    <Icon size={20} />
                    {
                      (
                        {
                          'Rate Studio': 'भाव की सूची',
                          'Bulk quotes': 'थोक कोटेशन',
                          Customers: 'ग्राहक',
                          'Finance & settings': 'दुकान की सेटिंग',
                          'Store activity': 'दुकान का हिसाब',
                        } as Record<string, string>
                      )[label]
                    }{' '}
                    / {label}
                  </button>
                ))}
            </section>
          )}
          {tab === 'Products' && lowStockOnly && (
            <p className="notice">
              कम स्टॉक / Stock below 25 units{' '}
              <button className="text-button" onClick={() => navigate('Products')}>
                Show all products
              </button>
            </p>
          )}
          {tab === 'Bulk quotes' && quoteRequestedOnly && (
            <p className="notice">
              नये थोक अनुरोध / Requested quotations{' '}
              <button className="text-button" onClick={() => navigate('Bulk quotes')}>
                Show all quotes
              </button>
            </p>
          )}
          {tab === 'Rate Studio' && (
            <RateStudio
              categories={categories}
              refresh={refresh}
              notice={setMessage}
              onDirtyChange={setRateDirty}
            />
          )}
          {tab === 'Products' && (
            <Products
              onFilter={setProductQuery}
              products={products}
              categories={categories}
              refresh={refresh}
              notice={setMessage}
            />
          )}
          {tab === 'Orders' && (
            <Orders
              onFilter={filterOrders}
              query={orderQuery}
              onQueue={(queue) => navigate('Orders', queue)}
              orders={orders}
              refresh={refresh}
              notice={setMessage}
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
              notice={setMessage}
              onDirtyChange={setQuoteDirty}
            />
          )}
          {tab === 'Finance & settings' && settings && (
            <>
              <DeliveryZones />
              <StaffSessions />
              <SecurityControls />
              <Settings
                key={settings.version}
                settings={settings}
                refresh={refresh}
                notice={setMessage}
              />
            </>
          )}
          {tab === 'Customers' && (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Type</th>
                    <th>Orders</th>
                    <th>Joined</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name || 'New customer'}</strong>
                      </td>
                      <td>{c.phone}</td>
                      <td>
                        <Badge value={c.role} />
                      </td>
                      <td>{c._count.orders}</td>
                      <td>{new Date(c.createdAt).toLocaleDateString('en-IN')}</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={async () => {
                            try {
                              setCustomer(await api(`/admin/customers/${c.id}`));
                            } catch (e) {
                              setMessage(errorMessage(e));
                            }
                          }}
                        >
                          View
                          <ArrowUpRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!customers.length && (
                <Empty
                  title="Your community starts here"
                  body="Customers appear here after they sign in."
                />
              )}
            </div>
          )}
          {tab === 'Store activity' && <AuditHistory />}
          {cursors[tab] && (
            <button className="secondary load-more" disabled={busy} onClick={() => void more()}>
              {busy ? 'Loading…' : 'Load more'}
            </button>
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={14} /> Your store. Built on trust.
            </span>
            <span>Shiv Cement Store · Patna, Bihar</span>
          </footer>
        </main>
      </div>
      <nav className="owner-bottom-nav" aria-label="Phone navigation">
        {navigation.map(({ label, hi, en, icon: Icon }) => (
          <button
            key={label}
            className={destination === label ? 'active' : ''}
            aria-current={destination === label ? 'page' : undefined}
            onClick={() => changeTab(label)}
          >
            <Icon size={21} />
            <span>{language === 'hi' ? hi : en}</span>
          </button>
        ))}
      </nav>
      {message && (
        <div className="toast" role="status">
          <Check size={18} />
          {message}
          <button aria-label="Dismiss notification" onClick={() => setMessage('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {customer && (
        <Modal title={customer.name || 'Customer details'} close={() => setCustomer(null)}>
          <div className="form-stack">
            <p>
              {customer.phone} · {customer._count.orders} orders
            </p>
            <h3>Contractor verification · {customer.contractorStatus || 'NONE'}</h3>
            <p>
              Verification records a store decision only. It does not grant credit or special
              prices.
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
                    setMessage('Contractor verification recorded');
                  } catch (err) {
                    setMessage(errorMessage(err));
                  }
                }}
              >
                <Field label="Decision">
                  <select name="status">
                    <option value="VERIFIED">Verify contractor</option>
                    <option value="REJECTED">Reject / revoke verification</option>
                  </select>
                </Field>
                <Field label="Verification evidence / reason">
                  <input name="note" required maxLength={500} />
                </Field>
                <button className="primary">Record verification</button>
              </form>
            )}
            <h3>Saved addresses</h3>
            {customer.addresses.map((a) => (
              <p key={a.id}>
                {a.line1}, {a.city} {a.pincode}
              </p>
            ))}
            <h3>Five most recent orders</h3>
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
  const [phone, setPhone] = useState('9297513707');
  const [code, setCode] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState(
    forbidden ? 'This account does not have store staff access.' : '',
  );
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
          setError('This account does not have store staff access. Ask the owner to grant access.');
          setSent(false);
        } else onLogin(r.user);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Building2 size={27} />
          </span>
          <span>
            SHIV<span>CEMENT STORE</span>
          </span>
        </a>
        <div>
          <span className="eyebrow">YOUR STORE. YOUR PEOPLE.</span>
          <h1>
            Good foundations.
            <br />
            Great business.
          </h1>
          <p>
            Everything you need to keep Bihar building,
            <br />
            all in one place.
          </p>
          <div className="login-rule" />
        </div>
        <small>Serving Patna & Bihar</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">STORE DESK</span>
          <h2>Welcome back.</h2>
          <p className="muted">Sign in to manage your store.</p>
          <form onSubmit={submit} className="form-stack">
            <Field label="Staff mobile number">
              <div className="phone-input">
                <span>+91</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  disabled={sent}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  required
                  pattern="[6-9][0-9]{9}"
                  aria-label="Staff mobile number"
                />
              </div>
            </Field>
            {sent && (
              <Field label="6-digit verification code">
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  pattern="[0-9]{6}"
                  required
                  aria-label="Verification code"
                />
              </Field>
            )}
            {sent && (
              <Field label="Staff passphrase">
                <input
                  aria-label="Staff passphrase"
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
                Local development · code <strong>{devCode}</strong>
                <br />
                No SMS was sent.
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? 'Please wait…' : sent ? 'Open store desk' : 'Get verification code'}
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
                Use another number
              </button>
            )}
          </form>
          <p className="login-security">
            <ShieldCheck size={16} />
            Only authorised store staff can sign in.
          </p>
        </div>
      </section>
    </div>
  );
}
