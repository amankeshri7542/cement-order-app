'use client';
import { useState } from 'react';
import { Quote, money } from '@shiv/shared';
import { ArrowUpRight } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Badge, Empty, Field, Modal } from './ui';
export function Quotes({
  quotes,
  refresh,
  notice,
}: {
  quotes: Quote[];
  refresh: () => Promise<void>;
  notice: (s: string) => void;
}) {
  const [id, setId] = useState<string | null>(null);
  const quote = quotes.find((q) => q.id === id);
  return (
    <>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Customer / site</th>
              <th>Products</th>
              <th>Quoted total</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id}>
                <td>
                  <strong>{q.number}</strong>
                  <small>Revision {q.revision}</small>
                </td>
                <td>
                  <strong>{q.company || q.address.name}</strong>
                  <small>
                    {q.address.city} · {q.address.phone}
                  </small>
                </td>
                <td>
                  {q.items.length} products
                  <small>{q.items.reduce((s, i) => s + i.quantity, 0)} units requested</small>
                </td>
                <td>{q.totalPaise === null ? 'Awaiting offer' : money(q.totalPaise)}</td>
                <td>
                  <Badge value={q.status} />
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Open quote ${q.number}`}
                    onClick={() => setId(q.id)}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!quotes.length && (
          <Empty
            title="Build bigger, together"
            body="Bulk requests from customers and contractors will appear here."
          />
        )}
      </div>
      {quote && (
        <QuoteEditor
          key={`${quote.id}:${quote.revision}`}
          quote={quote}
          close={() => setId(null)}
          save={async (text = 'Quote sent to the customer') => {
            await refresh();
            setId(null);
            notice(text);
          }}
        />
      )}
    </>
  );
}
function QuoteEditor({
  quote,
  close,
  save,
}: {
  quote: Quote;
  close: () => void;
  save: (text?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api(`/admin/quotes/${quote.id}/offer`, 'POST', {
        expectedRevision: quote.revision,
        items: quote.items.map((i) => ({
          productId: i.productId,
          unitPricePaise: Math.round(Number(f.get(i.productId)) * 100),
        })),
        deliveryFeePaise: Math.round(Number(f.get('delivery')) * 100),
        validUntil: new Date(String(f.get('expiry'))).toISOString(),
        note: String(f.get('note')),
      });
      await save();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={quote.number} close={close}>
      <form className="form-stack" onSubmit={submit}>
        <Badge value={quote.status} />
        {quote.status === 'SENT' && (
          <div className="button-row">
            {(['ACCEPTED', 'REJECTED'] as const).map((status) => (
              <button
                type="button"
                key={status}
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      status === 'ACCEPTED'
                        ? 'Record the customer’s acceptance of this quote?'
                        : 'Close this quote as rejected?',
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    await api(`/admin/quotes/${quote.id}/respond`, 'POST', {
                      revision: quote.revision,
                      status,
                    });
                    await save(
                      status === 'ACCEPTED' ? 'Customer acceptance recorded' : 'Quote closed',
                    );
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {status === 'ACCEPTED' ? 'Record customer acceptance' : 'Close quote'}
              </button>
            ))}
          </div>
        )}
        <div className="detail-block">
          <strong>{quote.company || quote.address.name}</strong>
          <p>
            {quote.address.line1}, {quote.address.area}, {quote.address.city}
            <br />
            Delivery requested: {quote.deliveryDate}
          </p>
          <p>{quote.notes}</p>
          {quote.gstin && <small>GSTIN: {quote.gstin}</small>}
          <a href={`tel:${quote.address.phone}`}>{quote.address.phone}</a>
        </div>
        {quote.items.map((i) => (
          <Field
            key={i.productId}
            label={`${i.name} · ${i.quantity} × ${i.unit} · price per unit (₹)`}
          >
            <input
              name={i.productId}
              type="number"
              required
              min="0.01"
              step="0.01"
              defaultValue={i.unitPricePaise === null ? '' : i.unitPricePaise / 100}
              disabled={quote.status === 'ACCEPTED'}
            />
          </Field>
        ))}
        <div className="form-grid">
          <Field label="Delivery charge (₹)">
            <input
              name="delivery"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={quote.deliveryFeePaise / 100}
              disabled={quote.status === 'ACCEPTED'}
            />
          </Field>
          <Field label="Valid until">
            <input
              type="datetime-local"
              name="expiry"
              required
              disabled={quote.status === 'ACCEPTED'}
              defaultValue={new Date(
                Date.now() + 7 * 86400000 - new Date().getTimezoneOffset() * 60000,
              )
                .toISOString()
                .slice(0, 16)}
            />
          </Field>
        </div>
        <Field label="Note to customer">
          <textarea
            name="note"
            defaultValue={quote.adminNote}
            maxLength={1500}
            disabled={quote.status === 'ACCEPTED'}
          />
        </Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {quote.status !== 'ACCEPTED' ? (
          <button disabled={busy} className="primary wide">
            {busy ? 'Sending…' : quote.revision ? 'Send revised quote' : 'Send quotation'}
          </button>
        ) : (
          <p className="notice">
            Accepted. Contact the customer to arrange supply and payment. Accepted quotes cannot be
            edited.
          </p>
        )}
      </form>
    </Modal>
  );
}
