'use client';
import { useEffect, useRef, useState } from 'react';
import { Order, OrderStatus, User, money, statusLabel, transitions } from '@shiv/shared';
import { ArrowUpRight, Search, Printer } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Badge, Empty, Modal, Field } from './ui';

const queueLabels = {
  new: 'नया काम / New work',
  dispatch: 'भेजना है / Dispatch due',
  payments: 'पैसा लेना है / Money to confirm',
  issues: 'समस्या / Issues',
};
const remaining = (order: Order) =>
  order.payment.status === 'PENDING' && !['CANCELLED', 'REFUNDED'].includes(order.status)
    ? order.totalPaise
    : 0;
const nextAction = (order: Order) =>
  !order.work?.acknowledgedAt && order.work
    ? 'ज़िम्मेदारी लें / Acknowledge'
    : (
        {
          CONFIRMED: 'तैयार करें / Prepare',
          PREPARING: 'रवाना करें / Dispatch',
          OUT_FOR_DELIVERY: remaining(order)
            ? 'पैसा मिलने की पुष्टि / Confirm collection'
            : 'डिलीवरी पूरी / Complete delivery',
          DELIVERY_EXCEPTION: 'समस्या हल करें / Resolve delivery',
        } as Partial<Record<OrderStatus, string>>
      )[order.status] || 'ऑर्डर देखें / View order';
