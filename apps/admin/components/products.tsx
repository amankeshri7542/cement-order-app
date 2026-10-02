'use client';
import { useEffect, useState } from 'react';
import { Category, Product, money, productSchema } from '@shiv/shared';
import { Plus, Search, Pencil, Package, Upload } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
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
  notice: (value: string) => void;
}) {
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
            aria-label="Search products"
            placeholder="Search products or brands"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="primary" onClick={() => setEditing('new')}>
          <Plus size={18} />
          Add product
        </button>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Selling price</th>
              <th>Available stock</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Edit</span>
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
                  <small>Price version {p.priceVersion}</small>
                </td>
                <td>
                  <span className={p.stock < 25 ? 'low-stock' : ''}>
                    {p.stock.toLocaleString('en-IN')} units
                  </span>
                </td>
                <td>
                  <Badge value={!p.active ? 'INACTIVE' : p.stock ? 'IN_STOCK' : 'OUT_OF_STOCK'} />
                </td>
                <td>
                  <button
                    className="secondary"
                    onClick={() => setInventory(p)}
                    aria-label={`Stock ledger ${p.name}`}
                  >
                    Stock ledger
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${p.name}`}
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
          <Empty title="No products found" body="Add a product or try another search." />
        )}
      </div>
      <div className="category-add">
        <h3>Categories</h3>
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
            try {
              await api('/admin/categories', 'POST', {
                name,
                slug: name
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-|-$/g, ''),
              });
              form.reset();
              await refresh();
              notice('Category added');
            } catch (err) {
              notice(errorMessage(err));
            }
          }}
        >
          <input
            name="name"
            aria-label="New category name"
            required
            maxLength={60}
            placeholder="New category"
          />
          <button className="secondary">Add category</button>
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
            notice('Product saved. Customers will see the latest price.');
          }}
        />
      )}
    </>
  );
}
function ProductEditor({
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
      active: f.get('active') === 'on',
      description: String(f.get('description')),
      recommendedUse: String(f.get('recommendedUse')),
      images: image ? [image] : [],
    };
    const parsed = productSchema.safeParse(data);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || 'Check product details.');
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
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={product ? 'Edit product' : 'Add a product'} close={close}>
      <form onSubmit={submit} className="form-stack">
        <div className="form-grid">
          <Field label="Product name">
            <input name="name" defaultValue={product?.name} required maxLength={120} />
          </Field>
          <Field label="Brand">
            <input name="brand" defaultValue={product?.brand} required />
          </Field>
          <Field label="Category">
            <select name="categoryId" defaultValue={product?.categoryId}>
              {categories.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <input name="type" defaultValue={product?.type} placeholder="PPC Cement" required />
          </Field>
          <Field label="Grade">
            <input name="grade" defaultValue={product?.grade} placeholder="53 grade" required />
          </Field>
          <Field label="Unit">
            <input name="unit" defaultValue={product?.unit} placeholder="50 kg bag" required />
          </Field>
          <Field label="Selling price (₹)">
            <input
              name="price"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={product ? product.pricePaise / 100 : ''}
              required
            />
          </Field>
          <Field label="Pack size / specification">
            <input
              name="packSize"
              defaultValue={product?.packSize}
              maxLength={100}
              placeholder="50 kg sealed bag / 4 tiles per box"
            />
          </Field>
          <Field label="Minimum quantity">
            <input
              name="minQuantity"
              type="number"
              min="1"
              step="1"
              defaultValue={product?.minQuantity || 1}
              required
            />
          </Field>
          <Field label="Quantity step">
            <input
              name="quantityStep"
              type="number"
              min="1"
              step="1"
              defaultValue={product?.quantityStep || 1}
              required
            />
          </Field>
          <Field label={product ? 'Available stock · use stock ledger to change' : 'Opening stock'}>
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
        </div>
        <Field label="Description">
          <textarea
            name="description"
            defaultValue={product?.description}
            required
            maxLength={1500}
          />
        </Field>
        <Field label="Recommended use">
          <input name="recommendedUse" defaultValue={product?.recommendedUse} required />
        </Field>
        <Field label="Product image URL">
          <input
            type="url"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="https://…"
          />
        </Field>
        <label className="upload-button">
          <Upload size={16} /> Upload image to store storage
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                const r = await api<{ uploadUrl: string; publicUrl: string }>(
                  '/admin/uploads',
                  'POST',
                  { contentType: file.type, size: file.size },
                );
                const put = await fetch(r.uploadUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': file.type },
                  body: file,
                });
                if (!put.ok) throw new Error('Image upload failed.');
                setImage(r.publicUrl);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={product?.active ?? true} /> Visible
          to customers
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p className="hint">
          Price changes are recorded and sent to connected customers. Customers must review changed
          totals before ordering.
        </p>
        <button className="primary wide" disabled={busy}>
          {busy ? 'Saving…' : 'Save product'}
        </button>
      </form>
    </Modal>
  );
}
