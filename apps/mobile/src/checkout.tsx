import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckoutReview, Order, money } from '@shiv/shared';
import { makeKey, useStore } from './store';
import { ApiError, api, message } from './api';
import { Button, C, Empty, Field, Icon, Notice, Section, s } from './ui';
import { Quantity } from './catalog';
import { payOnline } from './payment';
export function Cart() {
  const { cart, cartBusy, t, navigate, setQuantity } = useStore();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function change(id: string, quantity: number) {
    setBusy(id);
    setError('');
    try {
      await setQuantity(id, quantity);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  }
  if (!cart.length)
    return (
      <Empty
        icon="bag-outline"
        title={t('emptyCart')}
        body="Add your materials and we’ll help get them to your site."
        action={t('browse')}
        onAction={() => navigate({ screen: 'Products' })}
      />
    );
  return (
    <View style={s.stack}>
      <Text style={s.title}>{t('cart')}</Text>
      <Text style={s.body}>
        {cart.reduce((total, line) => total + line.quantity, 0)} items · {cart.length}{' '}
        {cart.length === 1 ? 'product' : 'products'} · Prices confirmed at checkout
      </Text>
      {cart.map((c) => (
        <View key={c.productId} style={s.card}>
          <View style={s.between}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>
                {c.product.name}
              </Text>
              <Text style={[s.body, { marginTop: 5 }]}>
                {c.product.unit} · {money(c.product.pricePaise)} each
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${c.product.name}`}
              disabled={Boolean(busy) || cartBusy}
              onPress={() => void change(c.productId, 0)}
              style={{ padding: 12 }}
            >
              <Icon name="trash-outline" size={20} color="#8393a0" />
            </Pressable>
          </View>
          <View style={[s.between, { marginTop: 18 }]}>
            <Quantity
              value={c.quantity}
              min={c.product.minQuantity}
              step={c.product.quantityStep}
              max={Math.min(10000, c.product.stock)}
              disabled={Boolean(busy) || cartBusy}
              commitOnBlur
              onInvalid={setError}
              change={(n) => void change(c.productId, n)}
            />
            <Text style={s.price}>{money(c.product.pricePaise * c.quantity)}</Text>
          </View>
          {(!c.product.active || c.quantity > c.product.stock) && (
            <View style={{ marginTop: 12 }}>
              <Notice error>Update the quantity or remove this unavailable product.</Notice>
            </View>
          )}
        </View>
      ))}
      {Boolean(error) && <Notice error>{error}</Notice>}
      <Notice>
        The store will confirm today’s prices, stock and delivery fee before you place your order.
      </Notice>
      <Button
        disabled={Boolean(busy) || cartBusy}
        onPress={() => navigate({ screen: 'Checkout' })}
        icon="arrow-forward"
      >
        {t('checkout')}
      </Button>
    </View>
  );
}
export function Checkout() {
  const {
    addresses,
    cart,
    settings,
    user,
    t,
    navigate,
    refreshAccount,
    refreshCatalog,
    setToast,
    checkoutDraft,
    updateCheckoutDraft,
    pendingCheckout,
    savePendingCheckout,
    rememberOrder,
    draftsLoading,
    openAddresses,
  } = useStore();
  const { date, notes, paymentMethod } = checkoutDraft;
  const addressId = addresses.some((address) => address.id === checkoutDraft.addressId)
    ? checkoutDraft.addressId
    : addresses[0]?.id || '';
  const setAddressId = (value: string) => updateCheckoutDraft({ addressId: value });
  const setDate = (value: string) => updateCheckoutDraft({ date: value });
  const setNotes = (value: string) => updateCheckoutDraft({ notes: value });
  const setPayment = (value: 'COD' | 'ONLINE') => updateCheckoutDraft({ paymentMethod: value });
  const [review, setReview] = useState<CheckoutReview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const reviewing = useRef(false);
  async function getReview() {
    if (reviewing.current || submitting.current) return;
    reviewing.current = true;
    setBusy(true);
    setError('');
    setAccepted(false);
    try {
      setReview(
        await api<CheckoutReview>('/checkout/review', 'POST', {
          addressId,
          deliveryDate: date,
          notes,
          paymentMethod,
        }),
      );
    } catch (e) {
      setReview(null);
      setError(message(e));
    } finally {
      reviewing.current = false;
      setBusy(false);
    }
  }
  async function place() {
    if (submitting.current || (!pendingCheckout && (!review || !accepted))) return;
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
          'Order received. The saved request could not be cleared; retrying it returns this same order.',
        ),
      );
      void refreshAccount().catch(() =>
        setToast('Order received. Cart refresh is temporarily unavailable.'),
      );
      void refreshCatalog();
      if (submission.paymentMethod === 'ONLINE' && order.status === 'PENDING_PAYMENT') {
        try {
          const result = await payOnline(order.id, user!.phone);
          setToast(result.message);
        } catch (e) {
          setToast(message(e));
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
        setError(message(e));
      } else {
        setError(
          `We could not confirm the result. Check this same request before placing another order. ${message(e)}`,
        );
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (draftsLoading) return <Text style={s.body}>Restoring your checkout…</Text>;
  if (pendingCheckout)
    return (
      <View style={s.stack}>
        <Text style={s.title}>Check your order request</Text>
        <Notice>
          This checkout is for {money(pendingCheckout.totalPaise)}. Its result is not confirmed on
          this device yet. Retrying checks the same request and will not create a second order.
        </Notice>
        {Boolean(error) && <Notice error>{error}</Notice>}
        <Button loading={busy} onPress={() => void place()}>
          Check order result
        </Button>
        <Button secondary disabled={busy} onPress={() => navigate({ screen: 'Orders' })}>
          View my orders
        </Button>
      </View>
    );
  if (!cart.length && !review)
    return (
      <Empty
        title={t('emptyCart')}
        body="Add materials before checkout."
        action={t('browse')}
        onAction={() => navigate({ screen: 'Products' })}
      />
    );
  return (
    <View style={s.stack}>
      <Text style={s.title}>{review ? t('review') : t('checkout')}</Text>
      <View style={ch.steps}>
        {['Address', 'Delivery', 'Review & pay'].map((x, i) => (
          <View key={x} style={s.row}>
            <View style={[ch.stepDot, { backgroundColor: review || i < 2 ? C.navy : '#dce4eb' }]}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{i + 1}</Text>
            </View>
            <Text style={{ color: C.muted, fontSize: 11 }}>{x}</Text>
          </View>
        ))}
      </View>
      {!review ? (
        <>
          <Section
            title={t('address')}
            action={busy ? undefined : '+ Add new'}
            onAction={() => openAddresses()}
          />
          {!addresses.length ? (
            <Notice>Save your site or delivery address to continue.</Notice>
          ) : (
            addresses.map((a) => (
              <Pressable
                key={a.id}
                accessibilityRole="radio"
                aria-checked={addressId === a.id}
                accessibilityState={{ checked: addressId === a.id, disabled: busy }}
                disabled={busy}
                onPress={() => setAddressId(a.id)}
                style={[
                  s.card,
                  s.row,
                  addressId === a.id && { borderColor: C.navy, borderWidth: 2 },
                ]}
              >
                <Icon
                  name={addressId === a.id ? 'radio-button-on' : 'radio-button-off'}
                  color={C.navy}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: C.ink, marginBottom: 5 }}>
                    {a.label} · {a.name}
                  </Text>
                  <Text style={s.body}>
                    {a.line1}, {a.area}, {a.city} {a.pincode}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${a.label} address`}
                  disabled={busy}
                  onPress={() => openAddresses(a.id)}
                  style={{ padding: 12 }}
                >
                  <Icon name="create-outline" />
                </Pressable>
              </Pressable>
            ))
          )}
          <Field
            label={`${t('deliveryDate')} (YYYY-MM-DD)`}
            value={date}
            editable={!busy}
            onChangeText={setDate}
            placeholder="2026-10-03"
            maxLength={10}
          />
          <Field
            label={t('notes')}
            value={notes}
            editable={!busy}
            onChangeText={setNotes}
            multiline
            maxLength={500}
            placeholder="Site access, unloading instructions, landmark…"
          />
          <Text style={s.h2}>Payment method</Text>
          <Pressable
            accessibilityRole="radio"
            aria-checked={paymentMethod === 'COD'}
            accessibilityState={{ checked: paymentMethod === 'COD', disabled: busy }}
            disabled={busy}
            onPress={() => {
              if (!reviewing.current && !submitting.current) setPayment('COD');
            }}
            style={[s.card, s.row]}
          >
            <Icon name={paymentMethod === 'COD' ? 'radio-button-on' : 'radio-button-off'} />
            <View>
              <Text style={{ fontWeight: '600', color: C.ink }}>{t('cod')}</Text>
              <Text style={s.body}>Pay when your materials arrive.</Text>
            </View>
          </Pressable>
          {settings?.onlinePaymentsAvailable && (
            <Pressable
              accessibilityRole="radio"
              aria-checked={paymentMethod === 'ONLINE'}
              accessibilityState={{ checked: paymentMethod === 'ONLINE', disabled: busy }}
              disabled={busy}
              onPress={() => {
                if (!reviewing.current && !submitting.current) setPayment('ONLINE');
              }}
              style={[s.card, s.row]}
            >
              <Icon name={paymentMethod === 'ONLINE' ? 'radio-button-on' : 'radio-button-off'} />
              <View>
                <Text style={{ fontWeight: '600', color: C.ink }}>UPI, cards & netbanking</Text>
                <Text style={s.body}>Secure checkout by Razorpay</Text>
              </View>
            </Pressable>
          )}
          {Boolean(error) && <Notice error>{error}</Notice>}
          <Button
            disabled={!addressId}
            loading={busy}
            onPress={() => void getReview()}
            icon="arrow-forward"
          >
            {t('review')}
          </Button>
        </>
      ) : (
        <>
          {!!review.changes.length && (
            <Notice>
              Prices changed since you added these products:{'\n'}
              {review.changes
                .map((c) => `${c.name}: ${money(c.oldPricePaise)} → ${money(c.newPricePaise)}`)
                .join('\n')}
              {'\n'}Review and accept the updated total below.
            </Notice>
          )}
          <View style={[s.card, s.stack]}>
            {review.items.map((i) => (
              <View style={s.between} key={i.productId}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.ink, fontWeight: '600' }}>{i.name}</Text>
                  <Text style={s.body}>
                    {i.quantity} × {money(i.pricePaise)}
                  </Text>
                </View>
                <Text style={{ fontWeight: '600', color: C.ink }}>{money(i.lineTotalPaise)}</Text>
              </View>
            ))}
            <View style={s.divider} />
            <View style={s.between}>
              <Text style={s.body}>{t('subtotal')}</Text>
              <Text style={s.body}>{money(review.subtotalPaise)}</Text>
            </View>
            <View style={s.between}>
              <Text style={s.body}>{t('delivery')}</Text>
              <Text style={s.body}>{money(review.deliveryFeePaise)}</Text>
            </View>
            <View style={s.divider} />
            <View style={s.between}>
              <Text style={s.h2}>{t('total')}</Text>
              <Text style={s.price}>{money(review.totalPaise)}</Text>
            </View>
          </View>
          <View style={s.card}>
            <Text style={{ color: C.ink, fontWeight: '700', marginBottom: 7 }}>
              {review.address.name}
            </Text>
            <Text style={s.body}>
              {review.address.line1}, {review.address.area}, {review.address.city}{' '}
              {review.address.pincode}
              {'\n'}Delivery: {review.deliveryDate}
              {'\n'}
              {review.deliveryEstimate}
              {'\n'}
              {review.paymentMethod === 'COD' ? t('cod') : 'Razorpay online payment'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="checkbox"
            aria-checked={accepted}
            accessibilityState={{ checked: accepted }}
            onPress={() => setAccepted(!accepted)}
            style={[s.row, { paddingVertical: 10 }]}
          >
            <Icon name={accepted ? 'checkbox' : 'square-outline'} color={C.navy} size={25} />
            <Text style={[s.body, { flex: 1, color: C.ink }]}>
              I have reviewed and agree to pay {money(review.totalPaise)}, including delivery.
            </Text>
          </Pressable>
          {Boolean(error) && <Notice error>{error}</Notice>}
          <Button loading={busy} disabled={!accepted} onPress={() => void place()} icon="checkmark">
            {review.paymentMethod === 'COD'
              ? t('place')
              : `${t('pay')} · ${money(review.totalPaise)}`}
          </Button>
          <Button
            secondary
            disabled={busy}
            onPress={() => {
              setReview(null);
              setAccepted(false);
            }}
          >
            Edit delivery details
          </Button>
          <Text style={[s.body, { fontSize: 11, textAlign: 'center' }]}>
            This review is valid for 5 minutes. Any new price change requires your approval again.
          </Text>
        </>
      )}
    </View>
  );
}
const ch = StyleSheet.create({
  steps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 17,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
