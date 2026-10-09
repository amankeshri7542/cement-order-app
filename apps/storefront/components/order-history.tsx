'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Order, Page } from '@shiv/shared';
import { useCommerce, saved, persist } from './commerce';
import { AccountRequired } from './account';
import { customerApi, CustomerError } from '../lib/customer-api';
import { price } from '../lib/catalog';
import { useLanguage } from './language';

const statuses: Record<string, [string, string]> = {
  CONFIRMED: ['Confirmed', 'पक्का हुआ'],
  PREPARING: ['Preparing', 'तैयारी हो रही है'],
  OUT_FOR_DELIVERY: ['Out for delivery', 'डिलीवरी के लिए निकला'],
  DELIVERY_EXCEPTION: ['Delivery needs attention', 'डिलीवरी पर ध्यान चाहिए'],
  DELIVERED: ['Delivered', 'डिलीवरी हो गई'],
  CANCELLED: ['Cancelled', 'रद्द'],
  REFUND_PENDING: ['Refund pending', 'वापसी बाकी'],
  REFUNDED: ['Refunded', 'राशि वापस'],
  PENDING_PAYMENT: ['Payment pending', 'भुगतान बाकी'],
};
export function Status({ status }: { status: string }) {
  const { t } = useLanguage();
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      {statuses[status] ? t(...statuses[status]) : status}
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
  const { t, language } = useLanguage();
  const router = useRouter();
  const id = c.user!.id;
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const epoch = useRef(0);
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
            setOrders((old) =>
              after
                ? [...old, ...page.items.filter((item) => !old.some((prev) => prev.id === item.id))]
                : page.items,
            );
            setCursor(page.nextCursor);
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
    if (
      kind === 'cancel' &&
      !window.confirm(
        t(
          'Cancel this order? Reserved stock will be returned.',
          'यह ऑर्डर रद्द करें? आरक्षित स्टॉक वापस होगा।',
        ),
      )
    )
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
        await c.refresh().catch((error) => {
          if (current()) c.showError(error);
        });
        if (!current()) return;
        c.setMessage(
          result.notices.join(' ') ||
            t('Current materials added to your basket.', 'मौजूदा सामग्री आपकी टोकरी में जुड़ी।'),
        );
        router.push('/cart');
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
        <p className="eyebrow">{t('YOUR SHIV CEMENT ACCOUNT', 'आपका शिव सीमेंट खाता')}</p>
        <h1>
          {orderId
            ? t('Your order, in progress.', 'आपका ऑर्डर, हर कदम पर।')
            : t('Every order, in one place.', 'हर ऑर्डर, एक जगह।')}
        </h1>
        <p>
          {t(
            'Shared with the customer app. Refresh to see the latest shop update.',
            'ग्राहक ऐप के साथ साझा। दुकान का ताज़ा अपडेट देखने के लिए फिर लोड करें।',
          )}
        </p>
        <button className="text-link" disabled={busy} onClick={() => void load()}>
          {busy ? t('Refreshing…', 'अपडेट हो रहा है…') : t('Refresh orders', 'ऑर्डर अपडेट करें')}
        </button>
      </div>
      {!orders.length && loaded && (
        <div className="empty-state">
          <h2>{t('Your first project starts here.', 'आपका पहला काम यहाँ शुरू होता है।')}</h2>
          <Link className="button" href="/products">
            {t('Shop materials', 'सामग्री खरीदें')}
          </Link>
        </div>
      )}
      {orders.map((order) => (
        <article className="order-record" key={order.id}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t('CONFIRMED RECORD', 'सहेजा रिकॉर्ड')}</p>
              <h2>
                <Link href={`/orders/${order.id}`}>{order.number}</Link>
              </h2>
              <p>
                {new Date(order.createdAt).toLocaleDateString(
                  language === 'hi' ? 'hi-IN' : 'en-IN',
                )}
              </p>
            </div>
            <Status status={order.status} />
          </div>
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
                      <span>
                        {new Date(item.createdAt).toLocaleString(
                          language === 'hi' ? 'hi-IN' : 'en-IN',
                        )}
                      </span>
                      {item.note && <p>{item.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <aside>
              <strong className="total-price">{price(order.totalPaise)}</strong>
              <p>
                {t('Delivery', 'डिलीवरी')}: {price(order.deliveryFeePaise)}
              </p>
              <p>
                {order.payment.method === 'COD'
                  ? t('Pay on delivery', 'डिलीवरी पर भुगतान')
                  : t('Online payment', 'ऑनलाइन भुगतान')}
              </p>
              <p>
                {order.address.name}
                <br />
                {order.address.line1}, {order.address.area}
                <br />
                {order.address.city} {order.address.pincode}
              </p>
              <p>
                {t('Requested delivery', 'चाही गई डिलीवरी')}: {order.deliveryDate}
              </p>
              <div className="action-row">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void action(order, 'reorder')}
                >
                  {t('Reorder at current prices', 'मौजूदा भाव पर फिर खरीदें')}
                </button>
                {['CONFIRMED', 'PENDING_PAYMENT'].includes(order.status) && (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() => void action(order, 'cancel')}
                  >
                    {t('Cancel order', 'ऑर्डर रद्द करें')}
                  </button>
                )}
              </div>
            </aside>
          </div>
        </article>
      ))}
      {cursor && !orderId && (
        <button className="button secondary" disabled={busy} onClick={() => void load(cursor)}>
          {t('Load older orders', 'पुराने ऑर्डर लोड करें')}
        </button>
      )}
    </div>
  );
}
