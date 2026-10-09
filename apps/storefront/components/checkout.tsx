'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CheckoutReview, Order } from '@shiv/shared';
import { placeOrderSchema } from '@shiv/shared';
import { useCommerce, saved, persist } from './commerce';
import { AccountRequired, AddressBook } from './account';
import { customerApi, CustomerError } from '../lib/customer-api';
import { price } from '../lib/catalog';
import { useLanguage } from './language';
import { useLiveRefresh } from './live';

type Pending = { reviewId: string; idempotencyKey: string };
const rejected = new Set([
  'PRICE_CHANGED',
  'OUT_OF_STOCK',
  'REVIEW_EXPIRED',
  'CART_CHANGED',
  'PAYMENTS_UNAVAILABLE',
  'INVALID_DELIVERY_DATE',
  'EMPTY_CART',
  'INVALID_ADDRESS',
  'DELIVERY_CHANGED',
  'DELIVERY_UNAVAILABLE',
  'MINIMUM_ORDER',
  'NOT_SERVICEABLE',
  'DELIVERY_MINIMUM',
  'INVALID_QUANTITY',
]);
export function CheckoutPage() {
  return (
    <AccountRequired>
      <Checkout />
    </AccountRequired>
  );
}
function Checkout() {
  const c = useCommerce();
  const { t } = useLanguage();
  const router = useRouter();
  const id = c.user!.id;
  const [addressId, setAddress] = useState('');
  const [date, setDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [review, setReview] = useState<CheckoutReview | null>(null);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && c.currentAccount() === id;
  const working = useRef(false);
  const revision = useRef(0);
  function invalidate() {
    revision.current++;
    setReview(null);
    setConsent(false);
  }
  useLiveRefresh(invalidate);
  useEffect(() => {
    invalidate();
    setLoaded(false);
    const draft = saved<{ addressId?: string; date?: string; notes?: string }>(
      `shiv_checkout_${id}`,
    );
    setAddress(draft?.addressId || '');
    if (draft?.date) setDate(draft.date);
    setNotes(draft?.notes || '');
    const found = placeOrderSchema.safeParse(saved(`shiv_pending_order_${id}`));
    setPending(found.success ? found.data : null);
    setLoaded(true);
  }, [id]);
  useEffect(() => {
    if (loaded)
      try {
        persist(`shiv_checkout_${id}`, { addressId, date, notes });
      } catch {
        c.setError(
          t('Could not save your draft on this device.', 'इस उपकरण पर ड्राफ़्ट नहीं सहेज सके।'),
        );
      }
  }, [addressId, date, notes, loaded, id, c.setError, t]);
  async function getReview() {
    if (working.current || pending) return;
    working.current = true;
    setBusy(true);
    invalidate();
    c.setError('');
    const epoch = revision.current;
    try {
      await c.refresh();
      if (!current()) return;
      const next = await customerApi<CheckoutReview>(
        '/checkout/review',
        'POST',
        { addressId, deliveryDate: date, notes, paymentMethod: 'COD' },
        id,
      );
      if (current() && epoch === revision.current) setReview(next);
    } catch (e) {
      if (current()) c.showError(e);
    } finally {
      working.current = false;
      if (current()) setBusy(false);
    }
  }
  async function place(recover = false) {
    if (working.current || (!recover && (!review || !consent))) return;
    const request =
      pending || (review ? { reviewId: review.id, idempotencyKey: crypto.randomUUID() } : null);
    if (!request) return;
    working.current = true;
    setBusy(true);
    c.setError('');
    try {
      persist(`shiv_pending_order_${id}`, request);
      setPending(request);
      const order = await customerApi<Order>('/orders', 'POST', request, id);
      if (!order || typeof order.id !== 'string' || typeof order.number !== 'string')
        throw new CustomerError('NETWORK_ERROR', 'Could not confirm the saved order response.');
      persist(`shiv_pending_order_${id}`, null);
      persist(`shiv_checkout_${id}`, null);
      if (!current()) return;
      setPending(null);
      await c.refresh().catch((error) => {
        if (current()) c.showError(error);
      });
      if (!current()) return;
      router.push(`/orders/${encodeURIComponent(order.id)}?confirmed=1`);
    } catch (e) {
      if (!current()) return;
      if (e instanceof CustomerError && rejected.has(e.code)) {
        persist(`shiv_pending_order_${id}`, null);
        setPending(null);
        invalidate();
      }
      c.showError(e);
    } finally {
      working.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <div className="commerce-page">
      <div className="page-heading">
        <p className="eyebrow">{t('DELIVERY & PAYMENT', 'डिलीवरी और भुगतान')}</p>
        <h1>{t('Every detail, before you order.', 'ऑर्डर से पहले हर जानकारी।')}</h1>
        <p>
          {t(
            'Pay on delivery. Online payments are unavailable.',
            'डिलीवरी पर भुगतान करें। ऑनलाइन भुगतान उपलब्ध नहीं है।',
          )}
        </p>
      </div>
      {pending ? (
        <section className="recovery-panel" role="status">
          <h2>{t('Recover your order result.', 'ऑर्डर का परिणाम वापस पाएँ।')}</h2>
          <p>
            {t(
              'A submission is saved on this device. Recover its result before starting another order. Retrying uses the same request and cannot create a second order.',
              'इस उपकरण पर अनुरोध सहेजा है। नया ऑर्डर शुरू करने से पहले परिणाम वापस पाएँ। फिर कोशिश में वही अनुरोध जाता है; दूसरा ऑर्डर नहीं बनता।',
            )}
          </p>
          <button className="button" disabled={busy || !loaded} onClick={() => void place(true)}>
            {busy
              ? t('Recovering…', 'वापस ला रहे हैं…')
              : t('Recover order result', 'ऑर्डर परिणाम वापस पाएँ')}
          </button>
          <Link className="text-link" href="/orders">
            {t('Check order history', 'ऑर्डर इतिहास जाँचें')}
          </Link>
        </section>
      ) : (
        <div className="purchase-layout">
          <div>
            <AddressBook selected={addressId} onSelect={setAddress} onChange={invalidate} />
            <div className="form-grid">
              <label>
                {t('Requested delivery date', 'चाही गई डिलीवरी तारीख')}
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    invalidate();
                  }}
                />
              </label>
              <label>
                {t('Delivery notes (optional)', 'डिलीवरी निर्देश (वैकल्पिक)')}
                <textarea
                  maxLength={500}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    invalidate();
                  }}
                />
              </label>
            </div>
            <p>
              {t(
                'The displayed delivery estimate applies. Contact the shop for special site access arrangements.',
                'दिखाई गई डिलीवरी अवधि लागू है। जगह तक पहुँच की विशेष व्यवस्था के लिए दुकान से बात करें।',
              )}
            </p>
            <button
              className="button"
              disabled={!loaded || !addressId || busy || c.busy || c.mergePending}
              onClick={() => void getReview()}
            >
              {busy
                ? t('Checking current terms…', 'मौजूदा शर्तें जाँच रहे हैं…')
                : t('Review current order', 'मौजूदा ऑर्डर जाँचें')}
            </button>
          </div>
          <aside className="order-summary">
            {review ? (
              <>
                <p className="eyebrow">{t('FRESH CHECKOUT REVIEW', 'चेकआउट की नई जाँच')}</p>
                <h2>{price(review.totalPaise)}</h2>
                <ul className="review-items">
                  {review.items.map((item) => (
                    <li key={item.productId}>
                      <strong>{item.name}</strong>
                      <span>
                        {item.quantity} {item.unit} · {item.packSize}
                      </span>
                      <span>
                        {price(item.pricePaise)} / {item.unit} · {price(item.lineTotalPaise)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p>
                  {review.address.name}
                  <br />
                  {review.address.line1}, {review.address.area}, {review.address.city}{' '}
                  {review.address.pincode}
                  <br />
                  {review.address.phone}
                </p>
                <p>
                  {review.deliveryDate} · {review.deliveryEstimate}
                </p>
                {review.notes && <p>{review.notes}</p>}
                <p>
                  {t('Materials', 'सामग्री')}: {price(review.subtotalPaise)}
                  <br />
                  {t('Delivery', 'डिलीवरी')}: {price(review.deliveryFeePaise)}
                </p>
                {review.changes.length > 0 && (
                  <div className="notice" role="status">
                    {t(
                      'Prices changed since these items were added. Review each new price.',
                      'सामग्री जोड़ने के बाद कीमतें बदली हैं। हर नई कीमत जाँचें।',
                    )}
                    {review.changes.map((item) => (
                      <p key={item.name}>
                        {item.name}: {price(item.oldPricePaise)} → {price(item.newPricePaise)}
                      </p>
                    ))}
                  </div>
                )}
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  {t(
                    'I accept these materials, quantities, prices, address and delivery terms. Payment is due on delivery.',
                    'मैं सामग्री, मात्रा, कीमत, पता और डिलीवरी की शर्तें स्वीकार करता/करती हूँ। भुगतान डिलीवरी पर होगा।',
                  )}
                </label>
                <button className="button" disabled={!consent || busy} onClick={() => void place()}>
                  {busy
                    ? t('Confirming…', 'पुष्टि हो रही है…')
                    : t('Place COD order', 'COD ऑर्डर करें')}
                </button>
                <small>
                  {t(
                    'Valid for five minutes. Any change requires another review.',
                    'पाँच मिनट तक मान्य। बदलाव पर फिर जाँच ज़रूरी है।',
                  )}
                </small>
              </>
            ) : (
              <>
                <h2>{t('No surprises at the doorstep.', 'डिलीवरी से पहले कीमत साफ।')}</h2>
                <p>
                  {t(
                    'Choose your address, then get the latest product and delivery terms from the shop before confirming.',
                    'पता चुनें, फिर पुष्टि से पहले दुकान से सामग्री और डिलीवरी की ताज़ा शर्तें पाएँ।',
                  )}
                </p>
                <Link className="text-link" href="/cart">
                  ← {t('Back to basket', 'टोकरी पर वापस')}
                </Link>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
