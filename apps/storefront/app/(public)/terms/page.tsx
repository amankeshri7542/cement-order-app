import type { Metadata } from 'next';
import Link from 'next/link';
import { pageStyles as s, PageHead } from '../../../components/page';
import { Placeholder } from '../../../components/review';
import { pageMeta } from '../../../lib/seo';
import { indexingOn } from '../../../lib/site';

export const metadata: Metadata = {
  ...pageMeta('/terms', 'Terms', 'How ordering from Shiv Cement Store works, in plain words.'),
  robots: indexingOn ? { index: true, follow: true } : { index: false, follow: false },
};

export default function TermsPage() {
  return (
    <div className={s.page}>
      <PageHead
        title="How ordering works"
        lead="The terms of this service in plain language. Last updated 5 November 2026."
      />
      <div className={s.prose} style={{ marginTop: '2rem' }}>
        <h2>Rates and availability</h2>
        <p>
          Rates shown on the website and in the app are the shop&apos;s current ones. The total you
          pay, with delivery, is shown before you confirm an order. If a rate changes while you are
          ordering, you are asked to review the new total before it is placed.
        </p>
        <h2>Payment</h2>
        <p>Orders on the website are paid in cash on delivery. Online payment is not offered.</p>
        <h2>Delivery</h2>
        <p>
          Each pincode has its own delivery charge, smallest order and estimate, shown on the
          Delivery page and on your list before you confirm.
        </p>
        <h2>Cancelling and returns</h2>
        <p>
          You can cancel an order yourself in the app or on the website until the shop starts
          preparing it. After that, contact the shop. If a delivery cannot be completed, or goods
          come back, the shop records what happened and what returned to stock.
        </p>
        <h2>Rates you ask for</h2>
        <p>
          Asking for a rate is not an order. The shop replies in writing with item rates, freight
          and an expiry date. An accepted rate becomes an order only when the shop makes it one; a
          changed offer needs your approval again.
        </p>
        <h2>Technical advice</h2>
        <p>
          For structural design, mix proportions, load-bearing work or which steel to use, ask a
          qualified engineer. A material being available is not engineering approval.
        </p>
        <h2>Your account</h2>
        <p>
          You sign in with your mobile number and a code sent by SMS. Keep the code to yourself. You
          can delete your account at any time (see the{' '}
          <Link className="link" href="/privacy" prefetch={false}>
            privacy page
          </Link>
          ).
        </p>
        <Placeholder id="terms">
          A plain summary of the service as it works today. The family should approve it, or replace
          it with the shop&apos;s own terms, before launch. It says nothing about GST until the
          family answers that question.
        </Placeholder>
      </div>
    </div>
  );
}
