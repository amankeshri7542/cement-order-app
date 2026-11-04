'use client';
import { useEffect } from 'react';
import { LanguageProvider, useLanguage, useT } from '../lib/i18n';

// The desk's last line of defence: one malformed reply must not leave staff with a blank page.
// The page's language provider is inside the failed page, so this screen brings its own.
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <LanguageProvider>
      <Recovery retry={reset} />
    </LanguageProvider>
  );
}

function Recovery({ retry }: { retry: () => void }) {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  return (
    <div className="loading-page" role="alert">
      <h1>{t('owner.errorPage.title')}</h1>
      <p>{t('owner.errorPage.body')}</p>
      <button className="primary" onClick={retry}>
        {t('owner.retry')}
      </button>
      <button className="secondary" onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}>
        {language === 'hi' ? 'English' : 'Hinglish'}
      </button>
    </div>
  );
}
