import Link from 'next/link';
import { hasRate, productPath, rateText, unitWords, type MaterialGroup } from '../lib/catalog';
import type { ListInput } from '../lib/list-store';
import type { CatalogProduct } from '../lib/types';
import s from './rates.module.css';

/** Only what the list needs: ids, names, units and rates reach the page, never a whole product. */
export function listInput(product: CatalogProduct): ListInput {
  return {
    i: product.id,
    n: product.name,
    u: unitWords(product.unit).long,
    m: product.minQuantity,
    s: product.quantityStep,
    r: product.pricePaise,
    h: productPath(product),
  };
}
export const lineData = (product: CatalogProduct) => JSON.stringify(listInput(product));

/** Add, working before the page's code has arrived. Second tap takes it off again. */
export function AddButton({ product, label }: { product: CatalogProduct; label?: string }) {
  return (
    <span data-line={lineData(product)} data-id={product.id} style={{ display: 'contents' }}>
      <button
        type="button"
        className="add"
        data-add
        aria-label={`Add ${label ?? product.name} to your list`}
        suppressHydrationWarning
      >
        <span className="off">Add</span>
        <span className="on">Added</span>
      </button>
    </span>
  );
}

export function Stepper({ product }: { product: CatalogProduct }) {
  return (
    <span className="stepper" data-qty data-line={lineData(product)} data-id={product.id}>
      <button
        type="button"
        data-step="-1"
        aria-label={`One less ${product.name}`}
        suppressHydrationWarning
      >
        −
      </button>
      <output suppressHydrationWarning data-qty-out aria-label={`${product.name} on your list`}>
        0
      </output>
      <button
        type="button"
        data-step="1"
        aria-label={`One more ${product.name}`}
        suppressHydrationWarning
      >
        +
      </button>
    </span>
  );
}

function RateCell({ product, sample }: { product: CatalogProduct; sample: boolean }) {
  if (!hasRate(product))
    return (
      <td className={s.price}>
        <span className={s.ask}>
          {product.availability === 'ON_REQUEST' ? 'Ask for the rate' : 'Rate not available'}
        </span>
      </td>
    );
  return (
    <td className={s.price}>
      {rateText(product)}
      {sample ? <span className="sr"> (sample rate)</span> : null}
      <span className="your-rate" data-your-rate={product.id} hidden suppressHydrationWarning />
    </td>
  );
}

/** A real table: name, unit and price together, in tabular figures, every rate in the first HTML. */
export function RateTable({
  products,
  sample,
  caption,
}: {
  products: CatalogProduct[];
  sample: boolean;
  caption: string;
}) {
  return (
    <table className={s.table}>
      <caption className="sr">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Material</th>
          <th scope="col">Rate</th>
          <th scope="col">On your list</th>
        </tr>
      </thead>
      <tbody>
        {products.map((product) => (
          <tr key={product.id}>
            <th scope="row">
              <Link className={s.name} href={productPath(product)} prefetch={false}>
                {product.name}
              </Link>
              <span className={s.unit}>
                {[unitWords(product.unit).long, product.grade].filter(Boolean).join(', ')}
              </span>
              {product.availability === 'ASK_SHOP' ? (
                <span className={s.tag}>Not available right now</span>
              ) : null}
            </th>
            <RateCell product={product} sample={sample} />
            <td className={s.qty}>
              {product.availability === 'IN_STOCK' ? <Stepper product={product} /> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One material, folded: "Cement, from ₹395 a bori, 4 brands". All rates stay in the HTML. */
export function RateGroup({
  group,
  sample,
  open,
}: {
  group: MaterialGroup;
  sample: boolean;
  open: boolean;
}) {
  const unit = group.lowest ? unitWords(group.lowest.unit).short : '';
  return (
    <details className={s.group} open={open}>
      <summary>
        <span className={s.groupName}>{group.name}</span>
        <span className={s.groupFrom}>
          {group.lowest ? (
            <>
              {group.from ? 'from ' : ''}
              <b>{rateText(group.lowest)}</b> {unit}
            </>
          ) : (
            'Ask for the rate'
          )}
          {group.products.length > 1 ? `, ${group.products.length} kinds` : ''}
        </span>
      </summary>
      <RateTable products={group.products} sample={sample} caption={`${group.name} rates`} />
    </details>
  );
}

export function ListSlip({
  whatsappHref,
  heading = 'h3',
}: {
  whatsappHref: string;
  heading?: 'h2' | 'h3';
}) {
  const Heading = heading;
  return (
    <div className={s.slip} data-slip aria-live="polite" id="your-list">
      <Heading>Your list</Heading>
      <p className={s.slipEmpty} data-slip-empty>
        Nothing yet. Use Add or + to start.
      </p>
      <ul className={s.slipLines} data-slip-lines suppressHydrationWarning />
      <p className={s.slipTotal} data-slip-total hidden suppressHydrationWarning>
        <span>Total at these rates</span>
        <span data-slip-sum suppressHydrationWarning />
      </p>
      <p data-slip-actions hidden suppressHydrationWarning>
        <Link className="btn btn-solid" href="/list" prefetch={false}>
          See your list
        </Link>
        {whatsappHref ? (
          <a
            className="btn btn-lamp"
            data-wa-list={whatsappHref}
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            suppressHydrationWarning
          >
            Send this list on WhatsApp
          </a>
        ) : null}
      </p>
    </div>
  );
}

/** Choosing between products of one material, opened by Add on a stage row. Plain HTML until then. */
export function Chooser({ group, sample }: { group: MaterialGroup; sample: boolean }) {
  return (
    <dialog
      className={s.choose}
      id={`choose-${group.slug}`}
      aria-labelledby={`choose-${group.slug}-title`}
    >
      <h2 id={`choose-${group.slug}-title`}>Which {group.name.toLowerCase()}?</h2>
      <ul>
        {group.products.map((product) => (
          <li key={product.id}>
            <span>
              {product.name}
              <small>
                {[
                  product.grade,
                  rateText(product) || 'Ask for the rate',
                  unitWords(product.unit).short,
                ]
                  .filter(Boolean)
                  .join(', ')}
                {sample && hasRate(product) ? ', sample' : ''}
              </small>
            </span>
            {product.availability === 'IN_STOCK' ? <AddButton product={product} /> : null}
          </li>
        ))}
      </ul>
      <p className={s.chooseEnd}>
        <Link className="link" href={`/materials/${group.slug}`} prefetch={false}>
          Not sure which? How to choose
        </Link>
        <button type="button" className="btn btn-quiet" data-close-dialog>
          Close
        </button>
      </p>
    </dialog>
  );
}

/** Rates could not be read and nothing is saved: words and a way forward, never a ₹0. */
export function RatesDown({ whatsapp }: { whatsapp?: string }) {
  return (
    <section className={s.down} role="status">
      <h2>Rate not available right now.</h2>
      <p>
        The shop&apos;s list could not be read just now. Try again in a minute
        {whatsapp ? ', or ask on WhatsApp.' : ', or ask the shop.'}
      </p>
      <p>
        {whatsapp ? (
          <a className="btn btn-solid" href={whatsapp} target="_blank" rel="noopener noreferrer">
            Ask on WhatsApp
          </a>
        ) : (
          <Link className="btn btn-solid" href="/contact" prefetch={false}>
            Ask the shop
          </Link>
        )}
      </p>
    </section>
  );
}
