'use client';
import { useEffect } from 'react';
import { LanguageProvider, useLanguage } from '../lib/i18n';

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
  const { language, setLanguage, t } = useLanguage();
  return (
    <div className="loading-page" role="alert">
      <span className="stamp" aria-hidden="true">
        शिव
      </span>
      <h1>{t('Something went wrong', 'कुछ गड़बड़ हो गई')}</h1>
      <p>
        {t(
          'The store desk could not show this screen. Your saved work is safe.',
          'दुकान डेस्क यह स्क्रीन नहीं दिखा सका। सहेजा हुआ काम सुरक्षित है।',
        )}
      </p>
      <button className="primary" onClick={retry}>
        {t('Try again', 'फिर कोशिश करें')}
      </button>
      <button className="secondary" onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}>
        {language === 'hi' ? 'English' : 'हिन्दी'}
      </button>
    </div>
  );
}
