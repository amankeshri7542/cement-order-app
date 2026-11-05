import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Share, StyleSheet, Text, View } from 'react-native';
import {
  dayLabel,
  historyNote,
  momentLabel,
  nextSteps,
  orderStatusText,
  paymentStatusText,
  pick,
  type Order,
} from '@shiv/shared';
import { money } from '../../logic/money';
import { api } from '../../state/api';
import { openSheet } from '../../state/nav';
import { say } from '../../state/net';
import { ordersStore, rememberOrder } from '../../state/orders';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Notice } from '../../ui/Notice';
import { Press } from '../../ui/Press';
import { Screen, TopBar } from '../../ui/Screen';
import { C, headingScale, space, T, touch } from '../../ui/tokens';
import { w } from '../../words';
import { NotifyPrompt } from './NotifyPrompt';
import { StatusLine } from './StatusLine';

const moving = [
  'AWAITING_CONFIRMATION',
  'CONFIRMED',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'DELIVERY_EXCEPTION',
];

async function sure(text: string, yes: string, no: string) {
  if (Platform.OS === 'web') return window.confirm(text);
  return new Promise<boolean>((resolve) =>
    Alert.alert(
      w('common.pleaseConfirm'),
      text,
      [
        { text: no, style: 'cancel', onPress: () => resolve(false) },
        { text: yes, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
export { sure };

/** Waiting, Confirmed, On the way, Delivered, in plain honest words. Nobody needs to call. */
export function OrderScreen({ id }: { id: string }) {
  const known = useSelect(ordersStore, (state) => state.byId[id]);
  const [order, setOrder] = useState<Order | null>(known ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    try {
      const fresh = await api<Order>(`/orders/${encodeURIComponent(id)}`);
      if (current !== request.current) return;
      setOrder(fresh);
      rememberOrder(fresh);
      setError('');
    } catch (e) {
      if (current === request.current) setError(say(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  // Live status only while the order is moving, and only while the app is on screen.
  const status = order?.status;
  useEffect(() => {
    if (!status || !moving.includes(status)) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, 60000);
    return () => clearInterval(timer);
  }, [status, load]);
  // The live stream refreshes the shared list; a newer copy from it replaces this one.
  useEffect(() => {
    if (known) setOrder(known);
  }, [known]);
  if (!order)
    return (
      <Screen topBar={<TopBar title={w('order.title')} />}>
        {error ? (
          <>
            <Notice tone="error">{error}</Notice>
            <Button onPress={() => void load()}>{w('common.retry')}</Button>
          </>
        ) : (
          <Text style={[T.body, styles.quiet]}>{w('common.loading')}</Text>
        )}
      </Screen>
    );
  const site = order.address as unknown as {
    label?: string;
    name?: string;
    line1?: string;
    area?: string;
    pincode?: string;
    landmark?: string;
  } | null;
  const lastAttempt = order.deliveryAttempts?.at(-1);
  const steps = nextSteps(order);
  const current = steps?.find((step) => step.state === 'current');
  const canCancel = ['PENDING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED'].includes(
    order.status,
  );
  async function cancel() {
    if (!(await sure(w('order.cancelSure'), w('order.cancel'), w('order.keep')))) return;
    setBusy(true);
    try {
      await api(`/orders/${order!.id}/cancel`, 'POST');
      await load();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      topBar={
        <TopBar
          title={w('order.title')}
          right={
            <Press
              accessibilityRole="button"
              accessibilityLabel={w('order.share')}
              onPress={() =>
                void Share.share({
                  message: `${w('order.summary')}\n${order.number}\n${order.items
                    .map((item) => `${item.quantity} x ${item.name}: ${money(item.lineTotalPaise)}`)
                    .join(
                      '\n',
                    )}\n${w('panel.delivery')}: ${money(order.deliveryFeePaise)}\n${w('panel.total')}: ${money(order.totalPaise)}`,
                }).catch(() => {})
              }
              style={styles.icon}
            >
              <Icon name="share-social-outline" />
            </Press>
          }
        />
      }
    >
      {error ? <Notice tone="error">{w('order.lastKnown', { error })}</Notice> : null}
      <Text style={T.display} accessibilityRole="header" maxFontSizeMultiplier={headingScale}>
        {orderStatusText(order.status, 'en')}
      </Text>
      <Text style={T.body}>
        {order.status === 'AWAITING_CONFIRMATION'
          ? w('order.waitingWords', { number: order.number })
          : current
            ? pick('en', current.body)
            : order.number}
      </Text>
      <StatusLine status={order.status} />
      <NotifyPrompt />
      {order.status === 'DELIVERY_EXCEPTION' ? (
        <Notice tone="error">{w('order.deliveryProblem')}</Notice>
      ) : null}
      {lastAttempt?.action === 'RETRY' && order.status !== 'DELIVERED' ? (
        <Notice>
          {w('order.nextTry', { day: dayLabel(lastAttempt.retryDate || order.deliveryDate, 'en') })}
        </Notice>
      ) : null}
      {order.status === 'CANCELLED' ? <Notice>{w('order.cancelled')}</Notice> : null}
      {order.status === 'REFUND_PENDING' ? <Notice>{w('order.refund')}</Notice> : null}
      {order.status === 'REFUNDED' ? <Notice>{w('order.refunded')}</Notice> : null}
      <View style={styles.bill}>
        {order.items.map((item) => (
          <View key={item.productId} style={styles.line}>
            <Text style={[T.body, styles.flex]}>
              {item.quantity} × {item.name}
            </Text>
            <Text style={T.rateSmall}>{money(item.lineTotalPaise)}</Text>
          </View>
        ))}
        <View style={styles.line}>
          <Text style={[T.body, styles.flex]}>{w('panel.delivery')}</Text>
          <Text style={T.rateSmall}>{money(order.deliveryFeePaise)}</Text>
        </View>
        <View style={[styles.line, styles.totalLine]}>
          <Text style={[T.bodyStrong, styles.flex]}>{w('panel.total')}</Text>
          <Text style={T.rate}>{money(order.totalPaise)}</Text>
        </View>
      </View>
      <View style={styles.facts}>
        <View style={styles.fact}>
          <Text style={[T.small, styles.factLabel]}>{w('panel.deliverTo')}</Text>
          <Text style={[T.body, styles.flex]}>
            {[site?.label, site?.name].filter(Boolean).join(', ')}
            {'\n'}
            <Text style={[T.small, styles.quiet]}>
              {[site?.line1, site?.area, site?.pincode, site?.landmark].filter(Boolean).join(', ')}
            </Text>
          </Text>
        </View>
        <View style={styles.fact}>
          <Text style={[T.small, styles.factLabel]}>{w('panel.day')}</Text>
          <Text style={[T.body, styles.flex]}>{dayLabel(order.deliveryDate, 'en')}</Text>
        </View>
        <View style={styles.fact}>
          <Text style={[T.small, styles.factLabel]}>{w('panel.pay')}</Text>
          <Text style={[T.body, styles.flex]}>
            {order.payment?.method === 'CREDIT' ? w('order.onUdhaar') : w('panel.cod')} ·{' '}
            {paymentStatusText(order.payment?.status ?? 'PENDING', 'en')}
          </Text>
        </View>
      </View>
      <Button icon="repeat" onPress={() => openSheet({ sheet: 'list', repeat: order.id })}>
        {w('orders.again')}
      </Button>
      {canCancel ? (
        <Button kind="quiet" loading={busy} onPress={() => void cancel()}>
          {w('order.cancel')}
        </Button>
      ) : null}
      <Text style={[T.small, styles.quiet]}>{w('order.notGst')}</Text>
      {order.history.length > 1 ? (
        <View style={styles.history}>
          {order.history.map((row) => (
            <View key={row.id} style={styles.historyRow}>
              <Text style={T.small}>{orderStatusText(row.status, 'en')}</Text>
              {historyNote(row.note, 'en') ? (
                <Text style={[T.small, styles.quiet]}>{historyNote(row.note, 'en')}</Text>
              ) : null}
              <Text style={[T.small, styles.quiet]}>{momentLabel(row.createdAt, 'en')}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  quiet: { color: C.ink2 },
  icon: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  bill: { backgroundColor: C.up, padding: space[3], gap: space[2] },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  totalLine: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.rule,
    paddingTop: space[2],
  },
  facts: { gap: 2 },
  fact: { flexDirection: 'row', gap: space[3], backgroundColor: C.up, padding: space[3] },
  factLabel: { width: 72, color: C.ink2, paddingTop: 2 },
  history: { gap: space[2] },
  historyRow: { gap: 1 },
});
