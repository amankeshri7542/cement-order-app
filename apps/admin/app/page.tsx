'use client';
import { useCallback, useEffect, useState } from 'react';
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
import { Category, Order, Product, Quote, StoreSettings, User, money } from '@shiv/shared';
import { api, errorMessage } from '../lib/api';
import { Badge, Empty, Field, Modal, SectionTitle } from '../components/ui';
import { Products } from '../components/products';
import { Orders, OrdersTable } from '../components/orders';
import { Quotes } from '../components/quotes';
import { Settings } from '../components/settings';

type Tab = 'Overview' | 'Orders' | 'Products' | 'Bulk quotes' | 'Customers' | 'Finance & settings';
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
  { label: 'Bulk quotes', icon: ClipboardList },
  { label: 'Customers', icon: Users },
  { label: 'Finance & settings', icon: Settings2 },
] as const;
export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('Overview');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
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
    if (user?.role !== 'ADMIN') return;
    setBusy(true);
    setError('');
    try {
      const [d, o, p, c, q, u, s] = await Promise.all([
        api<Dashboard>('/admin/dashboard'),
        api<Order[]>('/admin/orders'),
        api<Product[]>('/admin/products'),
        api<Category[]>('/categories'),
        api<Quote[]>('/admin/quotes'),
        api<Customer[]>('/admin/customers'),
        api<StoreSettings>('/store'),
      ]);
      setDashboard(d);
      setOrders(o);
      setProducts(p);
      setCategories(c);
      setQuotes(q);
      setCustomers(u);
      setSettings(s);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [user]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (checking)
    return (
      <div className="loading-page">
        <Building2 size={36} />
        <p>Opening your store desk…</p>
      </div>
    );
  if (!user || user.role !== 'ADMIN') return <Login onLogin={setUser} forbidden={Boolean(user)} />;
  const changeTab = (value: Tab) => {
    setTab(value);
    setNavOpen(false);
  };
  const openOrder = (id: string) => {
    setSelectedOrder(id);
    setTab('Orders');
  };
  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
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
          <div className="page-heading">
            <div>
              <span className="eyebrow">SHIV CEMENT STORE</span>
              <h1>{tab === 'Overview' ? 'A good day to build.' : tab}</h1>
              <p>
                {
                  {
                    Overview: 'Here’s what’s happening at your store today.',
                    Orders: 'From the first bag to the final delivery.',
                    Products: 'Keep your prices current and your stock ready.',
                    'Bulk quotes': 'Better prices for bigger plans.',
                    Customers: 'The people building with you.',
                    'Finance & settings': 'Your store, your delivery charges, your controls.',
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
              <section className="store-banner">
                <div>
                  <span className="eyebrow">THE FOUNDATION OF EVERY BUILD</span>
                  <h2>
                    Your neighbourhood store.
                    <br />A stronger Bihar.
                  </h2>
                  <p>Quality materials. Fair prices. Delivered with care.</p>
                  <button onClick={() => changeTab('Products')}>
                    Keep your catalogue up to date
                    <ArrowRight size={17} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="building b1" />
                  <div className="building b2" />
                  <div className="building b3" />
                  <div className="cement-bag">
                    <span>SHIV</span>
                    <strong>
                      BUILD
                      <br />
                      STRONG.
                    </strong>
                    <small>CEMENT STORE</small>
                  </div>
                  <div className="ground-line" />
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
          {tab === 'Products' && (
            <Products
              products={products}
              categories={categories}
              refresh={refresh}
              notice={setMessage}
            />
          )}
          {tab === 'Orders' && (
            <Orders
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
            <Settings
              key={settings.version}
              settings={settings}
              refresh={refresh}
              notice={setMessage}
            />
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
            <h3>Saved addresses</h3>
            {customer.addresses.map((a) => (
              <p key={a.id}>
                {a.line1}, {a.city} {a.pincode}
              </p>
            ))}
            <h3>Order history</h3>
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
