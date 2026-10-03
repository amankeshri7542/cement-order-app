'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileImage,
  History,
  ImagePlus,
  ListPlus,
  Plus,
  RefreshCw,
  Search,
  Share2,
  SlidersHorizontal,
} from 'lucide-react';
import {
  Category,
  Page,
  Product,
  RateBatch,
  RateCard,
  RateItem,
  RateRowEdit,
  money,
} from '@shiv/shared';
import { api, API_URL, errorMessage, uploadFile } from '../../lib/api';
import { Empty, Field, Modal } from '../ui';
import { ProductEditor } from '../products';

const base = '/admin/rate-studio';
type DraftRow = RateItem & { priceText: string };
type Providers = {
  visionConfigured: boolean;
  modelConfigured: boolean;
  storageConfigured: boolean;
  model: string | null;
};
type Picker = { type: 'add' | 'adjust' } | { type: 'match'; index: number };
const date = (value: string) =>
  new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const draft = (item: RateItem): DraftRow => ({
  ...item,
  priceText: item.proposedPricePaise === null ? '' : String(item.proposedPricePaise / 100),
});
const editable = (batch: RateBatch) =>
  !['PUBLISHED', 'CANCELLED', 'PROCESSING'].includes(batch.status);
const blank = (product?: Product): DraftRow => ({
  id: `local-${crypto.randomUUID()}`,
  productId: product?.id ?? null,
  label: product?.name ?? '',
  brand: product?.brand ?? '',
  specification: product ? [product.grade, product.packSize].filter(Boolean).join(' · ') : '',
  unit: product?.unit ?? '',
  weight: '',
  proposedPricePaise: product?.pricePaise ?? null,
  priceText: product ? String(product.pricePaise / 100) : '',
  included: true,
  reviewed: false,
  acknowledged: false,
  note: '',
  rememberAlias: false,
  refreshBaseline: false,
  position: 0,
  expectedProductVersion: product?.version ?? null,
  oldPricePaise: product?.pricePaise ?? null,
  confidence: null,
  matchMethod: 'MANUAL',
  extracted: null,
  product: product ?? null,
  issues: [],
  publishedPricePaise: null,
  publishedProduct: null,
});
function edits(rows: DraftRow[]): RateRowEdit[] {
  return rows.map((row) => ({
    ...(row.id.startsWith('local-') ? {} : { id: row.id }),
    productId: row.productId,
    label: row.label,
    brand: row.brand,
    specification: row.specification,
    unit: row.unit,
    weight: row.weight,
    proposedPricePaise: row.priceText.trim() ? Math.round(Number(row.priceText) * 100) : null,
    included: row.included,
    reviewed: row.reviewed,
    acknowledged: row.acknowledged,
    note: row.note,
    rememberAlias: row.rememberAlias,
    refreshBaseline: row.refreshBaseline,
    expectedProductVersion: row.expectedProductVersion,
  }));
}

