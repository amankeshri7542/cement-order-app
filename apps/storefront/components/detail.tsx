'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Product } from '@shiv/shared';
import { ApiError, productResponse, publicGet } from '../lib/api';
import { dateLabel, price } from '../lib/catalog';
import { useLanguage } from './language';
import { useLiveRefresh } from './live';
import { Freshness, ProductImage } from './product';

export function ProductDetail({
  id,
  initial,
  initiallyMissing = false,
  checked,
}: {
  id: string;
  initial: Product | null;
  initiallyMissing?: boolean;
  checked: string | null;
}) {
  const { language, t } = useLanguage();
  const [product, setProduct] = useState(initial);
  const [missing, setMissing] = useState(initiallyMissing);
  const [error, setError] = useState(!initial && !initiallyMissing);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState(checked);
  const request = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const load = useCallback(async () => {
    if (inFlight.current) {
      pending.current = true;
      return;
    }
    const current = ++request.current;
    inFlight.current = true;
    pending.current = false;
    setBusy(true);
    setError(false);
    try {
      const data = await publicGet(`/products/${encodeURIComponent(id)}`, productResponse);
      if (current !== request.current) return;
      setProduct(data);
      setMissing(false);
      setCheckedAt(new Date().toISOString());
    } catch (failure) {
      if (current !== request.current) return;
      if (failure instanceof ApiError && failure.status === 404) {
        setMissing(true);
        setProduct(null);
      } else setError(true);
    } finally {
      if (current === request.current) {
        inFlight.current = false;
        setBusy(false);
        if (pending.current) {
          pending.current = false;
          refreshRef.current();
        }
      }
    }
  }, [id]);
  refreshRef.current = () => {
    void load();
  };
  useEffect(() => {
    if (!initial && !initiallyMissing) void load();
    return () => {
      request.current++;
      inFlight.current = false;
    };
  }, [initial, initiallyMissing, load]);
  const connection = useLiveRefresh(() => {
    void load();
  });
  return (
    <div className="detail-page">
      <div className="detail-breadcrumb">
        <Link href="/products">← {t('All materials', 'सारी सामग्री')}</Link>
        {product ? (
          <>
            <span aria-hidden="true">/</span>
            <Link href={`/products?category=${encodeURIComponent(product.category.slug)}`}>
              {product.category.name}
            </Link>
          </>
        ) : null}
      </div>
      {error ? (
        <div className="notice notice-error" role="alert">
          <div>
            <strong>
              {t('Could not refresh this material.', 'इस सामग्री को अपडेट नहीं कर सके।')}
            </strong>
            <p>
              {t(
                'Check your connection and try again. Displayed prices may be out of date.',
                'इंटरनेट जाँचें और फिर कोशिश करें। दिखाई गई कीमतें पुरानी हो सकती हैं।',
              )}
            </p>
          </div>
          <button className="button" onClick={() => void load()} disabled={busy}>
            {t('Try again', 'फिर कोशिश करें')}
          </button>
        </div>
      ) : null}
      {missing ? (
        <Unavailable />
      ) : product ? (
        <>
          <div className="detail-grid">
            <div className="detail-visual">
              <ProductImage product={product} large />
              <p>
                {t(
                  'Check the product name, grade and pack size before purchase.',
                  'खरीदारी से पहले सामग्री का नाम, ग्रेड और पैक जाँचें।',
                )}
              </p>
            </div>
            <div className="detail-copy">
              <p className="eyebrow">
                {product.brand} · {product.category.name}
              </p>
              <h1>{product.name}</h1>
              <p className="detail-type">
                {product.type} · {product.grade}
              </p>
              <span className={`stock ${product.stock > 0 ? 'in-stock' : ''}`}>
                {product.stock > 0 ? t('In stock', 'स्टॉक में') : t('Out of stock', 'स्टॉक नहीं')}
              </span>
              <div className="detail-price">
                <strong>{price(product.pricePaise)}</strong>
                <span>/ {product.unit}</span>
              </div>
              <p className="price-updated">
                {t('Price updated', 'कीमत अपडेट हुई')}:{' '}
                {dateLabel(product.priceUpdatedAt, language)}
              </p>
              <Freshness connection={connection} checkedAt={checkedAt} busy={busy} />
              <dl className="spec-grid">
                <div>
                  <dt>{t('Selling unit', 'बिक्री इकाई')}</dt>
                  <dd>{product.unit}</dd>
                </div>
                <div>
                  <dt>{t('Pack size', 'पैक का आकार')}</dt>
                  <dd>{product.packSize || t('Not specified', 'दर्ज नहीं')}</dd>
                </div>
                <div>
                  <dt>{t('Minimum quantity', 'न्यूनतम मात्रा')}</dt>
                  <dd>
                    {product.minQuantity} {product.unit}
                  </dd>
                </div>
                <div>
                  <dt>{t('Quantity increment', 'मात्रा की बढ़ोतरी')}</dt>
                  <dd>
                    {product.quantityStep} {product.unit}
                  </dd>
                </div>
                <div>
                  <dt>{t('Type', 'प्रकार')}</dt>
                  <dd>{product.type}</dd>
                </div>
                <div>
                  <dt>{t('Grade', 'ग्रेड')}</dt>
                  <dd>{product.grade}</dd>
                </div>
              </dl>
              <div className="purchase-note">
                <strong>{t('Planning to buy?', 'खरीदारी की तैयारी है?')}</strong>
                <p>
                  {t(
                    'Note the material and quantity. Confirm the final price, availability and delivery with the store before purchase.',
                    'सामग्री और मात्रा लिख लें। खरीदारी से पहले अंतिम कीमत, उपलब्धता और डिलीवरी की दुकान से पुष्टि करें।',
                  )}
                </p>
                <Link className="text-link" href="/#delivery">
                  {t('Check delivery pincode', 'डिलीवरी पिनकोड जाँचें')} ↗
                </Link>
              </div>
            </div>
          </div>
          <section className="detail-description">
            <div>
              <h2>{t('About this material', 'इस सामग्री के बारे में')}</h2>
              <p>{product.description}</p>
            </div>
            <div>
              <h2>{t('Recommended use', 'इस्तेमाल की सलाह')}</h2>
              <p>{product.recommendedUse || t('Not specified', 'दर्ज नहीं')}</p>
            </div>
          </section>
        </>
      ) : busy ? (
        <p className="loading-state" role="status">
          {t('Loading material…', 'सामग्री लोड हो रही है…')}
        </p>
      ) : null}
    </div>
  );
}

export function Unavailable() {
  const { t } = useLanguage();
  return (
    <div className="empty-state">
      <p className="eyebrow">{t('MATERIAL UNAVAILABLE', 'सामग्री उपलब्ध नहीं')}</p>
      <h1>{t('This material is not available.', 'यह सामग्री उपलब्ध नहीं है।')}</h1>
      <p>
        {t(
          'It may have been removed from the catalogue. Browse the current materials to find another option.',
          'यह सामग्री सूची से हटाई गई हो सकती है। दूसरा विकल्प खोजने के लिए मौजूदा सामग्री देखें।',
        )}
      </p>
      <Link href="/products" className="button">
        {t('Browse materials', 'सामग्री देखें')}
      </Link>
    </div>
  );
}
