import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Share, Text, View } from 'react-native';
import { CartLine, Order, Page, money, statusLabel } from '@shiv/shared';
import { api, message } from './api';
import { makeKey, readSaved, useStore, writeSaved } from './store';
import { Button, C, Empty, Icon, Notice, Tag, s } from './ui';
import { payOnline } from './payment';
export async function confirm(message: string) {
  if (Platform.OS === 'web') return window.confirm(message);
  return new Promise<boolean>((resolve) =>
    Alert.alert(
      'Please confirm',
      message,
      [
        { text: 'Keep order', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
export function Orders() {
  const { t, navigate, registerRefresh, rememberOrder } = useStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const load = useCallback(async (after?: string) => {
    const current = ++request.current;
    setLoading(true);
    try {
      const page = await api<Page<Order>>(
        `/orders?limit=24${after ? '&cursor=' + encodeURIComponent(after) : ''}`,
      );
      if (current !== request.current) return;
      setOrders((old) =>
        after
          ? [...new Map([...old, ...page.items].map((order) => [order.id, order])).values()]
          : page.items,
      );
      setCursor(page.nextCursor);
      setError('');
    } catch (e) {
      if (current === request.current) setError(message(e));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    const online = () => void load();
    if (Platform.OS === 'web') window.addEventListener('online', online);
    return () => {
      request.current++;
      clearInterval(timer);
      if (Platform.OS === 'web') window.removeEventListener('online', online);
    };
  }, [load]);
  useEffect(() => registerRefresh(() => load()), [load, registerRefresh]);
  return (
    <View style={s.stack}>
      <View style={s.between}>
        <Text style={s.title}>{t('orders')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh orders"
          onPress={() => void load()}
          style={{ padding: 12 }}
        >
          <Icon name="refresh-outline" />
        </Pressable>
      </View>
      {Boolean(error) && <Notice error>{error}</Notice>}
      {loading && <Text style={s.body}>{t('loading')}</Text>}
      {!loading && !error && !orders.length && (
        <Empty
          icon="receipt-outline"
          title={t('emptyOrders')}
          body="Your order history and delivery updates will be here."
          action={t('browse')}
          onAction={() => navigate({ screen: 'Products' })}
        />
      )}
      {orders.map((o) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${o.number}`}
          key={o.id}
          onPress={() => {
            rememberOrder(o);
            navigate({ screen: 'Order', id: o.id });
          }}
          style={[s.card, s.stack]}
        >
          <View style={s.between}>
            <Text style={{ color: C.ink, fontWeight: '700', fontSize: 15 }}>{o.number}</Text>
            <Tag tone={o.status === 'DELIVERED' ? 'green' : 'yellow'}>{statusLabel(o.status)}</Tag>
          </View>
          <Text style={s.body}>{o.items.map((i) => `${i.name} × ${i.quantity}`).join('\n')}</Text>
          <View style={s.divider} />
          <View style={s.between}>
            <Text style={s.body}>Delivery {o.deliveryDate}</Text>
            <Text style={[s.price, { fontSize: 20 }]}>{money(o.totalPaise)}</Text>
            <Icon name="arrow-forward" size={19} />
          </View>
        </Pressable>
      ))}
      {cursor && (
        <Button loading={loading} onPress={() => void load(cursor)}>
          Load more orders
        </Button>
      )}
    </View>
  );
}
export function OrderDetail() {
  const { route, t, navigate, mutateCart, setToast, user, ordersById, registerRefresh, settings } =
    useStore();
  const [order, setOrder] = useState<Order | null>(() => ordersById[route.id || ''] || null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reorderKey, setReorderKey] = useState<string | null>(null);
  const [reorderReady, setReorderReady] = useState(false);
  const [reorderError, setReorderError] = useState('');
  const reordering = useRef(false);
  const reorderStorageKey = user && route.id ? `shiv_reorder_${user.id}_${route.id}` : '';
  useEffect(() => {
    let active = true;
    setReorderReady(false);
    setReorderKey(null);
    if (!reorderStorageKey) return;
    void readSaved<string>(reorderStorageKey)
      .then((saved) => {
        if (!active) return;
        if (
          saved !== null &&
          (typeof saved !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved))
        )
          throw new Error(
            'The saved reorder request could not be read. Contact the store before ordering again.',
          );
        setReorderKey(saved);
        setReorderReady(true);
      })
      .catch((error) => {
        if (active)
          setReorderError(`Could not restore your last reorder request. ${message(error)}`);
      });
    return () => {
      active = false;
    };
  }, [reorderStorageKey]);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    try {
      const updated = await api<Order>(`/orders/${route.id}`);
      if (current !== request.current) return;
      setOrder(updated);
      setError('');
    } catch (e) {
      if (current === request.current) setError(message(e));
    }
  }, [route.id]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    const online = () => void load();
    if (Platform.OS === 'web') window.addEventListener('online', online);
    return () => {
      request.current++;
      clearInterval(timer);
      if (Platform.OS === 'web') window.removeEventListener('online', online);
    };
  }, [load]);
  useEffect(() => registerRefresh(load), [load, registerRefresh]);
  async function reorder() {
    if (!order || !user || !reorderReady || reordering.current) return;
    reordering.current = true;
    const ownerId = user.id;
    const key = reorderKey || makeKey();
    setReorderKey(key);
    setReorderError('');
    setBusy(true);
    try {
      let cleanupFailed = false;
      let returnedNotices: string[] = [];
      const applied = await mutateCart(ownerId, async (isCurrent) => {
        await writeSaved(reorderStorageKey, key);
        if (!isCurrent()) return [];
        const result = await api<{ notices: string[]; cart: CartLine[] }>(
          `/orders/${order.id}/reorder`,
          'POST',
          { idempotencyKey: key },
        );
        if (!isCurrent()) return [];
        returnedNotices = result.notices;
        await writeSaved(reorderStorageKey, null).catch(() => {
          cleanupFailed = true;
        });
        return result.cart;
      });
      if (!applied) return;
      setReorderKey(null);
      const notices = [
        ...returnedNotices,
        ...(cleanupFailed
          ? [
              'Cart updated. If this saved request appears again, checking it will not add the materials twice.',
            ]
          : []),
      ];
      if (notices.length) setToast(notices.join('\n'));
      navigate({ screen: 'Cart' });
    } catch (e) {
      setReorderError(
        `The reorder result is not confirmed. Check this same request before ordering again. ${message(e)}`,
      );
    } finally {
      reordering.current = false;
      setBusy(false);
    }
  }
  if (!order)
    return (
      <View style={s.stack}>
        {error ? (
          <>
            <Notice error>{error}</Notice>
            <Button onPress={() => void load()}>{t('retry')}</Button>
          </>
        ) : (
          <Text style={s.body}>{t('loading')}</Text>
        )}
      </View>
    );
  const steps = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  const current = steps.indexOf(order.status);
  const needsAttention = [
    'PENDING_PAYMENT',
    'CANCELLED',
    'REFUND_PENDING',
    'DELIVERY_EXCEPTION',
  ].includes(order.status);
  const title =
    order.status === 'PENDING_PAYMENT'
      ? 'Awaiting payment'
      : order.status === 'CANCELLED'
        ? 'Order cancelled'
        : order.status === 'REFUND_PENDING'
          ? 'Refund being arranged'
          : order.status === 'REFUNDED'
            ? 'Refund completed'
            : order.status === 'DELIVERY_EXCEPTION'
              ? 'Delivery needs attention'
              : order.status === 'DELIVERED'
                ? 'Materials delivered'
                : t('received');
  const lastAttempt = order.deliveryAttempts?.at(-1);
  const reasons: Record<string, string> = {
    UNAVAILABLE: 'Customer unavailable',
    REFUSED: 'Delivery refused',
    INACCESSIBLE: 'Site could not be reached',
  };
  return (
    <View style={s.stack}>
      {Boolean(error) && (
        <Notice error>{error} Your last confirmed order details are shown below.</Notice>
      )}
      <View style={{ alignItems: 'center', paddingVertical: 18, gap: 10 }}>
        <View
          style={{
            width: 62,
            height: 62,
            borderRadius: 31,
            backgroundColor: needsAttention ? '#fcf1cf' : '#e8f3ed',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon
            name={
              order.status === 'CANCELLED' ? 'close' : needsAttention ? 'time-outline' : 'checkmark'
            }
            size={31}
            color={needsAttention ? C.navy : C.green}
          />
        </View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.body}>{order.number}</Text>
        <Tag tone={needsAttention ? 'yellow' : 'green'}>{statusLabel(order.status)}</Tag>
      </View>
      {order.work?.acknowledgedAt && (
        <Text style={s.body}>
          The store has acknowledged your order
          {order.work.assignedTo?.name ? ` · ${order.work.assignedTo.name}` : ''}.
        </Text>
      )}
      {order.work?.technicalOwner?.name && needsAttention && (
        <Text style={s.body}>
          Payment checks are assigned to {order.work.technicalOwner.name}. Contact the store with
          your order number.
        </Text>
      )}
      {order.status === 'PENDING_PAYMENT' && (
        <>
          <Notice>
            Payment is being checked. Stock reservations can expire; refresh this order before
            paying again. Payment is confirmed only after verification by the store’s server.
          </Notice>
          {order.payment.initializationStartedAt && !order.payment.razorpayOrderId && (
            <Notice>
              Payment setup needs store verification. Do not make another payment. Contact the store
              with this order number.
            </Notice>
          )}
          <Button
            loading={busy}
            disabled={Boolean(
              order.payment.initializationStartedAt && !order.payment.razorpayOrderId,
            )}
            onPress={async () => {
              setBusy(true);
              try {
                const r = await payOnline(order.id, user!.phone);
                setToast(r.message);
                await load();
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('pay')} · {money(order.totalPaise)}
          </Button>
        </>
      )}
      {order.status === 'REFUND_PENDING' && (
        <Notice>
          Your order is cancelled and a refund is required. The store will arrange the refund;
          contact them for an update.
        </Notice>
      )}
      {order.status === 'REFUNDED' && (
        <Notice>Your payment has been refunded. This order will not be delivered.</Notice>
      )}
      {order.status === 'CANCELLED' && (
        <Notice>
          This order is cancelled and will not be delivered.
          {order.payment.status === 'PENDING' ? ' No payment has been recorded.' : ''}
        </Notice>
      )}
      {order.status === 'DELIVERY_EXCEPTION' && (
        <Notice>
          {lastAttempt?.reason
            ? reasons[lastAttempt.reason] || 'Delivery could not be completed'
            : 'Delivery could not be completed'}
          . Contact the store to arrange another attempt or return the materials. The delivery is
          not complete; payment status is shown below.
        </Notice>
      )}
      {lastAttempt?.action === 'RETRY' && order.status !== 'DELIVERED' && (
        <Notice>
          Another delivery attempt is arranged for {lastAttempt.retryDate || order.deliveryDate}.
        </Notice>
      )}
      {lastAttempt?.action === 'RETURN' && (
        <Notice>
          The store confirmed the physical return of the materials. Only stock accepted as sellable
          was returned to availability.
        </Notice>
      )}
      {Boolean(order.deliveryAttempts?.length) && (
        <View style={[s.card, s.stack]}>
          <Text style={s.h2}>Delivery updates</Text>
          {order.deliveryAttempts?.map((attempt) => (
            <View key={attempt.id} style={s.stack}>
              <Text style={s.body}>
                {attempt.action === 'REPORT'
                  ? reasons[attempt.reason || ''] || 'Delivery issue reported'
                  : attempt.action === 'RETRY'
                    ? `Retry scheduled · ${attempt.retryDate}`
                    : 'Physical return confirmed'}
                {attempt.note ? `\n${attempt.note}` : ''}
              </Text>
              <Text style={s.specification}>
                {new Date(attempt.createdAt).toLocaleString('en-IN')}
              </Text>
            </View>
          ))}
        </View>
      )}
      {settings && (
        <View style={s.row}>
          <Button
            secondary
            icon="call-outline"
            onPress={() =>
              void Linking.openURL(`tel:${settings.phone}`).catch(() =>
                setToast('Could not open the phone app.'),
              )
            }
            style={{ flex: 1 }}
          >
            Call store
          </Button>
          <Button
            secondary
            icon="logo-whatsapp"
            onPress={() =>
              void Linking.openURL(
                `https://wa.me/${settings.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Please help with my Shiv Cement Store order ${order.number}.`)}`,
              ).catch(() => setToast('Could not open WhatsApp.'))
            }
            style={{ flex: 1 }}
          >
            WhatsApp
          </Button>
        </View>
      )}
      {current >= 0 && (
        <View style={[s.card, { gap: 0 }]}>
          {steps.map((step, i) => (
            <View key={step} style={[s.row, { paddingVertical: 13 }]}>
              <View
                style={{
                  height: 28,
                  width: 28,
                  borderRadius: 14,
                  backgroundColor: i <= current ? C.green : '#e9eef2',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon
                  name={i <= current ? 'checkmark' : 'ellipse-outline'}
                  size={15}
                  color={i <= current ? '#fff' : '#9aaab6'}
                />
              </View>
              <Text
                style={{
                  fontSize: 13,
                  color: i <= current ? C.ink : '#8d9ca7',
                  fontWeight: i === current ? '700' : '400',
                }}
              >
                {statusLabel(step)}
              </Text>
              {i === current && (
                <Text style={{ marginLeft: 'auto', fontSize: 10, color: C.green }}>CURRENT</Text>
              )}
            </View>
          ))}
        </View>
      )}
      <View style={[s.card, s.stack]}>
        <Text style={s.h2}>{t('details')}</Text>
        {order.items.map((i) => (
          <View key={i.productId} style={s.between}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.ink, fontWeight: '600', fontSize: 13 }}>{i.name}</Text>
              <Text style={[s.body, { fontSize: 11 }]}>
                {i.quantity} × {money(i.pricePaise)} / {i.unit}
              </Text>
            </View>
            <Text style={{ color: C.ink, fontWeight: '600' }}>{money(i.lineTotalPaise)}</Text>
          </View>
        ))}
        <View style={s.divider} />
        <View style={s.between}>
          <Text style={s.body}>{t('delivery')}</Text>
          <Text style={s.body}>{money(order.deliveryFeePaise)}</Text>
        </View>
        <View style={s.between}>
          <Text style={s.h2}>{t('total')}</Text>
          <Text style={s.price}>{money(order.totalPaise)}</Text>
        </View>
        <Text style={s.body}>
          Payment: {order.payment.method === 'COD' ? 'Cash on delivery' : 'Online'} ·{' '}
          {statusLabel(order.payment.status)}
        </Text>
      </View>
      <View style={s.card}>
        <Text style={{ color: C.ink, fontWeight: '700', marginBottom: 8 }}>
          {t('address')} · {order.deliveryDate}
        </Text>
        <Text style={s.body}>
          {order.address.name}
          {'\n'}
          {order.address.line1}, {order.address.area}
          {'\n'}
          {order.address.city}, Bihar {order.address.pincode}
          {'\n'}
          {order.address.phone}
          {order.notes ? `\n${order.notes}` : ''}
        </Text>
      </View>
      {reorderKey && (
        <Notice>
          Your previous reorder may already have updated the cart. Checking this same request will
          not add the materials twice.
        </Notice>
      )}
      {Boolean(reorderError) && <Notice error>{reorderError}</Notice>}
      <Button loading={busy} disabled={!reorderReady} onPress={() => void reorder()} icon="repeat">
        {reorderKey ? 'Check reorder result' : t('reorder')}
      </Button>
      <Button
        secondary
        onPress={() => {
          void Share.share({
            message: `Shiv Cement Store — Order summary (not a GST invoice)\n${order.number}\n${order.items.map((i) => `${i.name}: ${i.quantity} × ${money(i.pricePaise)} = ${money(i.lineTotalPaise)}`).join('\n')}\nDelivery: ${money(order.deliveryFeePaise)}\nTotal: ${money(order.totalPaise)}\nPayment: ${statusLabel(order.payment.status)}`,
          }).catch((e) => setError(message(e)));
        }}
        icon="share-outline"
      >
        Share order summary
      </Button>
      {['PENDING_PAYMENT', 'CONFIRMED'].includes(order.status) && (
        <Button
          secondary
          loading={busy}
          onPress={async () => {
            if (!(await confirm('Cancel this order? Its reserved stock will be released.'))) return;
            setBusy(true);
            try {
              await api(`/orders/${order.id}/cancel`, 'POST');
              await load();
            } catch (e) {
              setError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Cancel order
        </Button>
      )}
      <Text style={s.h2}>Order history</Text>
      {order.history.map((h) => (
        <View
          key={h.id}
          style={{ borderLeftWidth: 2, borderLeftColor: '#cbd8e2', paddingLeft: 15, gap: 5 }}
        >
          <Text style={{ color: C.ink, fontWeight: '600', fontSize: 13 }}>
            {statusLabel(h.status)}
          </Text>
          <Text style={s.body}>{h.note}</Text>
          <Text style={[s.body, { fontSize: 10 }]}>
            {new Date(h.createdAt).toLocaleString('en-IN')}
          </Text>
        </View>
      ))}
    </View>
  );
}
