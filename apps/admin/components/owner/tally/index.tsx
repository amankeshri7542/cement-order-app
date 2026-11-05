'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@shiv/design';
import type { MessageKey } from '@shiv/i18n';
import { useT } from '../../../lib/i18n';
import { useOwner } from '../../../lib/owner';
import { PageHeader } from '../common';
import { NotYourPage } from '../not-your-page';
import css from '../owner.module.css';
import { Farq } from './farq';
import { Haal } from './haal';
import { PartyJodo } from './parties';
import tally from './tally.module.css';

const tabs: { id: string; word: MessageKey; Body: () => React.ReactNode; numbers: boolean }[] = [
  { id: 'haal', word: 'owner.tally.tab.haal', Body: Haal, numbers: false },
  { id: 'party', word: 'owner.tally.tab.party', Body: PartyJodo, numbers: true },
  { id: 'farq', word: 'owner.tally.tab.farq', Body: Farq, numbers: true },
];

/** The owner and the accountant see all of it. The technical operator sees the PCs, with no money. */
export function TallyPage() {
  const t = useT();
  const { can } = useOwner();
  const router = useRouter();
  const asked = useSearchParams().get('tab');
  if (!can('tally.read') && !can('tally.health')) return <NotYourPage />;
  const allowed = tabs.filter((tab) => !tab.numbers || can('tally.numbers.view'));
  const current = allowed.find((tab) => tab.id === asked) ?? allowed[0]!;
  const { Body } = current;
  return (
    <div className={tally.page}>
      <PageHeader title={t('owner.tally.nav')} sub={t('owner.tally.sub')} />
      {allowed.length > 1 && (
        <div className={css.tabs} role="tablist" aria-label={t('owner.tally.tabs')}>
          {allowed.map((tab) => (
            <Button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={tab.id === current.id}
              variant={tab.id === current.id ? 'primary' : 'secondary'}
              onClick={() => router.replace(`/tally?tab=${tab.id}`)}
            >
              {t(tab.word)}
            </Button>
          ))}
        </div>
      )}
      <Body />
    </div>
  );
}