export function RateStudio({
  categories,
  refresh,
  notice,
  onDirtyChange,
}: {
  categories: Category[];
  refresh: () => Promise<void>;
  notice: (value: string) => void;
  onDirtyChange: (value: boolean) => void;
}) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [history, setHistory] = useState<Page<RateBatch>>({ items: [], nextCursor: null });
  const [batch, setBatch] = useState<RateBatch | null>(null);
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [create, setCreate] = useState<'MANUAL' | 'IMAGE' | 'ADJUSTMENT' | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [addingProduct, setAddingProduct] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'cancel' | 'leave' | null>(null);
  const [cards, setCards] = useState(false);
  const [historyOnly, setHistoryOnly] = useState(false);
  const createKey = useRef(crypto.randomUUID());
  const mounted = useRef(true);
  const historyRef = useRef<HTMLDivElement>(null);

  const adopt = useCallback((value: RateBatch) => {
    setBatch(value);
    setTitle(value.title);
    setRows(value.items.map(draft));
    setDirty(false);
  }, []);
  const loadHistory = useCallback(async (cursor?: string) => {
    const result = await api<Page<RateBatch>>(
      `${base}/batches?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    setHistory((old) => (cursor ? { ...result, items: [...old.items, ...result.items] } : result));
  }, []);
  useEffect(() => {
    mounted.current = true;
    Promise.all([api<Providers>(`${base}/providers`).then(setProviders), loadHistory()]).catch(
      (e) => setError(errorMessage(e)),
    );
    return () => {
      mounted.current = false;
    };
  }, [loadHistory]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (batch?.status !== 'PROCESSING') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<RateBatch>(`${base}/batches/${batch.id}`);
        if (cancelled) return;
        adopt(result);
        if (result.status === 'PROCESSING') timer = setTimeout(poll, 2000);
        else await loadHistory();
      } catch (e) {
        if (!cancelled)
          setError(`${errorMessage(e)} Your source is saved. Reload the draft to check progress.`);
      }
    };
    timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [batch?.id, batch?.status, adopt, loadHistory]);

  async function run(name: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  async function open(id: string) {
    await run('Opening draft', async () => {
      adopt(await api<RateBatch>(`${base}/batches/${id}`));
      setCards(false);
      setHistoryOnly(false);
    });
  }
  function change(index: number, patch: Partial<DraftRow>, approval = false) {
    setRows((old) =>
      old.map((row, i) =>
        i === index
          ? { ...row, ...(!approval ? { reviewed: false, acknowledged: false } : {}), ...patch }
          : row,
      ),
    );
    setDirty(true);
  }
  async function save() {
    if (!batch) return;
    const items = edits(rows);
    if (
      items.some(
        (row) =>
          row.proposedPricePaise !== null &&
          (!Number.isSafeInteger(row.proposedPricePaise) || row.proposedPricePaise <= 0),
      )
    )
      throw new Error('Enter a valid price greater than ₹0, or leave the price empty for review.');
    adopt(
      await api<RateBatch>(`${base}/batches/${batch.id}`, 'PATCH', {
        expectedVersion: batch.version,
        title,
        items,
      }),
    );
    await loadHistory();
    notice('Draft saved. Live prices are unchanged.');
  }
  const included = rows.filter((row) => row.included);
  const reviewed = included.filter((row) => row.reviewed).length;
  const locked = Boolean(busy || (batch && !editable(batch)));
  const canPublish =
    batch?.status === 'READY' &&
    !dirty &&
    included.length > 0 &&
    reviewed === included.length &&
    !batch.issues.some((issue) => issue.blocking);

  return (
    <div className="rate-studio">
      <header className="rs-intro">
        <div>
          <span className="rs-eyebrow">SHIV CEMENT STORE / PRICE OPERATIONS</span>
          <h1>
            Rate Studio<span>.</span>
          </h1>
          <p>From the supplier’s sheet to your store’s next price.</p>
        </div>
        <ol className="rs-steps" aria-label="Rate workflow">
          {['Source', 'Review', 'Publish', 'Share'].map((step, index) => (
            <li
              key={step}
              className={batch && index === (batch.status === 'PUBLISHED' ? 3 : 1) ? 'current' : ''}
            >
              <span>{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </header>
      {error && (
        <div role="alert" className="rs-error">
          <strong>Action needs attention</strong>
          <p>{error}</p>
          {batch && (
            <button
              className="secondary"
              disabled={Boolean(busy)}
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm('Discard your unsaved edits and reload the saved draft?')
                )
                  void open(batch.id);
              }}
            >
              <RefreshCw size={16} />
              Reload saved draft
            </button>
          )}
        </div>
      )}
      {!batch && (
        <>
          {!historyOnly && (
            <div className="rs-start-grid">
              <button
                className="rs-start rs-start-feature"
                onClick={() => {
                  createKey.current = crypto.randomUUID();
                  setCreate('IMAGE');
                }}
              >
                <FileImage size={30} strokeWidth={1.5} />
                <span className="rs-eyebrow">SCREENSHOT · PHOTO · PRINTED SHEET</span>
                <strong>Scan a rate sheet</strong>
                <span>Keep the original. Review every number.</span>
                <ArrowRight size={22} />
              </button>
              <button
                className="rs-start"
                onClick={() => {
                  createKey.current = crypto.randomUUID();
                  setCreate('MANUAL');
                }}
              >
                <ListPlus size={26} />
                <strong>Enter prices manually</strong>
                <span>Quick updates from a call or the counter.</span>
                <ArrowRight size={20} />
              </button>
              <button
                className="rs-start"
                onClick={() => {
                  createKey.current = crypto.randomUUID();
                  setCreate('ADJUSTMENT');
                }}
              >
                <SlidersHorizontal size={26} />
                <strong>Increase / decrease</strong>
                <span>Choose products. Preview ₹ or % changes.</span>
                <ArrowRight size={20} />
              </button>
            </div>
          )}
          {providers && (!providers.visionConfigured || !providers.modelConfigured) && (
            <p className="rs-provider-note">
              <span aria-hidden="true">●</span> Automatic extraction is not configured. Manual price
              entry and review are available.
            </p>
          )}
          <div className="rs-history" ref={historyRef}>
            <div className="rs-section-heading">
              <div>
                <span className="rs-eyebrow">THE PRICE REGISTER</span>
                <h3>{historyOnly ? 'Marketing rate cards & history' : 'Price sheet history'}</h3>
              </div>
              <button className="secondary" onClick={() => setHistoryOnly(!historyOnly)}>
                <History size={16} />
                {historyOnly ? 'All workflows' : 'Marketing rate cards'}
              </button>
            </div>
            {!history.items.length && (
              <Empty
                title="Your first price sheet starts here"
                body="Create a draft, review the changes and publish when every row is ready."
              />
            )}
            <div className="rs-history-list">
              {history.items.map((item) => (
                <button
                  key={item.id}
                  disabled={Boolean(busy)}
                  onClick={() => void open(item.id)}
                  className="rs-history-entry"
                >
                  <span className="rs-history-icon">
                    {item.sourceType === 'IMAGE' ? <FileImage size={21} /> : <ListPlus size={21} />}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {date(item.publishedAt || item.createdAt)} · {label(item.sourceType)}
                    </small>
                  </span>
                  <span className={`rs-status rs-status-${item.status.toLowerCase()}`}>
                    {label(item.status)}
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))}
            </div>
            {history.nextCursor && (
              <button
                className="secondary"
                disabled={Boolean(busy)}
                onClick={() => void run('Loading history', () => loadHistory(history.nextCursor!))}
              >
                Load more price sheets
              </button>
            )}
          </div>
        </>
      )}
      {batch && (
        <>
          <div className="rs-batch-heading">
            <button
              className="text-button"
              disabled={Boolean(busy)}
              onClick={() => (dirty ? setConfirm('leave') : setBatch(null))}
            >
              <ArrowLeft size={16} />
              All price sheets
            </button>
            <span className={`rs-status rs-status-${batch.status.toLowerCase()}`}>
              {label(batch.status)}
            </span>
            <small>
              Revision {batch.version}
              {dirty ? ' · Unsaved changes' : ' · Saved'}
            </small>
          </div>
          <div className="rs-title-row">
            <input
              className="rs-title-input"
              aria-label="Price sheet title"
              maxLength={120}
              value={title}
              disabled={locked}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
            {batch.status === 'PUBLISHED' && (
              <button className="primary" onClick={() => setCards(true)}>
                <Share2 size={17} />
                Create Shiv Rate Card
              </button>
            )}
          </div>
          {batch.status === 'PUBLISHED' && (
            <div className="rs-published">
              <Check size={23} />
              <div>
                <strong>Prices published</strong>
                <p>
                  {batch.publishedAt && date(batch.publishedAt)} · Approved by{' '}
                  {batch.publishedByName || 'store staff'}. These reviewed values are preserved in
                  this record.
                </p>
              </div>
            </div>
          )}
          {batch.status === 'PROCESSING' && (
            <div className="rs-processing" role="status">
              <RefreshCw size={21} />
              <div>
                <strong>Reading your rate sheet</strong>
                <p>{label(batch.stage)} · You can leave this page and return to the saved draft.</p>
              </div>
            </div>
          )}
          {batch.errorCode && (
            <div className="rs-warning" role="status">
              <strong>Automatic extraction needs attention</strong>
              <p>
                {label(batch.errorCode)}. Your source has been retained. Add products manually or
                retry extraction.
              </p>
            </div>
          )}
          <div className="rs-workbench">
            <aside className="rs-source">
              <div className="rs-section-heading">
                <h3>Source evidence</h3>
                <span className="rs-eyebrow">{label(batch.sourceType)}</span>
              </div>
              {batch.source ? (
                <>
                  <a
                    href={`${API_URL}${base}/batches/${batch.id}/source`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open original rate sheet"
                  >
                    <img
                      className="rs-source-image"
                      src={`${API_URL}${base}/batches/${batch.id}/source`}
                      crossOrigin="use-credentials"
                      alt="Original rate sheet for price comparison"
                    />
                  </a>
                  <p className="rs-file-name">{batch.source.fileName}</p>
                  <details>
                    <summary>Read OCR source text</summary>
                    <pre className="rs-ocr">
                      {batch.source.ocrText ||
                        'No extracted text yet. You can enter prices manually.'}
                    </pre>
                  </details>
                  {editable(batch) && !batch.items.length && !batch.extraction && (
                    <button
                      className="secondary wide"
                      disabled={
                        Boolean(busy) ||
                        dirty ||
                        !providers?.visionConfigured ||
                        !providers?.modelConfigured
                      }
                      onClick={() =>
                        void run('Extracting', async () =>
                          adopt(
                            await api<RateBatch>(`${base}/batches/${batch.id}/extract`, 'POST', {
                              expectedVersion: batch.version,
                            }),
                          ),
                        )
                      }
                    >
                      <RefreshCw size={16} />
                      {batch.errorCode ? 'Retry extraction' : 'Extract prices'}
                    </button>
                  )}
                  {dirty && <small>Save this draft before extracting.</small>}
                </>
              ) : (
                <div className="rs-source-empty">
                  <FileImage size={34} strokeWidth={1.3} />
                  <strong>
                    {batch.sourceType === 'IMAGE' ? 'Add the original sheet' : 'A counter update'}
                  </strong>
                  <p>
                    {batch.sourceType === 'IMAGE'
                      ? 'Upload a clear screenshot or photograph. PNG, JPG or WebP, up to 5 MB.'
                      : 'Enter the rates you confirmed with your supplier. Notes stay with each reviewed row.'}
                  </p>
                </div>
              )}
              {editable(batch) && !batch.source && (
                <label className={`rs-upload ${busy || dirty ? 'rs-disabled' : ''}`}>
                  <ImagePlus size={18} />
                  Upload rate sheet
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={Boolean(busy) || dirty}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      void run('Uploading source', async () => {
                        if (
                          file.size > 5 * 1024 * 1024 ||
                          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
                        )
                          throw new Error('Choose a PNG, JPG or WebP image smaller than 5 MB.');
                        await uploadFile(`${base}/batches/${batch.id}/source`, file, batch.version);
                        adopt(await api<RateBatch>(`${base}/batches/${batch.id}`));
                      });
                    }}
                  />
                </label>
              )}
              <p className="rs-evidence-note">
                Source material suggests a price. Only your reviewed, published changes reach
                customers.
              </p>
              {batch.extraction && (
                <details>
                  <summary>Original extracted values</summary>
                  <pre className="rs-ocr">{JSON.stringify(batch.extraction, null, 2)}</pre>
                </details>
              )}
              {batch.status === 'PUBLISHED' && batch.cards.length > 0 && (
                <button className="secondary wide" onClick={() => setCards(true)}>
                  <Share2 size={16} />
                  View {batch.cards.length} saved rate card{batch.cards.length === 1 ? '' : 's'}
                </button>
              )}
            </aside>
            <section className="rs-review" aria-label="Review price changes">
              <div className="rs-review-heading">
                <div>
                  <span className="rs-eyebrow">CHECK EVERY NUMBER</span>
                  <h3>
                    {batch.status === 'PUBLISHED' ? 'Published price record' : 'Review the rates'}
                  </h3>
                </div>
                <span className="rs-review-count">
                  {reviewed}
                  <small> / {included.length} reviewed</small>
                </span>
              </div>
              {editable(batch) && (
                <div className="rs-row-actions">
                  <button
                    className="secondary"
                    disabled={Boolean(busy) || rows.length >= 100}
                    onClick={() => setPicker({ type: 'add' })}
                  >
                    <Plus size={16} />
                    Choose products
                  </button>
                  <button
                    className="text-button"
                    disabled={Boolean(busy) || rows.length >= 100}
                    onClick={() => {
                      setRows((old) => [...old, blank()]);
                      setDirty(true);
                    }}
                  >
                    Add blank row
                  </button>
                  <button
                    className="text-button"
                    disabled={Boolean(busy) || dirty}
                    onClick={() => setPicker({ type: 'adjust' })}
                  >
                    <SlidersHorizontal size={16} />
                    Adjust prices
                  </button>
                </div>
              )}
              {!rows.length && (
                <Empty
                  title="No rates in this draft yet"
                  body="Choose existing products, add a blank row, or extract the uploaded sheet to get started."
                />
              )}
              {rows.map((row, index) => (
                <article
                  key={row.id}
                  className={`rs-rate-row ${!row.included ? 'rs-excluded' : ''}`}
                >
                  <div className="rs-row-top">
                    <span className="rs-row-number">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>
                        {String(
                          row.publishedProduct?.name ||
                            row.product?.name ||
                            row.label ||
                            'Unmatched material',
                        )}
                      </strong>
                      <small>
                        {row.publishedProduct
                          ? `${String(row.publishedProduct.brand || '')} · ${String(row.publishedProduct.unit || '')}`
                          : row.product
                            ? `${row.product.brand} · ${row.product.unit}`
                            : 'Choose the exact store product before publishing'}
                      </small>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={row.included}
                        disabled={locked}
                        onChange={(e) => change(index, { included: e.target.checked })}
                      />
                      Include
                    </label>
                  </div>
                  <div className="rs-price-comparison">
                    <div>
                      <span>Previous rate</span>
                      <strong>{row.oldPricePaise === null ? '—' : money(row.oldPricePaise)}</strong>
                    </div>
                    <ArrowRight size={20} />
                    {batch.status === 'PUBLISHED' ? (
                      <div>
                        <span>Published rate</span>
                        <strong>
                          {row.publishedPricePaise === null
                            ? 'Excluded'
                            : money(row.publishedPricePaise)}
                        </strong>
                      </div>
                    ) : (
                      <Field label="New rate (₹)">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          max="1000000"
                          inputMode="decimal"
                          aria-label={`New price row ${index + 1}`}
                          value={row.priceText}
                          disabled={locked || !row.included}
                          onChange={(e) => change(index, { priceText: e.target.value })}
                        />
                      </Field>
                    )}
                    <span className="rs-delta">
                      {row.oldPricePaise !== null &&
                      row.priceText &&
                      Number.isFinite(Number(row.priceText))
                        ? `${Math.round(Number(row.priceText) * 100) >= row.oldPricePaise ? '+' : '−'}${money(Math.abs(Math.round(Number(row.priceText) * 100) - row.oldPricePaise))}`
                        : 'Match required'}
                    </span>
                  </div>
                  <div className="rs-match-line">
                    <span>
                      {label(row.matchMethod)}
                      {row.confidence !== null
                        ? ` · ${Math.round(row.confidence * 100)}% extraction confidence`
                        : ''}
                    </span>
                    {!locked && (
                      <button
                        className="text-button"
                        onClick={() => setPicker({ type: 'match', index })}
                      >
                        {row.productId ? 'Change product' : 'Match product'}
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                  {row.issues.length > 0 && (
                    <ul className="rs-issues">
                      {row.issues.map((issue, i) => (
                        <li
                          key={`${issue.code}-${i}`}
                          className={issue.blocking ? 'rs-blocker' : ''}
                        >
                          <strong>{issue.blocking ? 'Resolve' : 'Check'}:</strong> {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {row.extracted && (
                    <blockquote className="rs-source-quote">
                      “{row.extracted.sourceText}”
                      <small>{row.extracted.sourceReference || 'Source sheet'}</small>
                    </blockquote>
                  )}
                  <details className="rs-row-details">
                    <summary>Source details & review notes</summary>
                    <div className="rs-detail-grid">
                      {(['label', 'brand', 'specification', 'unit', 'weight'] as const).map(
                        (field) => (
                          <Field
                            key={field}
                            label={field === 'label' ? 'Source product name' : label(field)}
                          >
                            <input
                              value={row[field]}
                              disabled={locked}
                              maxLength={
                                field === 'specification' ? 160 : field === 'label' ? 120 : 80
                              }
                              onChange={(e) => change(index, { [field]: e.target.value })}
                            />
                          </Field>
                        ),
                      )}
                    </div>
                    <Field label="Review notes">
                      <textarea
                        maxLength={500}
                        value={row.note}
                        disabled={locked}
                        placeholder="Supplier confirmed by phone; checked unit and pack size…"
                        onChange={(e) => change(index, { note: e.target.value })}
                      />
                    </Field>
                    {!locked && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={row.rememberAlias}
                          onChange={(e) => change(index, { rememberAlias: e.target.checked })}
                        />
                        Remember this confirmed product name for future sheets
                      </label>
                    )}
                    {row.product && !locked && (
                      <button
                        className="text-button"
                        onClick={() => change(index, { refreshBaseline: true })}
                      >
                        Use current product version as baseline
                        {row.refreshBaseline ? ' · selected; save to refresh' : ''}
                      </button>
                    )}
                    {row.publishedProduct && (
                      <p className="hint">
                        Published product: {String(row.publishedProduct.name || '')} ·{' '}
                        {String(row.publishedProduct.unit || '')}
                      </p>
                    )}
                  </details>
                  <div className="rs-approval">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={row.reviewed}
                        disabled={locked || !row.included}
                        onChange={(e) => change(index, { reviewed: e.target.checked }, true)}
                      />
                      I checked the product, unit and price
                    </label>
                    {row.issues.some((issue) => !issue.blocking) && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={row.acknowledged}
                          disabled={locked || !row.included}
                          onChange={(e) => change(index, { acknowledged: e.target.checked }, true)}
                        />
                        I verified the warnings above
                      </label>
                    )}
                  </div>
                </article>
              ))}
              {batch.issues.length > 0 && (
                <ul className="rs-issues">
                  {batch.issues.map((issue, i) => (
                    <li key={`${issue.code}-${i}`}>{issue.message}</li>
                  ))}
                </ul>
              )}
              {editable(batch) && (
                <div className="rs-publish-bar">
                  <div>
                    <strong>{included.length} included rates</strong>
                    <small>
                      {dirty
                        ? 'Save to validate your latest changes.'
                        : canPublish
                          ? 'Reviewed and ready for confirmation.'
                          : 'Resolve issues and review each included row.'}
                    </small>
                  </div>
                  <button
                    className="secondary"
                    disabled={Boolean(busy) || !dirty}
                    onClick={() => void run('Saving draft', save)}
                  >
                    Save draft
                  </button>
                  <button
                    className="primary"
                    disabled={Boolean(busy) || !canPublish}
                    onClick={() => setConfirm('publish')}
                  >
                    Publish prices
                    <ArrowRight size={17} />
                  </button>
                </div>
              )}
              {editable(batch) && (
                <button
                  className="text-button rs-cancel"
                  disabled={Boolean(busy)}
                  onClick={() => setConfirm('cancel')}
                >
                  Cancel this price sheet
                </button>
              )}
            </section>
          </div>
        </>
      )}
      {busy && (
        <p className="rs-busy" role="status">
          {busy}…
        </p>
      )}
      {create && (
        <Modal
          title={
            create === 'IMAGE'
              ? 'Scan a rate sheet'
              : create === 'ADJUSTMENT'
                ? 'Adjust existing prices'
                : 'Enter prices manually'
          }
          close={() => {
            if (!busy) setCreate(null);
          }}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const nextTitle = String(new FormData(e.currentTarget).get('title'));
              void run('Creating draft', async () => {
                const result = await api<RateBatch>(`${base}/batches`, 'POST', {
                  title: nextTitle,
                  sourceType: create,
                  idempotencyKey: createKey.current,
                });
                adopt(result);
                if (create === 'ADJUSTMENT') setPicker({ type: 'adjust' });
                setCreate(null);
                await loadHistory();
              });
            }}
          >
            <p>
              A saved draft keeps your work together. Live product prices change only after review
              and publication.
            </p>
            <Field label="Price sheet title">
              <input
                name="title"
                required
                maxLength={120}
                autoFocus
                defaultValue={`Store rates · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              />
            </Field>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={Boolean(busy)}>
              Create draft
              <ArrowRight size={17} />
            </button>
          </form>
        </Modal>
      )}
      {picker && batch && (
        <ProductPicker
          categories={categories}
          mode={picker.type}
          selectedIds={
            picker.type === 'match'
              ? []
              : rows.map((row) => row.productId).filter((id): id is string => Boolean(id))
          }
          close={() => setPicker(null)}
          addProduct={() => setAddingProduct(true)}
          confirm={async (products, adjustment) => {
            if (picker.type === 'adjust' && adjustment) {
              const result = await api<RateBatch>(`${base}/batches/${batch.id}/adjust`, 'POST', {
                expectedVersion: batch.version,
                productIds: products.map((product) => product.id),
                ...adjustment,
              });
              adopt(result);
              notice('Adjustment preview created. Check each new price before publishing.');
            } else if (picker.type === 'match') {
              const product = products[0];
              if (product)
                change(picker.index, {
                  productId: product.id,
                  product,
                  oldPricePaise: product.pricePaise,
                  expectedProductVersion: product.version,
                  matchMethod: 'MANUAL',
                  refreshBaseline: true,
                });
            } else {
              const existing = new Set(rows.map((row) => row.productId));
              const added = products.filter((product) => !existing.has(product.id));
              if (rows.length + added.length > 100)
                throw new Error('A price sheet can contain up to 100 rows.');
              setRows((old) => [...old, ...added.map(blank)]);
              setDirty(true);
            }
            setPicker(null);
          }}
        />
      )}
      {addingProduct && (
        <ProductEditor
          categories={categories}
          close={() => setAddingProduct(false)}
          saved={async () => {
            setAddingProduct(false);
            await refresh();
            notice('Product created. Search for it to add it to this sheet.');
          }}
        />
      )}
      {confirm && (
        <Modal
          title={
            confirm === 'publish'
              ? 'Publish these prices?'
              : confirm === 'cancel'
                ? 'Cancel this price sheet?'
                : 'Leave without saving?'
          }
          close={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <div className="form-stack">
            <p>
              {confirm === 'publish'
                ? `${included.length} reviewed rates will be checked against current product versions and published together. Customers will see the new rates and must review changed checkout totals.`
                : confirm === 'cancel'
                  ? 'This sheet will be closed. Published catalogue prices will not change.'
                  : 'Your unsaved edits will be discarded. The last saved draft stays in price sheet history.'}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary"
              disabled={Boolean(busy)}
              onClick={() =>
                void run(
                  confirm === 'publish' ? 'Publishing prices' : 'Closing draft',
                  async () => {
                    if (confirm === 'leave') {
                      setBatch(null);
                      setDirty(false);
                    } else if (batch) {
                      adopt(
                        await api<RateBatch>(`${base}/batches/${batch.id}/${confirm}`, 'POST', {
                          expectedVersion: batch.version,
                          ...(confirm === 'publish' ? { confirmation: 'PUBLISH' } : {}),
                        }),
                      );
                      await loadHistory();
                      if (confirm === 'publish') {
                        await refresh();
                        notice('Prices published. Your customers now have the latest rates.');
                      }
                    }
                    setConfirm(null);
                  },
                )
              }
            >
              {confirm === 'publish'
                ? 'Confirm & publish prices'
                : confirm === 'cancel'
                  ? 'Confirm cancellation'
                  : 'Discard unsaved edits'}
            </button>
            <button className="secondary" disabled={Boolean(busy)} onClick={() => setConfirm(null)}>
              Keep reviewing
            </button>
          </div>
        </Modal>
      )}
      {cards && batch && (
        <CardStudio
          batch={batch}
          close={() => setCards(false)}
          saved={(card) => setBatch((old) => (old ? { ...old, cards: [card, ...old.cards] } : old))}
        />
      )}
    </div>
  );
}

