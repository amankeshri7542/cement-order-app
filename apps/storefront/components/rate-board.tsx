'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { productName, unitLabel } from '@shiv/shared';
import { pageResponse, publicGet } from '../lib/api';
import { price, ratesFrom, timeLabel, type Rate } from '../lib/catalog';
import { useLanguage } from './language';
import { MaterialArt } from './material-art';

const hindi: Record<string, string> = {
  cement: 'सीमेंट',
  steel: 'सरिया / स्टील',
  bricks: 'ईंट',
  sand: 'बालू',
  aggregates: 'गिट्टी',
  tiles: 'टाइल',
  pipes: 'पाइप',
  hardware: 'हार्डवेयर',
};

export function RateBoard() {
  const { t, language } = useLanguage();
  const [rates, setRates] = useState<Rate[] | null>(null);
  // Materials whose lowest price changed since the board last loaded; their figure rolls once.
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const request = useRef(0);
  const shown = useRef<Rate[] | null>(null);
  const load = useCallback(async () => {
    const current = ++request.current;
    try {
      const page = await publicGet(
        '/products?sort=price_asc&availability=in&limit=100',
        pageResponse,
      );
      if (current !== request.current) return;
      const next = ratesFrom(page.items);
      const before = shown.current;
      shown.current = next;
      setChanged(
        new Set(
          before
            ? next
                .filter((rate) =>
                  before.some(
                    (old) =>
                      old.slug === rate.slug && old.product.pricePaise !== rate.product.pricePaise,
                  ),
                )
                .map((rate) => rate.slug)
            : [],
        ),
      );
      setRates(next);
      setCheckedAt(new Date().toISOString());
      setFailed(false);
    } catch {
      if (current === request.current) setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
    const visible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      request.current++;
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load]);

  // One rate file: the ink cover carries the board's title and when it was checked; each material
  // is a folder filed under it (a link to its rates), cheapest in-stock price on the right.
  return (
    <aside className="rate-board" aria-labelledby="rate-board-title">
      <div className="rate-panel">
        <header>
          <span className="rate-stamp" aria-hidden="true">
            शिव
          </span>
          <div>
            <h2 id="rate-board-title">
              <span lang="hi">आज के भाव</span> <span lang="en">Current rates</span>
            </h2>
            <p className={checkedAt && !failed ? 'rate-checked' : undefined}>
              {failed && !rates
                ? t('Rates could not load right now.', 'भाव अभी लोड नहीं हो सके।')
                : checkedAt
                  ? t(
                      `Lowest in-stock price per material · checked ${timeLabel(checkedAt)}`,
                      `हर सामग्री का सबसे कम उपलब्ध भाव · ${timeLabel(checkedAt)} पर जाँचा`,
                    )
                  : t('Checking the catalogue…', 'सूची जाँची जा रही है…')}
            </p>
          </div>
        </header>
        {failed && !rates ? (
          <div className="rate-fallback">
            <Link className="text-link" href="/products">
              {t('Browse all materials', 'सारी सामग्री देखें')} <span aria-hidden="true">↗</span>
            </Link>
            <button className="text-button" onClick={() => void load()}>
              {t('Retry rates', 'भाव फिर लोड करें')}
            </button>
          </div>
        ) : null}
        {rates && !rates.length ? (
          <p className="rate-empty">
            {t('No materials are in stock right now.', 'अभी कोई सामग्री स्टॉक में नहीं है।')}{' '}
            <Link className="text-link" href="/quotes">
              {t('Ask for a written quote', 'लिखित भाव माँगें')}
            </Link>
          </p>
        ) : null}
      </div>
      {rates === null && !failed ? (
        <ol className="rate-rows" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((row) => (
            <li className="rate-row rate-row-placeholder" key={row}>
              <span />
              <span />
            </li>
          ))}
        </ol>
      ) : null}
      {rates?.length ? (
        <ol className="rate-rows">
          {rates.map((rate, index) => (
            <li key={rate.slug} style={{ '--row': index } as CSSProperties}>
              <Link
                className="rate-row"
                href={`/products?category=${encodeURIComponent(rate.slug)}`}
              >
                <span className="rate-art" aria-hidden="true">
                  <MaterialArt category={`${rate.name} ${rate.product.type}`} />
                </span>
                <span className="rate-name">
                  <strong>{language === 'hi' ? hindi[rate.slug] || rate.name : rate.name}</strong>
                  <small>{productName(rate.product, language)}</small>
                </span>
                <span className="rate-price">
                  <strong
                    key={rate.product.pricePaise}
                    className={changed.has(rate.slug) ? 'rolled' : undefined}
                  >
                    {price(rate.product.pricePaise)}
                  </strong>
                  <small>/ {unitLabel(rate.product.unit, language)}</small>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="rate-note">
        {t(
          'Illustrations show the material type, not the exact product. Delivery is added at checkout.',
          'चित्र सामग्री का प्रकार दिखाते हैं, सटीक सामान नहीं। डिलीवरी शुल्क चेकआउट में जुड़ता है।',
        )}
      </p>
    </aside>
  );
}
