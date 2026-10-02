'use client';
import { useState } from 'react';
import { StoreSettings } from '@shiv/shared';
import { Phone, Truck, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Field } from './ui';
export function Settings({
  settings,
  refresh,
  notice,
}: {
  settings: StoreSettings;
  refresh: () => Promise<void>;
  notice: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      await api('/admin/store', 'PATCH', {
        expectedVersion: settings.version,
        phone: `+91${String(f.get('phone')).replace(/^\+91/, '')}`,
        deliveryFeePaise: Math.round(Number(f.get('fee')) * 100),
        freeDeliveryAbovePaise: f.get('free') ? Math.round(Number(f.get('free')) * 100) : null,
        onlinePaymentsEnabled: f.get('online') === 'on',
        deliveryMessage: String(f.get('message')),
      });
      await refresh();
      notice('Store and finance settings saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="settings-layout" onSubmit={submit}>
      <div className="form-stack">
        <section className="panel padded">
          <h2>
            <Phone size={21} />
            Store details
          </h2>
          <p className="muted">The details customers see when they need you.</p>
          <Field label="Store name">
            <input value="Shiv Cement Store" readOnly />
          </Field>
          <Field label="Contact and WhatsApp number">
            <input
              name="phone"
              type="tel"
              required
              pattern="(\+91)?[6-9][0-9]{9}"
              defaultValue={settings.phone.replace(/^\+91/, '')}
            />
          </Field>
          <Field label="Delivery information for customers">
            <textarea
              name="message"
              defaultValue={settings.deliveryMessage}
              required
              maxLength={250}
            />
          </Field>
        </section>
        <section className="panel padded">
          <h2>
            <Truck size={21} />
            Delivery & finance
          </h2>
          <p className="muted">Your delivery area is Patna and the rest of Bihar.</p>
          <div className="form-grid">
            <Field label="Flat delivery charge (₹)">
              <input
                name="fee"
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                required
                defaultValue={settings.deliveryFeePaise / 100}
              />
            </Field>
            <Field label="Free delivery above (₹)">
              <input
                name="free"
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                defaultValue={
                  settings.freeDeliveryAbovePaise === null
                    ? ''
                    : settings.freeDeliveryAbovePaise / 100
                }
                placeholder="Leave empty to disable"
              />
            </Field>
          </div>
          <p className="hint">
            Applied to new checkouts. Existing orders keep their agreed delivery charge. You can
            quote a different charge for each bulk request.
          </p>
        </section>
        <section className="panel padded">
          <h2>
            <ShieldCheck size={21} />
            Payments
          </h2>
          <label className="check">
            <input type="checkbox" checked readOnly />
            Cash on delivery
          </label>
          <label className="check">
            <input type="checkbox" name="online" defaultChecked={settings.onlinePaymentsEnabled} />
            Enable Razorpay online payments
          </label>
          <p className="hint">
            Online payments can only be enabled after the backend credentials and webhook secret are
            configured.
          </p>
        </section>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
      <aside className="finance-note">
        <span className="eyebrow">YOU’RE IN CONTROL</span>
        <h2>
          Clear prices.
          <br />
          No surprises.
        </h2>
        <p>
          Every delivery-fee change is recorded. Customers see the complete total before they place
          an order.
        </p>
        <hr />
        <p>
          For orders with special delivery requirements, send a bulk quotation with a custom
          delivery charge.
        </p>
      </aside>
    </form>
  );
}
