'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, MoneyText, SearchBar, Sheet } from '@shiv/design';
import { istToday, money, type Order } from '@shiv/shared';
import { ApiError, api } from '../../lib/api';
import { useT, useWords } from '../../lib/i18n';
import { useAction, useDebounced, useOwner, useUnsavedGuard } from '../../lib/owner';
import type { Customer, KhataSummary, Ledger, LedgerEntry } from '../../lib/owner-types';
import {
  ContactActions,
  MoreRows,
  PageHeader,
  Problem,
  QueryStatus,
  Status,
  moneyInput,
  rupeesToPaise,
  usePaged,
} from './common';
import { OrderRow } from './orders';
import css from './owner.module.css';

export function Customers() {
  const t = useT();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [sort, setSort] = useState('due');
  const customers = usePaged<Customer>(
    ['customers', 'list', sort, q],
    `/admin/customers?limit=24&sort=${sort}&q=${encodeURIComponent(q)}`,
  );
  const rows = customers.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <PageHeader title={t('owner.customers')} />
      <SearchBar
        label={t('owner.searchCustomers')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className={css.chips}>
        {['due', 'recent'].map((value) => (
          <Button
            key={value}
            variant={value === sort ? 'primary' : 'secondary'}
            aria-pressed={value === sort}
            onClick={() => setSort(value)}
          >
            {t(value === 'due' ? 'owner.sortDue' : 'owner.sortRecent')}
          </Button>
        ))}
      </div>
      <QueryStatus query={customers} />
      <div className={css.stack}>
        {rows.map((customer) => (
          <CustomerRow key={customer.id} customer={customer} />
        ))}
        {!customers.isPending && !rows.length && (
          <EmptyState
            title={t('owner.emptyCustomers')}
            action={
              <Link href="/orders/new" className={css.inlineLink}>
                {t('owner.newOrder')}
              </Link>
            }
          />
        )}
      </div>
      <MoreRows query={customers} />
    </>
  );
}
function CustomerRow({ customer }: { customer: Customer }) {
  const t = useT();
  return (
    <Link href={`/customers/${customer.id}`} className={`${css.card} ${css.cardLink}`}>
      <div className={css.row}>
        <h3>{customer.name || customer.phone}</h3>
        <MoneyText value={customer.balancePaise} signed />
      </div>
      <p>
        {customer.phone}
        {customer.area ? ` · ${customer.area}` : ''}
      </p>
      <span className={css.hint}>
        {t(
          customer.balancePaise > 0
            ? 'owner.due'
            : customer.balancePaise < 0
              ? 'owner.advance'
              : 'owner.clearBalance',
        )}
      </span>
    </Link>
  );
}

export function Khata() {
  const t = useT();
  const summary = useQuery({
    queryKey: ['khata', 'summary'],
    queryFn: () => api<KhataSummary>('/admin/khata/summary'),
  });
  const customers = usePaged<Customer>(
    ['customers', 'list', 'due', 'khata'],
    '/admin/customers?sort=due&limit=24',
  );
  return (
    <>
      <PageHeader title={t('owner.khata')} back="/today" />
      <QueryStatus query={summary} />
      {summary.data && (
        <section className={css.card}>
          <p>{t('owner.totalDue')}</p>
          <p className={`${css.moneyHero} ${css.due}`}>{money(summary.data.totalDuePaise)}</p>
        </section>
      )}
      {!!summary.data?.overdue30d.length && (
        <section className={css.stack}>
          <h2>{t('owner.overdue')}</h2>
          {summary.data.overdue30d.map((customer) => (
            <article key={customer.id} className={css.card}>
              <div className={css.row}>
                <Link href={`/customers/${customer.id}`} className={css.inlineLink}>
                  {customer.name || customer.phone}
                </Link>
                <MoneyText value={customer.overduePaise} signed />
              </div>
              <ContactActions
                customerId={customer.id}
                phone={customer.phone}
                purpose="reminder"
                text={t('owner.reminder', {
                  name: customer.name,
                  amount: money(customer.balancePaise),
                })}
              />
            </article>
          ))}
        </section>
      )}
      <section className={css.stack}>
        <h2>{t('owner.customers')}</h2>
        <QueryStatus query={customers} />
        {customers.data?.pages
          .flatMap((page) => page.items)
          .filter((customer) => customer.balancePaise > 0)
          .map((customer) => (
            <article className={css.card} key={customer.id}>
              <CustomerRow customer={customer} />
              <ContactActions
                phone={customer.phone}
                customerId={customer.id}
                purpose="reminder"
                text={t('owner.reminder', {
                  name: customer.name,
                  amount: money(customer.balancePaise),
                })}
              />
            </article>
          ))}
        <MoreRows query={customers} />
        {summary.data?.customersWithDue === 0 && <EmptyState title={t('owner.clearBalance')} />}
      </section>
    </>
  );
}

