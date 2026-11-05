'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Skeleton } from '@shiv/design';
import type { Permission } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { useT } from '../../../lib/i18n';
import { useOwner } from '../../../lib/owner';
import { PageHeader } from '../common';
import css from '../owner.module.css';
import { HazriNight } from './night';
import { HazriPhones } from './phones';
import { HazriReviews } from './reviews';
import { HazriSetup } from './setup';
import { HazriToday } from './today';

const tabs: { id: string; key: MessageKey; needs: Permission }[] = [
  { id: 'today', key: 'owner.hazri.tab.today', needs: 'attendance.read' },
  { id: 'reviews', key: 'owner.hazri.tab.reviews', needs: 'attendance.review' },
  { id: 'phones', key: 'owner.hazri.tab.phones', needs: 'device.approve.first' },
  { id: 'night', key: 'owner.hazri.tab.night', needs: 'attendance.read' },
  { id: 'setup', key: 'owner.hazri.tab.setup', needs: 'screen.manage' },
];

export function Hazri() {
  const t = useT();
  return (
    <Suspense fallback={<Skeleton label={t('owner.loading')} />}>
      <HazriPage />
    </Suspense>
  );
}

function HazriPage() {
  const t = useT();
  const { can, shops, shopId, reviewCount } = useOwner();
  const shown = tabs.filter(({ needs }) => can(needs));
  // A link from Today, or from the night's message, opens on its own tab if this person has it.
  const asked = useSearchParams().get('tab');
  const [tab, setTab] = useState(shown.find(({ id }) => id === asked)?.id ?? 'today');
  const mine = shops.filter((shop) => can('attendance.read', shop.id));
  // The shop chosen at the top, or every shop this person looks after, one under another.
  const inView =
    shopId && mine.some((shop) => shop.id === shopId)
      ? mine.filter((shop) => shop.id === shopId)
      : mine;
  return (
    <>
      <PageHeader title={t('owner.hazri.title')} />
      <div className={css.chips} role="tablist" aria-label={t('owner.hazri.title')}>
        {shown.map(({ id, key }) => (
          <Button
            key={id}
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => setTab(id)}
          >
            {t(key)}
            {id === 'reviews' && reviewCount > 0 && ` (${reviewCount})`}
          </Button>
        ))}
      </div>
      {tab === 'today' && <HazriToday shops={inView} />}
      {tab === 'reviews' && <HazriReviews />}
      {tab === 'phones' && <HazriPhones />}
      {tab === 'night' && <HazriNight />}
      {tab === 'setup' && <HazriSetup />}
    </>
  );
}
