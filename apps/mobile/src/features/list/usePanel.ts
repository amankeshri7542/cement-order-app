import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { CheckoutReview, ReviewLeftOut } from '@shiv/shared';
import type { ListLine } from '../../logic/list-core';
import {
  REVIEW_REFRESH_MS,
  REVIEW_WAIT_MS,
  SLOW_AFTER_MS,
  chooseSite,
  orderedRecently,
  placeable,
  repeatLines,
  repeatSite,
  reviewKey,
} from '../../logic/panel-core';
import { rateToShow } from '../../logic/rates';
import { ApiError, api } from '../../state/api';
import { catalogStore } from '../../state/catalog';
import { checkoutStore } from '../../state/checkout';
import { listStore, removeFromList, setQuantity } from '../../state/list';
import { netStore, say } from '../../state/net';
import { ordersStore } from '../../state/orders';
import { sessionStore } from '../../state/session';
import { checkPincode, sitesStore } from '../../state/sites';
import { useSelect } from '../../state/use';

type ListCheck = { lines: { productId: string; status: string; pricePaise: number | null }[] };

/**
 * The panel's one source of truth. A guest's list asks list-check for rates; a signed-in list with a
 * site asks for a review, which is the only total that can be placed. The phone works out line totals
 * at once as the stepper moves, then asks again 600 ms after the last change. Place waits for that.
 */
