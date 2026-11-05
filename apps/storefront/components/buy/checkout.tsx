'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CheckoutReview, Order } from '@shiv/shared';
import { deliveryDateOptions } from '@shiv/shared/src/dates';
import { isCheckoutRefusal } from '@shiv/shared/src/errors';
import { isPendingOrder } from '../../lib/guards';
import { useCommerce, saved, persist } from './commerce';
import { AccountRequired, AddressBook } from './account';
import { customerApi, CustomerError } from '../../lib/customer-api';
import { dayLabel, price } from '../../lib/display';
import { useLiveRefresh } from './live';
import { list } from '../../lib/list-store';
const language = 'en' as const;

type Pending = { reviewId: string; idempotencyKey: string };
export function CheckoutPage() {
  return (
    <AccountRequired>
      <Checkout />
    </AccountRequired>
  );
}
function Checkout() {
  const c = useCommerce();
  const router = useRouter();
  const id = c.user!.id;
  const [addressId, setAddress] = useState('');
  // Tomorrow in Patna: between 00:00 and 05:30 IST the UTC date is still yesterday there.
  const [date, setDate] = useState(() => deliveryDateOptions(new Date(), 1, 1)[0]!);
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
  // Only a catalogue, price or store change drops the review; returning to the tab keeps it.
  useLiveRefresh(invalidate, { messagesOnly: true });
  useEffect(() => {
    invalidate();
    setLoaded(false);
    const draft = saved<{ addressId?: string; date?: string; notes?: string }>(
      `shiv_checkout_${id}`,
    );
    setAddress(draft?.addressId || '');
    if (draft?.date) setDate(draft.date);
    setNotes(draft?.notes || '');
    const found = saved<unknown>(`shiv_pending_order_${id}`);
    setPending(isPendingOrder(found) ? found : null);
    setLoaded(true);
  }, [id]);
  useEffect(() => {
    if (loaded)
      try {
        persist(`shiv_checkout_${id}`, { addressId, date, notes });
      } catch {
        c.setError('Could not save your draft on this device.');
      }
  }, [addressId, date, notes, loaded, id, c.setError]);
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
      // The order is placed once; the same lines must not sit on the list to be sent again.
      list.clear();
      if (!current()) return;
      setPending(null);
      await c.refresh().catch((error) => {
        if (current()) c.showError(error);
      });
      if (!current()) return;
      // Replace, so Back from the confirmation does not return to an emptied checkout.
      router.replace(`/orders/${encodeURIComponent(order.id)}?confirmed=1`);
    } catch (e) {
      if (!current()) return;
      if (e instanceof CustomerError && isCheckoutRefusal(e.code)) {
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
        <h1>Every detail, before you order.</h1>
        <p>Pay on delivery. Online payments are unavailable.</p>
      </div>
      {pending ? (
        <section className="recovery-panel" role="status">
          <h2>Recover your order result.</h2>
          <p>
            A submission is saved on this device. Recover its result before starting another order.
            Retrying uses the same request and cannot create a second order.
          </p>
          <button className="button" disabled={busy || !loaded} onClick={() => void place(true)}>
            {busy ? 'Recovering…' : 'Recover order result'}
          </button>
          <Link className="text-link" href="/orders">
            Check order history
          </Link>
        </section>
      ) : (
        <div className="purchase-layout">
          <div>
            <AddressBook selected={addressId} onSelect={setAddress} onChange={invalidate} />
            <div className="form-grid">
              <label>
                Requested delivery date
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
                Delivery notes (optional)
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
              The displayed delivery estimate applies. Contact the shop for special site access
              arrangements.
            </p>
            <button
              className="button"
              disabled={!loaded || !addressId || busy || c.busy}
              aria-describedby={loaded && !addressId ? 'review-needs-address' : undefined}
              onClick={() => void getReview()}
            >
              {busy ? 'Checking current terms…' : 'Review current order'}
            </button>
            {loaded && !addressId ? (
              <p id="review-needs-address" className="field-hint">
                Choose or add a delivery address first.
              </p>
            ) : null}
          </div>
          <aside className="order-summary">
            {review ? (
              <>
                <h2>Check, then confirm.</h2>
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
                  {dayLabel(review.deliveryDate, language)} · {review.deliveryEstimate}
                </p>
                {review.notes && <p>{review.notes}</p>}
                <dl className="review-totals">
                  <div>
                    <dt>Materials</dt>
                    <dd>{price(review.subtotalPaise)}</dd>
                  </div>
                  <div>
                    <dt>Delivery</dt>
                    <dd>{price(review.deliveryFeePaise)}</dd>
                  </div>
                  <div className="review-total">
                    <dt>Pay on delivery</dt>
                    <dd>{price(review.totalPaise)}</dd>
                  </div>
                </dl>
                {review.changes.length > 0 && (
                  <div className="notice" role="status">
                    Prices changed since these items were added. Review each new price.
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
                  I accept these materials, quantities, prices, address and delivery terms. Payment
                  is due on delivery.
                </label>
                <button className="button" disabled={!consent || busy} onClick={() => void place()}>
                  {busy ? 'Confirming…' : 'Place COD order'}
                </button>
                <small>Valid for five minutes. Any change requires another review.</small>
              </>
            ) : (
              <>
                <h2>No surprises at the doorstep.</h2>
                <p>
                  Choose your address, then get the latest product and delivery terms from the shop
                  before confirming.
                </p>
                <Link className="text-link" href="/list">
                  ← Back to your list
                </Link>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
