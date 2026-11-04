'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, Field } from '@shiv/design';
import { istToday, momentLabel } from '@shiv/shared';
import { api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useOwner } from '../../lib/owner';
import { MoreRows, PageHeader, QueryStatus, usePaged } from './common';
import { NotYourPage } from './not-your-page';
import { actorOf, nameOf, sentence, type LogEntry } from './report-helpers';
import css from './owner.module.css';
import own from './reports.module.css';

type Entry = LogEntry & { id: string; createdAt: string; shopName: string };
type People = { staff: { id: string; name: string }[]; machines: string[] };

function ActivityLog() {
  const t = useT();
  const { language } = useLanguage();
  const { shops } = useOwner();
  const [person, setPerson] = useState('');
  const [shop, setShop] = useState('');
  const [day, setDay] = useState('');
  const filters = new URLSearchParams({ limit: '24' });
  if (person) filters.set('actorId', person);
  if (shop) filters.set('locationId', shop);
  if (day) filters.set('day', day);
  const log = usePaged<Entry>(
    ['owner-activity', person, shop, day],
    `/admin/audit?${filters.toString()}`,
  );
  const people = useQuery({
    queryKey: ['owner-activity-people'],
    queryFn: () => api<People>('/admin/audit/people'),
  });
  const rows = log.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className={css.stack}>
      <PageHeader title={t('owner.activity.title')} sub={t('owner.activity.subtitle')} />
      <div className={own.filters}>
        <Field label={t('owner.activity.filter.person')}>
          <select value={person} onChange={(event) => setPerson(event.target.value)}>
            <option value="">{t('owner.activity.filter.everyone')}</option>
            {people.data?.staff.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name || t('owner.activity.noName')}
              </option>
            ))}
            {people.data?.machines.map((id) => (
              <option key={id} value={id}>
                {nameOf(id, t)}
              </option>
            ))}
          </select>
        </Field>
        {shops.length > 1 && (
          <Field label={t('owner.activity.filter.shop')}>
            <select value={shop} onChange={(event) => setShop(event.target.value)}>
              <option value="">{t('owner.activity.filter.allShops')}</option>
              {shops.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('owner.activity.filter.day')}>
          <input
            type="date"
            max={istToday()}
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
        </Field>
      </div>
      <QueryStatus query={log} />
      {!!rows.length && (
        <table className={`${css.table} ${own.data} ${own.log}`} role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">
                {t('owner.activity.col.when')}
              </th>
              <th scope="col" role="columnheader">
                {t('owner.activity.col.who')}
              </th>
              <th scope="col" role="columnheader">
                {t('owner.activity.col.what')}
              </th>
              <th scope="col" role="columnheader">
                {t('owner.activity.col.shop')}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((entry) => (
              <tr key={entry.id} role="row">
                <td role="cell" className={own.logWhen}>
                  {momentLabel(entry.createdAt, language)}
                </td>
                <td role="cell">{actorOf(entry, t)}</td>
                <td role="cell" className={own.logWhat}>
                  {sentence(entry, t)}
                </td>
                <td role="cell" className={own.logShop}>
                  {entry.shopName || t('owner.activity.everyShop')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {log.data && !rows.length && <EmptyState title={t('owner.activity.empty')} />}
      <MoreRows query={log} />
    </div>
  );
}
/** Who did what, in plain sentences. Nobody can change this list, and this page only reads it. */
export function Activity() {
  const { can } = useOwner();
  return can('audit.read') ? <ActivityLog /> : <NotYourPage />;
}
