import type { Metadata } from 'next';
import Link from 'next/link';
import { pageStyles as s, PageHead } from '../../../components/page';
import { Placeholder } from '../../../components/review';
import { draftList } from '../../../lib/guide-drafts';
import { checkedMonth } from '../../../lib/ask-words';
import { readClientConfig, readGuide } from '../../../lib/public-data';
import { pageMeta } from '../../../lib/seo';
import { indexingOn } from '../../../lib/site';
import g from './guide.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const guide = await readGuide();
  return {
    ...pageMeta(
      '/guide',
      'The guide: buying materials for your home',
      'What comes when, how each material is sold and what to check when it arrives, in plain words.',
    ),
    // An empty page has nothing for a search engine.
    robots:
      indexingOn && guide.length ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export default async function GuidePage() {
  const [signed, config] = await Promise.all([readGuide(), readClientConfig()]);
  const drafts = signed.length ? [] : draftList();
  const items = signed.length ? signed : drafts;
  return (
    <div className={s.page}>
      <PageHead
        title="The guide"
        lead="What comes when, how materials are sold and what to check when they arrive. Who decides what: your engineer, your mistri and you."
      />
      {items.length ? (
        <ul className={g.list}>
          {items.map((item) => (
            <li key={item.slug}>
              <Link href={`/guide/${item.slug}`} prefetch={false}>
                <span className={g.title}>{item.title}</span>
                <span className={g.summary}>{item.summary}</span>
                {item.checkedOn ? (
                  <span className={g.checked}>
                    Checked by a civil engineer, {checkedMonth(item.checkedOn)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className={s.state}>
          <h2>The guide is being checked.</h2>
          <p>
            A civil engineer reads every article before it appears here. Until then, each
            material&apos;s page says how it is sold and what to check when it arrives.
          </p>
          <p className={s.actions}>
            <Link className="btn btn-solid" href="/materials" prefetch={false}>
              All materials
            </Link>
            <Link className="btn btn-line" href="/contact" prefetch={false}>
              Ask the shop
            </Link>
          </p>
        </div>
      )}
      {drafts.length ? (
        <div style={{ marginTop: '1.5rem', maxWidth: '44rem' }}>
          <Placeholder id="guide-drafts">
            These are drafts from <code>content/advisor/</code>, none signed yet. Customers see the
            message that the guide is being checked until an engineer signs them.
          </Placeholder>
        </div>
      ) : null}
      {!config.askEnabled && !items.length ? null : null}
    </div>
  );
}