function settlementNote(order: Order) {
  if (order.payment.status === 'REFUND_PENDING')
    return `दुकान को ${money(order.totalPaise)} लौटाना है। / Store owes a full refund of ${money(order.totalPaise)}.`;
  if (order.payment.status === 'REFUNDED')
    return 'पूरा पैसा लौटा दिया गया। / Fully refunded; no collection is due.';
  if (
    order.status === 'CANCELLED' &&
    order.payment.method === 'COD' &&
    order.payment.status === 'PENDING'
  )
    return 'ऑर्डर रद्द है। नकद नहीं मिला और अब लेना नहीं है। / Cancelled before cash collection; no cash is due.';
  return '';
}
function CustomerContact({ phone }: { phone: string }) {
  if (!phone.trim())
    return (
      <p className="hint">
        खाता हटाने पर संपर्क जानकारी हटा दी गई। / Contact details were removed with the customer
        account.
      </p>
    );
  return (
    <div className="owner-actions">
      <a href={`tel:${phone}`}>फ़ोन / Call {phone}</a>
      <a href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
        WhatsApp
      </a>
    </div>
  );
}
const hindiStatusAction: Partial<Record<OrderStatus, string>> = {
  PREPARING: 'तैयार करना शुरू करें',
  OUT_FOR_DELIVERY: 'माल रवाना करें',
  DELIVERED: 'डिलीवरी पूरी करें',
  CANCELLED: 'ऑर्डर रद्द करें',
};
export function OrdersTable({ orders, select }: { orders: Order[]; select: (id: string) => void }) {
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
              <span>बाकी / Remaining: {money(remaining(o))}</span>
            </div>
            <small>
              {Math.max(0, Math.floor((Date.now() - Date.parse(o.createdAt)) / 60000))} मिनट / min ·{' '}
              {o.work?.assignedTo?.name || 'ज़िम्मेदारी बाकी / Unassigned'}
            </small>
            {o.work?.lastError && (
              <p className="warning">
                सूचना नहीं पहुँची / Alert failed. {o.work.attempts} attempts.
              </p>
            )}
            <button
              className="primary wide owner-next-action"
              aria-label={`Open ${o.number}`}
              onClick={() => select(o.id)}
            >
              {nextAction(o)}
            </button>
            {settlementNote(o) && <p className="hint">{settlementNote(o)}</p>}
            <CustomerContact phone={o.address.phone} />
          </article>
        ))}
      </div>
      <div className="table-wrap owner-order-table">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Delivery</th>
              <th>Total</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong>{o.number}</strong>
                  <small>
                    {new Date(o.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    · {o.items.length} products
                  </small>
                </td>
                <td>
                  <strong>{o.user?.name || o.address.name}</strong>
                  <small>{o.address.city}</small>
                </td>
                <td>
                  {new Date(`${o.deliveryDate}T12:00:00`).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  })}
                  <small>
                    {o.payment.method === 'COD' ? 'Cash on delivery' : 'Online payment'}
                  </small>
                </td>
                <td>
                  <strong>{money(o.totalPaise)}</strong>
                  <small>{statusLabel(o.payment.status)}</small>
                </td>
                <td>
                  <Badge value={o.status} />
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Open ${o.number}`}
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
          title="Your next order starts here"
          body="Customer orders will appear here as soon as they are placed."
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
  const params = new URLSearchParams(query);
  const filter = params.get('status') || '';
  const search = params.get('q') || '';
  const queue = params.get('queue') || '';
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
        .catch((e) => notice(errorMessage(e)));
    else setDetail(null);
    return () => {
      live = false;
    };
  }, [selectedId, orders, notice]);
  const selected = detail?.id === selectedId ? detail : null;
  return (
    <>
      <div className="owner-queue-tabs" aria-label="Order queues">
        <button className={!queue ? 'primary' : 'secondary'} onClick={() => onQueue('')}>
          सभी / All
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
            aria-label="Search orders"
            placeholder="Search order number or customer"
            value={search}
            onChange={(e) => updateFilter('q', e.target.value)}
          />
        </label>
        <select
          aria-label="Filter order status"
          value={filter}
          onChange={(e) => updateFilter('status', e.target.value)}
        >
          <option value="">All orders</option>
          {Object.keys(transitions).map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [owners, setOwners] = useState<User[]>([]);
  const saving = useRef(false);
  const deliveryKeys = useRef<Record<string, string>>({});
  useEffect(() => {
    void api<User[]>('/admin/owners')
      .then(setOwners)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  async function action(path: string, body?: unknown) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await api(`/admin/orders/${order.id}/${path}`, path === 'status' ? 'PATCH' : 'POST', body);
      await refresh();
      notice('Order updated');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
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
    await action('delivery', { ...body, idempotencyKey });
  }
  const allowed = transitions[order.status].filter(
    (s) =>
      !['CONFIRMED', 'REFUND_PENDING', 'REFUNDED', 'DELIVERY_EXCEPTION'].includes(s) &&
      order.status !== 'DELIVERY_EXCEPTION',
  );
  return (
    <Modal title={order.number} close={close}>
      <div className="form-stack">
        <div className="row-between">
          <Badge value={order.status} />
          <button className="text-button" onClick={() => window.print()}>
            <Printer size={16} />
            Print summary
          </button>
        </div>
        <p className="hint">Order summary · not a GST tax invoice</p>
        {order.work && (
          <section className="detail-block">
            <p>
              ज़िम्मेदारी / Assigned: <strong>{order.work.assignedTo?.name || 'Unassigned'}</strong>
            </p>
            {!order.work.acknowledgedAt && (
              <button
                className="primary wide"
                disabled={busy}
                onClick={() => void action('acknowledge', {})}
              >
                ज़िम्मेदारी लें / Acknowledge
              </button>
            )}
            {order.work.lastError && (
              <p className="warning">
                सूचना भेजने में समस्या / Notification failed. Retry attempts: {order.work.attempts}
              </p>
            )}
            <Field label="ज़िम्मेदारी बदलें / Assign owner">
              <select
                defaultValue=""
                disabled={busy}
                onChange={async (e) => {
                  const ownerId = e.target.value;
                  if (!ownerId || saving.current) return;
                  saving.current = true;
                  setBusy(true);
                  try {
                    await api(`/admin/work/${order.work!.id}/assign`, 'POST', { ownerId });
                    await refresh();
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    saving.current = false;
                    setBusy(false);
                  }
                }}
              >
                <option value="">Choose owner</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name || owner.phone}
                  </option>
                ))}
              </select>
            </Field>
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
                पहचान / Landmark: {order.address.landmark}
              </>
            )}
          </p>
          <CustomerContact phone={order.address.phone} />
          <p>
            Delivery: {order.deliveryDate}
            {order.notes && (
              <>
                <br />
                Note: {order.notes}
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
          <span>Delivery</span>
          <span>{money(order.deliveryFeePaise)}</span>
        </div>
        <div className="row-between total">
          <b>Total</b>
          <b>{money(order.totalPaise)}</b>
        </div>
        <p>
          Payment: {order.payment.method} · <Badge value={order.payment.status} />
        </p>
        <p>
          <strong>बाकी / Remaining collection: {money(remaining(order))}</strong>
        </p>
        {settlementNote(order) && <p className="notice">{settlementNote(order)}</p>}
        {order.payment.method === 'COD' &&
          order.payment.status === 'PENDING' &&
          ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'].includes(order.status) && (
            <button
              disabled={busy}
              className="secondary"
              onClick={() => {
                if (window.confirm(`Confirm you received ${money(order.totalPaise)} in full?`))
                  void action('cod-received');
              }}
            >
              Record cash payment received · नकद मिल गया
            </button>
          )}
        {order.payment.method === 'COD' && order.payment.status === 'REFUND_PENDING' && (
          <button
            disabled={busy}
            className="secondary"
            onClick={() => {
              if (window.confirm('Confirm the full cash refund has been returned to the customer?'))
                void action('cash-refunded');
            }}
          >
            Record cash refund returned · नकद लौटाया
          </button>
        )}
        {order.payment.method === 'ONLINE' && order.payment.status === 'REFUND_PENDING' && (
          <section className="form-stack">
            <p className="warning">
              रिफंड बाकी है / Refund pending. A named technical operator must issue the full refund
              in Razorpay. Only its verified webhook confirms the result.
            </p>
            {order.work && (
              <Field label="रिफंड की ज़िम्मेदारी / Refund technical operator">
                <select
                  defaultValue={order.work.technicalOwner?.id || ''}
                  disabled={busy}
                  onChange={async (e) => {
                    if (!e.target.value || saving.current) return;
                    saving.current = true;
                    setBusy(true);
                    try {
                      await api(`/admin/work/${order.work!.id}/assign`, 'POST', {
                        ownerId: e.target.value,
                        technical: true,
                      });
                      await refresh();
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      saving.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  <option value="">Choose technical operator</option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name || owner.phone}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </section>
        )}
        {order.payment.method === 'ONLINE' && order.payment.status === 'PENDING' && (
          <details>
            <summary>तकनीकी सहायता / Technical payment recovery</summary>
            <p>
              Automation cannot confirm this payment. Assign a named technical operator; do not
              accept a screenshot as proof.
            </p>
            {order.work && (
              <Field label="Technical operator">
                <select
                  defaultValue={order.work.technicalOwner?.id || ''}
                  disabled={busy}
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    try {
                      await api(`/admin/work/${order.work!.id}/assign`, 'POST', {
                        ownerId: e.target.value,
                        technical: true,
                      });
                      await refresh();
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  <option value="">Choose technical operator</option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name || owner.phone}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action('reconcile-payment', {
                  razorpayOrderId: new FormData(e.currentTarget).get('provider'),
                });
              }}
            >
              <p className="warning">
                Find the Razorpay order by receipt {order.id}. Verify its amount and currency. Do
                not create a replacement payment order when the first result is uncertain.
              </p>
              <Field label="Razorpay order ID for reconciliation">
                <input
                  name="provider"
                  defaultValue={order.payment.razorpayOrderId || ''}
                  required
                  placeholder="order_…"
                />
              </Field>
              <button className="secondary" disabled={busy}>
                Verify gateway payment
              </button>
            </form>
          </details>
        )}
        {order.status === 'OUT_FOR_DELIVERY' && (
          <details>
            <summary>डिलीवरी में समस्या / Delivery problem</summary>
            <form className="form-stack" onSubmit={(e) => void delivery(e, 'REPORT')}>
              <Field label="कारण / Reason">
                <select name="reason">
                  <option value="UNAVAILABLE">ग्राहक नहीं मिला / Customer unavailable</option>
                  <option value="REFUSED">ग्राहक ने मना किया / Refused</option>
                  <option value="INACCESSIBLE">रास्ता बंद / Site inaccessible</option>
                </select>
              </Field>
              <Field label="क्या हुआ / What happened">
                <textarea name="note" required minLength={1} maxLength={500} />
              </Field>
              <button className="secondary" disabled={busy}>
                समस्या दर्ज करें / Record exception
              </button>
            </form>
          </details>
        )}
        {order.status === 'DELIVERY_EXCEPTION' && (
          <section className="form-stack">
            <p className="warning">
              डिलीवरी पूरी नहीं हुई। स्टॉक अभी बाहर है। / Delivery is incomplete; stock remains with
              the delivery.
            </p>
            <form className="form-stack" onSubmit={(e) => void delivery(e, 'RETRY')}>
              <Field label="दोबारा भेजने की तारीख / Retry date">
                <input type="date" name="retryDate" required />
              </Field>
              <Field label="ग्राहक से तय बात / Retry arrangement">
                <textarea name="note" required maxLength={500} />
              </Field>
              <button className="primary" disabled={busy}>
                फिर भेजें / Schedule retry
              </button>
            </form>
            <details>
              <summary>दुकान में माल वापस मिला / Confirm physical return</summary>
              <form
                className="form-stack"
                onSubmit={(e) => {
                  if (
                    window.confirm(
                      'Confirm these materials are physically back at the shop? केवल वास्तव में वापस मिला माल दर्ज करें।',
                    )
                  )
                    void delivery(e, 'RETURN');
                  else e.preventDefault();
                }}
              >
                <p>Count every unit. Only sellable returned units go back into available stock.</p>
                {order.items.map((item) => (
                  <fieldset key={item.productId}>
                    <legend>
                      {item.name} · {item.quantity} {item.unit}
                    </legend>
                    <Field label="सही माल / Sellable returned">
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
                    <Field label="खराब माल / Damaged returned">
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
                <Field label="वापसी का विवरण / Return evidence">
                  <textarea name="note" required maxLength={500} />
                </Field>
                <button className="danger" disabled={busy}>
                  वापसी की पुष्टि / Confirm returned stock
                </button>
              </form>
            </details>
          </section>
        )}
        {!!order.deliveryAttempts?.length && (
          <details>
            <summary>डिलीवरी कोशिशें / Delivery attempts</summary>
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
                  <small>{new Date(attempt.createdAt).toLocaleString('en-IN')}</small>
                </li>
              ))}
            </ol>
          </details>
        )}
        {!!allowed.length && (
          <>
            <Field label="Status update note">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder="Optional note for the customer"
              />
            </Field>
            <div className="button-row">
              {allowed.map((s) => (
                <button
                  key={s}
                  aria-label={
                    s === 'CANCELLED' ? 'Cancel order' : `Mark ${statusLabel(s).toLowerCase()}`
                  }
                  disabled={busy}
                  className={s === 'CANCELLED' ? 'danger' : 'primary'}
                  onClick={() => {
                    if (
                      s !== 'CANCELLED' ||
                      window.confirm('Cancel this order and return its stock?')
                    )
                      void action('status', { status: s as OrderStatus, note });
                  }}
                >
                  {hindiStatusAction[s] && `${hindiStatusAction[s]} / `}
                  {s === 'CANCELLED' ? 'Cancel order' : `Mark ${statusLabel(s).toLowerCase()}`}
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
        <h3>Order history</h3>
        <ol className="timeline">
          {order.history.map((h) => (
            <li key={h.id}>
              <strong>{statusLabel(h.status)}</strong>
              <p>{h.note}</p>
              <small>{new Date(h.createdAt).toLocaleString('en-IN')}</small>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}
