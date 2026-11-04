'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, MoneyText, SearchBar, Sheet, StatusPill } from '@shiv/design';
import { availabilityOf, productSchema, type Category, type Product } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { ApiError, api, uploadProductPhoto } from '../../lib/api';
import { useT, useWords } from '../../lib/i18n';
import { useAction, useDebounced, useOwner, useUnsavedGuard } from '../../lib/owner';
import { MoreRows, Problem, QueryStatus, moneyInput, rupeesToPaise, usePaged } from './common';
import css from './owner.module.css';
import local from './maal.module.css';

/** How the API sends goods to staff. Stock mode and sourcing have no way to change yet. */
type MaalRow = Product & {
  lowStockAt: number;
  stockMode?: 'COUNTED' | 'AVAILABILITY';
  sourcing?: 'STOCKED' | 'ON_REQUEST';
  stockLevels?: { isOn: boolean }[];
};
const categoriesKey = ['categories'];
const photoTypes = ['image/png', 'image/jpeg', 'image/webp'];
/** The most the API takes for one rate. */
const MOST_PAISE = 100_000_000;
/** The words a refused save needs, where the shared ones would read wrongly here. */
const ownWords = new Map<string, MessageKey>([
  ['UNAPPROVED_ASSET', 'owner.maal.photoNotOurs'],
  ['UPLOADS_PAUSED', 'owner.maal.photoOff'],
  ['STORAGE_UNAVAILABLE', 'owner.maal.photoOff'],
]);
const categoryWords = new Map<string, MessageKey>([['CONFLICT', 'owner.maal.categoryExists']]);
const fieldNames: Partial<Record<string, MessageKey>> = {
  name: 'owner.maal.name',
  nameHi: 'owner.maal.nameHi',
  brand: 'owner.maal.brand',
  categoryId: 'owner.maal.category',
  type: 'owner.maal.type',
  grade: 'owner.maal.grade',
  unit: 'owner.maal.unit',
  packSize: 'owner.maal.packSize',
  minQuantity: 'owner.maal.minQuantity',
  quantityStep: 'owner.maal.quantityStep',
  lowStockAt: 'owner.maal.lowStockAt',
  description: 'owner.maal.description',
  descriptionHi: 'owner.maal.descriptionHi',
  recommendedUse: 'owner.maal.recommendedUse',
  images: 'owner.maal.images',
};

function Trouble({ error, words = ownWords }: { error: unknown; words?: Map<string, MessageKey> }) {
  const t = useT();
  const key = error instanceof ApiError ? words.get(error.code) : undefined;
  return key ? (
    <p className={css.error} role="alert">
      {t(key)}
    </p>
  ) : (
    <Problem error={error} />
  );
}

function MaalState({ row }: { row: MaalRow }) {
  const t = useT();
  if (!row.active) return <StatusPill tone="neutral" label={t('owner.maal.hidden')} />;
  const availability = availabilityOf(row);
  if (availability === 'ON_REQUEST')
    return <StatusPill tone="blue" label={t('owner.maal.onRequest')} />;
  if (availability === 'ASK_SHOP') return <StatusPill tone="red" label={t('owner.maal.out')} />;
  // A heap of balu has no count, so it can only be there or not.
  if (row.stockMode !== 'AVAILABILITY' && row.stock !== null && row.stock <= row.lowStockAt)
    return <StatusPill tone="red" label={t('owner.lowStock')} />;
  return <StatusPill tone="green" label={t('owner.maal.inStock')} />;
}

function MaalCard({ row, onEdit }: { row: MaalRow; onEdit: () => void }) {
  const t = useT();
  const words = useWords();
  return (
    <article className={css.product}>
      <div className={css.row}>
        <h3>{row.name}</h3>
        <MaalState row={row} />
      </div>
      {row.images[0] && <img src={row.images[0]} alt="" width="56" height="56" />}
      <p>
        {row.brand} · {row.unit} · {row.category.name}
      </p>
      <div className={css.row}>
        <MoneyText value={row.pricePaise} />
        {row.stockMode !== 'AVAILABILITY' && (
          <span>
            {row.stock === null
              ? t('owner.stockHidden')
              : t('owner.stockCount', { count: row.stock.toLocaleString('en-IN') })}
          </span>
        )}
      </div>
      <p className={css.date}>
        {t('owner.maal.rateChanged', { when: words.moment(row.priceUpdatedAt) })}
        {row.stockMode !== 'AVAILABILITY' &&
          ` · ${t('owner.maal.alertAt', { count: row.lowStockAt })}`}
      </p>
      <Button
        variant="secondary"
        aria-label={`${t('owner.maal.edit')} ${row.name}`}
        onClick={onEdit}
      >
        {t('owner.maal.edit')}
      </Button>
    </article>
  );
}

