'use client';
import { useEffect, useRef, useState } from 'react';
import { Order, OrderStatus, User, money, transitions } from '@shiv/shared';
import { ArrowUpRight, Search, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { useWords } from '../lib/i18n';
import { Badge, Empty, Modal, Field } from './ui';
import { AlertRetry } from './quotes';

type T = (en: string, hi: string) => string;
const remaining = (order: Order) =>
  order.payment.status === 'PENDING' && !['CANCELLED', 'REFUNDED'].includes(order.status)
    ? order.totalPaise
    : 0;
const nextAction = (order: Order, t: T) =>
  !order.work?.acknowledgedAt && order.work
    ? t('Acknowledge', 'ज़िम्मेदारी लें')
    : (
        {
          CONFIRMED: t('Prepare', 'तैयार करें'),
          PREPARING: t('Dispatch', 'रवाना करें'),
          OUT_FOR_DELIVERY: remaining(order)
            ? t('Money received · finish delivery', 'पैसा मिला · डिलीवरी पूरी करें')
            : t('Complete delivery', 'डिलीवरी पूरी करें'),
          DELIVERY_EXCEPTION: t('Resolve delivery', 'समस्या हल करें'),
        } as Partial<Record<OrderStatus, string>>
      )[order.status] || t('View order', 'ऑर्डर देखें');
function settlementNote(order: Order, t: T) {
  if (order.payment.status === 'REFUND_PENDING')
    return t(
      `The store owes a full refund of ${money(order.totalPaise)}.`,
      `दुकान को ${money(order.totalPaise)} पूरा लौटाना है।`,
    );
  if (order.payment.status === 'REFUNDED')
    return t('Fully refunded; nothing to collect.', 'पूरा पैसा लौटा दिया गया; कुछ लेना नहीं है।');
  if (
    order.status === 'CANCELLED' &&
    order.payment.method === 'COD' &&
    order.payment.status === 'PENDING'
  )
    return t(
      'Cancelled before payment; nothing to collect.',
      'ऑर्डर पैसा मिलने से पहले रद्द हुआ; कुछ लेना नहीं है।',
    );
  return '';
}
function CustomerContact({ phone }: { phone: string }) {
  const { t } = useWords();
  if (!phone.trim())
    return (
      <p className="hint">
        {t(
          'Contact details were removed with the customer account.',
          'खाता हटाने पर संपर्क जानकारी हटा दी गई।',
        )}
      </p>
    );
  return (
    <div className="owner-actions">
      <a href={`tel:${phone}`}>
        {t('Call', 'फ़ोन')} {phone}
      </a>
      <a href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
        WhatsApp
      </a>
    </div>
  );
}
export function OrdersTable({ orders, select }: { orders: Order[]; select: (id: string) => void }) {
  const { t, age } = useWords();
  return (
    <>
      <div className="owner-order-cards">
        {orders.map((o) => (
          <article className="owner-order-card" key={o.id}>
            <div className="row-between">
              <strong>{o.number}</strong>
              <Badge value={o.status} />
            </div>
            <h3>{o.user?.name || o.address.name}</h3>
            <p>
              {o.address.area}, {o.address.city} · {o.deliveryDate}
            </p>
            <p>{o.items.map((i) => `${i.name}: ${i.quantity} ${i.unit}`).join(' · ')}</p>
            <div className="row-between">
              <strong>{money(o.totalPaise)}</strong>
              <span>
                {t('To collect', 'बाकी')}: {money(remaining(o))}
              </span>
            </div>
            <small>
              {age(o.createdAt)} ·{' '}
              {o.work?.assignedTo?.name || t('Not assigned', 'ज़िम्मेदारी बाकी')}
            </small>
            {o.work?.lastError && (
              <p className="warning">
                {t(
                  `Alert failed (${o.work.attempts} tries).`,
                  `अलर्ट नहीं पहुँचा (${o.work.attempts} बार)।`,
                )}
              </p>
            )}
            <button
              className="primary wide owner-next-action"
              aria-label={`${t('Open', 'खोलें')} ${o.number}`}
              onClick={() => select(o.id)}
            >
              {nextAction(o, t)}
            </button>
            {settlementNote(o, t) && <p className="hint">{settlementNote(o, t)}</p>}
            <CustomerContact phone={o.address.phone} />
          </article>
        ))}
      </div>
      <div className="table-wrap owner-order-table">
        <table>
          <thead>
            <tr>
              <th>{t('Order', 'ऑर्डर')}</th>
              <th>{t('Customer', 'ग्राहक')}</th>
              <th>{t('Delivery', 'डिलीवरी')}</th>
              <th>{t('Total', 'कुल')}</th>
              <th>{t('Status', 'स्थिति')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong>{o.number}</strong>
                  <small>
                    {age(o.createdAt)} ·{' '}
                    {t(`${o.items.length} products`, `${o.items.length} सामग्री`)}
                  </small>
                </td>
                <td>
                  <strong>{o.user?.name || o.address.name}</strong>
                  <small>{o.address.city}</small>
                </td>
                <td>
                  {o.deliveryDate}
                  <small>
                    {o.payment.method === 'COD'
                      ? t('Cash on delivery', 'डिलीवरी पर भुगतान')
                      : t('Online payment', 'ऑनलाइन भुगतान')}
                  </small>
                </td>
                <td>
                  <strong>{money(o.totalPaise)}</strong>
                  <small>
                    <Badge value={o.payment.status} />
                  </small>
                </td>
                <td>
                  <Badge value={o.status} />
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`${t('Open', 'खोलें')} ${o.number}`}
                    onClick={() => select(o.id)}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!orders.length && (
        <Empty
          title={t('No orders here', 'यहाँ कोई ऑर्डर नहीं')}
          body={t(
            'Customer orders appear here as soon as they are placed.',
            'ग्राहक के ऑर्डर देते ही यहाँ दिखेंगे।',
          )}
        />
      )}
    </>
  );
}
export function Orders({
  onFilter,
  query,
  onQueue,
  orders,
  refresh,
  notice,
  selectedId,
  setSelectedId,
}: {
  orders: Order[];
  refresh: () => Promise<void>;
  notice: (value: string) => void;
  onFilter: (query: string) => void;
  query: string;
  onQueue: (queue: string) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}) {
  const { t, status, error: say } = useWords();
  const params = new URLSearchParams(query);
  const filter = params.get('status') || '';
  const search = params.get('q') || '';
  const queue = params.get('queue') || '';
  const queueLabels = {
    new: t('New work', 'नया काम'),
    dispatch: t('Dispatch due', 'भेजना है'),
    payments: t('Money to confirm', 'पैसा लेना है'),
    issues: t('Issues', 'समस्या'),
  };
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    if (value) next.set(key, value);
    else next.delete(key);
    onFilter(next.toString());
  };
  const [detail, setDetail] = useState<Order | null>(null);
  useEffect(() => {
    let live = true;
    if (selectedId)
      void api<Order>(`/admin/orders/${selectedId}`)
        .then((o) => {
          if (live) setDetail(o);
        })
        .catch((e) => notice(say(e)));
    else setDetail(null);
    return () => {
      live = false;
    };
  }, [selectedId, orders, notice]);
  const selected = detail?.id === selectedId ? detail : null;
  return (
    <>
      <div className="owner-queue-tabs" aria-label={t('Order queues', 'ऑर्डर की कतार')}>
        <button className={!queue ? 'primary' : 'secondary'} onClick={() => onQueue('')}>
          {t('All', 'सभी')}
        </button>
        {Object.entries(queueLabels).map(([key, label]) => (
          <button
            key={key}
            className={queue === key ? 'primary' : 'secondary'}
            onClick={() => onQueue(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <label className="search">
          <Search size={18} />
          <input
            aria-label={t('Search orders', 'ऑर्डर खोजें')}
            placeholder={t('Search order number or customer', 'ऑर्डर नंबर या ग्राहक खोजें')}
            value={search}
            onChange={(e) => updateFilter('q', e.target.value)}
          />
        </label>
        <select
          aria-label={t('Filter order status', 'स्थिति से छाँटें')}
          value={filter}
          onChange={(e) => updateFilter('status', e.target.value)}
        >
          <option value="">{t('All orders', 'सभी ऑर्डर')}</option>
          {Object.keys(transitions).map((s) => (
            <option key={s} value={s}>
              {status(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="panel">
        <OrdersTable orders={orders} select={setSelectedId} />
      </div>
      {selected && (
        <OrderDetail
          order={selected}
          close={() => setSelectedId(null)}
          refresh={refresh}
          notice={notice}
        />
      )}
    </>
  );
}
function OrderDetail({
  order,
  close,
  refresh,
  notice,
}: {
  order: Order;
  close: () => void;
  refresh: () => Promise<void>;
  notice: (s: string) => void;
}) {
  const { t, status: statusText, error: say, age, moment } = useWords();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [owners, setOwners] = useState<User[]>([]);
  const saving = useRef(false);
  const deliveryKeys = useRef<Record<string, string>>({});
  useEffect(() => {
    void api<User[]>('/admin/owners')
      .then(setOwners)
      .catch((e) => setError(say(e)));
  }, []);
  async function run(steps: () => Promise<void>, done = t('Order updated', 'ऑर्डर अपडेट हुआ')) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await steps();
      notice(done);
    } catch (e) {
      setError(say(e));
    } finally {
      // Refresh even after a partial failure so the screen shows what was saved.
      await refresh().catch(() => {});
      saving.current = false;
      setBusy(false);
    }
  }
  const call = (path: string, body?: unknown) =>
    api(`/admin/orders/${order.id}/${path}`, path === 'status' ? 'PATCH' : 'POST', body);
  async function delivery(
    e: React.FormEvent<HTMLFormElement>,
    kind: 'REPORT' | 'RETRY' | 'RETURN',
  ) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      action: kind,
      note: String(form.get('note') || ''),
      ...(kind === 'REPORT' ? { reason: form.get('reason') } : {}),
      ...(kind === 'RETRY' ? { retryDate: form.get('retryDate') } : {}),
      ...(kind === 'RETURN'
        ? {
            items: order.items.map((item) => ({
              productId: item.productId,
              sellableQuantity: Number(form.get(`sellable-${item.productId}`)),
              damagedQuantity: Number(form.get(`damaged-${item.productId}`)),
            })),
          }
        : {}),
    };
    const signature = JSON.stringify(body);
    const idempotencyKey = (deliveryKeys.current[signature] ||= crypto.randomUUID());
    await run(() => call('delivery', { ...body, idempotencyKey }).then(() => {}));
  }
  /** Money first, then the delivery: one tap for the common case at the site. */
  function collectAndDeliver(channel: 'CASH' | 'UPI') {
    const how = channel === 'CASH' ? t('cash', 'नकद') : 'UPI';
    if (
      !window.confirm(
        t(
          `Received ${money(order.totalPaise)} by ${how} in full, and the materials are delivered?`,
          `${money(order.totalPaise)} पूरा ${how} में मिला और माल पहुँच गया?`,
        ),
      )
    )
      return;
    void run(
      async () => {
        await call('cod-received', { channel });
        await call('status', { status: 'DELIVERED', note });
      },
      t('Payment recorded and delivery completed', 'पैसा दर्ज हुआ और डिलीवरी पूरी हुई'),
    );
  }
  function collectOnly(channel: 'CASH' | 'UPI') {
    const how = channel === 'CASH' ? t('cash', 'नकद') : 'UPI';
    if (
      !window.confirm(
        t(
          `Confirm you received ${money(order.totalPaise)} by ${how} in full?`,
          `${money(order.totalPaise)} पूरा ${how} में मिलने की पुष्टि करें?`,
        ),
      )
    )
      return;
    void run(
      () => call('cod-received', { channel }).then(() => {}),
      t('Payment recorded', 'भुगतान दर्ज हुआ'),
    );
  }
  const confirmStatus: Partial<Record<OrderStatus, string>> = {
    PREPARING: t('Start preparing this order?', 'यह ऑर्डर तैयार करना शुरू करें?'),
    OUT_FOR_DELIVERY: t(
      'Dispatch this order now? The customer will see it is on the way.',
      'ऑर्डर अभी रवाना करें? ग्राहक को दिखेगा कि माल रास्ते में है।',
    ),
    DELIVERED: t('Mark the materials as delivered?', 'माल पहुँच गया, डिलीवरी पूरी करें?'),
    CANCELLED: t(
      'Cancel this order and return its stock?',
      'यह ऑर्डर रद्द करें और स्टॉक वापस जोड़ें?',
    ),
  };
  const statusButton: Partial<Record<OrderStatus, string>> = {
    PREPARING: t('Start preparing', 'तैयार करना शुरू करें'),
    OUT_FOR_DELIVERY: t('Dispatch', 'माल रवाना करें'),
    DELIVERED: t('Complete delivery', 'डिलीवरी पूरी करें'),
    CANCELLED: t('Cancel order', 'ऑर्डर रद्द करें'),
  };
  const codDue =
    order.payment.method === 'COD' &&
    order.payment.status === 'PENDING' &&
    ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'].includes(order.status);
  const allowed = transitions[order.status].filter(
    (s) =>
      !['CONFIRMED', 'REFUND_PENDING', 'REFUNDED', 'DELIVERY_EXCEPTION'].includes(s) &&
      order.status !== 'DELIVERY_EXCEPTION' &&
      // Delivery is completed together with the money while cash is still due.
      !(s === 'DELIVERED' && codDue),
  );
  const ownerSelect = (technical: boolean, label: string) =>
    order.work && (
      <Field label={label}>
        <select
          defaultValue={technical ? order.work.technicalOwner?.id || '' : ''}
          disabled={busy}
          onChange={(e) => {
            const ownerId = e.target.value;
            if (!ownerId) return;
            void run(
              () =>
                api(`/admin/work/${order.work!.id}/assign`, 'POST', {
                  ownerId,
                  ...(technical ? { technical: true } : {}),
                }).then(() => {}),
              t('Assigned', 'ज़िम्मेदारी बदली'),
            );
          }}
        >
          <option value="">{t('Choose owner', 'मालिक चुनें')}</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name || owner.phone}
            </option>
          ))}
        </select>
      </Field>
    );
  return (
    <Modal title={order.number} close={close}>
      <div className="form-stack">
        <div className="row-between">
          <Badge value={order.status} />
          <button className="text-button" onClick={() => window.print()}>
            <Printer size={16} />
            {t('Print summary', 'सारांश छापें')}
          </button>
        </div>
        <p className="hint">
          <span>{t('Order summary · not a GST tax invoice', 'ऑर्डर सारांश · GST बिल नहीं')}</span> ·{' '}
          {t(`placed ${age(order.createdAt)} ago`, `${age(order.createdAt)} पहले आया`)}
        </p>
        {order.work && (
          <section className="detail-block">
            <p>
              {t('Assigned', 'ज़िम्मेदारी')}:{' '}
              <strong>{order.work.assignedTo?.name || t('Nobody yet', 'अभी किसी की नहीं')}</strong>
            </p>
            {!order.work.acknowledgedAt && (
              <button
                className="primary wide"
                disabled={busy}
                onClick={() => void run(() => call('acknowledge', {}).then(() => {}))}
              >
                {t('Acknowledge', 'ज़िम्मेदारी लें')}
              </button>
            )}
            {order.work.lastError && (
              <AlertRetry
                workId={order.work.id}
                attempts={order.work.attempts}
                done={async (text) => {
                  await refresh();
                  if (text) notice(text);
                }}
              />
            )}
            {ownerSelect(false, t('Assign owner', 'ज़िम्मेदारी बदलें'))}
          </section>
        )}
        <div className="detail-block">
          <strong>{order.address.name}</strong>
          <p>
            {order.address.line1}, {order.address.area}
            <br />
            {order.address.city}, Bihar {order.address.pincode}
            {order.address.landmark && (
              <>
                <br />
                {t('Landmark', 'पहचान')}: {order.address.landmark}
              </>
            )}
          </p>
          <CustomerContact phone={order.address.phone} />
          <p>
            {t('Delivery', 'डिलीवरी')}: {order.deliveryDate}
            {order.notes && (
              <>
                <br />
                {t('Note', 'निर्देश')}: {order.notes}
              </>
            )}
          </p>
        </div>
        {order.items.map((i) => (
          <div className="line-item" key={i.productId}>
            <div>
              <strong>{i.name}</strong>
              <small>
                {i.quantity} × {money(i.pricePaise)} / {i.unit}
              </small>
            </div>
            <b>{money(i.lineTotalPaise)}</b>
          </div>
        ))}
        <div className="row-between">
          <span>{t('Delivery charge', 'भाड़ा')}</span>
          <span>{money(order.deliveryFeePaise)}</span>
        </div>
        <div className="row-between total">
          <b>{t('Total', 'कुल')}</b>
          <b>{money(order.totalPaise)}</b>
        </div>
        <p>
          {t('Payment', 'भुगतान')}:{' '}
          {order.payment.method === 'COD'
            ? t('Cash on delivery', 'डिलीवरी पर भुगतान')
            : t('Online', 'ऑनलाइन')}{' '}
          · <Badge value={order.payment.status} />
        </p>
        <p>
          <strong>
            {t('To collect', 'बाकी पैसा')}: {money(remaining(order))}
          </strong>
        </p>
        {settlementNote(order, t) && <p className="notice">{settlementNote(order, t)}</p>}
        {codDue && order.status === 'OUT_FOR_DELIVERY' && (
          <section className="form-stack" aria-label={t('Finish delivery', 'डिलीवरी पूरी करें')}>
            <button
              className="primary wide"
              disabled={busy}
              onClick={() => collectAndDeliver('CASH')}
            >
              {t('Cash received · delivered', 'नकद मिला · डिलीवरी पूरी')}
            </button>
            <button
              className="primary wide"
              disabled={busy}
              onClick={() => collectAndDeliver('UPI')}
            >
              {t('UPI received · delivered', 'UPI मिला · डिलीवरी पूरी')}
            </button>
          </section>
        )}
        {codDue && order.status !== 'OUT_FOR_DELIVERY' && (
          <div className="button-row">
            <button className="secondary" disabled={busy} onClick={() => collectOnly('CASH')}>
              {t('Cash received', 'नकद मिल गया')}
            </button>
            <button className="secondary" disabled={busy} onClick={() => collectOnly('UPI')}>
              {t('UPI received', 'UPI मिल गया')}
            </button>
          </div>
        )}
        {order.payment.method === 'COD' && order.payment.status === 'REFUND_PENDING' && (
          <button
            disabled={busy}
            className="secondary"
            onClick={() => {
              if (
                window.confirm(
                  t(
                    'Confirm the full cash refund has been returned to the customer?',
                    'ग्राहक को पूरा नकद पैसा लौटा दिया गया, पुष्टि करें?',
                  ),
                )
              )
                void run(
                  () => call('cash-refunded').then(() => {}),
                  t('Refund recorded', 'वापसी दर्ज हुई'),
                );
            }}
          >
            {t('Cash refund returned', 'नकद लौटाया')}
          </button>
        )}
        {order.payment.method === 'ONLINE' && order.payment.status === 'REFUND_PENDING' && (
          <section className="form-stack">
            <p className="warning">
              {t(
                'Refund pending. A named technical operator must issue the full refund in Razorpay; only its verified webhook confirms it.',
                'वापसी बाकी है। तकनीकी ज़िम्मेदार व्यक्ति Razorpay में पूरा पैसा लौटाए; उसकी पक्की सूचना ही इसे पूरा मानेगी।',
              )}
            </p>
            {ownerSelect(true, t('Refund technical operator', 'वापसी की तकनीकी ज़िम्मेदारी'))}
          </section>
        )}
        {order.payment.method === 'ONLINE' && order.payment.status === 'PENDING' && (
          <details>
            <summary>{t('Technical payment recovery', 'तकनीकी सहायता')}</summary>
            <p>
              {t(
                'Automation cannot confirm this payment. Assign a named technical operator; never accept a screenshot as proof.',
                'यह भुगतान अपने आप पक्का नहीं हुआ। किसी तकनीकी व्यक्ति को ज़िम्मेदारी दें; स्क्रीनशॉट को सबूत न मानें।',
              )}
            </p>
            {ownerSelect(true, t('Technical operator', 'तकनीकी ज़िम्मेदार'))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const razorpayOrderId = new FormData(e.currentTarget).get('provider');
                void run(() => call('reconcile-payment', { razorpayOrderId }).then(() => {}));
              }}
            >
              <p className="warning">
                {t(
                  `Find the Razorpay order by receipt ${order.id}. Check its amount and currency. Do not create a replacement payment while the first result is uncertain.`,
                  `रसीद ${order.id} से Razorpay ऑर्डर खोजें। राशि और मुद्रा जाँचें। पहला परिणाम पक्का न हो तो नया भुगतान न बनाएँ।`,
                )}
              </p>
              <Field
                label={t('Razorpay order ID for reconciliation', 'मिलान के लिए Razorpay ऑर्डर ID')}
              >
                <input
                  name="provider"
                  defaultValue={order.payment.razorpayOrderId || ''}
                  required
                  placeholder="order_…"
                />
              </Field>
              <button className="secondary" disabled={busy}>
                {t('Verify gateway payment', 'भुगतान जाँचें')}
              </button>
            </form>
          </details>
        )}
        {order.status === 'OUT_FOR_DELIVERY' && (
          <details>
            <summary>{t('Delivery problem', 'डिलीवरी में समस्या')}</summary>
            <form className="form-stack" onSubmit={(e) => void delivery(e, 'REPORT')}>
              <Field label={t('Reason', 'कारण')}>
                <select name="reason">
                  <option value="UNAVAILABLE">
                    {t('Customer unavailable', 'ग्राहक नहीं मिला')}
                  </option>
                  <option value="REFUSED">{t('Refused', 'ग्राहक ने मना किया')}</option>
                  <option value="INACCESSIBLE">{t('Site inaccessible', 'रास्ता बंद')}</option>
                </select>
              </Field>
              <Field label={t('What happened', 'क्या हुआ')}>
                <textarea name="note" required minLength={1} maxLength={500} />
              </Field>
              <button className="secondary" disabled={busy}>
                {t('Record problem', 'समस्या दर्ज करें')}
              </button>
            </form>
          </details>
        )}
        {order.status === 'DELIVERY_EXCEPTION' && (
          <section className="form-stack">
            <p className="warning">
              {t(
                'Delivery is incomplete; the stock is still with the delivery.',
                'डिलीवरी पूरी नहीं हुई। माल अभी गाड़ी के साथ है।',
              )}
            </p>
            <form className="form-stack" onSubmit={(e) => void delivery(e, 'RETRY')}>
              <Field label={t('Retry date', 'दोबारा भेजने की तारीख')}>
                <input type="date" name="retryDate" required />
              </Field>
              <Field label={t('Arrangement with the customer', 'ग्राहक से तय बात')}>
                <textarea name="note" required maxLength={500} />
              </Field>
              <button className="primary" disabled={busy}>
                {t('Schedule retry', 'फिर भेजें')}
              </button>
            </form>
            <details>
              <summary>{t('Confirm physical return', 'दुकान में माल वापस मिला')}</summary>
              <form
                className="form-stack"
                onSubmit={(e) => {
                  if (
                    window.confirm(
                      t(
                        'Confirm these materials are physically back at the shop?',
                        'क्या यह माल सच में दुकान में वापस आ गया है?',
                      ),
                    )
                  )
                    void delivery(e, 'RETURN');
                  else e.preventDefault();
                }}
              >
                <p>
                  {t(
                    'Count every unit. Only sellable returned units go back into stock.',
                    'हर इकाई गिनें। सिर्फ़ बेचने लायक माल ही स्टॉक में वापस जुड़ेगा।',
                  )}
                </p>
                {order.items.map((item) => (
                  <fieldset key={item.productId}>
                    <legend>
                      {item.name} · {item.quantity} {item.unit}
                    </legend>
                    <Field label={t('Sellable returned', 'सही माल')}>
                      <input
                        name={`sellable-${item.productId}`}
                        type="number"
                        required
                        min="0"
                        max={item.quantity}
                        step="1"
                        defaultValue={item.quantity}
                      />
                    </Field>
                    <Field label={t('Damaged returned', 'खराब माल')}>
                      <input
                        name={`damaged-${item.productId}`}
                        type="number"
                        required
                        min="0"
                        max={item.quantity}
                        step="1"
                        defaultValue="0"
                      />
                    </Field>
                  </fieldset>
                ))}
                <Field label={t('Return details', 'वापसी का विवरण')}>
                  <textarea name="note" required maxLength={500} />
                </Field>
                <button className="danger" disabled={busy}>
                  {t('Confirm returned stock', 'वापसी की पुष्टि')}
                </button>
              </form>
            </details>
          </section>
        )}
        {!!order.deliveryAttempts?.length && (
          <details>
            <summary>{t('Delivery attempts', 'डिलीवरी की कोशिशें')}</summary>
            <ol className="timeline">
              {order.deliveryAttempts.map((attempt) => (
                <li key={attempt.id}>
                  <strong>
                    {attempt.action} · {attempt.reason}
                  </strong>
                  <p>
                    {attempt.note}
                    {attempt.retryDate && ` · ${attempt.retryDate}`}
                  </p>
                  <small>{moment(attempt.createdAt)}</small>
                </li>
              ))}
            </ol>
          </details>
        )}
        {!!allowed.length && (
          <>
            <Field label={t('Note for the customer (optional)', 'ग्राहक के लिए संदेश (वैकल्पिक)')}>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </Field>
            <div className="button-row">
              {allowed.map((s) => (
                <button
                  key={s}
                  disabled={busy}
                  className={s === 'CANCELLED' ? 'danger' : 'primary'}
                  onClick={() => {
                    if (window.confirm(confirmStatus[s] || statusText(s)))
                      void run(() =>
                        call('status', { status: s as OrderStatus, note }).then(() => {}),
                      );
                  }}
                >
                  {statusButton[s] || statusText(s)}
                </button>
              ))}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <h3>{t('Order history', 'ऑर्डर का इतिहास')}</h3>
        <ol className="timeline">
          {order.history.map((h) => (
            <li key={h.id}>
              <strong>{statusText(h.status)}</strong>
              <p>{h.note}</p>
              <small>{moment(h.createdAt)}</small>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}
