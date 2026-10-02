'use client';
import { useEffect, useState } from 'react';
import { Order, OrderStatus, money, statusLabel, transitions } from '@shiv/shared';
import { ArrowUpRight, Search, Printer } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Badge, Empty, Modal, Field } from './ui';

export function OrdersTable({ orders, select }: { orders: Order[]; select: (id: string) => void }) {
  return (
    <div className="table-wrap">
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
                <small>{o.payment.method === 'COD' ? 'Cash on delivery' : 'Online payment'}</small>
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
      {!orders.length && (
        <Empty
          title="Your next order starts here"
          body="Customer orders will appear here as soon as they are placed."
        />
      )}
    </div>
  );
}
export function Orders({
  onFilter,
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
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}) {
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
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
  useEffect(() => {
    const timer = setTimeout(
      () =>
        onFilter(
          `q=${encodeURIComponent(search)}${filter ? '&status=' + encodeURIComponent(filter) : ''}`,
        ),
      250,
    );
    return () => clearTimeout(timer);
  }, [search, filter, onFilter]);
  const selected = detail?.id === selectedId ? detail : null;
  return (
    <>
      <div className="toolbar">
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Search orders"
            placeholder="Search order number or customer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter order status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All orders</option>
          {Object.keys(transitions).map((s) => (
            <option key={s}>{s}</option>
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
  async function action(path: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(`/admin/orders/${order.id}/${path}`, path === 'status' ? 'PATCH' : 'POST', body);
      await refresh();
      notice('Order updated');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const allowed = transitions[order.status].filter(
    (s) => !['CONFIRMED', 'REFUND_PENDING', 'REFUNDED'].includes(s),
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
        <div className="detail-block">
          <strong>{order.address.name}</strong>
          <p>
            {order.address.line1}, {order.address.area}
            <br />
            {order.address.city}, Bihar {order.address.pincode}
          </p>
          <a href={`tel:${order.address.phone}`}>{order.address.phone}</a>
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
        {order.payment.razorpayPaymentId && (
          <small>Gateway payment: {order.payment.razorpayPaymentId}</small>
        )}
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
              Record cash payment received
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
            Record cash refund returned
          </button>
        )}
        {order.payment.method === 'ONLINE' && order.payment.status === 'REFUND_PENDING' && (
          <p className="warning">
            Issue a full refund from the Razorpay dashboard. Its verified webhook will update this
            order.
          </p>
        )}
        {order.payment.method === 'ONLINE' && order.payment.status === 'PENDING' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action('reconcile-payment', {
                razorpayOrderId: new FormData(e.currentTarget).get('provider'),
              });
            }}
          >
            <p className="warning">
              Find the Razorpay order by receipt {order.id}. Verify its amount and currency. Do not
              create a replacement payment order when the first result is uncertain.
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
