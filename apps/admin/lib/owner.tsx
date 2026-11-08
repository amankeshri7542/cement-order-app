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
import { Button, Confirm, Field, PhoneField, Skeleton, Toast } from '@shiv/design';
import {
  canDo,
  phoneDigits,
  type Access,
  type Permission,
  type Preferences,
  type User,
} from '@shiv/shared';
import { htmlLang, type Language, type MessageKey } from '@shiv/i18n';
import { API_URL, ApiError, api } from './api';
import { syncAppearance } from './appearance';
import { LanguageProvider, useLanguage, useSyncLanguage, useT, useWords } from './i18n';
import { homeFor, pathAllowed } from './nav';
import { ringBell, soundOn } from './bell';
import { registerWorker } from './push';
import { refreshAfterWrite } from './refresh';
import {
  allowedScope,
  legacyShopKey,
  readScope,
  scopeParams,
  scopeQuery,
  scopeStorageKey,
  writeScope,
  type Scope,
} from './scope';
import { visibleGroups } from './shell-nav';
import { PhoneTabs, PlusSheet, Rail, SaathiPanel, TopBar } from '../components/shell/shell';
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
  preferences?: Preferences;
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
  /** What the desk is looking at, remembered on this device (`useShopScope`). */
  scope: Scope;
  setScope: (scope: Scope) => void;
  /** The shop being looked at. Empty means every shop, or a whole firm (`firmId`). */
  shopId: string | null;
  /** The firm being looked at, when a whole firm is chosen. */
  firmId: string | null;
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

export function OwnerProvider({
  children,
  language,
}: {
  children: ReactNode;
  /** The language the server drew this page in, from the shiv_lang cookie. */
  language?: Language;
}) {
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
    <LanguageProvider initial={language}>
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
  // The theme and text size this person chose, from any device, win once the session is known.
  const savedLook = auth.data?.preferences;
  useEffect(() => syncAppearance(savedLook), [savedLook]);
  // The same for the language: the one saved for this person wins (lib/i18n.tsx).
  useSyncLanguage(savedLook?.language, !!auth.data);
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
  const [chosenScope, setChosenScope] = useState<Scope>({ kind: 'all' });
  useEffect(() => {
    try {
      const stored = localStorage.getItem(scopeStorageKey);
      // A shop remembered before plan v4 B4a carries over once.
      const legacy = stored === null ? localStorage.getItem(legacyShopKey) : null;
      setChosenScope(readScope(stored ?? (legacy ? `shop:${legacy}` : '')));
      if (legacy) localStorage.removeItem(legacyShopKey);
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
  }, []);
  const chooseScope = useCallback((next: Scope) => {
    setChosenScope(next);
    try {
      const value = writeScope(next);
      if (value) localStorage.setItem(scopeStorageKey, value);
      else localStorage.removeItem(scopeStorageKey);
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
  }, []);
  const chosenShop = chosenScope.kind === 'shop' ? chosenScope.shopId : null;
  const [saathi, setSaathi] = useState(false);
  const [plus, setPlus] = useState(false);
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
  const scope = allowedScope(chosenScope, auth.data.locations, auth.data.firms ?? []);
  const groups = visibleGroups(access);
  const counts = { waiting: waiting.data?.count ?? 0, reviews: reviewCount };
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
    scope,
    setScope: chooseScope,
    shopId: scope.kind === 'shop' ? scope.shopId : null,
    firmId: scope.kind === 'firm' ? scope.firmId : null,
    setShopId: (id) => chooseScope(id ? { kind: 'shop', shopId: id } : { kind: 'all' }),
    reviewCount,
  };
  return (
    <Owner.Provider value={value}>
      <div className={css.shell}>
        <a href="#owner-main" className={css.skip}>
          {t('owner.continue')}
        </a>
        <Rail groups={groups} counts={counts} />
        <div className={css.column}>
          <TopBar groups={groups} onSaathi={() => setSaathi(true)} />
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
        </div>
        <PhoneTabs counts={counts} onPlus={() => setPlus(true)} onSaathi={() => setSaathi(true)} />
        <SaathiPanel open={saathi} onClose={() => setSaathi(false)} />
        {plus && <PlusSheet onClose={() => setPlus(false)} />}
        <Shortcuts
          onSaathi={() => setSaathi(true)}
          onNew={pathAllowed(access, '/orders/new') ? () => router.push('/orders/new') : undefined}
        />
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
    </Owner.Provider>
  );
}

/**
 * The laptop's shortcuts (plan v4 02, section 3): `M` Saathi and `N` a new order, never while
 * someone is typing. `/` is the search box's own, and Escape closes whatever is open.
 */
function Shortcuts({ onSaathi, onNew }: { onSaathi: () => void; onNew?: () => void }) {
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) ||
        target.closest('[role="dialog"], dialog, [role="menu"]')
      )
        return;
      if (!window.matchMedia('(min-width: 64rem)').matches) return;
      const key = event.key.toLowerCase();
      if (key === 'm') {
        event.preventDefault();
        onSaathi();
      } else if (key === 'n' && onNew) {
        event.preventDefault();
        onNew();
      }
    };
    document.addEventListener('keydown', press);
    return () => document.removeEventListener('keydown', press);
  }, [onSaathi, onNew]);
  return null;
}

/** What the desk is looking at, for a page's reads: the shop or firm chosen in the top bar. */
export function useShopScope() {
  const { scope, setScope, shopId, firmId } = useOwner();
  return {
    scope,
    setScope,
    shopId,
    firmId,
    /** `{ locationId }`, `{ firmId }` or `{}` for every shop. */
    params: scopeParams(scope),
    /** The same as a query string: '' or '?locationId=…', or '&…' after an existing '?'. */
    query: (after: '?' | '&' = '?') => scopeQuery(scope, after),
  };
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
      <span className={css.languageMarker} lang={htmlLang(language)}>
        {t(`language.${language}`)}
      </span>
    </div>
  );
}
