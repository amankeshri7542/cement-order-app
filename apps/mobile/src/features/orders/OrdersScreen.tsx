import { memo, useCallback, useEffect, useState } from 'react';
import { FlatList, Image, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { dateLabel, type Order, type Quote } from '@shiv/shared';
import { money } from '../../logic/money';
import { orderLines } from '../../logic/home-state';
import { savedAge } from '../../logic/age';
import { openSheet, push } from '../../state/nav';
import { netStore } from '../../state/net';
import {
  loadMoreOrders,
  ordersStore,
  refreshOrders,
  refreshReplies,
  rememberOrder,
} from '../../state/orders';
import { requireSignIn, sessionStore } from '../../state/session';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Empty, Notice } from '../../ui/Notice';
import { Press } from '../../ui/Press';
import { emptyPlate } from '../../ui/Specimen';
import { StatusTag } from '../../ui/StatusTag';
import { C, headingScale, space, T } from '../../ui/tokens';
import { w } from '../../words';

const sourceWord = (source?: string) =>
  source === 'WHATSAPP'
    ? w('orders.fromWhatsApp')
    : source === 'PHONE'
      ? w('orders.byPhone')
      : source === 'WALK_IN'
        ? w('orders.atCounter')
        : source === 'WEB'
          ? w('orders.fromWebsite')
          : '';

const OrderRow = memo(function OrderRow({ order }: { order: Order }) {
  const site = (order.address as unknown as { label?: string } | null)?.label;
  const source = sourceWord((order as { source?: string }).source);
  return (
    <View style={styles.card}>
      <Press
        accessibilityRole="button"
        accessibilityLabel={w('orders.openLabel', { number: order.number })}
        onPress={() => {
          rememberOrder(order);
          push({ screen: 'order', id: order.id });
        }}
        scale={0.99}
        style={styles.cardMain}
      >
        <View style={styles.between}>
          <StatusTag status={order.status} />
          <Text style={T.rate}>{money(order.totalPaise)}</Text>
        </View>
        <Text style={T.body} numberOfLines={2}>
          {orderLines(order)}
        </Text>
        <Text style={[T.small, styles.quiet]} numberOfLines={1}>
          {[order.number, source].filter(Boolean).join(' · ')}
        </Text>
      </Press>
      <View style={styles.between}>
        <Text style={[T.small, styles.quiet, styles.flex]} numberOfLines={1}>
          {site || ''}
        </Text>
        <Button kind="quiet" onPress={() => openSheet({ sheet: 'list', repeat: order.id })}>
          {w('orders.again')}
        </Button>
      </View>
    </View>
  );
});

/** The top of Orders: a shop reply stays here until it is answered. */
function Replies({ replies }: { replies: Quote[] }) {
  const open = replies.filter((quote) => quote.status === 'SENT' || quote.status === 'REQUESTED');
  if (!open.length) return null;
  return (
    <View style={styles.replies}>
      {open.map((quote) => (
        <Press
          key={quote.id}
          accessibilityRole="button"
          onPress={() => push({ screen: 'reply', id: quote.id })}
          style={styles.reply}
        >
          <View style={styles.square} />
          <View style={styles.flex}>
            <Text style={T.body}>
              {quote.status === 'SENT' ? w('orders.replied') : w('orders.gotList')}
            </Text>
            {quote.status === 'SENT' && quote.validUntil ? (
              <Text style={[T.small, styles.quiet]}>
                {w('orders.holdUntil', { date: dateLabel(quote.validUntil, 'en') })}
              </Text>
            ) : null}
          </View>
          <Icon name="chevron-forward" size={18} />
        </Press>
      ))}
    </View>
  );
}

const keyOf = (order: Order) => order.id;
const renderOrder = ({ item }: { item: Order }) => <OrderRow order={item} />;

/** Every order from every door. It goes by the mobile number. */
export function OrdersScreen() {
  const user = useSelect(sessionStore, (state) => state.user);
  const orders = useSelect(ordersStore, (state) => state.items);
  const known = useSelect(ordersStore, (state) => state.known);
  const loading = useSelect(ordersStore, (state) => state.loading);
  const error = useSelect(ordersStore, (state) => state.error);
  const savedAt = useSelect(ordersStore, (state) => state.savedAt);
  const replies = useSelect(ordersStore, (state) => state.replies);
  const cursor = useSelect(ordersStore, (state) => state.nextCursor);
  const online = useSelect(netStore, (state) => state.online);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (user) {
      void refreshOrders();
      void refreshReplies();
    }
  }, [user?.id]);
  const header = useCallback(
    () => (
      <View style={styles.head}>
        <Text style={T.display} accessibilityRole="header" maxFontSizeMultiplier={headingScale}>
          {w('tabs.orders')}
        </Text>
        <Replies replies={replies} />
        {error && !orders.length ? (
          <View style={styles.errorBox}>
            <Notice tone="error">{error}</Notice>
            <Button kind="quiet" onPress={() => void refreshOrders()}>
              {w('common.retry')}
            </Button>
          </View>
        ) : null}
        {savedAt && (error || !online) ? (
          <Notice tone="warn">{w('orders.saved', { age: savedAge(savedAt, Date.now()) })}</Notice>
        ) : null}
      </View>
    ),
    [replies, error, orders.length, savedAt, online],
  );
  if (!user)
    return (
      <View style={styles.fill}>
        <Text style={[T.display, styles.pad]} accessibilityRole="header">
          {w('tabs.orders')}
        </Text>
        <Empty
          plate={
            <Image
              accessible={false}
              source={emptyPlate}
              resizeMode="contain"
              style={styles.plate}
            />
          }
          title={w('orders.signInTitle')}
          body={w('orders.signInBody')}
          action={w('account.signIn')}
          onAction={() => requireSignIn(() => {})}
        />
      </View>
    );
  return (
    <FlatList
      style={styles.fill}
      data={orders}
      keyExtractor={keyOf}
      renderItem={renderOrder}
      ListHeaderComponent={header}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          colors={[C.ink]}
          onRefresh={() => {
            setRefreshing(true);
            void Promise.all([refreshOrders(), refreshReplies()]).finally(() =>
              setRefreshing(false),
            );
          }}
        />
      }
      ListEmptyComponent={
        !error && (known || !loading) ? (
          <Empty
            plate={
              <Image
                accessible={false}
                source={emptyPlate}
                resizeMode="contain"
                style={styles.plate}
              />
            }
            title={w('orders.noneTitle')}
            body={w('orders.noneBody')}
          />
        ) : null
      }
      ListFooterComponent={
        cursor ? (
          <Button kind="quiet" onPress={() => void loadMoreOrders()}>
            {w('orders.more')}
          </Button>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.ground },
  pad: { paddingHorizontal: space[4], paddingTop: space[2] },
  list: { paddingHorizontal: space[4], paddingBottom: space[6], gap: 2 },
  head: { gap: space[3], paddingTop: space[2], paddingBottom: space[3] },
  flex: { flex: 1, minWidth: 0 },
  quiet: { color: C.ink2 },
  card: { backgroundColor: C.up, padding: space[3], gap: space[1] },
  cardMain: { gap: space[1] },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  replies: { gap: 2 },
  reply: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: C.up,
    padding: space[3],
    minHeight: 56,
  },
  square: { width: 12, height: 12, backgroundColor: C.diyaInk },
  errorBox: { gap: space[2] },
  plate: { width: 240, height: 126 },
});
