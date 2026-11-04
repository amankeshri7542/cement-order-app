'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, Sheet, Skeleton, StatusPill } from '@shiv/design';
import { cleanDaysTarget, inventorySchema, momentLabel } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { ApiError, api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction, useIsWide, useOwner, useUnsavedGuard } from '../../lib/owner';
import { PageHeader, Problem, QueryStatus, useShopChoice } from './common';
import { MaalList } from './maal';
import { useApprovals } from './manzoori';
import css from './owner.module.css';

type Level = { locationId: string; quantity: number | null; lowStockAt: number; isOn: boolean };
type Item = {
  id: string;
  name: string;
  unit: string;
  category: string;
  stockMode: string;
  sourcing: string;
  onTheRoad: number;
  shops: Level[];
};
type ShopRow = {
  id: string;
  name: string;
  stockStartedAt: string | null;
  cleanDays: number | null;
  openCount: { id: string; status: string; opening: boolean } | null;
  hidden: boolean;
};
type Table = { shops: ShopRow[]; items: Item[] };
const stockKey = ['stock'];
const transfersKey = ['stock', 'transfers'];
const tabs = ['stock', 'transfer', 'count', 'maal'] as const;
type Tab = (typeof tabs)[number];

function useStockTable() {
  return useQuery({ queryKey: stockKey, queryFn: () => api<Table>('/admin/stock') });
}

export function Stock() {
  const t = useT();
  return (
    <Suspense fallback={<Skeleton label={t('owner.loading')} />}>
      <StockPage />
    </Suspense>
  );
}

function StockPage() {
  const t = useT();
  const { can } = useOwner();
  // An old link to the goods list, or anything else that names a tab, opens on it.
  const asked = useSearchParams().get('tab');
  const [tab, setTab] = useState<Tab>(tabs.find((name) => name === asked) ?? 'stock');
  const asks = useApprovals();
  const waiting = can('approvals.decide') ? (asks.data?.items.length ?? 0) : 0;
  const shown = tabs.filter((name) =>
    name === 'maal'
      ? can('products.edit')
      : name === 'transfer'
        ? can('stock.transfer')
        : name === 'count'
          ? can('stock.count')
          : true,
  );
  return (
    <>
      <PageHeader title={t('owner.stock')} />
      {can('orders.create') && (
        <p>
          <Link href="/orders/new?source=WALK_IN" className={css.inlineLink}>
            {t('owner.walkIn')}
          </Link>
        </p>
      )}
      {waiting > 0 && (
        <p>
          <Link className={css.inlineLink} href="/manzoori">
            {t('owner.stockPage.waiting', { count: waiting })} <span aria-hidden="true">→</span>
          </Link>
        </p>
      )}
      {shown.length > 1 && (
        <div className={css.chips} role="tablist" aria-label={t('owner.stock')}>
          {shown.map((name) => (
            <Button
              key={name}
              role="tab"
              aria-selected={tab === name}
              variant={tab === name ? 'primary' : 'secondary'}
              onClick={() => setTab(name)}
            >
              {t(`owner.stockPage.tab.${name}` as MessageKey)}
            </Button>
          ))}
        </div>
      )}
      {tab === 'stock' && <StockTab />}
      {tab === 'transfer' && <TransferTab />}
      {tab === 'count' && <CountTab />}
      {tab === 'maal' && <MaalList />}
    </>
  );
}

/** What one shop's figure says, in words, as "AVAILABILITY" goods have no number. */
function Figure({ item, level, shop }: { item: Item; level: Level | undefined; shop: ShopRow }) {
  const t = useT();
  if (shop.hidden) return <span>{t('owner.stockPage.counting')}</span>;
  if (item.stockMode === 'AVAILABILITY')
    return (
      <StatusPill
        tone={level?.isOn ? 'green' : 'red'}
        label={t(level?.isOn ? 'owner.stockPage.have' : 'owner.stockPage.none')}
      />
    );
  const quantity = level?.quantity ?? 0;
  if (quantity === 0) return <StatusPill tone="red" label={t('owner.stockPage.none')} />;
  return (
    <span className={css.amount}>
      {quantity}
      {quantity <= (level?.lowStockAt ?? 0) ? ` · ${t('owner.lowStock')}` : ''}
    </span>
  );
}

