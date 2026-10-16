import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  dayLabel,
  deliveryDateOptions,
  shortDayLabel,
  weekdayLabel,
  money,
  productName,
  space,
  unitLabel,
  MAX_LINE_QUANTITY,
  type CheckoutReview,
  type Order,
} from '@shiv/shared';
import { makeKey, useStore } from './store';
import { ApiError, api } from './api';
import {
  Bone,
  Button,
  C,
  Chip,
  CodStamp,
  Empty,
  Field,
  Icon,
  Notice,
  Screen,
  TornEdge,
  s,
} from './ui';
import { MaterialArt, Quantity } from './catalog';
import { payOnline } from './payment';

function MergeNotice() {
  const { mergeDraft, mergeGuest, discardMerge, knownProducts, cartBusy, t } = useStore();
  if (!mergeDraft) return null;
  const names = mergeDraft.lines
    .map(
      (line) =>
        `${knownProducts[line.productId]?.name || t('Material', 'सामग्री')} × ${line.quantity}`,
    )
    .join(', ');
  return (
    <View style={{ gap: space.sm }}>
      <Notice error={!mergeDraft.uncertain}>
        {mergeDraft.uncertain
          ? t(
              `Materials you chose before signing in (${names}) are not confirmed in your basket yet. Checking again will not add them twice.`,
              `साइन इन से पहले चुनी सामग्री (${names}) अभी टोकरी में पक्की नहीं हुई। दोबारा जाँचने से वे दो बार नहीं जुड़ेंगी।`,
            )
          : t(
              `These materials from before sign-in could not be added: ${names}. ${mergeDraft.problem || ''}`,
              `साइन इन से पहले की यह सामग्री नहीं जुड़ सकी: ${names}। ${mergeDraft.problem || ''}`,
            )}
      </Notice>
      <View style={[s.row, { gap: space.sm }]}>
        <Button
          secondary
          loading={cartBusy}
          style={{ flex: 1 }}
          onPress={() => void mergeGuest(true)}
        >
          {mergeDraft.uncertain ? t('Check again', 'फिर जाँचें') : t('Try again', 'फिर कोशिश करें')}
        </Button>
        {!mergeDraft.uncertain && (
          <Button kind="quiet" style={{ flex: 1 }} onPress={discardMerge}>
            {t('Remove these', 'इन्हें हटाएँ')}
          </Button>
        )}
      </View>
    </View>
  );
}

