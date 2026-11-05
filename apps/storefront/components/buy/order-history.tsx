'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Order, Page } from '@shiv/shared';
import { useCommerce, saved, persist } from './commerce';
import { AccountRequired } from './account';
import { customerApi, CustomerError } from '../../lib/customer-api';
import { list } from '../../lib/list-store';
import { mergePage } from '../../lib/paging';
import { dayLabel, price } from '../../lib/display';
import { orderShareText, whatsappShareUrl } from '../../lib/share';
import { NextSteps } from './first-run';
import { historyNote, orderStatusText } from '@shiv/shared/src/labels';
const language = 'en' as const;

export function Status({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      {orderStatusText(status, language)}
    </span>
  );
}
export function OrderHistory({ orderId }: { orderId?: string }) {
  return (
    <AccountRequired>
      <Orders orderId={orderId} />
    </AccountRequired>
  );
}
function Orders({ orderId }: { orderId?: string }) {
  const c = useCommerce();
  const router = useRouter();
  // Set by checkout on the first visit after placing the order.
  const placed = useSearchParams().get('confirmed') === '1';
  const id = c.user!.id;
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const epoch = useRef(0);
  const deeper = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && c.currentAccount() === id;
  const load = useCallback(
    async (after?: string) => {
      const current = ++epoch.current;
      setBusy(true);
      try {
        if (orderId) {
          const order = await customerApi<Order>(
            `/orders/${encodeURIComponent(orderId)}`,
            'GET',
            undefined,
            id,
          );
          if (current === epoch.current) setOrders([order]);
        } else {
          const page = await customerApi<Page<Order>>(
            `/orders?limit=24${after ? `&cursor=${encodeURIComponent(after)}` : ''}`,
            'GET',
            undefined,
            id,
          );
          if (current === epoch.current) {
            // Focus refreshes the first page; "Load older orders" pages stay listed.
            setOrders((old) => mergePage(old, page.items, !after));
            if (after || !deeper.current) setCursor(page.nextCursor);
            if (after) deeper.current = true;
          }
        }
      } catch (e) {
        if (current === epoch.current) c.showError(e);
      } finally {
        if (current === epoch.current) {
          setBusy(false);
          setLoaded(true);
        }
      }
    },
    [id, orderId, c.showError],
  );
  useEffect(() => {
    deeper.current = false;
    setOrders([]);
    void load();
    const focus = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    document.addEventListener('visibilitychange', focus);
    const timer = orderId ? setInterval(focus, 15000) : undefined;
    return () => {
      epoch.current++;
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', focus);
      document.removeEventListener('visibilitychange', focus);
      clearInterval(timer);
    };
  }, [load, orderId]);
  async function action(order: Order, kind: 'cancel' | 'reorder') {
    if (busy || !current()) return;
    if (kind === 'cancel' && !window.confirm('Cancel this order? Reserved stock will be returned.'))
      return;
    setBusy(true);
    try {
      const key = `shiv_reorder_${id}_${order.id}`;
      const request =
        kind === 'reorder'
          ? saved<{ idempotencyKey: string }>(key) || { idempotencyKey: crypto.randomUUID() }
          : {};
      if (kind === 'reorder') persist(key, request);
      const result = await customerApi<{ notices?: unknown; cart?: unknown }>(
        `/orders/${order.id}/${kind}`,
        'POST',
        request,
        id,
      );
      if (kind === 'reorder') {
        if (
          !Array.isArray(result.cart) ||
          !Array.isArray(result.notices) ||
          !result.notices.every((notice): notice is string => typeof notice === 'string')
        )
          throw new CustomerError('NETWORK_ERROR', 'Could not confirm the reordered basket.');
        persist(key, null);
        if (!current()) return;
        // The list takes these from the cart, at the cart's quantity, even a line taken off here before.
        const reordered = new Set(
          (result.cart as { productId: string }[]).map((row) => row.productId),
        );
        list.replace(
          list.snapshot().lines.filter((line) => !reordered.has(line.i)),
          { owner: id, lines: {} },
        );
        await c.refresh().catch((error) => {
          if (current()) c.showError(error);
        });
        if (!current()) return;
        c.setMessage(result.notices.join(' ') || 'Current materials added to your list.');
        router.push('/list');
      } else if (current()) await load();
    } catch (e) {
      if (current()) c.showError(e);
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <div className="commerce-page">
      <div className="page-heading">
        <h1>
          {orderId && placed
            ? 'Thank you. Your order is placed.'
            : orderId
              ? 'Your order, in progress.'
              : 'Every order, in one place.'}
        </h1>
        <p>Shared with the customer app. Refresh to see the latest shop update.</p>
        <button className="text-link" disabled={busy} onClick={() => void load()}>
          {busy ? 'Refreshing…' : 'Refresh orders'}
        </button>
      </div>
      {!orders.length && loaded && (
        <div className="empty-state">
          <h2>No orders yet.</h2>
          <p>
            Your orders and every step of their delivery will show here, on the website and in the
            app.
          </p>
          <Link className="button" href="/materials">
            Shop materials
          </Link>
        </div>
      )}
      {orders.map((order) => (
        <article className="order-record" key={order.id}>
          <div className="section-heading">
            <div>
              <h2>
                <Link href={`/orders/${order.id}`}>{order.number}</Link>
              </h2>
              <p>{new Date(order.createdAt).toLocaleDateString('en-IN')}</p>
            </div>
            <Status status={order.status} />
          </div>
          {orderId && <NextSteps order={order} placed={placed} />}
          <div className="order-record-grid">
            <div>
              <ul className="review-items">
                {order.items.map((item) => (
                  <li key={item.productId}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.quantity} {item.unit} · {item.packSize}
                    </span>
                    <span>
                      {price(item.pricePaise)} / {item.unit} · {price(item.lineTotalPaise)}
                    </span>
                  </li>
                ))}
              </ul>
              {orderId && (
                <ol className="order-progress">
                  {order.history.map((item) => (
                    <li key={item.id}>
                      <Status status={item.status} />
                      <span>{new Date(item.createdAt).toLocaleString('en-IN')}</span>
                      {historyNote(item.note, language) && (
                        <p>{historyNote(item.note, language)}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <aside>
              <strong className="total-price">{price(order.totalPaise)}</strong>
              <p>Delivery: {price(order.deliveryFeePaise)}</p>
              <p>{order.payment.method === 'COD' ? 'Pay on delivery' : 'Online payment'}</p>
              <p>
                {order.address.name}
                <br />
                {order.address.line1}, {order.address.area}
                <br />
                {order.address.city} {order.address.pincode}
              </p>
              <p>Requested delivery: {dayLabel(order.deliveryDate, language)}</p>
              <div className="action-row">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void action(order, 'reorder')}
                >
                  Reorder at current prices
                </button>
                <a
                  className="text-link"
                  href={whatsappShareUrl(orderShareText(order))}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Share on WhatsApp
                </a>
                {['AWAITING_CONFIRMATION', 'CONFIRMED', 'PENDING_PAYMENT'].includes(
                  order.status,
                ) && (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() => void action(order, 'cancel')}
                  >
                    Cancel order
                  </button>
                )}
              </div>
            </aside>
          </div>
        </article>
      ))}
      {cursor && !orderId && (
        <button className="button secondary" disabled={busy} onClick={() => void load(cursor)}>
          Load older orders
        </button>
      )}
    </div>
  );
}
