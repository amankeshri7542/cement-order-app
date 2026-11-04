'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  DateChips,
  EmptyState,
  Field,
  MoneyText,
  QuantityStepper,
  SearchBar,
  Sheet,
  StatusPill,
} from '@shiv/design';
import {
  dayLabel,
  money,
  refusalReasons,
  type InboxCard,
  type OrderChanges,
  type Page,
  type Product,
  type RefusalReason,
  rateChangeReasons,
} from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { ApiError, api } from '../../lib/api';
import { useLanguage, useT, useWords } from '../../lib/i18n';
import { useAction, useDebounced, useOwner } from '../../lib/owner';
import { Problem, QueryStatus, rupeesToPaise } from './common';
import css from './owner.module.css';

type Inbox = { count: number; items: InboxCard[]; serverNow: string };
type Decision = {
  orderId: string;
  status: string;
  version: number;
  holdUntil: string;
  serverNow: string;
};
type Preview = {
  title: string;
  body: string;
  totalPaise?: number;
  short?: { productId: string; name: string; have: number | null; need: number }[];
  problem?: { code: string; details?: { floorPaise?: number } };
};
const inboxKey = ['inbox'] as const;

/** The waiting orders, oldest first. Everyone who may confirm reads the same list. */
export function useInbox() {
  const { can, shopId } = useOwner();
  return useQuery({
    enabled: can('orders.confirm'),
    queryKey: [...inboxKey, shopId],
    queryFn: () => api<Inbox>(`/admin/inbox${shopId ? `?locationId=${shopId}` : ''}`),
    staleTime: 5000,
    refetchInterval: 30000,
  });
}

/**
 * A second tap on the next card is the risk on a phone. After any tap every Pakka button is
 * inert for half a second, so a double tap can only ever confirm the card it was meant for.
 */
let inertUntil = 0;
const isInert = () => Date.now() < inertUntil;
const startInert = () => {
  inertUntil = Date.now() + 500;
};

