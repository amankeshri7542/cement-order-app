import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageStyles as s, PageHead } from '../../../../components/page';
import { Placeholder } from '../../../../components/review';
import { checkedMonth } from '../../../../lib/ask-words';
import { draftPage } from '../../../../lib/guide-drafts';
import { readClientConfig, readGuidePage } from '../../../../lib/public-data';
import { pageMeta } from '../../../../lib/seo';
import { indexingOn } from '../../../../lib/site';

type Props = { params: Promise<{ slug: string }> };
const findPage = async (slug: string) => (await readGuidePage(slug)) ?? draftPage(slug);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await findPage(slug);
  if (!page) return { title: 'The guide', robots: { index: false } };
  return {
    ...pageMeta(`/guide/${page.slug}`, page.title, page.summary),
    robots:
      indexingOn && !page.draft ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export default async function GuideArticle({ params }: Props) {
  const { slug } = await params;
  const [page, config] = await Promise.all([findPage(slug), readClientConfig()]);
  if (!page) notFound();
  return (
    <div className={s.page}>
      <PageHead
        title={page.title}
        lead={page.summary}
        crumbs={[{ href: '/guide', label: 'The guide' }, { label: page.title }]}
      >
        {page.checkedOn ? (
          <p className={s.meta}>
            Checked by a civil engineer, {checkedMonth(page.checkedOn)}. General guide, not advice
            on your house.
          </p>
        ) : null}
      </PageHead>
      {page.draft ? (
        <div style={{ marginTop: '1rem', maxWidth: '44rem' }}>
          <Placeholder id="guide-draft-article">
            A draft, not yet signed by an engineer. Customers cannot open this page.
          </Placeholder>
        </div>
      ) : null}
      <article className={s.prose} style={{ marginTop: '1.5rem' }}>
        {page.sections.map((section) => (
          <section key={section.id} id={section.id}>
            <h2>{section.heading}</h2>
            {section.blocks.map((block, index) => (
              <p key={index} style={{ marginTop: '0.75rem' }}>
                {block}
              </p>
            ))}
          </section>
        ))}
        {page.standardsMentioned.length ? (
          <p className={s.meta}>Standards named: {page.standardsMentioned.join(', ')}.</p>
        ) : null}
      </article>
      {config.askEnabled && page.relatedQuestions.length ? (
        <section className={s.sectionBand}>
          <h2>Related questions</h2>
          <p className={s.actions}>
            {page.relatedQuestions.map((question) => (
              <Link
                className="btn btn-quiet"
                href={`/ask?q=${encodeURIComponent(question)}`}
                data-ask
                data-ask-send
                data-ask-seed={question}
                key={question}
                prefetch={false}
              >
                {question}
              </Link>
            ))}
          </p>
        </section>
      ) : null}
      <p className={s.actions}>
        <Link className="btn btn-line" href="/guide" prefetch={false}>
          All of the guide
        </Link>
      </p>
    </div>
  );
}
