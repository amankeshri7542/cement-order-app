'use client';
import { useEffect, useState } from 'react';
import { Category, Product, money, productSchema } from '@shiv/shared';
import { Plus, Search, Pencil, Package, Upload } from 'lucide-react';
import { api, uploadProductPhoto } from '../lib/api';
import { useWords } from '../lib/i18n';
import { Badge, Empty, Field, Modal } from './ui';
import { Inventory } from './operations';

export function Products({
  products,
  onFilter,
  categories,
  refresh,
  notice,
}: {
  products: Product[];
  onFilter: (query: string) => void;
  categories: Category[];
  refresh: () => Promise<void>;
  notice: (value: string, error?: boolean) => void;
}) {
  const { t, error: say } = useWords();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [category, setCategory] = useState('');
  const [inventory, setInventory] = useState<Product | null>(null);
  useEffect(() => {
    const timer = setTimeout(
      () => onFilter(`q=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}`),
      250,
    );
    return () => clearTimeout(timer);
  }, [search, category, onFilter]);
  const filtered = products;
  return (
    <>
      <div className="toolbar">
        <label className="search">
          <Search size={18} />
          <input
            aria-label={t('Search products', 'सामग्री खोजें')}
            placeholder={t('Search products or brands', 'सामग्री या ब्रांड खोजें')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label={t('Filter category', 'श्रेणी चुनें')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">{t('All categories', 'सभी श्रेणियाँ')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="primary" onClick={() => setEditing('new')}>
          <Plus size={18} />
          {t('Add product', 'सामग्री जोड़ें')}
        </button>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('Product', 'सामग्री')}</th>
              <th>{t('Category', 'श्रेणी')}</th>
              <th>{t('Selling price', 'बिक्री भाव')}</th>
              <th>{t('Available stock', 'उपलब्ध स्टॉक')}</th>
              <th>{t('Status', 'स्थिति')}</th>
              <th>
                <span className="sr-only">{t('Edit', 'बदलें')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="product-cell">
                    <span className={`product-mark ${p.category.slug}`}>
                      <Package size={24} />
                    </span>
                    <div>
                      <strong>{p.name}</strong>
                      <small>
                        {p.brand} · {p.unit}
                      </small>
                    </div>
                  </div>
                </td>
                <td>{p.category.name}</td>
                <td>
                  <strong>{money(p.pricePaise)}</strong>
                  <small>
                    {t('Price version', 'भाव संस्करण')} {p.priceVersion}
                  </small>
                </td>
                <td>
                  <span className={p.stock <= (p.lowStockAt ?? 25) ? 'low-stock' : ''}>
                    {p.stock.toLocaleString('en-IN')} {p.unit}
                  </span>
                  <small>
                    {t(`Alert at ${p.lowStockAt ?? 25}`, `${p.lowStockAt ?? 25} पर चेतावनी`)}
                  </small>
                </td>
                <td>
                  <Badge value={!p.active ? 'INACTIVE' : p.stock ? 'IN_STOCK' : 'OUT_OF_STOCK'} />
                </td>
                <td>
                  <button
                    className="secondary"
                    onClick={() => setInventory(p)}
                    aria-label={`${t('Stock ledger', 'स्टॉक खाता')} ${p.name}`}
                  >
                    {t('Stock ledger', 'स्टॉक खाता')}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${t('Edit', 'बदलें')} ${p.name}`}
                    onClick={() => setEditing(p)}
                  >
                    <Pencil size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <Empty
            title={t('No products found', 'कोई सामग्री नहीं मिली')}
            body={t('Add a product or try another search.', 'सामग्री जोड़ें या दूसरी खोज करें।')}
          />
        )}
      </div>
      <div className="category-add">
        <h3>{t('Categories', 'श्रेणियाँ')}</h3>
        <div className="chips">
          {categories.map((c) => (
            <span key={c.id}>{c.name}</span>
          ))}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const name = String(new FormData(form).get('name'));
            const slug = name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '');
            try {
              await api('/admin/categories', 'POST', {
                name,
                // A Hindi-only name has no Latin letters for the web address; use a short code.
                slug: slug || `cat-${Date.now().toString(36)}`,
              });
              form.reset();
              await refresh();
              notice(t('Category added', 'श्रेणी जुड़ी'));
            } catch (err) {
              notice(say(err), true);
            }
          }}
        >
          <input
            name="name"
            aria-label={t('New category name', 'नई श्रेणी का नाम')}
            required
            maxLength={60}
            placeholder={t('New category', 'नई श्रेणी')}
          />
          <button className="secondary">{t('Add category', 'श्रेणी जोड़ें')}</button>
        </form>
      </div>
      {inventory && (
        <Inventory product={inventory} close={() => setInventory(null)} refresh={refresh} />
      )}
      {editing && (
        <ProductEditor
          product={editing === 'new' ? undefined : editing}
          categories={categories}
          close={() => setEditing(null)}
          saved={async () => {
            setEditing(null);
            await refresh();
            notice(
              t(
                'Product saved. Customers will see the latest price.',
                'सामग्री सहेजी। ग्राहकों को नया भाव दिखेगा।',
              ),
            );
          }}
        />
      )}
    </>
  );
}
export function ProductEditor({
  product,
  categories,
  close,
  saved,
}: {
  product?: Product;
  categories: Category[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const { t, error: say } = useWords();
  const [image, setImage] = useState(product?.images[0] || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const data = {
      name: String(f.get('name')),
      brand: String(f.get('brand')),
      categoryId: String(f.get('categoryId')),
      type: String(f.get('type')),
      grade: String(f.get('grade')),
      unit: String(f.get('unit')),
      packSize: String(f.get('packSize')),
      minQuantity: Number(f.get('minQuantity')),
      quantityStep: Number(f.get('quantityStep')),
      pricePaise: Math.round(Number(f.get('price')) * 100),
      stock: product?.stock ?? Number(f.get('stock')),
      lowStockAt: Number(f.get('lowStockAt')),
      active: f.get('active') === 'on',
      description: String(f.get('description')),
      recommendedUse: String(f.get('recommendedUse')),
      images: [...(image ? [image] : []), ...(product?.images.slice(1) || [])],
    };
    const parsed = productSchema.safeParse(data);
    if (!parsed.success) {
      setError(
        `${t('Check product details', 'जानकारी जाँचें')}: ${parsed.error.issues[0]?.path.join('.') || ''}`,
      );
      setBusy(false);
      return;
    }
    try {
      await api(
        product ? `/admin/products/${product.id}` : '/admin/products',
        product ? 'PATCH' : 'POST',
        { ...parsed.data, ...(product ? { expectedVersion: product.version } : {}) },
      );
      await saved();
    } catch (err) {
      setError(say(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={product ? t('Edit product', 'सामग्री बदलें') : t('Add a product', 'नई सामग्री जोड़ें')}
      close={close}
    >
      <form onSubmit={submit} className="form-stack">
        <div className="form-grid">
          <Field label={t('Product name', 'सामग्री का नाम')}>
            <input name="name" defaultValue={product?.name} required maxLength={120} />
          </Field>
          <Field label={t('Brand', 'ब्रांड')}>
            <input name="brand" defaultValue={product?.brand} required />
          </Field>
          <Field label={t('Category', 'श्रेणी')}>
            <select name="categoryId" defaultValue={product?.categoryId}>
              {categories.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Type', 'प्रकार')}>
            <input name="type" defaultValue={product?.type} placeholder="PPC Cement" required />
          </Field>
          <Field label={t('Grade', 'ग्रेड')}>
            <input name="grade" defaultValue={product?.grade} placeholder="53 grade" required />
          </Field>
          <Field label={t('Unit', 'इकाई')}>
            <input name="unit" defaultValue={product?.unit} placeholder="50 kg bag" required />
          </Field>
          <Field label={t('Selling price (₹)', 'बिक्री भाव (₹)')}>
            <input
              name="price"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={product ? product.pricePaise / 100 : ''}
              required
            />
          </Field>
          <Field label={t('Pack size / specification', 'पैक / विवरण')}>
            <input
              name="packSize"
              defaultValue={product?.packSize}
              maxLength={100}
              placeholder="50 kg sealed bag / 4 tiles per box"
            />
          </Field>
          <Field label={t('Minimum quantity', 'कम से कम मात्रा')}>
            <input
              name="minQuantity"
              type="number"
              min="1"
              step="1"
              defaultValue={product?.minQuantity || 1}
              required
            />
          </Field>
          <Field label={t('Quantity step', 'मात्रा का अंतर')}>
            <input
              name="quantityStep"
              type="number"
              min="1"
              step="1"
              defaultValue={product?.quantityStep || 1}
              required
            />
          </Field>
          <Field
            label={
              product
                ? t(
                    'Available stock · use stock ledger to change',
                    'उपलब्ध स्टॉक · बदलने के लिए स्टॉक खाता',
                  )
                : t('Opening stock', 'शुरुआती स्टॉक')
            }
          >
            <input
              name="stock"
              readOnly={Boolean(product)}
              type="number"
              min="0"
              step="1"
              defaultValue={product?.stock ?? 0}
              required
            />
          </Field>
          <Field label={t('Low-stock alert at', 'इतना बचने पर चेतावनी')}>
            <input
              name="lowStockAt"
              type="number"
              min="0"
              step="1"
              defaultValue={product?.lowStockAt ?? 25}
              required
            />
          </Field>
        </div>
        <Field label={t('Description', 'विवरण')}>
          <textarea
            name="description"
            defaultValue={product?.description}
            required
            maxLength={1500}
          />
        </Field>
        <Field label={t('Recommended use', 'कहाँ इस्तेमाल करें')}>
          <input name="recommendedUse" defaultValue={product?.recommendedUse} required />
        </Field>
        <Field label={t('Product image URL', 'फ़ोटो का लिंक')}>
          <input
            type="url"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="https://…"
          />
        </Field>
        <label className="upload-button">
          <Upload size={16} /> {t('Upload photo', 'फ़ोटो अपलोड करें')}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                const r = await uploadProductPhoto(file);
                setImage(r.publicUrl);
              } catch (err) {
                setError(say(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={product?.active ?? true} />{' '}
          {t('Visible to customers', 'ग्राहकों को दिखे')}
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p className="hint">
          {t(
            'Price changes are recorded and sent to connected customers. Customers must review changed totals before ordering.',
            'भाव बदलाव दर्ज होता है और ग्राहकों तक पहुँचता है। ऑर्डर से पहले ग्राहक नया कुल देखकर पुष्टि करते हैं।',
          )}
        </p>
        <button className="primary wide" disabled={busy}>
          {busy ? t('Saving…', 'सहेज रहे हैं…') : t('Save product', 'सामग्री सहेजें')}
        </button>
      </form>
    </Modal>
  );
}
