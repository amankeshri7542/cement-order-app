'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { Field } from './ui';

type Status = {
  pendingCod: number;
  pendingQuotes: number;
  overdueCod: number;
  warnings: { createdAt: string; entityId: string }[];
};
export function SecurityControls() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void api<Status>('/admin/security-status')
      .then(setStatus)
      .catch((e) => setMessage(errorMessage(e)));
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
      <h2>बुकिंग सुरक्षा / Booking limits</h2>
      {status && (
        <p>
          जाँच बाकी / Awaiting review: {status.pendingCod} COD, {status.pendingQuotes} quotations.{' '}
          {status.overdueCod} COD requests are over two hours old.
        </p>
      )}
      {!!status?.warnings.length && (
        <p role="alert">
          सेवा सीमा पास है / Usage approaching a limit:{' '}
          {status.warnings.map((w) => w.entityId).join(', ')}. Contact the technical operator.
        </p>
      )}
      <p>
        पहले ग्राहक से बात करें। ज़िम्मेदारी लेने या थोक भाव देने से बड़ी बुकिंग सँभालें। / Review
        existing work or use a wholesale quotation. An exception allows one request within 30
        minutes; it does not change stock, prices or payment rules.
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
            setMessage('एक अनुरोध मंज़ूर — 30 मिनट। / One request approved for 30 minutes.');
            load();
          } catch (error) {
            setMessage(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="ग्राहक का मोबाइल / Customer mobile">
          <input name="phone" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} required />
        </Field>
        <Field label="अनुरोध / Request">
          <select name="kind">
            <option value="ORDER">COD order</option>
            <option value="QUOTE">Quotation</option>
          </select>
        </Field>
        <Field label="अधिकतम COD रकम ₹ / Maximum COD total">
          <input name="amount" type="number" min="0" max="1000000" step="0.01" required />
        </Field>
        <Field label="क्यों मंज़ूर है / Reason">
          <input name="reason" minLength={10} maxLength={300} required />
        </Field>
        <label className="check">
          <input type="checkbox" required /> मैंने ग्राहक और माँग जाँची है। / I checked the customer
          and demand.
        </label>
        <button className="primary" disabled={busy}>
          एक बार अनुमति दें / Allow once
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