export function CustomerDetails({ id }: { id: string }) {
  const t = useT();
  const { requestClose } = useOwner();
  const customer = useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: () => api<Customer>(`/admin/customers/${id}`),
  });
  const [tab, setTab] = useState('ledger');
  const [form, setForm] = useState<'payment' | 'adjust' | null>(null);
  return (
    <>
      <PageHeader title={customer.data?.name || t('owner.customer')} back="/customers" />
      <QueryStatus query={customer} />
      {customer.data && (
        <>
          <section className={css.card}>
            <p>
              {customer.data.phone}
              {customer.data.area ? ` · ${customer.data.area}` : ''}
            </p>
            <p className={customer.data.balancePaise > 0 ? css.due : css.paid}>
              {t(
                customer.data.balancePaise > 0
                  ? 'owner.due'
                  : customer.data.balancePaise < 0
                    ? 'owner.advance'
                    : 'owner.clearBalance',
              )}
            </p>
            <p className={css.moneyHero}>{money(Math.abs(customer.data.balancePaise))}</p>
            <div className={css.actions}>
              <Button
                onClick={() =>
                  void requestClose(() => {
                    setTab('ledger');
                    setForm('payment');
                  })
                }
              >
                {t('owner.receiveMoney')}
              </Button>
              <Link className={css.inlineLink} href={`/orders/new?customer=${id}`}>
                {t('owner.newOrder')}
              </Link>
            </div>
            <ContactActions phone={customer.data.phone} customerId={id} />
          </section>
          <div role="tablist" aria-label={t('owner.customer')} className={css.tabs}>
            {(['ledger', 'orders', 'notes', 'settings'] as const).map((value) => (
              <Button
                key={value}
                role="tab"
                id={`tab-${value}`}
                aria-controls={`panel-${value}`}
                aria-selected={value === tab}
                tabIndex={value === tab ? 0 : -1}
                variant={value === tab ? 'primary' : 'secondary'}
                onClick={() => {
                  if (value !== tab) void requestClose(() => setTab(value));
                }}
                onKeyDown={(event) => {
                  const tabs = ['ledger', 'orders', 'notes', 'settings'];
                  const index = tabs.indexOf(tab);
                  const target =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? 3
                        : event.key === 'ArrowRight'
                          ? (index + 1) % 4
                          : event.key === 'ArrowLeft'
                            ? (index + 3) % 4
                            : null;
                  if (target === null) return;
                  event.preventDefault();
                  void requestClose(() => {
                    setTab(tabs[target]!);
                    document.getElementById(`tab-${tabs[target]}`)?.focus();
                  });
                }}
              >
                {t(
                  value === 'ledger'
                    ? 'owner.khata'
                    : value === 'orders'
                      ? 'owner.customerHistory'
                      : value === 'notes'
                        ? 'owner.customerNotes'
                        : 'owner.customerSettings',
                )}
              </Button>
            ))}
          </div>
          <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'ledger' && <CustomerLedger id={id} onAdjust={() => setForm('adjust')} />}
            {tab === 'orders' && <CustomerOrders id={id} />}
            {tab === 'notes' && <CustomerNotes id={id} />}
            {tab === 'settings' && <CustomerSettings key={id} customer={customer.data} />}
          </div>
          {form && <LedgerForm id={id} mode={form} close={() => setForm(null)} />}
        </>
      )}
    </>
  );
}

function CustomerLedger({ id, onAdjust }: { id: string; onAdjust: () => void }) {
  const t = useT();
  const words = useWords();
  const [reverse, setReverse] = useState<LedgerEntry | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['khata', id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Ledger>(
        `/admin/customers/${id}/khata?limit=24${pageParam ? '&cursor=' + encodeURIComponent(pageParam) : ''}`,
      ),
    getNextPageParam: (last) => last.entries.nextCursor ?? undefined,
  });
  const entries = query.data?.pages.flatMap((page) => page.entries.items) ?? [];
  return (
    <div className={css.stack}>
      <QueryStatus query={query} />
      <Button variant="secondary" onClick={onAdjust}>
        {t(entries.length ? 'owner.adjust' : 'owner.openingBalance')}
      </Button>
      {!query.isPending && !entries.length && <EmptyState title={t('owner.emptyLedger')} />}
      {entries.map((entry) => (
        <article key={entry.id} className={css.card}>
          <div className={css.row}>
            <Status value={entry.kind} />
            <MoneyText value={entry.amountPaise} signed />
          </div>
          <p>{entry.note}</p>
          <p className={css.date}>{words.moment(entry.occurredAt)}</p>
          <div className={css.row}>
            <span>{t('owner.runningBalance')}</span>
            <MoneyText value={entry.balanceAfterPaise} signed />
          </div>
          {entry.kind !== 'REVERSAL' && !entry.reversal && (
            <Button variant="ghost" onClick={() => setReverse(entry)}>
              {t('owner.reverse')}
            </Button>
          )}
        </article>
      ))}
      <MoreRows query={query} />
      {reverse && (
        <LedgerForm id={id} mode="reverse" entry={reverse} close={() => setReverse(null)} />
      )}
    </div>
  );
}

