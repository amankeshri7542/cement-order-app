'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, Field, MoneyText, SearchBar, Sheet, StatusPill } from '@shiv/design';
import { inventorySchema, istToday, productName, unitLabel, type Product } from '@shiv/shared';
import { ApiError, api } from '../../lib/api';
import { useLanguage, useT, useWords } from '../../lib/i18n';
import { useAction, useDebounced, useOwner, useUnsavedGuard } from '../../lib/owner';
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

type OwnerProduct = Product & { lowStockAt: number };
export function Stock() {
  const t = useT();
  const { language } = useLanguage();
  const { notice } = useOwner();
  const words = useWords();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const products = usePaged<OwnerProduct>(
    ['products', 'stock', q],
    `/admin/products?limit=24&q=${encodeURIComponent(q)}`,
  );
  const [editing, setEditing] = useState<{ product: OwnerProduct; mode: 'price' | 'stock' } | null>(
    null,
  );
  const [files, setFiles] = useState<File[]>([]);
  const share = useAction(async () => {
    const result = await api<{ publishedAt: string; pages: { pngBase64: string }[] }>(
      '/admin/rate-cards/current',
      'POST',
      { language },
    );
    const generated = result.pages.map(
      (page, index) =>
        new File(
          [Uint8Array.from(atob(page.pngBase64), (character) => character.charCodeAt(0))],
          `shiv-rates-${istToday()}-${index + 1}.png`,
          { type: 'image/png' },
        ),
    );
    setFiles(generated);
    if (navigator.canShare?.({ files: generated }))
      try {
        await navigator.share({ files: generated, title: t('owner.shareRates') });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          notice(t('owner.shareReady'));
      }
  });
  const rows = products.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <PageHeader title={t('owner.stock')} />
      <div className={css.actions}>
        <Button onClick={() => share.mutate()} disabled={share.isPending}>
          {t('owner.shareRates')}
        </Button>
        <Link href="/orders/new?source=WALK_IN" className={css.inlineLink}>
          {t('owner.walkIn')}
        </Link>
      </div>
      <Problem error={share.error} />
      <SearchBar
        label={t('owner.searchProducts')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <QueryStatus query={products} />
      <div className={css.grid}>
        {rows.map((product) => (
          <article className={css.product} key={product.id}>
            <div className={css.row}>
              <h2>{productName(product, language)}</h2>
              {product.stock <= product.lowStockAt && (
                <StatusPill label={t('owner.lowStock')} tone="red" />
              )}
            </div>
            <p>{unitLabel(product.packSize || product.unit, language)}</p>
            <div className={css.row}>
              <MoneyText value={product.pricePaise} />
              <span>{t('owner.stockCount', { count: product.stock })}</span>
            </div>
            <div className={css.actions}>
              <Button variant="secondary" onClick={() => setEditing({ product, mode: 'price' })}>
                {t('owner.changePrice')}
              </Button>
              <Button onClick={() => setEditing({ product, mode: 'stock' })}>
                {t('owner.stockReceived')}
              </Button>
            </div>
          </article>
        ))}
        {!products.isPending && !rows.length && <EmptyState title={t('owner.emptyStock')} />}
      </div>
      <MoreRows query={products} />
      {editing && (
        <StockEditor
          key={editing.product.id + editing.mode}
          {...editing}
          close={() => setEditing(null)}
        />
      )}
      {!!files.length && (
        <Sheet
          title={t('owner.shareReady')}
          closeLabel={t('owner.close')}
          onClose={() => setFiles([])}
        >
          <div className={css.stack}>
            {files.map((file, index) => (
              <RatePreview key={file.name} file={file} index={index} />
            ))}
            {navigator.canShare?.({ files }) && (
              <Button
                onClick={() => {
                  void navigator.share({ files, title: t('owner.shareRates') }).catch((error) => {
                    if (!(error instanceof DOMException && error.name === 'AbortError'))
                      notice(words.error(error));
                  });
                }}
              >
                {t('owner.share')}
              </Button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
function RatePreview({ file, index }: { file: File; index: number }) {
  const t = useT();
  const [url] = useState(() => URL.createObjectURL(file));
  // The preview URL is local to this mounted sheet.
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div>
      <img className={css.ratePreview} src={url} alt={t('owner.shareRates')} />
      <a className={css.inlineLink} href={url} download={file.name}>
        {t('owner.download')} {index + 1}
      </a>
    </div>
  );
}

function StockEditor({
  product,
  mode,
  close,
}: {
  product: OwnerProduct;
  mode: 'price' | 'stock';
  close: () => void;
}) {
  const t = useT();
  const { me } = useOwner();
  const storageKey = `shiv-owner-stock:${me.id}:${product.id}`;
  const [saved] = useState(() => {
    if (mode !== 'stock') return null;
    try {
      const parsed = inventorySchema.safeParse(
        JSON.parse(sessionStorage.getItem(storageKey) || 'null'),
      );
      return parsed.success && parsed.data.kind === 'PURCHASE_IN' ? parsed.data : null;
    } catch {
      return null;
    }
  });
  const frozen = useRef(saved);
  const persisted = useRef(!!saved);
  const [locked, setLocked] = useState(!!saved);
  const [value, setValue] = useState(
    saved ? String(saved.quantity) : mode === 'price' ? moneyInput(product.pricePaise) : '',
  );
  const [note, setNote] = useState(saved?.note ?? '');
  const [dirty, setDirty] = useState(false);
  const [key] = useState(() => saved?.idempotencyKey ?? crypto.randomUUID());
  const { clearDirty, requestClose } = useUnsavedGuard(
    (dirty && !locked) || (locked && !persisted.current),
  );
  const action = useAction(
    async () => {
      if (mode === 'stock') {
        const body =
          frozen.current ??
          inventorySchema.parse({
            kind: 'PURCHASE_IN',
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
          await api(`/admin/products/${product.id}/movements`, 'POST', body);
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
      } else {
        const live = await api<Product>(`/products/${product.id}`);
        await api(`/admin/products/${product.id}`, 'PATCH', {
          name: product.name,
          nameHi: product.nameHi,
          brand: product.brand,
          categoryId: product.categoryId,
          type: product.type,
          grade: product.grade,
          unit: product.unit,
          packSize: product.packSize,
          minQuantity: product.minQuantity,
          quantityStep: product.quantityStep,
          pricePaise: rupeesToPaise(value),
          stock: live.stock,
          lowStockAt: product.lowStockAt,
          active: product.active,
          description: product.description,
          descriptionHi: product.descriptionHi,
          recommendedUse: product.recommendedUse,
          images: product.images,
          expectedVersion: product.version,
        });
      }
      clearDirty();
      close();
    },
    [['products']],
    mode === 'price' ? 'owner.priceSaved' : 'owner.stockSaved',
  );
  return (
    <Sheet
      title={t(mode === 'price' ? 'owner.changePrice' : 'owner.stockReceived')}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!action.isPending && (!locked || persisted.current)) void requestClose(close);
      }}
    >
      <form
        onChange={() => setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate();
        }}
      >
        <p>{product.name}</p>
        {locked && <p role="status">{t('owner.stockRetry')}</p>}
        <Field label={t(mode === 'price' ? 'owner.price' : 'owner.purchaseQuantity')}>
          <input
            required
            disabled={locked}
            inputMode={mode === 'price' ? 'decimal' : 'numeric'}
            pattern={mode === 'price' ? '[0-9]+([.][0-9]{1,2})?' : '[1-9][0-9]*'}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        {mode === 'stock' && (
          <Field label={t('owner.stockNote')}>
            <textarea
              required
              disabled={locked}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        )}
        <Problem error={action.error} />
        <Button className={css.wide} disabled={action.isPending}>
          {t(locked ? 'owner.retry' : 'owner.save')}
        </Button>
      </form>
    </Sheet>
  );
}
