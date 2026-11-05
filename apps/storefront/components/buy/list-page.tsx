'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CartLine } from '@shiv/shared';
import { API_URL } from '../../lib/api';
import { productPath, unitWords } from '../../lib/catalog';
import { customerApi, CustomerError } from '../../lib/customer-api';
import { rupees } from '../../lib/format';
import { chooseExits, type LineStatus, type PincodeState } from '../../lib/list-exits';
import {
  list,
  MAX_QTY,
  reconcile,
  roundUp,
  stepDown,
  stepUp,
  type ListInput,
  type ListLine,
} from '../../lib/list-store';
import type { DeliveryAnswer } from '../../lib/pincode';
import { waLink, waText } from '../../lib/whatsapp';
import { PincodeCheck } from '../pincode-check';
import { useCommerce } from './commerce';
import s from './buy.module.css';

type Check = {
  productId: string;
  status: LineStatus;
  pricePaise: number | null;
  minQuantity?: number;
  quantityStep?: number;
};
type Rate = { productId: string; listPaise: number; yourPaise: number };

const lineNote: Partial<Record<LineStatus, string>> = {
  over: 'Large for an online order. Ask for a rate and the shop will reply.',
  unavailable: 'Not available right now. Ask the shop.',
  on_request: 'Brought in to order. Ask for a rate.',
  gone: 'No longer sold. Take it off the list.',
};

/** A line on the account's cart, as a line on this list. */
function fromCart(row: CartLine) {
  const input: ListInput = {
    i: row.productId,
    n: row.product.name,
    u: unitWords(row.product.unit).long,
    m: row.product.minQuantity,
    s: row.product.quantityStep,
    r: row.product.pricePaise,
    h: productPath({
      id: row.productId,
      name: row.product.name,
      categorySlug:
        (row.product as CartLine['product'] & { category?: { slug: string } }).category?.slug ??
        'all',
    }),
  };
  return { id: row.productId, quantity: row.quantity, input };
}

