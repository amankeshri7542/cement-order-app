import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AskInline } from '../../../components/ask-launcher';
import { pageStyles as s, PageHead } from '../../../components/page';
import { Placeholder } from '../../../components/review';
import { readClientConfig, readGuide } from '../../../lib/public-data';
import { contentReview } from '../../../lib/review';
import { pageMeta } from '../../../lib/seo';
import { indexingOn } from '../../../lib/site';

type Props = {
  searchParams: Promise<{
    about?: string | string[];
    q?: string | string[];
    product?: string | string[];
  }>;
};
const one = (value?: string | string[]) =>
  ((Array.isArray(value) ? value[0] : value) ?? '').slice(0, 600);

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const [config, params] = await Promise.all([readClientConfig(), searchParams]);
  return {
    ...pageMeta(
      '/ask',
      'Ask about building your home',
      'Plain answers about materials and building, from a guide a civil engineer has checked.',
    ),
    robots:
      indexingOn && config.askEnabled && !one(params.q) && !one(params.about)
        ? { index: true, follow: true }
        : { index: false, follow: false },
  };
}

export default async function AskPage({ searchParams }: Props) {
  const [config, params, guide] = await Promise.all([
    readClientConfig(),
    searchParams,
    readGuide(),
  ]);
  // Ask stays hidden until the advisor has passed its safety test on this server.
  if (!config.askEnabled && !contentReview) notFound();
  const about = one(params.about);
  const seed = one(params.q) || (about ? `About ${about}: ` : '');
  const product = one(params.product);
  return (
    <div className={s.page}>
      <div className={s.split}>
        <PageHead
          title="Not sure about something? Ask."
          lead="Any doubt about building your home, in plain words. Rates come from the shop's list, sums from tested code, and anything structural goes to a qualified engineer."
        >
          <p className={s.meta}>
            <Link className="link" href="/guide" prefetch={false}>
              Read the guide instead
            </Link>
          </p>
        </PageHead>
        <div>
          {!config.askEnabled ? (
            <div style={{ marginBottom: '1rem' }}>
              <Placeholder id="ask-off">
                Ask is switched off on this server (askEnabled is false), so customers see no Ask
                link and this page does not exist for them. It needs a passed safety test and signed
                articles first.
              </Placeholder>
            </div>
          ) : null}
          <noscript>
            <p>
              Ask needs JavaScript.{' '}
              <Link className="link" href="/guide">
                The guide
              </Link>{' '}
              has the same checked answers.
            </p>
          </noscript>
          <div data-needs-js>
            <AskInline
              seed={seed}
              productId={/^[A-Za-z0-9_-]{1,100}$/.test(product) ? product : undefined}
            />
          </div>
          {guide.length ? (
            <section className={s.sectionBand}>
              <h2>From the guide</h2>
              <ul style={{ marginTop: '0.5rem' }}>
                {guide.slice(0, 5).map((item) => (
                  <li key={item.slug}>
                    <Link className="link" href={`/guide/${item.slug}`} prefetch={false}>
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
