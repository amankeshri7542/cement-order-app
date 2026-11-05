import type { Metadata } from 'next';
import { EnquiryForm } from '../../../components/enquiry';
import { pageStyles as s, PageHead } from '../../../components/page';
import { Placeholder } from '../../../components/review';
import { phoneNumber, readShop, whatsappNumber } from '../../../lib/public-data';
import { pageMeta } from '../../../lib/seo';
import { indexingOn } from '../../../lib/site';
import { waLink } from '../../../lib/whatsapp';

export const metadata: Metadata = {
  ...pageMeta(
    '/contact',
    'Contact and complaints',
    'Ask Shiv Cement Store, Patna about a material, its selling unit or delivery, or send a complaint.',
  ),
  robots: indexingOn ? { index: true, follow: true } : { index: false, follow: false },
};

type Props = { searchParams: Promise<{ interest?: string | string[] }> };

export default async function ContactPage({ searchParams }: Props) {
  const [shop, { interest }] = await Promise.all([readShop(), searchParams]);
  const seeded = (Array.isArray(interest) ? interest[0] : interest) ?? '';
  const phone = phoneNumber(shop);
  const whatsapp = whatsappNumber(shop);
  const firm = shop.firm;
  return (
    <div className={s.page}>
      <PageHead
        title="Contact the shop"
        lead="Ask about a material, its selling unit or delivery. Leave your number and the shop will contact you."
      >
        {phone || whatsapp ? (
          <p className={s.actions}>
            {phone ? (
              <a className="btn btn-solid" href={`tel:${phone}`}>
                Call the shop
              </a>
            ) : null}
            {whatsapp ? (
              <a
                className="btn btn-line"
                href={waLink(whatsapp)}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp
              </a>
            ) : null}
          </p>
        ) : null}
        {shop.address ? <p className={s.meta}>{shop.address}</p> : null}
      </PageHead>
      <section className={s.sectionBand} id="enquiry" aria-labelledby="enquiry-title">
        <h2 id="enquiry-title">Send a message or a complaint</h2>
        <div style={{ marginTop: '1rem' }}>
          <EnquiryForm interest={seeded} />
        </div>
      </section>
      <section className={s.sectionBand}>
        <h2>Who runs this shop</h2>
        <table className={s.facts}>
          <tbody>
            <tr>
              <th scope="row">Name</th>
              <td>{firm?.legalName || shop.name}</td>
            </tr>
            <tr>
              <th scope="row">City</th>
              <td>{shop.city}</td>
            </tr>
            {firm?.complaintOfficerName ? (
              <tr>
                <th scope="row">Complaints officer</th>
                <td>
                  {firm.complaintOfficerName}
                  {firm.complaintOfficerPhone ? `, ${firm.complaintOfficerPhone}` : ''}
                </td>
              </tr>
            ) : null}
            {firm?.gstin ? (
              <tr>
                <th scope="row">GST number</th>
                <td>{firm.gstin}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {!firm ? (
          <div style={{ marginTop: '1rem', maxWidth: '44rem' }}>
            <Placeholder id="legal-facts">
              Before launch the law asks for the legal name, every branch&apos;s address, and a
              complaints officer who acknowledges within 48 hours and settles within a month. These
              come from the Firm row in the database once <code>approvedAt</code> is set. Ask a
              lawyer to confirm this applies.
            </Placeholder>
          </div>
        ) : null}
      </section>
    </div>
  );
}
