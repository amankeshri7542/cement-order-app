import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  Text,
  View,
} from 'react-native';
import {
  dateLabel,
  dayLabel,
  historyNote,
  momentLabel,
  money,
  orderStatusText,
  paymentStatusText,
  space,
  type CartLine,
  type Language,
  type Order,
  type Page,
} from '@shiv/shared';
import { api, getWithRetry } from './api';
import { savedAge } from './age';
import { cacheKeys, readCache, writeCache } from './cache';
import { makeKey, readSaved, useStore, writeSaved } from './store';
import { OrderStatusTag } from './catalog';
import { Button, C, Empty, headingScale, Icon, Notice, s, Screen, useAfter } from './ui';
import { payOnline } from './payment';
import { CallToOrder, NextSteps, NotifyPrompt } from './first-run';

export async function confirm(
  text: string,
  language: Language,
  yes = language === 'hi' ? 'हाँ' : 'Confirm',
  no = language === 'hi' ? 'नहीं' : 'Keep order',
) {
  if (Platform.OS === 'web') return window.confirm(text);
  return new Promise<boolean>((resolve) =>
    Alert.alert(
      language === 'hi' ? 'कृपया पक्का करें' : 'Please confirm',
      text,
      [
        { text: no, style: 'cancel', onPress: () => resolve(false) },
        { text: yes, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

/** Polls only while the app is on screen; the phone's data and battery are not spent in the background. */
function useForegroundInterval(callback: () => void, ms: number | null) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (!ms) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => saved.current(), ms);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active' || Platform.OS === 'web') start();
    const sub = AppState.addEventListener('change', (state) =>
      state === 'active' ? start() : stop(),
    );
    return () => {
      stop();
      sub.remove();
    };
  }, [ms]);
}

/**
 * "Order again": adds a past order's materials to the basket. The request key is saved first,
 * so a lost reply can be checked again without adding the materials twice.
 */
export function useReorder(order: Order | null) {
  const { user, mutateCart, navigate, setToast, say, t } = useStore();
  const [key, setKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const storageKey = user && order ? `shiv_reorder_${user.id}_${order.id}` : '';
  useEffect(() => {
    let active = true;
    setReady(false);
    setKey(null);
    setError('');
    if (!storageKey) return;
    void readSaved<string>(storageKey)
      .then((saved) => {
        if (!active) return;
        if (
          saved !== null &&
          (typeof saved !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved))
        )
          throw new Error('unreadable');
        setKey(saved);
        setReady(true);
      })
      .catch(() => {
        if (active)
          setError(
            t(
              'Could not restore your last reorder request. Contact the store before ordering again.',
              'आपका पिछला दोबारा-ऑर्डर अनुरोध नहीं मिल सका। फिर से मँगाने से पहले दुकान से बात करें।',
            ),
          );
      });
    return () => {
      active = false;
    };
  }, [storageKey]);
  async function run() {
    if (!order || !user || !ready || running.current) return;
    running.current = true;
    const ownerId = user.id;
    const requestKey = key || makeKey();
    setKey(requestKey);
    setError('');
    setBusy(true);
    try {
      let cleanupFailed = false;
      let notices: string[] = [];
      const applied = await mutateCart(ownerId, async (isCurrent) => {
        await writeSaved(storageKey, requestKey);
        if (!isCurrent()) return [];
        const result = await api<{ notices: string[]; cart: CartLine[] }>(
          `/orders/${order.id}/reorder`,
          'POST',
          { idempotencyKey: requestKey },
        );
        if (!isCurrent()) return [];
        notices = result.notices;
        await writeSaved(storageKey, null).catch(() => {
          cleanupFailed = true;
        });
        return result.cart;
      });
      if (!applied) return;
      setKey(null);
      const all = [
        ...notices,
        ...(cleanupFailed
          ? [
              t(
                'Basket updated. If this request appears again, checking it will not add the materials twice.',
                'टोकरी अपडेट हो गई। यह अनुरोध फिर दिखे तो जाँचने से सामग्री दोबारा नहीं जुड़ेगी।',
              ),
            ]
          : []),
      ];
      if (all.length) setToast(all.join('\n'));
      navigate({ screen: 'Cart' });
    } catch (e) {
      setError(
        t(
          `The reorder result is not confirmed. Check this same request before ordering again. ${say(e)}`,
          `दोबारा-ऑर्डर का परिणाम पक्का नहीं है। फिर से मँगाने से पहले यही अनुरोध जाँचें। ${say(e)}`,
        ),
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { run, busy, ready, pending: Boolean(key), error };
}

export function Orders() {
  const { t, language, navigate, registerRefresh, rememberOrder, say, user, online } = useStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  // Set while the list on screen is the copy saved on this phone, not what the store just said.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const request = useRef(0);
  const liveFor = useRef(0);
  // Saved orders are called "saved" once the store has been slow to confirm them.
  const slowToConfirm = useAfter(savedAt !== null, 1500);
  const userId = user?.id;
  const load = useCallback(
    async (after?: string) => {
      const current = ++request.current;
      if (!after) setLoading((old) => old && !orders.length);
      // The last orders seen on this phone show at once, and stay if the store cannot be reached.
      if (!after && userId)
        void readCache<Order[]>(cacheKeys.orders(userId)).then((saved) => {
          if (
            !saved ||
            !Array.isArray(saved.data) ||
            current !== request.current ||
            liveFor.current === current
          )
            return;
          setOrders(saved.data);
          saved.data.forEach(rememberOrder);
          setSavedAt(saved.savedAt);
          setLoading(false);
        });
      try {
        const page = await getWithRetry<Page<Order>>(
          `/orders?limit=24${after ? '&cursor=' + encodeURIComponent(after) : ''}`,
        );
        if (current !== request.current) return;
        liveFor.current = current;
        setSavedAt(null);
        if (!after && userId) void writeCache(cacheKeys.orders(userId), page.items);
        setOrders((old) =>
          after
            ? [...new Map([...old, ...page.items].map((order) => [order.id, order])).values()]
            : page.items,
        );
        setCursor(page.nextCursor);
        setError('');
      } catch (e) {
        if (current === request.current) setError(say(e));
      } finally {
        if (current === request.current) setLoading(false);
      }
    },
    [say, userId],
  );
  useEffect(() => {
    if (!user) return;
    void load();
    const online = () => void load();
    if (Platform.OS === 'web') window.addEventListener('online', online);
    return () => {
      request.current++;
      if (Platform.OS === 'web') window.removeEventListener('online', online);
    };
  }, [load, user?.id]);
  useEffect(() => registerRefresh(() => load()), [load, registerRefresh]);
  if (!user)
    return (
      <Screen>
        <Empty
          icon="receipt-outline"
          title={t('Your orders appear here', 'आपके ऑर्डर यहाँ दिखेंगे')}
          body={t(
            'Sign in with your mobile number to see and track orders.',
            'ऑर्डर देखने और ट्रैक करने के लिए मोबाइल नंबर से साइन इन करें।',
          )}
          action={t('Sign in', 'साइन इन')}
          onAction={() => navigate({ screen: 'Orders' })}
        />
      </Screen>
    );
  return (
    <FlatList
      data={orders}
      keyExtractor={(order) => order.id}
      contentContainerStyle={{
        padding: space.lg,
        gap: space.md,
        maxWidth: 720,
        width: '100%',
        alignSelf: 'center',
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          colors={[C.accent]}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          <View style={s.between}>
            <Text style={s.h1} maxFontSizeMultiplier={headingScale} accessibilityRole="header">
              {t('Orders', 'ऑर्डर')}
            </Text>
            <Button
              kind="quiet"
              icon="document-text-outline"
              onPress={() => navigate({ screen: 'Quotes' })}
            >
              {t('Bulk quotes', 'थोक भाव')}
            </Button>
          </View>
          {Boolean(error) && (
            <View style={{ gap: space.sm }}>
              <Notice error>{error}</Notice>
              <Button secondary onPress={() => void load()}>
                {t('Try again', 'फिर कोशिश करें')}
              </Button>
            </View>
          )}
          {savedAt && (Boolean(error) || !online || slowToConfirm) ? (
            <Notice tone="warn">
              {t(
                `Showing the orders saved ${savedAge(savedAt, Date.now(), 'en')}. Their status may have changed.`,
                `${savedAge(savedAt, Date.now(), 'hi')} के सेव किए ऑर्डर दिख रहे हैं। उनकी स्थिति बदल सकती है।`,
              )}
            </Notice>
          ) : null}
          {loading && <Text style={s.body}>{t('Loading…', 'लोड हो रहा है…')}</Text>}
        </View>
      }
      ListEmptyComponent={
        !loading && !error ? (
          <View>
            <Empty
              icon="receipt-outline"
              title={t('No orders yet', 'अभी कोई ऑर्डर नहीं')}
              body={t(
                'Your orders and delivery updates will appear here.',
                'आपके ऑर्डर और डिलीवरी की जानकारी यहाँ दिखेगी।',
              )}
              action={t('Browse materials', 'सामग्री देखें')}
              onAction={() => navigate({ screen: 'Products' })}
            />
            <CallToOrder />
          </View>
        ) : null
      }
      renderItem={({ item: o }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('Open', 'खोलें')} ${o.number}, ${orderStatusText(o.status, language)}`}
          onPress={() => {
            rememberOrder(o);
            navigate({ screen: 'Order', id: o.id });
          }}
          style={({ pressed }) => [s.card, { gap: space.sm }, pressed && { opacity: 0.8 }]}
        >
          <View style={s.between}>
            <Text style={[s.h3, { fontVariant: ['tabular-nums'] }]}>{o.number}</Text>
            <OrderStatusTag status={o.status} language={language} />
          </View>
          <Text style={s.small} numberOfLines={2}>
            {o.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}
          </Text>
          <View style={s.between}>
            <Text style={s.small}>
              {t('Delivery', 'डिलीवरी')} {dayLabel(o.deliveryDate, language)}
            </Text>
            <Text style={s.price}>{money(o.totalPaise)}</Text>
          </View>
        </Pressable>
      )}
      ListFooterComponent={
        cursor ? (
          <Button secondary loading={loading} onPress={() => void load(cursor)}>
            {t('Load more orders', 'और ऑर्डर दिखाएँ')}
          </Button>
        ) : null
      }
    />
  );
}

const moving = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'DELIVERY_EXCEPTION',
];

export function OrderDetail() {
  const { route, t, language, setToast, user, ordersById, registerRefresh, settings, say } =
    useStore();
  const [order, setOrder] = useState<Order | null>(() => ordersById[route.id || ''] || null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // False until the store has confirmed this order; what shows before may be a saved copy.
  const [confirmed, setConfirmed] = useState(false);
  const unconfirmed = useAfter(Boolean(order) && !confirmed && !error, 1500);
  const reorder = useReorder(order);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    try {
      const updated = await api<Order>(`/orders/${encodeURIComponent(route.id || '')}`);
      if (current !== request.current) return;
      setOrder(updated);
      setConfirmed(true);
      setError('');
    } catch (e) {
      if (current === request.current) setError(say(e));
    }
  }, [route.id, say]);
  useEffect(() => {
    void load();
    const online = () => void load();
    if (Platform.OS === 'web') window.addEventListener('online', online);
    return () => {
      request.current++;
      if (Platform.OS === 'web') window.removeEventListener('online', online);
    };
  }, [load]);
  // Live status only while the order is still moving; delivered and cancelled orders stay quiet.
  useForegroundInterval(() => void load(), order && moving.includes(order.status) ? 60000 : null);
  useEffect(() => registerRefresh(load), [load, registerRefresh]);
  if (!order)
    return (
      <Screen>
        {error ? (
          <>
            <Notice error>{error}</Notice>
            <Button onPress={() => void load()}>{t('Try again', 'फिर कोशिश करें')}</Button>
          </>
        ) : (
          <Text style={s.body}>{t('Loading…', 'लोड हो रहा है…')}</Text>
        )}
      </Screen>
    );
  const needsAttention = [
    'PENDING_PAYMENT',
    'CANCELLED',
    'REFUND_PENDING',
    'DELIVERY_EXCEPTION',
  ].includes(order.status);
  const lastAttempt = order.deliveryAttempts?.at(-1);
  const reasons: Record<string, string> = {
    UNAVAILABLE: t('Nobody was available at the site', 'साइट पर कोई मौजूद नहीं था'),
    REFUSED: t('Delivery was refused', 'डिलीवरी लेने से मना किया गया'),
    INACCESSIBLE: t('The site could not be reached', 'साइट तक नहीं पहुँच सके'),
  };
  const phone = settings?.phone.replace(/\D/g, '');
  const cod = order.payment.method === 'COD';
  async function cancel() {
    if (
      !(await confirm(
        t(
          'Cancel this order? Its reserved stock will be released.',
          'यह ऑर्डर रद्द करें? इसके लिए रखा स्टॉक छोड़ दिया जाएगा।',
        ),
        language,
        t('Cancel order', 'ऑर्डर रद्द करें'),
        t('Keep order', 'ऑर्डर रखें'),
      ))
    )
      return;
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
      footer={
        <View style={[s.row, { gap: space.sm }]}>
          <Button
            icon="repeat"
            style={{ flex: 1 }}
            loading={reorder.busy}
            disabled={!reorder.ready}
            onPress={() => void reorder.run()}
          >
            {reorder.pending
              ? t('Check reorder result', 'दोबारा-ऑर्डर जाँचें')
              : t('Order again', 'फिर से मँगाएँ')}
          </Button>
          {phone ? (
            <Button
              secondary
              icon="logo-whatsapp"
              style={{ flex: 1 }}
              onPress={() =>
                void Linking.openURL(
                  `https://wa.me/${phone}?text=${encodeURIComponent(
                    t(
                      `Please help with my Shiv Cement Store order ${order.number}.`,
                      `कृपया मेरे शिव सीमेंट स्टोर ऑर्डर ${order.number} में मदद करें।`,
                    ),
                  )}`,
                ).catch(() => setToast(t('Could not open WhatsApp.', 'WhatsApp नहीं खुल सका।')))
              }
            >
              {t('Help', 'मदद')}
            </Button>
          ) : null}
        </View>
      }
    >
      {Boolean(error) && (
        <Notice error>
          {error} {t('Your last confirmed details are shown.', 'पिछली पक्की जानकारी दिख रही है।')}
        </Notice>
      )}
      {unconfirmed ? (
        <Notice tone="warn">
          {t(
            'Showing the details this phone saw last. Checking for news…',
            'इस फ़ोन पर पिछली बार की जानकारी दिख रही है। नई जानकारी देखी जा रही है…',
          )}
        </Notice>
      ) : null}
      <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
        <View
          style={{
            width: 64,
            height: 64,
            backgroundColor: needsAttention ? C.dangerSoft : C.okSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon
            name={
              order.status === 'CANCELLED' ? 'close' : needsAttention ? 'time-outline' : 'checkmark'
            }
            size={32}
            color={needsAttention ? C.danger : C.ok}
          />
        </View>
        <Text
          style={[s.h1, { textAlign: 'center' }]}
          maxFontSizeMultiplier={headingScale}
          accessibilityRole="header"
        >
          {orderStatusText(order.status, language)}
        </Text>
        <Text style={s.body}>
          {order.number} · {t('placed', 'दिया')} {momentLabel(order.createdAt, language)}
        </Text>
      </View>
      <NextSteps order={order} />
      {/* The question comes after the confirmation and what happens next, not before them. */}
      <NotifyPrompt />
      {order.work?.acknowledgedAt && (
        <Notice tone="good">
          {t('The store has seen your order', 'दुकान ने आपका ऑर्डर देख लिया है')}
          {order.work.assignedTo?.name ? ` · ${order.work.assignedTo.name}` : ''}
        </Notice>
      )}
      {order.status === 'PENDING_PAYMENT' && (
        <>
          <Notice>
            {t(
              'Payment is being checked. Refresh this order before paying again; payment is confirmed only by the store’s server.',
              'भुगतान जाँचा जा रहा है। दोबारा भुगतान से पहले यह ऑर्डर रीफ़्रेश करें; भुगतान दुकान का सर्वर ही पक्का करता है।',
            )}
          </Notice>
          {order.payment.initializationStartedAt && !order.payment.razorpayOrderId && (
            <Notice>
              {t(
                'Payment setup needs the store to check it. Do not pay again; contact the store with this order number.',
                'भुगतान की जाँच दुकान करेगी। दोबारा भुगतान न करें; इस ऑर्डर नंबर के साथ दुकान से बात करें।',
              )}
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
                setError(say(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('Pay online', 'ऑनलाइन भुगतान')} · {money(order.totalPaise)}
          </Button>
        </>
      )}
      {order.status === 'REFUND_PENDING' && (
        <Notice>
          {t(
            'This order is cancelled and a refund is due. The store will arrange it; contact them for an update.',
            'यह ऑर्डर रद्द है और पैसा लौटाना है। दुकान इसकी व्यवस्था करेगी; जानकारी के लिए उनसे बात करें।',
          )}
        </Notice>
      )}
      {order.status === 'REFUNDED' && (
        <Notice>
          {t(
            'Your payment has been refunded. This order will not be delivered.',
            'आपका भुगतान लौटा दिया गया है। यह ऑर्डर डिलीवर नहीं होगा।',
          )}
        </Notice>
      )}
      {order.status === 'CANCELLED' && (
        <Notice>
          {t(
            'This order is cancelled and will not be delivered.',
            'यह ऑर्डर रद्द है और डिलीवर नहीं होगा।',
          )}
        </Notice>
      )}
      {order.status === 'DELIVERY_EXCEPTION' && (
        <Notice error>
          {(lastAttempt?.reason && reasons[lastAttempt.reason]) ||
            t('Delivery could not be completed', 'डिलीवरी पूरी नहीं हो सकी')}
          {'. '}
          {t(
            'Contact the store to arrange another attempt or a return.',
            'दोबारा डिलीवरी या वापसी के लिए दुकान से बात करें।',
          )}
        </Notice>
      )}
      {lastAttempt?.action === 'RETRY' && order.status !== 'DELIVERED' && (
        <Notice>
          {t('Another delivery is arranged for', 'अगली डिलीवरी की तारीख:')}{' '}
          {dayLabel(lastAttempt.retryDate || order.deliveryDate, language)}
        </Notice>
      )}
      {lastAttempt?.action === 'RETURN' && (
        <Notice>
          {t(
            'The store confirmed the return of the materials.',
            'दुकान ने सामग्री की वापसी पक्की की।',
          )}
        </Notice>
      )}
      {/* The order's parchi: paper, ruled lines, square corners. */}
      <View style={[s.paper, { gap: space.sm }]}>
        <Text style={s.h3}>{t('Materials', 'सामग्री')}</Text>
        {order.items.map((i) => (
          <View key={i.productId} style={[s.between, s.ruled, { paddingBottom: space.sm }]}>
            <View style={{ flex: 1, minWidth: 160 }}>
              <Text style={[s.body, { color: C.ink, fontWeight: '700' }]}>{i.name}</Text>
              <Text style={s.small}>
                {i.quantity} × {money(i.pricePaise)} / {i.unit}
              </Text>
            </View>
            <Text
              style={[s.body, { color: C.ink, fontWeight: '700', fontVariant: ['tabular-nums'] }]}
            >
              {money(i.lineTotalPaise)}
            </Text>
          </View>
        ))}
        <View style={[s.between, s.ruled, { paddingBottom: space.sm }]}>
          <Text style={s.body}>{t('Delivery', 'डिलीवरी')}</Text>
          <Text style={s.body}>{money(order.deliveryFeePaise)}</Text>
        </View>
        <View style={s.between}>
          <Text style={s.h3}>{t('Total', 'कुल')}</Text>
          <Text style={s.priceBig} maxFontSizeMultiplier={1.5}>
            {money(order.totalPaise)}
          </Text>
        </View>
        <Text style={s.small}>
          {cod ? t('Cash on delivery', 'डिलीवरी पर भुगतान') : t('Online', 'ऑनलाइन')} ·{' '}
          {paymentStatusText(order.payment.status, language)}
        </Text>
      </View>
      <View style={[s.card, { gap: space.xs }]}>
        <Text style={s.h3}>
          {t('Delivery', 'डिलीवरी')} · {dateLabel(`${order.deliveryDate}T12:00:00+05:30`, language)}
        </Text>
        <Text style={s.body}>
          {order.address.name}
          {'\n'}
          {order.address.line1}, {order.address.area}
          {'\n'}
          {order.address.city}, {order.address.pincode}
          {'\n'}
          {order.address.phone}
          {order.notes ? `\n${order.notes}` : ''}
        </Text>
      </View>
      {reorder.pending && (
        <Notice>
          {t(
            'Your previous reorder may already have updated the basket. Checking this same request will not add the materials twice.',
            'आपका पिछला दोबारा-ऑर्डर शायद टोकरी में जुड़ चुका है। यही अनुरोध जाँचने से सामग्री दोबारा नहीं जुड़ेगी।',
          )}
        </Notice>
      )}
      {reorder.error ? <Notice error>{reorder.error}</Notice> : null}
      <Button
        secondary
        icon="share-social-outline"
        onPress={() => {
          void Share.share({
            message: `${t('Shiv Cement Store — order summary (not a GST invoice)', 'शिव सीमेंट स्टोर — ऑर्डर सारांश (GST बिल नहीं)')}\n${order.number}\n${order.items
              .map(
                (i) =>
                  `${i.name}: ${i.quantity} × ${money(i.pricePaise)} = ${money(i.lineTotalPaise)}`,
              )
              .join(
                '\n',
              )}\n${t('Delivery', 'डिलीवरी')}: ${money(order.deliveryFeePaise)}\n${t('Total', 'कुल')}: ${money(order.totalPaise)}`,
          }).catch((e) => setError(say(e)));
        }}
      >
        {t('Share order summary', 'ऑर्डर सारांश भेजें')}
      </Button>
      {['PENDING_PAYMENT', 'CONFIRMED'].includes(order.status) && (
        <Button kind="quiet" loading={busy} onPress={() => void cancel()}>
          {t('Cancel order', 'ऑर्डर रद्द करें')}
        </Button>
      )}
      <Text style={s.h3}>{t('Order history', 'ऑर्डर का इतिहास')}</Text>
      {order.history.map((h) => (
        <View key={h.id} style={{ backgroundColor: C.surface, padding: space.md, gap: 2 }}>
          <Text style={[s.body, { color: C.ink, fontWeight: '700' }]}>
            {orderStatusText(h.status, language)}
          </Text>
          {historyNote(h.note, language) ? (
            <Text style={s.small}>{historyNote(h.note, language)}</Text>
          ) : null}
          <Text style={s.small}>{momentLabel(h.createdAt, language)}</Text>
        </View>
      ))}
    </Screen>
  );
}
