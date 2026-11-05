import type { Metadata } from 'next';
import Link from 'next/link';
import { pageStyles as s, PageHead } from '../../../components/page';
import { PincodeCheck } from '../../../components/pincode-check';
import { pageMeta } from '../../../lib/seo';
import { indexingOn } from '../../../lib/site';

export const metadata: Metadata = {
  ...pageMeta(
    '/delivery',
    'Delivery',
    'Check your site pincode for the delivery charge, smallest order and estimate at Shiv Cement Store, Patna.',
  ),
  robots: indexingOn ? { index: true, follow: true } : { index: false, follow: false },
};

export default function DeliveryPage() {
  return (
    <div className={s.page}>
      <PageHead
        title="Delivery"
        lead="Enter your site's pincode to see whether the shop delivers there, and what it costs."
      />
      <PincodeCheck />
      <noscript>
        <p>Checking a pincode needs JavaScript. You can ask the shop instead.</p>
      </noscript>
      <section className={`${s.sectionBand} ${s.prose}`}>
        <h2>How delivery works</h2>
        <p>
          Each pincode has its own delivery charge, smallest order and estimate, set by the shop.
          You see them before you confirm an order, with the charge shown apart from the materials.
        </p>
        <p>Check the material when it arrives, then pay in cash on delivery.</p>
        <p>
          For a large list, use Ask for a rate. The shop replies in writing with item rates, freight
          and an expiry date. A rate you asked for is not an order until the shop makes it one.
        </p>
      </section>
      <p className={s.actions}>
        <Link className="btn btn-solid" href="/rates" prefetch={false}>
          See the rates
        </Link>
        <Link className="btn btn-line" href="/list" prefetch={false}>
          Your list
        </Link>
      </p>
    </div>
  );
}
