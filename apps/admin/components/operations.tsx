'use client';
import { useCallback, useEffect, useState } from 'react';
import { DeliveryZone, InventoryMovement, Page, Product, SessionInfo, money } from '@shiv/shared';
import { api } from '../lib/api';
import { useWords } from '../lib/i18n';
import { Field, Modal } from './ui';

type T = (en: string, hi: string) => string;
const movementKinds = (t: T): Record<string, string> => ({
  PURCHASE_IN: t('Stock received', 'माल आया'),
  WALK_IN_SALE: t('Counter sale', 'काउंटर बिक्री'),
  RETURN: t('Return to stock', 'वापस स्टॉक में'),
  DAMAGE: t('Damaged', 'खराब माल'),
  MANUAL_ADJUSTMENT: t('Correction', 'सुधार'),
  ORDER_RESERVED: t('Reserved for order', 'ऑर्डर के लिए रखा'),
  ORDER_CANCELLED: t('Order cancelled', 'ऑर्डर रद्द, वापस'),
  ORDER_EXPIRED: t('Reservation expired', 'रोक समाप्त'),
  DELIVERY_RETURN: t('Returned from delivery', 'डिलीवरी से वापस'),
  OPENING_STOCK: t('Opening stock', 'शुरुआती स्टॉक'),
});

/** Who bought, what price was agreed and how it was paid: the counter-sale fields. */
function CounterFields({ product }: { product: Product }) {
  const { t } = useWords();
  return (
    <div className="form-grid">
      <Field label={t('Price per unit (₹)', 'इकाई का भाव (₹)')}>
        <input
          name="price"
          type="number"
          min="0.01"
          step="0.01"
          required
          defaultValue={product.pricePaise / 100}
        />
      </Field>
      <Field label={t('Paid by', 'भुगतान')}>
        <select name="channel" defaultValue="CASH">
          <option value="CASH">{t('Cash', 'नकद')}</option>
          <option value="UPI">UPI</option>
        </select>
      </Field>
      <Field label={t('Buyer name / phone (optional)', 'खरीदार का नाम / फ़ोन (वैकल्पिक)')}>
        <input name="counterParty" maxLength={120} />
      </Field>
    </div>
  );
}
const counterBody = (f: FormData) => ({
  unitPricePaise: Math.round(Number(f.get('price')) * 100),
  channel: f.get('channel'),
  counterParty: String(f.get('counterParty') || ''),
});

