'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BigNumberCard, EmptyState, MoneyText } from '@shiv/design';
import { money, type Order, type Page } from '@shiv/shared';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import type { Dashboard } from '../../lib/owner-types';
import { PageHeader, QueryStatus } from './common';
import { CallsBlock } from './crm/calls';
import { EnquiryCards, useNewEnquiries } from './enquiries';
import { NextOrderAction } from './orders';
import { PakkaQueue } from './inbox';
import { useApprovals } from './manzoori';
import { ReviewsLink } from './hazri/today';
import css from './owner.module.css';
import { useOwner } from '../../lib/owner';

export function Today() {
  const t = useT();
  const { can, shopId, reviewCount } = useOwner();
  const shopQuery = shopId ? `&locationId=${shopId}` : '';
  const dashboard = useQuery({
    queryKey: ['dashboard', shopId],
    queryFn: () => api<Dashboard>(`/admin/dashboard${shopId ? `?locationId=${shopId}` : ''}`),
  });
  const work = useQuery({
    queryKey: ['orders', 'list', 'work', shopId],
    queryFn: async () => {
      // New orders are on the queue above, so they are not listed twice.
      const queues = ['dispatch', 'payments', 'issues'] as const;
      return Promise.all(
        queues.map(async (queue) => ({
          queue,
          page: await api<Page<Order>>(`/admin/orders?queue=${queue}&limit=20${shopQuery}`),
        })),
      );
    },
  });
  const enquiries = useNewEnquiries();
  const asks = useApprovals();
  const rates = useQuery({
    enabled: can('rates.publish'),
    queryKey: ['rates'],
    queryFn: () => api<{ checkedAt: string | null }>('/admin/rates'),
  });
  const checkedAt = rates.data?.checkedAt;
  const staleRates = !!checkedAt && Date.now() - new Date(checkedAt).getTime() > 3 * 86400000;
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
      {/* Papa's phone opens on the queue, with nothing above it. */}
      <PakkaQueue limit={3} />
      {can('approvals.decide') && !!asks.data?.items.length && (
        <Link href="/manzoori" className={`${css.card} ${css.cardLink}`}>
          {t('owner.stockPage.waiting', { count: asks.data.items.length })}{' '}
          <span aria-hidden="true">→</span>
        </Link>
      )}
      <ReviewsLink count={reviewCount} />
      {staleRates && can('rates.publish') && (
        <Link href="/rates" className={`${css.card} ${css.cardLink}`}>
          {t('owner.rates.staleToday')} <span aria-hidden="true">→</span>
        </Link>
      )}
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
          {can('khata.read.list') && (
            <Link href="/khata" className={css.cardLink}>
              <BigNumberCard
                label={t('owner.totalDue')}
                value={dashboard.data.khataDuePaise}
                tone="red"
              />
            </Link>
          )}
        </div>
      )}
      {/* Each firm's figures under the combined ones, when more than one firm is seen. */}
      {(dashboard.data?.byFirm?.length ?? 0) > 1 && (
        <dl aria-label={t('owner.khata.byFirm')} className={`${css.card} ${css.firmSplit}`}>
          {dashboard.data!.byFirm!.map((row) => (
            <div key={row.firmId}>
              <dt>{row.name}</dt>
              <dd>
                {money(row.todayMoneyInPaise)}
                {can('khata.read.list')
                  ? ` · ${t('owner.totalDue')} ${money(row.khataDuePaise)}`
                  : ''}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {/* Questions sent from the website's Contact page; nothing shows while there are none. */}
      <EnquiryCards items={enquiries.data?.items ?? []} />
      <CallsBlock />
      <section className={css.stack} aria-label={t('owner.nextWork')}>
        <h2>{t('owner.nextWork')}</h2>
        <QueryStatus query={work} />
        {!work.isPending && !rows.length && !work.error && !enquiries.data?.items.length && (
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
                  queue === 'dispatch'
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