function StockTab() {
  const t = useT();
  const { can, shopId } = useOwner();
  const wide = useIsWide();
  const table = useStockTable();
  const [receiving, setReceiving] = useState<{ item: Item; kind: GoodsKind } | null>(null);
  const [damage, setDamage] = useState<Item | null>(null);
  const [history, setHistory] = useState<Item | null>(null);
  const allShops = table.data?.shops ?? [];
  const shops = shopId ? allShops.filter((shop) => shop.id === shopId) : allShops;
  const items = table.data?.items ?? [];
  const level = (item: Item, id: string) => item.shops.find((row) => row.locationId === id);
  const total = (item: Item) =>
    shops.reduce((sum, shop) => sum + (level(item, shop.id)?.quantity ?? 0), 0);
  const actions = (item: Item) => (
    <div className={css.actions}>
      {can('stock.receive') && item.stockMode === 'COUNTED' && (
        <Button onClick={() => setReceiving({ item, kind: 'PURCHASE_IN' })}>
          {t('owner.stockReceived')}
        </Button>
      )}
      {can('stock.receive') && item.stockMode === 'COUNTED' && (
        <Button variant="secondary" onClick={() => setReceiving({ item, kind: 'RETURN' })}>
          {t('owner.stockPage.returned')}
        </Button>
      )}
      {can('stock.adjust') && item.stockMode === 'COUNTED' && (
        <Button
          variant="secondary"
          onClick={() => setReceiving({ item, kind: 'MANUAL_ADJUSTMENT' })}
        >
          {t('owner.stockPage.correct')}
        </Button>
      )}
      {can('stock.report') && item.stockMode === 'COUNTED' && (
        <Button variant="secondary" onClick={() => setDamage(item)}>
          {t('owner.stockPage.damage')}
        </Button>
      )}
    </div>
  );
  return (
    <div className={css.stack}>
      <QueryStatus query={table} />
      {shops.map((shop) => (
        <p className={css.sub} key={shop.id}>
          {shop.name}:{' '}
          {shop.cleanDays === null
            ? t('owner.stockPage.notOpened')
            : t('owner.stockPage.cleanDays', { count: shop.cleanDays, target: cleanDaysTarget })}
        </p>
      ))}
      {table.data && !items.length && <EmptyState title={t('owner.emptyStock')} />}
      {wide ? (
        <table className={css.table}>
          <thead>
            <tr>
              <th>{t('owner.stockPage.item')}</th>
              {shops.map((shop) => (
                <th key={shop.id}>{shop.name}</th>
              ))}
              {shops.length > 1 && <th>{t('owner.stockPage.total')}</th>}
              <th>{t('owner.stockPage.onRoad')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <button type="button" className={css.linkButton} onClick={() => setHistory(item)}>
                    {item.name}
                  </button>
                  <div className={css.sub}>{item.unit}</div>
                </td>
                {shops.map((shop) => (
                  <td key={shop.id}>
                    <Figure item={item} level={level(item, shop.id)} shop={shop} />
                  </td>
                ))}
                {shops.length > 1 && (
                  <td className={css.amount}>
                    {item.stockMode === 'COUNTED' && !shops.some((shop) => shop.hidden)
                      ? total(item)
                      : ''}
                  </td>
                )}
                <td className={css.amount}>{item.onTheRoad || ''}</td>
                <td>{actions(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className={css.stack}>
          {items.map((item) => (
            <article className={css.card} key={item.id}>
              <button type="button" className={css.linkButton} onClick={() => setHistory(item)}>
                {item.name}
              </button>
              <p className={css.sub}>{item.unit}</p>
              {shops.map((shop) => (
                <div className={css.row} key={shop.id}>
                  <span>{shop.name}</span>
                  <Figure item={item} level={level(item, shop.id)} shop={shop} />
                </div>
              ))}
              {item.onTheRoad > 0 && (
                <p>{t('owner.stockPage.onRoadCount', { count: item.onTheRoad })}</p>
              )}
              {actions(item)}
            </article>
          ))}
        </div>
      )}
      <p className={css.sub}>{t('owner.stockPage.ledgerNote')}</p>
      {receiving && (
        <ReceiveSheet
          key={receiving.kind}
          item={receiving.item}
          kind={receiving.kind}
          close={() => setReceiving(null)}
        />
      )}
      {damage && <DamageSheet item={damage} close={() => setDamage(null)} />}
      {history && <HistorySheet item={history} close={() => setHistory(null)} />}
    </div>
  );
}

function HistorySheet({ item, close }: { item: Item; close: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const moves = useQuery({
    queryKey: ['stock', 'moves', item.id],
    queryFn: () =>
      api<{
        items: {
          id: string;
          kind: string;
          quantity: number;
          balanceAfter: number;
          createdAt: string;
        }[];
      }>(`/admin/products/${item.id}/movements?limit=30`),
  });
  return (
    <Sheet title={item.name} closeLabel={t('owner.close')} onClose={close}>
      <QueryStatus query={moves} />
      {moves.data && !moves.data.items.length && <p>{t('owner.stockPage.noMoves')}</p>}
      <table className={css.table}>
        <tbody>
          {moves.data?.items.map((move) => (
            <tr key={move.id}>
              <td>{momentLabel(move.createdAt, language)}</td>
              <td>{t(`owner.stockPage.kind.${move.kind}` as MessageKey)}</td>
              <td className={css.amount}>
                {move.quantity > 0 ? '+' : ''}
                {move.quantity}
              </td>
              <td className={css.amount}>{move.balanceAfter}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  );
}

type GoodsKind = 'PURCHASE_IN' | 'RETURN' | 'MANUAL_ADJUSTMENT';
const goodsWords: Record<GoodsKind, { title: MessageKey; quantity: MessageKey }> = {
  PURCHASE_IN: { title: 'owner.stockReceived', quantity: 'owner.purchaseQuantity' },
  RETURN: { title: 'owner.stockPage.returned', quantity: 'owner.stockPage.returnQuantity' },
  MANUAL_ADJUSTMENT: {
    title: 'owner.stockPage.correct',
    quantity: 'owner.stockPage.correctQuantity',
  },
};

/**
 * Goods in, goods back, and an owner putting the count right. The request is kept until it is
 * answered, so a lost network cannot record it twice.
 */
function ReceiveSheet({ item, kind, close }: { item: Item; kind: GoodsKind; close: () => void }) {
  const t = useT();
  const { me } = useOwner();
  const storageKey = `shiv-owner-stock:${me.id}:${item.id}:${kind}`;
  const [saved] = useState(() => {
    try {
      const parsed = inventorySchema.safeParse(
        JSON.parse(sessionStorage.getItem(storageKey) || 'null'),
      );
      return parsed.success && parsed.data.kind === kind ? parsed.data : null;
    } catch {
      return null;
    }
  });
  const frozen = useRef(saved);
  const persisted = useRef(!!saved);
  const [locked, setLocked] = useState(!!saved);
  const [value, setValue] = useState(saved ? String(saved.quantity) : '');
  const [note, setNote] = useState(saved?.note ?? '');
  const [dirty, setDirty] = useState(false);
  const [key] = useState(() => saved?.idempotencyKey ?? crypto.randomUUID());
  const shopChoice = useShopChoice(kind === 'MANUAL_ADJUSTMENT' ? 'stock.adjust' : 'stock.receive');
  const { clearDirty, requestClose } = useUnsavedGuard(
    (dirty && !locked) || (locked && !persisted.current),
  );
  const action = useAction(
    async () => {
      const body =
        frozen.current ??
        inventorySchema.parse({
          ...(shopChoice.locationId ? { locationId: shopChoice.locationId } : {}),
          kind,
          quantity: Number(value),
          note,
          idempotencyKey: key,
        });
      frozen.current = body;
      setLocked(true);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(body));
        persisted.current = true;
      } catch {
        /* Keep the open form until its receipt is resolved. */
      }
      try {
        await api(`/admin/products/${item.id}/movements`, 'POST', body);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* A saved key still replays safely. */
        }
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.messageKey === 'error.invalid' &&
          error.code !== 'IDEMPOTENCY_CONFLICT'
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
      clearDirty();
      close();
    },
    [stockKey, ['products']],
    'owner.stockSaved',
  );
  return (
    <Sheet
      title={t(goodsWords[kind].title)}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!action.isPending && (!locked || persisted.current)) void requestClose(close);
      }}
    >
      <form
        onChange={() => setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate(undefined);
        }}
      >
        <p>{item.name}</p>
        {locked && <p role="status">{t('owner.stockRetry')}</p>}
        {!locked && shopChoice.field}
        <Field label={t(goodsWords[kind].quantity)}>
          <input
            required
            disabled={locked}
            inputMode={kind === 'MANUAL_ADJUSTMENT' ? 'text' : 'numeric'}
            pattern={kind === 'MANUAL_ADJUSTMENT' ? '-?[1-9][0-9]*' : '[1-9][0-9]*'}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Field label={t('owner.stockNote')}>
          <textarea
            required
            disabled={locked}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Problem error={action.error} />
        <Button className={css.wide} disabled={action.isPending}>
          {t(locked ? 'owner.retry' : 'owner.save')}
        </Button>
      </form>
    </Sheet>
  );
}

function DamageSheet({ item, close }: { item: Item; close: () => void }) {
  const t = useT();
  const shopChoice = useShopChoice('stock.report');
  const { shops, can } = useOwner();
  const fallback = shops.find((shop) => can('stock.report', shop.id))?.id;
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const send = useAction(
    async () => {
      await api('/admin/stock/damage', 'POST', {
        locationId: shopChoice.locationId ?? fallback,
        productId: item.id,
        quantity: Number(quantity),
        note: note.trim(),
        idempotencyKey: key,
      });
      close();
    },
    [['approvals']],
    'owner.stockPage.damageSent',
  );
  return (
    <Sheet title={t('owner.stockPage.damage')} closeLabel={t('owner.close')} onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate(undefined);
        }}
      >
        <p>{item.name}</p>
        <p className={css.sub}>{t('owner.stockPage.damageHelp')}</p>
        {shopChoice.field}
        <Field label={t('owner.stockPage.howMany')}>
          <input
            required
            inputMode="numeric"
            pattern="[1-9][0-9]*"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        <Field label={t('owner.stockPage.whatHappened')}>
          <input
            required
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Problem error={send.error} />
        <Button className={css.wide} disabled={send.isPending}>
          {t('owner.stockPage.damageSend')}
        </Button>
      </form>
    </Sheet>
  );
}