/**
 * Everything about an item except how much of it there is. New goods start at 0 and an existing
 * balance goes back to the API exactly as it came, because stock moves only through the ledger.
 */
function MaalEditor({
  product,
  categories,
  changed,
  close,
}: {
  product: MaalRow | null;
  categories: Category[];
  changed: boolean;
  close: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState({
    name: product?.name ?? '',
    nameHi: product?.nameHi ?? '',
    brand: product?.brand ?? '',
    categoryId: product?.categoryId ?? categories[0]?.id ?? '',
    type: product?.type ?? '',
    grade: product?.grade ?? '',
    unit: product?.unit ?? '',
    price: moneyInput(product?.pricePaise),
    packSize: product?.packSize ?? '',
    minQuantity: String(product?.minQuantity ?? 1),
    quantityStep: String(product?.quantityStep ?? 1),
    lowStockAt: String(product?.lowStockAt ?? 25),
    description: product?.description ?? '',
    descriptionHi: product?.descriptionHi ?? '',
    recommendedUse: product?.recommendedUse ?? '',
    active: product?.active ?? true,
  });
  const [image, setImage] = useState(product?.images[0] ?? '');
  const [bad, setBad] = useState('');
  const [dirty, setDirty] = useState(false);
  const { clearDirty, requestClose } = useUnsavedGuard(dirty);
  const save = useAction(
    async (body: ReturnType<typeof productSchema.parse>) => {
      await api(
        product ? `/admin/products/${product.id}` : '/admin/products',
        product ? 'PATCH' : 'POST',
        { ...body, ...(product ? { expectedVersion: product.version } : {}) },
      );
      clearDirty();
      close();
    },
    [['products'], ['stock']],
    'owner.maal.saved',
  );
  const photo = useAction((file: File) => uploadProductPhoto(file));
  const busy = save.isPending || photo.isPending;
  const field = (key: keyof typeof form) => ({
    value: form[key] as string,
    disabled: busy,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: event.target.value }),
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setBad('');
    let pricePaise = 0;
    try {
      // Trimmed here because rupeesToPaise reads "380.5 " with a trailing space as 380.05.
      pricePaise = rupeesToPaise(form.price.trim());
    } catch {
      /* Falls through to the check below. */
    }
    if (pricePaise <= 0 || pricePaise > MOST_PAISE) {
      setBad(t('owner.maal.badPrice'));
      return;
    }
    const parsed = productSchema.safeParse({
      name: form.name,
      nameHi: form.nameHi,
      brand: form.brand,
      categoryId: form.categoryId,
      type: form.type,
      grade: form.grade,
      unit: form.unit,
      packSize: form.packSize,
      minQuantity: Number(form.minQuantity),
      quantityStep: Number(form.quantityStep),
      pricePaise,
      stock: product?.stock ?? 0,
      lowStockAt: Number(form.lowStockAt),
      active: form.active,
      description: form.description,
      descriptionHi: form.descriptionHi,
      recommendedUse: form.recommendedUse,
      images: [...(image ? [image] : []), ...(product?.images.slice(1) ?? [])],
    });
    if (!parsed.success) {
      const name = fieldNames[String(parsed.error.issues[0]?.path[0])];
      setBad(t('owner.maal.check', { field: name ? t(name) : t('owner.maal.name') }));
      return;
    }
    if (parsed.data.minQuantity % parsed.data.quantityStep) {
      setBad(t('owner.maal.badStep'));
      return;
    }
    save.mutate(parsed.data);
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    setBad('');
    photo.reset();
    if (!photoTypes.includes(file.type)) {
      setBad(t('error.INVALID_IMAGE'));
      return;
    }
    photo.mutate(file, {
      onSuccess: (result) => {
        setImage(result.publicUrl);
        setDirty(true);
      },
    });
  };
  return (
    <Sheet
      title={t(product ? 'owner.maal.edit' : 'owner.maal.add')}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!busy) void requestClose(close);
      }}
    >
      <form className={css.stack} onChange={() => setDirty(true)} onSubmit={submit}>
        {changed && (
          <p className={css.warnBlock} role="status">
            {t('owner.maal.changedElsewhere')}
          </p>
        )}
        <div className={css.grid}>
          <Field label={t('owner.maal.name')}>
            <input required maxLength={120} {...field('name')} />
          </Field>
          <Field label={t('owner.maal.brand')}>
            <input required maxLength={80} {...field('brand')} />
          </Field>
          <Field label={t('owner.maal.category')}>
            <select
              required
              value={form.categoryId}
              disabled={busy}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('owner.maal.type')}>
            <input
              required
              maxLength={80}
              placeholder={t('owner.maal.typeHint')}
              {...field('type')}
            />
          </Field>
          <Field label={t('owner.maal.grade')}>
            <input
              required
              maxLength={40}
              placeholder={t('owner.maal.gradeHint')}
              {...field('grade')}
            />
          </Field>
          <Field label={t('owner.maal.unit')}>
            <input
              required
              maxLength={50}
              placeholder={t('owner.maal.unitHint')}
              {...field('unit')}
            />
          </Field>
          <Field label={t('owner.maal.price')}>
            <input required inputMode="decimal" autoComplete="off" {...field('price')} />
          </Field>
          <Field label={t('owner.maal.packSize')}>
            <input maxLength={100} placeholder={t('owner.maal.packHint')} {...field('packSize')} />
          </Field>
          <Field label={t('owner.maal.minQuantity')}>
            <input required inputMode="numeric" autoComplete="off" {...field('minQuantity')} />
          </Field>
          <Field label={t('owner.maal.quantityStep')}>
            <input required inputMode="numeric" autoComplete="off" {...field('quantityStep')} />
          </Field>
          <Field label={t('owner.maal.lowStockAt')}>
            <input required inputMode="numeric" autoComplete="off" {...field('lowStockAt')} />
          </Field>
        </div>
        {!categories.length && <p className={css.warnBlock}>{t('owner.maal.needCategory')}</p>}
        {!product && <p className={css.hint}>{t('owner.maal.stockNew')}</p>}
        {product && product.stockMode !== 'AVAILABILITY' && (
          <p className={css.hint}>
            {product.stock === null
              ? t('owner.stockHidden')
              : t('owner.maal.stockNow', { count: product.stock.toLocaleString('en-IN') })}
          </p>
        )}
        {product && (
          <p className={css.hint}>
            {t('owner.maal.howCounted', {
              mode: t(
                product.stockMode === 'AVAILABILITY'
                  ? 'owner.maal.modeAvailability'
                  : 'owner.maal.modeCounted',
              ),
              source: t(
                product.sourcing === 'ON_REQUEST'
                  ? 'owner.maal.sourceOnRequest'
                  : 'owner.maal.sourceStocked',
              ),
            })}{' '}
            {t('owner.maal.howFixed')}
          </p>
        )}
        <Field label={t('owner.maal.description')}>
          <textarea required maxLength={1500} {...field('description')} />
        </Field>
        <Field label={t('owner.maal.recommendedUse')}>
          <input required maxLength={500} {...field('recommendedUse')} />
        </Field>
        <Field label={t('owner.maal.nameHi')}>
          <input lang="hi" maxLength={120} {...field('nameHi')} />
        </Field>
        <Field label={t('owner.maal.descriptionHi')}>
          <textarea lang="hi" maxLength={1500} {...field('descriptionHi')} />
        </Field>
        {image && (
          <div className={css.row}>
            <img className={local.photo} src={image} alt={t('owner.maal.photoAlt')} />
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setImage('');
                setDirty(true);
              }}
            >
              {t('owner.maal.photoRemove')}
            </Button>
          </div>
        )}
        <Field label={t('owner.maal.photoUpload')}>
          <input
            type="file"
            accept={photoTypes.join(',')}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Lets the same photo be picked again after a failed upload.
              event.target.value = '';
              upload(file);
            }}
          />
        </Field>
        <Trouble error={photo.error} />
        <label className={css.check}>
          <input
            type="checkbox"
            checked={form.active}
            disabled={busy}
            onChange={(event) => setForm({ ...form, active: event.target.checked })}
          />
          {t('owner.maal.active')}
        </label>
        {bad && (
          <p className={css.error} role="alert">
            {bad}
          </p>
        )}
        <Trouble error={save.error} />
        <p className={css.hint}>{t('owner.maal.priceHint')}</p>
        <Button className={css.wide} disabled={busy || !categories.length}>
          {t('owner.save')}
        </Button>
      </form>
    </Sheet>
  );
}