function LedgerForm({
  id,
  mode,
  entry,
  close,
}: {
  id: string;
  mode: 'payment' | 'adjust' | 'reverse';
  entry?: LedgerEntry;
  close: () => void;
}) {
  const t = useT();
  const { me } = useOwner();
  const storageKey = `shiv-owner-khata:${me.id}:${id}:${mode}:${entry?.id || ''}`;
  const [saved] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || 'null') as Record<
        string,
        unknown
      > | null;
    } catch {
      return null;
    }
  });
  const [amount, setAmount] = useState(
    saved?.amountPaise ? moneyInput(Math.abs(Number(saved.amountPaise))) : '',
  );
  const [negative, setNegative] = useState(Number(saved?.amountPaise) < 0);
  const [note, setNote] = useState(
    String(saved?.note ?? (mode === 'payment' ? t('owner.receiptNote') : '')),
  );
  const [date, setDate] = useState(String(saved?.occurredAt ?? istToday()));
  const [channel, setChannel] = useState(String(saved?.channel ?? 'CASH'));
  const frozen = useRef<Record<string, unknown> | null>(saved);
  const persisted = useRef(!!saved);
  const [locked, setLocked] = useState(!!saved);
  const [key] = useState(() => String(saved?.idempotencyKey ?? crypto.randomUUID()));
  const { clearDirty, requestClose } = useUnsavedGuard(
    (!locked && (!!amount || (!!note && mode !== 'payment'))) || (locked && !persisted.current),
  );
  const action = useAction(
    async () => {
      const body =
        frozen.current ??
        (mode === 'reverse'
          ? { note, idempotencyKey: key }
          : {
              amountPaise: rupeesToPaise(amount) * (mode === 'adjust' && negative ? -1 : 1),
              note,
              occurredAt: date,
              idempotencyKey: key,
              ...(mode === 'payment' ? { channel } : {}),
            });
      frozen.current = body;
      setLocked(true);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(body));
        persisted.current = true;
      } catch {
        persisted.current = false;
      }
      try {
        await api(
          `/admin/customers/${id}/khata/${mode === 'reverse' ? 'reverse/' + entry!.id : mode}`,
          'POST',
          body,
        );
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Already saved. */
        }
        frozen.current = null;
        clearDirty();
        close();
      } catch (error) {
        if (
          error instanceof ApiError &&
          ['INVALID_INPUT', 'KHATA_OVERFLOW', 'INVALID_BUSINESS_DATE'].includes(error.code)
        ) {
          frozen.current = null;
          setLocked(false);
          try {
            sessionStorage.removeItem(storageKey);
          } catch {
            /* No transaction was written. */
          }
        }
        throw error;
      }
    },
    [
      ['khata', id],
      ['khata', 'summary'],
      ['customers', 'detail', id],
      ['customers', 'list'],
    ],
    mode === 'payment' ? 'owner.paymentSaved' : 'owner.saved',
  );
  return (
    <Sheet
      title={t(
        mode === 'payment'
          ? 'owner.receiveMoney'
          : mode === 'adjust'
            ? 'owner.adjust'
            : 'owner.reverse',
      )}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!action.isPending) void requestClose(close);
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate();
        }}
      >
        {mode === 'reverse' && <p>{t('owner.reverseQuestion')}</p>}
        <fieldset disabled={locked} className={css.formFieldset}>
          {mode !== 'reverse' && (
            <>
              <Field label={t('owner.amount')}>
                <input
                  inputMode="decimal"
                  pattern="[0-9]+([.][0-9]{1,2})?"
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
              {mode === 'adjust' && (
                <>
                  <p>{t('owner.adjustHelp')}</p>
                  <label className={css.check}>
                    <input
                      type="checkbox"
                      checked={negative}
                      onChange={(event) => setNegative(event.target.checked)}
                    />
                    − {t('owner.amount')}
                  </label>
                </>
              )}
              <Field label={t('owner.businessDate')}>
                <input
                  type="date"
                  max={istToday()}
                  required
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </Field>
              {mode === 'payment' && (
                <Field label={t('owner.paymentMethod')}>
                  <select value={channel} onChange={(event) => setChannel(event.target.value)}>
                    <option value="CASH">{t('owner.paymentCash')}</option>
                    <option value="UPI">{t('owner.paymentUpi')}</option>
                  </select>
                </Field>
              )}
            </>
          )}
          <Field label={t(mode === 'reverse' ? 'owner.reverseReason' : 'owner.note')}>
            <textarea
              value={note}
              required
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </fieldset>
        <Problem error={action.error} />
        <Button className={css.wide} disabled={action.isPending}>
          {t(locked ? 'owner.retry' : mode === 'reverse' ? 'owner.reverse' : 'owner.save')}
        </Button>
      </form>
    </Sheet>
  );
}

