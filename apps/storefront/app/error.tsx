'use client';

import Link from 'next/link';
import { useLanguage } from '../components/language';
export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="empty-state" role="alert">
      <h1>{t('This page could not load.', 'यह पेज लोड नहीं हो सका।')}</h1>
      <p>{t('Check your connection, then try again.', 'इंटरनेट जाँचें, फिर कोशिश करें।')}</p>
      <button className="button" onClick={reset}>
        {t('Try again', 'फिर कोशिश करें')}
      </button>
      <Link className="text-link" href="/products">
        {t('Browse materials', 'सामग्री देखें')}
      </Link>
    </div>
  );
}
