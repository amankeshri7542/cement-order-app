'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useWords } from '../lib/i18n';
import { Field } from './ui';

type Status = {
  pendingCod: number;
  pendingQuotes: number;
  overdueCod: number;
  warnings: { createdAt: string; entityId: string }[];
};
export function SecurityControls() {
  const { t, error: say } = useWords();
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void api<Status>('/admin/security-status')
      .then(setStatus)
      .catch((e) => setMessage(say(e)));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener('shiv-owner-refresh', load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('shiv-owner-refresh', load);
    };
  }, [load]);
  return (
    <section className="panel operations-panel">
      <h2>{t('Booking limits', 'बुकिंग सुरक्षा')}</h2>
      {status && (
        <p>
          {t(
            `Awaiting review: ${status.pendingCod} COD orders, ${status.pendingQuotes} quotes. ${status.overdueCod} COD orders are over two hours old.`,
            `जाँच बाकी: ${status.pendingCod} COD ऑर्डर, ${status.pendingQuotes} भाव। ${status.overdueCod} COD ऑर्डर दो घंटे से पुराने हैं।`,
          )}
        </p>
      )}
      {!!status?.warnings.length && (
        <p role="alert">
          {t('Usage approaching a limit', 'सेवा सीमा पास है')}:{' '}
          {status.warnings.map((w) => w.entityId).join(', ')}.{' '}
          {t('Contact the technical operator.', 'तकनीकी व्यक्ति से बात करें।')}
        </p>
      )}
      <p>
        {t(
          'Talk to the customer first. Handle large bookings by acknowledging existing work or sending a bulk quote. An exception allows one request within 30 minutes; it does not change stock, prices or payment rules.',
          'पहले ग्राहक से बात करें। बड़ी बुकिंग ज़िम्मेदारी लेकर या थोक भाव देकर सँभालें। छूट से 30 मिनट में एक अनुरोध हो सकता है; स्टॉक, भाव या भुगतान के नियम नहीं बदलते।',
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const form = e.currentTarget,
            data = new FormData(form);
          setBusy(true);
          setMessage('');
          try {
            await api('/admin/demand-overrides', 'POST', {
              phone: `+91${String(data.get('phone'))}`,
              kind: data.get('kind'),
              maxTotalPaise: Math.round(Number(data.get('amount')) * 100),
              reason: data.get('reason'),
            });
            form.reset();
            setMessage(t('One request approved for 30 minutes.', 'एक अनुरोध मंज़ूर — 30 मिनट।'));
            load();
          } catch (error) {
            setMessage(say(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t('Customer mobile', 'ग्राहक का मोबाइल')}>
          <input name="phone" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} required />
        </Field>
        <Field label={t('Request', 'अनुरोध')}>
          <select name="kind">
            <option value="ORDER">{t('COD order', 'COD ऑर्डर')}</option>
            <option value="QUOTE">{t('Quote', 'थोक भाव')}</option>
          </select>
        </Field>
        <Field label={t('Maximum COD total (₹)', 'अधिकतम COD रकम (₹)')}>
          <input name="amount" type="number" min="0" max="1000000" step="0.01" required />
        </Field>
        <Field label={t('Reason', 'क्यों मंज़ूर है')}>
          <input name="reason" minLength={10} maxLength={300} required />
        </Field>
        <label className="check">
          <input type="checkbox" required />{' '}
          {t('I checked the customer and demand.', 'मैंने ग्राहक और माँग जाँची है।')}
        </label>
        <button className="primary" disabled={busy}>
          {t('Allow once', 'एक बार अनुमति दें')}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
