'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCommerce, Quantity } from './commerce';
import { ProductImage } from './product';
import { price } from '../lib/catalog';
import { useLanguage } from './language';
import { ApiError, publicGet, productResponse } from '../lib/api';
import { productName, unitLabel, type Product } from '@shiv/shared';

export function BasketPage() {
  const c = useCommerce();
  const { language, t } = useLanguage();
  const checkoutLabel = c.user
    ? t('Review delivery & checkout', 'डिलीवरी और चेकआउट जाँचें')
    : t('Sign in to checkout', 'चेकआउट के लिए साइन इन');
  return (
    <div className="commerce-page">
      <div className="page-heading">
        <h1>
          {c.lines.length || !c.ready
            ? t('Ready for the next step.', 'अगले कदम के लिए तैयार।')
            : t('Your basket is empty.', 'आपकी टोकरी खाली है।')}
        </h1>
        <p>
          {t(
            'Check the quantity and selling unit. Prices and delivery are reviewed before you order.',
            'मात्रा और बिक्री इकाई जाँचें। ऑर्डर से पहले कीमत और डिलीवरी की फिर जाँच होगी।',
          )}
        </p>
      </div>
      {(c.guest?.lines.length || c.mergeDraft) && c.user ? (
        <div className="notice">
          <p>
            {t(
              'Saved guest materials are waiting to join this account’s basket. The same merge can be retried safely.',
              'सहेजी सामग्री इस खाते की टोकरी में जुड़ने की प्रतीक्षा में है। फिर कोशिश करने से मात्रा दोबारा नहीं जुड़ती।',
            )}
          </p>
          <button className="button" disabled={c.busy} onClick={() => void c.merge()}>
            {t('Recover saved basket', 'सहेजी टोकरी वापस लाएँ')}
          </button>
          {c.mergeDraft && (
            <div className="merge-draft">
              <p>
                {c.mergeDraft.uncertain
                  ? t(
                      'Recover the saved result before editing this list.',
                      'यह सूची बदलने से पहले सहेजा परिणाम वापस पाएँ।',
                    )
                  : t(
                      'The saved list needs correction. Change or remove unavailable quantities, then retry.',
                      'सहेजी सूची में सुधार चाहिए। उपलब्ध न होने वाली मात्रा बदलें या हटाएँ, फिर कोशिश करें।',
                    )}
              </p>
              {c.mergeDraft.lines.map(({ product, quantity }) => (
                <div className="quote-line" key={product.id}>
                  <strong>{productName(product, language)}</strong>
                  <Quantity
                    product={product}
                    value={quantity}
                    max={product.stock}
                    disabled={c.mergeDraft!.uncertain || c.busy}
                    onChange={(value) => c.editMerge(product, value)}
                  />
                  <button
                    className="text-link"
                    disabled={c.mergeDraft!.uncertain || c.busy}
                    onClick={() => c.editMerge(product, 0)}
                  >
                    {t('Remove saved material', 'सहेजी सामग्री हटाएँ')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {c.lines.length ? (
        <div className="purchase-layout">
          {/* The basket is the counter's parchi: a paper slip with ruled lines, the shopkeeper's
              hand for each line and the total, a cash-on-delivery stamp and a torn edge. */}
          <div className="parchi">
            <div className="basket-lines">
              {c.lines.map(({ product, quantity }) => (
                <article className="basket-line" key={product.id}>
                  <div>
                    <h2>
                      <Link href={`/products/${product.id}`}>{productName(product, language)}</Link>
                    </h2>
                    <p>
                      {product.brand} · {product.grade}
                      {product.packSize ? ` · ${product.packSize}` : ''}
                    </p>
                    <p>
                      {price(product.pricePaise)} / {unitLabel(product.unit, language)}
                    </p>
                    <Quantity
                      value={quantity}
                      product={product}
                      onChange={(value) => void c.quantity(product, value)}
                      max={product.stock}
                      disabled={c.busy || c.mergePending}
                    />
                    <p className="quantity-rule">
                      {t('Minimum', 'न्यूनतम')} {product.minQuantity} · {t('Step', 'बढ़ोतरी')}{' '}
                      {product.quantityStep} × {unitLabel(product.unit, language)}
                    </p>
                    <button
                      className="text-link"
                      disabled={c.busy || c.mergePending}
                      onClick={() => void c.quantity(product, 0)}
                    >
                      {t('Remove', 'हटाएँ')}
                    </button>
                  </div>
                  <strong>{price(product.pricePaise * quantity)}</strong>
                </article>
              ))}
            </div>
            <p className="parchi-total">
              <span>{t('Materials estimate', 'सामग्री का अनुमान')}</span>{' '}
              <strong>
                {price(
                  c.lines.reduce((sum, line) => sum + line.product.pricePaise * line.quantity, 0),
                )}
              </strong>
            </p>
            <span className="cod-stamp" aria-hidden="true">
              {t('Cash on delivery', 'पहुँचने पर नकद')}
            </span>
          </div>
          <aside className="order-summary">
            <p>
              {t(
                'Delivery is calculated after you choose an address. Stock is reserved only when an order is confirmed.',
                'पता चुनने के बाद डिलीवरी की गणना होती है। ऑर्डर पक्का होने पर ही स्टॉक आरक्षित होता है।',
              )}
            </p>
            {/* A link cannot be disabled, so a basket that is still saving shows a button. */}
            {c.busy || c.mergePending ? (
              <button className="button" disabled>
                {checkoutLabel}
              </button>
            ) : (
              <Link className="button" href={c.user ? '/checkout' : '/account?next=/checkout'}>
                {checkoutLabel}
              </Link>
            )}
            <button
              className="text-link"
              onClick={() =>
                c.lines.forEach((line) => c.quoteQuantity(line.product, line.quantity))
              }
            >
              {t('Copy materials to quote list', 'सामग्री भाव सूची में कॉपी करें')}
            </button>
            <Link href="/quotes">{t('Open quotation list →', 'भाव सूची खोलें →')}</Link>
            <button
              className="text-link"
              onClick={() => void c.refresh().catch(c.showError)}
              disabled={!c.user || c.busy}
            >
              {t('Refresh shared basket', 'साझा टोकरी अपडेट करें')}
            </button>
          </aside>
        </div>
      ) : (
        <section className="empty-state empty-basket">
          <h2>{t('Start with one material.', 'एक सामग्री से शुरू करें।')}</h2>
          <p>
            {t(
              'Your selections stay here while you browse, even before you sign in.',
              'सामग्री देखते समय आपके चयन यहाँ बने रहते हैं, साइन इन से पहले भी।',
            )}
          </p>
          <div className="empty-actions">
            <Link className="button" href="/products">
              {t('Shop materials', 'सामग्री खरीदें')}
            </Link>
            <Link className="button secondary" href="/quotes">
              {t('Request bulk quote', 'थोक भाव माँगें')}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
export function ComparePage() {
  const c = useCommerce();
  const { language, t } = useLanguage();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [removed, setRemoved] = useState(false);
  const ids = c.compare.map((p) => p.id).join(',');
  const { dropCompare, showError } = c;
  useEffect(() => {
    let active = true;
    setProducts([]);
    setLoading(true);
    const wanted = ids.split(',').filter(Boolean);
    void Promise.allSettled(
      wanted.map((id) => publicGet(`/products/${encodeURIComponent(id)}`, productResponse)),
    ).then((results) => {
      if (!active) return;
      // One product leaving the catalogue must not hold back the rest of the comparison.
      const gone = wanted.filter((_, index) => {
        const result = results[index]!;
        return (
          result.status === 'rejected' &&
          result.reason instanceof ApiError &&
          result.reason.status === 404
        );
      });
      const failed = results.find(
        (result, index) => result.status === 'rejected' && !gone.includes(wanted[index]!),
      );
      setProducts(
        results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      );
      setLoading(false);
      if (failed?.status === 'rejected') showError(failed.reason);
      if (gone.length) {
        setRemoved(true);
        dropCompare(gone);
      }
    });
    return () => {
      active = false;
    };
  }, [ids, dropCompare, showError]);
  return (
    <div className="commerce-page">
      <div className="page-heading">
        <h1>{t('Compare the right details.', 'सही जानकारी की तुलना करें।')}</h1>
        <p>
          {t(
            'Choose two or three materials. Prices use each product’s selling unit and are not normalized across different units.',
            'दो या तीन सामग्री चुनें। कीमतें हर सामग्री की अपनी बिक्री इकाई में हैं; अलग इकाइयों को समान न मानें।',
          )}
        </p>
      </div>
      {removed && (
        <p className="notice" role="status">
          {t(
            'A selected material is no longer available and was removed from the comparison.',
            'चुनी गई एक सामग्री अब उपलब्ध नहीं है, इसलिए तुलना से हटा दी गई।',
          )}
        </p>
      )}
      {products.length < 2 ? (
        loading && ids.split(',').filter(Boolean).length >= 2 ? (
          <p className="loading-state" role="status">
            {t('Loading the selected materials…', 'चुनी गई सामग्री लोड हो रही है…')}
          </p>
        ) : (
          <section className="empty-state">
            <h2>
              {products.length === 1
                ? t(
                    `${products[0]!.name} is selected.`,
                    `${productName(products[0]!, 'hi')} चुनी गई है।`,
                  )
                : t('Nothing to compare yet.', 'तुलना के लिए अभी कुछ नहीं।')}
            </h2>
            <p>
              {t(
                'Choose Compare on two or three materials in the catalogue.',
                'सामग्री सूची में दो या तीन सामग्री पर तुलना करें चुनें।',
              )}
            </p>
            <Link className="button" href="/products">
              {t('Open materials', 'सामग्री खोलें')}
            </Link>
          </section>
        )
      ) : (
        <div className="comparison">
          {products.map((p) => (
            <article key={p.id}>
              <ProductImage product={p} />
              <h2>{productName(p, language)}</h2>
              <dl>
                {[
                  [t('Brand', 'ब्रांड'), p.brand],
                  [t('Grade', 'ग्रेड'), p.grade],
                  [
                    t('Price / unit', 'कीमत / इकाई'),
                    `${price(p.pricePaise)} / ${unitLabel(p.unit, language)}`,
                  ],
                  [t('Pack', 'पैक'), p.packSize || t('Not listed', 'दर्ज नहीं')],
                  [
                    t('Minimum / step', 'न्यूनतम / बढ़ोतरी'),
                    `${p.minQuantity} / ${p.quantityStep} × ${unitLabel(p.unit, language)}`,
                  ],
                  [
                    t('Recommended use', 'इस्तेमाल की सलाह'),
                    p.recommendedUse || t('Not specified', 'दर्ज नहीं'),
                  ],
                ].map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <Link className="button" href={`/products/${p.id}`}>
                {t('View material', 'सामग्री देखें')}
              </Link>
              <button className="text-link" onClick={() => c.toggleCompare(p)}>
                {t('Remove from comparison', 'तुलना से हटाएँ')}
              </button>
            </article>
          ))}
        </div>
      )}
      {c.compare.length ? (
        <button className="text-link" onClick={c.clearCompare}>
          {t('Clear comparison', 'तुलना साफ करें')}
        </button>
      ) : null}
    </div>
  );
}