function DeliveryDetails() {
  const { addresses, settings, t, language, checkoutDraft, updateCheckoutDraft, openAddresses } =
    useStore();
  const [choosing, setChoosing] = useState(false);
  const [notesOpen, setNotesOpen] = useState(Boolean(checkoutDraft.notes));
  const addressId = addresses.some((address) => address.id === checkoutDraft.addressId)
    ? checkoutDraft.addressId
    : addresses[0]?.id || '';
  const address = addresses.find((item) => item.id === addressId);
  const dates = deliveryDateOptions(new Date(), 0, 14);
  const today = dates[0];
  return (
    <View style={{ gap: space.lg }}>
      <View style={[s.card, { gap: space.md }]}>
        <View style={s.between}>
          <Text style={s.h3}>{t('Deliver to', 'डिलीवरी का पता')}</Text>
          {addresses.length > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setChoosing((open) => !open)}
              style={{ minHeight: 48, justifyContent: 'center' }}
            >
              <Text style={s.link}>{choosing ? t('Done', 'हो गया') : t('Change', 'बदलें')}</Text>
            </Pressable>
          )}
        </View>
        {!address ? (
          <Button icon="add" secondary onPress={() => openAddresses('new')}>
            {t('Add your site address', 'साइट का पता जोड़ें')}
          </Button>
        ) : choosing ? (
          <View style={{ gap: space.sm }}>
            {addresses.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="radio"
                aria-checked={item.id === addressId}
                accessibilityState={{ checked: item.id === addressId }}
                onPress={() => {
                  updateCheckoutDraft({ addressId: item.id });
                  setChoosing(false);
                }}
                style={[s.row, { minHeight: 56 }]}
              >
                <Icon
                  name={item.id === addressId ? 'radio-button-on' : 'radio-button-off'}
                  color={C.ink}
                />
                <Text style={[s.body, { flex: 1, color: C.ink }]}>
                  <Text style={{ fontWeight: '800' }}>{item.label}</Text> · {item.line1},{' '}
                  {item.area}, {item.pincode}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('Edit', 'बदलें')} ${item.label}`}
                  onPress={(event) => {
                    event.stopPropagation();
                    openAddresses(item.id);
                  }}
                  style={{ padding: space.md }}
                >
                  <Icon name="create-outline" />
                </Pressable>
              </Pressable>
            ))}
            <Button kind="quiet" icon="add" onPress={() => openAddresses('new')}>
              {t('Add another address', 'दूसरा पता जोड़ें')}
            </Button>
          </View>
        ) : (
          <Text style={[s.body, { color: C.ink }]}>
            <Text style={{ fontWeight: '800' }}>{address.label}</Text> · {address.name}
            {'\n'}
            {address.line1}, {address.area}, {address.city} {address.pincode}
          </Text>
        )}
      </View>
      <View style={{ gap: space.sm }}>
        <Text style={s.h3}>{t('Delivery date', 'डिलीवरी की तारीख')}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm }}
        >
          {dates.map((date) => (
            <Chip
              key={date}
              role="radio"
              label={
                date === today
                  ? t('Today', 'आज')
                  : date === dates[1]
                    ? t('Tomorrow', 'कल')
                    : weekdayLabel(date, language)
              }
              detail={shortDayLabel(date, language)}
              accessibilityLabel={dayLabel(date, language)}
              selected={checkoutDraft.date === date}
              onPress={() => updateCheckoutDraft({ date })}
            />
          ))}
        </ScrollView>
      </View>
      <View style={{ gap: space.sm }}>
        <Text style={s.h3}>{t('Payment', 'भुगतान')}</Text>
        <View style={[s.row, { gap: space.sm, flexWrap: 'wrap' }]}>
          <Chip
            role="radio"
            label={t('Cash on delivery', 'डिलीवरी पर भुगतान')}
            detail={t('cash or UPI at the site', 'साइट पर नकद या UPI')}
            selected={checkoutDraft.paymentMethod === 'COD'}
            onPress={() => updateCheckoutDraft({ paymentMethod: 'COD' })}
          />
          {settings?.onlinePaymentsAvailable && (
            <Chip
              role="radio"
              label={t('Pay online', 'ऑनलाइन भुगतान')}
              detail="UPI · Razorpay"
              selected={checkoutDraft.paymentMethod === 'ONLINE'}
              onPress={() => updateCheckoutDraft({ paymentMethod: 'ONLINE' })}
            />
          )}
        </View>
      </View>
      {notesOpen ? (
        <Field
          label={t('Delivery note (optional)', 'डिलीवरी निर्देश (वैकल्पिक)')}
          value={checkoutDraft.notes}
          onChangeText={(notes) => updateCheckoutDraft({ notes })}
          multiline
          maxLength={500}
          placeholder={t('Landmark, unloading, floor…', 'पहचान का स्थान, उतराई, मंज़िल…')}
        />
      ) : (
        <Button kind="quiet" icon="create-outline" onPress={() => setNotesOpen(true)}>
          {t('Add a delivery note', 'डिलीवरी निर्देश जोड़ें')}
        </Button>
      )}
    </View>
  );
}

export function Cart() {
  const {
    basket,
    basketLoading,
    cartBusy,
    t,
    language,
    navigate,
    setQuantity,
    user,
    addresses,
    checkoutDraft,
    mergeDraft,
    say,
  } = useStore();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function change(productId: string, quantity: number) {
    const line = basket.find((item) => item.productId === productId);
    if (!line) return;
    setBusy(productId);
    setError('');
    try {
      await setQuantity(line.product, quantity);
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy('');
    }
  }
  const subtotal = basket.reduce(
    (total, line) => total + line.product.pricePaise * line.quantity,
    0,
  );
  const blocked = basket.some((line) => !line.product.active || line.quantity > line.product.stock);
  const addressReady =
    addresses.some((a) => a.id === checkoutDraft.addressId) || addresses.length > 0;
  if (!basket.length && !basketLoading)
    return (
      <Screen>
        <MergeNotice />
        <Empty
          icon="basket-outline"
          title={t('Your basket is empty', 'आपकी टोकरी खाली है')}
          body={t(
            'Add cement, steel or sand and order with cash on delivery.',
            'सीमेंट, सरिया या बालू जोड़ें और डिलीवरी पर भुगतान से ऑर्डर करें।',
          )}
          action={t('Browse materials', 'सामग्री देखें')}
          onAction={() => navigate({ screen: 'Products' })}
        />
      </Screen>
    );
  return (
    <Screen
      footer={
        <>
          <View style={s.between}>
            <Text style={s.body}>{t('Materials total', 'सामग्री का कुल')}</Text>
            <Text style={s.price}>{money(subtotal)}</Text>
          </View>
          {user ? (
            <Button
              icon="arrow-forward"
              disabled={
                Boolean(busy) || cartBusy || blocked || !addressReady || Boolean(mergeDraft)
              }
              onPress={() => navigate({ screen: 'Checkout' })}
            >
              {t('Review order', 'ऑर्डर देखें')}
            </Button>
          ) : (
            <Button icon="log-in-outline" onPress={() => navigate({ screen: 'Checkout' })}>
              {t('Sign in to order', 'ऑर्डर के लिए साइन इन करें')}
            </Button>
          )}
        </>
      }
    >
      <Text style={s.h1} accessibilityRole="header">
        {t('Your basket', 'आपकी टोकरी')}
      </Text>
      <MergeNotice />
      {basketLoading && <Bone height={88} />}
      {basket.length > 0 && (
        // The basket is the counter slip (parchi): paper, ruled lines and the COD stamp.
        <View>
          <View style={[s.paper, { paddingVertical: space.sm }]}>
            {basket.map((line) => (
              <View
                key={line.productId}
                style={[s.ruled, { gap: space.md, paddingVertical: space.md }]}
              >
                <View style={[s.row, { alignItems: 'flex-start' }]}>
                  <MaterialArt product={line.product} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.h3}>{productName(line.product, language)}</Text>
                    <Text style={s.small}>
                      {money(line.product.pricePaise)} / {unitLabel(line.product.unit, language)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('Remove', 'हटाएँ')} ${productName(line.product, language)}`}
                    disabled={Boolean(busy) || cartBusy}
                    onPress={() => void change(line.productId, 0)}
                    style={{
                      padding: space.sm,
                      minWidth: 48,
                      minHeight: 48,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="trash-outline" color={C.muted} />
                  </Pressable>
                </View>
                <View style={s.between}>
                  <Quantity
                    label={`${productName(line.product, language)} ${t('quantity', 'मात्रा')}`}
                    value={line.quantity}
                    min={line.product.minQuantity}
                    step={line.product.quantityStep}
                    max={Math.min(MAX_LINE_QUANTITY, line.product.stock)}
                    disabled={Boolean(busy) || cartBusy}
                    commitOnBlur
                    allowRemove
                    onInvalid={setError}
                    change={(n) => void change(line.productId, n)}
                  />
                  <Text style={s.price}>{money(line.product.pricePaise * line.quantity)}</Text>
                </View>
                {(!line.product.active || line.quantity > line.product.stock) && (
                  <Notice error>
                    {t(
                      'Only part of this is in stock now. Lower the quantity or remove it.',
                      'अभी इतना स्टॉक नहीं है। मात्रा कम करें या हटाएँ।',
                    )}
                  </Notice>
                )}
              </View>
            ))}
            {checkoutDraft.paymentMethod === 'COD' && (
              <View style={{ alignItems: 'flex-end', paddingTop: space.md }}>
                <CodStamp
                  label={t('Payment: cash on delivery', 'भुगतान: पहुँचने पर नकद')}
                  text={t('Cash on\ndelivery', 'नकद\nपहुँचने पर')}
                />
              </View>
            )}
          </View>
          <TornEdge />
        </View>
      )}
      {Boolean(error) && <Notice error>{error}</Notice>}
      {user ? (
        <DeliveryDetails />
      ) : (
        <Notice>
          {t(
            'Your basket is saved on this phone. Sign in with your mobile number when you are ready to order.',
            'आपकी टोकरी इस फ़ोन पर सहेजी है। ऑर्डर करने के लिए मोबाइल नंबर से साइन इन करें।',
          )}
        </Notice>
      )}
    </Screen>
  );
}

