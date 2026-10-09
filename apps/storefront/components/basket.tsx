'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCommerce, Quantity } from './commerce';
import { ProductImage } from './product';
import { price } from '../lib/catalog';
import { useLanguage } from './language';
import { publicGet, productResponse } from '../lib/api';
import type { Product } from '@shiv/shared';

export function BasketPage() {
  const c = useCommerce();
  const { t } = useLanguage();
  return (
    <div className="commerce-page">
      <div className="page-heading">
        <p className="eyebrow">{t('YOUR MATERIAL LIST', 'आपकी सामग्री सूची')}</p>
        <h1>{t('Ready for the next step.', 'अगले कदम के लिए तैयार।')}</h1>
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
                  <strong>{product.name}</strong>
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
          <div className="basket-lines">
            {c.lines.map(({ product, quantity }) => (
              <article className="basket-line" key={product.id}>
                <Link href={`/products/${product.id}`}>
                  <ProductImage product={product} />
                </Link>
                <div>
                  <p className="eyebrow">{product.brand}</p>
                  <h2>
                    <Link href={`/products/${product.id}`}>{product.name}</Link>
                  </h2>
                  <p>
                    {product.grade} · {product.packSize || t('Pack not specified', 'पैक दर्ज नहीं')}
                  </p>
                  <p>
                    {price(product.pricePaise)} / {product.unit}
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
                    {product.quantityStep} {product.unit}
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
          <aside className="order-summary">
            <p className="eyebrow">{t('MATERIALS ESTIMATE', 'सामग्री का अनुमान')}</p>
            <h2>
              {price(
                c.lines.reduce((sum, line) => sum + line.product.pricePaise * line.quantity, 0),
              )}
            </h2>
            <p>
              {t(
                'Delivery is calculated after you choose an address. Stock is reserved only when an order is confirmed.',
                'पता चुनने के बाद डिलीवरी की गणना होती है। ऑर्डर पक्का होने पर ही स्टॉक आरक्षित होता है।',
              )}
            </p>
            <Link
              className="button"
              aria-disabled={c.busy || c.mergePending}
              href={c.user ? '/checkout' : '/account?next=/checkout'}
            >
              {c.user
                ? t('Review delivery & checkout', 'डिलीवरी और चेकआउट जाँचें')
                : t('Sign in to checkout', 'चेकआउट के लिए साइन इन')}
            </Link>
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
        <section className="empty-state">
          <h2>{t('Start with one material.', 'एक सामग्री से शुरू करें।')}</h2>
          <p>
            {t(
              'Your selections will stay here while you browse.',
              'सामग्री देखते समय आपके चयन यहाँ बने रहेंगे।',
            )}
          </p>
          <Link className="button" href="/products">
            {t('Shop materials', 'सामग्री खरीदें')}
          </Link>
        </section>
      )}
    </div>
  );
}
export function ComparePage() {
  const c = useCommerce();
  const { t } = useLanguage();
  const [products, setProducts] = useState<Product[]>([]);
  const ids = c.compare.map((p) => p.id).join(',');
  useEffect(() => {
    let active = true;
    setProducts([]);
    void Promise.all(
      ids
        .split(',')
        .filter(Boolean)
        .map((id) => publicGet(`/products/${encodeURIComponent(id)}`, productResponse)),
    )
      .then((items) => {
        if (active) setProducts(items);
      })
      .catch(c.showError);
    return () => {
      active = false;
    };
  }, [ids, c.showError]);
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
      {products.length < 2 ? (
        <p>
          {t(
            'Choose at least two materials using Compare in the catalogue.',
            'सामग्री सूची में तुलना से कम से कम दो सामग्री चुनें।',
          )}{' '}
          <Link className="text-link" href="/products">
            {t('Open materials', 'सामग्री खोलें')}
          </Link>
        </p>
      ) : (
        <div className="comparison">
          {products.map((p) => (
            <article key={p.id}>
              <ProductImage product={p} />
              <h2>{p.name}</h2>
              <dl>
                {[
                  [t('Brand', 'ब्रांड'), p.brand],
                  [t('Grade', 'ग्रेड'), p.grade],
                  [t('Price / unit', 'कीमत / इकाई'), `${price(p.pricePaise)} / ${p.unit}`],
                  [t('Pack', 'पैक'), p.packSize || t('Not specified', 'दर्ज नहीं')],
                  [
                    t('Minimum / step', 'न्यूनतम / बढ़ोतरी'),
                    `${p.minQuantity} / ${p.quantityStep} ${p.unit}`,
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
      <button className="text-link" onClick={c.clearCompare}>
        {t('Clear comparison', 'तुलना साफ करें')}
      </button>
    </div>
  );
}
