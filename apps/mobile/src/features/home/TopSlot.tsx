import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { advisorStarters, type Order } from '@shiv/shared';
import { money } from '../../logic/money';
import { homeState, orderLines, otherSites } from '../../logic/home-state';
import { ask, setAskDraft, askStore } from '../../state/ask';
import { catalogStore } from '../../state/catalog';
import { checkoutStore } from '../../state/checkout';
import { khataStore } from '../../state/khata';
import { goToTab, openSheet, push } from '../../state/nav';
import { ordersStore } from '../../state/orders';
import { sessionStore } from '../../state/session';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Notice } from '../../ui/Notice';
import { Press } from '../../ui/Press';
import { heroPlate } from '../../ui/Specimen';
import { StatusTag } from '../../ui/StatusTag';
import { C, space, T, touch } from '../../ui/tokens';
import { w } from '../../words';

const orderAgain = (order: Order) => openSheet({ sheet: 'list', repeat: order.id });

/** New state: an invitation to ask. Hidden whenever Ask is off on the server. */
function AskBox() {
  const draft = useSelect(askStore, (state) => state.draft);
  const send = () => {
    goToTab('ask');
    void ask(draft || advisorStarters.home[0]!.en);
  };
  return (
    <View style={styles.askWrap}>
      <View style={styles.hero}>
        <Text style={[T.display, styles.heroWords]} accessibilityRole="header">
          {w('home.askHeading')}
        </Text>
        <Image accessible={false} source={heroPlate} resizeMode="contain" style={styles.plate} />
      </View>
      <View style={styles.box}>
        <TextInput
          accessibilityLabel={w('ask.boxLabel')}
          placeholder={advisorStarters.home[0]!.en}
          placeholderTextColor={C.ink2}
          value={draft}
          onChangeText={setAskDraft}
          onSubmitEditing={send}
          returnKeyType="send"
          style={[T.body, styles.input]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={w('ask.send')}
          onPress={send}
          style={styles.send}
        >
          <Icon name="paper-plane-outline" />
        </Pressable>
      </View>
    </View>
  );
}

/** The latest order: its status, and Order again one tap away. */
function LatestOrder({ order }: { order: Order }) {
  const site = (order.address as unknown as { label?: string } | null)?.label;
  return (
    <View style={styles.card}>
      <View style={styles.between}>
        <StatusTag status={order.status} />
        <Text style={T.rate}>{money(order.totalPaise)}</Text>
      </View>
      <Text style={T.body} numberOfLines={2}>
        {orderLines(order)}
      </Text>
      <Text style={[T.small, styles.quiet]} numberOfLines={1}>
        {[site, order.number].filter(Boolean).join(' · ')}
      </Text>
      <View style={styles.actions}>
        <Button icon="repeat" style={styles.grow} onPress={() => orderAgain(order)}>
          {w('orders.again')}
        </Button>
        <Button kind="line" onPress={() => push({ screen: 'order', id: order.id })}>
          {w('home.track')}
        </Button>
      </View>
    </View>
  );
}

/** Priority: an order result still unknown; a shop reply to answer; else the latest order. */
function RepeatTop({ orders }: { orders: Order[] }) {
  const pending = useSelect(checkoutStore, (state) => state.pending);
  const replies = useSelect(ordersStore, (state) => state.replies);
  const khata = useSelect(khataStore, (state) => state.khata);
  const others = otherSites(orders);
  const reply = replies.find((quote) => quote.status === 'SENT');
  const latest = orders[0];
  return (
    <View>
      {pending ? (
        <Press
          accessibilityRole="button"
          onPress={() => openSheet({ sheet: 'list' })}
          style={styles.pending}
        >
          <Notice tone="warn">{w('home.notSure')}</Notice>
        </Press>
      ) : null}
      {reply ? (
        <Press
          accessibilityRole="button"
          onPress={() => push({ screen: 'reply', id: reply.id })}
          style={[styles.row, styles.rowGap]}
        >
          <Text style={[T.body, styles.flex]}>{w('orders.replied')}</Text>
          <Icon name="chevron-forward" size={18} />
        </Press>
      ) : null}
      {latest ? <LatestOrder order={latest} /> : null}
      {khata.available && khata.balancePaise > 0 ? (
        <Press
          accessibilityRole="button"
          onPress={() => push({ screen: 'udhaar' })}
          style={[styles.row, styles.rowGap]}
        >
          <Text style={[T.body, styles.flex]}>{w('udhaar.due')}</Text>
          <Text style={T.rate}>{money(khata.balancePaise)}</Text>
          <Icon name="chevron-forward" size={18} />
        </Press>
      ) : null}
      {others.length ? (
        <View>
          <Text style={[T.titleLight, styles.others]} accessibilityRole="header">
            {w('home.otherSites')}
          </Text>
          {others.map(({ siteId, label, order }) => (
            <View key={siteId} style={[styles.row, styles.rowGap]}>
              <View style={styles.flex}>
                <Text style={T.body} numberOfLines={1}>
                  {label}
                </Text>
                <Text style={[T.small, styles.quiet]} numberOfLines={1}>
                  {orderLines(order)}
                </Text>
              </View>
              <Button
                kind="quiet"
                label={w('home.againAt', { site: label })}
                onPress={() => orderAgain(order)}
              >
                {w('orders.again')}
              </Button>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const TopSlot = memo(function TopSlot() {
  const user = useSelect(sessionStore, (state) => state.user);
  const known = useSelect(ordersStore, (state) => state.known);
  const orders = useSelect(ordersStore, (state) => state.items);
  const askEnabled = useSelect(catalogStore, (state) => state.askEnabled);
  const shape = homeState({ user, ordersKnown: known, latestOrder: orders[0] ?? null });
  if (shape === 'repeat') return <RepeatTop orders={orders} />;
  return askEnabled ? <AskBox /> : null;
});

const styles = StyleSheet.create({
  askWrap: { paddingBottom: space[4] },
  hero: { flexDirection: 'row', alignItems: 'flex-end', paddingLeft: space[4], minHeight: 150 },
  heroWords: { flex: 1, alignSelf: 'flex-start', paddingTop: space[1] },
  plate: { width: 156, height: 150 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: space[4],
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: C.ink,
    borderRadius: 2,
    backgroundColor: C.up,
    paddingLeft: space[3],
  },
  input: { flex: 1, minHeight: 48, color: C.ink, paddingVertical: space[1] },
  send: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  pending: { marginBottom: 2 },
  card: { backgroundColor: C.up, padding: space[4], gap: space[2], marginBottom: 2 },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  quiet: { color: C.ink2 },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
  grow: { flex: 1 },
  row: {
    backgroundColor: C.up,
    paddingLeft: space[4],
    paddingRight: space[3],
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  rowGap: { gap: space[2], paddingVertical: space[2] },
  flex: { flex: 1, minWidth: 0 },
  others: { paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[2] },
});