type Transfer = {
  id: string;
  status: string;
  fromName: string;
  toName: string;
  sentByName: string;
  sentAt: string;
  receivedByName: string;
  vehicle: string;
  canReceive: boolean;
  lines: {
    productId: string;
    name: string;
    unit: string;
    sentQty: number;
    receivedQty: number | null;
  }[];
};

function TransferTab() {
  const t = useT();
  const { language } = useLanguage();
  const transfers = useQuery({
    queryKey: transfersKey,
    queryFn: () => api<{ items: Transfer[] }>('/admin/stock/transfers'),
  });
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState<Transfer | null>(null);
  return (
    <div className={css.stack}>
      <Button onClick={() => setSending(true)}>{t('owner.stockPage.send')}</Button>
      <QueryStatus query={transfers} />
      {transfers.data && !transfers.data.items.length && (
        <EmptyState title={t('owner.stockPage.noTransfers')} />
      )}
      {transfers.data?.items.map((row) => (
        <article className={css.card} key={row.id}>
          <div className={css.row}>
            <strong>
              {row.fromName} → {row.toName}
            </strong>
            <StatusPill
              tone={row.status === 'DIFFERENT' ? 'red' : row.status === 'SENT' ? 'blue' : 'green'}
              label={t(`owner.stockPage.transfer.${row.status}` as MessageKey)}
            />
          </div>
          <p className={css.sub}>
            {[row.sentByName, row.vehicle, momentLabel(row.sentAt, language)]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {row.lines.map((line) => (
            <p key={line.productId}>
              {line.name}:{' '}
              {line.receivedQty === null
                ? line.sentQty
                : line.receivedQty === line.sentQty
                  ? line.receivedQty
                  : t('owner.stockPage.shortLine', {
                      received: line.receivedQty,
                      sent: line.sentQty,
                    })}
            </p>
          ))}
          {row.canReceive && (
            <Button onClick={() => setReceiving(row)}>{t('owner.stockPage.arrived')}</Button>
          )}
        </article>
      ))}
      {sending && <SendSheet close={() => setSending(false)} />}
      {receiving && <ArrivedSheet transfer={receiving} close={() => setReceiving(null)} />}
    </div>
  );
}

function SendSheet({ close }: { close: () => void }) {
  const t = useT();
  const { shops, can } = useOwner();
  const table = useStockTable();
  const from = shops.filter((shop) => can('stock.transfer', shop.id));
  const [fromId, setFromId] = useState(from[0]?.id ?? '');
  const [toId, setToId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [vehicle, setVehicle] = useState('');
  const [carrier, setCarrier] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const lines = Object.entries(quantities)
    .filter(([, value]) => Number(value) > 0)
    .map(([productId, value]) => ({ productId, quantity: Number(value) }));
  const send = useAction(
    async () => {
      await api('/admin/stock/transfers', 'POST', {
        fromLocationId: fromId,
        toLocationId: toId,
        lines,
        ...(vehicle.trim() ? { vehicle: vehicle.trim() } : {}),
        ...(carrier.trim() ? { carrierName: carrier.trim() } : {}),
        idempotencyKey: key,
      });
      close();
    },
    [stockKey],
    'owner.stockPage.sent',
  );
  const items = (table.data?.items ?? []).filter((item) => item.stockMode === 'COUNTED');
  return (
    <Sheet title={t('owner.stockPage.send')} closeLabel={t('owner.close')} onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate(undefined);
        }}
      >
        <Field label={t('owner.stockPage.fromShop')}>
          <select value={fromId} onChange={(event) => setFromId(event.target.value)}>
            {from.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('owner.stockPage.toShop')}>
          <select required value={toId} onChange={(event) => setToId(event.target.value)}>
            <option value="" />
            {/* Every open shop, not just this person's own: goods go somewhere else. */}
            {shops
              .filter((shop) => shop.id !== fromId)
              .map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
          </select>
        </Field>
        {items.map((item) => (
          <Field key={item.id} label={item.name}>
            <input
              inputMode="numeric"
              value={quantities[item.id] ?? ''}
              onChange={(event) =>
                setQuantities((current) => ({ ...current, [item.id]: event.target.value }))
              }
            />
          </Field>
        ))}
        <Field label={t('owner.stockPage.vehicle')}>
          <input
            maxLength={40}
            value={vehicle}
            onChange={(event) => setVehicle(event.target.value)}
          />
        </Field>
        <Field label={t('owner.stockPage.carrier')}>
          <input
            maxLength={60}
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
          />
        </Field>
        <Problem error={send.error} />
        <div className={css.sheetBar}>
          <Button className={css.wide} disabled={!toId || !lines.length || send.isPending}>
            {t('owner.stockPage.sendGo')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function ArrivedSheet({ transfer, close }: { transfer: Transfer; close: () => void }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const filled = transfer.lines.every((line) => /^\d+$/.test(values[line.productId] ?? ''));
  const receive = useAction(
    async () => {
      await api(`/admin/stock/transfers/${transfer.id}/receive`, 'POST', {
        lines: transfer.lines.map((line) => ({
          productId: line.productId,
          receivedQty: Number(values[line.productId]),
        })),
      });
      close();
    },
    [stockKey],
    'owner.stockPage.received',
  );
  return (
    <Sheet title={t('owner.stockPage.arrived')} closeLabel={t('owner.close')} onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          receive.mutate(undefined);
        }}
      >
        <p>{t('owner.stockPage.countWhatCame')}</p>
        {transfer.lines.map((line) => (
          <Field key={line.productId} label={line.name}>
            <input
              required
              inputMode="numeric"
              value={values[line.productId] ?? ''}
              onChange={(event) =>
                setValues((current) => ({ ...current, [line.productId]: event.target.value }))
              }
            />
          </Field>
        ))}
        <Problem error={receive.error} />
        <div className={css.sheetBar}>
          <Button className={css.wide} disabled={!filled || receive.isPending}>
            {t('owner.stockPage.arrivedGo')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

type Count = {
  id: string;
  status: string;
  opening: boolean;
  lines: { productId: string; name: string; unit: string; countedQty: number | null }[];
};

function CountTab() {
  const t = useT();
  const { can, shops, shopId, notice } = useOwner();
  const table = useStockTable();
  const mine = shops.filter((shop) => can('stock.count', shop.id));
  const [chosen, setChosen] = useState(
    shopId && mine.some((s) => s.id === shopId) ? shopId : (mine[0]?.id ?? ''),
  );
  const shop = table.data?.shops.find((row) => row.id === chosen);
  const open = shop?.openCount;
  const start = useAction(
    (opening: boolean) => api('/admin/stock/counts', 'POST', { locationId: chosen, opening }),
    [stockKey],
  );
  return (
    <div className={css.stack}>
      {mine.length > 1 && (
        <Field label={t('owner.whichShop')}>
          <select value={chosen} onChange={(event) => setChosen(event.target.value)}>
            {mine.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <QueryStatus query={table} />
      {shop && !open && (
        <section className={css.card}>
          <p>{t('owner.stockPage.countHelp')}</p>
          <div className={css.actions}>
            <Button disabled={start.isPending} onClick={() => start.mutate(false)}>
              {t('owner.stockPage.startCount')}
            </Button>
            {shop.cleanDays === null && (
              <Button
                variant="secondary"
                disabled={start.isPending}
                onClick={() => start.mutate(true)}
              >
                {t('owner.stockPage.startOpening')}
              </Button>
            )}
          </div>
          <Problem error={start.error} />
        </section>
      )}
      {open?.status === 'SUBMITTED' && (
        <section className={css.card}>
          <p>{t('owner.stockPage.countWaiting')}</p>
        </section>
      )}
      {open?.status === 'OPEN' && (
        <CountSheet id={open.id} onDone={() => notice(t('owner.stockPage.countSent'))} />
      )}
    </div>
  );
}

/** Names and empty boxes, and never the book figure. Each line is saved as it is typed. */
function CountSheet({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useT();
  const key = ['stock', 'count', id];
  const count = useQuery({ queryKey: key, queryFn: () => api<Count>(`/admin/stock/counts/${id}`) });
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!count.data) return;
    const known: Record<string, number> = {};
    for (const line of count.data.lines)
      if (line.countedQty !== null) known[line.productId] = line.countedQty;
    setSaved((current) => ({ ...known, ...current }));
  }, [count.data]);
  const save = useAction((line: { productId: string; countedQty: number }) =>
    api(`/admin/stock/counts/${id}/lines`, 'PUT', line).then(() =>
      setSaved((current) => ({ ...current, [line.productId]: line.countedQty })),
    ),
  );
  const submit = useAction(async () => {
    await api(`/admin/stock/counts/${id}/submit`, 'POST');
    onDone();
  }, [stockKey]);
  const lines = count.data?.lines ?? [];
  const done = lines.length > 0 && lines.every((line) => saved[line.productId] !== undefined);
  return (
    <section className={css.card}>
      <QueryStatus query={count} />
      {count.data?.opening && <p>{t('owner.stockPage.openingNote')}</p>}
      <p>{t('owner.stockPage.countWhatYouCounted')}</p>
      {lines.map((line) => (
        <Field key={line.productId} label={`${line.name} (${line.unit})`}>
          <input
            inputMode="numeric"
            value={
              values[line.productId] ??
              (saved[line.productId] !== undefined ? String(saved[line.productId]) : '')
            }
            onChange={(event) =>
              setValues((current) => ({ ...current, [line.productId]: event.target.value }))
            }
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (/^\d+$/.test(value) && Number(value) !== saved[line.productId])
                save.mutate({ productId: line.productId, countedQty: Number(value) });
            }}
          />
        </Field>
      ))}
      <Problem error={save.error ?? submit.error} />
      <Button disabled={!done || submit.isPending} onClick={() => submit.mutate(undefined)}>
        {t('owner.stockPage.countSend')}
      </Button>
    </section>
  );
}
