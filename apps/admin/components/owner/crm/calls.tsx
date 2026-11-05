'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, MoneyText } from '@shiv/design';
import { dayLabel, money } from '@shiv/shared';
import { api, download } from '../../../lib/api';
import { useLanguage, useT, useWords } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { MoreRows, PageHeader, Problem, QueryStatus, usePaged } from '../common';
import css from '../owner.module.css';
import own from './crm.module.css';
import { AssignSheet, callKeys, kindWord, SnoozeSheet } from './follow-up';
import { YaadDilao } from './reminder';
import type { Call, CallList } from './types';

const enc = encodeURIComponent;

function PromiseTag({ call }: { call: Call }) {
  const t = useT();
  if (!call.promise) return null;
  if (call.promise === 'BROKEN')
    return <span className={`${own.tag} ${own.tagBad}`}>{t('owner.crm.promise.broken')}</span>;
  if (call.promise === 'KEPT')
    return <span className={`${own.tag} ${own.tagGood}`}>{t('owner.crm.promise.kept')}</span>;
  return <span className={own.tag}>{t('owner.crm.promise.open')}</span>;
}

/** One call. Everything a person needs to ring, and to say what happened. */
function CallCard({ call, showShop }: { call: Call; showShop: boolean }) {
  const t = useT();
  const words = useWords();
  const { can } = useOwner();
  const { language } = useLanguage();
  const [sheet, setSheet] = useState<'later' | 'give' | null>(null);
  const key = useRef(crypto.randomUUID());
  const done = useAction(async () => {
    await api(`/admin/followups/${call.id}`, 'PATCH', {
      action: 'DONE',
      idempotencyKey: key.current,
    });
  }, callKeys);
  const writes = can('crm.followups', call.locationId);
  return (
    <article className={css.card}>
      <div className={own.spread}>
        <div>
          <Link href={`/customers/${call.customer.id}`} className={own.name}>
            {call.customer.name || call.customer.phoneMasked}
          </Link>
          <p className={own.quiet}>
            {[call.customer.phone ?? call.customer.phoneMasked, call.customer.area]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {call.balancePaise !== null && <MoneyText value={call.balancePaise} signed />}
      </div>
      <div className={own.row}>
        <span className={own.tag}>{t(kindWord[call.kind])}</span>
        <PromiseTag call={call} />
        {call.doneAt ? (
          <span className={`${own.tag} ${own.tagGood}`}>{t('owner.crm.done')}</span>
        ) : call.overdueDays > 0 ? (
          <span className={`${own.tag} ${own.tagLook}`}>
            {t('owner.crm.overdue', { days: call.overdueDays })}
          </span>
        ) : (
          <span className={own.tag}>{dayLabel(call.dueOn, language)}</span>
        )}
        {!call.signedOff && <span className={own.tag}>{t('owner.crm.block.notSigned')}</span>}
      </div>
      {call.promisedPaise !== null && (
        <p className={own.quiet}>
          {t('owner.crm.promisedLine', {
            amount: money(call.promisedPaise),
            day: dayLabel(call.dueOn, language),
          })}
          {(call.paidSincePaise ?? 0) > 0 &&
            ` · ${t('owner.crm.paidSince', { amount: money(call.paidSincePaise ?? 0) })}`}
        </p>
      )}
      {call.note && <p>{call.note}</p>}
      {call.lastRemindedAt && (
        <p className={own.quiet}>
          {t('owner.crm.remindedAgo', { age: words.age(call.lastRemindedAt) })}
        </p>
      )}
      {call.lastSnoozeReason && (
        <p className={own.quiet}>
          {t('owner.crm.movedBecause', { reason: call.lastSnoozeReason, times: call.snoozes })}
        </p>
      )}
      <p className={own.quiet}>
        {showShop ? `${call.shopName} · ` : ''}
        {call.assignee
          ? t('owner.crm.assignedTo', { name: call.assignee.name })
          : t('owner.crm.nobodyYet')}
      </p>
      {!call.doneAt && writes && (
        <div className={own.buttons}>
          <Button type="button" disabled={done.isPending} onClick={() => done.mutate()}>
            {t('owner.crm.markDone')}
          </Button>
          {call.customer.phone && (
            <a className={css.inlineLink} href={`tel:${call.customer.phone}`}>
              {t('owner.call')}
            </a>
          )}
          {can('crm.remind', call.locationId) && call.kind === 'PAYMENT' && (
            <YaadDilao
              customerId={call.customer.id}
              followUpId={call.id}
              blocked={call.reminderBlocked}
            />
          )}
          <Button type="button" variant="secondary" onClick={() => setSheet('later')}>
            {t('owner.crm.later')}
          </Button>
          {can('crm.followups.assign', call.locationId) && (
            <Button type="button" variant="ghost" onClick={() => setSheet('give')}>
              {t('owner.crm.giveTo')}
            </Button>
          )}
        </div>
      )}
      <Problem error={done.error} />
      {sheet === 'later' && <SnoozeSheet call={call} close={() => setSheet(null)} />}
      {sheet === 'give' && <AssignSheet call={call} close={() => setSheet(null)} />}
    </article>
  );
}

const useDue = (mine = false) => {
  const { shopId, can } = useOwner();
  const query = [mine ? 'mine=1' : '', shopId ? `locationId=${enc(shopId)}` : '']
    .filter(Boolean)
    .join('&');
  return useQuery({
    enabled: can('crm.followups.read'),
    queryKey: ['followups', 'due', mine, shopId],
    queryFn: () => api<CallList>(`/admin/followups${query ? `?${query}` : ''}`),
  });
};

/** Aaj ke call on Today: the same cards, only the first few, and nothing at all when empty. */
export function CallsBlock({ limit = 3 }: { limit?: number }) {
  const t = useT();
  const { can, shops } = useOwner();
  const calls = useDue();
  const items = calls.data?.items ?? [];
  if (!can('crm.followups.read') || !items.length) return null;
  return (
    <section className={css.stack} aria-label={t('owner.crm.todayCalls')}>
      <div className={own.spread}>
        <h2>{t('owner.crm.todayCalls')}</h2>
        <Link href="/calls" className={css.inlineLink}>
          {t('owner.crm.seeAll', { count: items.length })} <span aria-hidden="true">→</span>
        </Link>
      </div>
      {items.slice(0, limit).map((call) => (
        <CallCard key={call.id} call={call} showShop={shops.length > 1} />
      ))}
    </section>
  );
}

const tabs = ['due', 'upcoming', 'done'] as const;
type Tab = (typeof tabs)[number];
const tabWord = {
  due: 'owner.crm.tab.due',
  upcoming: 'owner.crm.tab.upcoming',
  done: 'owner.crm.tab.done',
} as const;

function PagedCalls({ view, mine, showShop }: { view: Tab; mine: boolean; showShop: boolean }) {
  const t = useT();
  const { shopId } = useOwner();
  const query = usePaged<Call>(
    ['followups', view, mine, shopId],
    `/admin/followups?view=${view}&limit=24${mine ? '&mine=1' : ''}${shopId ? `&locationId=${enc(shopId)}` : ''}`,
  );
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className={css.stack}>
      <QueryStatus query={query} />
      {!query.isPending && !query.error && !rows.length && (
        <EmptyState
          title={t(view === 'done' ? 'owner.crm.emptyDone' : 'owner.crm.emptyUpcoming')}
        />
      )}
      {rows.map((call) => (
        <CallCard key={call.id} call={call} showShop={showShop} />
      ))}
      <MoreRows query={query} />
    </div>
  );
}

