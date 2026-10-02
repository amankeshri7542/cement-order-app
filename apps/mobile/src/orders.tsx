import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, Share, Text, View } from 'react-native';
import { Order, money, statusLabel } from '@shiv/shared';
import { api, message } from './api';
import { useStore } from './store';
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
  const { t, navigate } = useStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setOrders(await api<Order[]>('/orders'));
      setError('');
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
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
      {!loading && !orders.length && (
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
          onPress={() => navigate({ screen: 'Order', id: o.id })}
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
    </View>
  );
}
export function OrderDetail() {
  const { route, t, navigate, refreshAccount, setToast, user } = useStore();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setOrder(await api<Order>(`/orders/${route.id}`));
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }, [route.id]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);
  async function reorder() {
    setBusy(true);
    try {
      const r = await api<{ notices: string[] }>(`/orders/${order!.id}/reorder`, 'POST');
      await refreshAccount();
      if (r.notices.length) setToast(r.notices.join('\n'));
      navigate({ screen: 'Cart' });
    } catch (e) {
      setError(message(e));
    } finally {
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
  return (
    <View style={s.stack}>
      <View style={{ alignItems: 'center', paddingVertical: 18, gap: 10 }}>
        <View
          style={{
            width: 62,
            height: 62,
            borderRadius: 31,
            backgroundColor: '#e8f3ed',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon
            name={order.status === 'PENDING_PAYMENT' ? 'time-outline' : 'checkmark'}
            size={31}
            color={C.green}
          />
        </View>
        <Text style={s.title}>
          {order.status === 'PENDING_PAYMENT' ? 'Awaiting payment' : t('received')}
        </Text>
        <Text style={s.body}>{order.number}</Text>
        <Tag
          tone={
            ['CANCELLED', 'REFUND_PENDING', 'PENDING_PAYMENT'].includes(order.status)
              ? 'yellow'
              : 'green'
          }
        >
          {statusLabel(order.status)}
        </Tag>
      </View>
      {order.status === 'PENDING_PAYMENT' && (
        <>
          <Notice>
            Your stock is reserved for 30 minutes. Payment is confirmed only after verification by
            the store’s server.
          </Notice>
          <Button
            loading={busy}
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
      <Button loading={busy} onPress={() => void reorder()} icon="repeat">
        {t('reorder')}
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
      {Boolean(error) && <Notice error>{error}</Notice>}
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
