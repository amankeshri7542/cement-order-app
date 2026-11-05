'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, Field } from '@shiv/design';
import { dayLabel, money } from '@shiv/shared';
import { api } from '../../../lib/api';
import { useLanguage, useT, useWords } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { MoreRows, Problem, QueryStatus, Status, usePaged } from '../common';
import css from '../owner.module.css';
import own from './crm.module.css';
import { kindWord } from './follow-up';
import type { TimelineRow } from './types';

/** The money side of a row. A row with no amount, or one a person may not see, shows nothing. */
function Amount({ row }: { row: TimelineRow }) {
  if (row.kind === 'ORDER' && row.totalPaise !== null)
    return <span className={own.money}>{money(row.totalPaise)}</span>;
  if (row.kind === 'KHATA')
    return (
      <span className={`${own.money} ${row.reversed ? own.struck : ''}`}>
        {row.amountPaise > 0 ? '+' : '-'}
        {money(Math.abs(row.amountPaise))}
      </span>
    );
  return <span />;
}

function Row({ row }: { row: TimelineRow }) {
  const t = useT();
  const words = useWords();
  const { language } = useLanguage();
  const by = row.actorName ? ` · ${row.actorName}` : '';
  const when = (
    <p className={own.quiet}>
      {words.moment(row.at)}
      {by}
    </p>
  );
  return (
    <li>
      <div>
        {row.kind === 'ORDER' && (
          <>
            <div className={own.row}>
              <span className={own.tag}>{t('owner.crm.row.order')}</span>
              <Status value={row.status} />
            </div>
            <p>
              <Link href={`/orders/${row.id}`} className={css.inlineLink}>
                {row.number}
              </Link>{' '}
              {row.firstItem}
              {row.itemCount > 1 && ` +${row.itemCount - 1}`}
            </p>
            <p className={own.quiet}>{[row.shopName, row.site].filter(Boolean).join(' · ')}</p>
          </>
        )}
        {row.kind === 'KHATA' && (
          <>
            <div className={own.row}>
              <Status value={row.entryKind} />
              {row.channel && <span className={own.tag}>{row.channel}</span>}
              {row.reversed && <span className={own.tag}>{t('owner.crm.row.reversed')}</span>}
            </div>
            {row.note && <p>{row.note}</p>}
            <p className={own.quiet}>
              {t('owner.crm.row.after', { amount: money(row.balanceAfterPaise) })}
              {row.shopName ? ` · ${row.shopName}` : ''}
            </p>
          </>
        )}
        {row.kind === 'NOTE' && (
          <>
            <span className={own.tag}>{t('owner.crm.row.note')}</span>
            <p>{row.body}</p>
          </>
        )}
        {row.kind === 'CONTACT' && (
          <>
            <span className={`${own.tag} ${row.contactKind === 'REMINDER' ? own.tagLook : ''}`}>
              {t(
                row.contactKind === 'REMINDER'
                  ? 'owner.crm.row.reminder'
                  : row.channel === 'CALL'
                    ? 'owner.crm.row.call'
                    : 'owner.crm.row.message',
              )}
            </span>
            {row.purpose && <p>{row.purpose}</p>}
          </>
        )}
        {row.kind === 'FOLLOWUP' && (
          <>
            <div className={own.row}>
              <span className={own.tag}>{t(kindWord[row.followUpKind])}</span>
              <span className={`${own.tag} ${row.doneAt ? own.tagGood : ''}`}>
                {row.doneAt
                  ? t('owner.crm.done')
                  : t('owner.crm.row.dueOn', { day: dayLabel(row.dueOn, language) })}
              </span>
            </div>
            {row.note && <p>{row.note}</p>}
            {row.promisedPaise !== null && (
              <p className={own.quiet}>
                {t('owner.crm.row.promised', { amount: money(row.promisedPaise) })}
              </p>
            )}
            {row.lastSnoozeReason && (
              <p className={own.quiet}>
                {t('owner.crm.movedBecause', { reason: row.lastSnoozeReason, times: row.snoozes })}
              </p>
            )}
            <p className={own.quiet}>
              {row.shopName}
              {row.assignee ? ` · ${t('owner.crm.assignedTo', { name: row.assignee.name })}` : ''}
            </p>
          </>
        )}
        {when}
      </div>
      <Amount row={row} />
    </li>
  );
}

/** Sab kuch: a note box on top, then everything that happened with this customer. */
export function Timeline({ id }: { id: string }) {
  const t = useT();
  const { can } = useOwner();
  const query = usePaged<TimelineRow>(
    ['customers', 'timeline', id],
    `/admin/customers/${id}/timeline?limit=24`,
  );
  const [body, setBody] = useState('');
  const note = useAction(
    async () => {
      await api(`/admin/customers/${id}/notes`, 'POST', { body: body.trim() });
      setBody('');
    },
    [['customers', 'timeline', id]],
    'owner.saved',
  );
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className={css.stack}>
      {can('customers.note') && (
        <form
          className={css.card}
          onSubmit={(event) => {
            event.preventDefault();
            note.mutate();
          }}
        >
          <Field label={t('owner.notePlaceholder')}>
            <textarea
              value={body}
              maxLength={2000}
              required
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>
          <Problem error={note.error} />
          <Button disabled={note.isPending || !body.trim()}>{t('owner.addNote')}</Button>
        </form>
      )}
      <QueryStatus query={query} />
      {!query.isPending && !query.error && !rows.length && (
        <EmptyState title={t('owner.crm.emptyTimeline')} />
      )}
      {!!rows.length && (
        <ol className={`${css.card} ${own.timeline}`}>
          {rows.map((row) => (
            <Row key={`${row.kind}-${row.id}`} row={row} />
          ))}
        </ol>
      )}
      <MoreRows query={query} />
    </div>
  );
}
