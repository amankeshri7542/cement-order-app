'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { Page, Quote } from '@shiv/shared';
import { isQuoteDraft, isQuoteRequest, type QuoteRequest } from '../../lib/guards';
import { useCommerce, saved, persist } from './commerce';
import { list, withoutAsked } from '../../lib/list-store';
import { AccountRequired, AddressBook } from './account';
import { customerApi, CustomerError } from '../../lib/customer-api';
import { mergePage } from '../../lib/paging';
import { dayLabel, momentLabel, price } from '../../lib/display';
import { quoteStatusText } from '@shiv/shared/src/labels';
const language = 'en' as const;

export function QuotationsPage() {
  const { lines } = useSyncExternalStore(list.subscribe, list.snapshot, list.server);
  return (
    <div className="commerce-page">
      <div className="page-heading">
        <h1>Ask for a rate.</h1>
        <p>
          Send your list and the shop replies in writing with item rates, freight and an expiry
          date. This is not an order, and no material is held for you yet.
        </p>
      </div>
      <section className="quote-builder">
        <div className="section-heading">
          <h2>Your list</h2>
          <Link className="text-link" href="/list">
            Change your list
          </Link>
        </div>
        {lines.length ? (
          lines.map((line) => (
            <article className="quote-line" key={line.i}>
              <div>
                <h3>{line.n}</h3>
                <p>
                  {line.q} × {line.u}
                </p>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <h3>Nothing to ask about yet.</h3>
            <Link className="button secondary" href="/rates">
              See the rates
            </Link>
          </div>
        )}
      </section>
      <AccountRequired nested>
        <QuoteAccount />
      </AccountRequired>
    </div>
  );
}
function QuoteAccount() {
  const c = useCommerce();
  const { lines } = useSyncExternalStore(list.subscribe, list.snapshot, list.server);
  const id = c.user!.id;
  const [addressId, setAddress] = useState('');
  const [date, setDate] = useState(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [company, setCompany] = useState('');
  const [gstin, setGstin] = useState('');
  const [notes, setNotes] = useState('');
  const [loadedDraft, setLoadedDraft] = useState(false);
  const [pending, setPending] = useState<QuoteRequest | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consents, setConsents] = useState<Record<string, number>>({});
  const epoch = useRef(0);
  const deeper = useRef(false);
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
          // Polls refresh the first page; ticks are per revision, so a new offer clears its own.
          setQuotes((old) => mergePage(old, data.items, !after));
          if (after || !deeper.current) setCursor(data.nextCursor);
          if (after) deeper.current = true;
        }
      } catch (e) {
        if (current === epoch.current) c.showError(e);
      }
    },
    [id, c.showError],
  );
  useEffect(() => {
    const draft = saved<unknown>(`shiv_quote_draft_${id}`);
    if (isQuoteDraft(draft)) {
      setAddress(draft.addressId);
      setDate(draft.date);
      setCompany(draft.company);
      setGstin(draft.gstin);
      setNotes(draft.notes);
    }
    setLoadedDraft(true);
    const found = saved<unknown>(`shiv_pending_quote_${id}`);
    setPending(isQuoteRequest(found) ? found : null);
    deeper.current = false;
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
      const request: QuoteRequest = pending || {
        idempotencyKey: crypto.randomUUID(),
        items: list.snapshot().lines.map((line) => ({ productId: line.i, quantity: line.q })),
        addressId,
        deliveryDate: date,
        company,
        gstin,
        notes,
      };
      persist(`shiv_pending_quote_${id}`, request);
      setPending(request);
      const quote = await customerApi<Quote>('/quotes', 'POST', request, id);
      if (!quote || typeof quote.id !== 'string' || typeof quote.number !== 'string')
        throw new CustomerError('NETWORK_ERROR', 'Could not confirm the saved quotation response.');
      persist(`shiv_pending_quote_${id}`, null);
      if (c.currentAccount() !== id) return;
      setPending(null);
      const left = withoutAsked(list.snapshot().lines, request.items);
      if (left.length) list.replace(left, list.snapshot().hint);
      else list.clear();
      c.setMessage(`Sent to the shop: ${quote.number}`);
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
    if (status === 'REJECTED' && !window.confirm('Reject this offer revision?')) return;
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
  return (
    <>
      {pending ? (
        <div className="recovery-panel">
          <h2>Recover your quotation request.</h2>
          <p>
            The saved submission is frozen. Retry it to recover the shop reference; changes to your
            new list are not included.
          </p>
          <ul>
            {pending.items.map((item) => (
              <li key={item.productId}>
                {item.productId} · {item.quantity}
              </li>
            ))}
          </ul>
          <button className="button" disabled={busy} onClick={() => void submit()}>
            Recover the shop's answer
          </button>
        </div>
      ) : lines.length ? (
        <div className="quote-request">
          <AddressBook selected={addressId} onSelect={setAddress} />
          <div className="form-grid">
            <label>
              Requested delivery date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Company (optional)
              <input maxLength={150} value={company} onChange={(e) => setCompany(e.target.value)} />
            </label>
            <label>
              GSTIN (optional)
              <input
                maxLength={15}
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Site requirements (optional)
              <textarea maxLength={1500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <p>This sends an enquiry, not an order. No stock is reserved and no payment is taken.</p>
          <button className="button" disabled={!addressId || busy} onClick={() => void submit()}>
            {busy ? 'Sending…' : 'Ask the shop for a rate'}
          </button>
        </div>
      ) : null}
      <section className="quote-history">
        <div className="section-heading">
          <h2>{'Your requests & offers'}</h2>
          <button className="text-link" disabled={busy} onClick={() => void load()}>
            Refresh offers
          </button>
        </div>
        {!quotes.length && <p>Your saved requests and shop offers will appear here.</p>}
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
                  <p>Revision {quote.revision}</p>
                </div>
                <span className="status-badge">{quoteStatusText(status, language)}</span>
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
                        ? 'Shop price pending'
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
                Requested delivery: {dayLabel(quote.deliveryDate, language)} ·{' '}
                {quote.deliveryConfirmed
                  ? 'Delivery terms confirmed by shop'
                  : 'Delivery terms awaiting confirmation'}
              </p>
              {quote.totalPaise !== null && (
                <p>
                  <strong className="total-price">{price(quote.totalPaise)}</strong> · Freight
                  included: {price(quote.deliveryFeePaise)}
                </p>
              )}
              {quote.validUntil && (
                <p>Offer valid until: {momentLabel(quote.validUntil, language)}</p>
              )}
              {quote.deliveryTerms && <p>Delivery terms: {quote.deliveryTerms}</p>}
              {quote.adminNote && <p>{quote.adminNote}</p>}
              {status === 'SENT' && (
                <>
                  <label className="choice">
                    <input
                      type="checkbox"
                      checked={consents[quote.id] === quote.revision}
                      onChange={(e) =>
                        setConsents((old) => ({
                          ...old,
                          [quote.id]: e.target.checked ? quote.revision : 0,
                        }))
                      }
                    />
                    I reviewed this revision’s items, unit prices, freight, delivery assumptions,
                    expiry and total.
                  </label>
                  <div className="action-row">
                    <button
                      className="button"
                      disabled={busy || consents[quote.id] !== quote.revision}
                      onClick={() => void respond(quote, 'ACCEPTED')}
                    >
                      Accept this revision
                    </button>
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() => void respond(quote, 'REJECTED')}
                    >
                      Reject offer
                    </button>
                  </div>
                </>
              )}
              {status === 'ACCEPTED' && !quote.order && (
                <p>
                  Acceptance is recorded. The shop must convert this offer into an order after
                  confirming stock and delivery.
                </p>
              )}
              {quote.order && (
                <Link className="button" href={`/orders/${quote.order.id}`}>
                  View resulting order · {quote.order.number}
                </Link>
              )}
            </article>
          );
        })}
        {cursor && (
          <button className="button secondary" disabled={busy} onClick={() => void load(cursor)}>
            Load older quotations
          </button>
        )}
      </section>
    </>
  );
}