function CustomerOrders({ id }: { id: string }) {
  const t = useT();
  const query = usePaged<Order>(
    ['orders', 'list', 'customer', id],
    `/admin/orders?customerId=${id}&limit=24`,
  );
  return (
    <div className={css.stack}>
      <QueryStatus query={query} />
      {query.data?.pages
        .flatMap((page) => page.items)
        .map((order) => (
          <OrderRow key={order.id} order={order} />
        ))}
      {query.data?.pages[0]?.items.length === 0 && <EmptyState title={t('owner.emptyOrders')} />}
      <MoreRows query={query} />
    </div>
  );
}
function CustomerNotes({ id }: { id: string }) {
  const t = useT();
  const words = useWords();
  const [body, setBody] = useState('');
  const notes = usePaged<{ id: string; body: string; createdAt: string }>(
    ['customers', 'notes', id],
    `/admin/customers/${id}/notes?limit=24`,
  );
  const { clearDirty } = useUnsavedGuard(!!body.trim());
  const action = useAction(
    async () => {
      await api(`/admin/customers/${id}/notes`, 'POST', { body });
      setBody('');
      clearDirty();
    },
    [
      ['customers', 'notes', id],
      ['customers', 'detail', id],
    ],
    'owner.saved',
  );
  return (
    <div className={css.stack}>
      <form
        className={css.card}
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate();
        }}
      >
        <Field label={t('owner.notePlaceholder')}>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={2000}
            required
          />
        </Field>
        <Problem error={action.error} />
        <Button disabled={action.isPending}>{t('owner.addNote')}</Button>
      </form>
      <QueryStatus query={notes} />
      {notes.data?.pages
        .flatMap((page) => page.items)
        .map((note) => (
          <article className={css.card} key={note.id}>
            <p>{note.body}</p>
            <span className={css.date}>{words.moment(note.createdAt)}</span>
          </article>
        ))}
      {notes.data?.pages[0]?.items.length === 0 && <EmptyState title={t('owner.emptyNotes')} />}
      <MoreRows query={notes} />
    </div>
  );
}
function CustomerSettings({ customer }: { customer: Customer }) {
  const t = useT();
  const [allowed, setAllowed] = useState(customer.creditAllowed);
  const [limit, setLimit] = useState(moneyInput(customer.creditLimitPaise));
  const [area, setArea] = useState(customer.area);
  const [tags, setTags] = useState(customer.tags.join(', '));
  const [dirty, setDirty] = useState(false);
  const { clearDirty } = useUnsavedGuard(dirty);
  const action = useAction(
    async () => {
      await api(`/admin/customers/${customer.id}`, 'PATCH', {
        creditAllowed: allowed,
        creditLimitPaise: limit ? rupeesToPaise(limit) : null,
        area,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setDirty(false);
      clearDirty();
    },
    [
      ['customers', 'detail', customer.id],
      ['customers', 'list'],
    ],
    'owner.saved',
  );
  return (
    <form
      className={css.card}
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        action.mutate();
      }}
    >
      <label className={css.check}>
        <input
          type="checkbox"
          checked={allowed}
          onChange={(event) => setAllowed(event.target.checked)}
        />
        {t('owner.creditAllowed')}
      </label>
      <Field label={t('owner.creditLimit')}>
        <input
          inputMode="decimal"
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
          required={allowed}
          pattern="[0-9]+([.][0-9]{1,2})?"
        />
      </Field>
      <Field label={t('owner.area')}>
        <input value={area} maxLength={120} onChange={(event) => setArea(event.target.value)} />
      </Field>
      <Field label={t('owner.tags')}>
        <input value={tags} onChange={(event) => setTags(event.target.value)} />
      </Field>
      <Problem error={action.error} />
      <Button disabled={action.isPending}>{t('owner.save')}</Button>
    </form>
  );
}
