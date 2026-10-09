'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from './language';

export function Header() {
  const { language, setLanguage, t } = useLanguage();
  const pathname = usePathname();
  return (
    <>
      <a className="skip-link" href="#main">
        {t('Skip to content', 'मुख्य सामग्री पर जाएँ')}
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" href="/" aria-label="Shiv Cement Store — home">
            <span className="brand-stamp" aria-hidden="true">
              शिव
            </span>
            <span>
              <strong>{t('SHIV CEMENT', 'शिव सीमेंट')}</strong>
              <small>{t('STORE · PATNA, BIHAR', 'स्टोर · पटना, बिहार')}</small>
            </span>
          </Link>
          <nav aria-label={t('Main navigation', 'मुख्य नेविगेशन')}>
            <Link href="/" aria-current={pathname === '/' ? 'page' : undefined}>
              {t('Home', 'होम')}
            </Link>
            <Link
              href="/products"
              aria-current={pathname.startsWith('/products') ? 'page' : undefined}
            >
              {t('Materials', 'सामग्री')}
            </Link>
            <Link href="/#delivery">{t('Delivery', 'डिलीवरी')}</Link>
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
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <strong>{t('Shiv Cement Store', 'शिव सीमेंट स्टोर')}</strong>
          <p>{t('Building materials · Patna, Bihar', 'निर्माण सामग्री · पटना, बिहार')}</p>
        </div>
        <p>
          {t(
            'Browse materials and plan your purchase. Online ordering is not available on this website yet.',
            'सामग्री देखें और खरीदारी की तैयारी करें। इस वेबसाइट पर अभी ऑनलाइन ऑर्डर उपलब्ध नहीं है।',
          )}
        </p>
        <Link href="/products">
          {t('Browse materials', 'सामग्री देखें')} <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </footer>
  );
}
