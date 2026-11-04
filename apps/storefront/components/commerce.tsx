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
import { usePathname } from 'next/navigation';
import type { CartLine, Product, User } from '@shiv/shared';
import { z } from 'zod';
import { productResponse } from '../lib/api';
import { customerApi, CustomerError, errorText } from '../lib/customer-api';
import { price } from '../lib/catalog';
import { useLanguage } from './language';
import { MAX_LINE_QUANTITY, productName, quantityProblem, unitLabel } from '@shiv/shared';

type Intent = { product: Product; quantity: number };
const guestSchema = z.object({
  key: z.string().uuid(),
  lines: z
    .array(z.object({ product: productResponse, quantity: z.number().int().min(1).max(100000) }))
    .max(50),
});
type Guest = z.infer<typeof guestSchema>;
const mergeSchema = guestSchema.extend({ uncertain: z.boolean() });
type MergeDraft = z.infer<typeof mergeSchema>;
const fresh = (): Guest => ({ key: crypto.randomUUID(), lines: [] });
// The comparison is public catalogue data kept for this tab only, so a reload keeps the choice.
const compareSchema = z.array(productResponse).max(3);
const compareKey = 'shiv_compare_v1';
function keepCompare(items: Product[]) {
  try {
    sessionStorage.setItem(compareKey, JSON.stringify(items));
  } catch {
    /* Comparison still works for this page view without storage. */
  }
}
function readGuest(key: string): Guest {
  try {
    return guestSchema.parse(JSON.parse(localStorage.getItem(key) || 'null'));
  } catch {
    return fresh();
  }
}
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
 * Sign-out removes this account's private drafts (notes, company, GSTIN, lists, assistant chat)
 * from the browser. The shiv_pending_* recovery records stay, so a lost order or quotation
 * result can still be recovered after signing back in.
 */
function forgetDrafts(id: string) {
  for (const key of ['checkout', 'quote_draft', 'quote_intent', 'guest_merge'])
    persist(`shiv_${key}_${id}`, null);
  try {
    sessionStorage.removeItem(`shiv_assistant_${id}`);
  } catch {
    /* Storage blocked: nothing was kept. */
  }
}
/** Cross-tab signals and other hints whose loss must never interrupt sign-in or sign-out. */
function remember(key: string, value: unknown) {
  try {
    persist(key, value);
  } catch {
    /* Other tabs notice on their next focus check instead. */
  }
}
// A second tap on Add within this window is the same intent, not another pack.
const REPEAT_ADD_MS = 600;

