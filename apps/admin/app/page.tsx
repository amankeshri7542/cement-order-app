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
import { API_URL, api, errorMessage } from '../lib/api';
import { Badge, Empty, Field, Modal, SectionTitle } from '../components/ui';
import { Products } from '../components/products';
import { Orders, OrdersTable } from '../components/orders';
import { Quotes } from '../components/quotes';
import { Settings } from '../components/settings';
import { DeliveryZones, StaffSessions, AuditHistory } from '../components/operations';

type Tab =
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
  pendingOrders: number;
  pendingPayments: number;
  pendingDeliveries: number;
  bulkRequests: number;
  lowStock: Product[];
  recentOrders: Order[];
};
const navigation = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Orders', icon: ShoppingBag },
  { label: 'Products', icon: Package },
  { label: 'Rate Studio', icon: ClipboardList },
  { label: 'Bulk quotes', icon: ClipboardList },
  { label: 'Customers', icon: Users },
  { label: 'Finance & settings', icon: Settings2 },
  { label: 'Store activity', icon: Activity },
] as const;
export default function Page() {
  const refreshSequence = useRef(0);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('Overview');
  const [rateDirty, setRateDirty] = useState(false);
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
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    if (user?.role !== 'ADMIN') return;
    setBusy(true);
    setError('');
    try {
      const [d, o, p, c, q, u, s] = await Promise.all([
        api<Dashboard>('/admin/dashboard'),
        api<PageResult<Order>>(`/admin/orders?${orderQuery}`),
        api<PageResult<Product>>(`/admin/products?${productQuery}`),
        api<Category[]>('/categories'),
        api<PageResult<Quote>>('/admin/quotes'),
        api<PageResult<Customer>>('/admin/customers'),
        api<StoreSettings>('/store'),
      ]);
      if (sequence !== refreshSequence.current) return;
      setDashboard(d);
      setOrders(o.items);
      setProducts(p.items);
      setCategories(c);
      setQuotes(q.items);
      setCustomers(u.items);
      setCursors({
        Orders: o.nextCursor,
        Products: p.nextCursor,
        'Bulk quotes': q.nextCursor,
        Customers: u.nextCursor,
      });
      setSettings(s);
    } catch (e) {
      if (sequence === refreshSequence.current) setError(errorMessage(e));
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [user, productQuery, orderQuery]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    const source = new EventSource(`${API_URL}/events`);
    source.onopen = () => void refresh();
    source.onmessage = (event) => {
      if (!event.data.includes('HEARTBEAT')) void refresh();
    };
    return () => source.close();
  }, [refresh, user?.role]);
  async function more() {
    if (!cursors[tab] || busy) return;
    const sequence = refreshSequence.current;
    setBusy(true);
    try {
      const path =
        tab === 'Products'
          ? `/admin/products?${productQuery}&`
          : tab === 'Orders'
            ? `/admin/orders?${orderQuery}&`
            : tab === 'Bulk quotes'
              ? '/admin/quotes?'
              : '/admin/customers?';
      const page = await api<PageResult<Order | Product | Quote | Customer>>(
        `${path}cursor=${encodeURIComponent(cursors[tab]!)}`,
      );
      if (sequence !== refreshSequence.current) return;
      if (tab === 'Products') setProducts((old) => [...old, ...(page.items as Product[])]);
      if (tab === 'Orders') setOrders((old) => [...old, ...(page.items as Order[])]);
      if (tab === 'Bulk quotes') setQuotes((old) => [...old, ...(page.items as Quote[])]);
      if (tab === 'Customers') setCustomers((old) => [...old, ...(page.items as Customer[])]);
      setCursors((old) => ({ ...old, [tab]: page.nextCursor }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
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
  const changeTab = (value: Tab) => {
    if (value !== tab && rateDirty && !window.confirm('Discard unsaved rate sheet edits?')) return;
    if (value !== tab) setRateDirty(false);
    setTab(value);
    setNavOpen(false);
  };
  const openOrder = (id: string) => {
    if (rateDirty && !window.confirm('Discard unsaved rate sheet edits?')) return;
    setRateDirty(false);
    setSelectedOrder(id);
    setTab('Orders');
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
          {navigation.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={tab === label ? 'active' : ''}
              onClick={() => changeTab(label)}
            >
              <Icon size={19} />
              {label}
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
              onClick={() => void refresh()}
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
                <h1>{tab === 'Overview' ? 'Your materials counter.' : tab}</h1>
                <p>
                  {
                    {
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
          {error && (
            <div className="error" role="alert">
              {error}{' '}
              <button className="text-button" onClick={() => void refresh()}>
                Try again
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
              <section className="store-banner counter-board">
                <div>
                  <span className="eyebrow">SHIV / MATERIALS & SUPPLY</span>
                  <h2>
                    Stock in.
                    <br />
                    Orders out.
                  </h2>
                  <p>A clear view of what needs your attention today.</p>
                  <button onClick={() => changeTab('Products')}>
                    Open the stock counter <ArrowRight size={17} />
                  </button>
                </div>
                <div className="dispatch-board">
                  <span>DISPATCH BOARD</span>
                  <strong>{dashboard.pendingOrders}</strong>
                  <p>orders awaiting fulfilment</p>
                  <button onClick={() => changeTab('Orders')}>
                    Review orders <ArrowUpRight size={17} />
                  </button>
                </div>
              </section>
              <section className="stats-grid" aria-label="Today's store metrics">
                {[
                  {
                    label: 'Today’s sales',
                    value: money(dashboard.todaySalesPaise),
                    note: 'Verified payments received',
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
                    <button className="attention" onClick={() => changeTab('Orders')}>
                      <span className="attention-icon">
                        <IndianRupee size={18} />
                      </span>
                      <span>
                        <strong>Payments pending</strong>
                        <small>{dashboard.pendingPayments} orders to follow up</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                    <button className="attention" onClick={() => changeTab('Products')}>
                      <span className="attention-icon amber">
                        <Package size={18} />
                      </span>
                      <span>
                        <strong>Running low</strong>
                        <small>{dashboard.lowStock.length} products below 25 units</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                    <button className="attention" onClick={() => changeTab('Bulk quotes')}>
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
              onFilter={setOrderQuery}
              orders={orders}
              refresh={refresh}
              notice={setMessage}
              selectedId={selectedOrder}
              setSelectedId={setSelectedOrder}
            />
          )}
          {tab === 'Bulk quotes' && (
            <Quotes quotes={quotes} refresh={refresh} notice={setMessage} />
          )}
          {tab === 'Finance & settings' && settings && (
            <>
              <DeliveryZones />
              <StaffSessions />
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
