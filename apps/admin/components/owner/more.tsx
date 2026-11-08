'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { SearchBox, Section } from '@shiv/design';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { moreRoutes, type MoreView } from '../../lib/nav';
import { useIsWide, useOwner } from '../../lib/owner';
import { groupsWhere } from '../../lib/shell-nav';
import { LookControls } from '../shell/shell';
import { PageHeader } from './common';
import css from './owner.module.css';
import own from '../shell/menu.module.css';

/**
 * The phone's Menu (plan v4 02, section 2): the rail's groups with a search box, the look and
 * language, and sign out. The shop or firm stays in the top bar, so it shows on every page. On a laptop the rail already shows everything, so this
 * address goes to Aaj.
 */
export function More() {
  const t = useT();
  const { canOpen, reviewCount, endSession } = useOwner();
  const router = useRouter();
  const wide = useIsWide();
  const view = useSearchParams().get('view');
  const [query, setQuery] = useState('');
  // Links saved before each of these became a page of its own.
  useEffect(() => {
    if (view && Object.hasOwn(moreRoutes, view)) router.replace(moreRoutes[view as MoreView]);
    else if (wide) router.replace('/today');
  }, [view, wide, router]);
  const groups = useMemo(() => {
    const typed = query.trim().toLowerCase();
    return groupsWhere(canOpen)
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !typed || t(item.key).toLowerCase().includes(typed)),
      }))
      .filter((group) => group.items.length);
  }, [query, canOpen, t]);
  return (
    <>
      <PageHeader title={t('owner.shell.menu')} />
      <div className={own.tools}>
        <SearchBox
          label={t('owner.shell.menuSearch')}
          value={query}
          onChange={setQuery}
          shortcut={false}
        />
        <div className={own.look}>
          <LookControls words />
        </div>
      </div>
      <div className={own.groups}>
        {groups.map((group) => {
          const links = (label: string) => (
            <nav className={`${css.card} ${css.menu}`} aria-label={label}>
              {group.items.map((item) => (
                <Link href={item.href} key={item.href}>
                  <span>
                    {t(item.key)}
                    {item.badge === 'reviews' && reviewCount > 0 && ` (${reviewCount})`}
                  </span>
                  <span aria-hidden="true">→</span>
                </Link>
              ))}
            </nav>
          );
          // Aaj stands alone above the groups, as on the rail.
          if (!group.label) return <div key={group.id}>{links(t('owner.today'))}</div>;
          return (
            <Section key={group.id} title={t(group.label)}>
              {links(t(group.label))}
            </Section>
          );
        })}
      </div>
      <button
        type="button"
        className={own.signOut}
        onClick={() => void api('/auth/logout', 'POST').finally(endSession)}
      >
        {t('owner.logout')}
      </button>
    </>
  );
}
