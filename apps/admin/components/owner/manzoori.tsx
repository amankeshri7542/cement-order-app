'use client';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, StatusPill } from '@shiv/design';
import { momentLabel, money } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction, useOwner } from '../../lib/owner';
import { PageHeader, Problem, QueryStatus } from './common';
import css from './owner.module.css';

type Request = {
  id: string;
  kind: string;
  status: string;
  amountPaise: number | null;
  note: string;
  createdAt: string;
  requestedByName: string;
  shopName: string;
  canDecide: boolean;
  /** Only for the person deciding. Those who asked see that it is waiting, not the figures. */
  detail: {
    opening?: boolean;
    number?: string;
    name?: string;
    unit?: string;
    quantity?: number;
    fromName?: string;
    toName?: string;
    stillWaiting?: boolean;
    fromTotalPaise?: number;
    toTotalPaise?: number;
    lines?: {
      name?: string;
      unit?: string;
      system?: number;
      counted?: number;
      difference?: number;
      sent?: number;
      received?: number;
      productId?: string;
      fromQuantity?: number;
      toQuantity?: number;
      fromPricePaise?: number | null;
      toPricePaise?: number;
      listPricePaise?: number;
      byHand?: boolean;
    }[];
    deliveryFee?: { from: number; to: number } | null;
    deliveryDate?: { from: string; to: string } | null;
    paymentMethod?: { from: string; to: string } | null;
    shop?: { from: string; to: string } | null;
    stock?: { name: string; have: number | null; need: number; fix: boolean }[];
    overLimit?: { exposurePaise: number; creditLimitPaise: number } | null;
    creditNotAllowed?: boolean;
    reason?: string | null;
    rates?: {
      productId: string;
      name: string;
      fromPaise: number;
      toPaise: number;
      big: boolean;
      stale: boolean;
    }[];
  } | null;
};
export const approvalsKey = ['approvals'];
export function useApprovals(status: 'pending' | 'all' = 'pending') {
  const { can } = useOwner();
  return useQuery({
    enabled: can('approvals.ask') || can('approvals.decide'),
    queryKey: [...approvalsKey, status],
    queryFn: () =>
      api<{ items: Request[] }>(`/admin/approvals${status === 'all' ? '?status=all' : ''}`),
    refetchInterval: 60000,
  });
}

