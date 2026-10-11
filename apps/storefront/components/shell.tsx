'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from './language';
import { useCommerce } from './commerce';

export function Header() {
  const { language, setLanguage, t } = useLanguage();
  const pathname = usePathname();
  const c = useCommerce();
  return (
    <>
      <a className="skip-link" href="#main">
        {t('Skip to content', 'मुख्य सामग्री पर जाएँ')}
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" href="/" prefetch={false} aria-label="Shiv Cement Store — home">
            <span className="brand-stamp" aria-hidden="true">
              शिव
            </span>
            <span>
              <strong>{t('SHIV CEMENT', 'शिव सीमेंट')}</strong>
              <small>{t('STORE · PATNA, BIHAR', 'स्टोर · पटना, बिहार')}</small>
            </span>
          </Link>
          <nav aria-label={t('Main navigation', 'मुख्य नेविगेशन')}>
            <Link href="/" prefetch={false} aria-current={pathname === '/' ? 'page' : undefined}>
              {t('Home', 'होम')}
            </Link>
            <Link
              href="/products"
              aria-current={pathname.startsWith('/products') ? 'page' : undefined}
            >
              {t('Materials', 'सामग्री')}
            </Link>
            <Link href="/quotes">{t('Bulk quotes', 'थोक भाव')}</Link>
            <Link href="/account">{c.user ? t('Account', 'खाता') : t('Sign in', 'साइन इन')}</Link>
            <Link href="/cart" className="header-basket">
              {t('Basket', 'टोकरी')}{' '}
              {/* Re-keying replays a short acknowledgement whenever the line count changes. */}
              <span key={c.lines.length} className={c.lines.length ? 'counted' : undefined}>
                {c.lines.length}
              </span>
            </Link>
          </nav>
          <button
            className="language-button"
            lang={language === 'en' ? 'hi' : 'en'}
            onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')}
          >
            {language === 'en' ? 'हिन्दी' : 'English'}
            <span aria-hidden="true"> ⇄</span>
          </button>
        </div>
      </header>
    </>
  );
}

export function Footer() {
  const { t } = useLanguage();
  const c = useCommerce();
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-sign">
          <span className="brand-stamp" aria-hidden="true">
            शिव
          </span>
          <div>
            <strong>{t('Shiv Cement Store', 'शिव सीमेंट स्टोर')}</strong>
            <p>{t('Building materials · Patna, Bihar', 'निर्माण सामग्री · पटना, बिहार')}</p>
          </div>
        </div>
        <nav aria-label={t('Shop', 'दुकान')}>
          <h2>{t('Shop', 'दुकान')}</h2>
          <Link href="/products">{t('All materials', 'सारी सामग्री')}</Link>
          <Link href="/compare">{t('Compare materials', 'सामग्री की तुलना')}</Link>
          <Link href="/quotes">{t('Bulk quotes', 'थोक भाव')}</Link>
          <Link href="/#delivery" prefetch={false}>
            {t('Check delivery', 'डिलीवरी जाँचें')}
          </Link>
        </nav>
        <nav aria-label={t('Your account', 'आपका खाता')}>
          <h2>{t('Your account', 'आपका खाता')}</h2>
          <Link href="/account">
            {c.user ? t('Account & addresses', 'खाता और पते') : t('Sign in', 'साइन इन')}
          </Link>
          <Link href="/cart">{t('Basket', 'टोकरी')}</Link>
          <Link href="/orders">{t('Orders', 'ऑर्डर')}</Link>
        </nav>
        <div className="footer-terms">
          <h2>{t('How payment works', 'भुगतान कैसे होता है')}</h2>
          <p>
            {t(
              'Basket orders are paid in cash on delivery. Online payment is not offered on this site.',
              'टोकरी के ऑर्डर का भुगतान डिलीवरी पर नकद होता है। इस साइट पर ऑनलाइन भुगतान नहीं है।',
            )}
          </p>
        </div>
      </div>
    </footer>
  );
}