function ProductPicker({
  categories,
  mode,
  selectedIds,
  close,
  confirm,
  addProduct,
}: {
  categories: Category[];
  mode: Picker['type'];
  selectedIds: string[];
  close: () => void;
  addProduct: () => void;
  confirm: (
    products: Product[],
    adjustment?: { kind: string; direction: string; amount: number },
  ) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [page, setPage] = useState<Page<Product>>({ items: [], nextCursor: null });
  const [selected, setSelected] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('FIXED');
  const [direction, setDirection] = useState('INCREASE');
  const [amount, setAmount] = useState('');
  const generation = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      const id = ++generation.current;
      setLoading(true);
      setError('');
      try {
        const result = await api<Page<Product>>(
          `/admin/products?limit=12&q=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}&brand=${encodeURIComponent(brand)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        if (id === generation.current)
          setPage((old) =>
            cursor ? { ...result, items: [...old.items, ...result.items] } : result,
          );
      } catch (e) {
        if (id === generation.current) setError(errorMessage(e));
      } finally {
        if (id === generation.current) setLoading(false);
      }
    },
    [query, category, brand],
  );
  useEffect(() => {
    generation.current++;
    setPage({ items: [], nextCursor: null });
    const timer = setTimeout(() => void load(), 250);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [load]);
  return (
    <Modal
      title={
        mode === 'match'
          ? 'Match the exact store product'
          : mode === 'adjust'
            ? 'Preview a price adjustment'
            : 'Choose products'
      }
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="rate-studio rs-picker form-stack">
        <div className="rs-picker-filters">
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Search rate products"
              placeholder="Name, grade or specification"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Rate product category"
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
          <input
            aria-label="Rate product brand"
            placeholder="Filter by brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
        </div>
        <div className="rs-picker-list" aria-busy={loading}>
          {page.items.map((product) => (
            <label key={product.id} className="rs-picker-product">
              <input
                type={mode === 'match' ? 'radio' : 'checkbox'}
                name="rate-product"
                disabled={!product.active || (mode === 'add' && selectedIds.includes(product.id))}
                checked={Boolean(selected[product.id])}
                onChange={(e) =>
                  setSelected((old) => {
                    if (mode === 'match') return { [product.id]: product };
                    const next = { ...old };
                    if (e.target.checked) next[product.id] = product;
                    else delete next[product.id];
                    return next;
                  })
                }
              />
              <span>
                <strong>{product.name}</strong>
                <small>
                  {product.brand} · {product.grade} · {product.unit}
                  {!product.active ? ' · Inactive' : ''}
                </small>
              </span>
              <strong>{money(product.pricePaise)}</strong>
            </label>
          ))}
        </div>
        {loading && <p role="status">Finding products…</p>}
        {!loading && !page.items.length && (
          <p>No products found. Try another search or add the missing product.</p>
        )}
        {page.nextCursor && (
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void load(page.nextCursor!)}
          >
            Load more products
          </button>
        )}
        <button className="text-button" onClick={addProduct}>
          <Plus size={16} />
          Add missing product
        </button>
        {mode === 'adjust' && (
          <div className="rs-adjust-controls">
            <Field label="Direction">
              <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="INCREASE">Increase</option>
                <option value="DECREASE">Decrease</option>
              </select>
            </Field>
            <Field label="Adjustment type">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="FIXED">Fixed amount (₹)</option>
                <option value="PERCENT">Percentage (%)</option>
              </select>
            </Field>
            <Field label={kind === 'FIXED' ? 'Amount (₹)' : 'Percentage (%)'}>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          </div>
        )}
        {mode === 'adjust' && (
          <p className="hint">
            Creates a new preview for the selected products, replacing draft rows. Live prices stay
            unchanged.
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button
          className="primary wide"
          disabled={busy || !Object.keys(selected).length || Object.keys(selected).length > 100}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const numeric = Math.round(Number(amount) * 100);
              if (mode === 'adjust' && (!Number.isSafeInteger(numeric) || numeric <= 0))
                throw new Error('Enter a positive adjustment amount.');
              await confirm(
                Object.values(selected),
                mode === 'adjust' ? { kind, direction, amount: numeric } : undefined,
              );
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? 'Preparing…'
            : mode === 'adjust'
              ? `Preview ${Object.keys(selected).length} price changes`
              : mode === 'match'
                ? 'Confirm product match'
                : `Add ${Object.keys(selected).length} products`}
        </button>
      </div>
    </Modal>
  );
}

function CardStudio({
  batch,
  close,
  saved,
}: {
  batch: RateBatch;
  close: () => void;
  saved: (card: RateCard) => void;
}) {
  const [card, setCard] = useState<(RateCard & { pages: number }) | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [format, setFormat] = useState('STATUS');
  const [template, setTemplate] = useState('COUNTER');
  async function open(id: string) {
    setBusy(true);
    setError('');
    try {
      setCard(await api<RateCard & { pages: number }>(`${base}/cards/${id}`));
      setPage(1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function download(share: boolean) {
    if (!card) return;
    setBusy(true);
    setError('');
    try {
      const result = await fetch(`${API_URL}${base}/cards/${card.id}/pages/${page}/png`, {
        credentials: 'include',
      });
      if (!result.ok) throw new Error('Could not download this rate card. Please try again.');
      const file = new File([await result.blob()], `shiv-rates-${card.id}-${page}.png`, {
        type: 'image/png',
      });
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: card.snapshot.heading });
        return;
      }
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Shiv Rate Card Studio"
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="rate-studio rs-card-studio">
        <p>
          Artwork uses the approved product names, prices and units. Only the message and layout are
          editable.
        </p>
        {batch.cards.length > 0 && (
          <Field label="Saved rate cards">
            <select
              value={card?.id || ''}
              disabled={busy}
              onChange={(e) => {
                if (e.target.value) void open(e.target.value);
              }}
            >
              <option value="">Choose a previously generated card</option>
              {batch.cards.map((item) => (
                <option key={item.id} value={item.id}>
                  {label(item.format)} · {date(item.createdAt)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!card ? (
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setBusy(true);
              setError('');
              try {
                const result = await api<RateCard>(`${base}/batches/${batch.id}/cards`, 'POST', {
                  format,
                  template,
                  heading: String(data.get('heading')),
                  deliveryMessage: String(data.get('deliveryMessage')),
                  contactLabel: String(data.get('contactLabel')),
                  promotionalCopy: String(data.get('promotionalCopy')),
                  confirmed: true,
                });
                saved(result);
                await open(result.id);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="rs-detail-grid">
              <Field label="Format">
                <select value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="STATUS">WhatsApp Status · 1080 × 1920</option>
                  <option value="SQUARE">Square Social · 1080 × 1080</option>
                  <option value="SHEET">Shareable Rate Sheet · portrait</option>
                </select>
              </Field>
              <Field label="Template">
                <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                  <option value="COUNTER">Counter · graphite & amber</option>
                  <option value="BULLETIN">Bulletin · concrete & ink</option>
                </select>
              </Field>
            </div>
            <div
              className={`rs-template-sample rs-template-${template.toLowerCase()}`}
              aria-hidden="true"
            >
              <span>SHIV CEMENT STORE</span>
              <strong>
                {template === 'COUNTER' ? 'TODAY’S RATES.' : 'MATERIAL RATE BULLETIN'}
              </strong>
              <i />
              <i />
              <small>Approved rates · clear units · store contact</small>
            </div>
            <Field label="Heading">
              <input name="heading" required maxLength={80} defaultValue="Today’s material rates" />
            </Field>
            <Field label="Delivery message">
              <input
                name="deliveryMessage"
                maxLength={160}
                defaultValue="Contact the store to confirm delivery to your site."
              />
            </Field>
            <Field label="Contact label">
              <input name="contactLabel" maxLength={40} defaultValue="Call / WhatsApp" />
            </Field>
            <Field label="Optional promotional copy">
              <textarea
                name="promotionalCopy"
                maxLength={160}
                placeholder="Add a short message. Check any stock or delivery claims."
              />
            </Field>
            <label className="check">
              <input type="checkbox" required />I checked the message and delivery claims
            </label>
            <button className="primary wide" disabled={busy}>
              {busy ? 'Generating artwork…' : 'Generate rate card'}
            </button>
          </form>
        ) : (
          <div className="rs-card-result">
            <img
              className="rs-card-preview"
              src={`${API_URL}${base}/cards/${card.id}/pages/${page}/png`}
              crossOrigin="use-credentials"
              alt={`${card.snapshot.heading}, rate card page ${page} of ${card.pages}`}
              onError={() =>
                setError(
                  'Preview could not be rendered. Try downloading again or use the SVG version below.',
                )
              }
            />
            <a
              className="text-button"
              href={`${API_URL}${base}/cards/${card.id}/pages/${page}/svg`}
              target="_blank"
              rel="noreferrer"
            >
              Open printable SVG
            </a>
            <div className="rs-card-pagination">
              <button
                className="secondary"
                disabled={page <= 1 || busy}
                onClick={() => setPage((old) => old - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {card.pages}
              </span>
              <button
                className="secondary"
                disabled={page >= card.pages || busy}
                onClick={() => setPage((old) => old + 1)}
              >
                Next
              </button>
            </div>
            <div className="rs-card-actions">
              <button className="primary" disabled={busy} onClick={() => void download(false)}>
                Download PNG
              </button>
              <button className="secondary" disabled={busy} onClick={() => void download(true)}>
                <Share2 size={16} />
                Share / download
              </button>
            </div>
            <p className="hint">
              Download each page for a multi-page sheet. Sharing opens your device’s share sheet
              when supported.
            </p>
            <button className="text-button" disabled={busy} onClick={() => setCard(null)}>
              Create another layout
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error} Published prices are unchanged.
          </p>
        )}
      </div>
    </Modal>
  );
}