export function Inventory({
  product,
  close,
  refresh,
}: {
  product: Product;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const { t, error: say, moment } = useWords();
  const kinds = movementKinds(t);
  const [rows, setRows] = useState<InventoryMovement[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [kind, setKind] = useState('PURCHASE_IN');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const load = useCallback(
    async (after?: string) => {
      const page = await api<Page<InventoryMovement>>(
        `/admin/products/${product.id}/movements?limit=20${after ? '&cursor=' + encodeURIComponent(after) : ''}`,
      );
      setRows((old) => (after ? [...old, ...page.items] : page.items));
      setCursor(page.nextCursor);
    },
    [product.id],
  );
  useEffect(() => {
    const refreshVisible = () => {
      void load()
        .then(() => setError(''))
        .catch((e) => setError(say(e)));
    };
    refreshVisible();
    window.addEventListener('shiv-owner-refresh', refreshVisible);
    return () => window.removeEventListener('shiv-owner-refresh', refreshVisible);
  }, [load]);
  return (
    <Modal title={`${t('Stock ledger', 'स्टॉक खाता')} · ${product.name}`} close={close}>
      <p>
        {t(
          `Quantities are in ${product.unit}. Corrections are new entries; past entries stay.`,
          `मात्रा ${product.unit} में। सुधार नई एंट्री से होता है; पुरानी एंट्री नहीं बदलती।`,
        )}
      </p>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const form = e.currentTarget,
            f = new FormData(form);
          try {
            await api(`/admin/products/${product.id}/movements`, 'POST', {
              kind: f.get('kind'),
              quantity: Number(f.get('quantity')),
              reference: f.get('reference'),
              note: f.get('note'),
              idempotencyKey: key,
              ...(f.get('kind') === 'WALK_IN_SALE' ? counterBody(f) : {}),
            });
            setKey(crypto.randomUUID());
            form.reset();
            setKind('PURCHASE_IN');
            await Promise.all([load(), refresh()]).catch(() =>
              setError(
                t(
                  'Recorded. The latest balance could not be refreshed; do not repeat the entry. Use Refresh.',
                  'दर्ज हो गया। नया बैलेंस अभी नहीं दिखा; एंट्री दोबारा न करें। रीफ़्रेश दबाएँ।',
                ),
              ),
            );
          } catch (err) {
            setError(say(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field label={t('Movement', 'एंट्री का प्रकार')}>
            <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {['PURCHASE_IN', 'WALK_IN_SALE', 'RETURN', 'DAMAGE', 'MANUAL_ADJUSTMENT'].map((k) => (
                <option key={k} value={k}>
                  {kinds[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Quantity', 'मात्रा')}>
            <input name="quantity" type="number" step="1" required min="-1000000" max="1000000" />
          </Field>
          <Field label={t('Receipt / reference', 'रसीद / संदर्भ')}>
            <input name="reference" maxLength={100} />
          </Field>
          <Field label={t('Reason', 'कारण')}>
            <input name="note" required maxLength={500} />
          </Field>
        </div>
        {kind === 'WALK_IN_SALE' && <CounterFields product={product} />}
        <p className="muted">
          {t(
            'Use a positive quantity for stock received, sales, returns and damage. Only corrections take a negative number.',
            'माल आने, बिक्री, वापसी और खराबी के लिए धनात्मक संख्या लिखें। केवल सुधार में ऋण संख्या चलेगी।',
          )}
        </p>
        <button className="primary" disabled={busy}>
          {t('Record stock movement', 'एंट्री दर्ज करें')}
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('When / movement', 'कब / प्रकार')}</th>
              <th>{t('Change', 'बदलाव')}</th>
              <th>{t('Balance', 'बचा स्टॉक')}</th>
              <th>{t('Reference / reason', 'संदर्भ / कारण')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {moment(r.createdAt)}
                  <small>{kinds[r.kind] || r.kind}</small>
                </td>
                <td>
                  {r.quantity > 0 ? '+' : ''}
                  {r.quantity}
                </td>
                <td>{r.balanceAfter}</td>
                <td>
                  {r.reference}
                  <small>{r.note}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p>{t('No movements recorded yet.', 'अभी कोई एंट्री नहीं।')}</p>}
      {cursor && (
        <button
          className="secondary"
          onClick={() => void load(cursor).catch((e) => setError(say(e)))}
        >
          {t('Older movements', 'पुरानी एंट्री')}
        </button>
      )}
    </Modal>
  );
}

/** Quick counter sale from the Today screen: product, quantity, agreed price, cash or UPI. */
export function CounterSale({
  close,
  done,
}: {
  close: () => void;
  done: (text: string) => Promise<void>;
}) {
  const { t, error: say } = useWords();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  useEffect(() => {
    // Its own list: the Products tab may be filtered or only partly loaded.
    void api<Page<Product>>('/admin/products?limit=100')
      .then((page) => {
        const sellable = page.items.filter((p) => p.active && p.stock > 0);
        setProducts(sellable);
        setProductId(sellable[0]?.id || '');
      })
      .catch((e) => setError(say(e)));
  }, []);
  const product = products?.find((p) => p.id === productId);
  return (
    <Modal title={t('Counter sale', 'काउंटर बिक्री')} close={close}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!product) return;
          const f = new FormData(e.currentTarget);
          const quantity = Number(f.get('quantity'));
          const total = Math.round(Number(f.get('price')) * 100) * quantity;
          if (
            !window.confirm(
              t(
                `Record a counter sale of ${quantity} ${product.unit} ${product.name} for ${money(total)}?`,
                `${product.name} की ${quantity} ${product.unit} की ${money(total)} की काउंटर बिक्री दर्ज करें?`,
              ),
            )
          )
            return;
          setBusy(true);
          setError('');
          try {
            await api(`/admin/products/${product.id}/movements`, 'POST', {
              kind: 'WALK_IN_SALE',
              quantity,
              reference: '',
              note: String(f.get('note') || t('Counter sale', 'काउंटर बिक्री')),
              idempotencyKey: key,
              ...counterBody(f),
            });
            await done(
              t(`Counter sale recorded · ${money(total)}`, `काउंटर बिक्री दर्ज · ${money(total)}`),
            );
          } catch (err) {
            setError(say(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {products && !products.length && (
          <p>{t('No material in stock to sell.', 'बेचने के लिए कोई सामग्री स्टॉक में नहीं।')}</p>
        )}
        <Field label={t('Material', 'सामग्री')}>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
            {products?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {money(p.pricePaise)} / {p.unit} · {t('stock', 'स्टॉक')} {p.stock}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Quantity', 'मात्रा')}>
          <input name="quantity" type="number" min="1" step="1" required max={product?.stock} />
        </Field>
        {product && <CounterFields key={product.id} product={product} />}
        <Field label={t('Note (optional)', 'टिप्पणी (वैकल्पिक)')}>
          <input name="note" maxLength={500} />
        </Field>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary wide" disabled={busy || !product}>
          {t('Record sale', 'बिक्री दर्ज करें')}
        </button>
      </form>
    </Modal>
  );
}

export function DeliveryZones() {
  const { t, error: say } = useWords();
  const [zones, setZones] = useState<DeliveryZone[]>([]),
    [editing, setEditing] = useState<DeliveryZone | 'new' | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async () => setZones(await api<DeliveryZone[]>('/admin/delivery-zones')),
    [],
  );
  useEffect(() => {
    const refreshVisible = () => {
      void load()
        .then(() => setError(''))
        .catch((e) => setError(say(e)));
    };
    refreshVisible();
    window.addEventListener('shiv-owner-refresh', refreshVisible);
    return () => window.removeEventListener('shiv-owner-refresh', refreshVisible);
  }, [load]);
  const zone = editing === 'new' ? null : editing;
  return (
    <section className="panel operations-panel" id="delivery-zones" tabIndex={-1}>
      <div className="section-title">
        <div>
          <h2>{t('Delivery areas', 'डिलीवरी क्षेत्र')}</h2>
          <p>
            {t(
              'Only active, listed pincodes can order. Each pincode belongs to one area.',
              'सिर्फ़ चालू और सूची के पिनकोड से ऑर्डर हो सकता है। हर पिनकोड एक क्षेत्र में होता है।',
            )}
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setError('');
            setEditing('new');
          }}
        >
          {t('Add delivery zone', 'क्षेत्र जोड़ें')}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="zone-grid">
        {zones.map((z) => (
          <button
            key={z.id}
            className="zone-card"
            onClick={() => {
              setError('');
              setEditing(z);
            }}
          >
            <strong>{z.name}</strong>
            <span>
              {z.active ? t('Active', 'चालू') : t('Inactive', 'बंद')} ·{' '}
              {t(`${money(z.deliveryFeePaise)} delivery`, `भाड़ा ${money(z.deliveryFeePaise)}`)}
            </span>
            <span>{z.pincodes.map((p) => p.pincode).join(', ')}</span>
            <small>{z.estimate}</small>
            {z.terms && <small>{z.terms}</small>}
          </button>
        ))}
      </div>
      {!zones.length && (
        <p>
          {t(
            'No delivery areas yet. Add the pincodes you serve before taking orders.',
            'अभी कोई क्षेत्र नहीं। ऑर्डर लेने से पहले अपने पिनकोड जोड़ें।',
          )}
        </p>
      )}
      {editing && (
        <Modal
          title={
            zone
              ? t('Edit delivery zone', 'क्षेत्र बदलें')
              : t('Add delivery zone', 'क्षेत्र जोड़ें')
          }
          close={() => setEditing(null)}
        >
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await api(
                  zone ? `/admin/delivery-zones/${zone.id}` : '/admin/delivery-zones',
                  zone ? 'PATCH' : 'POST',
                  {
                    name: f.get('name'),
                    active: f.get('active') === 'on',
                    pincodes: String(f.get('pincodes'))
                      .split(/[\s,]+/)
                      .filter(Boolean),
                    deliveryFeePaise: Math.round(Number(f.get('fee')) * 100),
                    minimumOrderPaise: Math.round(Number(f.get('minimum')) * 100),
                    freeDeliveryAbovePaise:
                      f.get('free') === '' ? null : Math.round(Number(f.get('free')) * 100),
                    estimate: f.get('estimate'),
                    terms: String(f.get('terms') || ''),
                    ...(zone ? { expectedVersion: zone.version } : {}),
                  },
                );
                await load();
                setEditing(null);
                setError('');
              } catch (err) {
                setError(say(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label={t('Zone name', 'क्षेत्र का नाम')}>
              <input name="name" defaultValue={zone?.name} required maxLength={100} />
            </Field>
            <Field label={t('Pincodes, separated by commas', 'पिनकोड, कॉमा लगाकर')}>
              <textarea
                name="pincodes"
                defaultValue={zone?.pincodes.map((p) => p.pincode).join(', ')}
                required
              />
            </Field>
            <div className="form-grid">
              <Field label={t('Delivery charge (₹)', 'भाड़ा (₹)')}>
                <input
                  name="fee"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={(zone?.deliveryFeePaise || 0) / 100}
                  required
                />
              </Field>
              <Field label={t('Minimum order (₹)', 'कम से कम ऑर्डर (₹)')}>
                <input
                  name="minimum"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={(zone?.minimumOrderPaise || 0) / 100}
                  required
                />
              </Field>
              <Field
                label={t(
                  'Free delivery above (₹), optional',
                  'इससे ऊपर भाड़ा मुफ़्त (₹), वैकल्पिक',
                )}
              >
                <input
                  name="free"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    zone?.freeDeliveryAbovePaise == null ? '' : zone.freeDeliveryAbovePaise / 100
                  }
                />
              </Field>
            </div>
            <Field label={t('Delivery estimate', 'डिलीवरी का समय')}>
              <input
                name="estimate"
                defaultValue={zone?.estimate}
                required
                maxLength={200}
                placeholder={t(
                  'Usually 1–2 days; confirmed by phone',
                  'आमतौर पर 1–2 दिन; फ़ोन पर पक्का',
                )}
              />
            </Field>
            <Field
              label={t('Delivery terms shown to customers', 'ग्राहक को दिखने वाली डिलीवरी शर्तें')}
            >
              <textarea
                name="terms"
                defaultValue={zone?.terms || ''}
                maxLength={500}
                placeholder={t(
                  'Unloading at ground level; tractor for narrow lanes; extra charge for upper floors.',
                  'उतराई ज़मीन पर; पतली गली में ट्रैक्टर; ऊपर की मंज़िल का अलग शुल्क।',
                )}
              />
            </Field>
            <label className="checkbox">
              <input type="checkbox" name="active" defaultChecked={zone?.active ?? true} />{' '}
              {t('Active and serviceable', 'चालू, यहाँ डिलीवरी होती है')}
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {t('Save delivery zone', 'क्षेत्र सहेजें')}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function StaffSessions() {
  const { t, error: say, moment } = useWords();
  const [sessions, setSessions] = useState<SessionInfo[]>([]),
    [error, setError] = useState('');
  const load = useCallback(async () => setSessions(await api<SessionInfo[]>('/auth/sessions')), []);
  useEffect(() => {
    const refreshVisible = () => {
      void load()
        .then(() => setError(''))
        .catch((e) => setError(say(e)));
    };
    refreshVisible();
    window.addEventListener('shiv-owner-refresh', refreshVisible);
    return () => window.removeEventListener('shiv-owner-refresh', refreshVisible);
  }, [load]);
  return (
    <section className="panel operations-panel">
      <h2>{t('Your signed-in devices', 'आपके साइन-इन फ़ोन और कंप्यूटर')}</h2>
      <p>
        {t(
          'Staff access expires after eight hours. Sign out devices you no longer use.',
          'स्टाफ़ का साइन-इन आठ घंटे चलता है। जो डिवाइस अब काम में नहीं, उनसे साइन आउट करें।',
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {sessions.map((s) => (
        <div className="session-row" key={s.id}>
          <div>
            <strong>{s.current ? t('This device', 'यह डिवाइस') : s.label}</strong>
            <small>
              {t('Last used', 'आख़िरी बार')} {moment(s.lastSeenAt)}
            </small>
          </div>
          {!s.current && (
            <button
              className="secondary"
              onClick={() =>
                void api(`/auth/sessions/${s.id}`, 'DELETE')
                  .then(load)
                  .catch((e) => setError(say(e)))
              }
            >
              {t('Sign out device', 'साइन आउट करें')}
            </button>
          )}
        </div>
      ))}
      <button
        className="secondary"
        onClick={() =>
          void api('/auth/sessions/revoke-others', 'POST', {})
            .then(load)
            .catch((e) => setError(say(e)))
        }
      >
        {t('Sign out other devices', 'बाकी सभी डिवाइस से साइन आउट')}
      </button>
    </section>
  );
}

type Audit = {
  id: string;
  event: string;
  actorId: string;
  actorName?: string;
  entityId: string;
  entityLabel?: string;
  createdAt: string;
  details: Record<string, unknown> | null;
};
const eventText = (t: T): Record<string, string> => ({
  ORDER_CREATED: t('Order placed', 'ऑर्डर आया'),
  ORDER_PREPARING: t('Order being prepared', 'ऑर्डर तैयार हो रहा है'),
  ORDER_OUT_FOR_DELIVERY: t('Order dispatched', 'ऑर्डर रवाना'),
  ORDER_DELIVERED: t('Order delivered', 'ऑर्डर पहुँचा'),
  ORDER_CANCELLED: t('Order cancelled', 'ऑर्डर रद्द'),
  ORDER_REFUND_PENDING: t('Cancelled, refund due', 'रद्द, पैसा लौटाना है'),
  COD_RECEIVED: t('Cash/UPI received', 'पैसा मिला'),
  CASH_REFUNDED: t('Cash refunded', 'नकद लौटाया'),
  PAYMENT_INITIATED: t('Online payment started', 'ऑनलाइन भुगतान शुरू'),
  PAYMENT_RECONCILED: t('Online payment checked', 'ऑनलाइन भुगतान जाँचा'),
  PAYMENT_REFUNDED: t('Online refund done', 'ऑनलाइन पैसा लौटा'),
  DELIVERY_REPORT: t('Delivery problem recorded', 'डिलीवरी समस्या दर्ज'),
  DELIVERY_RETRY: t('Delivery retry scheduled', 'दोबारा डिलीवरी तय'),
  DELIVERY_RETURN: t('Materials returned to shop', 'माल दुकान में वापस'),
  QUOTE_SENT: t('Quote sent', 'भाव भेजा'),
  QUOTE_ACCEPTED: t('Quote accepted', 'भाव मंज़ूर'),
  QUOTE_REJECTED: t('Quote rejected', 'भाव अस्वीकार'),
  QUOTE_CONVERTED: t('Quote turned into order', 'भाव से ऑर्डर बना'),
  WORK_ASSIGNED: t('Work assigned', 'ज़िम्मेदारी दी'),
  PRODUCT_CREATED: t('Product added', 'सामग्री जोड़ी'),
  PRODUCT_UPDATED: t('Product changed', 'सामग्री बदली'),
  PRODUCT_PHOTO_VALIDATED: t('Product photo checked', 'फ़ोटो जाँची'),
  STORE_SETTINGS_UPDATED: t('Store settings changed', 'दुकान की सेटिंग बदली'),
  DELIVERY_ZONE_UPDATED: t('Delivery area changed', 'डिलीवरी क्षेत्र बदला'),
  CONTRACTOR_REVIEWED: t('Contractor verification decided', 'ठेकेदार सत्यापन तय'),
  DEMAND_OVERRIDE_GRANTED: t('Order limit raised once', 'एक बार के लिए सीमा बढ़ाई'),
  DEMAND_OVERRIDE_USED: t('Raised order limit used', 'बढ़ी सीमा इस्तेमाल हुई'),
  STAFF_UPDATED: t('Staff details changed', 'स्टाफ़ की जानकारी बदली'),
  ACCOUNT_DELETED: t('Customer deleted their account', 'ग्राहक ने खाता हटाया'),
  RATE_BATCH_CREATED: t('Rate sheet started', 'भाव सूची शुरू'),
  RATE_BATCH_REVIEWED: t('Rate sheet reviewed', 'भाव सूची जाँची'),
  RATE_BATCH_PUBLISHED: t('New rates published', 'नए भाव लागू'),
  RATE_BATCH_CANCELLED: t('Rate sheet cancelled', 'भाव सूची रद्द'),
  RATE_CARD_CREATED: t('Rate card made', 'भाव कार्ड बना'),
  RATE_SOURCE_ATTACHED: t('Rate sheet file added', 'भाव सूची की फ़ाइल जोड़ी'),
  RATE_EXTRACTION_STARTED: t('Reading prices from the file', 'फ़ाइल से भाव पढ़ना शुरू'),
  RATE_EXTRACTION_COMPLETED: t('Prices read from the file', 'फ़ाइल से भाव पढ़े गए'),
  RATE_EXTRACTION_FAILED: t('Could not read prices from the file', 'फ़ाइल से भाव नहीं पढ़ सके'),
  RATE_ADJUSTMENT_PREVIEWED: t('Price change previewed', 'भाव बदलाव की झलक बनी'),
  PAYMENT_CONFIRMED: t('Online payment confirmed', 'ऑनलाइन भुगतान पक्का'),
  LATE_PAYMENT_REFUND_REQUIRED: t(
    'Payment arrived after cancellation, refund due',
    'रद्द होने के बाद भुगतान आया, पैसा लौटाना है',
  ),
  CART_MERGED: t('Guest basket joined account', 'मेहमान टोकरी खाते में जुड़ी'),
  CART_REORDERED: t('Order added to basket again', 'ऑर्डर फिर टोकरी में'),
});
/** A short plain-language summary of the evidence kept with an activity entry. */
function auditSummary(details: Audit['details'], t: T, status: (value: string) => string) {
  if (!details) return '';
  const parts: string[] = [];
  const paise = details.amountPaise ?? details.totalPaise;
  if (typeof paise === 'number') parts.push(money(paise));
  if (typeof details.from === 'string' && typeof details.to === 'string')
    parts.push(`${status(details.from)} → ${status(details.to)}`);
  if (typeof details.oldPricePaise === 'number' && typeof details.newPricePaise === 'number')
    parts.push(`${money(details.oldPricePaise)} → ${money(details.newPricePaise)}`);
  if (typeof details.quantity === 'number') parts.push(`${t('qty', 'मात्रा')} ${details.quantity}`);
  if (typeof details.channel === 'string')
    parts.push(details.channel === 'CASH' ? t('cash', 'नकद') : details.channel);
  return parts.join(' · ');
}
export function AuditHistory() {
  const { t, error: say, moment, status } = useWords();
  const events = eventText(t);
  const [rows, setRows] = useState<Audit[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState('');
  const load = useCallback(async (after?: string) => {
    const page = await api<Page<Audit>>(
      `/admin/audit?limit=24${after ? '&cursor=' + encodeURIComponent(after) : ''}`,
    );
    setRows((old) => (after ? [...old, ...page.items] : page.items));
    setCursor(page.nextCursor);
  }, []);
  useEffect(() => {
    const refreshVisible = () => {
      void load()
        .then(() => setError(''))
        .catch((e) => setError(say(e)));
    };
    refreshVisible();
    window.addEventListener('shiv-owner-refresh', refreshVisible);
    return () => window.removeEventListener('shiv-owner-refresh', refreshVisible);
  }, [load]);
  return (
    <section className="panel operations-panel">
      <h2>{t('Store activity', 'दुकान का हिसाब-किताब')}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ol className="activity-list">
        {rows.map((r) => (
          <li key={r.id}>
            <strong>{events[r.event] || r.event.toLowerCase().replaceAll('_', ' ')}</strong>
            <span>
              {[
                r.actorName || t('System', 'सिस्टम'),
                r.entityLabel,
                auditSummary(r.details, t, status),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <small>{moment(r.createdAt)}</small>
          </li>
        ))}
      </ol>
      {!rows.length && <p>{t('No activity yet.', 'अभी कोई गतिविधि नहीं।')}</p>}
      {cursor && (
        <button
          className="secondary"
          onClick={() => void load(cursor).catch((e) => setError(say(e)))}
        >
          {t('Older activity', 'पुरानी गतिविधि')}
        </button>
      )}
    </section>
  );
}
