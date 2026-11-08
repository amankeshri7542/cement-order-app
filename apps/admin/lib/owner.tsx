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
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import {
  Activity,
  Banknote,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CheckCircle,
  ClipboardList,
  Contact,
  FileText,
  History,
  Home,
  IndianRupee,
  Menu,
  MessageCircle,
  Package,
  Plus,
  Settings,
  ShieldCheck,
  Truck,
  UserCog,
  Users,
  Wallet,
  PhoneCall,
  Scale,
} from 'lucide-react';
import { BottomNav, Button, Confirm, Field, PhoneField, Skeleton, Toast } from '@shiv/design';
import { canDo, phoneDigits, type Access, type Permission, type User } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { API_URL, ApiError, api } from './api';
import { LanguageProvider, useLanguage, useT, useWords } from './i18n';
import { homeFor, pathAllowed } from './nav';
import { ringBell, soundOn } from './bell';
import { registerWorker } from './push';
import { refreshAfterWrite } from './refresh';
import css from '../components/owner/owner.module.css';

declare global {
  interface Window {
    shivOwnerBeforePop?: (event: PopStateEvent) => void;
  }
}

export type Shop = { id: string; name: string; firmId?: string; kind?: 'SHOP' | 'GODOWN' };
/** A firm this person sees (plan v4, two firms). Shops group under it in the switcher. */
export type Firm = { id: string; name: string };
type DeskSession = {
  user: User;
  access: Access;
  permissionsVersion: number;
  locations: Shop[];
  firms?: Firm[];
  hasPassphrase: boolean;
};
type Confirmation = { title: string; body: string; confirmLabel: string; noteLabel?: string };
type OwnerContext = {
  me: User;
  /** Whether this person may do this, at one shop or at all. Hiding a button is only manners: the API decides. */
  can: (permission: Permission, locationId?: string | null) => boolean;
  shops: Shop[];
  /** The firms this person sees: one for a one-firm accountant, every firm for an owner. */
  firms: Firm[];
  hasPassphrase: boolean;
  notice: (message: string, error?: boolean) => void;
  confirm: (options: Confirmation) => Promise<boolean>;
  setDirty: (dirty: boolean) => void;
  guard: (id: symbol, active: boolean) => void;
  clearDirty: () => void;
  requestClose: (close: () => void) => Promise<void>;
  endSession: () => void;
  offline: boolean;
  /** Whether this person's job includes a page. */
  canOpen: (path: string) => boolean;
  /** The shop being looked at, remembered on this device. Empty means every shop. */
  shopId: string | null;
  setShopId: (id: string | null) => void;
  /** Hazri cards waiting for this person, at the shop being looked at. */
  reviewCount: number;
};
const Owner = createContext<OwnerContext | null>(null);
export function useOwner() {
  const value = useContext(Owner);
  if (!value) throw new Error('Owner provider missing');
  return value;
}

export function OwnerProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15000,
            retry: false,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <OwnerShell>{children}</OwnerShell>
      </QueryClientProvider>
    </LanguageProvider>
  );
}

async function session() {
  try {
    return await api<DeskSession>('/auth/session');
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'UNAUTHORIZED') throw error;
    await api('/auth/refresh', 'POST', {}, false);
    return api<DeskSession>('/auth/session');
  }
}

/** How many orders are waiting, on the Aaj tab. Android shows no number on the app icon. */
function WaitingCount() {
  const count = useContext(WaitingCounts);
  return count ? (
    <span className={css.tabCount} aria-label={String(count)}>
      {count}
    </span>
  ) : null;
}
const WaitingCounts = createContext(0);

