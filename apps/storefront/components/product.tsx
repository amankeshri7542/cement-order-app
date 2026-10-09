'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Product } from '@shiv/shared';
import { approvedPhoto } from '../lib/api';
import { dateLabel, timeLabel, price } from '../lib/catalog';
import { useLanguage } from './language';
import { MaterialArt } from './material-art';
import type { Connection } from './live';
import { BuyActions } from './commerce';

export function ProductImage({ product, large = false }: { product: Product; large?: boolean }) {
  const { t } = useLanguage();
  const photo = approvedPhoto(product);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo]);
  return (
    <div className={`product-image${large ? ' product-image-large' : ''}`}>
      {photo && !failed ? (
        <img
          src={photo}
          alt={product.name}
          width={640}
          height={440}
          loading={large ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <MaterialArt
            large={large}
            category={`${product.category.name} ${product.type} ${product.name}`}
          />
          <span className="illustration-label">
            {product.category.name} · {t('Illustration', 'चित्रांकन')}
          </span>
        </>
      )}
    </div>
  );
}

export function ProductCard({ product }: { product: Product }) {
  const { t } = useLanguage();
  return (
    <article className="product-card">
      <Link href={`/products/${encodeURIComponent(product.id)}`} prefetch={false}>
        <ProductImage product={product} />
        <div className="product-card-copy">
          <div className="product-card-top">
            <span>{product.brand}</span>
            <span className={`stock ${product.stock > 0 ? 'in-stock' : ''}`}>
              {product.stock > 0 ? t('In stock', 'स्टॉक में') : t('Out of stock', 'स्टॉक नहीं')}
            </span>
          </div>
          <h3>{product.name}</h3>
          <p className="product-spec">
            {product.type} · {product.grade}
          </p>
          <div className="product-price">
            <strong>{price(product.pricePaise)}</strong>
            <span>/ {product.unit}</span>
            <span className="card-arrow" aria-hidden="true">
              ↗
            </span>
          </div>
          <p className="pack-size">
            {t('Pack', 'पैक')}: {product.packSize || t('Not specified', 'दर्ज नहीं')}
          </p>
        </div>
      </Link>
      <BuyActions product={product} />
    </article>
  );
}

export function Freshness({
  connection,
  checkedAt,
  busy = false,
}: {
  connection: Connection;
  checkedAt: string | null;
  busy?: boolean;
}) {
  const { language, t } = useLanguage();
  const status =
    connection === 'offline'
      ? t(
          'Offline · shown prices may be out of date. Reconnect to refresh.',
          'ऑफ़लाइन · दिखाई गई कीमतें पुरानी हो सकती हैं। अपडेट के लिए इंटरनेट से जुड़ें।',
        )
      : connection === 'disconnected'
        ? t(
            'Live updates disconnected · retry or return to this page to refresh.',
            'लाइव अपडेट बंद हैं · फिर कोशिश करें या इस पेज पर वापस आएँ।',
          )
        : busy
          ? t('Checking prices and availability…', 'कीमत और उपलब्धता जाँची जा रही है…')
          : checkedAt
            ? t(
                `Checked ${dateLabel(checkedAt, language)} · ${timeLabel(checkedAt)}`,
                `${dateLabel(checkedAt, language)} · ${timeLabel(checkedAt)} पर जाँचा गया`,
              )
            : t('Waiting for current prices', 'ताज़ा कीमतों का इंतज़ार');
  return (
    <p
      className={`freshness ${connection === 'offline' || connection === 'disconnected' ? 'freshness-warning' : ''}`}
      role="status"
    >
      <span aria-hidden="true" />
      {status}
    </p>
  );
}
