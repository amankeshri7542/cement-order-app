'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useT } from '../../lib/i18n';
import { moreRoutes, type MoreView } from '../../lib/nav';
import { deskLinks, useOwner } from '../../lib/owner';
import { PageHeader } from './common';
import css from './owner.module.css';

/** Everything that has no tab on a phone, as large rows. */
export function More() {
  const t = useT();
  const { canOpen, reviewCount } = useOwner();
  const router = useRouter();
  const view = useSearchParams().get('view');
  // Links saved before each of these became a page of its own.
  useEffect(() => {
    if (view && Object.hasOwn(moreRoutes, view)) router.replace(moreRoutes[view as MoreView]);
  }, [view, router]);
  return (
    <>
      <PageHeader title={t('owner.more')} />
      <nav className={`${css.card} ${css.menu}`} aria-label={t('owner.more')}>
        {deskLinks
          .filter(({ href, tab }) => !tab && canOpen(href))
          .map(({ href, key }) => (
            <Link href={href} key={href}>
              <span>
                {t(key)}
                {href === '/hazri' && reviewCount > 0 && ` (${reviewCount})`}
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
      </nav>
    </>
  );
}
