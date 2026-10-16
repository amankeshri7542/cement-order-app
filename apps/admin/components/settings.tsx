'use client';
import { useState } from 'react';
import { StoreSettings } from '@shiv/shared';
import { Phone, Truck, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useWords } from '../lib/i18n';
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
  const { t, error: say } = useWords();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The form keeps the version it was filled from. Another owner's save shows a notice instead
  // of wiping edits in progress; saving still checks the version.
  const [base, setBase] = useState(settings);
  const [dirty, setDirty] = useState(false);
  if (!dirty && base.version !== settings.version) setBase(settings);
  const changed = dirty && base.version !== settings.version;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      await api('/admin/store', 'PATCH', {
        expectedVersion: base.version,
        phone: `+91${String(f.get('phone')).replace(/^\+91/, '')}`,
        deliveryFeePaise: base.deliveryFeePaise,
        freeDeliveryAbovePaise: base.freeDeliveryAbovePaise,
        onlinePaymentsEnabled: f.get('online') === 'on',
        deliveryMessage: String(f.get('message')),
      });
      setDirty(false);
      await refresh();
      notice(t('Store and finance settings saved', 'दुकान की सेटिंग सहेजी'));
    } catch (err) {
      setError(say(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      key={base.version}
      className="settings-layout"
      onSubmit={submit}
      onChange={() => setDirty(true)}
    >
      <div className="form-stack">
        {changed && (
          <p className="warning" role="status">
            {t(
              'These settings were changed elsewhere. Your edits are kept; saving checks for the change.',
              'यह सेटिंग कहीं और बदली गई है। आपके बदलाव सुरक्षित हैं; सहेजते समय बदलाव जाँचा जाएगा।',
            )}{' '}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setBase(settings);
                setDirty(false);
                setError('');
              }}
            >
              {t('Reload latest settings', 'नई सेटिंग दिखाएँ')}
            </button>
          </p>
        )}
        <section className="panel padded">
          <h2>
            <Phone size={21} />
            {t('Store details', 'दुकान की जानकारी')}
          </h2>
          <p className="muted">
            {t('The details customers see when they need you.', 'ग्राहकों को दिखने वाली जानकारी।')}
          </p>
          <Field label={t('Store name', 'दुकान का नाम')}>
            <input value="Shiv Cement Store" readOnly />
          </Field>
          <Field label={t('Contact and WhatsApp number', 'फ़ोन और WhatsApp नंबर')}>
            <input
              name="phone"
              type="tel"
              required
              pattern="(\+91)?[6-9][0-9]{9}"
              defaultValue={base.phone.replace(/^\+91/, '')}
            />
          </Field>
          <Field label={t('Delivery information for customers', 'ग्राहकों के लिए डिलीवरी जानकारी')}>
            <textarea name="message" defaultValue={base.deliveryMessage} required maxLength={250} />
          </Field>
        </section>
        <section className="panel padded">
          <h2>
            <Truck size={21} />
            {t('Delivery & finance', 'डिलीवरी और भाड़ा')}
          </h2>
          <p className="hint">
            {t(
              'Set charges, minimum orders, free-delivery limits, estimates and terms in Delivery areas. Existing orders keep the charge accepted at checkout. Bulk quotes can use a separate agreed transport charge.',
              'भाड़ा, कम से कम ऑर्डर, मुफ़्त डिलीवरी, समय और शर्तें "डिलीवरी क्षेत्र" में तय करें। पुराने ऑर्डर का भाड़ा नहीं बदलता। थोक भाव में अलग भाड़ा लगा सकते हैं।',
            )}
          </p>
        </section>
        <section className="panel padded">
          <h2>
            <ShieldCheck size={21} />
            {t('Payments', 'भुगतान')}
          </h2>
          <label className="check">
            <input type="checkbox" checked readOnly />
            {t('Cash or UPI on delivery', 'डिलीवरी पर नकद या UPI')}
          </label>
          <label className="check">
            <input type="checkbox" name="online" defaultChecked={base.onlinePaymentsEnabled} />
            {t('Enable Razorpay online payments', 'Razorpay ऑनलाइन भुगतान चालू करें')}
          </label>
          <p className="hint">
            {t(
              'Online payments work only after the technical operator sets up the payment account.',
              'ऑनलाइन भुगतान तभी चलेगा जब तकनीकी व्यक्ति पेमेंट खाता जोड़ दे।',
            )}
          </p>
        </section>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? t('Saving…', 'सहेज रहे हैं…') : t('Save settings', 'सेटिंग सहेजें')}
        </button>
      </div>
      <aside className="finance-note">
        <span className="eyebrow">{t('YOU’RE IN CONTROL', 'फ़ैसला आपका')}</span>
        <h2>{t('Clear prices. No surprises.', 'साफ़ भाव। कोई छुपा ख़र्च नहीं।')}</h2>
        <p>
          {t(
            'Every delivery-fee change is recorded. Customers see the complete total before they place an order.',
            'भाड़े का हर बदलाव दर्ज होता है। ग्राहक ऑर्डर से पहले पूरा कुल देखते हैं।',
          )}
        </p>
        <hr />
        <p>
          {t(
            'For orders with special delivery needs, send a bulk quote with a custom delivery charge.',
            'ख़ास डिलीवरी वाले ऑर्डर के लिए अलग भाड़े के साथ थोक भाव भेजें।',
          )}
        </p>
      </aside>
    </form>
  );
}