/** Counts down from the server's own clock, so a phone with the wrong time still shows 10. */
function useHoldSeconds(holdUntil: string | null, serverNow: string) {
  const [left, setLeft] = useState(() =>
    holdUntil ? Math.max(0, Math.ceil((Date.parse(holdUntil) - Date.parse(serverNow)) / 1000)) : 0,
  );
  useEffect(() => {
    if (!left) return;
    const timer = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return left;
}

function UndoLine({
  name,
  refused,
  holdUntil,
  serverNow,
  onUndo,
  onGone,
}: {
  name: string;
  refused: boolean;
  holdUntil: string;
  serverNow: string;
  onUndo: () => void;
  onGone: () => void;
}) {
  const t = useT();
  const left = useHoldSeconds(holdUntil, serverNow);
  const { notice } = useOwner();
  const called = useRef(false);
  useEffect(() => {
    if (left || called.current) return;
    called.current = true;
    notice(t('owner.pakka.sent'));
    onGone();
  }, [left]);
  return (
    <div className={css.undoLine} role="status">
      <span>{t(refused ? 'owner.pakka.refusedDone' : 'owner.pakka.done', { name })}</span>
      {!!left && (
        <Button variant="secondary" onClick={onUndo}>
          {t('owner.pakka.undo', { seconds: left })}
        </Button>
      )}
    </div>
  );
}

function DecidedLine({ card }: { card: InboxCard }) {
  const t = useT();
  const words = useWords();
  const decided = card.decided;
  return (
    <p className={css.decidedLine} role="status">
      {decided?.byName
        ? t('owner.pakka.decidedBy', {
            name: decided.byName,
            time: words.moment(decided.at),
          })
        : t('owner.pakka.decidedSomeone')}{' '}
      <Link href={`/orders/${card.id}`} className={css.inlineLink}>
        {t('owner.viewOrder')}
      </Link>
    </p>
  );
}

/** What the customer gets, from the server, so what is read here is what goes. */
function CustomerGets({ name, preview }: { name: string; preview?: Preview | undefined }) {
  const t = useT();
  if (!preview?.body) return null;
  return (
    <div className={css.customerGets}>
      <strong>{t('owner.change.customerGets', { name })}</strong>
      <p>{preview.title}</p>
      <p>{preview.body}</p>
    </div>
  );
}

function ChangeSheet({
  card,
  close,
  decide,
}: {
  card: InboxCard;
  close: () => void;
  decide: (changes: OrderChanges) => Promise<void>;
}) {
  const t = useT();
  const { can, shops } = useOwner();
  const [lines, setLines] = useState(() =>
    card.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      unit: line.packSize || line.unit,
      quantity: line.quantity,
      listPricePaise: line.listPricePaise,
      rupees: String(line.pricePaise / 100),
      startRupees: String(line.pricePaise / 100),
    })),
  );
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState(String(card.deliveryFeePaise / 100));
  const [date, setDate] = useState(card.blockers.includes('DATE_PASSED') ? '' : card.deliveryDate);
  const [payment, setPayment] = useState<'COD' | 'CREDIT'>(
    card.paymentMethod === 'CREDIT' ? 'CREDIT' : 'COD',
  );
  const [locationId, setLocationId] = useState(card.locationId);
  const [fixes, setFixes] = useState<string[]>([]);
  const [override, setOverride] = useState(false);
  const [overLimit, setOverLimit] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const choices = shops.filter((shop) => can('orders.change', shop.id));
  // Someone may be halfway through typing a rate, so this must never throw.
  const paiseOf = (rupees: string) => {
    try {
      return rupeesToPaise(rupees);
    } catch {
      return null;
    }
  };
  const moneyOk =
    !card.can.rate ||
    (paiseOf(fee) !== null && lines.every((line) => (paiseOf(line.rupees) ?? 0) > 0));
  const changes: OrderChanges = {
    lines: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      // Only a rate someone typed: otherwise the server works it out, slabs included.
      ...(card.can.rate && moneyOk && line.rupees !== line.startRupees
        ? { pricePaise: paiseOf(line.rupees)! }
        : {}),
    })),
    ...(reason ? { reason: reason as NonNullable<OrderChanges['reason']> } : {}),
    ...(card.can.rate && moneyOk ? { deliveryFeePaise: paiseOf(fee)! } : {}),
    ...(date ? { deliveryDate: date } : {}),
    paymentMethod: payment,
    locationId,
    stockFixes: fixes,
    overrideLimit: override,
  };
  const wanted = useDebounced(JSON.stringify(changes), 300);
  const preview = useQuery({
    queryKey: ['inbox', 'preview', card.id, wanted],
    enabled: lines.length > 0 && moneyOk,
    queryFn: () =>
      api<Preview>(`/admin/orders/${card.id}/preview`, 'POST', {
        decision: 'CONFIRM',
        changes: JSON.parse(wanted) as OrderChanges,
      }),
    retry: false,
  });
  const found = useQuery({
    queryKey: ['products', 'pick', q],
    enabled: q.trim().length > 1,
    queryFn: () => api<Page<Product>>(`/admin/products?limit=8&q=${encodeURIComponent(q)}`),
  });
  const short = (preview.data?.short ?? []).filter((row) => !fixes.includes(row.productId));
  const blockedRate = preview.data?.problem?.code === 'RATE_CAP';
  const bhada = useQuery({
    queryKey: ['inbox', 'bhada', card.id],
    queryFn: () =>
      api<{ items: { vehicle: string; feePaise: number }[] }>(`/admin/inbox/${card.id}/bhada`),
  });
  // The same key for every try, so a lost answer asks once.
  const askKey = useRef(crypto.randomUUID());
  const askOwner = useAction(
    async () => {
      await api(`/admin/orders/${card.id}/ask-owner`, 'POST', {
        expectedVersion: card.version,
        changes,
        idempotencyKey: askKey.current,
      });
      close();
    },
    [['approvals']],
    'owner.change.asked',
  );
  const shopName = shops.find((shop) => shop.id === locationId)?.name ?? card.shopName;
  const total = preview.data?.totalPaise;
  const canAct = !busy && moneyOk && lines.length > 0 && !short.length && !blockedRate && !!date;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await decide(changes);
      close();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'CREDIT_LIMIT_EXCEEDED') setOverLimit(true);
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={t('owner.change.title')}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form
        className={css.stack}
        onSubmit={(event) => {
          event.preventDefault();
          if (canAct) void submit();
        }}
      >
        {lines.map((line, index) => {
          const update = (patch: Partial<typeof line>) =>
            setLines(lines.map((row, at) => (at === index ? { ...row, ...patch } : row)));
          const shortHere = short.find((row) => row.productId === line.productId);
          return (
            <div className={css.changeLine} key={line.productId}>
              <div className={css.row}>
                <strong>{line.name}</strong>
                <Button
                  variant="ghost"
                  disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((_, at) => at !== index))}
                >
                  {t('owner.change.removeLine', { name: line.name })}
                </Button>
              </div>
              <QuantityStepper
                label={`${t('owner.quantity')} (${line.unit})`}
                value={line.quantity}
                onChange={(quantity) => update({ quantity })}
                decreaseLabel={t('owner.decrease', { name: line.name })}
                increaseLabel={t('owner.increase', { name: line.name })}
              />
              {card.can.rate && (
                <>
                  <Field label={t('owner.change.rate')}>
                    <input
                      inputMode="decimal"
                      pattern="[0-9]+([.][0-9]{1,2})?"
                      required
                      value={line.rupees}
                      onChange={(event) => update({ rupees: event.target.value })}
                    />
                  </Field>
                  <p className={css.hint}>
                    {t('owner.change.listNote', { rate: money(line.listPricePaise) })}
                    {card.rateCapPercent !== null &&
                      ` ${t('owner.change.capNote', {
                        rate: money(
                          Math.ceil((line.listPricePaise * (100 - card.rateCapPercent)) / 100),
                        ),
                      })}`}
                  </p>
                </>
              )}
              {shortHere && (
                <div className={css.warnBlock} role="alert">
                  <p>
                    {shortHere.have === null
                      ? t('owner.change.shortHidden', {
                          shop: shopName,
                          need: shortHere.need,
                          name: shortHere.name,
                        })
                      : t('owner.change.short', {
                          shop: shopName,
                          have: shortHere.have,
                          need: shortHere.need,
                          name: shortHere.name,
                        })}
                  </p>
                  {can('stock.adjust', locationId) && (
                    <Button
                      variant="secondary"
                      onClick={() => setFixes([...fixes, line.productId])}
                    >
                      {t('owner.change.fixStock')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <SearchBar
          label={t('owner.change.addItem')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {found.data?.items
          .filter((product) => !lines.some((line) => line.productId === product.id))
          .slice(0, 5)
          .map((product) => (
            <Button
              key={product.id}
              variant="secondary"
              onClick={() => {
                setLines([
                  ...lines,
                  {
                    productId: product.id,
                    name: product.name,
                    unit: product.packSize || product.unit,
                    quantity: product.minQuantity,
                    listPricePaise: product.pricePaise,
                    rupees: String(product.pricePaise / 100),
                    startRupees: String(product.pricePaise / 100),
                  },
                ]);
                setSearch('');
              }}
            >
              {product.name} · {money(product.pricePaise)}
            </Button>
          ))}
        {choices.length > 1 && (
          <Field label={t('owner.change.shop')}>
            <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              {choices.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {card.can.rate && (
          <Field label={t('owner.change.delivery')}>
            <input
              inputMode="decimal"
              pattern="[0-9]+([.][0-9]{1,2})?"
              required
              value={fee}
              onChange={(event) => setFee(event.target.value)}
            />
          </Field>
        )}
        {card.can.rate && !!bhada.data?.items.length && (
          <div className={css.chips} aria-label={t('owner.change.bhadaOptions')}>
            {bhada.data.items.map((option) => (
              <Button
                key={option.vehicle}
                type="button"
                variant="secondary"
                onClick={() => setFee(String(option.feePaise / 100))}
              >
                {option.vehicle}: {money(option.feePaise)}
              </Button>
            ))}
          </div>
        )}
        {card.can.rate && lines.some((line) => line.rupees !== line.startRupees) && (
          <Field label={t('owner.change.reason')}>
            <select value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="" />
              {rateChangeReasons.map((name) => (
                <option key={name} value={name}>
                  {t(`owner.change.reason.${name}` as MessageKey)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('owner.change.day')}>
          <DateChips
            value={date}
            onChange={setDate}
            labels={{
              today: t('owner.today'),
              tomorrow: t('owner.tomorrow'),
              dayAfter: t('owner.dayAfter'),
              pick: t('owner.pickDate'),
            }}
          />
        </Field>
        {card.can.credit && (
          <Field label={t('owner.change.payment')}>
            <select
              value={payment}
              onChange={(event) => setPayment(event.target.value === 'CREDIT' ? 'CREDIT' : 'COD')}
            >
              <option value="COD">{t('owner.pakka.paymentCash')}</option>
              {card.customer.creditAllowed && (
                <option value="CREDIT">{t('owner.pakka.paymentCredit')}</option>
              )}
            </select>
          </Field>
        )}
        {card.can.credit && !card.customer.creditAllowed && (
          <p className={css.hint}>{t('owner.change.noCredit')}</p>
        )}
        {overLimit && card.can.override && (
          <label className={css.check}>
            <input
              type="checkbox"
              checked={override}
              onChange={(event) => setOverride(event.target.checked)}
            />
            {t('owner.change.overLimit')}
          </label>
        )}
        <CustomerGets name={card.customer.name} preview={preview.data} />
        {blockedRate && (
          <p className={css.error} role="alert">
            {t('error.RATE_CAP')}
          </p>
        )}
        {preview.error ? <Problem error={preview.error} /> : null}
        <Problem error={error} />
        <Problem error={askOwner.error} />
        {(blockedRate || overLimit) && !can('orders.credit.override', card.locationId) && (
          <Button
            type="button"
            variant="secondary"
            className={css.wide}
            disabled={askOwner.isPending}
            onClick={() => askOwner.mutate(undefined)}
          >
            {t('owner.change.askOwner')}
          </Button>
        )}
        <div className={css.sheetBar}>
          <Button className={css.wide} disabled={!canAct}>
            {blockedRate
              ? t('error.RATE_CAP')
              : short.length
                ? t('owner.change.firstStock')
                : !date
                  ? t('owner.pakka.chooseDay')
                  : total !== undefined
                    ? t('owner.change.confirmAmount', { total: money(total) })
                    : t('owner.pakka.confirm')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function RefuseSheet({
  card,
  close,
  decide,
}: {
  card: InboxCard;
  close: () => void;
  decide: (reason: RefusalReason, note?: string) => Promise<void>;
}) {
  const t = useT();
  const [other, setOther] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const send = async (reason: RefusalReason, words?: string) => {
    setBusy(true);
    setError(null);
    try {
      await decide(reason, words);
      close();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={t('owner.refuse.title')}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!busy) close();
      }}
    >
      <div className={css.stack}>
        <p>{card.customer.name}</p>
        {refusalReasons
          .filter((reason) => reason !== 'OTHER')
          .map((reason) => (
            // One tap sends, and Wapas lo still protects it for 10 seconds.
            <Button
              key={reason}
              variant="secondary"
              disabled={busy}
              onClick={() => void send(reason)}
            >
              {t(`owner.refuse.${reason}` as 'owner.refuse.OTHER')}
            </Button>
          ))}
        <Button variant="secondary" disabled={busy} onClick={() => setOther(true)}>
          {t('owner.refuse.OTHER')}
        </Button>
        {other && (
          <form
            className={css.stack}
            onSubmit={(event) => {
              event.preventDefault();
              if (note.trim()) void send('OTHER', note.trim());
            }}
          >
            <Field label={t('owner.refuse.write')}>
              <textarea
                required
                maxLength={200}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <Button className={css.wide} disabled={busy || !note.trim()}>
              {t('owner.refuse.send')}
            </Button>
          </form>
        )}
        <Problem error={error} />
      </div>
    </Sheet>
  );
}

function OrderCard({ card, lamp }: { card: InboxCard; lamp: boolean }) {
  const t = useT();
  const words = useWords();
  const { language } = useLanguage();
  const { offline, me } = useOwner();
  const client = useQueryClient();
  // The same key for every try at this version, so a retry is the same decision.
  const key = useRef(crypto.randomUUID());
  const [sheet, setSheet] = useState<'change' | 'refuse' | null>(null);
  const [slow, setSlow] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const [held, setHeld] = useState<(Decision & { refused: boolean }) | null>(null);
  const [gone, setGone] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: inboxKey });
  const newKey = () => {
    key.current = crypto.randomUUID();
  };
  // A new version of the card is a new decision.
  useEffect(() => {
    newKey();
  }, [card.version]);
  const decide = useAction(
    (run: () => Promise<Decision & { refused: boolean }>) => run(),
    [inboxKey, ['orders', 'list']],
  );
  const send = async (run: () => Promise<Decision & { refused: boolean }>) => {
    startInert();
    setProblem(null);
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 5000);
    try {
      setHeld(await decide.mutateAsync(run));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ORDER_CHANGED') newKey();
      await refresh();
      if (!(error instanceof ApiError && error.code === 'ALREADY_DECIDED')) throw error;
    } finally {
      clearTimeout(timer);
      setSlow(false);
    }
  };
  const confirm = (changes?: OrderChanges) =>
    send(async () => {
      const result = await api<Decision>(`/admin/orders/${card.id}/confirm`, 'POST', {
        expectedVersion: card.version,
        decisionKey: key.current,
        ...(changes ? { changes } : {}),
      });
      return { ...result, refused: false };
    });
  const refuse = (reason: RefusalReason, note?: string) =>
    send(async () => {
      const result = await api<Decision>(`/admin/orders/${card.id}/refuse`, 'POST', {
        expectedVersion: card.version,
        decisionKey: key.current,
        reason,
        ...(note ? { note } : {}),
      });
      return { ...result, refused: true };
    });
  const undo = useAction(
    (version: number) =>
      api(`/admin/orders/${card.id}/undo-decision`, 'POST', { expectedVersion: version }),
    [inboxKey, ['orders', 'list']],
  );
  const takeBack = async (version: number) => {
    setProblem(null);
    try {
      await undo.mutateAsync(version);
      setHeld(null);
      newKey();
    } catch (error) {
      setProblem(error);
      // Someone else moved it on, so there is nothing left here to take back.
      if (error instanceof ApiError && error.code === 'ORDER_CHANGED') {
        setHeld(null);
        await refresh();
      }
    }
  };

  // The decision is on hold: this phone's, or another's after a reload.
  const hold =
    held ??
    (card.decided?.holdUntil && card.decided.byId === me.id
      ? {
          orderId: card.id,
          status: card.decided.status,
          version: card.version,
          holdUntil: card.decided.holdUntil,
          serverNow: card.serverNow,
          refused: card.decided.status !== 'CONFIRMED',
        }
      : null);
  if (gone) return null;
  if (hold)
    return (
      <>
        <UndoLine
          name={card.customer.name}
          refused={hold.refused}
          holdUntil={hold.holdUntil}
          serverNow={hold.serverNow}
          onUndo={() => void takeBack(hold.version)}
          onGone={() => {
            setGone(true);
            void refresh();
          }}
        />
        <Problem error={problem} />
      </>
    );
  if (card.decided) return <DecidedLine card={card} />;

  const blocked = card.blockers.includes('DATE_PASSED');
  const canTap = card.can.confirm && !blocked && !offline;
  const sourceWords =
    card.source === 'WEB'
      ? t('owner.pakka.fromWeb')
      : card.source === 'APP'
        ? t('owner.pakka.fromApp')
        : '';
  return (
    <article className={css.pakkaCard} data-order={card.id}>
      <div className={css.row}>
        <h3>
          <Link href={`/customers/${card.customer.id}`}>{card.customer.name}</Link>
        </h3>
        <span className={css.date}>
          {words.moment(card.createdAt)}
          {card.source ? ` · ${t(`status.${card.source}` as 'status.APP')}` : ''}
        </span>
      </div>
      {card.notes ? (
        <blockquote className={css.said}>
          <span className={css.hint}>{t('owner.pakka.customerNote')}</span>
          <p>{card.notes}</p>
        </blockquote>
      ) : (
        !!sourceWords && <p className={css.hint}>{sourceWords}</p>
      )}
      <div className={css.ledger}>
        {card.lines.map((line) => (
          <div className={css.ledgerLine} key={line.id}>
            <div>
              <strong>
                {line.quantity} {line.packSize || line.unit} {line.name}
              </strong>
              <p className={css.hint}>
                {line.quantity} × {money(line.pricePaise)}
                {line.pricePaise !== line.listPricePaise &&
                  ` · ${t('owner.pakka.listRate', { rate: money(line.listPricePaise) })}`}
              </p>
              {line.currentListPricePaise !== line.pricePaise && (
                <p className={css.warnText}>
                  {t('owner.pakka.rateMoved', { rate: money(line.currentListPricePaise) })}
                </p>
              )}
            </div>
            <div className={css.amount}>
              <MoneyText value={line.lineTotalPaise} />
            </div>
          </div>
        ))}
        {!!card.deliveryFeePaise && (
          <div className={css.ledgerLine}>
            <div>{t('owner.deliveryFee')}</div>
            <div className={css.amount}>
              <MoneyText value={card.deliveryFeePaise} />
            </div>
          </div>
        )}
      </div>
      <p className={css.factsLine}>
        {[
          card.paymentMethod === 'CREDIT'
            ? t('owner.pakka.paymentCredit')
            : card.paid
              ? t('owner.pakka.paymentPaid')
              : t('owner.pakka.paymentCash'),
          t('owner.pakka.when', { date: dayLabel(card.deliveryDate, language) }),
          card.area,
          card.shopName,
          card.customer.orders > 1
            ? t('owner.pakka.ordersBefore', { count: card.customer.orders - 1 })
            : t('owner.pakka.newNumber'),
          card.customer.balancePaise
            ? t('owner.pakka.owes', { amount: money(card.customer.balancePaise) })
            : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {card.blockers.includes('DATE_PASSED') && (
        <p className={css.warnBlock}>{t('owner.pakka.blockDate')}</p>
      )}
      {card.blockers.includes('PRODUCT_OFF') && (
        <p className={css.warnBlock}>{t('owner.pakka.blockProduct')}</p>
      )}
      {!card.can.confirm && <p className={css.hint}>{t('owner.pakka.onlyManagers')}</p>}
      <Problem error={problem ?? decide.error} />
      {slow && (
        <p className={css.hint} role="status">
          {t('owner.pakka.slow')}
        </p>
      )}
      {/* On a phone the total and main button stay on screen while the card is in view. */}
      <div className={css.payBar}>
        <div className={css.row}>
          <span>{card.customer.name}</span>
          <span className={css.barTotal}>
            <MoneyText value={card.totalPaise} />
          </span>
        </div>
        {card.can.confirm && (
          <Button
            className={`${css.wide} ${lamp ? css.lamp : ''}`}
            disabled={!canTap || decide.isPending}
            onClick={() => {
              if (!isInert()) void confirm().catch(setProblem);
            }}
          >
            {decide.isPending
              ? t('owner.pakka.confirming')
              : blocked
                ? t('owner.pakka.chooseDay')
                : t('owner.pakka.confirm')}
          </Button>
        )}
      </div>
      <div className={css.underBar}>
        {card.can.change && (
          <Button variant="secondary" disabled={offline} onClick={() => setSheet('change')}>
            {t('owner.pakka.change')}
          </Button>
        )}
        {card.can.refuse && (
          <Button variant="secondary" disabled={offline} onClick={() => setSheet('refuse')}>
            {t('owner.pakka.cannot')}
          </Button>
        )}
        <a className={css.inlineLink} href={`tel:${card.customer.phone}`}>
          {t('owner.pakka.call')}
        </a>
      </div>
      {sheet === 'change' && (
        <ChangeSheet card={card} close={() => setSheet(null)} decide={confirm} />
      )}
      {sheet === 'refuse' && (
        <RefuseSheet card={card} close={() => setSheet(null)} decide={refuse} />
      )}
    </article>
  );
}

/** Papa's phone opens here. Oldest first, as the person waiting longest is the one who will call. */
export function PakkaQueue({ limit }: { limit?: number }) {
  const t = useT();
  const { can } = useOwner();
  const inbox = useInbox();
  if (!can('orders.confirm')) return null;
  const items = inbox.data?.items ?? [];
  const shown = limit ? items.slice(0, limit) : items;
  // The lamp goes on the first card that one tap can really finish, and only there.
  const firstClean = items.find((card) => card.clean && card.can.confirm && !card.decided)?.id;
  return (
    <section className={css.stack} aria-label={t('owner.pakka.title')}>
      <div className={css.row}>
        <h2>{t('owner.pakka.title')}</h2>
        {!!inbox.data?.count && <StatusPill label={String(inbox.data.count)} tone="neutral" />}
      </div>
      <QueryStatus query={inbox} />
      {inbox.data && !items.length && (
        <EmptyState title={t('owner.pakka.empty')} action={<p>{t('owner.pakka.emptyBody')}</p>} />
      )}
      {shown.map((card) => (
        <OrderCard key={card.id} card={card} lamp={card.id === firstClean} />
      ))}
      {limit && items.length > limit && (
        <Link href="/inbox" className={css.inlineLink}>
          {t('owner.pakka.moreCount', { count: items.length - limit })}
        </Link>
      )}
    </section>
  );
}

/** A card opened from a notification, whichever shop or state it is in. */
export function InboxOne({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['inbox', 'one', id],
    queryFn: () => api<InboxCard>(`/admin/inbox/${id}`),
  });
  return (
    <>
      <QueryStatus query={query} />
      {query.data && (
        <OrderCard
          key={query.data.id}
          card={query.data}
          lamp={query.data.clean && query.data.can.confirm}
        />
      )}
    </>
  );
}
