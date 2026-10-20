'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, MoneyText, SearchBar, Sheet } from '@shiv/design';
import { istToday, money, unitLabel, type Order, type StoreSettings } from '@shiv/shared';
import { api } from '../../lib/api';
import { useLanguage, useT, useWords } from '../../lib/i18n';
import { useAction, useDebounced, useOwner } from '../../lib/owner';
import {
  ContactActions,
  MoreRows,
  OwnerDate,
  PageHeader,
  Problem,
  QueryStatus,
  Status,
  orderShare,
  usePaged,
} from './common';
import css from './owner.module.css';

export function OrdersList() {
  const t = useT();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [group, setGroup] = useState('pending');
  const orders = usePaged<Order>(
    ['orders', 'list', group, q],
    `/admin/orders?limit=24&group=${group}&q=${encodeURIComponent(q)}`,
  );
  const rows = orders.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <PageHeader title={t('owner.orders')} />
      <SearchBar
        label={t('owner.searchOrders')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className={css.chips}>
        {(['today', 'pending', 'completed', 'all'] as const).map((value) => (
          <Button
            key={value}
            variant={group === value ? 'primary' : 'secondary'}
            aria-pressed={group === value}
            onClick={() => setGroup(value)}
          >
            {t(
              value === 'today'
                ? 'owner.today'
                : value === 'pending'
                  ? 'owner.pending'
                  : value === 'completed'
                    ? 'owner.completed'
                    : 'owner.all',
            )}
          </Button>
        ))}
      </div>
      <QueryStatus query={orders} />
      <div className={css.stack}>
        {rows.map((order) => (
          <OrderRow key={order.id} order={order} />
        ))}
        {!orders.isPending && !orders.error && !rows.length && (
          <EmptyState title={t('owner.emptyOrders')} />
        )}
      </div>
      <MoreRows query={orders} />
    </>
  );
}
export function OrderRow({ order }: { order: Order }) {
  return (
    <Link href={`/orders/${order.id}`} className={`${css.card} ${css.cardLink}`}>
      <div className={css.row}>
        <h3>{order.user?.name || order.address.name}</h3>
        <MoneyText value={order.totalPaise} />
      </div>
      <p>
        {order.number} · {order.address.phone}
      </p>
      <div className={css.row}>
        <Status value={order.status} />
        <OwnerDate value={order.deliveryDate} />
      </div>
    </Link>
  );
}

