import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AwardsBand } from '../../../components/awards';
import { awardsLive } from '../../../lib/awards';
import { contentReview } from '../../../lib/review';
import { pageMeta } from '../../../lib/seo';
import { indexingOn } from '../../../lib/site';

export const metadata: Metadata = {
  ...pageMeta(
    '/awards',
    'Awards',
    'The certificates brands have given Shiv Cement Store, as the brands wrote them.',
  ),
  robots:
    indexingOn && awardsLive() ? { index: true, follow: true } : { index: false, follow: false },
};

export default function AwardsPage() {
  // Hidden until real: no certificate photo means no page at all for customers.
  if (!awardsLive() && !contentReview) notFound();
  return (
    <div data-page-night>
      <AwardsBand heading="h1" more={false} />
    </div>
  );
}
