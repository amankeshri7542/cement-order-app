import type { Metadata } from 'next';
import Link from 'next/link';
import { pageStyles as s, PageHead } from '../../../components/page';
import { Placeholder } from '../../../components/review';
import { phoneNumber, readShop, whatsappNumber } from '../../../lib/public-data';
import { pageMeta } from '../../../lib/seo';
import { indexingOn } from '../../../lib/site';
import { waLink } from '../../../lib/whatsapp';

export const metadata: Metadata = {
  ...pageMeta(
    '/about',
    'The shop',
    'Shiv Cement Store, Patna: cement, sariya, bricks, balu and gitti, with the rate and selling unit beside every item.',
  ),
  robots: indexingOn ? { index: true, follow: true } : { index: false, follow: false },
};

export default async function AboutPage() {
  const shop = await readShop();
  const phone = phoneNumber(shop);
  const whatsapp = whatsappNumber(shop);
  return (
    <div className={s.page}>
      <PageHead
        title="A family shop in Patna"
        lead={shop.story || 'A family shop for the materials your next project needs.'}
      />
      <section className={s.sectionBand}>
        <h2>The shop</h2>
        <table className={s.facts}>
          <tbody>
            <tr>
              <th scope="row">Shop</th>
              <td>{shop.firm?.legalName || shop.name}</td>
            </tr>
            <tr>
              <th scope="row">City</th>
              <td>{shop.city}</td>
            </tr>
            {shop.address ? (
              <tr>
                <th scope="row">Address</th>
                <td>{shop.address}</td>
              </tr>
            ) : null}
            {phone ? (
              <tr>
                <th scope="row">Phone</th>
                <td>
                  <a className="link" href={`tel:${phone}`}>
                    {phone}
                  </a>
                </td>
              </tr>
            ) : null}
            {whatsapp ? (
              <tr>
                <th scope="row">WhatsApp</th>
                <td>
                  <a
                    className="link"
                    href={waLink(whatsapp)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open WhatsApp
                  </a>
                </td>
              </tr>
            ) : null}
            {shop.hours ? (
              <tr>
                <th scope="row">Hours</th>
                <td>{shop.hours}</td>
              </tr>
            ) : null}
            {shop.directionsUrl ? (
              <tr>
                <th scope="row">Directions</th>
                <td>
                  <a
                    className="link"
                    href={shop.directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open the map
                  </a>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {!shop.contactApproved ? (
          <div style={{ marginTop: '1rem', maxWidth: '44rem' }}>
            <Placeholder id="shop-contact">
              Address, phone, WhatsApp, hours and map link show here once the family sets them with{' '}
              <code>contactApproved: true</code> in <code>apps/api/src/public-content.ts</code>.
              Years in business, family history and photos are printed only if the family gives
              them.
            </Placeholder>
          </div>
        ) : null}
      </section>
      <section className={`${s.sectionBand} ${s.prose}`}>
        <h2>What the shop sells</h2>
        <p>
          Cement, sariya and binding wire, balu, gitti, bricks and blocks: the materials used while
          building a home. Each shows its brand, grade and selling unit beside the rate, so you can
          compare like with like.
        </p>
        <h2>How buying works</h2>
        <ol>
          <li>Add what you need to your list. No sign-in is needed to build one.</li>
          <li>
            Check your site&apos;s pincode. The delivery charge and smallest order show on the list.
          </li>
          <li>Place the order, send the list on WhatsApp, or ask for a rate in writing.</li>
          <li>
            A person at the shop confirms it. You see it on the order page, with no need to call.
          </li>
        </ol>
        <h2>Before you choose</h2>
        <p>
          For structural design, mix proportions, load-bearing work or which steel to use, ask a
          qualified engineer. A material being available is not engineering approval.
        </p>
      </section>
      <p className={s.actions}>
        <Link className="btn btn-solid" href="/rates" prefetch={false}>
          See the rates
        </Link>
        <Link className="btn btn-line" href="/contact" prefetch={false}>
          Contact the shop
        </Link>
      </p>
    </div>
  );
}
