'use client';
import { useEffect, useRef, useState } from 'react';
import { Order, Quote, User, money } from '@shiv/shared';
import { ArrowUpRight } from 'lucide-react';
import { api } from '../lib/api';
import { useWords } from '../lib/i18n';
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
  const { t, age } = useWords();
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
    if (
      dirty &&
      !window.confirm(t('Discard unsaved quotation edits?', 'बिना भेजे बदलाव हटाएँ?'))
    )
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
            <div className="row-between">
              <strong>
                {q.totalPaise === null ? t('Awaiting offer', 'भाव देना है') : money(q.totalPaise)}
              </strong>
              <small>{age(q.createdAt)}</small>
            </div>
            <button
              className="primary wide owner-next-action"
              aria-label={`${t('Open quote', 'भाव खोलें')} ${q.number}`}
              onClick={() => {
                setSelected(q);
                setDirty(false);
              }}
            >
              {q.order
                ? t('View order', 'ऑर्डर देखें')
                : q.status === 'ACCEPTED'
                  ? t('Prepare supply', 'सप्लाई तैयार करें')
                  : t('Review quote', 'भाव देखें')}
            </button>
            <div className="owner-actions">
              <a href={`tel:${q.address.phone}`}>{t('Call', 'फ़ोन')}</a>
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
              <th>{t('Request', 'अनुरोध')}</th>
              <th>{t('Customer / site', 'ग्राहक / साइट')}</th>
              <th>{t('Products', 'सामग्री')}</th>
              <th>{t('Quoted total', 'कुल भाव')}</th>
              <th>{t('Status', 'स्थिति')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id}>
                <td>
                  <strong>{q.number}</strong>
                  <small>
                    {t('Revision', 'संस्करण')} {q.revision} · {age(q.createdAt)}
                  </small>
                </td>
                <td>
                  <strong>{q.company || q.address.name}</strong>
                  <small>
                    {q.address.city} · {q.address.phone}
                  </small>
                </td>
                <td>
                  {t(`${q.items.length} products`, `${q.items.length} सामग्री`)}
                  <small>
                    {t(
                      `${q.items.reduce((s, i) => s + i.quantity, 0)} units requested`,
                      `${q.items.reduce((s, i) => s + i.quantity, 0)} इकाई माँगी`,
                    )}
                  </small>
                </td>
                <td>
                  {q.totalPaise === null ? t('Awaiting offer', 'भाव देना है') : money(q.totalPaise)}
                </td>
                <td>
                  <Badge value={q.status} />
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`${t('Open quote', 'भाव खोलें')} ${q.number}`}
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
          title={t('No bulk requests yet', 'अभी कोई थोक अनुरोध नहीं')}
          body={t(
            'Bulk requests from customers and contractors appear here.',
            'ग्राहकों और ठेकेदारों के थोक अनुरोध यहाँ दिखेंगे।',
          )}
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
          save={async (text = t('Quote sent to the customer', 'भाव ग्राहक को भेज दिया')) => {
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
  const { t, error: say } = useWords();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revising, setRevising] = useState(false);
  const [owners, setOwners] = useState<User[]>([]);
  useEffect(() => {
    void api<User[]>('/admin/owners')
      .then(setOwners)
      .catch((e) => setError(say(e)));
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
    const f = new FormData(e.currentTarget);
    const total =
      quote.items.reduce(
        (sum, i) => sum + Math.round(Number(f.get(i.productId)) * 100) * i.quantity,
        0,
      ) + Math.round(Number(f.get('delivery')) * 100);
    if (
      !window.confirm(
        t(
          `Send this quote for ${money(total)} to the customer?`,
          `${money(total)} का यह भाव ग्राहक को भेजें?`,
        ),
      )
    )
      return;
    saving.current = true;
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
        deliveryTerms: String(f.get('deliveryTerms') || ''),
      });
      await save();
    } catch (e) {
      setError(say(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function convert() {
    if (saving.current) return;
    if (
      !window.confirm(
        t(
          `Create a cash-on-delivery order for ${money(quote.totalPaise || 0)} at the agreed terms?`,
          `तय शर्तों पर ${money(quote.totalPaise || 0)} का डिलीवरी पर भुगतान वाला ऑर्डर बनाएँ?`,
        ),
      )
    )
      return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const order = await api<Order>(`/admin/quotes/${quote.id}/convert`, 'POST', {
        revision: quote.revision,
      });
      await save(t(`Order ${order.number} created`, `ऑर्डर ${order.number} बन गया`));
      window.location.hash = `orders?order=${encodeURIComponent(order.id)}`;
    } catch (e) {
      setError(say(e));
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
            {t(
              'This quote changed elsewhere. Your edits are kept; sending checks the revision. Close and reopen to see the latest terms.',
              'यह भाव कहीं और बदला है। आपके बदलाव सुरक्षित हैं; भेजते समय संस्करण जाँचा जाएगा। नई शर्तें देखने के लिए बंद करके फिर खोलें।',
            )}
          </p>
        )}
        <Badge value={quote.status} />
        {quote.work && (
          <section className="detail-block">
            <p>
              {t('Assigned', 'ज़िम्मेदारी')}:{' '}
              <strong>{quote.work.assignedTo?.name || t('Nobody yet', 'अभी किसी की नहीं')}</strong>
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
                    await save(t('Quotation acknowledged', 'ज़िम्मेदारी ली'));
                  } catch (e) {
                    setError(say(e));
                  } finally {
                    saving.current = false;
                    setBusy(false);
                  }
                }}
              >
                {t('Acknowledge quotation', 'ज़िम्मेदारी लें')}
              </button>
            )}
            {quote.work.lastError && (
              <AlertRetry workId={quote.work.id} attempts={quote.work.attempts} done={save} />
            )}
            <Field label={t('Assign owner', 'ज़िम्मेदारी बदलें')}>
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
                    await save(t('Quotation assigned', 'ज़िम्मेदारी बदली'));
                  } catch (e) {
                    setError(say(e));
                  } finally {
                    saving.current = false;
                    setBusy(false);
                  }
                }}
              >
                <option value="">{t('Choose owner', 'मालिक चुनें')}</option>
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
            {t('Supply order', 'सप्लाई ऑर्डर')}:{' '}
            <a href={`#orders?order=${encodeURIComponent(quote.order.id)}`}>{quote.order.number}</a>
          </p>
        )}
        {quote.status === 'ACCEPTED' && !quote.order && !revising && (
          <section className="form-stack">
            <p className="notice">
              {t(
                'The customer accepted this revision. Create one cash-on-delivery order at these agreed prices and freight; stock is checked again.',
                'ग्राहक ने यह भाव मंज़ूर किया है। इन्हीं तय भाव और भाड़े पर डिलीवरी पर भुगतान वाला एक ऑर्डर बनाएँ; स्टॉक फिर जाँचा जाएगा।',
              )}
            </p>
            <button
              type="button"
              className="primary wide"
              disabled={busy}
              onClick={() => void convert()}
            >
              {t('Create supply order', 'ऑर्डर बनाएँ')}
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
              {t('Revise terms for fresh consent', 'बात बदली है, नई मंज़ूरी लें')}
            </button>
          </section>
        )}
        {revising && (
          <p className="warning">
            {t(
              'Changing the date, prices or freight needs the customer’s fresh acceptance before an order is created.',
              'तारीख, भाव या भाड़ा बदलने पर ऑर्डर से पहले ग्राहक की नई मंज़ूरी ज़रूरी है।',
            )}
          </p>
        )}
        {quote.decisionSource && (
          <p>
            {t('Decision', 'फ़ैसला')}:{' '}
            {quote.decisionSource === 'CUSTOMER'
              ? t('Customer in the app', 'ग्राहक ने ऐप में')
              : t('Recorded by the store', 'दुकान ने दर्ज किया')}{' '}
            · {quote.decisionNote}
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
                        ? t(
                            'Record the customer’s acceptance of this quote?',
                            'ग्राहक की मंज़ूरी दर्ज करें?',
                          )
                        : t('Close this quote as rejected?', 'यह भाव अस्वीकार मानकर बंद करें?'),
                    )
                  )
                    return;
                  const note = window.prompt(
                    t(
                      'Record who confirmed, how, and when (required):',
                      'किसने, कैसे और कब पक्का किया लिखें (ज़रूरी):',
                    ),
                  );
                  if (!note?.trim()) return;
                  setBusy(true);
                  try {
                    await api(`/admin/quotes/${quote.id}/respond`, 'POST', {
                      revision: quote.revision,
                      status,
                      note,
                    });
                    await save(
                      status === 'ACCEPTED'
                        ? t('Customer acceptance recorded', 'ग्राहक की मंज़ूरी दर्ज हुई')
                        : t('Quote closed', 'भाव बंद हुआ'),
                    );
                  } catch (e) {
                    setError(say(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {status === 'ACCEPTED'
                  ? t('Record customer acceptance', 'ग्राहक की मंज़ूरी दर्ज करें')
                  : t('Close quote', 'भाव बंद करें')}
              </button>
            ))}
          </div>
        )}
        <div className="detail-block">
          <strong>{quote.company || quote.address.name}</strong>
          <p>
            {quote.address.line1}, {quote.address.area}, {quote.address.city}
            <br />
            {t('Delivery requested', 'चाही डिलीवरी')}: {quote.deliveryDate}
            {quote.address.landmark && (
              <>
                <br />
                {t('Landmark', 'पहचान')}: {quote.address.landmark}
              </>
            )}
          </p>
          <p>{quote.notes}</p>
          {quote.gstin && <small>GSTIN: {quote.gstin}</small>}
          <div className="owner-actions">
            <a href={`tel:${quote.address.phone}`}>
              {t('Call', 'फ़ोन')} {quote.address.phone}
            </a>
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
            label={`${i.name} · ${i.quantity} × ${i.unit}${i.packSize ? ` (${i.packSize})` : ''} · ${t('price per unit (₹)', 'इकाई का भाव (₹)')}`}
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
        <Field label={t('Agreed delivery date', 'डिलीवरी की तारीख')}>
          <input
            type="date"
            name="deliveryDate"
            required
            defaultValue={quote.deliveryDate}
            disabled={locked || busy}
          />
        </Field>
        <div className="form-grid">
          <Field label={t('Delivery charge (₹)', 'भाड़ा (₹)')}>
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
          <Field label={t('Valid until', 'कब तक मान्य')}>
            <input
              type="datetime-local"
              name="expiry"
              required
              disabled={locked || busy}
              defaultValue={localExpiry}
            />
          </Field>
        </div>
        <Field label={t('Delivery terms', 'डिलीवरी की शर्तें')}>
          <textarea
            name="deliveryTerms"
            defaultValue={quote.deliveryTerms || ''}
            maxLength={500}
            placeholder={t(
              'Unloading, floors, vehicle, number of trips…',
              'उतराई, मंज़िल, गाड़ी, कितने चक्कर…',
            )}
            disabled={locked || busy}
          />
        </Field>
        <Field label={t('Note to customer', 'ग्राहक के लिए संदेश')}>
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
            {t(
              'I checked the site, route, vehicle availability and agreed freight.',
              'मैंने स्थान, रास्ता, गाड़ी और भाड़ा जाँच लिया है।',
            )}
          </span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!locked ? (
          <button disabled={busy} className="primary wide">
            {busy
              ? t('Sending…', 'भेजा जा रहा है…')
              : quote.revision
                ? t('Send revised quote', 'बदला हुआ भाव भेजें')
                : t('Send quotation', 'भाव भेजें')}
          </button>
        ) : (
          <p className="notice">
            {quote.order
              ? t(
                  'This quotation has one linked supply order.',
                  'इस भाव का ऑर्डर बन चुका है।',
                )
              : t(
                  'Accepted terms are kept; revised terms need fresh consent.',
                  'मंज़ूर शर्तें सुरक्षित हैं; बदली शर्तों पर नई मंज़ूरी चाहिए।',
                )}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** Shown when the new-work alert could not be delivered; retries it now. */
export function AlertRetry({
  workId,
  attempts,
  done,
}: {
  workId: string;
  attempts: number;
  done: (text?: string) => Promise<void> | void;
}) {
  const { t, error: say } = useWords();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="warning">
      {t(`The alert did not go out (${attempts} tries).`, `अलर्ट नहीं पहुँचा (${attempts} बार कोशिश)।`)}{' '}
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await api(`/admin/work/${workId}/retry`, 'POST', {});
            await done(t('Alert sent again', 'अलर्ट फिर भेजा'));
          } catch (e) {
            setError(say(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('Retry alert', 'अलर्ट फिर भेजें')}
      </button>
      {error && <span role="alert"> {error}</span>}
    </div>
  );
}