export function CallsPage() {
  const t = useT();
  const words = useWords();
  const { shops, shopId, notice } = useOwner();
  const [tab, setTab] = useState<Tab>('due');
  const [mine, setMine] = useState(false);
  const calls = useDue(mine);
  const showShop = shops.length > 1 && !shopId;
  const items = calls.data?.items ?? [];
  const sheet = async () => {
    try {
      await download(
        `/admin/reports/aaj-ke-call.csv${shopId ? `?locationId=${enc(shopId)}` : ''}`,
        `shiv-aaj-ke-call-${calls.data?.today ?? 'list'}.csv`,
      );
    } catch (error) {
      notice(words.error(error), true);
    }
  };
  return (
    <div className={own.page}>
      <PageHeader title={t('owner.crm.todayCalls')} sub={t('owner.crm.todayCallsSub')}>
        <Button type="button" variant="secondary" onClick={() => void sheet()}>
          {t('owner.reports.csv')}
        </Button>
      </PageHeader>
      <div className={own.tabs} role="tablist" aria-label={t('owner.crm.todayCalls')}>
        {tabs.map((value) => (
          <Button
            key={value}
            role="tab"
            type="button"
            aria-selected={value === tab}
            variant={value === tab ? 'primary' : 'secondary'}
            onClick={() => setTab(value)}
          >
            {t(tabWord[value])}
            {value === 'due' && items.length > 0 && ` (${items.length})`}
          </Button>
        ))}
        <label className={css.check}>
          <input
            type="checkbox"
            checked={mine}
            onChange={(event) => setMine(event.target.checked)}
          />
          {t('owner.crm.mineOnly')}
        </label>
      </div>
      {tab === 'due' ? (
        <div className={css.stack}>
          <QueryStatus query={calls} />
          {!calls.isPending && !calls.error && !items.length && (
            <EmptyState title={t('owner.crm.emptyDue')} />
          )}
          {items.map((call) => (
            <CallCard key={call.id} call={call} showShop={showShop} />
          ))}
          {calls.data?.truncated && <p className={own.quiet}>{t('owner.crm.tooMany')}</p>}
        </div>
      ) : (
        <PagedCalls key={tab} view={tab} mine={mine} showShop={showShop} />
      )}
    </div>
  );
}
