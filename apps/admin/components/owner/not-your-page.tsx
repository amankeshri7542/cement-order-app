'use client';
import Link from 'next/link';
import { useT } from '../../lib/i18n';
import css from './owner.module.css';

/** The polite note for a page this person's job does not include. The API refuses it regardless. */
export function NotYourPage() {
  const t = useT();
  return (
    <section className={css.card}>
      <h1>{t('owner.notYourPage')}</h1>
      <p>{t('owner.notYourPageBody')}</p>
      <Link className={css.inlineLink} href="/more">
        {t('owner.back')}
      </Link>
    </section>
  );
}
