'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Category, Product } from '@shiv/shared';
import { brandsResponse, categoriesResponse, pageResponse, publicGet } from '../lib/api';
import {
  MAX_PAGES,
  PAGE_SIZE,
  queryString,
  readQuery,
  uniqueProducts,
  type CatalogQuery,
} from '../lib/catalog';
import { useLanguage } from './language';
import { useLiveRefresh } from './live';
import { Freshness, ProductCard } from './product';

const emptyQuery = readQuery(new URLSearchParams());

export function Catalogue({ preview = false }: { preview?: boolean }) {
  const params = useSearchParams();
  const { t } = useLanguage();
  const query = preview ? emptyQuery : readQuery(params);
  const key = queryString(query);
  const queryRef = useRef(query);
  queryRef.current = query;
  const [draft, setDraft] = useState(query.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [filterError, setFilterError] = useState(false);
  const [items, setItems] = useState<Product[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  const refreshPending = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const previousFilters = useRef<string | null>(null);
  const filterRequest = useRef(0);

  const loadFilters = useCallback(async () => {
    const current = ++filterRequest.current;
    const result = await Promise.allSettled([
      publicGet('/categories', categoriesResponse),
      publicGet('/brands', brandsResponse),
    ]);
    if (current !== filterRequest.current) return;
    if (result[0].status === 'fulfilled') setCategories(result[0].value);
    if (result[1].status === 'fulfilled') setBrands(result[1].value.map((item) => item.brand));
    setFilterError(result.some((value) => value.status === 'rejected'));
  }, []);
  useEffect(() => {
    void loadFilters();
    return () => {
      filterRequest.current++;
    };
  }, [loadFilters]);

  const load = useCallback(
    async (background = false) => {
      if (background && inFlight.current) {
        refreshPending.current = true;
        return;
      }
      const current = ++request.current;
      inFlight.current = true;
      refreshPending.current = false;
      const active = readQuery(new URLSearchParams(key));
      const filterKey = queryString({ ...active, pages: 1 });
      if (previousFilters.current !== filterKey) {
        setItems([]);
        setNextCursor(null);
        setCheckedAt(null);
      }
      previousFilters.current = filterKey;
      setLoading(true);
      try {
        const search = new URLSearchParams({
          q: active.q,
          category: active.category,
          brand: active.brand,
          availability: active.availability,
          sort: active.sort,
          limit: String(PAGE_SIZE),
        });
        const collected: Product[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < active.pages; page++) {
          if (cursor) search.set('cursor', cursor);
          const response = await publicGet(`/products?${search}`, pageResponse);
          if (request.current !== current) return;
          collected.push(...response.items);
          cursor = response.nextCursor;
          if (!cursor) break;
        }
        setItems(uniqueProducts(collected));
        setNextCursor(cursor);
        setCheckedAt(new Date().toISOString());
        setError(false);
      } catch {
        if (request.current === current) setError(true);
      } finally {
        if (request.current === current) {
          inFlight.current = false;
          setLoading(false);
          if (refreshPending.current) {
            refreshPending.current = false;
            refreshRef.current();
          }
        }
      }
    },
    [key],
  );
  refreshRef.current = () => {
    void load(true);
  };
  useEffect(() => {
    void load();
    return () => {
      request.current++;
      inFlight.current = false;
    };
  }, [load]);
  const connection = useLiveRefresh(() => {
    void load(true);
    void loadFilters();
  });

  useEffect(() => {
    clearTimeout(searchTimer.current);
    setDraft(query.q);
    return () => clearTimeout(searchTimer.current);
  }, [query.q]);

  function update(next: Partial<CatalogQuery>) {
    const updated = readQuery(
      new URLSearchParams(queryString({ ...queryRef.current, pages: 1, ...next })),
    );
    const value = queryString(updated);
    // An unchanged normalized search must keep both the request and the clicked card intact.
    if (value === queryString(queryRef.current)) return;
    window.history.pushState(null, '', `/products${value ? `?${value}` : ''}`);
  }
  function search(value: string) {
    setDraft(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      if (value.trim() !== queryRef.current.q) update({ q: value.trim() });
    }, 300);
  }

  return (
    <section
      className={`catalogue${preview ? ' catalogue-preview' : ''}`}
      aria-label={t('Materials catalogue', 'सामग्री सूची')}
    >
      {preview ? (
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t('AT THE MATERIALS COUNTER', 'सामग्री काउंटर पर')}</p>
            <h2>{t('Find what your site needs.', 'आपके काम की सामग्री।')}</h2>
          </div>
          <Link className="text-link" href="/products">
            {t('All materials', 'सारी सामग्री')} <span aria-hidden="true">↗</span>
          </Link>
        </div>
      ) : null}
      {categories.length ? (
        <div className="category-links" aria-label={t('Browse categories', 'श्रेणियाँ देखें')}>
          <Link href="/products" className={!query.category ? 'selected' : ''}>
            {t('All materials', 'सारी सामग्री')}
          </Link>
          {categories.map((category) => (
            <Link
              href={`/products?category=${encodeURIComponent(category.slug)}`}
              key={category.id}
              className={query.category === category.slug ? 'selected' : ''}
            >
              {category.name}
            </Link>
          ))}
        </div>
      ) : null}
      {!preview ? (
        <div className="catalogue-filters">
          <form
            className="search-field"
            onSubmit={(event) => {
              event.preventDefault();
              clearTimeout(searchTimer.current);
              if (draft.trim() !== query.q) update({ q: draft.trim() });
            }}
          >
            <label htmlFor="catalogue-search">{t('Search materials', 'सामग्री खोजें')}</label>
            <div className="search-input">
              <span aria-hidden="true">⌕</span>
              <input
                id="catalogue-search"
                type="search"
                maxLength={100}
                value={draft}
                placeholder={t('Name, brand or grade', 'नाम, ब्रांड या ग्रेड')}
                onChange={(event) => search(event.target.value)}
              />
            </div>
          </form>
          <div className="filter-fields">
            <label>
              {t('Category', 'श्रेणी')}
              <select
                value={query.category}
                onChange={(event) => update({ category: event.target.value })}
              >
                <option value="">{t('All categories', 'सभी श्रेणियाँ')}</option>
                {categories.map((category) => (
                  <option value={category.slug} key={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Brand', 'ब्रांड')}
              <select
                value={query.brand}
                onChange={(event) => update({ brand: event.target.value })}
              >
                <option value="">{t('All brands', 'सभी ब्रांड')}</option>
                {query.brand && !brands.includes(query.brand) ? (
                  <option value={query.brand}>{query.brand}</option>
                ) : null}
                {brands.map((brand) => (
                  <option key={brand}>{brand}</option>
                ))}
              </select>
            </label>
            <label>
              {t('Availability', 'उपलब्धता')}
              <select
                value={query.availability}
                onChange={(event) =>
                  update({ availability: event.target.value as CatalogQuery['availability'] })
                }
              >
                <option value="all">{t('Any availability', 'सभी सामग्री')}</option>
                <option value="in">{t('In stock', 'स्टॉक में')}</option>
                <option value="out">{t('Out of stock', 'स्टॉक नहीं')}</option>
              </select>
            </label>
            <label>
              {t('Sort by', 'क्रम चुनें')}
              <select
                value={query.sort}
                onChange={(event) => update({ sort: event.target.value as CatalogQuery['sort'] })}
              >
                <option value="name">{t('Name: A to Z', 'नाम: A से Z')}</option>
                <option value="price_asc">{t('Price: low to high', 'कीमत: कम से ज़्यादा')}</option>
                <option value="price_desc">{t('Price: high to low', 'कीमत: ज़्यादा से कम')}</option>
                <option value="newest">{t('Recently added', 'हाल में जोड़ी गई')}</option>
              </select>
            </label>
          </div>
          {key ? (
            <button
              className="text-button"
              onClick={() => {
                clearTimeout(searchTimer.current);
                setDraft('');
                update(emptyQuery);
              }}
            >
              {t('Clear filters', 'फ़िल्टर हटाएँ')}
            </button>
          ) : null}
        </div>
      ) : null}
      {filterError ? (
        <div className="notice" role="status">
          {t('Some filters could not load.', 'कुछ फ़िल्टर लोड नहीं हो सके।')}{' '}
          <button className="text-button" onClick={() => void loadFilters()}>
            {t('Retry filters', 'फ़िल्टर फिर लोड करें')}
          </button>
        </div>
      ) : null}
      <div className="catalogue-status">
        <p>
          {preview
            ? t('Prices per selling unit', 'प्रति बिक्री इकाई कीमत')
            : t(`${items.length} materials shown`, `${items.length} सामग्री दिखाई गई`)}
        </p>
        <Freshness connection={connection} checkedAt={checkedAt} busy={loading} />
      </div>
      {error ? (
        <div className="notice notice-error" role="alert">
          <div>
            <strong>{t('Could not load materials.', 'सामग्री लोड नहीं हो सकी।')}</strong>
            <p>
              {items.length
                ? t(
                    'Displayed prices may be out of date. Check your connection and try again.',
                    'दिखाई गई कीमतें पुरानी हो सकती हैं। इंटरनेट जाँचें और फिर कोशिश करें।',
                  )
                : t('Check your connection and try again.', 'इंटरनेट जाँचें और फिर कोशिश करें।')}
            </p>
          </div>
          <button className="button" onClick={() => void load()}>
            {t('Try again', 'फिर कोशिश करें')}
          </button>
        </div>
      ) : null}
      {loading && !items.length ? (
        <div className="loading-state" role="status">
          <span className="loading-bar" />
          {t('Loading materials…', 'सामग्री लोड हो रही है…')}
        </div>
      ) : null}
      {!loading && !error && !items.length ? (
        <div className="empty-state">
          <h2>{t('No materials found', 'कोई सामग्री नहीं मिली')}</h2>
          <p>
            {t(
              'Try another name or remove a filter to see more materials.',
              'दूसरा नाम खोजें या फ़िल्टर हटाकर सामग्री देखें।',
            )}
          </p>
          <Link className="button" href="/products">
            {t('Browse all materials', 'सारी सामग्री देखें')}
          </Link>
        </div>
      ) : null}
      <div className="product-grid" aria-busy={loading}>
        {(preview ? items.slice(0, 4) : items).map((product) => (
          <ProductCard product={product} key={product.id} />
        ))}
      </div>
      {!preview && nextCursor ? (
        <div className="pagination">
          {query.pages < MAX_PAGES ? (
            <button
              className="button button-outline"
              disabled={loading}
              onClick={() => update({ pages: query.pages + 1 })}
            >
              {loading
                ? t('Loading…', 'लोड हो रहा है…')
                : t('Show more materials', 'और सामग्री दिखाएँ')}{' '}
              <span aria-hidden="true">↓</span>
            </button>
          ) : (
            <p>
              {t(
                'Use search or filters to narrow these results.',
                'खोज या फ़िल्टर से नतीजे कम करें।',
              )}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