function Facts({ row }: { row: Request }) {
  const t = useT();
  const { detail } = row;
  if (!detail) return null;
  if (row.kind === 'COUNT_CORRECTION')
    return (
      <>
        {detail.opening && <p>{t('owner.manzoori.opening')}</p>}
        {!detail.lines?.length && <p>{t('owner.manzoori.noDifference')}</p>}
        <table className={css.table}>
          {!!detail.lines?.length && (
            <thead>
              <tr>
                <th>{t('owner.manzoori.item')}</th>
                <th>{t('owner.manzoori.system')}</th>
                <th>{t('owner.manzoori.counted')}</th>
                <th>{t('owner.manzoori.difference')}</th>
              </tr>
            </thead>
          )}
          <tbody>
            {detail.lines?.map((line) => (
              <tr key={line.name}>
                <td>{line.name}</td>
                <td>{line.system}</td>
                <td>{line.counted}</td>
                <td>{line.difference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  if (row.kind === 'STOCK_DAMAGE')
    return (
      <p>
        {detail.quantity} {detail.unit} {detail.name}
      </p>
    );
  if (row.kind === 'TRANSFER_SHORTAGE')
    return (
      <>
        <p>
          {detail.fromName} → {detail.toName}
        </p>
        {detail.lines?.map((line) => (
          <p key={line.name}>
            {t('owner.manzoori.transferLine', {
              name: line.name ?? '',
              sent: line.sent ?? 0,
              received: line.received ?? 0,
            })}
          </p>
        ))}
        {detail.lines?.some((line) => (line.received ?? 0) > (line.sent ?? 0)) && (
          <p className={css.warnBlock}>{t('owner.manzoori.transferExtra')}</p>
        )}
      </>
    );
  if (row.kind === 'ORDER_CONFIRM') {
    const deal = (quantity: number, pricePaise: number) => `${quantity} × ${money(pricePaise)}`;
    const payName = (method: string) => t(`owner.manzoori.pay.${method}` as MessageKey);
    return (
      <>
        <p>
          {detail.number} · {money(detail.fromTotalPaise ?? 0)}
          {detail.toTotalPaise !== undefined &&
            detail.toTotalPaise !== detail.fromTotalPaise &&
            ` → ${money(detail.toTotalPaise)}`}
        </p>
        {detail.lines?.map((line) => {
          const name = line.name ?? '';
          const after = deal(line.toQuantity ?? 0, line.toPricePaise ?? 0);
          const before = deal(line.fromQuantity ?? 0, line.fromPricePaise ?? 0);
          return (
            <p key={line.productId}>
              {!line.toQuantity
                ? t('owner.manzoori.lineGone', { name })
                : !line.fromQuantity
                  ? t('owner.manzoori.lineNew', { name, deal: after })
                  : before === after
                    ? `${name}: ${after}`
                    : t('owner.manzoori.rateLine', { name, from: before, to: after })}
              {line.byHand &&
                ` · ${t('owner.manzoori.lineList', { amount: money(line.listPricePaise ?? 0) })}`}
            </p>
          );
        })}
        {detail.deliveryFee && (
          <p>
            {t('owner.manzoori.deliveryChange', {
              from: money(detail.deliveryFee.from),
              to: money(detail.deliveryFee.to),
            })}
          </p>
        )}
        {detail.deliveryDate && <p>{t('owner.manzoori.dateChange', { ...detail.deliveryDate })}</p>}
        {detail.paymentMethod && (
          <p>
            {t('owner.manzoori.paymentChange', {
              from: payName(detail.paymentMethod.from),
              to: payName(detail.paymentMethod.to),
            })}
          </p>
        )}
        {detail.shop && <p>{t('owner.manzoori.shopChange', { ...detail.shop })}</p>}
        {detail.reason && (
          <p>
            {t('owner.manzoori.why', {
              reason: t(`owner.change.reason.${detail.reason}` as MessageKey),
            })}
          </p>
        )}
        {detail.stock?.map((line) => (
          <p key={line.name} className={css.warnBlock}>
            {t(line.fix ? 'owner.manzoori.stockFix' : 'owner.manzoori.stockShort', {
              name: line.name,
              have: line.have ?? 0,
              need: line.need,
            })}
          </p>
        ))}
        {detail.overLimit && (
          <p className={css.warnBlock}>
            {t('owner.manzoori.overLimit', {
              exposure: money(detail.overLimit.exposurePaise),
              limit: money(detail.overLimit.creditLimitPaise),
            })}
          </p>
        )}
        {detail.creditNotAllowed && <p className={css.error}>{t('owner.manzoori.noCredit')}</p>}
        {detail.stillWaiting === false && (
          <p className={css.error}>{t('owner.manzoori.changed')}</p>
        )}
      </>
    );
  }
  if (row.kind === 'RATE_CHANGE')
    return (
      <>
        <p>{t('owner.manzoori.rateCount', { count: detail.rates?.length ?? 0 })}</p>
        {detail.rates?.map((rate) => (
          <div key={rate.productId}>
            <p>
              {t('owner.manzoori.rateLine', {
                name: rate.name,
                from: money(rate.fromPaise),
                to: money(rate.toPaise),
              })}
            </p>
            {rate.big && <p className={css.warnBlock}>{t('owner.manzoori.rateBig')}</p>}
            {rate.stale && <p className={css.error}>{t('owner.manzoori.rateStale')}</p>}
          </div>
        ))}
      </>
    );
  return null;
}

function RequestCard({ row }: { row: Request }) {
  const t = useT();
  const { language } = useLanguage();
  const decide = useAction(
    (decision: 'APPROVE' | 'REJECT') =>
      api(`/admin/approvals/${row.id}/decide`, 'POST', {
        decision,
        // Passing a limit only when this card has just said so.
        ...(decision === 'APPROVE' && row.detail?.overLimit ? { overrideLimit: true } : {}),
      }),
    [approvalsKey, ['stock'], ['rates'], ['inbox'], ['orders', 'list']],
  );
  return (
    <article className={css.card}>
      <div className={css.row}>
        <strong>{t(`owner.approval.kind.${row.kind}` as MessageKey)}</strong>
        {row.status !== 'PENDING' && (
          <StatusPill
            tone={row.status === 'APPROVED' ? 'green' : 'neutral'}
            label={t(`owner.manzoori.status.${row.status}` as MessageKey)}
          />
        )}
      </div>
      <p className={css.sub}>
        {[row.requestedByName, row.shopName, momentLabel(row.createdAt, language)]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <Facts row={row} />
      {row.amountPaise !== null && row.amountPaise > 0 && <p>{money(row.amountPaise)}</p>}
      {/* What someone typed stays plain text. */}
      {row.note && <p>{row.note}</p>}
      {row.canDecide && (
        <div className={css.actions}>
          <Button disabled={decide.isPending} onClick={() => decide.mutate('APPROVE')}>
            {t('owner.manzoori.approve')}
          </Button>
          <Button
            variant="secondary"
            disabled={decide.isPending}
            onClick={() => decide.mutate('REJECT')}
          >
            {t(
              row.kind === 'COUNT_CORRECTION' ? 'owner.manzoori.recount' : 'owner.manzoori.reject',
            )}
          </Button>
        </div>
      )}
      <Problem error={decide.error} />
    </article>
  );
}

/** What waits for an owner. An asker sees what they asked, and can never decide it. */
export function Manzoori() {
  const t = useT();
  const { can } = useOwner();
  const requests = useApprovals('all');
  const rows = requests.data?.items ?? [];
  const waiting = rows.filter((row) => row.status === 'PENDING');
  const done = rows.filter((row) => row.status !== 'PENDING');
  return (
    <>
      <PageHeader title={t('owner.manzoori.title')} />
      <div className={css.stack}>
        <QueryStatus query={requests} />
        {requests.data && !waiting.length && <EmptyState title={t('owner.manzoori.empty')} />}
        {waiting.map((row) => (
          <RequestCard key={row.id} row={row} />
        ))}
        {done.length > 0 && (
          <h2>{t(can('approvals.decide') ? 'owner.manzoori.decided' : 'owner.manzoori.mine')}</h2>
        )}
        {done.slice(0, 30).map((row) => (
          <RequestCard key={row.id} row={row} />
        ))}
      </div>
    </>
  );
}
