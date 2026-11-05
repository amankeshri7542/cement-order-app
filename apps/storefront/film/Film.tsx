import Link from 'next/link';
import { plates } from '../art';
import { geometry } from '../art/geometry';
import { Chooser, AddButton } from '../components/rates';
import {
  freshness,
  groupByMaterial,
  rateText,
  unitWords,
  type MaterialGroup,
} from '../lib/catalog';
import type { Catalog } from '../lib/types';
import { FilmLoader } from './FilmLoader';
import { stages } from './stages';
import s from './film.module.css';

const src = (name: keyof typeof plates) => plates[name].src;
const pair = (name: string) => ({
  'data-src-d': src(`${name}-d` as keyof typeof plates),
  'data-src-m': src(`${name}-m` as keyof typeof plates),
});

function StageRow({ group, sample }: { group: MaterialGroup; sample: boolean }) {
  const lowest = group.lowest;
  const first = group.products[0];
  return (
    <div className={s.row}>
      <span className={s.rowName}>{group.name}</span>
      <span className={s.rowRate}>
        {lowest ? (
          <>
            {group.from ? <small>from </small> : null}
            <b>{rateText(lowest)}</b> <small>{unitWords(lowest.unit).short}</small>
            {sample ? <span className="sr"> (sample rate)</span> : null}
          </>
        ) : (
          <small>Ask for the rate</small>
        )}
      </span>
      {group.products.length === 1 && first?.availability === 'IN_STOCK' ? (
        <AddButton product={first} label={group.name} />
      ) : group.products.length > 1 ? (
        <Link
          className="add"
          href={`/materials/${group.slug}`}
          prefetch={false}
          data-choose={group.slug}
          aria-label={`Add ${group.name} to your list`}
        >
          Add
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}

/** Every word and rate is in this markup. The engine only moves it; with no engine it is a page. */
export function Film({
  catalog,
  whatsappHref,
  fallbackHref,
  fallbackLabel,
}: {
  catalog: Catalog | null;
  whatsappHref: string;
  fallbackHref: string;
  fallbackLabel: string;
}) {
  const groups = catalog ? groupByMaterial(catalog) : [];
  const sample = catalog?.sampleRates ?? false;
  const bySlug = new Map(groups.map((group) => [group.slug, group]));
  const bar = ['cement', 'sariya', 'bricks', 'balu']
    .map((slug) => bySlug.get(slug))
    .filter((group): group is MaterialGroup => Boolean(group?.lowest));
  const fresh = catalog ? freshness(catalog.products) : { today: false, text: '' };
  const { desktop, phone } = geometry;
  const panVars = (pan: { left: number; top: number; width: number; height: number }) => ({
    '--pan-l': `${pan.left * 100}%`,
    '--pan-t': `${pan.top * 100}%`,
    '--pan-w': `${pan.width * 100}%`,
    '--pan-h': `${pan.height * 100}%`,
  });
  return (
    <section
      className={s.film}
      data-film-root
      aria-label="A home, from the first bori to the first evening"
    >
      {/* The hero plate is the largest thing on the first screen, so it loads first. */}
      <link
        rel="preload"
        as="image"
        href={src('hero-d')}
        type="image/avif"
        media="(min-width: 900px)"
        fetchPriority="high"
      />
      <link
        rel="preload"
        as="image"
        href={src('hero-m')}
        type="image/avif"
        media="(max-width: 899px)"
        fetchPriority="high"
      />
      <div className={s.stage} data-stage>
        <div className={s.dusk} data-dusk aria-hidden="true" />
        <div className={`${s.filmOnly} ${s.cloudsBack}`} data-clouds-back aria-hidden="true">
          <img alt="" data-src-d={src('clouds-back-d')} width={2246} height={1350} />
        </div>
        <div className={`${s.filmOnly} ${s.camera}`} data-camera aria-hidden="true">
          <div className={s.storyBox} data-story-box>
            {stages.map((stage, index) => (
              <div
                className={s.plate}
                data-plate={index}
                data-night={stage.night ? '' : undefined}
                key={stage.key}
              >
                <img
                  alt=""
                  width={desktop.story.width}
                  height={desktop.story.height}
                  {...pair(index === 5 ? 'home-dusk' : `s${index + 1}`)}
                />
              </div>
            ))}
            <div className={s.slices} data-slices>
              {[0, 1, 2, 3, 4, 5].map((slice) => (
                <div className={s.slice} data-slice={slice} key={slice}>
                  <img alt="" {...pair('home-lit')} />
                </div>
              ))}
            </div>
            <div className={s.thread} data-thread />
          </div>
          <div className={s.tractor} data-tractor>
            <img
              alt=""
              data-src-d={src('tractor')}
              data-src-m={src('tractor')}
              width={860}
              height={430}
            />
          </div>
        </div>

        <div className={s.heroBlock} data-hero-block>
          <div className={s.heroCopy} data-hero-copy>
            <h1>
              <span className={s.line}>
                <span style={{ '--i': 0 } as React.CSSProperties}>A home goes up</span>
              </span>{' '}
              <span className={s.line}>
                <span style={{ '--i': 1 } as React.CSSProperties}>one bori at a time.</span>
              </span>
            </h1>
            <p>
              Cement, sariya, bricks, balu and gitti from a family shop in Patna, with{' '}
              {fresh.today ? 'today’s rate' : 'the rate'} beside every item.
            </p>
            <div className={s.heroActions}>
              <a className="btn btn-solid" href="#rates">
                {fresh.today ? 'See today’s rates' : 'See the rates'}
              </a>
              {whatsappHref ? (
                <a
                  className="btn btn-line"
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Order on WhatsApp
                </a>
              ) : (
                <Link className="btn btn-line" href={fallbackHref} prefetch={false}>
                  {fallbackLabel}
                </Link>
              )}
            </div>
          </div>
          <div className={s.heroArt} data-hero-plate>
            <div
              className={s.heroInner}
              data-pan-vars-d={JSON.stringify(panVars(desktop.pan))}
              data-pan-vars-m={JSON.stringify(panVars(phone.pan))}
            >
              <picture>
                <source media="(min-width: 900px)" srcSet={src('hero-d')} type="image/avif" />
                <img
                  src={src('hero-m')}
                  width={780}
                  height={1092}
                  alt="A family home under construction: brick below, an open frame above, bamboo scaffolding and a rope hoist"
                  fetchPriority="high"
                  decoding="async"
                />
              </picture>
              <div className={`${s.filmOnly} ${s.panTrack}`} data-pan-track aria-hidden="true">
                <img alt="" data-src-d={src('pan-d')} data-src-m={src('pan-m')} data-pan />
              </div>
            </div>
          </div>
          <div className={s.ratebar} data-ratebar>
            <span className={s.ratebarTag}>
              {sample ? 'Sample rates' : fresh.today ? 'Today’s rates' : fresh.text || 'Rates'}
            </span>
            {bar.length ? (
              <ul>
                {bar.map((group) => (
                  <li key={group.slug}>
                    <b>{group.name.split(' ')[0]}</b>{' '}
                    <span className="num">{rateText(group.lowest!)}</span>
                    <span className={s.unitLong}> {unitWords(group.lowest!.unit).short}</span>
                    <span className={s.unitShort}>/{unitWords(group.lowest!.unit).slash}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.ratebarNone}>Rate not available right now.</p>
            )}
            <a href="#rates">All rates</a>
          </div>
        </div>

        <div className={s.clouds} data-clouds-front aria-hidden="true">
          <img
            className={s.cloudsTop}
            alt=""
            data-src-d={src('clouds-top-d')}
            data-src-m={src('clouds-top-m')}
          />
          <div className={`${s.filmOnly} ${s.cloudsSolid}`} data-clouds-solid />
          <img
            className={`${s.filmOnly} ${s.cloudsUnder}`}
            alt=""
            data-clouds-under
            data-src-d={src('clouds-under-d')}
            data-src-m={src('clouds-under-m')}
          />
        </div>
        <div className={`${s.filmOnly} ${s.cameraTop}`} data-camera2 aria-hidden="true">
          <div className={s.storyBox}>
            <img
              className={s.ghost}
              alt=""
              data-ghost
              {...pair('naksha')}
              width={desktop.story.width}
              height={desktop.story.height}
            />
          </div>
        </div>

        <h2 className={s.interlude} data-interlude>
          Every home starts <span className={s.brk}>as a naksha.</span>
        </h2>
        <ol className={s.story} data-story>
          {stages.map((stage, index) => {
            const rows = stage.materials
              .map((slug) => bySlug.get(slug))
              .filter((group): group is MaterialGroup => Boolean(group));
            return (
              <li
                className={`${s.panel}${stage.night ? ` ${s.onNight} on-night` : ''}`}
                data-panel={index}
                key={stage.key}
              >
                <div className={s.panelArt} aria-hidden="true">
                  {/* Hidden in film tiers, so these are fetched only by the still page. */}
                  <picture>
                    <source
                      media="(min-width: 900px)"
                      srcSet={src(
                        index === 5 ? 'home-lit-d' : (`s${index + 1}-d` as keyof typeof plates),
                      )}
                      type="image/avif"
                    />
                    <img
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={phone.story.width}
                      height={phone.story.height}
                      src={src(
                        index === 5 ? 'home-lit-m' : (`s${index + 1}-m` as keyof typeof plates),
                      )}
                    />
                  </picture>
                  {index < 4 ? (
                    <picture>
                      <source
                        media="(min-width: 900px)"
                        srcSet={src('naksha-d')}
                        type="image/avif"
                      />
                      <img
                        className={s.panelPlan}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={phone.story.width}
                        height={phone.story.height}
                        src={src('naksha-m')}
                      />
                    </picture>
                  ) : null}
                </div>
                <div className={s.panelWords}>
                  <h2>{stage.title}</h2>
                  <p>{stage.words}</p>
                  {rows.length ? (
                    <div className={s.rows}>
                      {rows.map((group) => (
                        <StageRow group={group} sample={sample} key={group.slug} />
                      ))}
                    </div>
                  ) : (
                    <p className={s.note}>
                      <Link className="link" href="/rates" prefetch={false}>
                        See the rates
                      </Link>
                    </p>
                  )}
                  <p className={s.note}>
                    {sample ? 'Sample rates. ' : ''}
                    <span className={s.noteMore}>
                      How much you need comes from your engineer&apos;s drawing.
                    </span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        <div
          className={`${s.filmOnly} ${s.rail}`}
          data-rail
          role="group"
          aria-label="Stages of the house"
        >
          {stages.map((stage, index) => (
            <button type="button" data-go={index} aria-label={stage.key} key={stage.key}>
              <span>{stage.key}</span>
              <i />
            </button>
          ))}
        </div>
      </div>
      {groups
        .filter((group) => group.products.length > 1)
        .map((group) => (
          <Chooser group={group} sample={sample} key={group.slug} />
        ))}
      <FilmLoader />
    </section>
  );
}
