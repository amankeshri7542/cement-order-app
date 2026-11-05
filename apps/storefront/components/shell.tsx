import Link from 'next/link';
import { awardsLive } from '../lib/awards';
import { playUrl } from '../lib/play';
import { whatsappNumber } from '../lib/public-data';
import { contentReview } from '../lib/review';
import { shortName, siteName } from '../lib/site';
import type { ClientConfig, ShopFacts } from '../lib/types';
import { waLink, waText } from '../lib/whatsapp';
import { Mark } from './mark';
import { Placeholder } from './review';
import s from './shell.module.css';

type Item = { href: string; label: string };
/** The one list of top-level pages. Things not live yet are simply absent, in every build. */
function mainLinks(shop: ShopFacts, config: ClientConfig): Item[] {
  return [
    { href: '/rates', label: 'Rates' },
    { href: '/materials', label: 'Materials' },
    config.askEnabled ? { href: '/ask', label: 'Ask' } : { href: '/guide', label: 'Guide' },
    ...(whatsappNumber(shop) || contentReview ? [{ href: '/whatsapp', label: 'WhatsApp' }] : []),
    { href: '/about', label: 'The shop' },
  ];
}

export function Header({ shop, config }: { shop: ShopFacts; config: ClientConfig }) {
  const links = mainLinks(shop, config);
  return (
    <>
      <span className={s.thread} aria-hidden="true" />
      <header className={s.nav} data-site-nav>
        <Link className={s.word} href="/" aria-label={`${siteName}, home`} prefetch={false}>
          <Mark className={s.mark} />
          {shortName}
        </Link>
        <nav className={s.links} aria-label="Main" data-nav-links>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              prefetch={false}
              {...(link.href === '/ask' ? { 'data-ask': '' } : {})}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className={s.right}>
          <Link className={s.list} href="/list" prefetch={false}>
            Your list
            <span className={s.count}>
              <span data-list-count suppressHydrationWarning>
                0
              </span>
              <span className="sr"> lines</span>
            </span>
          </Link>
          <details className={s.menu} data-menu>
            <summary>Menu</summary>
            <nav className={s.sheet} aria-label="Menu">
              {links.map((link) => (
                <Link key={link.href} href={link.href} prefetch={false}>
                  {link.label}
                </Link>
              ))}
              {config.askEnabled ? (
                <Link className={s.quiet} href="/guide" prefetch={false}>
                  Guide
                </Link>
              ) : null}
              <Link className={s.quiet} href="/delivery" prefetch={false}>
                Delivery
              </Link>
              <Link className={s.quiet} href="/orders" prefetch={false}>
                My orders
              </Link>
              <Link className={s.quiet} href="/account" prefetch={false}>
                Sign in or account
              </Link>
            </nav>
          </details>
        </div>
      </header>
    </>
  );
}

export function Footer({ shop, config }: { shop: ShopFacts; config: ClientConfig }) {
  const whatsapp = whatsappNumber(shop);
  return (
    <footer className={s.foot}>
      <p className={s.name} aria-hidden="true">
        {shortName}
        <Mark className={s.nameMark} />
      </p>
      <div className={s.grid}>
        <div>
          <h2>Buy</h2>
          <Link href="/rates" prefetch={false}>
            Today&apos;s rates
          </Link>
          <Link href="/materials" prefetch={false}>
            Materials
          </Link>
          <Link href="/list" prefetch={false}>
            Your list
          </Link>
          <Link href="/delivery" prefetch={false}>
            Delivery
          </Link>
          {whatsapp ? (
            <a href={waLink(whatsapp, waText.order())} rel="noopener noreferrer" target="_blank">
              Order on WhatsApp
            </a>
          ) : null}
        </div>
        <div>
          <h2>Learn</h2>
          <Link href="/guide" prefetch={false}>
            The guide
          </Link>
          {config.askEnabled ? (
            <Link href="/ask" prefetch={false}>
              Ask about your home
            </Link>
          ) : null}
          <Link href="/about" prefetch={false}>
            The shop
          </Link>
          {awardsLive() || contentReview ? (
            <Link href="/awards" prefetch={false}>
              Awards
            </Link>
          ) : null}
          <Link href="/contact" prefetch={false}>
            Contact and complaints
          </Link>
        </div>
        <div>
          <h2>Your account</h2>
          <Link href="/account" prefetch={false}>
            Sign in or account
          </Link>
          <Link href="/orders" prefetch={false}>
            My orders
          </Link>
          <Link href="/quotes" prefetch={false}>
            Rates you asked for
          </Link>
          {playUrl ? (
            <a href={playUrl} rel="noopener noreferrer" target="_blank">
              Get the app on Google Play
            </a>
          ) : null}
          <Link href="/delete-account" prefetch={false}>
            Delete account
          </Link>
        </div>
        <div>
          <h2>{shop.firm?.legalName || siteName}</h2>
          {shop.address ? <p>{shop.address}</p> : <p>{shop.city}</p>}
          <Link href="/privacy" prefetch={false}>
            Privacy
          </Link>
          <Link href="/terms" prefetch={false}>
            Terms
          </Link>
        </div>
      </div>
      <Placeholder id="legal-name">
        Legal name, address of every branch, complaint officer and GST line go here once approved
        (Firm.approvedAt and contactApproved). Plan 03 section 4.6 lists what the law asks for.
      </Placeholder>
      <p className={s.end}>
        Rates are for the unit written beside them. An order is confirmed only when a person at the
        shop confirms it.
      </p>
    </footer>
  );
}
