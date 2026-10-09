'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Page, Quote } from '@shiv/shared';
import { quoteRequestSchema } from '@shiv/shared';
import { z } from 'zod';
import { useCommerce, Quantity, saved, persist } from './commerce';
import { AccountRequired, AddressBook } from './account';
import { customerApi, CustomerError } from '../lib/customer-api';
import { price } from '../lib/catalog';
import { useLanguage } from './language';

const draftSchema = z.object({
  addressId: z.string(),
  date: z.string(),
  company: z.string().max(150),
  gstin: z.string().max(15),
  notes: z.string().max(1500),
});

export function QuotationsPage() {
  const c = useCommerce();
  const { t } = useLanguage();
  return (
    <div className="commerce-page">
      <div className="page-heading">
        <p className="eyebrow">
          {t('FOR YOUR SITE · BULK REQUIREMENTS', 'आपकी साइट के लिए · थोक ज़रूरतें')}
        </p>
        <h1>{t('One list. A considered offer.', 'एक सूची। सोच-समझकर दिया भाव।')}</h1>
        <p>
          {t(
            'Bring your material list together. The shop will prepare a written offer with prices, freight and delivery terms.',
            'सामग्री की सूची तैयार करें। दुकान कीमत, ढुलाई और डिलीवरी शर्तों के साथ लिखित प्रस्ताव बनाएगी।',
          )}
        </p>
      </div>
      <section className="quote-builder">
        <div className="section-heading">
          <h2>{t('Your quotation list', 'आपकी भाव सूची')}</h2>
          <Link className="text-link" href="/products">
            {t('Add materials +', 'सामग्री जोड़ें +')}
          </Link>
        </div>
        {c.quote?.lines.length ? (
          c.quote.lines.map(({ product, quantity }) => (
            <article className="quote-line" key={product.id}>
              <div>
                <h3>{product.name}</h3>
                <p>
                  {product.brand} · {product.grade} · {product.packSize || product.unit}
                </p>
                <p>
                  {t('Catalogue estimate', 'सूची का अनुमान')}: {price(product.pricePaise)} /{' '}
                  {product.unit}
                </p>
              </div>
              <Quantity
                value={quantity}
                product={product}
                max={100000}
                onChange={(value) => c.quoteQuantity(product, value)}
              />
              <button className="text-link" onClick={() => c.quoteQuantity(product, 0)}>
                {t('Remove', 'हटाएँ')}
              </button>
            </article>
          ))
        ) : (
          <p>
            {t(
              'Use “Add to quote” on a material to start your list. Enquiries can include quantities beyond current stock.',
              'सूची शुरू करने के लिए सामग्री पर “भाव सूची में जोड़ें” चुनें। पूछताछ में मौजूदा स्टॉक से ज़्यादा मात्रा रख सकते हैं।',
            )}
          </p>
        )}
      </section>
      <AccountRequired>
        <QuoteAccount />
      </AccountRequired>
    </div>
  );
}
function QuoteAccount() {
  const c = useCommerce();
  const { t, language } = useLanguage();
  const id = c.user!.id;
  const [addressId, setAddress] = useState('');
  const [date, setDate] = useState(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [company, setCompany] = useState('');
  const [gstin, setGstin] = useState('');
  const [notes, setNotes] = useState('');
  const [loadedDraft, setLoadedDraft] = useState(false);
  const [pending, setPending] = useState<z.infer<typeof quoteRequestSchema> | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consents, setConsents] = useState<Record<string, number>>({});
  const epoch = useRef(0);
  const locked = useRef(false);
  const load = useCallback(
    async (after?: string) => {
      const current = ++epoch.current;
      try {
        const data = await customerApi<Page<Quote>>(
          `/quotes?limit=24${after ? `&cursor=${encodeURIComponent(after)}` : ''}`,
          'GET',
          undefined,
          id,
        );
        if (current === epoch.current) {
          setQuotes((old) =>
            after
              ? [...old, ...data.items.filter((item) => !old.some((prev) => prev.id === item.id))]
              : data.items,
          );
          setCursor(data.nextCursor);
          setConsents({});
        }
      } catch (e) {
        if (current === epoch.current) c.showError(e);
      }
    },
    [id, c.showError],
  );
  useEffect(() => {
    const draft = draftSchema.safeParse(saved(`shiv_quote_draft_${id}`));
    if (draft.success) {
      setAddress(draft.data.addressId);
      setDate(draft.data.date);
      setCompany(draft.data.company);
      setGstin(draft.data.gstin);
      setNotes(draft.data.notes);
    }
    setLoadedDraft(true);
    const found = quoteRequestSchema.safeParse(saved(`shiv_pending_quote_${id}`));
    setPending(found.success ? found.data : null);
    setQuotes([]);
    void load();
    const focus = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = setInterval(focus, 20000);
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      epoch.current++;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [id, load]);
  useEffect(() => {
    if (!loadedDraft) return;
    try {
      persist(`shiv_quote_draft_${id}`, { addressId, date, company, gstin, notes });
    } catch (error) {
      c.showError(error);
    }
  }, [id, loadedDraft, addressId, date, company, gstin, notes, c.showError]);
  async function submit() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    c.setError('');
    try {
      const request =
        pending ||
        quoteRequestSchema.parse({
          idempotencyKey: crypto.randomUUID(),
          items:
            c.quote?.lines.map(({ product, quantity }) => ({ productId: product.id, quantity })) ||
            [],
          addressId,
          deliveryDate: date,
          company,
          gstin,
          notes,
        });
      persist(`shiv_pending_quote_${id}`, request);
      const intentKey = pending ? saved<string>(`shiv_pending_quote_intent_${id}`) : c.quote?.key;
      if (!pending && intentKey) persist(`shiv_pending_quote_intent_${id}`, intentKey);
      setPending(request);
      const quote = await customerApi<Quote>('/quotes', 'POST', request, id);
      if (!quote || typeof quote.id !== 'string' || typeof quote.number !== 'string')
        throw new CustomerError('NETWORK_ERROR', 'Could not confirm the saved quotation response.');
      persist(`shiv_pending_quote_${id}`, null);
      persist(`shiv_pending_quote_intent_${id}`, null);
      if (c.currentAccount() !== id) return;
      setPending(null);
      if (intentKey) c.clearQuote(intentKey);
      c.setMessage(t(`Quotation saved: ${quote.number}`, `भाव अनुरोध सहेजा: ${quote.number}`));
      await load();
    } catch (e) {
      if (c.currentAccount() !== id) return;
      if (
        e instanceof CustomerError &&
        [400, 404, 409, 422].includes(e.status) &&
        !['IDEMPOTENCY_CONFLICT', 'ACCOUNT_CHANGED'].includes(e.code)
      ) {
        persist(`shiv_pending_quote_${id}`, null);
        setPending(null);
      }
      c.showError(e);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function respond(quote: Quote, status: 'ACCEPTED' | 'REJECTED') {
    if (locked.current || (status === 'ACCEPTED' && consents[quote.id] !== quote.revision)) return;
    if (
      status === 'REJECTED' &&
      !window.confirm(t('Reject this offer revision?', 'प्रस्ताव का यह संस्करण अस्वीकार करें?'))
    )
      return;
    locked.current = true;
    setBusy(true);
    try {
      await customerApi(
        `/quotes/${quote.id}/respond`,
        'POST',
        { revision: quote.revision, status },
        id,
      );
      if (c.currentAccount() !== id) return;
      await load();
    } catch (e) {
      if (c.currentAccount() !== id) return;
      c.showError(e);
      await load();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const labels: Record<string, [string, string]> = {
    REQUESTED: ['Requested · awaiting shop', 'अनुरोध · दुकान का जवाब बाकी'],
    SENT: ['Offer ready for review', 'प्रस्ताव जाँच के लिए तैयार'],
    ACCEPTED: ['Accepted · awaiting conversion', 'स्वीकार · ऑर्डर बनना बाकी'],
    REJECTED: ['Rejected', 'अस्वीकार'],
    EXPIRED: ['Expired', 'समय समाप्त'],
  };
  return (
    <>
      {pending ? (
        <div className="recovery-panel">
          <h2>{t('Recover your quotation request.', 'भाव अनुरोध वापस पाएँ।')}</h2>
          <p>
            {t(
              'The saved submission is frozen. Retry it to recover the shop reference; changes to your new list are not included.',
              'सहेजा अनुरोध तय है। दुकान का संदर्भ पाने के लिए फिर कोशिश करें; नई सूची के बदलाव इसमें शामिल नहीं होंगे।',
            )}
          </p>
          <ul>
            {pending.items.map((item) => (
              <li key={item.productId}>
                {item.productId} · {item.quantity}
              </li>
            ))}
          </ul>
          <button className="button" disabled={busy} onClick={() => void submit()}>
            {t('Recover quotation result', 'भाव का परिणाम वापस पाएँ')}
          </button>
        </div>
      ) : c.quote?.lines.length ? (
        <div className="quote-request">
          <AddressBook selected={addressId} onSelect={setAddress} />
          <div className="form-grid">
            <label>
              {t('Requested delivery date', 'चाही गई डिलीवरी तारीख')}
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              {t('Company (optional)', 'कंपनी (वैकल्पिक)')}
              <input maxLength={150} value={company} onChange={(e) => setCompany(e.target.value)} />
            </label>
            <label>
              {t('GSTIN (optional)', 'GSTIN (वैकल्पिक)')}
              <input
                maxLength={15}
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              {t('Site requirements (optional)', 'साइट की ज़रूरत (वैकल्पिक)')}
              <textarea maxLength={1500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <p>
            {t(
              'This sends an enquiry, not an order. No stock is reserved and no payment is taken.',
              'यह पूछताछ है, ऑर्डर नहीं। स्टॉक आरक्षित या भुगतान नहीं लिया जाता।',
            )}
          </p>
          <button className="button" disabled={!addressId || busy} onClick={() => void submit()}>
            {busy
              ? t('Saving request…', 'अनुरोध सहेज रहे हैं…')
              : t('Request written quotation', 'लिखित भाव माँगें')}
          </button>
        </div>
      ) : null}
      <section className="quote-history">
        <div className="section-heading">
          <h2>{t('Your requests & offers', 'आपके अनुरोध और प्रस्ताव')}</h2>
          <button className="text-link" disabled={busy} onClick={() => void load()}>
            {t('Refresh offers', 'प्रस्ताव अपडेट करें')}
          </button>
        </div>
        {!quotes.length && (
          <p>
            {t(
              'Your saved requests and shop offers will appear here.',
              'आपके सहेजे अनुरोध और दुकान के प्रस्ताव यहाँ दिखेंगे।',
            )}
          </p>
        )}
        {quotes.map((quote) => {
          const expired =
            quote.status === 'SENT' &&
            quote.validUntil &&
            new Date(quote.validUntil).getTime() <= Date.now();
          const status = expired ? 'EXPIRED' : quote.status;
          return (
            <article className="order-record" key={quote.id}>
              <div className="section-heading">
                <div>
                  <h2>{quote.number}</h2>
                  <p>
                    {t('Revision', 'संस्करण')} {quote.revision}
                  </p>
                </div>
                <span className="status-badge">
                  {labels[status] ? t(...labels[status]) : status}
                </span>
              </div>
              <ul className="review-items">
                {quote.items.map((item) => (
                  <li key={item.productId}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.quantity} {item.unit} · {item.packSize}
                    </span>
                    <span>
                      {item.unitPricePaise === null
                        ? t('Shop price pending', 'दुकान का भाव बाकी')
                        : `${price(item.unitPricePaise)} / ${item.unit} · ${price(item.unitPricePaise * item.quantity)}`}
                    </span>
                  </li>
                ))}
              </ul>
              <p>
                {quote.address.line1}, {quote.address.area}, {quote.address.city}{' '}
                {quote.address.pincode}
              </p>
              <p>
                {t('Requested delivery', 'चाही डिलीवरी')}: {quote.deliveryDate} ·{' '}
                {quote.deliveryConfirmed
                  ? t('Delivery terms confirmed by shop', 'दुकान ने डिलीवरी शर्तें पुष्ट कीं')
                  : t('Delivery terms awaiting confirmation', 'डिलीवरी शर्तों की पुष्टि बाकी')}
              </p>
              {quote.totalPaise !== null && (
                <p>
                  <strong className="total-price">{price(quote.totalPaise)}</strong> ·{' '}
                  {t('Freight included', 'शामिल ढुलाई')}: {price(quote.deliveryFeePaise)}
                </p>
              )}
              {quote.validUntil && (
                <p>
                  {t('Offer valid until', 'प्रस्ताव की अंतिम तारीख')}:{' '}
                  {new Date(quote.validUntil).toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN')}
                </p>
              )}
              {quote.adminNote && <p>{quote.adminNote}</p>}
              {status === 'SENT' && (
                <>
                  <label className="choice">
                    <input
                      type="checkbox"
                      checked={consents[quote.id] === quote.revision}
                      onChange={(e) =>
                        setConsents({
                          ...consents,
                          [quote.id]: e.target.checked ? quote.revision : 0,
                        })
                      }
                    />
                    {t(
                      'I reviewed this revision’s items, unit prices, freight, delivery assumptions, expiry and total.',
                      'मैंने इस संस्करण की सामग्री, इकाई कीमत, ढुलाई, डिलीवरी मान्यताएँ, समय और कुल राशि जाँच ली है।',
                    )}
                  </label>
                  <div className="action-row">
                    <button
                      className="button"
                      disabled={busy || consents[quote.id] !== quote.revision}
                      onClick={() => void respond(quote, 'ACCEPTED')}
                    >
                      {t('Accept this revision', 'यह संस्करण स्वीकार करें')}
                    </button>
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() => void respond(quote, 'REJECTED')}
                    >
                      {t('Reject offer', 'प्रस्ताव अस्वीकार करें')}
                    </button>
                  </div>
                </>
              )}
              {status === 'ACCEPTED' && !quote.order && (
                <p>
                  {t(
                    'Acceptance is recorded. The shop must convert this offer into an order after confirming stock and delivery.',
                    'स्वीकृति दर्ज है। दुकान स्टॉक और डिलीवरी जाँचकर इस प्रस्ताव से ऑर्डर बनाएगी।',
                  )}
                </p>
              )}
              {quote.order && (
                <Link className="button" href={`/orders/${quote.order.id}`}>
                  {t('View resulting order', 'बना हुआ ऑर्डर देखें')} · {quote.order.number}
                </Link>
              )}
            </article>
          );
        })}
        {cursor && (
          <button className="button secondary" disabled={busy} onClick={() => void load(cursor)}>
            {t('Load older quotations', 'पुराने भाव लोड करें')}
          </button>
        )}
      </section>
    </>
  );
}