function useCommerceValue() {
  const { language, t } = useLanguage();
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
  const [guest, setGuest] = useState<Guest | null>(null);
  const guestRef = useRef<Guest | null>(null);
  const [quote, setQuote] = useState<Guest | null>(null);
  const quoteRef = useRef<Guest | null>(null);
  const [busy, setBusy] = useState(false);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const writes = useRef(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [mergeDraft, setMergeDraft] = useState<MergeDraft | null>(null);
  const mergeRef = useRef<MergeDraft | null>(null);
  const mergePending = Boolean(mergeDraft);
  const sessionRequest = useRef(0);
  const mergeLock = useRef(false);
  const [compare, setCompare] = useState<Product[]>([]);
  const lastGuestAdd = useRef({ productId: '', at: 0 });
  // Products that left the catalogue cannot be compared; the compare page drops them.
  const dropCompare = useCallback((ids: string[]) => {
    setCompare((old) => {
      const next = old.filter((item) => !ids.includes(item.id));
      keepCompare(next);
      return next;
    });
  }, []);
  useEffect(() => {
    try {
      const saved = compareSchema.safeParse(JSON.parse(sessionStorage.getItem(compareKey) || '[]'));
      if (saved.success) setCompare(saved.data);
    } catch {
      /* Start with an empty comparison. */
    }
  }, []);
  useEffect(() => {
    if (!message) return;
    // Status confirmations clear themselves; errors stay until dismissed or resolved.
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  const showError = useCallback(
    (e: unknown) => setError(errorText(e, language === 'hi')),
    [language],
  );
  const updateCart = (lines: CartLine[]) => {
    cartRef.current = lines;
    setCart(lines);
  };
  const updateGuest = (value: Guest) => {
    persist('shiv_guest_cart_v2', value);
    guestRef.current = value;
    setGuest(value);
  };
  const updateQuote = (value: Guest) => {
    persist(`shiv_quote_intent_${identity.current?.id || 'guest'}`, value);
    quoteRef.current = value;
    setQuote(value);
  };
  const identify = useCallback((next: User | null) => {
    if (identity.current?.id !== next?.id) {
      generation.current++;
      writes.current++;
      updateCart([]);
      setError('');
      setMessage('');
      const pending = next ? mergeSchema.safeParse(saved(`shiv_guest_merge_${next.id}`)) : null;
      mergeRef.current = pending?.success ? pending.data : null;
      if (next && next.role !== 'ADMIN' && !mergeRef.current && guestRef.current?.lines.length) {
        const draft = { ...guestRef.current, uncertain: false };
        try {
          persist(`shiv_guest_merge_${next.id}`, draft);
          updateGuest(fresh());
        } catch {
          /* The draft stays in memory; the guest basket stays saved until the merge succeeds. */
        }
        mergeRef.current = draft;
      }
      setMergeDraft(mergeRef.current);
      const quoteIntent = readGuest(`shiv_quote_intent_${next?.id || 'guest'}`);
      quoteRef.current = quoteIntent;
      setQuote(quoteIntent);
    }
    identity.current = next;
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
          t(
            'Your sign-in could not be checked just now. You can keep browsing; it is checked again when you return to this page.',
            'आपका साइन इन अभी जाँचा नहीं जा सका। आप सामग्री देखते रहें; इस पेज पर लौटने पर फिर जाँचा जाएगा।',
          ),
        );
      } else showError(e);
    } finally {
      setReady(true);
    }
  }, [identify, refresh, showError, t]);
  useEffect(() => {
    const intent = readGuest('shiv_guest_cart_v2');
    guestRef.current = intent;
    setGuest(intent);
    const quoteIntent = readGuest(`shiv_quote_intent_${identity.current?.id || 'guest'}`);
    quoteRef.current = quoteIntent;
    setQuote(quoteIntent);
    void restore();
    const expired = (event: Event) => {
      const accountId = (event as CustomEvent<{ accountId?: string }>).detail?.accountId;
      if (accountId && accountId !== identity.current?.id) return;
      identify(null);
      setError(
        t(
          'Your session ended. Your saved requests can be recovered after sign-in.',
          'सत्र समाप्त हुआ। साइन इन के बाद सहेजे अनुरोध वापस मिलेंगे।',
        ),
      );
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
  }, [restore, identify, t]);
  function saveMerge(ownerId: string, value: MergeDraft | null) {
    persist(`shiv_guest_merge_${ownerId}`, value);
    if (identity.current?.id === ownerId) {
      mergeRef.current = value;
      setMergeDraft(value);
    }
  }
  async function merge() {
    const owner = identity.current;
    if (!owner || owner.role === 'ADMIN' || mergeLock.current) return;
    const intent = mergeRef.current || guestRef.current;
    if (!intent?.lines.length) return;
    mergeLock.current = true;
    setBusy(true);
    const epoch = generation.current;
    writes.current++;
    try {
      // Freeze the exact request under this account before sending or clearing guest intent.
      saveMerge(owner.id, { ...intent, uncertain: true });
      if (guestRef.current?.key === intent.key) updateGuest(fresh());
      const lines = await customerApi<CartLine[]>(
        '/cart/merge',
        'POST',
        {
          idempotencyKey: intent.key,
          items: intent.lines.map(({ product, quantity }) => ({ productId: product.id, quantity })),
        },
        owner.id,
      );
      if (!Array.isArray(lines))
        throw new CustomerError('NETWORK_ERROR', 'Could not confirm the merged basket.');
      saveMerge(owner.id, null);
      if (generation.current !== epoch) return;
      updateCart(lines);
      setError('');
      setMessage(t('Your saved materials are in your basket.', 'आपकी सहेजी सामग्री टोकरी में है।'));
    } catch (e) {
      if (
        e instanceof CustomerError &&
        [400, 404, 409, 422].includes(e.status) &&
        !['ACCOUNT_CHANGED', 'IDEMPOTENCY_CONFLICT'].includes(e.code)
      )
        saveMerge(owner.id, { ...intent, uncertain: false });
      if (generation.current === epoch) showError(e);
    } finally {
      mergeLock.current = false;
      if (generation.current === epoch) setBusy(false);
    }
  }
  function editMerge(product: Product, quantity: number) {
    const owner = identity.current;
    const draft = mergeRef.current;
    if (!owner || !draft || draft.uncertain || mergeLock.current) return;
    if (
      quantity &&
      quantityProblem(product, quantity, Math.min(product.stock, MAX_LINE_QUANTITY))
    ) {
      showError(new CustomerError('INVALID_QUANTITY', 'Check quantity and stock.'));
      return;
    }
    const lines = draft.lines.filter((line) => line.product.id !== product.id);
    if (quantity) lines.push({ product, quantity });
    saveMerge(
      owner.id,
      lines.length ? { key: crypto.randomUUID(), lines, uncertain: false } : null,
    );
  }
  async function signedIn(next: User) {
    const guestQuote = readGuest('shiv_quote_intent_guest');
    identify(next);
    if (guestQuote.lines.length) {
      const own = quoteRef.current || fresh();
      const lines = [
        ...own.lines,
        ...guestQuote.lines.filter(
          (line) => !own.lines.some((old) => old.product.id === line.product.id),
        ),
      ].slice(0, 50);
      try {
        updateQuote({ key: crypto.randomUUID(), lines });
        persist('shiv_quote_intent_guest', null);
      } catch {
        /* The guest list stays saved and joins this account on the next sign-in. */
      }
    }
    remember('shiv_account_signal', crypto.randomUUID());
    await merge();
    await refresh().catch(showError);
  }
  async function signout() {
    setBusy(true);
    try {
      await tail.current.catch(() => {});
      await customerApi('/auth/logout', 'POST', {});
      const owner = identity.current?.id;
      identify(null);
      if (owner) forgetDrafts(owner);
      persist('shiv_quote_intent_guest', null);
      quoteRef.current = fresh();
      setQuote(quoteRef.current);
      remember('shiv_account_signal', crypto.randomUUID());
      setMessage(t('Signed out.', 'साइन आउट हो गया।'));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  const basketNote = (product: Product, count: number) =>
    count
      ? t(
          `${product.name}: ${count} × ${product.unit} in your basket.`,
          `${productName(product, 'hi')}: टोकरी में ${count} × ${unitLabel(product.unit, 'hi')}।`,
        )
      : t(
          `${product.name} removed from your basket.`,
          `${productName(product, 'hi')} टोकरी से हटाई गई।`,
        );
  async function quantity(product: Product, value: number, add = false) {
    setError('');
    if (!ready || mergeLock.current || mergePending) return;
    const owner = identity.current;
    if (owner?.role === 'ADMIN') {
      setError(
        t(
          'Use a customer account to shop. The owner desk stays separate.',
          'खरीदारी के लिए ग्राहक खाता इस्तेमाल करें। मालिक का पटल अलग है।',
        ),
      );
      return;
    }
    if (!owner) {
      // Guests save instantly with no busy state, so a double tap would add the pack twice.
      const now = Date.now();
      if (add) {
        const last = lastGuestAdd.current;
        if (last.productId === product.id && now - last.at < REPEAT_ADD_MS) return;
        lastGuestAdd.current = { productId: product.id, at: now };
      }
      const intent = guestRef.current || fresh();
      const old = intent.lines.find((line) => line.product.id === product.id)?.quantity || 0;
      const next = add ? old + value : value;
      if (next && quantityProblem(product, next, Math.min(product.stock, MAX_LINE_QUANTITY))) {
        showError(new CustomerError('INVALID_QUANTITY', 'Check minimum, increment and stock.'));
        return;
      }
      const lines = intent.lines.filter((line) => line.product.id !== product.id);
      if (next) lines.push({ product, quantity: next });
      if (lines.length > 50) {
        setError(t('A basket can hold 50 materials.', 'टोकरी में अधिकतम 50 सामग्री रख सकते हैं।'));
        return;
      }
      try {
        updateGuest({ key: crypto.randomUUID(), lines });
        setMessage(basketNote(product, next));
      } catch {
        setError(
          t(
            'This device could not save your basket. Free storage before continuing.',
            'यह उपकरण टोकरी सहेज नहीं सका। जगह खाली करके फिर कोशिश करें।',
          ),
        );
      }
      return;
    }
    const epoch = generation.current;
    writes.current++;
    setBusy(true);
    const run = tail.current
      .catch(() => {})
      .then(async () => {
        if (epoch !== generation.current) return;
        const next = add
          ? (cartRef.current.find((line) => line.productId === product.id)?.quantity || 0) + value
          : value;
        const lines = await customerApi<CartLine[]>(
          '/cart/items',
          'PUT',
          { productId: product.id, quantity: next },
          owner.id,
        );
        if (epoch === generation.current) {
          updateCart(lines);
          setMessage(
            basketNote(product, lines.find((line) => line.productId === product.id)?.quantity || 0),
          );
        }
      });
    tail.current = run;
    try {
      await run;
    } catch (e) {
      if (epoch === generation.current) showError(e);
    } finally {
      if (tail.current === run) setBusy(false);
    }
  }
  function quoteQuantity(product: Product, value: number) {
    // Quotes may exceed current stock; the shop prices the whole site requirement.
    if (value && quantityProblem(product, value, 100000)) {
      showError(new CustomerError('INVALID_QUANTITY', 'Check quantity.'));
      return;
    }
    const current = quoteRef.current || fresh();
    const lines = current.lines.filter((line) => line.product.id !== product.id);
    if (value) lines.push({ product, quantity: value });
    if (lines.length > 50) return;
    try {
      updateQuote({ key: crypto.randomUUID(), lines });
      setMessage(t('Quotation list updated.', 'भाव की सूची अपडेट हो गई।'));
    } catch (e) {
      showError(e);
    }
  }
  const lines: Intent[] = user
    ? cart.map((line) => ({ product: line.product, quantity: line.quantity }))
    : guest?.lines || [];
  return {
    user,
    ready,
    sessionUnknown,
    retrySession: restore,
    cart,
    lines,
    guest,
    quote,
    busy,
    message,
    error,
    setError,
    showError,
    setMessage,
    refresh,
    signedIn,
    signout,
    quantity,
    quoteQuantity,
    clearQuote: (key: string) => {
      if (quoteRef.current?.key === key) updateQuote(fresh());
    },
    currentAccount: () => identity.current?.id,
    merge,
    mergePending,
    mergeDraft,
    editMerge,
    compare,
    toggleCompare: (p: Product) => {
      const old = compare;
      const next = old.some((item) => item.id === p.id)
        ? old.filter((item) => item.id !== p.id)
        : old.length < 3
          ? [...old, p]
          : old;
      keepCompare(next);
      setCompare(next);
    },
    clearCompare: () => {
      keepCompare([]);
      setCompare([]);
    },
    dropCompare,
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

export function Quantity({
  value,
  product,
  onChange,
  max = 10000,
  disabled = false,
}: {
  value: number;
  product: Product;
  onChange: (quantity: number) => void;
  max?: number;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const hindiName = productName(product, 'hi');
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const next = Number(draft);
    if (!/^\d+$/.test(draft) || quantityProblem(product, next, max)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next !== value) onChange(next);
  };
  return (
    <div>
      <div className="quantity">
        <button
          aria-label={t(`Decrease ${product.name}`, `${hindiName} घटाएँ`)}
          disabled={disabled || value <= product.minQuantity}
          onClick={() => onChange(Math.max(product.minQuantity, value - product.quantityStep))}
        >
          −
        </button>
        <input
          aria-label={t(`Quantity for ${product.name}`, `${hindiName} की मात्रा`)}
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              e.currentTarget.blur();
            }
          }}
        />
        <button
          aria-label={t(`Increase ${product.name}`, `${hindiName} बढ़ाएँ`)}
          disabled={disabled || value + product.quantityStep > max}
          onClick={() => onChange(value + product.quantityStep)}
        >
          +
        </button>
      </div>
      {invalid && (
        <p role="alert">
          {t(
            `Minimum ${product.minQuantity}; multiples of ${product.quantityStep}; maximum ${max}.`,
            `न्यूनतम ${product.minQuantity}; ${product.quantityStep} के गुणक; अधिकतम ${max}।`,
          )}
        </p>
      )}
    </div>
  );
}

export function BuyActions({ product }: { product: Product }) {
  const c = useCommerce();
  const { t } = useLanguage();
  const [quantity, setQuantity] = useState(product.minQuantity);
  const unavailable = product.stock < product.minQuantity;
  return (
    <div className="buy-actions">
      <Quantity
        value={quantity}
        product={product}
        onChange={setQuantity}
        max={Math.min(10000, Math.max(product.minQuantity, product.stock))}
        disabled={!c.ready}
      />
      <button
        className="button"
        disabled={!c.ready || c.busy || c.mergePending || unavailable}
        onClick={async () => {
          await c.quantity(product, quantity, true);
        }}
      >
        {product.stock <= 0
          ? t('Out of stock', 'स्टॉक नहीं')
          : unavailable
            ? t('Not enough stock', 'पर्याप्त स्टॉक नहीं')
            : t('Add to basket', 'टोकरी में जोड़ें')}
      </button>
      {product.stock > 0 && product.stock < product.minQuantity && (
        <p>
          {t(
            'Remaining stock is below the minimum order quantity.',
            'बचा स्टॉक न्यूनतम ऑर्डर मात्रा से कम है।',
          )}
        </p>
      )}
      <div className="product-utilities">
        <button
          className="text-link"
          disabled={!c.ready}
          onClick={() => c.quoteQuantity(product, quantity)}
        >
          {t('Add to quote', 'भाव सूची में जोड़ें')}
        </button>
        <button
          className="text-link"
          aria-pressed={c.compare.some((p) => p.id === product.id)}
          disabled={
            !c.ready || (c.compare.length === 3 && !c.compare.some((p) => p.id === product.id))
          }
          onClick={() => c.toggleCompare(product)}
        >
          {c.compare.some((p) => p.id === product.id)
            ? t('Comparing ✓', 'तुलना ✓')
            : t('Compare', 'तुलना करें')}
        </button>
      </div>
    </div>
  );
}

// Rendered in the page flow below the header so an error never hides navigation.
export function CommerceAlert() {
  const c = useCommerce();
  const { t } = useLanguage();
  if (!c.error) return null;
  return (
    <div className="commerce-alert" role="alert">
      <span>{c.error}</span>
      <button onClick={() => c.setError('')} aria-label={t('Dismiss message', 'संदेश हटाएँ')}>
        ×
      </button>
    </div>
  );
}

export function CommerceFeedback() {
  const c = useCommerce();
  const { t } = useLanguage();
  const pathname = usePathname();
  // The basket and checkout pages already show the full list; a second summary would cover it.
  const showBasket = c.lines.length > 0 && !['/cart', '/checkout'].includes(pathname);
  return (
    <>
      {c.message && (
        <div className="basket-feedback" role="status" key={c.message}>
          {c.message}
          <button
            onClick={() => c.setMessage('')}
            aria-label={t('Dismiss notification', 'सूचना हटाएँ')}
          >
            ×
          </button>
        </div>
      )}
      {showBasket && (
        <Link className="sticky-basket" href="/cart">
          <span>
            {t('Basket', 'टोकरी')} · {c.lines.length}{' '}
            {c.lines.length === 1 ? t('material', 'सामग्री') : t('materials', 'सामग्री')}
          </span>
          <strong>
            {price(c.lines.reduce((sum, line) => sum + line.product.pricePaise * line.quantity, 0))}{' '}
            →
          </strong>
        </Link>
      )}
      {c.compare.length > 0 && (
        <Link className="compare-launch" href="/compare">
          {t('Compare', 'तुलना')} ({c.compare.length}/3)
        </Link>
      )}
    </>
  );
}