export function OrderDetails({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const created = params.get('created') === '1';
  const words = useWords();
  const { language } = useLanguage();
  const { confirm } = useOwner();
  const detail = useQuery({
    queryKey: ['orders', 'detail', id],
    queryFn: () => api<Order>(`/admin/orders/${id}`),
  });
  const settings = useQuery({ queryKey: ['store'], queryFn: () => api<StoreSettings>('/store') });
  const [problem, setProblem] = useState(false);
  const [technicalId, setTechnicalId] = useState('');
  const cancel = useAction(async () => {
    if (
      !(await confirm({
        title: t('owner.cancelOrder'),
        body: t('owner.cancelOrderQuestion'),
        confirmLabel: t('owner.cancelOrder'),
      }))
    )
      return;
    await api(`/admin/orders/${id}/status`, 'PATCH', {
      status: 'CANCELLED',
      note: t('owner.orderActionNote'),
    });
  }, [
    ['orders', 'detail', id],
    ['orders', 'list'],
  ]);
  const reconcile = useAction(
    () => api(`/admin/orders/${id}/reconcile-payment`, 'POST', { razorpayOrderId: technicalId }),
    [['orders', 'detail', id]],
  );
  const order = detail.data;
  return (
    <>
      <PageHeader
        title={order ? t('owner.orderNumber', { number: order.number }) : t('owner.orders')}
        back="/orders"
      />
      <QueryStatus query={detail} />
      {order && (
        <div className={css.stack}>
          <section className={css.card}>
            <div className={css.row}>
              <h2>{order.user?.name || order.address.name}</h2>
              <Status value={order.status} />
            </div>
            <p>{order.address.phone}</p>
            {order.work?.assignedTo && <p>{order.work.assignedTo.name}</p>}
            <ContactActions
              phone={order.address.phone || order.user?.phone || ''}
              customerId={order.userId}
              text={orderShare(order, t, language)}
            />
            <p>
              {order.address.line1}
              {order.address.area ? `, ${order.address.area}` : ''}
              {order.address.city ? `, ${order.address.city}` : ''}
            </p>
            <p>
              <OwnerDate value={order.deliveryDate} />
            </p>
            {order.notes && <p>{order.notes}</p>}
          </section>
          <section className={css.card}>
            <h2>{t('owner.materials')}</h2>
            <p className={css.hint}>{t('owner.summaryNote')}</p>
            {order.items.map((item) => (
              <div className={css.summary} key={item.productId}>
                <div>
                  <strong>{item.name}</strong>
                  <MoneyText value={item.lineTotalPaise} />
                </div>
                <p>
                  {item.quantity} {unitLabel(item.unit, language)} × {money(item.pricePaise)}
                </p>
              </div>
            ))}
            <div className={css.summary}>
              <div>
                <span>{t('owner.subtotal')}</span>
                <MoneyText value={order.subtotalPaise} />
              </div>
              <div>
                <span>{t('owner.deliveryFee')}</span>
                <MoneyText value={order.deliveryFeePaise} />
              </div>
              <div className={css.total}>
                <span>{t('owner.total')}</span>
                <MoneyText value={order.totalPaise} />
              </div>
            </div>
            <p>
              {order.payment.method === 'CREDIT'
                ? t(order.status === 'DELIVERED' ? 'owner.creditPosted' : 'owner.creditOnDelivery')
                : order.payment.status === 'CAPTURED'
                  ? t('owner.paid')
                  : t('owner.cash')}
            </p>
            {order.payment.method === 'CREDIT' && (
              <Link className={css.inlineLink} href={`/customers/${order.userId}`}>
                {t('owner.khata')} <span aria-hidden="true">→</span>
              </Link>
            )}
            <NextOrderAction order={order} />
          </section>
          <Problem error={cancel.error || reconcile.error} />
          <details className={`${css.card} ${css.details}`}>
            <summary>{t('owner.more')}</summary>
            <div className={css.stack}>
              <Button variant="secondary" onClick={() => window.print()}>
                {t('owner.printSummary')}
              </Button>
              {['CONFIRMED', 'PREPARING'].includes(order.status) && (
                <Button
                  variant="danger"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  {t('owner.cancelOrder')}
                </Button>
              )}
              {['OUT_FOR_DELIVERY', 'DELIVERY_EXCEPTION'].includes(order.status) && (
                <Button variant="secondary" onClick={() => setProblem(true)}>
                  {t('owner.issue')}
                </Button>
              )}
              <details className={css.details}>
                <summary>{t('owner.orderHistory')}</summary>
                {order.history.map((row) => (
                  <div key={row.id} className={css.summary}>
                    <Status value={row.status} />
                    <span className={css.date}>{words.moment(row.createdAt)}</span>
                  </div>
                ))}
              </details>
              {settings.data?.onlinePaymentsEnabled && order.payment.method === 'ONLINE' && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    reconcile.mutate();
                  }}
                >
                  <Field label={t('owner.paymentMethod')}>
                    <input
                      value={technicalId}
                      onChange={(event) => setTechnicalId(event.target.value)}
                      pattern="order_[A-Za-z0-9]+"
                      required
                    />
                  </Field>
                  <Button disabled={reconcile.isPending}>{t('owner.confirm')}</Button>
                </form>
              )}
            </div>
          </details>
        </div>
      )}
      {order && problem && <DeliveryProblem order={order} close={() => setProblem(false)} />}
      {order && created && (
        <Sheet
          title={t('owner.orderCreated')}
          closeLabel={t('owner.close')}
          onClose={() => router.replace(`/orders/${id}`)}
        >
          <p>{t('owner.orderNumber', { number: order.number })}</p>
          <p className={css.moneyHero}>{money(order.totalPaise)}</p>
          <ContactActions
            phone={order.address.phone || order.user?.phone || ''}
            customerId={order.userId}
            text={orderShare(order, t, language)}
          />
          <Button className={css.wide} onClick={() => router.replace(`/orders/${id}`)}>
            {t('owner.viewOrder')}
          </Button>
        </Sheet>
      )}
    </>
  );
}

