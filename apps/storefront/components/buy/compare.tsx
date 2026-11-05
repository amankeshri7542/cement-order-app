'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { COMPARE_KEY, readCompare } from '../../lib/compare';
import { hasRate, productPath, unitWords } from '../../lib/catalog';
import { rupees } from '../../lib/format';
import type { CatalogProduct } from '../../lib/types';

/** Two or three materials side by side, each at its own selling unit. Never a converted rate. */
export function ComparePage({
  products,
}: {
  products: Omit<CatalogProduct, 'searchTerms' | 'images'>[];
}) {
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => setIds(readCompare()), []);
  const chosen = (ids ?? [])
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is NonNullable<typeof product> => Boolean(product))
    .map((product) => ({ ...product, searchTerms: [] as string[], images: [] as string[] }));
  function remove(id: string) {
    const next = (ids ?? []).filter((item) => item !== id);
    setIds(next);
    try {
      sessionStorage.setItem(COMPARE_KEY, JSON.stringify(next));
    } catch {
      /* The choice lasts for this page. */
    }
  }
  return (
    <div className="commerce-page">
      <div className="page-heading">
        <h1>Compare the right details.</h1>
        <p>
          Rates use each material&apos;s own selling unit. Do not treat different units as equal.
        </p>
      </div>
      {ids === null ? (
        <p className="loading-state" role="status">
          Opening…
        </p>
      ) : chosen.length < 2 ? (
        <section className="empty-state">
          <h2>
            {chosen.length === 1 ? `${chosen[0]!.name} is chosen.` : 'Nothing to compare yet.'}
          </h2>
          <p>Use Compare on the page of two or three materials.</p>
          <Link className="button" href="/materials">
            All materials
          </Link>
        </section>
      ) : (
        <div className="comparison">
          {chosen.map((product) => (
            <article key={product.id}>
              <h2>{product.name}</h2>
              <dl>
                {(
                  [
                    ['Brand', product.brand],
                    ['Grade', product.grade],
                    [
                      'Rate',
                      hasRate(product)
                        ? `${rupees(product.pricePaise)}, ${unitWords(product.unit).long}`
                        : 'Ask for the rate',
                    ],
                    ['Pack', product.packSize || 'Ask the shop'],
                    [
                      'Smallest order',
                      `${product.minQuantity}, in steps of ${product.quantityStep}`,
                    ],
                    ['Often used for', product.recommendedUse || 'Ask the shop'],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="action-row">
                <Link className="button" href={productPath(product)}>
                  See this material
                </Link>
                <button type="button" className="text-link" onClick={() => remove(product.id)}>
                  Take it off
                </button>
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