export function usePanel(repeatId?: string) {
  const user = useSelect(sessionStore, (state) => state.user);
  const sites = useSelect(sitesStore, (state) => state.items);
  const sitesKnown = useSelect(sitesStore, (state) => state.known);
  const draft = useSelect(checkoutStore, (state) => state.draft);
  const panelSite = useSelect(checkoutStore, (state) => state.panelSite);
  const pending = useSelect(checkoutStore, (state) => state.pending);
  const checkoutLoaded = useSelect(checkoutStore, (state) => state.loaded);
  const online = useSelect(netStore, (state) => state.online);
  const listLines = useSelect(listStore, (state) => state.lines);
  const orders = useSelect(ordersStore, (state) => state.items);
  const oldOrder = useSelect(ordersStore, (state) => (repeatId ? state.byId[repeatId] : undefined));
  const byId = useSelect(catalogStore, (state) => state.byId);
  const myRates = useSelect(catalogStore, (state) => state.myRates);
  const pincode = useSelect(sitesStore, (state) => state.pincode);
  const pincodeAnswer = useSelect(sitesStore, (state) => state.answers[state.pincode]);

  // A repeat works on its own copy. Your list stays exactly as it was.
  const [repeat, setRepeat] = useState<ListLine[]>(() => (oldOrder ? repeatLines(oldOrder) : []));
  const lines = repeatId ? repeat : listLines;
  const oldSite = (oldOrder?.address as unknown as { id?: string } | null)?.id;
  const siteId = repeatId
    ? repeatSite(sites, panelSite, oldSite)
    : chooseSite(sites, panelSite ?? draft.addressId);
  const site = sites.find((item) => item.id === siteId);
  const [notes, setNotes] = useState(repeatId ? '' : draft.notes);

  const [review, setReview] = useState<CheckoutReview | null>(null);
  const [reviewedKey, setReviewedKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [slow, setSlow] = useState(false);
  const [problem, setProblem] = useState('');
  const [leftOut, setLeftOut] = useState<ReviewLeftOut[]>([]);
  const [guestRates, setGuestRates] = useState<
    Record<string, { status: string; pricePaise: number | null }>
  >({});
  const [nonce, setNonce] = useState(0);
  const askedBefore = useRef(false);
  const request = useRef(0);
  const reviewedAt = useRef(0);

  const key = reviewKey(lines, siteId, draft.date, notes);
  // A saved request from before is read first: a new order never goes over one not yet known.
  const canReview = Boolean(
    user && user.role !== 'ADMIN' && siteId && lines.length && !pending && online && checkoutLoaded,
  );

  const askAgain = useCallback(() => setNonce((old) => old + 1), []);

  useEffect(() => {
    if (!canReview) {
      setChecking(false);
      return;
    }
    const current = ++request.current;
    setChecking(true);
    setSlow(false);
    const slowTimer = setTimeout(() => {
      if (current === request.current) setSlow(true);
    }, SLOW_AFTER_MS);
    // The first ask goes at once, so the two taps stay two taps.
    const wait = askedBefore.current ? REVIEW_WAIT_MS : 0;
    askedBefore.current = true;
    const timer = setTimeout(() => {
      void api<CheckoutReview>('/checkout/review', 'POST', {
        addressId: siteId,
        deliveryDate: draft.date,
        notes,
        paymentMethod: 'COD',
        lines: lines.map(({ productId, quantity, seenPricePaise }) => ({
          productId,
          quantity,
          ...(seenPricePaise === undefined ? {} : { seenPricePaise }),
        })),
        ...(repeatId ? { repeatOfOrderId: repeatId } : {}),
      })
        .then((answer) => {
          if (current !== request.current) return;
          reviewedAt.current = Date.now();
          setReview(answer);
          setReviewedKey(key);
          setLeftOut(answer.unavailable ?? []);
          setProblem('');
        })
        .catch((error: unknown) => {
          if (current !== request.current) return;
          setReview(null);
          setReviewedKey('');
          const details =
            error instanceof ApiError
              ? (error.details as { unavailable?: ReviewLeftOut[] } | undefined)
              : undefined;
          setLeftOut(details?.unavailable ?? []);
          setProblem(say(error));
        })
        .finally(() => {
          if (current !== request.current) return;
          clearTimeout(slowTimer);
          setChecking(false);
          setSlow(false);
        });
    }, wait);
    return () => {
      clearTimeout(timer);
      clearTimeout(slowTimer);
    };
    // The key says everything a review depends on; `lines` follows it.
  }, [canReview, key, nonce]);

  // A review lasts 5 minutes: an open panel asks again at 4, and on return to the app. If a rate moved
  // meanwhile, the customer sees the new total before any tap can place it.
  useEffect(() => {
    if (!canReview) return;
    const timer = setInterval(() => {
      if (Date.now() - reviewedAt.current >= REVIEW_REFRESH_MS) askAgain();
    }, 30000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - reviewedAt.current >= REVIEW_REFRESH_MS) askAgain();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [canReview, askAgain]);

  // A guest's list: yes or no per line and the current rate, never a count.
  useEffect(() => {
    if (user || !lines.length || !online) return;
    const timer = setTimeout(() => {
      void api<ListCheck>('/public/list-check', 'POST', {
        lines: lines.map(({ productId, quantity }) => ({ productId, quantity })),
      })
        .then((answer) =>
          setGuestRates(Object.fromEntries(answer.lines.map((line) => [line.productId, line]))),
        )
        .catch(() => {});
    }, REVIEW_WAIT_MS);
    return () => clearTimeout(timer);
  }, [user, online, linesKeyOf(lines)]);
  useEffect(() => {
    if (!user && pincode && online) void checkPincode(pincode).catch(() => {});
  }, [user, pincode, online]);

  const reviewed = review && reviewedKey === key ? review : null;
  /** The rate to show on a line: the review's, or the last known one until it answers. */
  const rateOf = useCallback(
    (productId: string) => {
      const line = reviewed?.items.find((item) => item.productId === productId);
      if (line) return line.pricePaise;
      const stale = review?.items.find((item) => item.productId === productId);
      if (stale && !reviewed) return stale.pricePaise;
      const guest = guestRates[productId];
      if (!user && guest) return guest.pricePaise;
      const product = byId[productId];
      return product ? rateToShow(product, myRates[productId]).paise : null;
    },
    [reviewed, review, guestRates, user, byId, myRates],
  );
  const missing = useMemo(() => new Map(leftOut.map((item) => [item.productId, item])), [leftOut]);
  const guestMissing = (id: string) => {
    const status = guestRates[id]?.status;
    return (
      status === 'gone' ||
      status === 'unavailable' ||
      status === 'on_request' ||
      status === 'invalid'
    );
  };
  const subtotal = lines.reduce((total, line) => {
    if (missing.has(line.productId) || (!user && guestMissing(line.productId))) return total;
    return total + (rateOf(line.productId) ?? 0) * line.quantity;
  }, 0);

  function changeLine(productId: string, quantity: number) {
    if (repeatId) {
      setRepeat((old) =>
        quantity <= 0
          ? old.filter((line) => line.productId !== productId)
          : old.map((line) => (line.productId === productId ? { ...line, quantity } : line)),
      );
      return;
    }
    if (quantity <= 0) removeFromList(productId);
    else setQuantity(productId, quantity);
  }

  const canPlace =
    canReview &&
    !checking &&
    placeable(reviewed, reviewedKey, key, Date.now()) &&
    Boolean(reviewed?.items.length);

  return {
    user,
    lines,
    site,
    siteId,
    sites,
    sitesKnown,
    date: draft.date,
    notes,
    setNotes,
    pending,
    online,
    review: reviewed,
    checking,
    slow,
    problem,
    setProblem,
    missing,
    guestMissing,
    rateOf,
    subtotal,
    changeLine,
    askAgain,
    canPlace,
    canReview,
    sameOrder: siteId ? orderedRecently(lines, siteId, orders, Date.now()) : null,
    guestDelivery: !user && pincodeAnswer?.zone ? pincodeAnswer.zone.deliveryFeePaise : null,
    oldOrder,
  };
}

function linesKeyOf(lines: ListLine[]) {
  return lines.map((line) => `${line.productId}:${line.quantity}`).join(',');
}