export function Checkout() {
  const {
    addresses,
    cart,
    user,
    t,
    language,
    navigate,
    refreshAccount,
    refreshCatalog,
    setToast,
    checkoutDraft,
    pendingCheckout,
    savePendingCheckout,
    rememberOrder,
    draftsLoading,
    say,
  } = useStore();
  const { date, notes, paymentMethod } = checkoutDraft;
  const addressId = addresses.some((address) => address.id === checkoutDraft.addressId)
    ? checkoutDraft.addressId
    : addresses[0]?.id || '';
  const [review, setReview] = useState<CheckoutReview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const reviewing = useRef(0);
  const getReview = useCallback(async () => {
    if (submitting.current || !addressId) return;
    const current = ++reviewing.current;
    setBusy(true);
    setError('');
    setAccepted(false);
    try {
      const next = await api<CheckoutReview>('/checkout/review', 'POST', {
        addressId,
        deliveryDate: date,
        notes,
        paymentMethod,
      });
      if (current === reviewing.current) setReview(next);
    } catch (e) {
      if (current === reviewing.current) {
        setReview(null);
        setError(say(e));
      }
    } finally {
      if (current === reviewing.current) setBusy(false);
    }
  }, [addressId, date, notes, paymentMethod, say]);
  useEffect(() => {
    if (!draftsLoading && !pendingCheckout && cart.length) void getReview();
  }, [draftsLoading, pendingCheckout, getReview, cart.length]);
  async function place() {
    if (submitting.current || (!pendingCheckout && !review)) return;
    if (!pendingCheckout && review!.changes.length && !accepted) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    const submission = pendingCheckout || {
      reviewId: review!.id,
      idempotencyKey: makeKey(),
      paymentMethod: review!.paymentMethod,
      totalPaise: review!.totalPaise,
    };
    try {
      // Save the original request before sending it so an interrupted response is safe to retry.
      await savePendingCheckout(submission);
      const order = await api<Order>('/orders', 'POST', {
        reviewId: submission.reviewId,
        idempotencyKey: submission.idempotencyKey,
      });
      rememberOrder(order);
      navigate({ screen: 'Order', id: order.id });
      void savePendingCheckout(null).catch(() =>
        setToast(
          t(
            'Order received. Retrying the saved request returns this same order.',
            'ऑर्डर मिल गया। सहेजा अनुरोध दोबारा भेजने पर यही ऑर्डर लौटेगा।',
          ),
        ),
      );
      void refreshAccount().catch(() => {});
      void refreshCatalog();
      if (submission.paymentMethod === 'ONLINE' && order.status === 'PENDING_PAYMENT') {
        try {
          const result = await payOnline(order.id, user!.phone);
          setToast(result.message);
        } catch (e) {
          setToast(say(e));
        }
      }
    } catch (e) {
      if (
        e instanceof ApiError &&
        [
          'PRICE_CHANGED',
          'OUT_OF_STOCK',
          'REVIEW_EXPIRED',
          'CART_CHANGED',
          'PAYMENTS_UNAVAILABLE',
          'INVALID_DELIVERY_DATE',
          'EMPTY_CART',
        ].includes(e.code)
      ) {
        await savePendingCheckout(null).catch(() => {});
        setReview(null);
        setAccepted(false);
        setError(say(e));
      } else {
        setError(
          t(
            `We could not confirm the result. Check this same request before placing another order. ${say(e)}`,
            `परिणाम पक्का नहीं हो सका। दूसरा ऑर्डर देने से पहले यही अनुरोध जाँचें। ${say(e)}`,
          ),
        );
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (draftsLoading)
    return (
      <Screen>
        <Text style={s.body}>
          {t('Restoring your checkout…', 'आपका चेकआउट वापस लाया जा रहा है…')}
        </Text>
      </Screen>
    );
  if (pendingCheckout)
    return (
      <Screen
        footer={
          <Button loading={busy} onPress={() => void place()}>
            {t('Check order result', 'ऑर्डर का परिणाम जाँचें')}
          </Button>
        }
      >
        <Text style={s.h1}>{t('Check your order request', 'अपना ऑर्डर अनुरोध जाँचें')}</Text>
        <Notice>
          {t(
            `This request is for ${money(pendingCheckout.totalPaise)}. Its result is not confirmed on this phone yet. Checking sends the same request and will not create a second order.`,
            `यह अनुरोध ${money(pendingCheckout.totalPaise)} का है। इसका परिणाम इस फ़ोन पर अभी पक्का नहीं है। जाँचने पर वही अनुरोध जाता है, दूसरा ऑर्डर नहीं बनेगा।`,
          )}
        </Notice>
        {Boolean(error) && <Notice error>{error}</Notice>}
        <Button secondary disabled={busy} onPress={() => navigate({ screen: 'Orders' })}>
          {t('View my orders', 'मेरे ऑर्डर देखें')}
        </Button>
      </Screen>
    );
  if (!cart.length && !review)
    return (
      <Screen>
        <Empty
          icon="basket-outline"
          title={t('Your basket is empty', 'आपकी टोकरी खाली है')}
          action={t('Browse materials', 'सामग्री देखें')}
          onAction={() => navigate({ screen: 'Products' })}
        />
      </Screen>
    );
  if (!addressId)
    return (
      <Screen>
        <Notice>
          {t('Add your site address to continue.', 'आगे बढ़ने के लिए साइट का पता जोड़ें।')}
        </Notice>
        <Button onPress={() => navigate({ screen: 'Addresses', id: 'new' })}>
          {t('Add address', 'पता जोड़ें')}
        </Button>
      </Screen>
    );
  const needsConsent = Boolean(review?.changes.length);
  return (
    <Screen
      footer={
        review ? (
          <>
            <Text style={[s.small, { textAlign: 'center' }]}>
              {review.paymentMethod === 'COD'
                ? t(
                    `You agree to pay ${money(review.totalPaise)} on delivery, including delivery charge.`,
                    `आप डिलीवरी पर ${money(review.totalPaise)} (डिलीवरी शुल्क सहित) देने को राज़ी हैं।`,
                  )
                : t(
                    `You will pay ${money(review.totalPaise)} online, including delivery.`,
                    `आप ${money(review.totalPaise)} (डिलीवरी सहित) ऑनलाइन देंगे।`,
                  )}
            </Text>
            <Button
              loading={busy}
              disabled={needsConsent && !accepted}
              onPress={() => void place()}
              icon="checkmark-circle"
            >
              {review.paymentMethod === 'COD'
                ? `${t('Place order', 'ऑर्डर करें')} · ${money(review.totalPaise)}`
                : `${t('Pay online', 'ऑनलाइन भुगतान')} · ${money(review.totalPaise)}`}
            </Button>
          </>
        ) : (
          <Button loading={busy} onPress={() => void getReview()}>
            {t('Check prices again', 'भाव फिर जाँचें')}
          </Button>
        )
      }
    >
      <Text style={s.h1} accessibilityRole="header">
        {t('Review your order', 'अपना ऑर्डर जाँचें')}
      </Text>
      {Boolean(error) && <Notice error>{error}</Notice>}
      {!review ? (
        busy ? (
          <View
            style={{ gap: space.sm }}
            accessibilityLabel={t('Checking prices', 'भाव जाँचे जा रहे हैं')}
          >
            <Bone height={120} />
            <Bone height={80} />
          </View>
        ) : null
      ) : (
        <>
          {needsConsent && (
            <View style={{ gap: space.sm }}>
              <Notice error>
                {t('Prices changed since you added these:', 'जोड़ने के बाद इनके भाव बदले हैं:')}
                {'\n'}
                {review.changes
                  .map((c) => `${c.name}: ${money(c.oldPricePaise)} → ${money(c.newPricePaise)}`)
                  .join('\n')}
              </Notice>
              <Pressable
                accessibilityRole="checkbox"
                aria-checked={accepted}
                accessibilityState={{ checked: accepted }}
                onPress={() => setAccepted(!accepted)}
                style={[s.row, { minHeight: 56 }]}
              >
                <Icon name={accepted ? 'checkbox' : 'square-outline'} color={C.accent} size={28} />
                <Text style={[s.body, { flex: 1, color: C.ink }]}>
                  {t(
                    `I accept the new prices and the total of ${money(review.totalPaise)}.`,
                    `मैं नए भाव और कुल ${money(review.totalPaise)} स्वीकार करता/करती हूँ।`,
                  )}
                </Text>
              </Pressable>
            </View>
          )}
          {/* The reviewed parchi: ruled lines, delivery on its own line, the total in big figures. */}
          <View>
            <View style={[s.paper, { paddingVertical: space.sm }]}>
              {review.items.map((i) => (
                <View style={[s.between, s.ruled, { paddingVertical: space.md }]} key={i.productId}>
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <Text style={[s.body, { color: C.ink, fontWeight: '700' }]}>{i.name}</Text>
                    <Text style={[s.small, { fontVariant: ['tabular-nums'] }]}>
                      {i.quantity} × {money(i.pricePaise)}
                    </Text>
                  </View>
                  <Text style={s.price}>{money(i.lineTotalPaise)}</Text>
                </View>
              ))}
              <View style={[s.between, s.ruled, { paddingVertical: space.sm }]}>
                <Text style={s.body}>{t('Materials', 'सामग्री')}</Text>
                <Text style={[s.body, { fontVariant: ['tabular-nums'] }]}>
                  {money(review.subtotalPaise)}
                </Text>
              </View>
              <View style={[s.between, s.ruled, { paddingVertical: space.sm }]}>
                <Text style={s.body}>{t('Delivery', 'डिलीवरी')}</Text>
                <Text style={[s.body, { fontVariant: ['tabular-nums'] }]}>
                  {money(review.deliveryFeePaise)}
                </Text>
              </View>
              <View style={[s.between, { paddingTop: space.md }]}>
                <Text style={s.h3}>{t('Total', 'कुल')}</Text>
                <Text style={s.priceBig} maxFontSizeMultiplier={1.5}>
                  {money(review.totalPaise)}
                </Text>
              </View>
              {review.paymentMethod === 'COD' && (
                <View style={{ alignItems: 'flex-end', paddingVertical: space.sm }}>
                  <CodStamp
                    label={t('Payment: cash on delivery', 'भुगतान: पहुँचने पर नकद')}
                    text={t('Cash on\ndelivery', 'नकद\nपहुँचने पर')}
                  />
                </View>
              )}
            </View>
            <TornEdge />
          </View>
          <View style={[s.card, { gap: space.xs }]}>
            <Text style={s.h3}>
              {dayLabel(review.deliveryDate, language)} · {review.address.label}
            </Text>
            <Text style={s.body}>
              {review.address.name} · {review.address.line1}, {review.address.area},{' '}
              {review.address.city} {review.address.pincode}
              {review.deliveryEstimate ? `\n${review.deliveryEstimate}` : ''}
              {'\n'}
              {review.paymentMethod === 'COD'
                ? t('Cash on delivery (cash or UPI)', 'डिलीवरी पर भुगतान (नकद या UPI)')
                : t('Online payment', 'ऑनलाइन भुगतान')}
            </Text>
            <Button
              kind="quiet"
              icon="create-outline"
              disabled={busy}
              onPress={() => navigate({ screen: 'Cart' })}
            >
              {t('Change delivery details', 'डिलीवरी विवरण बदलें')}
            </Button>
          </View>
          <Text style={[s.small, { textAlign: 'center' }]}>
            {t(
              'This review holds for 5 minutes. A new price change needs your approval again.',
              'यह समीक्षा 5 मिनट तक मान्य है। भाव फिर बदला तो आपकी मंज़ूरी फिर लगेगी।',
            )}
          </Text>
        </>
      )}
    </Screen>
  );
}