function useOnline() {
  return useSyncExternalStore(
    (change) => {
      addEventListener('online', change);
      addEventListener('offline', change);
      return () => {
        removeEventListener('online', change);
        removeEventListener('offline', change);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Asks the server about the list, 400 ms after it last changed, and only the latest answer counts. */
function useListCheck(lines: ListLine[], online: boolean) {
  const [checks, setChecks] = useState<Map<string, Check>>(new Map());
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const asked = useRef(0);
  const key = lines.map((line) => `${line.i}:${line.q}`).join(',');
  const run = useCallback(async () => {
    const current = ++asked.current;
    const now = list.snapshot().lines;
    if (!now.length) {
      setChecks(new Map());
      setFailed(false);
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      const response = await fetch(`${API_URL}/public/list-check`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          lines: now.map((line) => ({ productId: line.i, quantity: line.q })),
        }),
      });
      if (!response.ok) throw new Error('refused');
      const data = (await response.json()) as { lines: Check[] };
      if (current !== asked.current) return;
      setChecks(new Map(data.lines.map((line) => [line.productId, line])));
      setFailed(false);
    } catch {
      if (current === asked.current) setFailed(true);
    } finally {
      if (current === asked.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    if (!online) return;
    const timer = setTimeout(() => void run(), 400);
    return () => clearTimeout(timer);
  }, [key, online, run]);
  return { checks, failed, checking, retry: run };
}

export function ListPage({
  whatsappNumber,
  whatsappOn,
  sampleRates,
}: {
  whatsappNumber: string;
  whatsappOn: boolean;
  sampleRates: boolean;
}) {
  const c = useCommerce();
  const router = useRouter();
  const params = useSearchParams();
  const state = useSyncExternalStore(list.subscribe, list.snapshot, list.server);
  const lines = state.lines;
  const online = useOnline();
  const { checks, failed, checking, retry } = useListCheck(lines, online);
  const [pin, setPin] = useState('');
  const [delivery, setDelivery] = useState<DeliveryAnswer | null>(null);
  const [pinFailed, setPinFailed] = useState(false);
  const [rates, setRates] = useState<Map<string, Rate>>(new Map());
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<Map<string, string>>(new Map());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const merged = useRef('');

  // Joining this browser's list with the account's cart, once per account per visit.
  const userId = c.user?.id;
  const customer = Boolean(userId && c.user?.role !== 'ADMIN');
  useEffect(() => {
    if (!c.ready || !customer || !userId || merged.current === userId) return;
    let active = true;
    void (async () => {
      try {
        const cart = await c.readCart(userId);
        if (!active) return;
        // Marked only now: a read cut short by this page re-rendering must not count as done.
        merged.current = userId;
        const now = list.snapshot();
        const rows = cart.map(fromCart);
        const { lines: joined } = reconcile(now.lines, now.hint, userId, rows);
        // Every cart line has now been seen here, so one taken off from here on really leaves the cart.
        list.replace(joined, {
          owner: userId,
          lines: Object.fromEntries(rows.map((row) => [row.id, row.quantity])),
        });
      } catch {
        /* The list here still stands; placing the order tries again. */
      }
      try {
        const yours = await customerApi<Rate[]>('/me/rates', 'GET', undefined, userId);
        if (active && Array.isArray(yours))
          setRates(new Map(yours.map((rate) => [rate.productId, rate])));
      } catch {
        /* List rates show instead. */
      }
    })();
    return () => {
      active = false;
    };
    // readCart is rebuilt each render but only reads refs.
  }, [c.ready, customer, userId]);

  const statusOf = useCallback(
    (line: ListLine): LineStatus => {
      if (refused.has(line.i)) return 'unavailable';
      return checks.get(line.i)?.status ?? 'unknown';
    },
    [checks, refused],
  );
  const pincodeState: PincodeState = pinFailed
    ? 'failed'
    : !pin
      ? 'none'
      : delivery?.serviceable
        ? 'served'
        : delivery
          ? 'not_served'
          : 'checking';
  const exits = chooseExits({
    statuses: lines.map(statusOf),
    pincode: pincodeState,
    whatsapp: whatsappOn,
    online,
    checkFailed: failed,
  });
  const whatsappHref = useMemo(
    () =>
      waLink(
        whatsappNumber,
        pin && delivery && !delivery.serviceable
          ? waText.pincode(pin)
          : waText.list(
              lines.map((line) => ({ name: line.n, unit: line.u, qty: line.q })),
              pin || undefined,
            ),
      ),
    [whatsappNumber, lines, pin, delivery],
  );
  const rateFor = (line: ListLine) => {
    const check = checks.get(line.i);
    const current = check ? check.pricePaise : line.r;
    const yours = rates.get(line.i)?.yourPaise;
    return yours && current && yours < current ? yours : current;
  };
  const priced = lines.filter((line) => rateFor(line) !== null);
  const total = priced.reduce((sum, line) => sum + rateFor(line)! * line.q, 0);

  /**
   * Place order: the list becomes the account's cart, one absolute quantity at a time, so sending
   * it twice cannot double anything. One line the server refuses stops only that line.
   */
  const placing = useRef(false);
  const place = useCallback(async () => {
    if (placing.current) return;
    if (!c.user) {
      router.push(`/account?next=${encodeURIComponent('/list?go=order')}`);
      return;
    }
    if (c.user.role === 'ADMIN') {
      c.setError('Use a customer account to shop. The owner desk stays separate.');
      return;
    }
    placing.current = true;
    setSending(true);
    c.setError('');
    setRefused(new Map());
    const id = c.user.id;
    try {
      const cart = await c.readCart(id);
      const now = list.snapshot();
      const { lines: joined, puts } = reconcile(now.lines, now.hint, id, cart.map(fromCart));
      const problems = new Map<string, string>();
      for (const put of puts) {
        try {
          await c.setCartLine(id, put.productId, put.quantity);
        } catch (e) {
          if (e instanceof CustomerError && [400, 404, 409, 422].includes(e.status))
            problems.set(put.productId, 'The shop needs to check this quantity. Ask for a rate.');
          else throw e;
        }
      }
      list.replace(joined, {
        owner: id,
        lines: Object.fromEntries(joined.map((line) => [line.i, line.q])),
      });
      if (problems.size) {
        setRefused(problems);
        return;
      }
      router.push('/checkout');
    } catch (e) {
      c.showError(e);
    } finally {
      placing.current = false;
      setSending(false);
    }
    // c holds stable functions and refs; the customer's id is read fresh above.
  }, [c.user, router]);

  // Back from sign-in, carry on with what the customer asked for.
  const go = params.get('go');
  const continued = useRef(false);
  useEffect(() => {
    if (continued.current || !c.ready || !customer || !lines.length || !checks.size) return;
    if (go === 'order' && exits.lead === 'order') {
      continued.current = true;
      void place();
    }
  }, [c.ready, customer, go, lines.length, checks.size, exits.lead, place]);

  const quantity = (line: ListLine, next: number) => {
    const input: ListInput = {
      i: line.i,
      n: line.n,
      u: line.u,
      m: line.m,
      s: line.s,
      r: line.r,
      h: line.h,
    };
    setRefused((old) => {
      if (!old.has(line.i)) return old;
      const copy = new Map(old);
      copy.delete(line.i);
      return copy;
    });
    list.set(input, next);
  };

  const buttons = {
    order: (lead: boolean) => (
      <button
        key="order"
        type="button"
        className={lead ? 'btn btn-solid' : 'btn btn-quiet'}
        disabled={sending || !c.ready}
        data-exit="order"
        onClick={() => void place()}
      >
        {sending ? 'Please wait…' : c.user || !c.ready ? 'Place order' : 'Place order (sign in)'}
      </button>
    ),
    whatsapp: (lead: boolean) => (
      <a
        key="whatsapp"
        className={lead ? 'btn btn-lamp' : 'btn btn-line'}
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        data-exit="whatsapp"
      >
        Send on WhatsApp
      </a>
    ),
    rate: (lead: boolean) => (
      <Link
        key="rate"
        className={lead ? 'btn btn-solid' : 'btn btn-quiet'}
        href="/quotes"
        data-exit="rate"
      >
        Ask for a rate
      </Link>
    ),
  };

  if (!hydrated)
    return (
      <div className={s.page}>
        <h1>Your list</h1>
        <p className={s.lead} role="status">
          Your list is kept on this phone. Opening it…
        </p>
      </div>
    );
  if (!lines.length)
    return (
      <div className={s.page}>
        <h1>Your list</h1>
        <div className={s.panel}>
          <h2>Nothing yet.</h2>
          <ol className={s.howto}>
            <li>Add what you need from the rates. No sign-in is needed to build a list.</li>
            <li>Check your site&apos;s pincode for the delivery charge.</li>
            <li>Place the order or ask for a rate. A person at the shop confirms it.</li>
          </ol>
          <p className={s.actions}>
            <Link className="btn btn-solid" href="/rates">
              See the rates
            </Link>
            <Link className="btn btn-line" href="/materials">
              All materials
            </Link>
            {whatsappOn ? (
              <a
                className="btn btn-quiet"
                href={waLink(whatsappNumber, waText.order())}
                target="_blank"
                rel="noopener noreferrer"
              >
                Send a photo of your list
              </a>
            ) : null}
          </p>
        </div>
      </div>
    );

  return (
    <div className={s.page}>
      <h1>Your list</h1>
      <p className={s.lead}>
        Check the quantities and the unit. The shop confirms every order; you do not need to call.
      </p>
      {sampleRates ? (
        <p className={s.lead}>
          <span className="sample">Sample rates, not real prices</span>
        </p>
      ) : null}
      {!online ? (
        <p className={s.notice} role="status">
          You are offline. Your list is saved.
        </p>
      ) : null}
      {exits.note && online ? (
        <p className={s.notice} role="status">
          {exits.note}{' '}
          <button type="button" className="link" onClick={() => void retry()}>
            Try again
          </button>
        </p>
      ) : null}
      <div className={s.layout}>
        <ul className={s.lines} aria-busy={checking}>
          {lines.map((line) => {
            const status = statusOf(line);
            const check = checks.get(line.i);
            const rate = rateFor(line);
            const your = rates.get(line.i);
            const changed =
              check && check.pricePaise !== null && line.r !== null && check.pricePaise !== line.r;
            const rules = { m: check?.minQuantity ?? line.m, s: check?.quantityStep ?? line.s };
            return (
              <li className={s.line} key={line.i} data-status={status}>
                <div>
                  <Link className={s.lineName} href={line.h}>
                    {line.n}
                  </Link>
                  <p className={s.lineMeta}>
                    {rate !== null && rate !== undefined ? `${rupees(rate)}, ${line.u}` : line.u}
                  </p>
                  {your && your.yourPaise < your.listPaise && rate === your.yourPaise ? (
                    <p className={s.lineMeta}>Your rate. List rate {rupees(your.listPaise)}.</p>
                  ) : null}
                  {changed ? (
                    <p className={s.lineNote}>
                      Rate changed since you added this. It was {rupees(line.r!)}.
                    </p>
                  ) : null}
                  {status === 'invalid' ? (
                    <p className={s.lineNote}>
                      Smallest order {rules.m}, in steps of {rules.s}.{' '}
                      <button
                        type="button"
                        className="link"
                        onClick={() => quantity(line, Math.min(roundUp(rules, line.q), MAX_QTY))}
                      >
                        Change to {Math.min(roundUp(rules, line.q), MAX_QTY)}
                      </button>
                    </p>
                  ) : null}
                  {lineNote[status] ? <p className={s.lineNote}>{lineNote[status]}</p> : null}
                  {refused.get(line.i) ? <p className={s.lineNote}>{refused.get(line.i)}</p> : null}
                </div>
                <div className={s.lineRight}>
                  <span className="stepper">
                    <button
                      type="button"
                      aria-label={`One less ${line.n}`}
                      onClick={() => quantity(line, stepDown(rules, line.q))}
                    >
                      −
                    </button>
                    <output aria-label={`${line.n} quantity`}>{line.q}</output>
                    <button
                      type="button"
                      aria-label={`One more ${line.n}`}
                      onClick={() => quantity(line, stepUp(rules, line.q))}
                    >
                      +
                    </button>
                  </span>
                  <strong className={s.lineTotal}>
                    {rate !== null && rate !== undefined
                      ? rupees(rate * line.q)
                      : 'Ask for the rate'}
                  </strong>
                  <button type="button" className="link" onClick={() => quantity(line, 0)}>
                    Remove <span className="sr">{line.n}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <aside className={s.side}>
          <h2>Materials total</h2>
          <p className={s.total}>{priced.length ? rupees(total) : 'Ask for the rate'}</p>
          {priced.length < lines.length && priced.length ? (
            <p className={s.lineMeta}>Lines with no rate are not in this total.</p>
          ) : null}
          <p className={s.lineMeta}>
            Delivery is shown apart from this, and the final rate is checked again before you
            confirm.
          </p>
          <h3>Can the shop deliver?</h3>
          <PincodeCheck
            whatsapp={whatsappOn ? waLink(whatsappNumber, waText.pincode(pin || '')) : undefined}
            onResult={(value, answer) => {
              setPin(value);
              setDelivery(answer);
              setPinFailed(Boolean(value) && !answer);
            }}
          />
          <div className={s.exits}>
            {exits.lead ? buttons[exits.lead](true) : null}
            {exits.others.map((name) => buttons[name](false))}
            {exits.orderOff ? (
              <p className={s.lineMeta} data-order-off>
                {exits.orderOff}
              </p>
            ) : null}
          </div>
          <p className={s.lineMeta}>
            Place order is confirmed by a person at the shop. Ask for a rate gets you a written
            reply.
          </p>
        </aside>
      </div>
    </div>
  );
}
