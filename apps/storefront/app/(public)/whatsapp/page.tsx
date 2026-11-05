import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageStyles as s, PageHead } from '../../../components/page';
import { Placeholder } from '../../../components/review';
import { readClientConfig, readShop, whatsappNumber } from '../../../lib/public-data';
import { contentReview } from '../../../lib/review';
import { pageMeta } from '../../../lib/seo';
import { indexingOn } from '../../../lib/site';
import { waLink } from '../../../lib/whatsapp';

export async function generateMetadata(): Promise<Metadata> {
  const shop = await readShop();
  return {
    ...pageMeta(
      '/whatsapp',
      'Order on WhatsApp',
      'Send your list to Shiv Cement Store on WhatsApp. A person at the shop reads it and confirms.',
    ),
    robots:
      indexingOn && whatsappNumber(shop)
        ? { index: true, follow: true }
        : { index: false, follow: false },
  };
}

export default async function WhatsAppPage() {
  const [shop, config] = await Promise.all([readShop(), readClientConfig()]);
  const number = whatsappNumber(shop);
  // Everything about WhatsApp is hidden until the family approves the number.
  if (!number && !contentReview) notFound();
  return (
    <div className={s.page}>
      <PageHead
        title="Order on WhatsApp. A person confirms it."
        lead="Send it the way you already do: a line of text or your whole list."
      >
        <p className={s.actions}>
          <a
            className="btn btn-lamp"
            href={waLink(number)}
            data-wa-list={waLink(number)}
            target="_blank"
            rel="noopener noreferrer"
            suppressHydrationWarning
          >
            <span data-wa-count="Open WhatsApp" suppressHydrationWarning>
              Open WhatsApp
            </span>
          </a>
          <Link className="btn btn-line" href="/rates" prefetch={false}>
            See the rates first
          </Link>
        </p>
      </PageHead>
      {!number ? (
        <div style={{ marginTop: '1rem', maxWidth: '44rem' }}>
          <Placeholder id="whatsapp-number">
            WhatsApp number not approved yet, so this button opens WhatsApp with no number, and
            customers do not see this page. Set the number in{' '}
            <code>apps/api/src/public-content.ts</code>.
          </Placeholder>
        </div>
      ) : null}
      <section className={`${s.sectionBand} ${s.prose}`}>
        <h2>What happens next</h2>
        <p>
          {config.whatsappDeskLive
            ? 'A computer program reads your message and prepares it for the shop. Nothing is confirmed until a person at the shop says yes.'
            : 'A person at the shop reads it and confirms. Nothing is confirmed until someone at the shop says yes.'}
        </p>
        <p>
          The message goes to the shop as you wrote it, with no rates in it. The shop tells you the
          final rate.
        </p>
      </section>
    </div>
  );
}
