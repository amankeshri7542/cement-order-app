'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BigNumberCard, EmptyState, MoneyText } from '@shiv/design';
import type { Order, Page } from '@shiv/shared';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import type { Dashboard } from '../../lib/owner-types';
import { PageHeader, QueryStatus } from './common';
import { NextOrderAction } from './orders';
import css from './owner.module.css';

export function Today() {
  const t = useT();
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/admin/dashboard'),
  });
  const work = useQuery({
    queryKey: ['orders', 'list', 'work'],
    queryFn: async () => {
      const queues = ['new', 'dispatch', 'payments', 'issues'] as const;
      return Promise.all(
        queues.map(async (queue) => ({
          queue,
          page: await api<Page<Order>>(`/admin/orders?queue=${queue}&limit=20`),
        })),
      );
    },
  });
  const seen = new Set<string>();
  const rows =
    work.data?.flatMap(({ queue, page }) =>
      page.items
        .filter((order) => {
          if (queue !== 'issues' && ['DELIVERY_EXCEPTION', 'REFUND_PENDING'].includes(order.status))
            return false;
          if (seen.has(order.id)) return false;
          seen.add(order.id);
          return true;
        })
        .map((order) => ({ queue, order })),
    ) ?? [];
  return (
    <>
      <PageHeader title={t('owner.today')} />
      <QueryStatus query={dashboard} />
      {dashboard.data && (
        <div className={css.columns}>
          <BigNumberCard
            label={t('owner.todayCollections')}
            value={
              dashboard.data.todaySalesPaise +
              dashboard.data.todayCounterSalesPaise -
              dashboard.data.todayRefundsPaise
            }
          />
          <Link href="/khata" className={css.cardLink}>
            <BigNumberCard
              label={t('owner.totalDue')}
              value={dashboard.data.khataDuePaise}
              tone="red"
            />
          </Link>
        </div>
      )}
      <section className={css.stack} aria-label={t('owner.nextWork')}>
        <h2>{t('owner.nextWork')}</h2>
        <QueryStatus query={work} />
        {!work.isPending && !rows.length && !work.error && (
          <EmptyState title={t('owner.emptyWork')} action={<p>{t('owner.emptyWorkBody')}</p>} />
        )}
        {rows.map(({ queue, order }) => (
          <article className={css.card} key={order.id}>
            <div className={css.row}>
              <div>
                <h3>
                  <Link href={`/orders/${order.id}`}>{order.user?.name || order.address.name}</Link>
                </h3>
                <p>{order.number}</p>
              </div>
              <MoneyText value={order.totalPaise} />
            </div>
            {queue !== 'issues' && order.status !== 'PENDING_PAYMENT' ? (
              <NextOrderAction order={order} task={queue === 'payments' ? 'payment' : 'next'} />
            ) : (
              <Link className={`${css.inlineLink} ${css.wide}`} href={`/orders/${order.id}`}>
                {t(
                  queue === 'new'
                    ? 'owner.workNew'
                    : queue === 'dispatch'
                      ? 'owner.workDispatch'
                      : queue === 'payments'
                        ? 'owner.workPayment'
                        : 'owner.workIssue',
                )}{' '}
                <span aria-hidden="true">→</span>
              </Link>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
