'use client';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { EmptyState } from '@shiv/design';
import { useT, useWords } from '../../../lib/i18n';
import { api } from '../../../lib/api';
import { useIsWide } from '../../../lib/owner';
import { MoreRows, QueryStatus } from '../common';
import own from '../crm/crm.module.css';
import { bookMoney } from '../crm/pure';
import css from '../owner.module.css';
import { Tag, useTallyStatus } from './haal';
import { booksState, isOld, justNow, reasonLines, signedMoney } from './pure';
import tally from './tally.module.css';
import type { DifferenceList, DifferenceRow } from './types';

const big = (paise: string | null) => (paise === null ? '' : bookMoney(paise));

function Reasons({ row }: { row: DifferenceRow }) {
  const t = useT();
  const lines = reasonLines(row.reasons);
  if (!lines.length) return null;
  return (
    <p className={own.quiet}>
      {lines
        .map((line) => `${t(`owner.tally.reason.${line.reason}`)} ${signedMoney(line.amountPaise)}`)
        .join(' · ')}
    </p>
  );
}

/** Its time, and in words if it has gone old. A Tally number never stands alone. */
function Freshness({ row }: { row: DifferenceRow }) {
  const t = useT();
  const words = useWords();
  if (!row.tallyAsOf) return null;
  const when = words.moment(row.tallyAsOf);
  return isOld(row.tallyAsOf, Date.now()) ? (
    <Tag tone="look">{t('owner.tally.farq.old', { when })}</Tag>
  ) : (
    <span className={tally.ledgerNote}>{t('owner.crm.tally.until', { when })}</span>
  );
}

function Worked({ at }: { at: string }) {
  const t = useT();
  const words = useWords();
  return (
    <p className={tally.ledgerNote}>
      {justNow(at, new Date().toISOString())
        ? t('owner.tally.farq.workedNow')
        : t('owner.tally.farq.worked', { age: words.age(at) })}
    </p>
  );
}

const hasUnexplained = (row: DifferenceRow) =>
  row.unexplainedPaise !== null && BigInt(row.unexplainedPaise) !== BigInt(0);

export function Farq() {
  const t = useT();
  const wide = useIsWide();
  const status = useTallyStatus();
  const list = useInfiniteQuery({
    queryKey: ['tally', 'differences'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<DifferenceList>(
        `/admin/tally/differences?limit=24${pageParam ? `&skip=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextSkip ?? undefined,
  });
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const books = status.data ? booksState(status.data.companies) : 'LIVE';
  if (status.data && books === 'NONE')
    return (
      <EmptyState
        title={t(
          status.data.devices.some((pc) => !pc.revoked)
            ? 'owner.tally.noPrimary'
            : 'owner.crm.tally.notConnected',
        )}
        action={
          <Link href="/tally?tab=haal" className={css.inlineLink}>
            {t('owner.tally.goHaal')}
          </Link>
        }
      />
    );
  return (
    <div className={tally.page}>
      <p className={own.quiet}>{t('owner.tally.farq.sub')}</p>
      {books === 'COPYING' && <p className={own.look}>{t('owner.tally.farq.copying')}</p>}
      <QueryStatus query={list} />
      {!list.isPending && !list.error && !rows.length && books === 'LIVE' && (
        <EmptyState
          title={t('owner.tally.farq.none')}
          action={
            <Link href="/tally?tab=party" className={css.inlineLink}>
              {t('owner.tally.goParty')}
            </Link>
          }
        />
      )}
      {!!rows.length &&
        (wide ? (
          <div className={`${css.card} ${own.scroll}`}>
            <table className={own.table}>
              <thead>
                <tr>
                  <th>{t('owner.tally.farq.customer')}</th>
                  <th className={own.moneyCell}>{t('owner.tally.farq.khata')}</th>
                  <th className={own.moneyCell}>{t('owner.tally.farq.tally')}</th>
                  <th className={own.moneyCell}>{t('owner.tally.farq.difference')}</th>
                  <th className={own.moneyCell}>{t('owner.tally.farq.unexplained')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.customerId}>
                    <td>
                      <Link
                        href={`/customers/${row.customerId}?tab=tally`}
                        className={css.inlineLink}
                      >
                        {row.name || row.phone}
                      </Link>
                      <Reasons row={row} />
                      <Worked at={row.computedAt} />
                    </td>
                    <td className={own.moneyCell}>{bookMoney(String(row.appPaise))}</td>
                    <td className={own.moneyCell}>
                      {big(row.tallyPaise)}
                      <Freshness row={row} />
                    </td>
                    <td className={own.moneyCell}>{big(row.differencePaise)}</td>
                    <td className={own.moneyCell}>
                      {hasUnexplained(row) ? (
                        <Tag tone="look">{big(row.unexplainedPaise)}</Tag>
                      ) : (
                        big(row.unexplainedPaise)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={css.stack}>
            {rows.map((row) => (
              <article key={row.customerId} className={`${css.card} ${tally.cardBody}`}>
                <Link href={`/customers/${row.customerId}?tab=tally`} className={own.name}>
                  {row.name || row.phone}
                </Link>
                <div className={css.ledger}>
                  <div className={css.ledgerLine}>
                    <span>{t('owner.tally.farq.khata')}</span>
                    <span className={css.amount}>{bookMoney(String(row.appPaise))}</span>
                  </div>
                  <div className={css.ledgerLine}>
                    <span>
                      {t('owner.tally.farq.tally')}
                      <Freshness row={row} />
                    </span>
                    <span className={css.amount}>{big(row.tallyPaise)}</span>
                  </div>
                  <div className={`${css.ledgerLine} ${tally.ledgerTotal}`}>
                    <span>{t('owner.tally.farq.difference')}</span>
                    <span className={css.amount}>{big(row.differencePaise)}</span>
                  </div>
                </div>
                {hasUnexplained(row) && (
                  <p className={own.look}>
                    {t('owner.tally.farq.unexplained')}: {big(row.unexplainedPaise)}
                  </p>
                )}
                <Reasons row={row} />
                <Worked at={row.computedAt} />
              </article>
            ))}
          </div>
        ))}
      <MoreRows query={list} />
    </div>
  );
}