export function NextOrderAction({ order, task }: { order: Order; task?: 'next' | 'payment' }) {
  const t = useT();
  const { confirm } = useOwner();
  const [receipt, setReceipt] = useState<'only' | 'deliver' | null>(null);
  const [refund, setRefund] = useState(false);
  const [channel, setChannel] = useState('CASH');
  const action = useAction(
    async (next: string) => {
      if (next === 'PREPARING' && !order.work?.acknowledgedAt)
        await api(`/admin/orders/${order.id}/acknowledge`, 'POST');
      if (next === 'RECEIPT') {
        await api(`/admin/orders/${order.id}/cod-received`, 'POST', { channel });
        if (receipt === 'only') {
          setReceipt(null);
          return;
        }
        // A lost delivery response must not turn a successful delivery into an error on retry.
        const current = await api<Order>(`/admin/orders/${order.id}`);
        if (current.status === 'DELIVERED') {
          setReceipt(null);
          return;
        }
        next = 'DELIVERED';
      }
      if (next === 'REFUND') {
        await api(`/admin/orders/${order.id}/cash-refunded`, 'POST', { channel });
        setRefund(false);
        return;
      }
      await api(`/admin/orders/${order.id}/status`, 'PATCH', {
        status: next,
        note: t('owner.orderActionNote'),
      });
      setReceipt(null);
    },
    [
      ['orders', 'detail', order.id],
      ['orders', 'list'],
    ],
    'owner.saved',
  );
  const next =
    order.status === 'CONFIRMED'
      ? 'PREPARING'
      : order.status === 'PREPARING'
        ? 'OUT_FOR_DELIVERY'
        : order.status === 'OUT_FOR_DELIVERY'
          ? 'DELIVERED'
          : null;
  const label =
    next === 'PREPARING'
      ? t('owner.startPreparing')
      : next === 'OUT_FOR_DELIVERY'
        ? t('owner.dispatch')
        : t('owner.deliver');
  return (
    <>
      <Problem error={action.error} />
      {next && task !== 'payment' && (
        <Button
          className={css.wide}
          disabled={action.isPending}
          onClick={async () => {
            if (
              next === 'DELIVERED' &&
              order.payment.method === 'COD' &&
              order.payment.status !== 'CAPTURED'
            ) {
              setReceipt('deliver');
              return;
            }
            if (
              next === 'DELIVERED' &&
              !(await confirm({
                title: t('owner.deliver'),
                body: t('owner.orderNumber', { number: order.number }),
                confirmLabel: t('owner.deliver'),
              }))
            )
              return;
            action.mutate(next);
          }}
        >
          {label}
        </Button>
      )}
      {['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status) &&
        task !== 'next' &&
        order.payment.method === 'COD' &&
        order.payment.status !== 'CAPTURED' && (
          <Button
            variant="secondary"
            className={css.wide}
            disabled={action.isPending}
            onClick={() => setReceipt('only')}
          >
            {t('owner.receiveMoney')}
          </Button>
        )}
      {order.status === 'REFUND_PENDING' && order.payment.method === 'COD' && (
        <Button variant="danger" className={css.wide} onClick={() => setRefund(true)}>
          {t('owner.refund')}
        </Button>
      )}
      {(receipt || refund) && (
        <Sheet
          title={t(refund ? 'owner.refund' : 'owner.receiveMoney')}
          closeLabel={t('owner.close')}
          onClose={() => {
            if (!action.isPending) {
              setReceipt(null);
              setRefund(false);
            }
          }}
        >
          <p>{t(refund ? 'owner.refundQuestion' : 'owner.recordReceipt')}</p>
          <p className={css.moneyHero}>{money(order.totalPaise)}</p>
          <Field label={t('owner.paymentMethod')}>
            <select value={channel} onChange={(event) => setChannel(event.target.value)}>
              <option value="CASH">{t('owner.paymentCash')}</option>
              <option value="UPI">{t('owner.paymentUpi')}</option>
            </select>
          </Field>
          <Problem error={action.error} />
          <Button
            className={css.wide}
            disabled={action.isPending}
            onClick={() => action.mutate(refund ? 'REFUND' : 'RECEIPT')}
          >
            {t(
              refund
                ? 'owner.refund'
                : receipt === 'only'
                  ? 'owner.receiveMoney'
                  : 'owner.receiptThenDeliver',
            )}
          </Button>
        </Sheet>
      )}
    </>
  );
}

function DeliveryProblem({ order, close }: { order: Order; close: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const [mode, setMode] = useState(order.status === 'DELIVERY_EXCEPTION' ? 'RETRY' : 'REPORT');
  const [reason, setReason] = useState('UNAVAILABLE');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(istToday());
  const [counts, setCounts] = useState<
    Record<string, { sellableQuantity: number; damagedQuantity: number }>
  >(
    Object.fromEntries(
      order.items.map((item) => [
        item.productId,
        { sellableQuantity: item.quantity, damagedQuantity: 0 },
      ]),
    ),
  );
  const [key] = useState(() => crypto.randomUUID());
  const action = useAction(
    async () => {
      await api(`/admin/orders/${order.id}/delivery`, 'POST', {
        action: mode,
        note,
        idempotencyKey: key,
        ...(mode === 'REPORT'
          ? { reason }
          : mode === 'RETRY'
            ? { retryDate: date }
            : {
                items: order.items.map((item) => ({
                  productId: item.productId,
                  ...counts[item.productId],
                })),
              }),
      });
      close();
    },
    [
      ['orders', 'detail', order.id],
      ['orders', 'list'],
    ],
    'owner.saved',
  );
  return (
    <Sheet
      title={t('owner.issue')}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!action.isPending) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate();
        }}
      >
        {order.status === 'DELIVERY_EXCEPTION' ? (
          <div className={css.chips}>
            {['RETRY', 'RETURN'].map((value) => (
              <Button
                key={value}
                type="button"
                variant={value === mode ? 'primary' : 'secondary'}
                onClick={() => setMode(value)}
              >
                {t(value === 'RETRY' ? 'owner.retryDelivery' : 'owner.returnStock')}
              </Button>
            ))}
          </div>
        ) : (
          <Field label={t('owner.issueReason')}>
            <select value={reason} onChange={(event) => setReason(event.target.value)}>
              {[
                ['UNAVAILABLE', 'owner.issueUnavailable'],
                ['REFUSED', 'owner.issueRefused'],
                ['INACCESSIBLE', 'owner.issueInaccessible'],
              ].map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key as 'owner.issueUnavailable')}
                </option>
              ))}
            </select>
          </Field>
        )}
        {mode === 'RETRY' && (
          <Field label={t('owner.deliveryDate')}>
            <input
              type="date"
              min={istToday()}
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
        )}
        {mode === 'RETURN' && (
          <>
            <p>{t('owner.returnHelp')}</p>
            {order.items.map((item) => (
              <fieldset key={item.productId} className={css.card}>
                <legend>
                  {item.name} · {item.quantity} {unitLabel(item.unit, language)}
                </legend>
                {(['sellableQuantity', 'damagedQuantity'] as const).map((field) => (
                  <Field
                    key={field}
                    label={t(field === 'sellableQuantity' ? 'owner.sellable' : 'owner.damaged')}
                  >
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max={item.quantity}
                      required
                      value={counts[item.productId]?.[field] ?? 0}
                      onChange={(event) =>
                        setCounts({
                          ...counts,
                          [item.productId]: {
                            ...counts[item.productId]!,
                            [field]: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                ))}
              </fieldset>
            ))}
          </>
        )}
        <Field label={t('owner.note')}>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            required
          />
        </Field>
        <Problem error={action.error} />
        <Button className={css.wide} disabled={action.isPending}>
          {t(
            mode === 'RETURN'
              ? 'owner.returnStock'
              : mode === 'RETRY'
                ? 'owner.retryDelivery'
                : 'owner.save',
          )}
        </Button>
      </form>
    </Sheet>
  );
}
