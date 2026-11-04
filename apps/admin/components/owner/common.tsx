'use client';
import { rupeesToPaise } from '../../lib/money';
import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { Button, Field, Skeleton, StatusPill } from '@shiv/design';
import { dayLabel, istToday, money, type Page, type Permission } from '@shiv/shared';
import { isMessageKey, type Language } from '@shiv/i18n';
import { api } from '../../lib/api';
import { useLanguage, useT, useWords } from '../../lib/i18n';
import { useOwner } from '../../lib/owner';
import css from './owner.module.css';

/** Asks which shop this is for, only when this person can act at more than one. */
export function useShopChoice(permission: Permission) {
  const t = useT();
  const { can, shops } = useOwner();
  const choices = shops.filter((shop) => can(permission, shop.id));
  const [chosen, setChosen] = useState(choices[0]?.id ?? '');
  if (choices.length < 2) return { locationId: undefined, field: null };
  return {
    locationId: chosen,
    field: (
      <Field label={t('owner.whichShop')}>
        <select value={chosen} onChange={(event) => setChosen(event.target.value)}>
          {choices.map((shop) => (
            <option key={shop.id} value={shop.id}>
              {shop.name}
            </option>
          ))}
        </select>
      </Field>
    ),
  };
}
export function PageHeader({
  title,
  back,
  children,
  sub,
}: {
  title: string;
  back?: string;
  children?: React.ReactNode;
  sub?: string;
}) {
  const t = useT();
  return (
    <header className={css.heading}>
      <div>
        {back && (
          <Link href={back} className={css.inlineLink}>
            <span aria-hidden="true">←</span> {t('owner.back')}
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <p className={css.sub}>{sub}</p>}
      </div>
      {children}
    </header>
  );
}
export function Status({ value }: { value: string }) {
  const t = useT();
  const key = `status.${value}`;
  const label = isMessageKey(key) ? t(key) : t('owner.pending');
  return (
    <StatusPill
      label={label}
      tone={
        ['DELIVERED', 'CAPTURED', 'PAYMENT_RECEIVED'].includes(value)
          ? 'green'
          : ['CANCELLED', 'REFUND_PENDING', 'DELIVERY_EXCEPTION', 'SALE_ON_CREDIT'].includes(value)
            ? 'red'
            : value === 'OUT_FOR_DELIVERY'
              ? 'blue'
              : 'neutral'
      }
    />
  );
}
export function Problem({ error }: { error: unknown }) {
  const words = useWords();
  return error ? (
    <p className={css.error} role="alert">
      {words.error(error)}
    </p>
  ) : null;
}
export function QueryStatus({
  query,
}: {
  query: { isPending: boolean; error: unknown; refetch: () => unknown };
}) {
  const t = useT();
  if (query.isPending) return <Skeleton label={t('owner.loading')} />;
  return query.error ? (
    <>
      <Problem error={query.error} />
      <Button variant="secondary" onClick={() => void query.refetch()}>
        {t('owner.retry')}
      </Button>
    </>
  ) : null;
}
export function usePaged<T>(key: QueryKey, path: string) {
  return useInfiniteQuery<Page<T>, Error, InfiniteData<Page<T>>, QueryKey, string | null>({
    queryKey: key,
    initialPageParam: null as string | null,
    placeholderData: (previous) => previous,
    queryFn: ({ pageParam }) =>
      api<Page<T>>(
        path +
          (pageParam
            ? `${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(pageParam)}`
            : ''),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
export function MoreRows({
  query,
}: {
  query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
}) {
  const t = useT();
  return query.hasNextPage ? (
    <Button
      variant="secondary"
      className={css.wide}
      disabled={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}
    >
      {t('owner.loadMore')}
    </Button>
  ) : null;
}
export function OwnerDate({ value }: { value: string }) {
  const { language } = useLanguage();
  const t = useT();
  return (
    <span>
      {value === istToday() ? `${t('owner.today')} · ` : ''}
      {dayLabel(value, language)}
    </span>
  );
}
export { rupeesToPaise };
export function moneyInput(value: number | null | undefined) {
  return value === null || value === undefined
    ? ''
    : `${Math.trunc(value / 100)}${value % 100 ? '.' + String(Math.abs(value % 100)).padStart(2, '0') : ''}`;
}
export function ContactActions({
  phone,
  customerId,
  text = '',
  purpose = 'order',
}: {
  phone: string;
  customerId?: string;
  text?: string;
  purpose?: 'order' | 'reminder';
}) {
  const t = useT();
  const { notice } = useOwner();
  const words = useWords();
  if (!/^\+91[6-9]\d{9}$/.test(phone)) return null;
  const log = (channel: 'CALL' | 'WHATSAPP') => {
    if (customerId)
      void api(`/admin/customers/${customerId}/contacts`, 'POST', {
        channel,
        purpose:
          channel === 'CALL'
            ? t('owner.contactCall')
            : purpose === 'reminder'
              ? t('owner.contactReminder')
              : t('owner.contactOrder'),
      }).catch((error) => notice(words.error(error)));
  };
  return (
    <div className={css.actions}>
      <a className={css.inlineLink} href={`tel:${phone}`} onClick={() => log('CALL')}>
        {t('owner.call')}
      </a>
      <a
        className={css.inlineLink}
        href={`https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noreferrer"
        onClick={() => log('WHATSAPP')}
      >
        {purpose === 'reminder' ? t('owner.remind') : t('owner.shareOrder')}
      </a>
    </div>
  );
}
export function orderShare(
  order: import('@shiv/shared').Order,
  t: ReturnType<typeof useT>,
  language: Language = 'hi',
) {
  return t('owner.orderShare', {
    number: order.number,
    items: order.items
      .map((item) => `${item.name} × ${item.quantity} ${(item.unit)}`)
      .join('\n'),
    total: money(order.totalPaise),
    date: dayLabel(order.deliveryDate, language),
  });
}