function CategoryRows({ categories }: { categories: Category[] }) {
  const t = useT();
  const [name, setName] = useState('');
  const add = useAction(
    () => {
      const clean = name.trim();
      const slug = clean
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      // A name with no Latin letters has nothing for the web address, so it gets a short code.
      return api('/admin/categories', 'POST', {
        name: clean,
        slug: slug || `cat-${Date.now().toString(36)}`,
      });
    },
    [categoriesKey],
    'owner.maal.categoryAdded',
  );
  return (
    <section className={css.card}>
      <h2>{t('owner.maal.categories')}</h2>
      <div className={css.chips}>
        {categories.map((category) => (
          <StatusPill key={category.id} label={category.name} />
        ))}
      </div>
      <form
        className={local.categoryForm}
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate(undefined, { onSuccess: () => setName('') });
        }}
      >
        <Field label={t('owner.maal.newCategory')}>
          <input
            required
            maxLength={60}
            value={name}
            disabled={add.isPending}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Button variant="secondary" disabled={add.isPending || !name.trim()}>
          {t('owner.maal.addCategory')}
        </Button>
      </form>
      <Trouble error={add.error} words={categoryWords} />
    </section>
  );
}

function Maal() {
  const t = useT();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const q = useDebounced(search, 250);
  const goods = usePaged<MaalRow>(
    ['products', 'manage', q, category],
    `/admin/products?limit=100&q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`,
  );
  const categories = useQuery({
    queryKey: categoriesKey,
    queryFn: () => api<Category[]>('/categories'),
  });
  const [editing, setEditing] = useState<MaalRow | 'new' | null>(null);
  const rows = goods.data?.pages.flatMap((page) => page.items) ?? [];
  const live = editing && editing !== 'new' ? rows.find((row) => row.id === editing.id) : undefined;
  return (
    <section className={css.stack} aria-label={t('owner.maal.title')}>
      <SearchBar
        label={t('owner.maal.search')}
        maxLength={100}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Field label={t('owner.maal.filter')}>
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">{t('owner.maal.allCategories')}</option>
          {categories.data?.map((row) => (
            <option key={row.id} value={row.slug}>
              {row.name}
            </option>
          ))}
        </select>
      </Field>
      <Button className={css.wide} disabled={!categories.data} onClick={() => setEditing('new')}>
        {t('owner.maal.add')}
      </Button>
      <QueryStatus query={categories} />
      <QueryStatus query={goods} />
      <div className={css.grid}>
        {rows.map((row) => (
          <MaalCard key={row.id} row={row} onEdit={() => setEditing(row)} />
        ))}
      </div>
      {goods.data && !rows.length && <EmptyState title={t('owner.maal.empty')} />}
      <MoreRows query={goods} />
      {categories.data && <CategoryRows categories={categories.data} />}
      {editing && categories.data && (
        <MaalEditor
          key={editing === 'new' ? 'new' : editing.id}
          product={editing === 'new' ? null : editing}
          categories={categories.data}
          changed={!!live && editing !== 'new' && live.version !== editing.version}
          close={() => setEditing(null)}
        />
      )}
    </section>
  );
}

/** Maal ki list: what the shop sells, for owners, as a tab on the Stock page. */
export function MaalList() {
  const t = useT();
  const { can } = useOwner();
  if (!can('products.edit'))
    return (
      <section className={css.card}>
        <h2>{t('owner.notYourPage')}</h2>
        <p>{t('owner.notYourPageBody')}</p>
      </section>
    );
  return <Maal />;
}