function OwnerShell({ children }: { children: ReactNode }) {
  const t = useT();
  const words = useWords();
  const client = useQueryClient();
  const path = usePathname();
  const router = useRouter();
  const auth = useQuery<DeskSession | null>({
    queryKey: ['owner-session'],
    queryFn: session,
    staleTime: 5 * 60000,
  });
  const endSession = useCallback(() => {
    void client.cancelQueries();
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'owner-session' });
    client.setQueryData(['owner-session'], null);
  }, [client]);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const notice = useCallback((message: string, error = false) => setToast({ message, error }), []);
  const [offline, setOffline] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const resolver = useRef<((answer: boolean) => void) | null>(null);
  const confirm = useCallback(
    (options: Confirmation) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setConfirmation(options);
      }),
    [],
  );
  const finishConfirm = (answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    setConfirmation(null);
  };
  const dirty = useRef(false);
  const guards = useRef(new Set<symbol>());
  const legacyGuard = useRef(Symbol());
  const [dirtyState, setDirtyState] = useState(false);
  const guard = useCallback((id: symbol, active: boolean) => {
    if (active) guards.current.add(id);
    else guards.current.delete(id);
    dirty.current = guards.current.size > 0;
    setDirtyState(dirty.current);
  }, []);
  const setDirty = useCallback((value: boolean) => guard(legacyGuard.current, value), [guard]);
  const clearDirty = useCallback(() => {
    guards.current.clear();
    dirty.current = false;
    setDirtyState(false);
  }, []);
  const leave = useCallback(
    () =>
      confirm({
        title: t('owner.unsavedTitle'),
        body: t('owner.unsavedBody'),
        confirmLabel: t('owner.discard'),
      }),
    [confirm, t],
  );
  const requestClose = useCallback(
    async (close: () => void) => {
      if (dirty.current && !(await leave())) return;
      clearDirty();
      close();
    },
    [clearDirty, leave],
  );
  useBeforeUnload(dirtyState);
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    // Install after Next's own history patch and Strict Mode effect replay.
    // Locale changes update the callback without replacing history wrappers.
    let cancelled = false;
    let detach = () => {};
    queueMicrotask(() => {
      if (cancelled) return;
      const push = history.pushState.bind(history);
      const replace = history.replaceState.bind(history);
      let position =
        typeof history.state?.ownerPosition === 'number' ? history.state.ownerPosition : 0;
      let restoring = false;
      replace({ ...history.state, ownerPosition: position }, '');
      const pushState: History['pushState'] = (state, unused, url) => {
        position += 1;
        push({ ...state, ownerPosition: position }, unused, url);
      };
      const replaceState: History['replaceState'] = (state, unused, url) =>
        replace({ ...state, ownerPosition: position }, unused, url);
      history.pushState = pushState;
      history.replaceState = replaceState;
      const back = (event: PopStateEvent) => {
        const next = event.state?.ownerPosition;
        if (restoring) {
          restoring = false;
          event.stopImmediatePropagation();
          return;
        }
        if (typeof next !== 'number') return;
        const delta = next - position;
        if (!dirty.current || !delta) {
          position = next;
          return;
        }
        event.stopImmediatePropagation();
        restoring = true;
        history.go(-delta);
        void leaveRef.current().then((ok) => {
          if (ok) {
            clearDirty();
            history.go(delta);
          }
        });
      };
      window.shivOwnerBeforePop = back;
      detach = () => {
        if (history.pushState === pushState) history.pushState = push;
        if (history.replaceState === replaceState) history.replaceState = replace;
        if (window.shivOwnerBeforePop === back) delete window.shivOwnerBeforePop;
      };
    });
    return () => {
      cancelled = true;
      detach();
    };
  }, [clearDirty]);
  useEffect(() => {
    const lost = endSession;
    window.addEventListener('owner-session-lost', lost);
    return () => window.removeEventListener('owner-session-lost', lost);
  }, [endSession]);
  useEffect(() => {
    clearDirty();
    window.scrollTo(0, 0);
  }, [path, clearDirty]);
  useEffect(() => {
    const handle = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (
        !dirty.current ||
        !anchor ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        anchor.target === '_blank'
      )
        return;
      const url = new URL(anchor.href);
      if (
        url.origin !== location.origin ||
        (url.pathname === location.pathname && url.search === location.search)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void leave().then((ok) => {
        if (ok) {
          clearDirty();
          router.push(url.pathname + url.search);
        }
      });
    };
    document.addEventListener('click', handle, true);
    return () => document.removeEventListener('click', handle, true);
  }, [leave, clearDirty, router]);
  useEffect(() => {
    const changed = () => setOffline(!navigator.onLine);
    changed();
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    return () => {
      window.removeEventListener('online', changed);
      window.removeEventListener('offline', changed);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const access = auth.data?.access;
  const onDesk = !!access?.['desk.use'];
  // Large text makes the tabs taller, and anything resting on them must rise with them.
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('nav[data-owner-tabs]');
    if (!nav || typeof ResizeObserver === 'undefined') return;
    const measure = () =>
      document.documentElement.style.setProperty('--owner-tabs', `${nav.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  });
  const [chosenShop, setChosenShop] = useState<string | null>(null);
  useEffect(() => {
    try {
      setChosenShop(localStorage.getItem(shopStorageKey));
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
  }, []);
  const chooseShop = useCallback((id: string | null) => {
    setChosenShop(id);
    try {
      if (id) localStorage.setItem(shopStorageKey, id);
      else localStorage.removeItem(shopStorageKey);
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
  }, []);
  const waiting = useQuery({
    enabled: !!access?.['orders.confirm'],
    queryKey: ['inbox'],
    queryFn: () => api<{ count: number }>('/admin/inbox'),
    staleTime: 5000,
    refetchInterval: 30000,
  });
  const reviewShop =
    access && chosenShop && canDo(access, 'attendance.review', chosenShop) ? chosenShop : null;
  const reviewsOpen = useQuery({
    enabled: !!access?.['attendance.review'],
    queryKey: ['hazri', 'reviews', 'count', reviewShop],
    queryFn: () =>
      api<{ count: number }>(
        `/admin/attendance/reviews${reviewShop ? `?locationId=${encodeURIComponent(reviewShop)}` : ''}`,
      ),
    refetchInterval: 60000,
  });
  const reviewCount = reviewsOpen.data?.count ?? 0;
  useLiveOrders(onDesk);
  // The bell, for work that arrives while the desk is open.
  const lastWaiting = useRef<number | null>(null);
  useEffect(() => {
    const count = waiting.data?.count;
    if (count === undefined) return;
    if (lastWaiting.current !== null && count > lastWaiting.current && soundOn()) ringBell();
    lastWaiting.current = count;
  }, [waiting.data?.count]);
  useEffect(() => {
    if (onDesk) void registerWorker().catch(() => {});
  }, [onDesk]);
  // The home page depends on the job, and a shared link to another page shows a polite note.
  useEffect(() => {
    if (onDesk && access && path === '/today' && !pathAllowed(access, path))
      router.replace(homeFor(access));
  }, [onDesk, access, path, router]);
  if (auth.isPending)
    return (
      <div className={css.login}>
        <Skeleton label={t('owner.loading')} />
      </div>
    );
  if (!auth.data) {
    if (auth.error instanceof ApiError && auth.error.code !== 'UNAUTHORIZED')
      return (
        <div className={css.login}>
          <p role="alert">{words.error(auth.error)}</p>
          <Button onClick={() => void auth.refetch()}>{t('owner.retry')}</Button>
        </div>
      );
    return <Login />;
  }
  if (!onDesk || !access)
    return (
      <div className={css.login}>
        <p role="alert">
          {t(auth.data.user.role === 'ADMIN' ? 'owner.noDeskAccess' : 'owner.onlyOwner')}
        </p>
        <Button onClick={() => void api('/auth/logout', 'POST').finally(endSession)}>
          {t('owner.logout')}
        </Button>
      </div>
    );
  const value: OwnerContext = {
    me: auth.data.user,
    can: (permission, locationId) => canDo(access, permission, locationId),
    canOpen: (route) => pathAllowed(access, route),
    shops: auth.data.locations,
    firms: auth.data.firms ?? [],
    hasPassphrase: auth.data.hasPassphrase,
    notice,
    confirm,
    setDirty,
    guard,
    clearDirty,
    requestClose,
    endSession,
    offline,
    shopId:
      chosenShop && auth.data.locations.some((shop) => shop.id === chosenShop) ? chosenShop : null,
    setShopId: chooseShop,
    reviewCount,
  };
  return (
    <Owner.Provider value={value}>
      <WaitingCounts.Provider value={waiting.data?.count ?? 0}>
        <div className={css.shell}>
          <a href="#owner-main" className={css.skip}>
            {t('owner.continue')}
          </a>
          <header className={css.topbar}>
            <Link href="/today" className={css.brand}>
              <img src="/icon-192.png" alt="" width="40" height="40" />
              <span>{t('owner.deskName')}</span>
            </Link>
            <ShopSwitcher />
            {/* Someone whose day starts at stock has it in the bar below instead. */}
            {canDo(access, 'stock.read') && pathAllowed(access, '/today') && (
              <Link href="/stock" className={css.stockLink}>
                <Package size={20} />
                <span>{t('owner.stock')}</span>
              </Link>
            )}
          </header>
          {process.env.NEXT_PUBLIC_TEST_DESK === 'true' && (
            <p className={css.testBand}>{t('owner.pakka.testBand')}</p>
          )}
          {offline && (
            <p role="alert" className={css.offline}>
              {t('owner.offline')}
            </p>
          )}
          <main id="owner-main" className={css.main}>
            {pathAllowed(access, path) ? (
              children
            ) : (
              <section className={css.card}>
                <h1>{t('owner.notYourPage')}</h1>
                <p>{t('owner.notYourPageBody')}</p>
                <Link className={css.inlineLink} href={homeFor(access)}>
                  {t('owner.back')}
                </Link>
              </section>
            )}
          </main>
          <BottomNav label={t('owner.desk')}>
            {deskLinks
              .filter(({ href }) => pathAllowed(access, href))
              .map(({ href: route, key, Icon: Mark, tab }) => (
                <Link
                  key={route}
                  href={route}
                  // Everything is on the laptop's side bar. A phone has room for five.
                  className={
                    tab === true || (route === '/stock' && !pathAllowed(access, '/today'))
                      ? undefined
                      : css.sideOnly
                  }
                  aria-current={
                    path === route ||
                    (path.startsWith(route + '/') &&
                      !(route === '/orders' && path === '/orders/new'))
                      ? 'page'
                      : undefined
                  }
                >
                  <Mark size={22} aria-hidden="true" />
                  {t(key as MessageKey)}
                  {route === '/today' && <WaitingCount />}
                  {route === '/hazri' && reviewCount > 0 && (
                    <span className={css.tabCount} aria-label={String(reviewCount)}>
                      {reviewCount}
                    </span>
                  )}
                  {/* A phone has Hazri under Aur, so the number waits on that tab. */}
                  {route === '/more' && reviewCount > 0 && (
                    <span className={css.moreCount} aria-hidden="true">
                      {reviewCount}
                    </span>
                  )}
                </Link>
              ))}
          </BottomNav>
          {toast && <Toast error={toast.error}>{toast.message}</Toast>}
          {confirmation && (
            <Confirm
              title={confirmation.title}
              body={confirmation.body}
              confirmLabel={confirmation.confirmLabel}
              cancelLabel={t('owner.keepEditing')}
              closeLabel={t('owner.close')}
              onConfirm={() => finishConfirm(true)}
              onCancel={() => finishConfirm(false)}
            />
          )}
        </div>
      </WaitingCounts.Provider>
    </Owner.Provider>
  );
}

const shopStorageKey = 'shiv-desk-shop';
/** Every page on the desk, in the order the side bar shows them. `tab` puts one on a phone's bar. */
export const deskLinks: { href: string; key: MessageKey; Icon: typeof Home; tab?: boolean }[] = [
  { href: '/today', key: 'owner.today', Icon: Home, tab: true },
  { href: '/inbox', key: 'owner.pakka.title', Icon: CheckCircle },
  { href: '/orders', key: 'owner.orders', Icon: ClipboardList, tab: true },
  { href: '/orders/new', key: 'owner.newOrder', Icon: Plus, tab: true },
  { href: '/lists', key: 'owner.lists.title', Icon: FileText },
  { href: '/customers', key: 'owner.customers', Icon: Users, tab: true },
  { href: '/calls', key: 'owner.crm.todayCalls', Icon: PhoneCall },
  { href: '/udhaar', key: 'owner.khata', Icon: BookOpen },
  { href: '/rates', key: 'owner.rates.nav', Icon: IndianRupee },
  { href: '/stock', key: 'owner.stock', Icon: Package },
  { href: '/manzoori', key: 'owner.manzoori.title', Icon: ShieldCheck },
  { href: '/galla', key: 'owner.galla.title', Icon: Wallet },
  { href: '/hazri', key: 'owner.hazri.title', Icon: CalendarCheck },
  { href: '/trips', key: 'owner.trips.title', Icon: Truck },
  { href: '/salary', key: 'owner.salary.title', Icon: Banknote },
  { href: '/reports', key: 'owner.reports', Icon: BarChart3 },
  { href: '/tally', key: 'owner.tally.nav', Icon: Scale },
  { href: '/activity', key: 'owner.activity', Icon: History },
  { href: '/users', key: 'owner.people', Icon: UserCog },
  { href: '/staff', key: 'owner.staff', Icon: Contact },
  { href: '/whatsapp', key: 'owner.whatsappReading', Icon: MessageCircle },
  { href: '/settings', key: 'owner.settings.title', Icon: Settings },
  { href: '/system', key: 'owner.system.title', Icon: Activity },
  { href: '/more', key: 'owner.more', Icon: Menu, tab: true },
];

/** One shop at a time, or all of them. The server checks every read and write regardless. */
function ShopSwitcher() {
  const t = useT();
  const { shops, shopId, setShopId, can } = useOwner();
  // Only where this person works. Other shops exist, but there is nothing of theirs to narrow to.
  const mine = shops.filter(
    (shop) =>
      can('stock.read', shop.id) || can('orders.read', shop.id) || can('galla.read', shop.id),
  );
  if (mine.length < 2) return null;
  return (
    <label className={css.shopSwitch}>
      <span>{t('owner.shell.shop')}</span>
      <select value={shopId ?? ''} onChange={(event) => setShopId(event.target.value || null)}>
        <option value="">{t('owner.shell.allShops')}</option>
        {mine.map((shop) => (
          <option key={shop.id} value={shop.id}>
            {shop.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Whether this is a laptop's width. Before the page is mounted it answers as a phone. */
export function useIsWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 64rem)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

export function useBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}
export function useUnsavedGuard(active: boolean) {
  const { guard, confirm } = useOwner();
  const t = useT();
  const id = useRef(Symbol());
  useEffect(() => {
    guard(id.current, active);
    const token = id.current;
    return () => guard(token, false);
  }, [active, guard]);
  const clearDirty = useCallback(() => guard(id.current, false), [guard]);
  const requestClose = useCallback(
    async (close: () => void) => {
      if (
        active &&
        !(await confirm({
          title: t('owner.unsavedTitle'),
          body: t('owner.unsavedBody'),
          confirmLabel: t('owner.discard'),
        }))
      )
        return;
      clearDirty();
      close();
    },
    [active, clearDirty, confirm, t],
  );
  return { clearDirty, requestClose };
}
export function useDebounced<T>(value: T, delay = 300) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setResult(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return result;
}
export function useAction<T, R = unknown>(
  run: (input: T) => Promise<R>,
  keys: QueryKey[] = [],
  success?: MessageKey,
) {
  const client = useQueryClient();
  const { notice, offline } = useOwner();
  const t = useT();
  return useMutation({
    mutationFn: (input: T) => {
      if (offline) throw new ApiError('NETWORK_ERROR', t('owner.offline'), 'error.network');
      return run(input);
    },
    onSuccess: async () => {
      await refreshAfterWrite(client, [['dashboard'], ...keys]);
      if (success) notice(t(success));
    },
    // A transport failure can hide a committed write. Refresh its authoritative state too.
    onError: () => refreshAfterWrite(client, [['dashboard'], ...keys]),
  });
}

function useLiveOrders(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let stream: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let delay = 1000;
    let lastRefresh = 0;
    let connected = false;
    const invalidate = () => {
      lastRefresh = Date.now();
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['inbox'] });
      void client.invalidateQueries({ queryKey: ['orders', 'list'] });
      void client.invalidateQueries({ queryKey: ['enquiries'] });
    };
    const open = () => {
      if (stopped || !navigator.onLine) return;
      stream?.close();
      stream = new EventSource(`${API_URL}/admin/events`, { withCredentials: true });
      stream.onopen = () => {
        connected = true;
        delay = 1000;
        invalidate();
      };
      stream.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type !== 'HEARTBEAT') invalidate();
        } catch {
          /* Retry polling still catches up. */
        }
      };
      stream.onerror = () => {
        connected = false;
        stream?.close();
        retry = setTimeout(open, delay);
        delay = Math.min(delay * 2, 30000);
      };
    };
    const visibility = () => {
      clearTimeout(retry);
      if (!navigator.onLine) {
        stream?.close();
        connected = false;
      } else {
        invalidate();
        open();
      }
    };
    const poll = setInterval(() => {
      if (navigator.onLine && (!connected || Date.now() - lastRefresh >= 15000)) invalidate();
    }, 15000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', visibility);
    open();
    return () => {
      stopped = true;
      clearInterval(poll);
      clearTimeout(retry);
      stream?.close();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', visibility);
    };
  }, [enabled, client]);
}

function Login() {
  const t = useT();
  const words = useWords();
  const client = useQueryClient();
  const { language } = useLanguage();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  const send = useMutation({
    mutationFn: async () => {
      const data = await api<{ devCode?: string }>('/auth/otp/request', 'POST', {
        phone: `+91${phoneDigits(phone)}`,
      });
      setDevCode(data.devCode ?? '');
      setSent(true);
      setSeconds(60);
    },
  });
  const verify = useMutation({
    mutationFn: async () => {
      const result = await api<{ user: User }>('/auth/otp/verify', 'POST', {
        phone: `+91${phoneDigits(phone)}`,
        code,
        surface: 'DESK',
      });
      if (result.user.role !== 'ADMIN') {
        await api('/auth/logout', 'POST');
        throw new ApiError('FORBIDDEN', t('owner.onlyOwner'), 'error.forbidden');
      }
      await client.invalidateQueries({ queryKey: ['owner-session'] });
    },
  });
  return (
    <div className={css.login}>
      <img className={css.loginIcon} src="/icon-192.png" alt="" width="64" height="64" />
      <p className={css.eyebrow}>{t('owner.deskName')}</p>
      <h1>{t('owner.loginTitle')}</h1>
      <p>{t('owner.loginBody')}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (sent) verify.mutate();
          else send.mutate();
        }}
      >
        <PhoneField
          label={t('owner.loginPhone')}
          value={phone}
          onChange={setPhone}
          required
          pattern="[6-9][0-9]{9}"
          disabled={sent || send.isPending}
        />
        {sent && (
          <Field label={t('owner.code')}>
            <input
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
          </Field>
        )}
        {process.env.NODE_ENV !== 'production' && devCode && (
          <p className={css.hint} role="status">
            {t('owner.devCode', { code: devCode })}
          </p>
        )}
        {(send.error || verify.error) && (
          <p role="alert" className={css.error}>
            {words.error(send.error || verify.error)}
          </p>
        )}
        <Button className={css.wide} disabled={send.isPending || verify.isPending}>
          {sent ? t('owner.signIn') : t('owner.sendCode')}
        </Button>
        {sent && (
          <div className={css.actions}>
            <Button
              type="button"
              variant="ghost"
              disabled={seconds > 0 || send.isPending}
              onClick={() => send.mutate()}
            >
              {seconds > 0 ? t('owner.resendWait', { seconds }) : t('owner.resend')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSent(false);
                setCode('');
                setDevCode('');
              }}
            >
              {t('owner.changePhone')}
            </Button>
          </div>
        )}
      </form>
      <p className={css.hint}>{t('owner.sessionHelp')}</p>
      <span className={css.languageMarker} lang={language}>
        {t('owner.hindi')}
      </span>
    </div>
  );
}
