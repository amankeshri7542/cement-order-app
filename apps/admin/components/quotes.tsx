'use client';
import { useEffect, useRef, useState } from 'react';
import { Order, Quote, User, money } from '@shiv/shared';
import { ArrowUpRight } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { Badge, Empty, Field, Modal } from './ui';
export function Quotes({
  quotes,
  refresh,
  notice,
  onDirtyChange,
}: {
  quotes: Quote[];
  refresh: () => Promise<void>;
  notice: (s: string) => void;
  onDirtyChange: (value: boolean) => void;
}) {
  const [selected, setSelected] = useState<Quote | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const liveQuote = quotes.find((q) => q.id === selected?.id);
  const quote = dirty ? selected : liveQuote || selected;
  useEffect(() => {
    if (!dirty && liveQuote && liveQuote !== selected) setSelected(liveQuote);
  }, [dirty, liveQuote, selected]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const close = () => {
    if (dirty && !window.confirm('Discard unsaved quotation edits? / बिना भेजे बदलाव हटाएँ?'))
      return;
    setSelected(null);
    setDirty(false);
  };
  return (
    <>
      <div className="owner-order-cards">
        {quotes.map((q) => (
          <article className="owner-order-card" key={q.id}>
            <div className="row-between">
              <strong>{q.number}</strong>
              <Badge value={q.status} />
            </div>
            <h3>{q.company || q.address.name}</h3>
            <p>
              {q.address.area}, {q.address.city} · {q.deliveryDate}
            </p>
            <p>
              {q.items.map((item) => `${item.name}: ${item.quantity} ${item.unit}`).join(' · ')}
            </p>
            <strong>
              {q.totalPaise === null ? 'भाव देना है / Awaiting offer' : money(q.totalPaise)}
            </strong>
            <button
              className="primary wide owner-next-action"
              aria-label={`Open quote ${q.number}`}
              onClick={() => {
                setSelected(q);
                setDirty(false);
              }}
            >
              {q.order
                ? 'ऑर्डर देखें / View order'
                : q.status === 'ACCEPTED'
                  ? 'सप्लाई तैयार करें / Prepare supply'
                  : 'कोटेशन देखें / Review quote'}
            </button>
            <div className="owner-actions">
              <a href={`tel:${q.address.phone}`}>फ़ोन / Call</a>
              <a
                href={`https://wa.me/${(q.address.phone || '').replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp
              </a>
            </div>
          </article>
        ))}
      </div>
      <div className="panel table-wrap owner-order-table">
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
                    onClick={() => {
                      setSelected(q);
                      setDirty(false);
                    }}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!quotes.length && (
        <Empty
          title="Build bigger, together"
          body="Bulk requests from customers and contractors will appear here."
        />
      )}
      {quote && (
        <QuoteEditor
          key={`${quote.id}:${quote.revision}`}
          quote={quote}
          close={close}
          onDirty={() => {
            if (!dirty) setSelected(quote);
            setDirty(true);
          }}
          changed={
            dirty &&
            Boolean(
              liveQuote &&
              (liveQuote.revision !== quote.revision || liveQuote.status !== quote.status),
            )
          }
          save={async (text = 'Quote sent to the customer') => {
            await refresh();
            setSelected(null);
            setDirty(false);
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
  onDirty,
  changed,
}: {
  quote: Quote;
  close: () => void;
  save: (text?: string) => Promise<void>;
  onDirty: () => void;
  changed: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revising, setRevising] = useState(false);
  const [owners, setOwners] = useState<User[]>([]);
  useEffect(() => {
    void api<User[]>('/admin/owners')
      .then(setOwners)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const saving = useRef(false);
  const locked = Boolean(quote.order) || (quote.status === 'ACCEPTED' && !revising);
  const expiry = new Date(quote.validUntil ?? Date.now() + 7 * 86400000);
  const localExpiry = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api(`/admin/quotes/${quote.id}/offer`, 'POST', {
        expectedRevision: quote.revision,
        deliveryConfirmed: f.get('deliveryConfirmed') === 'on',
        deliveryDate: String(f.get('deliveryDate')),
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
      saving.current = false;
      setBusy(false);
    }
  }
  async function convert() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const order = await api<Order>(`/admin/quotes/${quote.id}/convert`, 'POST', {
        revision: quote.revision,
      });
      await save(`ऑर्डर बन गया / Order ${order.number} created`);
      window.location.hash = `orders?order=${encodeURIComponent(order.id)}`;
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title={quote.number} close={close}>
      <form className="form-stack" onSubmit={submit} onChange={onDirty}>
        {changed && (
          <p className="warning">
            यह कोटेशन कहीं और बदला है। आपके बदलाव सुरक्षित हैं; भेजते समय पुरानी आवृत्ति की जाँच
            होगी। / This quote changed elsewhere. Your edits are preserved; saving checks the
            revision. Close and reopen to review the latest terms.
          </p>
        )}
        <Badge value={quote.status} />
        {quote.work && (
          <section className="detail-block">
            <p>
              ज़िम्मेदारी / Assigned: <strong>{quote.work.assignedTo?.name || 'Unassigned'}</strong>
            </p>
            {!quote.work.acknowledgedAt && (
              <button
                type="button"
                className="primary wide"
                disabled={busy}
                onClick={async () => {
                  if (saving.current) return;
                  saving.current = true;
                  setBusy(true);
                  setError('');
                  try {
                    await api(`/admin/quotes/${quote.id}/acknowledge`, 'POST', {});
                    await save('ज़िम्मेदारी ली / Quotation acknowledged');
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    saving.current = false;
                    setBusy(false);
                  }
                }}
              >
                ज़िम्मेदारी लें / Acknowledge quotation
              </button>
            )}
            {quote.work.lastError && (
              <p className="warning">
                सूचना नहीं पहुँची / Alert failed. Attempts: {quote.work.attempts}
              </p>
            )}
            <Field label="ज़िम्मेदारी बदलें / Assign owner">
              <select
                defaultValue=""
                disabled={busy}
                onChange={async (e) => {
                  if (!e.target.value || saving.current) return;
                  saving.current = true;
                  setBusy(true);
                  try {
                    await api(`/admin/work/${quote.work!.id}/assign`, 'POST', {
                      ownerId: e.target.value,
                    });
                    await save('ज़िम्मेदारी बदली / Quotation assigned');
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    saving.current = false;
                    setBusy(false);
                  }
                }}
              >
                <option value="">Choose owner</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name || owner.phone}
                  </option>
                ))}
              </select>
            </Field>
          </section>
        )}
        {quote.order && (
          <p className="notice">
            सप्लाई ऑर्डर / Supply order:{' '}
            <a href={`#orders?order=${encodeURIComponent(quote.order.id)}`}>{quote.order.number}</a>
          </p>
        )}
        {quote.status === 'ACCEPTED' && !quote.order && !revising && (
          <section className="form-stack">
            <p className="notice">
              ग्राहक ने यह भाव मंज़ूर किया है। / The customer accepted this revision. Create one
              cash-on-delivery order at these agreed prices and freight. Availability is checked
              again.
            </p>
            <button
              type="button"
              className="primary wide"
              disabled={busy}
              onClick={() => void convert()}
            >
              ऑर्डर बनाएँ / Create supply order
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                onDirty();
                setRevising(true);
              }}
            >
              बात बदली है / Revise terms for fresh consent
            </button>
          </section>
        )}
        {revising && (
          <p className="warning">
            तारीख, भाव या भाड़ा बदलने पर ग्राहक की नई मंज़ूरी ज़रूरी है। / Send a revised offer and
            obtain fresh customer acceptance before creating an order.
          </p>
        )}
        {quote.decisionSource && (
          <p>
            Decision:{' '}
            {quote.decisionSource === 'CUSTOMER' ? 'Customer in app' : 'Recorded by store'} ·{' '}
            {quote.decisionNote}
          </p>
        )}
        {quote.status === 'SENT' && !quote.order && (
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
                  const note = window.prompt('Record who confirmed, how, and when (required):');
                  if (!note?.trim()) return;
                  setBusy(true);
                  try {
                    await api(`/admin/quotes/${quote.id}/respond`, 'POST', {
                      revision: quote.revision,
                      status,
                      note,
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
            {quote.address.landmark && (
              <>
                <br />
                पहचान / Landmark: {quote.address.landmark}
              </>
            )}
          </p>
          <p>{quote.notes}</p>
          {quote.gstin && <small>GSTIN: {quote.gstin}</small>}
          <div className="owner-actions">
            <a href={`tel:${quote.address.phone}`}>फ़ोन / Call {quote.address.phone}</a>
            <a
              href={`https://wa.me/${quote.address.phone.replace(/\D/g, '')}`}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
          </div>
        </div>
        {quote.items.map((i) => (
          <Field
            key={i.productId}
            label={`${i.name} · ${i.quantity} × ${i.unit}${i.packSize ? ` (${i.packSize})` : ''} · price per unit (₹)`}
          >
            <input
              name={i.productId}
              type="number"
              required
              min="0.01"
              step="0.01"
              defaultValue={i.unitPricePaise === null ? '' : i.unitPricePaise / 100}
              disabled={locked || busy}
            />
          </Field>
        ))}
        <Field label="डिलीवरी की तारीख / Agreed delivery date">
          <input
            type="date"
            name="deliveryDate"
            required
            defaultValue={quote.deliveryDate}
            disabled={locked || busy}
          />
        </Field>
        <div className="form-grid">
          <Field label="Delivery charge (₹)">
            <input
              name="delivery"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={quote.deliveryFeePaise / 100}
              disabled={locked || busy}
            />
          </Field>
          <Field label="Valid until">
            <input
              type="datetime-local"
              name="expiry"
              required
              disabled={locked || busy}
              defaultValue={localExpiry}
            />
          </Field>
        </div>
        <Field label="Note to customer">
          <textarea
            name="note"
            defaultValue={quote.adminNote}
            maxLength={1500}
            disabled={locked || busy}
          />
        </Field>
        <label className="field">
          <span>
            <input
              type="checkbox"
              name="deliveryConfirmed"
              required
              defaultChecked={quote.deliveryConfirmed}
              disabled={locked || busy}
            />{' '}
            मैंने स्थान, रास्ता, गाड़ी और भाड़ा जाँच लिया है। / I checked the site, route, vehicle
            availability and agreed freight.
          </span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!locked ? (
          <button disabled={busy} className="primary wide">
            {busy ? 'Sending…' : quote.revision ? 'Send revised quote' : 'Send quotation'}
          </button>
        ) : (
          <p className="notice">
            {quote.order
              ? 'इस कोटेशन का ऑर्डर बन चुका है। / This quotation has one linked supply order.'
              : 'मंज़ूर भाव सुरक्षित हैं। / Accepted terms are preserved; revised terms require fresh consent.'}
          </p>
        )}
      </form>
    </Modal>
  );
}
