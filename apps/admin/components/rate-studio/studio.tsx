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
import { api, API_URL, uploadFile } from '../../lib/api';
import { useWords } from '../../lib/i18n';
import { useOwner, useUnsavedGuard } from '../../lib/owner';
import { Empty, Field, Modal } from '../ui';
import { ProductEditor } from '../products';

const base = '/admin/rate-studio';
type T = (en: string, hi: string) => string;
// A check made here in the desk: its message is already in the chosen language.
class Problem extends Error {}
type DraftRow = RateItem & { priceText: string };
type Providers = {
  visionConfigured: boolean;
  modelConfigured: boolean;
  storageConfigured: boolean;
  model: string | null;
};
type Picker = { type: 'add' | 'adjust' } | { type: 'match'; index: number };
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');
// Server codes (status, source, stage, match, format) as words; unknown codes stay as plain English.
const named = (t: T) => {
  const words: Record<string, string> = {
    DRAFT: t('draft', 'ड्राफ्ट'),
    REVIEW_REQUIRED: t('review required', 'जाँच बाकी'),
    READY: t('ready', 'तैयार'),
    PROCESSING: t('processing', 'पढ़ा जा रहा है'),
    PUBLISHED: t('published', 'लागू'),
    CANCELLED: t('cancelled', 'रद्द'),
    MANUAL: t('manual', 'हाथ से'),
    IMAGE: t('image', 'फ़ोटो'),
    ADJUSTMENT: t('adjustment', 'भाव बढ़ाना-घटाना'),
    UPLOADING: t('uploading', 'अपलोड हो रहा है'),
    READING_SOURCE: t('reading source', 'शीट पढ़ी जा रही है'),
    INTERPRETING: t('interpreting', 'भाव समझे जा रहे हैं'),
    CONFIRMED_ALIAS: t('confirmed alias', 'पक्का किया नाम'),
    NORMALIZED_NAME: t('normalized name', 'नाम से मिला'),
    BRAND_SPECIFICATION: t('brand specification', 'ब्रांड और विवरण से मिला'),
    NEEDS_MATCH: t('needs match', 'सामग्री चुननी है'),
    UNRECOGNIZED: t('unrecognized', 'पहचान नहीं हुई'),
    STATUS: t('status', 'WhatsApp स्टेटस'),
    SQUARE: t('square', 'चौकोर'),
    SHEET: t('sheet', 'भाव शीट'),
    brand: t('brand', 'ब्रांड'),
    specification: t('specification', 'विवरण'),
    unit: t('unit', 'इकाई'),
    weight: t('weight', 'वज़न'),
  };
  return (value: string) => words[value] ?? label(value);
};
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
  const { t, error: say, moment } = useWords();
  const { confirm: confirmAction } = useOwner();
  const name = named(t);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [history, setHistory] = useState<Page<RateBatch>>({ items: [], nextCursor: null });
  const [batch, setBatch] = useState<RateBatch | null>(null);
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [create, setCreate] = useState<'MANUAL' | 'IMAGE' | 'ADJUSTMENT' | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [addingProduct, setAddingProduct] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'cancel' | null>(null);
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
      (e) => setError(say(e)),
    );
    return () => {
      mounted.current = false;
    };
  }, [loadHistory]);
  useEffect(() => {
    const refreshVisible = () => {
      void Promise.all([
        api<Providers>(`${base}/providers`).then(setProviders),
        loadHistory(),
        batch && !dirty && !busy
          ? api<RateBatch>(`${base}/batches/${batch.id}`).then(adopt)
          : Promise.resolve(),
      ])
        .then(() => setError(''))
        .catch((e) => setError(say(e)));
    };
    window.addEventListener('shiv-owner-refresh', refreshVisible);
    return () => window.removeEventListener('shiv-owner-refresh', refreshVisible);
  }, [adopt, batch, busy, dirty, loadHistory]);
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
          setError(
            `${say(e)} ${t(
              'Your source is saved. Reload the draft to check progress.',
              'आपकी शीट सहेजी हुई है। प्रगति देखने के लिए ड्राफ्ट फिर से खोलें।',
            )}`,
          );
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
      setError(e instanceof Problem ? e.message : say(e));
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  async function open(id: string) {
    await run(t('Opening draft', 'ड्राफ्ट खुल रहा है'), async () => {
      adopt(await api<RateBatch>(`${base}/batches/${id}`));
      setCards(false);
      setHistoryOnly(false);
    });
  }
  async function safeClose() {
    if (busy) return;
    if (
      dirty &&
      !(await confirmAction({
        title: t('Leave without saving?', 'बिना सहेजे बाहर जाएँ?'),
        body: t(
          'Your unsaved edits will be discarded. The last saved draft stays in price sheet history.',
          'बिना सहेजे बदलाव हट जाएँगे। आख़िरी सहेजा ड्राफ्ट पुरानी भाव शीटों में रहेगा।',
        ),
        confirmLabel: t('Discard unsaved edits', 'बिना सहेजे बदलाव हटाएँ'),
      }))
    )
      return;
    setBatch(null);
    setDirty(false);
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
      throw new Problem(
        t(
          'Enter a valid price greater than ₹0, or leave the price empty for review.',
          '₹0 से ज़्यादा सही भाव डालें, या जाँच के लिए भाव खाली छोड़ें।',
        ),
      );
    adopt(
      await api<RateBatch>(`${base}/batches/${batch.id}`, 'PATCH', {
        expectedVersion: batch.version,
        title,
        items,
      }),
    );
    await loadHistory();
    notice(
      t('Draft saved. Live prices are unchanged.', 'ड्राफ्ट सहेजा गया। दुकान के भाव नहीं बदले।'),
    );
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
          <h1>{t('Rate Studio', 'भाव स्टूडियो')}</h1>
          <p>
            {t(
              'From the supplier’s sheet to your store’s next price.',
              'सप्लायर की शीट से आपकी दुकान के नए भाव तक।',
            )}
          </p>
        </div>
        <ol className="rs-steps" aria-label={t('Rate workflow', 'भाव बदलने के कदम')}>
          {[
            t('Source', 'शीट'),
            t('Review', 'जाँचें'),
            t('Publish', 'लागू करें'),
            t('Share', 'भेजें'),
          ].map((step, index) => (
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
          <strong>{t('Action needs attention', 'इस पर ध्यान दें')}</strong>
          <p>{error}</p>
          {batch && (
            <button
              className="secondary"
              disabled={Boolean(busy)}
              onClick={async () => {
                if (!batch) return;
                if (
                  dirty &&
                  !(await confirmAction({
                    title: t('Reload saved draft', 'सहेजा ड्राफ्ट फिर खोलें'),
                    body: t(
                      'Discard unsaved edits and reload the saved draft?',
                      'बिना सहेजे बदलाव हटाकर सहेजा हुआ ड्राफ्ट खोलें?',
                    ),
                    confirmLabel: t('Reload saved draft', 'सहेजा ड्राफ्ट फिर खोलें'),
                  }))
                )
                  return;
                await open(batch.id);
              }}
            >
              <RefreshCw size={16} />
              {t('Reload saved draft', 'सहेजा ड्राफ्ट फिर खोलें')}
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
                <strong>{t('Scan a rate sheet', 'भाव शीट स्कैन करें')}</strong>
                <span>
                  {t('Keep the original. Review every number.', 'असली शीट रखें। हर अंक जाँचें।')}
                </span>
                <span className="rs-eyebrow">
                  {t('Screenshot · photo · printed sheet', 'स्क्रीनशॉट · फ़ोटो · छपी शीट')}
                </span>
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
                <strong>{t('Enter prices manually', 'भाव हाथ से डालें')}</strong>
                <span>
                  {t(
                    'Quick updates from a call or the counter.',
                    'फ़ोन या काउंटर से मिले भाव जल्दी डालें।',
                  )}
                </span>
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
                <strong>{t('Increase / decrease', 'भाव बढ़ाएँ / घटाएँ')}</strong>
                <span>
                  {t(
                    'Choose products. Preview ₹ or % changes.',
                    'सामग्री चुनें। ₹ या % बदलाव पहले देखें।',
                  )}
                </span>
                <ArrowRight size={20} />
              </button>
            </div>
          )}
          {providers && (!providers.visionConfigured || !providers.modelConfigured) && (
            <p className="rs-provider-note">
              <span aria-hidden="true">●</span>{' '}
              {t(
                'Automatic extraction is not configured. Manual price entry and review are available.',
                'शीट से अपने-आप भाव पढ़ना चालू नहीं है। भाव हाथ से डालकर जाँच सकते हैं।',
              )}
            </p>
          )}
          <div className="rs-history" ref={historyRef}>
            <div className="rs-section-heading">
              <div>
                <h3>
                  {historyOnly
                    ? t('Marketing rate cards & history', 'प्रचार के भाव कार्ड और पुराना रिकॉर्ड')
                    : t('Price sheet history', 'पुरानी भाव शीटें')}
                </h3>
              </div>
              <button className="secondary" onClick={() => setHistoryOnly(!historyOnly)}>
                <History size={16} />
                {historyOnly
                  ? t('All workflows', 'सभी काम')
                  : t('Marketing rate cards', 'प्रचार के भाव कार्ड')}
              </button>
            </div>
            {!history.items.length && (
              <Empty
                title={t(
                  'Your first price sheet starts here',
                  'आपकी पहली भाव शीट यहाँ से शुरू होगी',
                )}
                body={t(
                  'Create a draft, review the changes and publish when every row is ready.',
                  'ड्राफ्ट बनाएँ, बदलाव जाँचें और हर लाइन तैयार होने पर लागू करें।',
                )}
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
                      {moment(item.publishedAt || item.createdAt)} · {name(item.sourceType)}
                    </small>
                  </span>
                  <span className={`rs-status rs-status-${item.status.toLowerCase()}`}>
                    {name(item.status)}
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))}
            </div>
            {history.nextCursor && (
              <button
                className="secondary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run(t('Loading history', 'पुराना रिकॉर्ड आ रहा है'), () =>
                    loadHistory(history.nextCursor!),
                  )
                }
              >
                {t('Load more price sheets', 'और भाव शीटें दिखाएँ')}
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
              onClick={() => void safeClose()}
            >
              <ArrowLeft size={16} />
              {t('All price sheets', 'सभी भाव शीटें')}
            </button>
            <span className={`rs-status rs-status-${batch.status.toLowerCase()}`}>
              {name(batch.status)}
            </span>
            <small>
              {t(`Revision ${batch.version}`, `संशोधन ${batch.version}`)}
              {dirty
                ? t(' · Unsaved changes', ' · बिना सहेजे बदलाव')
                : t(' · Saved', ' · सहेजा गया')}
            </small>
          </div>
          <div className="rs-title-row">
            <input
              className="rs-title-input"
              aria-label={t('Price sheet title', 'भाव शीट का नाम')}
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
                {t('Create Shiv Rate Card', 'Shiv भाव कार्ड बनाएँ')}
              </button>
            )}
          </div>
          {batch.status === 'PUBLISHED' && (
            <div className="rs-published">
              <Check size={23} />
              <div>
                <strong>{t('Prices published', 'भाव लागू हो गए')}</strong>
                <p>
                  {batch.publishedAt && moment(batch.publishedAt)} ·{' '}
                  {t(
                    `Approved by ${batch.publishedByName || 'store staff'}. These reviewed values are preserved in this record.`,
                    `${batch.publishedByName || 'दुकान स्टाफ'} ने मंज़ूरी दी। जाँचे गए भाव इस रिकॉर्ड में सुरक्षित हैं।`,
                  )}
                </p>
              </div>
            </div>
          )}
          {batch.status === 'PROCESSING' && (
            <div className="rs-processing" role="status">
              <RefreshCw size={21} />
              <div>
                <strong>{t('Reading your rate sheet', 'आपकी भाव शीट पढ़ी जा रही है')}</strong>
                <p>
                  {batch.stage ? `${name(batch.stage)} · ` : ''}
                  {t(
                    'You can leave this page and return to the saved draft.',
                    'आप यह पेज छोड़कर बाद में सहेजे ड्राफ्ट पर लौट सकते हैं।',
                  )}
                </p>
              </div>
            </div>
          )}
          {batch.errorCode && (
            <div className="rs-warning" role="status">
              <strong>
                {t('Automatic extraction needs attention', 'अपने-आप भाव पढ़ने में दिक्कत आई')}
              </strong>
              <p>
                {name(batch.errorCode)}.{' '}
                {t(
                  'Your source has been retained. Add products manually or retry extraction.',
                  'आपकी शीट सहेजी हुई है। सामग्री हाथ से जोड़ें या फिर से भाव पढ़ें।',
                )}
              </p>
            </div>
          )}
          <div className="rs-workbench">
            <aside className="rs-source">
              <div className="rs-section-heading">
                <h3>{t('Source evidence', 'असली शीट')}</h3>
                <span className="rs-eyebrow">{name(batch.sourceType)}</span>
              </div>
              {batch.source ? (
                <>
                  <a
                    href={`${API_URL}${base}/batches/${batch.id}/source`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t('Open original rate sheet', 'असली भाव शीट खोलें')}
                  >
                    <img
                      className="rs-source-image"
                      src={`${API_URL}${base}/batches/${batch.id}/source`}
                      crossOrigin="use-credentials"
                      alt={t(
                        'Original rate sheet for price comparison',
                        'भाव मिलाने के लिए असली भाव शीट',
                      )}
                    />
                  </a>
                  <p className="rs-file-name">{batch.source.fileName}</p>
                  <details>
                    <summary>{t('Read OCR source text', 'शीट से पढ़ा गया लेख देखें')}</summary>
                    <pre className="rs-ocr">
                      {batch.source.ocrText ||
                        t(
                          'No extracted text yet. You can enter prices manually.',
                          'अभी कोई लेख नहीं पढ़ा गया। आप भाव हाथ से डाल सकते हैं।',
                        )}
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
                        void run(t('Extracting', 'भाव पढ़े जा रहे हैं'), async () =>
                          adopt(
                            await api<RateBatch>(`${base}/batches/${batch.id}/extract`, 'POST', {
                              expectedVersion: batch.version,
                            }),
                          ),
                        )
                      }
                    >
                      <RefreshCw size={16} />
                      {batch.errorCode
                        ? t('Retry extraction', 'फिर से भाव पढ़ें')
                        : t('Extract prices', 'शीट से भाव पढ़ें')}
                    </button>
                  )}
                  {dirty && (
                    <small>
                      {t(
                        'Save this draft before extracting.',
                        'भाव पढ़ने से पहले यह ड्राफ्ट सहेजें।',
                      )}
                    </small>
                  )}
                </>
              ) : (
                <div className="rs-source-empty">
                  <FileImage size={34} strokeWidth={1.3} />
                  <strong>
                    {batch.sourceType === 'IMAGE'
                      ? t('Add the original sheet', 'असली शीट जोड़ें')
                      : t('A counter update', 'काउंटर से भाव बदलाव')}
                  </strong>
                  <p>
                    {batch.sourceType === 'IMAGE'
                      ? t(
                          'Upload a clear screenshot or photograph. PNG, JPG or WebP, up to 5 MB.',
                          'साफ़ स्क्रीनशॉट या फ़ोटो अपलोड करें। PNG, JPG या WebP, 5 MB तक।',
                        )
                      : t(
                          'Enter the prices customers will pay. If a supplier sheet shows purchase costs, enter your agreed selling prices before review.',
                          'ग्राहक जो भाव देंगे वही डालें। अगर सप्लायर की शीट में खरीद का भाव है, तो जाँच से पहले अपना तय बिक्री भाव डालें।',
                        )}
                  </p>
                </div>
              )}
              {editable(batch) && !batch.source && (
                <label className={`rs-upload ${busy || dirty ? 'rs-disabled' : ''}`}>
                  <ImagePlus size={18} />
                  {t('Upload rate sheet', 'भाव शीट अपलोड करें')}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={Boolean(busy) || dirty}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      void run(t('Uploading source', 'शीट अपलोड हो रही है'), async () => {
                        if (
                          file.size > 5 * 1024 * 1024 ||
                          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
                        )
                          throw new Problem(
                            t(
                              'Choose a PNG, JPG or WebP image smaller than 5 MB.',
                              '5 MB से छोटी PNG, JPG या WebP फ़ोटो चुनें।',
                            ),
                          );
                        await uploadFile(`${base}/batches/${batch.id}/source`, file, batch.version);
                        adopt(await api<RateBatch>(`${base}/batches/${batch.id}`));
                      });
                    }}
                  />
                </label>
              )}
              <p className="rs-evidence-note">
                {t(
                  'Source material suggests a price. Only your reviewed, published changes reach customers.',
                  'शीट से सिर्फ़ भाव का सुझाव मिलता है। ग्राहकों तक वही भाव पहुँचते हैं जो आप जाँचकर लागू करें।',
                )}
              </p>
              {batch.extraction && (
                <details>
                  <summary>{t('Original extracted values', 'शीट से पढ़े गए असली अंक')}</summary>
                  <pre className="rs-ocr">{JSON.stringify(batch.extraction, null, 2)}</pre>
                </details>
              )}
              {batch.status === 'PUBLISHED' && batch.cards.length > 0 && (
                <button className="secondary wide" onClick={() => setCards(true)}>
                  <Share2 size={16} />
                  {t(
                    `View ${batch.cards.length} saved rate card${batch.cards.length === 1 ? '' : 's'}`,
                    `${batch.cards.length} सहेजे भाव कार्ड देखें`,
                  )}
                </button>
              )}
            </aside>
            <section
              className="rs-review"
              aria-label={t('Review price changes', 'भाव के बदलाव जाँचें')}
            >
              <div className="rs-review-heading">
                <div>
                  <h3>
                    {batch.status === 'PUBLISHED'
                      ? t('Published price record', 'लागू भाव का रिकॉर्ड')
                      : t('Review the rates', 'भाव जाँचें')}
                  </h3>
                </div>
                <span className="rs-review-count">
                  {reviewed}
                  <small>
                    {t(` / ${included.length} reviewed`, ` / ${included.length} जाँचे गए`)}
                  </small>
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
                    {t('Choose products', 'सामग्री चुनें')}
                  </button>
                  <button
                    className="text-button"
                    disabled={Boolean(busy) || rows.length >= 100}
                    onClick={() => {
                      setRows((old) => [...old, blank()]);
                      setDirty(true);
                    }}
                  >
                    {t('Add blank row', 'खाली लाइन जोड़ें')}
                  </button>
                  <button
                    className="text-button"
                    disabled={Boolean(busy) || dirty}
                    onClick={() => setPicker({ type: 'adjust' })}
                  >
                    <SlidersHorizontal size={16} />
                    {t('Adjust prices', 'भाव बढ़ाएँ-घटाएँ')}
                  </button>
                </div>
              )}
              {!rows.length && (
                <Empty
                  title={t('No rates in this draft yet', 'इस ड्राफ्ट में अभी कोई भाव नहीं')}
                  body={t(
                    'Choose existing products, add a blank row, or extract the uploaded sheet to get started.',
                    'शुरू करने के लिए सामग्री चुनें, खाली लाइन जोड़ें, या अपलोड की गई शीट से भाव पढ़ें।',
                  )}
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
                            t('Unmatched material', 'बिना मिलान की सामग्री'),
                        )}
                      </strong>
                      <small>
                        {row.publishedProduct
                          ? `${String(row.publishedProduct.brand || '')} · ${String(row.publishedProduct.unit || '')}`
                          : row.product
                            ? `${row.product.brand} · ${row.product.unit}`
                            : t(
                                'Choose the exact store product before publishing',
                                'लागू करने से पहले दुकान की सही सामग्री चुनें',
                              )}
                      </small>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={row.included}
                        disabled={locked}
                        onChange={(e) => change(index, { included: e.target.checked })}
                      />
                      {t('Include', 'शामिल करें')}
                    </label>
                  </div>
                  <div className="rs-price-comparison">
                    <div>
                      <span>{t('Previous rate', 'पुराना भाव')}</span>
                      <strong>{row.oldPricePaise === null ? '—' : money(row.oldPricePaise)}</strong>
                    </div>
                    <ArrowRight size={20} />
                    {batch.status === 'PUBLISHED' ? (
                      <div>
                        <span>{t('Published rate', 'लागू भाव')}</span>
                        <strong>
                          {row.publishedPricePaise === null
                            ? t('Excluded', 'शामिल नहीं')
                            : money(row.publishedPricePaise)}
                        </strong>
                      </div>
                    ) : (
                      <Field label={t('New rate (₹)', 'नया भाव (₹)')}>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          max="1000000"
                          inputMode="decimal"
                          aria-label={t(
                            `New price row ${index + 1}`,
                            `लाइन ${index + 1} का नया भाव`,
                          )}
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
                        : t('Match required', 'मिलान ज़रूरी')}
                    </span>
                  </div>
                  <div className="rs-match-line">
                    <span>
                      {name(row.matchMethod)}
                      {row.confidence !== null
                        ? t(
                            ` · ${Math.round(row.confidence * 100)}% extraction confidence`,
                            ` · शीट पढ़ने में ${Math.round(row.confidence * 100)}% भरोसा`,
                          )
                        : ''}
                    </span>
                    {!locked && (
                      <button
                        className="text-button"
                        onClick={() => setPicker({ type: 'match', index })}
                      >
                        {row.productId
                          ? t('Change product', 'सामग्री बदलें')
                          : t('Match product', 'सामग्री मिलाएँ')}
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
                          <strong>
                            {issue.blocking ? t('Resolve', 'ठीक करें') : t('Check', 'जाँचें')}:
                          </strong>{' '}
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {row.extracted && (
                    <blockquote className="rs-source-quote">
                      “{row.extracted.sourceText}”
                      <small>
                        {row.extracted.sourceReference || t('Source sheet', 'असली शीट')}
                      </small>
                    </blockquote>
                  )}
                  <details className="rs-row-details">
                    <summary>
                      {t('Source details & review notes', 'शीट की जानकारी और जाँच नोट')}
                    </summary>
                    <div className="rs-detail-grid">
                      {(['label', 'brand', 'specification', 'unit', 'weight'] as const).map(
                        (field) => (
                          <Field
                            key={field}
                            label={
                              field === 'label'
                                ? t('Source product name', 'शीट में सामग्री का नाम')
                                : name(field)
                            }
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
                    <Field label={t('Review notes', 'जाँच नोट')}>
                      <textarea
                        maxLength={500}
                        value={row.note}
                        disabled={locked}
                        placeholder={t(
                          'Supplier confirmed by phone; checked unit and pack size…',
                          'सप्लायर से फ़ोन पर पक्का किया; इकाई और पैक साइज़ जाँचा…',
                        )}
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
                        {t(
                          'Remember this confirmed product name for future sheets',
                          'आगे की शीटों के लिए यह पक्का किया नाम याद रखें',
                        )}
                      </label>
                    )}
                    {row.product && !locked && (
                      <button
                        className="text-button"
                        onClick={() => change(index, { refreshBaseline: true })}
                      >
                        {t(
                          'Use current product version as baseline',
                          'सामग्री का अभी का भाव आधार मानें',
                        )}
                        {row.refreshBaseline
                          ? t(
                              ' · selected; save to refresh',
                              ' · चुना गया; ताज़ा करने के लिए सहेजें',
                            )
                          : ''}
                      </button>
                    )}
                    {row.publishedProduct && (
                      <p className="hint">
                        {t(
                          `Published product: ${String(row.publishedProduct.name || '')} · ${String(row.publishedProduct.unit || '')}`,
                          `लागू सामग्री: ${String(row.publishedProduct.name || '')} · ${String(row.publishedProduct.unit || '')}`,
                        )}
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
                      {t(
                        'I checked the product, unit and customer selling price',
                        'मैंने सामग्री, इकाई और ग्राहक का बिक्री भाव जाँच लिया',
                      )}
                    </label>
                    {row.issues.some((issue) => !issue.blocking) && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={row.acknowledged}
                          disabled={locked || !row.included}
                          onChange={(e) => change(index, { acknowledged: e.target.checked }, true)}
                        />
                        {t('I verified the warnings above', 'मैंने ऊपर की चेतावनियाँ जाँच लीं')}
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
                    <strong>
                      {t(`${included.length} included rates`, `${included.length} भाव शामिल`)}
                    </strong>
                    <small>
                      {dirty
                        ? t(
                            'Save to validate your latest changes.',
                            'नए बदलाव जाँचने के लिए सहेजें।',
                          )
                        : canPublish
                          ? t(
                              'Reviewed and ready for confirmation.',
                              'जाँच पूरी, पक्का करने के लिए तैयार।',
                            )
                          : t(
                              'Resolve issues and review each included row.',
                              'दिक्कतें ठीक करें और शामिल हर लाइन जाँचें।',
                            )}
                    </small>
                  </div>
                  <button
                    className="secondary"
                    disabled={Boolean(busy) || !dirty}
                    onClick={() => void run(t('Saving draft', 'ड्राफ्ट सहेजा जा रहा है'), save)}
                  >
                    {t('Save draft', 'ड्राफ्ट सहेजें')}
                  </button>
                  <button
                    className="primary"
                    disabled={Boolean(busy) || !canPublish}
                    onClick={() => setConfirm('publish')}
                  >
                    {t('Publish prices', 'भाव लागू करें')}
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
                  {t('Cancel this price sheet', 'यह भाव शीट रद्द करें')}
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
              ? t('Scan a rate sheet', 'भाव शीट स्कैन करें')
              : create === 'ADJUSTMENT'
                ? t('Adjust existing prices', 'मौजूदा भाव बढ़ाएँ-घटाएँ')
                : t('Enter prices manually', 'भाव हाथ से डालें')
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
              void run(t('Creating draft', 'ड्राफ्ट बन रहा है'), async () => {
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
              {t(
                'A saved draft keeps your work together. Live product prices change only after review and publication.',
                'सहेजा ड्राफ्ट आपका काम एक जगह रखता है। दुकान के भाव जाँच और लागू करने के बाद ही बदलते हैं।',
              )}
            </p>
            <Field label={t('Price sheet title', 'भाव शीट का नाम')}>
              <input
                name="title"
                required
                maxLength={120}
                autoFocus
                defaultValue={t(
                  `Store rates · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
                  `दुकान के भाव · ${new Date().toLocaleDateString('hi-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
                )}
              />
            </Field>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={Boolean(busy)}>
              {t('Create draft', 'ड्राफ्ट बनाएँ')}
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
              notice(
                t(
                  'Adjustment preview created. Check each new price before publishing.',
                  'बदले भाव की झलक बन गई। लागू करने से पहले हर नया भाव जाँचें।',
                ),
              );
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
                throw new Problem(
                  t(
                    'A price sheet can contain up to 100 rows.',
                    'एक भाव शीट में ज़्यादा से ज़्यादा 100 लाइनें हो सकती हैं।',
                  ),
                );
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
            notice(
              t(
                'Product created. Search for it to add it to this sheet.',
                'सामग्री बन गई। इस शीट में जोड़ने के लिए उसे खोजें।',
              ),
            );
          }}
        />
      )}
      {confirm && (
        <Modal
          title={
            confirm === 'publish'
              ? t('Publish these prices?', 'ये भाव लागू करें?')
              : t('Cancel this price sheet?', 'यह भाव शीट रद्द करें?')
          }
          close={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <div className="form-stack">
            <p>
              {confirm === 'publish'
                ? t(
                    `${included.length} customer selling prices will be checked against current product versions and published together. These must be the prices customers will pay, not supplier purchase costs. Customers must review changed checkout totals.`,
                    `ग्राहकों के ${included.length} बिक्री भाव अभी की सामग्री से मिलाकर एक साथ लागू होंगे। ये वही भाव होने चाहिए जो ग्राहक देंगे, सप्लायर का खरीद भाव नहीं। ग्राहकों को बदला हुआ कुल बिल फिर से देखना होगा।`,
                  )
                : t(
                    'This sheet will be closed. Published catalogue prices will not change.',
                    'यह शीट बंद हो जाएगी। दुकान के लागू भाव नहीं बदलेंगे।',
                  )}
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
                  confirm === 'publish'
                    ? t('Publishing prices', 'भाव लागू हो रहे हैं')
                    : t('Closing draft', 'ड्राफ्ट बंद हो रहा है'),
                  async () => {
                    if (batch) {
                      adopt(
                        await api<RateBatch>(`${base}/batches/${batch.id}/${confirm}`, 'POST', {
                          expectedVersion: batch.version,
                          ...(confirm === 'publish' ? { confirmation: 'PUBLISH' } : {}),
                        }),
                      );
                      await loadHistory();
                      if (confirm === 'publish') {
                        await refresh();
                        notice(
                          t(
                            'Prices published. Your customers now have the latest rates.',
                            'भाव लागू हो गए। अब ग्राहकों को नए भाव दिखेंगे।',
                          ),
                        );
                      }
                    }
                    setConfirm(null);
                  },
                )
              }
            >
              {confirm === 'publish'
                ? t('Confirm & publish prices', 'पक्का करें और भाव लागू करें')
                : t('Confirm cancellation', 'रद्द करना पक्का करें')}
            </button>
            <button className="secondary" disabled={Boolean(busy)} onClick={() => setConfirm(null)}>
              {t('Keep reviewing', 'जाँच जारी रखें')}
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
  const { t, error: say } = useWords();
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
        if (id === generation.current) setError(say(e));
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
          ? t('Match the exact store product', 'दुकान की सही सामग्री मिलाएँ')
          : mode === 'adjust'
            ? t('Preview a price adjustment', 'भाव बदलाव की झलक देखें')
            : t('Choose products', 'सामग्री चुनें')
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
              aria-label={t('Search rate products', 'भाव के लिए सामग्री खोजें')}
              placeholder={t('Name, grade or specification', 'नाम, ग्रेड या विवरण')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label={t('Rate product category', 'सामग्री की श्रेणी')}
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
          <input
            aria-label={t('Rate product brand', 'सामग्री का ब्रांड')}
            placeholder={t('Filter by brand', 'ब्रांड से छाँटें')}
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
                  {!product.active ? t(' · Inactive', ' · बंद') : ''}
                </small>
              </span>
              <strong>{money(product.pricePaise)}</strong>
            </label>
          ))}
        </div>
        {loading && <p role="status">{t('Finding products…', 'सामग्री खोजी जा रही है…')}</p>}
        {!loading && !page.items.length && (
          <p>
            {t(
              'No products found. Try another search or add the missing product.',
              'कोई सामग्री नहीं मिली। दूसरा नाम खोजें या छूटी सामग्री जोड़ें।',
            )}
          </p>
        )}
        {page.nextCursor && (
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void load(page.nextCursor!)}
          >
            {t('Load more products', 'और सामग्री दिखाएँ')}
          </button>
        )}
        <button className="text-button" onClick={addProduct}>
          <Plus size={16} />
          {t('Add missing product', 'छूटी सामग्री जोड़ें')}
        </button>
        {mode === 'adjust' && (
          <div className="rs-adjust-controls">
            <Field label={t('Direction', 'बढ़ाएँ या घटाएँ')}>
              <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="INCREASE">{t('Increase', 'बढ़ाएँ')}</option>
                <option value="DECREASE">{t('Decrease', 'घटाएँ')}</option>
              </select>
            </Field>
            <Field label={t('Adjustment type', 'बदलाव का तरीका')}>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="FIXED">{t('Fixed amount (₹)', 'तय रकम (₹)')}</option>
                <option value="PERCENT">{t('Percentage (%)', 'प्रतिशत (%)')}</option>
              </select>
            </Field>
            <Field
              label={
                kind === 'FIXED' ? t('Amount (₹)', 'रकम (₹)') : t('Percentage (%)', 'प्रतिशत (%)')
              }
            >
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
            {t(
              'Creates a new preview for the selected products, replacing draft rows. Live prices stay unchanged.',
              'चुनी सामग्री के लिए नई झलक बनेगी, ड्राफ्ट की लाइनें बदल जाएँगी। दुकान के भाव नहीं बदलेंगे।',
            )}
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
                throw new Problem(
                  t('Enter a positive adjustment amount.', 'बदलाव की रकम 0 से ज़्यादा डालें।'),
                );
              await confirm(
                Object.values(selected),
                mode === 'adjust' ? { kind, direction, amount: numeric } : undefined,
              );
            } catch (e) {
              setError(e instanceof Problem ? e.message : say(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? t('Preparing…', 'तैयार हो रहा है…')
            : mode === 'adjust'
              ? t(
                  `Preview ${Object.keys(selected).length} price changes`,
                  `${Object.keys(selected).length} भाव बदलाव की झलक देखें`,
                )
              : mode === 'match'
                ? t('Confirm product match', 'सामग्री का मिलान पक्का करें')
                : t(
                    `Add ${Object.keys(selected).length} products`,
                    `${Object.keys(selected).length} सामग्री जोड़ें`,
                  )}
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
  const { t, error: say, moment } = useWords();
  const name = named(t);
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
      setError(say(e));
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
      if (!result.ok)
        throw new Problem(
          t(
            'Could not download this rate card. Please try again.',
            'यह भाव कार्ड डाउनलोड नहीं हो सका। फिर कोशिश करें।',
          ),
        );
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
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError(e instanceof Problem ? e.message : say(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('Shiv Rate Card Studio', 'Shiv भाव कार्ड स्टूडियो')}
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="rate-studio rs-card-studio">
        <p>
          {t(
            'Artwork uses the approved product names, prices and units. Only the message and layout are editable.',
            'कार्ड में मंज़ूर सामग्री के नाम, भाव और इकाई ही आते हैं। सिर्फ़ संदेश और डिज़ाइन बदल सकते हैं।',
          )}
        </p>
        {batch.cards.length > 0 && (
          <Field label={t('Saved rate cards', 'सहेजे भाव कार्ड')}>
            <select
              value={card?.id || ''}
              disabled={busy}
              onChange={(e) => {
                if (e.target.value) void open(e.target.value);
              }}
            >
              <option value="">
                {t('Choose a previously generated card', 'पहले बना कार्ड चुनें')}
              </option>
              {batch.cards.map((item) => (
                <option key={item.id} value={item.id}>
                  {name(item.format)} · {moment(item.createdAt)}
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
                setError(say(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="rs-detail-grid">
              <Field label={t('Format', 'साइज़')}>
                <select value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="STATUS">
                    {t('WhatsApp Status · 1080 × 1920', 'WhatsApp स्टेटस · 1080 × 1920')}
                  </option>
                  <option value="SQUARE">
                    {t('Square Social · 1080 × 1080', 'चौकोर पोस्ट · 1080 × 1080')}
                  </option>
                  <option value="SHEET">
                    {t('Shareable Rate Sheet · portrait', 'भेजने लायक भाव शीट · खड़ी')}
                  </option>
                </select>
              </Field>
              <Field label={t('Template', 'डिज़ाइन')}>
                <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                  <option value="COUNTER">
                    {t('Counter · ink & sindoor', 'काउंटर · स्याही और सिंदूर')}
                  </option>
                  <option value="BULLETIN">
                    {t('Bulletin · paper & ink', 'बुलेटिन · काग़ज़ और स्याही')}
                  </option>
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
            <Field label={t('Heading', 'शीर्षक')}>
              <input name="heading" required maxLength={80} defaultValue="Today’s material rates" />
            </Field>
            <Field label={t('Delivery message', 'डिलीवरी संदेश')}>
              <input
                name="deliveryMessage"
                maxLength={160}
                defaultValue="Contact the store to confirm delivery to your site."
              />
            </Field>
            <Field label={t('Contact label', 'संपर्क का लेबल')}>
              <input name="contactLabel" maxLength={40} defaultValue="Call / WhatsApp" />
            </Field>
            <Field label={t('Optional promotional copy', 'प्रचार संदेश (वैकल्पिक)')}>
              <textarea
                name="promotionalCopy"
                maxLength={160}
                placeholder={t(
                  'Add a short message. Check any stock or delivery claims.',
                  'छोटा संदेश लिखें। स्टॉक या डिलीवरी की बात जाँच लें।',
                )}
              />
            </Field>
            <label className="check">
              <input type="checkbox" required />
              {t(
                'I checked the message and delivery claims',
                'मैंने संदेश और डिलीवरी की बातें जाँच लीं',
              )}
            </label>
            <button className="primary wide" disabled={busy}>
              {busy
                ? t('Generating artwork…', 'कार्ड बन रहा है…')
                : t('Generate rate card', 'भाव कार्ड बनाएँ')}
            </button>
          </form>
        ) : (
          <div className="rs-card-result">
            <img
              className="rs-card-preview"
              src={`${API_URL}${base}/cards/${card.id}/pages/${page}/png`}
              crossOrigin="use-credentials"
              alt={t(
                `${card.snapshot.heading}, rate card page ${page} of ${card.pages}`,
                `${card.snapshot.heading}, भाव कार्ड पेज ${page} / ${card.pages}`,
              )}
              onError={() =>
                setError(
                  t(
                    'Preview could not be rendered. Try downloading again or use the SVG version below.',
                    'झलक नहीं दिख सकी। फिर से डाउनलोड करें या नीचे का SVG खोलें।',
                  ),
                )
              }
            />
            <a
              className="text-button"
              href={`${API_URL}${base}/cards/${card.id}/pages/${page}/svg`}
              target="_blank"
              rel="noreferrer"
            >
              {t('Open printable SVG', 'छापने वाला SVG खोलें')}
            </a>
            <div className="rs-card-pagination">
              <button
                className="secondary"
                disabled={page <= 1 || busy}
                onClick={() => setPage((old) => old - 1)}
              >
                {t('Previous', 'पिछला')}
              </button>
              <span>{t(`Page ${page} of ${card.pages}`, `पेज ${page} / ${card.pages}`)}</span>
              <button
                className="secondary"
                disabled={page >= card.pages || busy}
                onClick={() => setPage((old) => old + 1)}
              >
                {t('Next', 'अगला')}
              </button>
            </div>
            <div className="rs-card-actions">
              <button className="primary" disabled={busy} onClick={() => void download(false)}>
                {t('Download PNG', 'PNG डाउनलोड करें')}
              </button>
              <button className="secondary" disabled={busy} onClick={() => void download(true)}>
                <Share2 size={16} />
                {t('Share / download', 'भेजें / डाउनलोड करें')}
              </button>
            </div>
            <p className="hint">
              {t(
                'Download each page for a multi-page sheet. Sharing opens your device’s share sheet when supported.',
                'कई पेज वाली शीट का हर पेज अलग डाउनलोड करें। फ़ोन में सुविधा हो तो भेजें दबाने पर भेजने का मेन्यू खुलेगा।',
              )}
            </p>
            <button className="text-button" disabled={busy} onClick={() => setCard(null)}>
              {t('Create another layout', 'दूसरा डिज़ाइन बनाएँ')}
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error} {t('Published prices are unchanged.', 'लागू भाव नहीं बदले।')}
          </p>
        )}
      </div>
    </Modal>
  );
}
