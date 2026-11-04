'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Field, MoneyText, Sheet, Skeleton, StatusPill } from '@shiv/design';
import {
  dayLabel,
  deliveryDateOptions,
  istToday,
  money,
  type Order,
  type Quote,
} from '@shiv/shared';
import { isMessageKey, type MessageKey } from '@shiv/i18n';
import { ApiError, api } from '../../lib/api';
import { useLanguage, useT, useWords } from '../../lib/i18n';
import { useAction, useOwner, useUnsavedGuard } from '../../lib/owner';
import {
  MoreRows,
  PageHeader,
  Problem,
  QueryStatus,
  moneyInput,
  rupeesToPaise,
  usePaged,
} from './common';
import css from './owner.module.css';
import local from './lists.module.css';

const listKey = ['quotes', 'list'];
const DAY = 86400000;
/** The most the API takes for one rate or one delivery cost. */
const MOST_PAISE = 100_000_000;

/** Someone may be halfway through typing, so this never throws. */
const paiseOf = (rupees: string) => {
  try {
    const paise = rupeesToPaise(rupees);
    return paise <= MOST_PAISE ? paise : null;
  } catch {
    return null;
  }
};
/** The value a date-and-time box wants, in this phone's own time. */
const localTime = (time: number) =>
  new Date(time - new Date(time).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
/** A date that has already passed is refused, so an old one starts a fresh week instead. */
const startExpiry = (quote: Quote) => {
  const saved = quote.validUntil ? Date.parse(quote.validUntil) : 0;
  return localTime(saved > Date.now() ? saved : Date.now() + 7 * DAY);
};
const place = (quote: Quote) => `${quote.address.area}, ${quote.address.city}`;
const askedBy = (quote: Quote) => quote.company || quote.address.name;
const tones: Record<Quote['status'], 'blue' | 'green' | 'neutral' | 'red'> = {
  REQUESTED: 'blue',
  SENT: 'neutral',
  ACCEPTED: 'green',
  REJECTED: 'neutral',
  EXPIRED: 'red',
};
/** What the API refuses that needs words of its own on this screen. */
const ownWords = new Map<string, MessageKey>([
  ['INVALID_DELIVERY_DATE', 'owner.lists.badDay'],
  ['CUSTOMER_DELETED', 'owner.lists.customerGone'],
  ['DELIVERY_CONFIRMATION_REQUIRED', 'owner.lists.needCheck'],
]);

function Trouble({ error }: { error: unknown }) {
  const t = useT();
  const key = error instanceof ApiError ? ownWords.get(error.code) : undefined;
  return key ? (
    <p className={css.error} role="alert">
      {t(key)}
    </p>
  ) : (
    <Problem error={error} />
  );
}

function ListState({ quote }: { quote: Quote }) {
  const t = useT();
  if (quote.order) return <StatusPill tone="green" label={t('owner.lists.state.ORDERED')} />;
  const key = `owner.lists.state.${quote.status}`;
  return (
    <StatusPill
      tone={tones[quote.status] ?? 'neutral'}
      label={isMessageKey(key) ? t(key) : t('owner.pending')}
    />
  );
}

/** Call and WhatsApp open on this phone; nothing goes out until the person taps send there. */
function Reach({ phone }: { phone: string | undefined }) {
  const t = useT();
  if (!phone || !/^\+91[6-9]\d{9}$/.test(phone)) return null;
  return (
    <div className={css.actions}>
      <a className={css.inlineLink} href={`tel:${phone}`}>
        {t('owner.call')}
      </a>
      <a
        className={css.inlineLink}
        href={`https://wa.me/${phone.slice(1)}`}
        target="_blank"
        rel="noreferrer"
      >
        {t('owner.lists.whatsapp')}
      </a>
    </div>
  );
}

function ListCard({ quote }: { quote: Quote }) {
  const t = useT();
  const words = useWords();
  const router = useRouter();
  const { language } = useLanguage();
  const { can } = useOwner();
  const canPrice = can('quotes.price', quote.locationId);
  const action: MessageKey =
    quote.order || !canPrice
      ? 'owner.lists.open'
      : quote.status === 'ACCEPTED'
        ? 'owner.lists.makeOrder'
        : quote.status === 'REQUESTED'
          ? 'owner.lists.rateDo'
          : quote.status === 'EXPIRED'
            ? 'owner.lists.rateAgain'
            : 'owner.lists.open';
  const open = () => router.push(`/lists?id=${encodeURIComponent(quote.id)}`);
  return (
    <article className={css.card}>
      <div className={css.row}>
        <strong>{quote.number}</strong>
        <ListState quote={quote} />
      </div>
      <h3>{askedBy(quote)}</h3>
      <p>
        {t('owner.lists.where', {
          place: place(quote),
          day: dayLabel(quote.deliveryDate, language),
        })}
      </p>
      <p>{quote.items.map((item) => `${item.name}: ${item.quantity} ${item.unit}`).join(' · ')}</p>
      {quote.revision > 0 && (
        <p className={css.date}>
          {t('owner.lists.sentTimes', { count: quote.revision })}
          {quote.validUntil &&
            ` · ${t('owner.lists.validTill', { when: words.moment(quote.validUntil) })}`}
        </p>
      )}
      <div className={css.row}>
        <strong>
          {quote.totalPaise === null ? t('owner.lists.noTotal') : money(quote.totalPaise)}
        </strong>
        <span className={css.date}>
          {t('owner.lists.age', { age: words.age(quote.createdAt) })}
        </span>
      </div>
      <div className={css.actions}>
        <Button
          variant={action === 'owner.lists.open' ? 'secondary' : 'primary'}
          aria-label={`${t(action)} ${quote.number}`}
          onClick={open}
        >
          {t(action)}
        </Button>
        {quote.order && (
          <Link className={css.inlineLink} href={`/orders/${encodeURIComponent(quote.order.id)}`}>
            {t('owner.lists.orderLink', { number: quote.order.number })}
          </Link>
        )}
      </div>
      <Reach phone={quote.address.phone} />
    </article>
  );
}

function AlertRetry({ workId, attempts }: { workId: string; attempts: number }) {
  const t = useT();
  const retry = useAction(
    () => api(`/admin/work/${workId}/retry`, 'POST', {}),
    [listKey],
    'owner.lists.alertSent',
  );
  return (
    <div className={css.warnBlock}>
      <p>{t('owner.lists.alertFailed', { count: attempts })}</p>
      <Button
        variant="secondary"
        disabled={retry.isPending}
        onClick={() => retry.mutate(undefined)}
      >
        {t('owner.lists.alertAgain')}
      </Button>
      <Problem error={retry.error} />
    </div>
  );
}

/** Who has this list. It reads the latest list even while someone is typing rates. */
function WorkCard({ quote }: { quote: Quote }) {
  const t = useT();
  const { can } = useOwner();
  const work = quote.work;
  const canConfirm = can('orders.confirm', quote.locationId);
  // Named people only: the API refuses to give work to someone with no name.
  const owners = useQuery({
    enabled: canConfirm && !!work,
    queryKey: ['work-owners'],
    queryFn: () => api<{ id: string; name: string }[]>('/admin/owners'),
  });
  const take = useAction(
    () => api(`/admin/quotes/${quote.id}/acknowledge`, 'POST', {}),
    [listKey],
    'owner.lists.taken',
  );
  const give = useAction(
    (ownerId: string) => api(`/admin/work/${work?.id}/assign`, 'POST', { ownerId }),
    [listKey],
    'owner.lists.given',
  );
  if (!work) return null;
  const busy = take.isPending || give.isPending;
  return (
    <section className={css.card}>
      <p>
        <strong>
          {work.assignedTo?.name
            ? t('owner.lists.holder', { name: work.assignedTo.name })
            : t('owner.lists.nobody')}
        </strong>
      </p>
      {!work.acknowledgedAt && canConfirm && (
        <Button className={css.wide} disabled={busy} onClick={() => take.mutate(undefined)}>
          {t('owner.lists.take')}
        </Button>
      )}
      {work.lastError && canConfirm && <AlertRetry workId={work.id} attempts={work.attempts} />}
      {canConfirm && (
        <Field label={t('owner.lists.giveTo')}>
          <select
            value=""
            disabled={busy || !owners.data}
            onChange={(event) => {
              if (event.target.value) give.mutate(event.target.value);
            }}
          >
            <option value="">{t('owner.lists.choosePerson')}</option>
            {owners.data
              ?.filter((owner) => owner.name.trim())
              .map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      <Problem error={take.error ?? give.error ?? owners.error} />
    </section>
  );
}

function CustomerCard({ quote }: { quote: Quote }) {
  const t = useT();
  const { language } = useLanguage();
  const { address } = quote;
  return (
    <section className={css.card}>
      <h2>{t('owner.lists.customer')}</h2>
      <h3>{askedBy(quote)}</h3>
      <p>
        {address.line1}, {place(quote)}
      </p>
      <p>
        {t('owner.lists.day')}: {dayLabel(quote.deliveryDate, language)}
      </p>
      {address.landmark && <p>{t('owner.lists.landmark', { place: address.landmark })}</p>}
      {quote.notes && (
        <>
          <strong>{t('owner.lists.theySaid')}</strong>
          <p className={`${css.said} ${local.words}`}>{quote.notes}</p>
        </>
      )}
      {quote.gstin && <p>{t('owner.lists.gstin', { gstin: quote.gstin })}</p>}
      <p>{address.phone}</p>
      <Reach phone={address.phone} />
    </section>
  );
}

/** The agreed or quoted terms for anyone who cannot change them just now. */
function Terms({ quote }: { quote: Quote }) {
  const t = useT();
  const words = useWords();
  const { language } = useLanguage();
  return (
    <section className={css.card}>
      <h2>{t('owner.lists.rates')}</h2>
      {quote.items.map((item) => (
        <div className={css.summary} key={item.productId}>
          <div>
            <strong>{item.name}</strong>
            {item.unitPricePaise === null ? (
              <span>{t('owner.lists.noRate')}</span>
            ) : (
              <MoneyText value={item.unitPricePaise * item.quantity} />
            )}
          </div>
          <p>
            {item.quantity} × {item.packSize || item.unit}
            {item.unitPricePaise !== null && ` × ${money(item.unitPricePaise)}`}
          </p>
        </div>
      ))}
      <div className={css.summary}>
        <div>
          <span>{t('owner.lists.freightLine')}</span>
          <MoneyText value={quote.deliveryFeePaise} />
        </div>
        <div className={css.total}>
          <span>{t('owner.lists.total')}</span>
          {quote.totalPaise === null ? (
            <span>{t('owner.lists.noTotal')}</span>
          ) : (
            <MoneyText value={quote.totalPaise} />
          )}
        </div>
      </div>
      <p>
        {t('owner.lists.day')}: {dayLabel(quote.deliveryDate, language)}
      </p>
      {quote.validUntil && (
        <p>{t('owner.lists.validTill', { when: words.moment(quote.validUntil) })}</p>
      )}
      {quote.revision > 0 && <p>{t('owner.lists.sentTimes', { count: quote.revision })}</p>}
      {quote.deliveryTerms && (
        <p className={local.words}>
          {t('owner.lists.terms')}: {quote.deliveryTerms}
        </p>
      )}
      {quote.adminNote && (
        <p className={local.words}>
          {t('owner.lists.note')}: {quote.adminNote}
        </p>
      )}
    </section>
  );
}

function OfferForm({
  quote,
  busy,
  trouble,
  onEdit,
  send,
}: {
  quote: Quote;
  busy: boolean;
  trouble: React.ReactNode;
  onEdit: () => void;
  send: (body: Record<string, unknown>, total: number) => void;
}) {
  const t = useT();
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(quote.items.map((i) => [i.productId, moneyInput(i.unitPricePaise)])),
  );
  const [fee, setFee] = useState(moneyInput(quote.deliveryFeePaise));
  const [day, setDay] = useState(quote.deliveryDate);
  const [expiry, setExpiry] = useState(() => startExpiry(quote));
  const [terms, setTerms] = useState(quote.deliveryTerms ?? '');
  const [note, setNote] = useState(quote.adminNote);
  const [checked, setChecked] = useState(!!quote.deliveryConfirmed);
  const [bad, setBad] = useState('');
  const today = istToday();
  const lastDay = deliveryDateOptions(new Date(), 89, 1)[0]!;
  const lines = quote.items.map((item) => paiseOf(rates[item.productId] ?? ''));
  const freight = paiseOf(fee);
  const total =
    freight !== null && lines.every((paise) => paise !== null)
      ? lines.reduce((sum: number, paise, index) => {
          return sum + paise! * quote.items[index]!.quantity;
        }, freight)
      : null;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    // Each of these would come back refused anyway. Saying it here keeps the owner's words simple.
    const badLine = quote.items.find((_, index) => !lines[index]);
    const until = new Date(expiry).getTime();
    const problem = badLine
      ? t('owner.lists.badRate', { name: badLine.name })
      : freight === null
        ? t('owner.lists.badFreight')
        : !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today || day > lastDay
          ? t('owner.lists.badDay')
          : !(until > Date.now()) || until > Date.now() + 90 * DAY
            ? t('owner.lists.badExpiry')
            : '';
    setBad(problem);
    if (problem || total === null) return;
    send(
      {
        expectedRevision: quote.revision,
        deliveryConfirmed: checked,
        deliveryDate: day,
        items: quote.items.map((item, index) => ({
          productId: item.productId,
          unitPricePaise: lines[index],
        })),
        deliveryFeePaise: freight,
        validUntil: new Date(until).toISOString(),
        note: note.trim(),
        deliveryTerms: terms.trim(),
      },
      total,
    );
  };
  return (
    <form className={css.pakkaCard} onChange={onEdit} onSubmit={submit}>
      <h2>{t('owner.lists.rates')}</h2>
      {quote.items.map((item, index) => {
        const paise = lines[index];
        return (
          <div key={item.productId}>
            <Field
              label={t('owner.lists.rateLabel', {
                name: item.name,
                quantity: item.quantity,
                unit: item.packSize || item.unit,
              })}
            >
              <input
                required
                inputMode="decimal"
                autoComplete="off"
                value={rates[item.productId] ?? ''}
                disabled={busy}
                onChange={(event) => setRates({ ...rates, [item.productId]: event.target.value })}
              />
            </Field>
            {!!paise && (
              <p className={local.lineTotal}>
                {item.quantity} × {money(paise)} = {money(paise * item.quantity)}
              </p>
            )}
          </div>
        );
      })}
      <div className={local.lines}>
        <Field label={t('owner.lists.day')}>
          <input
            type="date"
            required
            min={today}
            max={lastDay}
            value={day}
            disabled={busy}
            onChange={(event) => setDay(event.target.value)}
          />
        </Field>
        <Field label={t('owner.lists.freight')}>
          <input
            required
            inputMode="decimal"
            autoComplete="off"
            value={fee}
            disabled={busy}
            onChange={(event) => setFee(event.target.value)}
          />
        </Field>
        <Field label={t('owner.lists.validUntil')}>
          <input
            type="datetime-local"
            required
            value={expiry}
            disabled={busy}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </Field>
      </div>
      <Field label={t('owner.lists.terms')}>
        <textarea
          maxLength={500}
          placeholder={t('owner.lists.termsHint')}
          value={terms}
          disabled={busy}
          onChange={(event) => setTerms(event.target.value)}
        />
      </Field>
      <Field label={t('owner.lists.note')}>
        <textarea
          maxLength={1500}
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <label className={css.check}>
        <input
          type="checkbox"
          required
          checked={checked}
          disabled={busy}
          onChange={(event) => setChecked(event.target.checked)}
        />
        {t('owner.lists.checked')}
      </label>
      {/* On a phone the total and the send button stay on screen while the rates are typed. */}
      <div className={css.payBar}>
        <div className={css.row}>
          <span>{t('owner.lists.total')}</span>
          <span className={css.barTotal}>{total === null ? '-' : money(total)}</span>
        </div>
        {bad && (
          <p className={css.error} role="alert">
            {bad}
          </p>
        )}
        {trouble}
        <Button className={`${css.wide} ${css.lamp}`} disabled={busy}>
          {t(
            busy
              ? 'owner.lists.sending'
              : quote.revision
                ? 'owner.lists.sendAgain'
                : 'owner.lists.send',
          )}
        </Button>
      </div>
    </form>
  );
}

function ListDetail({ live }: { live: Quote }) {
  const t = useT();
  const router = useRouter();
  const { language } = useLanguage();
  const { can, confirm, notice } = useOwner();
  // What was on screen when the person started typing. It stays put so nothing moves under them,
  // and the API refuses it if the list has moved on.
  const [held, setHeld] = useState<Quote | null>(null);
  const quote = held ?? live;
  const edit = () => setHeld((current) => current ?? live);
  const { clearDirty } = useUnsavedGuard(held !== null);
  const changed =
    !!held &&
    (live.revision !== held.revision ||
      live.status !== held.status ||
      !!live.order !== !!held.order);
  const canPrice = can('quotes.price', quote.locationId);
  const [revising, setRevising] = useState(false);
  const locked = !canPrice || !!quote.order || (quote.status === 'ACCEPTED' && !revising);
  const [decision, setDecision] = useState<'ACCEPTED' | 'REJECTED' | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [noteMissing, setNoteMissing] = useState(false);
  // An acceptance given in time still makes an order after the agreed day has passed. The owner
  // then picks a new day agreed with the customer.
  const dateOptions = deliveryDateOptions(new Date(), 0, 14);
  const datePassed = quote.deliveryDate < istToday();
  const [newDate, setNewDate] = useState(dateOptions[1] ?? dateOptions[0]!);

  const saving = useRef(false);
  const write = useAction(
    (send: () => Promise<unknown>) => send(),
    [listKey, ['inbox'], ['orders', 'list'], ['products'], ['stock']],
  );
  /** One write at a time, and a second tap sends nothing. */
  const run = (send: () => Promise<unknown>, done?: () => void) => {
    if (saving.current) return;
    saving.current = true;
    write.mutate(send, {
      onSuccess: done,
      onSettled: () => {
        saving.current = false;
      },
    });
  };
  const busy = write.isPending;
  const backToList = (message: string) => {
    clearDirty();
    setHeld(null);
    notice(message);
    router.push('/lists');
  };
  const sendOffer = async (body: Record<string, unknown>, total: number) => {
    const label = t(quote.revision ? 'owner.lists.sendAgain' : 'owner.lists.send');
    if (
      !(await confirm({
        title: label,
        body: t('owner.lists.sendBody', { total: money(total) }),
        confirmLabel: label,
      }))
    )
      return;
    run(
      () => api(`/admin/quotes/${quote.id}/offer`, 'POST', body),
      () => backToList(t('owner.lists.sent')),
    );
  };
  const makeOrder = async () => {
    const total = money(quote.totalPaise ?? 0);
    if (
      !(await confirm({
        title: t('owner.lists.makeOrder'),
        body: datePassed
          ? t('owner.lists.orderBodyDay', { total, day: dayLabel(newDate, language) })
          : t('owner.lists.orderBody', { total }),
        confirmLabel: t('owner.lists.makeOrder'),
      }))
    )
      return;
    run(async () => {
      const order = await api<Order>(`/admin/quotes/${quote.id}/convert`, 'POST', {
        revision: quote.revision,
        ...(datePassed ? { deliveryDate: newDate } : {}),
      });
      clearDirty();
      setHeld(null);
      notice(t('owner.lists.orderMade', { number: order.number }));
      router.push(`/orders/${encodeURIComponent(order.id)}`);
    });
  };
  const askDecision = (status: 'ACCEPTED' | 'REJECTED') => {
    write.reset();
    setNoteMissing(false);
    setDecision(status);
  };
  const recordDecision = (event: React.FormEvent) => {
    event.preventDefault();
    const note = decisionNote.trim();
    if (!decision) return;
    if (!note) {
      setNoteMissing(true);
      return;
    }
    run(
      () =>
        api(`/admin/quotes/${quote.id}/respond`, 'POST', {
          revision: quote.revision,
          status: decision,
          note,
        }),
      () => backToList(t(decision === 'ACCEPTED' ? 'owner.lists.yesDone' : 'owner.lists.noDone')),
    );
  };
  const trouble = !decision && <Trouble error={write.error} />;
  return (
    <>
      <PageHeader title={quote.number} back="/lists">
        <ListState quote={live} />
      </PageHeader>
      <div className={local.split}>
        <div className={css.stack}>
          <CustomerCard quote={quote} />
          <WorkCard quote={live} />
        </div>
        <div className={css.stack}>
          {changed && (
            <p className={css.warnBlock} role="status">
              {t('owner.lists.changedElsewhere')}
            </p>
          )}
          {quote.order && (
            <p className={css.decidedLine}>
              <Link
                className={css.inlineLink}
                href={`/orders/${encodeURIComponent(quote.order.id)}`}
              >
                {t('owner.lists.orderLink', { number: quote.order.number })}
              </Link>
            </p>
          )}
          {quote.decisionSource && (
            <p className={`${css.decidedLine} ${local.words}`}>
              {t(
                quote.decisionSource === 'CUSTOMER'
                  ? 'owner.lists.saidInApp'
                  : 'owner.lists.saidToShop',
              )}
              {quote.decisionNote && ` · ${quote.decisionNote}`}
            </p>
          )}
          {revising && (
            <p className={css.warnBlock} role="status">
              {t('owner.lists.changeWarn')}
            </p>
          )}
          {canPrice && quote.status === 'SENT' && !quote.order && (
            <div className={css.underBar}>
              <Button variant="secondary" disabled={busy} onClick={() => askDecision('ACCEPTED')}>
                {t('owner.lists.recordYes')}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => askDecision('REJECTED')}>
                {t('owner.lists.recordNo')}
              </Button>
            </div>
          )}
          {locked ? (
            <Terms quote={quote} />
          ) : (
            <OfferForm
              key={`${quote.id}:${quote.revision}:${revising}`}
              quote={quote}
              busy={busy}
              trouble={trouble}
              onEdit={edit}
              send={(body, total) => void sendOffer(body, total)}
            />
          )}
          {canPrice && quote.status === 'ACCEPTED' && !quote.order && !revising && (
            <section className={css.card}>
              <p>{t('owner.lists.acceptedNote')}</p>
              {datePassed && (
                <Field label={t('owner.lists.newDay')}>
                  <select
                    value={newDate}
                    disabled={busy}
                    onChange={(event) => setNewDate(event.target.value)}
                  >
                    {dateOptions.map((day) => (
                      <option key={day} value={day}>
                        {dayLabel(day, language)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {trouble}
              <div className={css.stack}>
                <Button
                  className={`${css.wide} ${css.lamp}`}
                  disabled={busy}
                  onClick={() => void makeOrder()}
                >
                  {t('owner.lists.makeOrder')}
                </Button>
                <Button
                  variant="secondary"
                  className={css.wide}
                  disabled={busy}
                  onClick={() => {
                    edit();
                    write.reset();
                    setRevising(true);
                  }}
                >
                  {t('owner.lists.changeRates')}
                </Button>
              </div>
              <p className={css.hint}>{t('owner.lists.lockedYes')}</p>
            </section>
          )}
          {canPrice && quote.order && <p className={css.hint}>{t('owner.lists.lockedOrder')}</p>}
        </div>
      </div>
      {decision && (
        <Sheet
          title={t(decision === 'ACCEPTED' ? 'owner.lists.recordYes' : 'owner.lists.recordNo')}
          closeLabel={t('owner.lists.goBack')}
          onClose={() => {
            if (!busy) setDecision(null);
          }}
        >
          <form className={css.stack} onSubmit={recordDecision}>
            <p>{t('owner.lists.recordHelp')}</p>
            <Field
              label={t('owner.lists.recordNote')}
              {...(noteMissing ? { error: t('owner.lists.recordNeeded') } : {})}
            >
              <textarea
                autoFocus
                maxLength={500}
                value={decisionNote}
                disabled={busy}
                onChange={(event) => {
                  setDecisionNote(event.target.value);
                  setNoteMissing(false);
                  edit();
                }}
              />
            </Field>
            <Trouble error={write.error} />
            <Button className={css.wide} disabled={busy}>
              {t(decision === 'ACCEPTED' ? 'owner.lists.recordYes' : 'owner.lists.recordNo')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className={css.wide}
              disabled={busy}
              onClick={() => setDecision(null)}
            >
              {t('owner.lists.goBack')}
            </Button>
          </form>
        </Sheet>
      )}
    </>
  );
}

function ListsPage() {
  const t = useT();
  const client = useQueryClient();
  const id = useSearchParams().get('id');
  const lists = usePaged<Quote>(listKey, '/admin/quotes?limit=24');
  const rows = lists.data?.pages.flatMap((page) => page.items) ?? [];
  const opened = id ? rows.find((row) => row.id === id) : undefined;
  // A customer's yes should show without anyone pressing anything; the desk's live stream does not
  // cover lists, and typed rates are held safely while this reads again.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden && navigator.onLine)
        void client.invalidateQueries({ queryKey: listKey });
    }, 30000);
    return () => clearInterval(timer);
  }, [client]);
  // A link to a list further down than the first page keeps reading until it finds it.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = lists;
  // It stops at the first failure, which the retry button below picks up.
  const looking = !!id && !opened && hasNextPage && !lists.error;
  useEffect(() => {
    if (looking && !isFetchingNextPage) void fetchNextPage();
  }, [looking, isFetchingNextPage, fetchNextPage]);

  if (opened) return <ListDetail key={opened.id} live={opened} />;
  return (
    <>
      <PageHeader
        title={t('owner.lists.title')}
        sub={t('owner.lists.sub')}
        {...(id ? { back: '/lists' } : {})}
      />
      <QueryStatus query={lists} />
      {looking && <Skeleton label={t('owner.loading')} />}
      {id && lists.data && !looking && !lists.error && (
        <section className={css.card}>
          <p>{t('owner.lists.notFound')}</p>
        </section>
      )}
      {!id && (
        <div className={css.stack}>
          {rows.map((quote) => (
            <ListCard key={quote.id} quote={quote} />
          ))}
          {lists.data && !rows.length && <EmptyState title={t('owner.lists.empty')} />}
          <MoreRows query={lists} />
        </div>
      )}
    </>
  );
}

/** Customers' big lists: give rates, get their yes, and turn it into one order. */
export function Lists() {
  const t = useT();
  const { can } = useOwner();
  if (!can('quotes.read'))
    return (
      <section className={css.card}>
        <h1>{t('owner.notYourPage')}</h1>
        <p>{t('owner.notYourPageBody')}</p>
      </section>
    );
  return (
    <Suspense fallback={<Skeleton label={t('owner.loading')} />}>
      <ListsPage />
    </Suspense>
  );
}
