'use client';

import { useLanguage } from '../components/language';
export default function Loading() {
  const { t } = useLanguage();
  return (
    <div className="loading-state" role="status">
      <span className="loading-bar" />
      {t('Loading materials…', 'सामग्री लोड हो रही है…')}
    </div>
  );
}
